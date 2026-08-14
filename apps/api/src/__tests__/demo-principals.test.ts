import type { PrismaClient } from '@openrunic/database';
import { describe, expect, it } from 'vitest';

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

const USERS: SeededUser[] = [
  {
    id: 'user-clinician',
    email: 'a.okafor@demo.invalid',
    givenName: 'Adaeze',
    familyName: 'Okafor',
    credential: 'MD',
  },
  {
    id: 'user-frontdesk',
    email: 'f.deskly@demo.invalid',
    givenName: 'Fern',
    familyName: 'Deskly',
    credential: null,
  },
  {
    id: 'user-biller',
    email: 'r.claimsworth@demo.invalid',
    givenName: 'Reg',
    familyName: 'Claimsworth',
    credential: 'CPC',
  },
];

/** A client whose organisation lookup returns whatever the test scripts. */
function clientReturning(
  results: ({ id: string; facilities: { id: string }[]; users: SeededUser[] } | null)[]
): { client: PrismaClient; calls: () => unknown[] } {
  const calls: unknown[] = [];
  let index = 0;

  const client = {
    organisation: {
      findUnique: (args: unknown): Promise<unknown> => {
        calls.push(args);
        const result = results[Math.min(index, results.length - 1)] ?? null;
        index += 1;
        return Promise.resolve(result);
      },
    },
  };

  return { client: client as unknown as PrismaClient, calls: () => calls };
}

const seeded = {
  id: 'org-seeded-by-the-seed',
  facilities: [{ id: 'facility-1' }, { id: 'facility-2' }],
  users: USERS,
};

describe('createDemoPrincipalResolver', () => {
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

  it('looks the organisation up by the slug the seed writes', async () => {
    const { client, calls } = clientReturning([seeded]);
    await createDemoPrincipalResolver(client).resolve('dev-frontdesk-a');

    expect(calls()[0]).toMatchObject({ where: { slug: DEMO_ORGANISATION_SLUG } });
  });

  it('grants every facility in the organisation, because empty is not a wildcard', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    await expect(resolver.resolve('dev-clinician-a')).resolves.toMatchObject({
      subject: 'user-clinician',
      facilityIds: ['facility-1', 'facility-2'],
    });
  });

  it('composes the display name from the stored parts, credential included', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    // The audit trail caches this label so a later rename cannot rewrite
    // history, which is why it is composed at resolve time.
    await expect(resolver.resolve('dev-clinician-a')).resolves.toMatchObject({
      displayName: 'Adaeze Okafor, MD',
    });
  });

  it('leaves the trailing comma off a user with no credential', async () => {
    const resolver = createDemoPrincipalResolver(clientReturning([seeded]).client);

    await expect(resolver.resolve('dev-frontdesk-a')).resolves.toMatchObject({
      displayName: 'Fern Deskly',
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
