import { createPrismaClient, createTenantClient, type PrismaClient } from '@openrunic/database';
import { z } from 'zod';

import { createPrismaAuditSink, type AuditWriteScope } from '../audit/prisma-sink.js';
import type { AuditSink } from '../audit/types.js';
import type { PrincipalResolver } from '../auth/principal.js';
import { createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import { createDbPort } from '../repositories/db-port.js';
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
 * Resolves bearer tokens to principals.
 *
 * The one supported mode is the demo table, and choosing it is shouted about on
 * every boot. That warning is the product of a deliberate decision: the API can
 * run self-hosted today, before an identity provider exists, but nobody should
 * be able to reach that state without having been told, in the boot log, that
 * the deployment has no authentication.
 */
function buildPrincipalResolver(
  mode: WiringEnv['OPENRUNIC_AUTH_MODE'],
  client: PrismaClient
): PrincipalResolver {
  process.stderr.write(
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
  // Bound to the seeded tenant, not to the fixture tenant id. See
  // demo-principals.ts: the two are different values, and using the fixture one
  // authenticates fine and then shows an empty practice.
  return createDemoPrincipalResolver(client);
}

/**
 * The audit sink's fallback write path, for events with no transaction of their
 * own: an authorisation denial, or a batch of reads.
 *
 * The unscoped client on purpose - every audit event carries its own tenantId
 * into the row, and a denial has to be recorded even when no tenant transaction
 * was ever opened.
 *
 * Written as an explicit adapter rather than a cast. `PrismaClient.auditEvent`
 * is not assignable to `AuditEventDelegate`: Prisma's generated methods are
 * generic over the argument so the result type can be narrowed by `select`,
 * and the port deliberately is not. Narrowing the results here keeps the port's
 * promise honest - the sink is handed exactly the two fields it declares it
 * needs, and nothing about the caller's shape is asserted.
 */
function standaloneAuditScope(prisma: PrismaClient): AuditWriteScope {
  return {
    auditEvent: {
      create: async (args) => {
        const created = await prisma.auditEvent.create({ ...args, select: { id: true } });
        return { id: created.id };
      },
      findFirst: async (args) => {
        const row = await prisma.auditEvent.findFirst({
          ...args,
          select: { seq: true, hash: true },
        });
        return row === null ? null : { seq: row.seq, hash: row.hash };
      },
    },
  };
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

  // `createDbPort` is not optional plumbing: the registry wants the port's
  // generic `model(name)` accessor, and a tenant-scoped client is still keyed by
  // model name. Handing the raw client over compiles only because both are
  // structurally close, and fails at the first delegate lookup.
  const repositories = createPrismaRepositoryRegistry((tenantId) =>
    createDbPort(createTenantClient(prisma, { tenantId }))
  );

  const auditSink = createPrismaAuditSink({ standalone: standaloneAuditScope(prisma) });

  return {
    repositories,
    principalResolver: buildPrincipalResolver(env.OPENRUNIC_AUTH_MODE, prisma),
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
