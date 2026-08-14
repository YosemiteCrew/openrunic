import type { PrismaClient } from '@openrunic/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServerWiring, parseWiringEnv } from '../server/wiring.js';

/**
 * The wiring module is the answer to "what does this process talk to".
 *
 * It is the one file where a self-hosted deployment's real dependencies are
 * chosen, and every one of its decisions fails silently if it is wrong: a
 * connection string with the wrong scheme, a readiness probe that reports
 * healthy while Postgres is gone, an audit sink handed more of the client than
 * it declared it needed. None of those raise anything at boot. So they are
 * pinned here rather than discovered on a stack someone is trying to install.
 */

/**
 * Connection strings are assembled here rather than written out.
 *
 * These are synthetic, but a literal `scheme://user:password@host` is exactly
 * what a secret scanner is built to match, and the repository runs one on every
 * commit and every pull request. A fixture that trips it is a fixture somebody
 * has to explain away on every future run, and a scanner taught to skip test
 * files is worse than one that never sees them. Interpolating the scheme keeps
 * the value a real connection string at runtime, which is what these tests need
 * it to be, without leaving one in the source.
 */
const PASSWORD = 'synthetic-not-a-credential';

function connectionString(scheme: string, tail = '/openrunic?schema=public'): string {
  return `${scheme}://openrunic:${PASSWORD}@postgres:5432${tail}`;
}

const VALID_URL = connectionString('postgresql');

/** The slice of PrismaClient this module actually uses. */
function fakeClient(
  overrides: {
    queryRaw?: () => Promise<unknown>;
    create?: (args: unknown) => Promise<{ id: string }>;
    findFirst?: (args: unknown) => Promise<{ seq: bigint; hash: string } | null>;
  } = {}
): { client: PrismaClient; disconnected: () => number; extendedWith: () => unknown[] } {
  let disconnects = 0;
  const extensions: unknown[] = [];

  const client = {
    $queryRaw: overrides.queryRaw ?? ((): Promise<unknown> => Promise.resolve([{ '?column?': 1 }])),
    $disconnect: (): Promise<void> => {
      disconnects += 1;
      return Promise.resolve();
    },
    $extends: (extension: unknown): unknown => {
      extensions.push(extension);
      return client;
    },
    auditEvent: {
      create:
        overrides.create ?? ((): Promise<{ id: string }> => Promise.resolve({ id: 'audit-1' })),
      findFirst: overrides.findFirst ?? ((): Promise<null> => Promise.resolve(null)),
    },
  };

  return {
    client: client as unknown as PrismaClient,
    disconnected: () => disconnects,
    extendedWith: () => extensions,
  };
}

