/**
 * Database probes for the migrate container's entrypoint.
 *
 * Everything here goes through `@openrunic/database`'s own built client rather
 * than through `pg` directly. That is not a stylistic preference: pnpm's
 * node_modules is isolated, so `pg` is only resolvable from inside the database
 * package, and a `require('pg')` from the repository root fails at runtime with
 * MODULE_NOT_FOUND. Importing the package by absolute path lets Node resolve
 * that package's dependencies from its own tree, which is the one arrangement
 * that works in every stage of the image.
 *
 * Usage:
 *   node docker-migrate-helper.mjs wait [attempts]
 *   node docker-migrate-helper.mjs count-organisations
 *
 * Exit codes are the contract: 0 for success, 1 for "not ready" or "failed", so
 * the calling shell script can branch on them with plain `if`.
 */

const DATABASE_PACKAGE =
  process.env.OPENRUNIC_DATABASE_DIST ?? '/repo/packages/database/dist/index.js';

/** Never let a connection string reach stdout, stderr or a log line. */
function redact(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s'"]*/gi, 'postgresql://<redacted>');
}

async function withClient(run) {
  const { createPrismaClient } = await import(DATABASE_PACKAGE);
  // DIRECT_URL first, matching prisma.config.ts: migrations and these probes
  // must bypass any connection pooler in front of Postgres.
  const datasourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!datasourceUrl) throw new Error('neither DIRECT_URL nor DATABASE_URL is set');

  const client = createPrismaClient({ datasourceUrl });
  try {
    return await run(client);
  } finally {
    await client.$disconnect();
  }
}

/**
 * Blocks until the database answers a real query.
 *
 * compose already gates this container on Postgres's own healthcheck, but that
 * only proves `pg_isready` answered on the socket. This proves the credentials
 * and the database name in the connection string are correct too, which is the
 * failure an operator actually hits on first run after editing .env by hand.
 */
async function waitForDatabase(maxAttempts) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await withClient((client) => client.$queryRaw`SELECT 1`);
      return 0;
    } catch (error) {
      if (attempt === maxAttempts) {
        process.stderr.write(`database never became reachable: ${redact(error)}\n`);
        return 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return 1;
}

/**
 * Prints the number of organisations, which is how the entrypoint decides
 * whether this is a first boot.
 *
 * Any failure is a failure, and none of them is reported as zero. Zero means
 * "this database is empty, seed it", and the seed writes fixed primary keys, so
 * answering zero about a database that is merely unreachable aims a seed at a
 * practice that already has records in it. That run dies on a unique violation
 * and takes the whole boot down with it - after the operator has been told the
 * database looked empty.
 *
 * The entrypoint reads this through a command substitution under `set -e`, so a
 * non-zero exit stops the boot with the reason on stderr, which is the correct
 * outcome for a probe that could not answer.
 */
async function countOrganisations() {
  try {
    const count = await withClient((client) => client.organisation.count());
    process.stdout.write(String(count));
    return 0;
  } catch (error) {
    process.stderr.write(`could not count organisations: ${redact(error)}\n`);
    return 1;
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);

  switch (command) {
    case 'wait': {
      const attempts = Number.parseInt(argument ?? '60', 10);
      return waitForDatabase(Number.isFinite(attempts) && attempts > 0 ? attempts : 60);
    }
    case 'count-organisations':
      return countOrganisations();
    default:
      process.stderr.write(`unknown command: ${String(command)}\n`);
      return 1;
  }
}

process.exitCode = await main();
