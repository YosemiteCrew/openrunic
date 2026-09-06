import type { PrismaClient } from '@openrunic/database';
import { describe, expect, it } from 'vitest';

import { buildDemoPractice, demoOrganisationId } from '@openrunic/database/seed';

import {
  createDemoPrincipalResolver,
  DEMO_ORGANISATION_SLUG,
  DEMO_TOKENS,
} from '../server/demo-principals.js';

/**
 * The resolver that stops a self-hosted stack coming up empty.
 *
 * The static demo table hardcodes a tenant id and the seed mints its own, so
 * wiring the two together authenticates every token successfully and then shows
 * a practice with nothing in it: every query scoped to a tenant that owns no
 * rows. The stack looks healthy and is useless, which is the most expensive kind
 * of broken and the hardest to diagnose from a boot log.
 *
 * This resolver closes that by looking the organisation up by slug. What is
 * pinned here is that it invents nothing - no fallback tenant, no synthesised
 * user - and that a stack seeded a few seconds after the API starts recovers on
 * its own rather than answering 401 for the life of the process.
 */

interface SeededUser {
  id: string;
  email: string;
  givenName: string;
  familyName: string;
  credential: string | null;
}

/**
 * The rows a real database would return, taken from the seed rather than
 * described.
 *
 * This was a hand-written list, and it disagreed with the seed on two of the
 * three names it claimed to mirror. That is survivable while it is only a label,
 * and it stops being survivable the moment the list decides what the resolver
 * can find: a spec whose email has no seeded user is skipped by a bare
 * `continue`, so a fixture that invents the user hides the one failure this file
 * is here to catch. `buildDemoPractice` is pure and already imported for
 * `demoOrganisationId`, so reading it costs nothing and cannot drift.
 */
const USERS: SeededUser[] = buildDemoPractice()
  .users.filter((user) => DEMO_TOKENS.some((spec) => spec.email === user.email))
  .map((user) => ({
    id: String(user.id),
    email: String(user.email),
    givenName: String(user.givenName),
    familyName: String(user.familyName),
    // Prisma answers a nullable column with null; the builder simply omits it.
    credential: user.credential === undefined ? null : String(user.credential),
  }));

/** The user the clinician token resolves to, read from the same source. */
const CLINICIAN = USERS.find((user) => user.email === 'a.okafor@demo.invalid');
const FRONT_DESK = USERS.find((user) => user.email === 'f.deskly@demo.invalid');

/**
 * A client whose organisation lookup returns whatever the test scripts.
 *
 * It has to answer `$extends`, `$transaction` and `$executeRaw` as well as the
 * lookup, because the resolver no longer reads on a bare client: `Organisation`
 * is policied like every other table, so the read happens inside a session that
 * declares the tenant first. `sessions()` is what those `set_config` calls were
 * given, which is the property worth asserting - a resolver that opened no
 * session would read nothing in a real database and answer 401 for every token.
 */
function clientReturning(
  results: ({ id: string; facilities: { id: string }[]; users: SeededUser[] } | null)[]
): { client: PrismaClient; calls: () => unknown[]; sessions: () => unknown[][] } {
  const calls: unknown[] = [];
  const sessions: unknown[][] = [];
  let index = 0;

  const client = {
    $extends: (): unknown => client,
    $transaction: <R>(run: (tx: unknown) => Promise<R>): Promise<R> => run(client),
    $executeRaw: (...args: unknown[]): Promise<number> => {
      sessions.push(args);
      return Promise.resolve(1);
    },
    organisation: {
      findFirst: (args: unknown): Promise<unknown> => {
        calls.push(args);
        const result = results[Math.min(index, results.length - 1)] ?? null;
        index += 1;
        return Promise.resolve(result);
      },
    },
  };

  return {
    client: client as unknown as PrismaClient,
    calls: () => calls,
    sessions: () => sessions,
  };
}

const seeded = {
  id: 'org-seeded-by-the-seed',
  facilities: [{ id: 'facility-1' }, { id: 'facility-2' }],
  users: USERS,
};

