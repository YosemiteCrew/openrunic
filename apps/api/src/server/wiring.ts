import { createPrismaClient, withTenantSession, type PrismaClient } from '@openrunic/database';
import { z } from 'zod';

import { createPrismaAuditSink, type StandaloneAuditWork } from '../audit/prisma-sink.js';
import { lockAuditChain, type AuditEventDelegate } from '../repositories/db-port.js';
import type { AuditSink } from '../audit/types.js';
import type { PrincipalResolver } from '../auth/principal.js';
import { createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import { createRlsDbPortFactory } from '../repositories/rls-port.js';
import type { RepositoryRegistry } from '../repositories/types.js';

import { createDemoPrincipalResolver } from './demo-principals.js';

/**
 * Production wiring for the API process.
 *
 * `createApp` refuses to start under NODE_ENV=production with its development
 * defaults - an in-memory store and a table of public demo tokens - and it is
 * right to. This module is what supplies the real thing: Postgres-backed
 * repositories, the hash-chained audit sink, and a token verifier.
 *
 * It lives here rather than inline in index.ts so that the self-hosted image
 * has one obvious, testable place where "what does this process talk to" is
 * decided, and so that adding the real identity provider later is an edit to
 * one function rather than a hunt through the entry point.
 */

const wiringEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL must be set for the API to reach Postgres')
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
  /**
   * How bearer tokens become principals.
   *
   * There is exactly one implemented mode, and it is not authentication: it
   * maps a short list of public, non-secret demo tokens onto demo users. The
   * variable has no default on purpose. A missing value stops the process,
   * because the alternative - quietly defaulting to the demo table - is how a
   * fixture becomes the front door of a system holding patient records.
   */
  OPENRUNIC_AUTH_MODE: z.enum(['demo-tokens']),
});

export type WiringEnv = z.infer<typeof wiringEnvSchema>;

export interface ServerWiring {
  readonly repositories: RepositoryRegistry;
  readonly principalResolver: PrincipalResolver;
  /**
   * Carried so the composition can name it when it announces which resolver is
   * in force, without parsing the environment a second time. `principalResolver`
   * above is the demo one whether or not it ends up being used.
   */
  readonly authMode: WiringEnv['OPENRUNIC_AUTH_MODE'];
  readonly auditSink: AuditSink;
  /** Cheapest possible proof that the database is answering. */
  readonly readiness: () => Promise<boolean>;
  /** Releases the connection pool. Call on shutdown. */
  readonly close: () => Promise<void>;
}

export function parseWiringEnv(
  source: Record<string, string | undefined> = process.env
): WiringEnv {
  const result = wiringEnvSchema.safeParse(source);
  if (!result.success) {
    // Names only, never values: DATABASE_URL carries a password, and this
    // message goes to a log that someone will paste into a support thread.
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Invalid server configuration. Fix these variables and restart: ${names.join(', ')}`
    );
  }
  return result.data;
}

/**
 * The boot announcement for a deployment with no identity provider.
 *
 * Exported and NOT called from `buildPrincipalResolver`, which is the whole
 * point. This wiring always builds the demo resolver; `index.ts` then discards
 * it when an issuer is configured, so a warning written here is written about a
 * resolver that may never serve a request. It said
 * `OPENRUNIC_AUTH_MODE=demo-tokens` and "This deployment has NO authentication"
 * to operators whose OIDC group was complete and enforcing - and #307 was filed
 * on the strength of that message rather than on a request, asserting an
 * authentication bypass that does not exist.
 *
 * Only the composition knows which resolver is in force, so only the
 * composition may announce it. See the call site in `index.ts`.
 */
export function announceDemoTokenAuthentication(
  mode: WiringEnv['OPENRUNIC_AUTH_MODE'],
  write: (message: string) => void = (message) => void process.stderr.write(message)
): void {
  write(
    [
      '',
      '  ###############################################################',
      `  #  OPENRUNIC_AUTH_MODE=${mode.padEnd(38)}#`,
      '  #                                                             #',
      '  #  This deployment has NO authentication. Access is granted   #',
      '  #  by a short list of public tokens that are printed in the   #',
      '  #  source and grant full access to the demo tenant.           #',
      '  #                                                             #',
      '  #  Safe for: a laptop, an isolated evaluation network.        #',
      '  #  Not safe for: real patient data, or any reachable network. #',
      '  ###############################################################',
      '',
    ].join('\n')
  );
}

/**
 * The boot announcement for a deployment that verifies tokens against an issuer.
 *
 * One line rather than a banner, because it reports a correctly configured
 * state. It names the issuer so an operator can see WHICH provider is being
 * trusted - the failure this pairs with is a deployment pointed at the wrong
 * one, which a message saying only "OIDC enabled" cannot help with.
 */
export function announceIssuerAuthentication(
  issuer: string,
  write: (message: string) => void = (message) => void process.stderr.write(message)
): void {
  write(`  openrunic-api: bearer tokens are verified against ${issuer}\n`);
}

/**
 * Announce the resolver that is actually in force.
 *
 * THE CHOICE LIVES HERE, not at the call site, and that is the whole point of
 * this function existing. #307 was a defect of composition: `buildServerWiring`
 * was individually correct, the banner's wording was individually correct about
 * the object it described, and `index.ts` was individually correct to prefer a
 * configured issuer. Nothing was wrong except which of them spoke.
 *
 * `index.ts` has top-level side effects and no test imports it, so a condition
 * written there is a condition nothing can exercise. Two tests that each call an
 * announcement directly pin what each one SAYS and say nothing about which is
 * chosen - which would leave the composition as the only untested part of a
 * change whose entire subject is the composition.
 *
 * Pure, and takes its writer, so both branches are reachable from a test.
 */
