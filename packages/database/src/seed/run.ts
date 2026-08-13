import { createPrismaClient } from '../client.js';
import { seedDemoPractice } from './index.js';

/**
 * `pnpm --filter @openrunic/database run db:seed`
 *
 * Writes the synthetic demo practice into `DATABASE_URL`. Safe to run against a
 * development database and against the demo environment; it is not safe to run
 * against anything holding real data, which is why it refuses to run when
 * `NODE_ENV` is `production` unless `OPENRUNIC_SEED_FORCE` is set.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.OPENRUNIC_SEED_FORCE) {
    throw new Error(
      'Refusing to seed with NODE_ENV=production. Set OPENRUNIC_SEED_FORCE=1 if this is a demo environment.'
    );
  }

  const client = createPrismaClient();
  try {
    const summary = await seedDemoPractice(client);
    const total = Object.values(summary).reduce((sum, count) => sum + count, 0);
    process.stdout.write(`Seeded ${total} rows across ${Object.keys(summary).length} tables\n`);
    for (const [table, count] of Object.entries(summary)) {
      process.stdout.write(`  ${table.padEnd(28)} ${count}\n`);
    }
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
});