describe('createDemoPrincipalResolver', () => {
  /*
   * The premise, asserted rather than assumed. Every test below is written as
   * though the seed holds a user for each published token; if it does not, the
   * fixture silently shrinks and the suite goes on measuring a smaller table
   * than the one that ships.
   */
  it('has a seeded user behind every published token', () => {
    // Compared as sets: which rows exist is the premise, and the order either
    // list happens to be written in is not.
    expect([...USERS].map((user) => user.email).sort()).toStrictEqual(
      DEMO_TOKENS.map((spec) => spec.email).sort()
    );
  });

  it('binds every token to the tenant the seed actually created', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    for (const spec of DEMO_TOKENS) {
      // The whole point: the tenant id comes from the looked-up organisation,
      // never from the fixture table.
      await expect(resolver.resolve(spec.token)).resolves.toMatchObject({
        tenantId: 'org-seeded-by-the-seed',
        roles: spec.roles,
        purposeOfUse: spec.purposeOfUse,
        actorType: 'user',
      });
    }
  });

  /**
   * THE BOOTSTRAP THIS SYSTEM CANNOT DO BY QUERYING.
   *
   * `Organisation`'s policy keys on `id`, so a connection that has not declared
   * a tenant sees no organisations at all - not even to find one by slug. The
   * resolver used to do exactly that, which worked only because the API
   * connected as the superuser initdb creates. The id now arrives from
   * `demoOrganisationId()`, derived from the same pure builder the seed writes
   * from, and the read happens inside a session opened with it.
   */
  it('opens a session under the id the seed writes, before reading anything', async () => {
    const { client, sessions } = clientReturning([seeded]);
    await createDemoPrincipalResolver(client).resolve('dev-clinician-a');

    expect(sessions()).toHaveLength(1);
    const statement = JSON.stringify(sessions()[0]);
    expect(statement).toContain('openrunic.tenant_id');
    expect(statement).toContain(demoOrganisationId());
  });

  it('reads the organisation inside that session, never on a bare client', async () => {
    const { client, calls, sessions } = clientReturning([seeded]);
    await createDemoPrincipalResolver(client).resolve('dev-clinician-a');

    // One read, and a session was opened before it. A bare read would return
    // nothing in a real database and answer 401 for every token.
    expect(calls()).toHaveLength(1);
    expect(sessions()).toHaveLength(1);
  });

  it('looks the organisation up by the slug the seed writes', async () => {
    const { client, calls } = clientReturning([seeded]);
    await createDemoPrincipalResolver(client).resolve('dev-frontdesk-a');

    expect(calls()[0]).toMatchObject({ where: { slug: DEMO_ORGANISATION_SLUG } });
  });

  it('grants every facility in the organisation, because empty is not a wildcard', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    await expect(resolver.resolve('dev-clinician-a')).resolves.toMatchObject({
      subject: CLINICIAN?.id,
      facilityIds: ['facility-1', 'facility-2'],
    });
  });

  it('composes the display name from the stored parts, credential included', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    // The audit trail caches this label so a later rename cannot rewrite
    // history, which is why it is composed at resolve time.
    await expect(resolver.resolve('dev-clinician-a')).resolves.toMatchObject({
      displayName: `${String(CLINICIAN?.givenName)} ${String(CLINICIAN?.familyName)}, ${String(CLINICIAN?.credential)}`,
    });
  });

  it('leaves the trailing comma off a user with no credential', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    // No credential on this row, so no trailing comma - asserted against the
    // seed's own name for them rather than a remembered one.
    expect(FRONT_DESK?.credential).toBeNull();
    await expect(resolver.resolve('dev-frontdesk-a')).resolves.toMatchObject({
      displayName: `${String(FRONT_DESK?.givenName)} ${String(FRONT_DESK?.familyName)}`,
    });
  });

  it('resolves nothing at all when the demo practice was never seeded', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([null]).client);

    // 401 is the correct answer for a deployment with no identity provider and
    // no demo data. Inventing a tenant here is what produced the empty-practice
    // bug in the first place.
    for (const spec of DEMO_TOKENS) {
      await expect(resolver.resolve(spec.token)).resolves.toBeNull();
    }
  });

  it('returns null for a token that is not in the table', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    await expect(resolver.resolve('dev-not-a-token')).resolves.toBeNull();
  });

  it('skips a token whose user is missing without dropping the others', async () => {
    const partial = {
      ...seeded,
      users: USERS.filter((user) => user.email !== 'r.claimsworth@demo.invalid'),
    };
    const resolver = createDemoPrincipalResolver(clientReturning([partial]).client);

    await expect(resolver.resolve('dev-biller-a')).resolves.toBeNull();
    await expect(resolver.resolve('dev-clinician-a')).resolves.not.toBeNull();
  });

  it('queries once and caches, so the token table is not a query per request', async () => {
    const { client, calls } = clientReturning([seeded]);
    const resolver = createDemoPrincipalResolver(client);

    await resolver.resolve('dev-clinician-a');
    await resolver.resolve('dev-frontdesk-a');
    await resolver.resolve('dev-biller-a');

    expect(calls()).toHaveLength(1);
  });

  it('keeps retrying while the seed has not finished', async () => {
    // The API container can win the race against the seed on a first boot. A
    // resolver that cached "no demo tenant" at startup would answer 401 for the
    // life of the process, and the operator's only fix would be a restart they
    // have no reason to try.
    const { client, calls } = clientReturning([null, seeded]);
    const resolver = createDemoPrincipalResolver(client);

    await expect(resolver.resolve('dev-clinician-a')).resolves.toBeNull();
    await expect(resolver.resolve('dev-clinician-a')).resolves.toMatchObject({
      tenantId: 'org-seeded-by-the-seed',
    });
    expect(calls()).toHaveLength(2);
  });

  it('asks only for the demo users rather than reading the whole staff list', async () => {
    const { client, calls } = clientReturning([seeded]);
    await createDemoPrincipalResolver(client).resolve('dev-clinician-a');

    expect(calls()[0]).toMatchObject({
      select: {
        users: { where: { email: { in: DEMO_TOKENS.map((spec) => spec.email) } } },
      },
    });
  });
});