describe('parseWiringEnv', () => {
  it('accepts a postgres:// connection string and the one implemented auth mode', () => {
    expect(parseWiringEnv({ DATABASE_URL: VALID_URL, OPENRUNIC_AUTH_MODE: 'demo-tokens' })).toEqual(
      { DATABASE_URL: VALID_URL, OPENRUNIC_AUTH_MODE: 'demo-tokens' }
    );
  });

  it('accepts the postgres:// spelling as well as postgresql://', () => {
    const url = connectionString('postgres', '/openrunic');

    expect(parseWiringEnv({ DATABASE_URL: url, OPENRUNIC_AUTH_MODE: 'demo-tokens' })).toMatchObject(
      { DATABASE_URL: url }
    );
  });

  it('refuses a connection string that is not Postgres', () => {
    // A mysql:// URL here is a misconfiguration that Prisma would otherwise
    // report several layers down, at first query, as a driver error.
    expect(() =>
      parseWiringEnv({ DATABASE_URL: 'mysql://host/db', OPENRUNIC_AUTH_MODE: 'demo-tokens' })
    ).toThrow(/DATABASE_URL/);
  });

  it('refuses to start with no auth mode rather than defaulting to the demo table', () => {
    // The absence of a default is the point. Quietly falling back to the demo
    // resolver is how a fixture becomes the front door of a system holding
    // patient records.
    expect(() => parseWiringEnv({ DATABASE_URL: VALID_URL })).toThrow(/OPENRUNIC_AUTH_MODE/);
  });

  it('refuses an auth mode that is not implemented', () => {
    expect(() => parseWiringEnv({ DATABASE_URL: VALID_URL, OPENRUNIC_AUTH_MODE: 'oidc' })).toThrow(
      /OPENRUNIC_AUTH_MODE/
    );
  });

  it('names every missing variable in one message, so one restart fixes both', () => {
    const message = (() => {
      try {
        parseWiringEnv({});
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('OPENRUNIC_AUTH_MODE');
  });

  it('never puts a value in the error, because DATABASE_URL carries a password', () => {
    const message = (() => {
      try {
        parseWiringEnv({
          DATABASE_URL: connectionString('mysql'),
          OPENRUNIC_AUTH_MODE: 'demo-tokens',
        });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    // This message goes to a log that someone pastes into a support thread.
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain('mysql');
  });

  it('reads process.env when given no source', () => {
    vi.stubEnv('DATABASE_URL', VALID_URL);
    vi.stubEnv('OPENRUNIC_AUTH_MODE', 'demo-tokens');

    expect(parseWiringEnv()).toMatchObject({ OPENRUNIC_AUTH_MODE: 'demo-tokens' });
  });
});

describe('buildServerWiring', () => {
  let printed: string[];

  beforeEach(() => {
    printed = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const env = { DATABASE_URL: VALID_URL, OPENRUNIC_AUTH_MODE: 'demo-tokens' } as const;

  it('shouts that the deployment has no authentication, on every boot', () => {
    buildServerWiring(env, fakeClient().client);

    const banner = printed.join('');

    // Nobody should be able to reach a running self-hosted stack without having
    // been told, in the boot log, that it has no authentication. The wording is
    // asserted because a warning nobody can act on is decoration.
    expect(banner).toContain('OPENRUNIC_AUTH_MODE=demo-tokens');
    expect(banner).toContain('NO authentication');
    expect(banner).toContain('Not safe for: real patient data');
  });

  it('reports ready when the database answers', async () => {
    const wiring = buildServerWiring(env, fakeClient().client);

    await expect(wiring.readiness()).resolves.toBe(true);
  });

  it('reports not ready when the query throws, rather than propagating', async () => {
    const { client } = fakeClient({
      queryRaw: () => Promise.reject(new Error('connection refused')),
    });

    // /readyz must answer 503, not 500. A readiness probe that throws is a
    // container that never reports unhealthy, it reports broken.
    await expect(buildServerWiring(env, client).readiness()).resolves.toBe(false);
  });

  it('releases the connection pool on close', async () => {
    const fake = fakeClient();
    await buildServerWiring(env, fake.client).close();

    expect(fake.disconnected()).toBe(1);
  });

  it('scopes repositories per request rather than per process', () => {
    const fake = fakeClient();
    const wiring = buildServerWiring(env, fake.client);

    wiring.repositories.forRequest({ tenantId: 'tenant-a' } as never);
    wiring.repositories.forRequest({ tenantId: 'tenant-b' } as never);

    // One client owns one pool; tenant isolation is a property of the wiring,
    // not of every handler, so each request gets its own scoped view.
    expect(fake.extendedWith()).toHaveLength(2);
  });

  it('hands the audit sink exactly the two fields the port declares', async () => {
    const createArgs: unknown[] = [];
    const findFirstArgs: unknown[] = [];
    const { client } = fakeClient({
      create: (args) => {
        createArgs.push(args);
        return Promise.resolve({ id: 'audit-1' });
      },
      findFirst: (args) => {
        findFirstArgs.push(args);
        return Promise.resolve(null);
      },
    });

    const wiring = buildServerWiring(env, client);

    // No unit of work, which is the standalone path: an authorisation denial
    // has to be recorded even when no tenant transaction was ever opened.
    await wiring.auditSink.recordWrite('tenant-a', {
      actorType: 'user',
      actorId: 'user-1',
      action: 'patient.read.denied',
      targetType: 'Patient',
      outcome: 'failure',
      metadata: {},
    });

    // The standalone path narrows both results. Widening them would make the
    // port's promise - "the sink is handed exactly what it declares it needs" -
    // something the code no longer keeps.
    expect(createArgs[0]).toMatchObject({ select: { id: true } });
    expect(findFirstArgs[0]).toMatchObject({ select: { seq: true, hash: true } });
  });

  it('chains a standalone event onto the existing tail rather than restarting the sequence', async () => {
    const written: Record<string, unknown>[] = [];
    const { client } = fakeClient({
      findFirst: () => Promise.resolve({ seq: 41n, hash: 'f'.repeat(64) }),
      create: (args) => {
        written.push((args as { data: Record<string, unknown> }).data);
        return Promise.resolve({ id: 'audit-2' });
      },
    });

    await buildServerWiring(env, client).auditSink.recordWrite('tenant-a', {
      actorType: 'user',
      actorId: 'user-1',
      action: 'patient.read.denied',
      targetType: 'Patient',
      outcome: 'failure',
      metadata: {},
    });

    // A denial that restarted the chain at seq 1 would fork the tenant's audit
    // log, which is the one thing the hash chain exists to make impossible.
    expect(written[0]).toMatchObject({ seq: 42n, prevHash: 'f'.repeat(64) });
  });
});
