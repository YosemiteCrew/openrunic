import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  /** Overrides `DATABASE_URL` from the environment. */
  datasourceUrl?: string;
  /** Prisma log levels to enable, e.g. `['warn', 'error']`. */
  log?: ('query' | 'info' | 'warn' | 'error')[];
}

/**
 * Creates a PrismaClient connected to `DATABASE_URL`.
 *
 * Deliberately a lazy factory: nothing is read from the environment and no
 * client is constructed at import time, so importing this package never
 * requires a configured database. Call it once per process and share the
 * instance — each client owns a connection pool.
 */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.datasourceUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '@openrunic/database: DATABASE_URL is not set. Copy .env.example to .env and fill it in, or pass { datasourceUrl }.'
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    ...(options.log ? { log: options.log } : {}),
  });
}