export function announceAuthentication(
  wiring: ServerWiring | null,
  issuer: string | undefined,
  write?: (message: string) => void
): void {
  // Nothing outside production. Development keeps `createApp`'s in-memory
  // defaults, and a banner about self-hosting on a laptop running `pnpm dev` is
  // noise that trains people to skim the one that matters.
  if (wiring === null) return;

  if (issuer === undefined) {
    announceDemoTokenAuthentication(wiring.authMode, write);
    return;
  }

  announceIssuerAuthentication(issuer, write);
}

/**
 * Resolves bearer tokens to principals.
 *
 * The one supported mode is the demo table. This function no longer announces
 * anything: see `announceDemoTokenAuthentication` for why the announcement
 * belongs to the caller that chooses between resolvers.
 */
function buildPrincipalResolver(
  _mode: WiringEnv['OPENRUNIC_AUTH_MODE'],
  client: PrismaClient
): PrincipalResolver {
  // Bound to the seeded tenant, not to the fixture tenant id. See
  // demo-principals.ts: the two are different values, and using the fixture one
  // authenticates fine and then shows an empty practice.
  return createDemoPrincipalResolver(client);
}

/**
 * The audit sink's fallback write path, for events with no transaction of their
 * own: an authorisation denial, or a batch of reads.
 *
 * It opens a tenant session, because `AuditEvent` is policied like every other
 * table and a write outside a declared session is refused - and a refused audit
 * write is the quietest failure in this system, since the collector logs the
 * flush error after the response has already gone. One transaction also gives
 * the hash chain what it has always needed: the tail read and the linked write
 * with nothing between them.
 *
 * Written as an explicit adapter rather than a cast. `PrismaClient.auditEvent`
 * is not assignable to `AuditEventDelegate`: Prisma's generated methods are
 * generic over the argument so the result type can be narrowed by `select`,
 * and the port deliberately is not. Narrowing the results here keeps the port's
 * promise honest - the sink is handed exactly the two fields it declares it
 * needs, and nothing about the caller's shape is asserted.
 */
function standaloneAuditWork(prisma: PrismaClient): StandaloneAuditWork {
  return (tenantId, run) =>
    withTenantSession(prisma, { tenantId }, (tx) => {
      // Narrowed to the port's type BEFORE anything is called on it. Spreading
      // the sink's own `args` into the transaction client's generic delegate
      // makes TypeScript compare two deeply instantiated argument types and give
      // up ("excessive stack depth"); through `AuditEventDelegate` it is one
      // concrete signature. `tenantTransactionSatisfiesPort` in `db-port.ts`
      // proves the assignment is sound.
      const delegate: AuditEventDelegate = tx.auditEvent;

      return run({
        auditEvent: {
          create: async (args) => {
            const created = await delegate.create({ ...args, select: { id: true } });
            return { id: created.id };
          },
          findFirst: async (args) => {
            const row = await delegate.findFirst({
              ...args,
              select: { seq: true, hash: true },
            });
            return row === null ? null : { seq: row.seq, hash: row.hash };
          },
        },
        // The same lock the mutation path takes, on this transaction. Without
        // it here the two paths serialise against themselves and not against
        // each other, which is the half of the race a per-path fix would miss:
        // a chart read and a registration in the same tenant collide exactly
        // as two chart reads do.
        lockAuditChain: (tenant) => lockAuditChain(tx, tenant),
      });
    });
}

/**
 * Builds everything the app needs to serve real data.
 *
 * One PrismaClient for the process, because each one owns a connection pool.
 * Repositories get a per-request tenant-scoped view of it, which is what makes
 * tenant isolation a property of the wiring rather than of every handler.
 */
export function buildServerWiring(env: WiringEnv, client?: PrismaClient): ServerWiring {
  const prisma = client ?? createPrismaClient({ datasourceUrl: env.DATABASE_URL });

  // THE RLS PORT, not a bare tenant-scoped client.
  //
  // `createTenantClient` is a Prisma extension: it narrows the queries this
  // process issues. Row-level security is the backstop underneath it, and it
  // only engages inside a transaction that has declared `openrunic.tenant_id` -
  // which is exactly what `createRlsDbPortFactory` does and what a plain client
  // never does. Wiring the plain one meant the design's second line of defence
  // was absent in the only deployment that has a real database, and absent
  // silently: every query worked, because the extension was doing the narrowing
  // on its own.
  //
  // It also fails in the honest direction now. Against a correctly configured
  // non-superuser role, a query that somehow escaped the session returns
  // nothing rather than everything, because the policies deny by default.
  const repositories = createPrismaRepositoryRegistry(createRlsDbPortFactory(prisma));

  const auditSink = createPrismaAuditSink({ standalone: standaloneAuditWork(prisma) });

  return {
    repositories,
    principalResolver: buildPrincipalResolver(env.OPENRUNIC_AUTH_MODE, prisma),
    authMode: env.OPENRUNIC_AUTH_MODE,
    auditSink,
    // `SELECT 1` rather than a real query: readiness must not be expensive, and
    // it must not touch patient data to answer.
    readiness: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
    close: () => prisma.$disconnect(),
  };
}
