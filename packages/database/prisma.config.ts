import { defineConfig } from 'prisma/config';

// The v7 CLI no longer auto-loads .env; Node 22's native loader fills the gap
// locally, while CI passes real environment variables and has no .env file.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env present - fine everywhere that provides real env vars.
}

// DIRECT_URL first: migrate commands go straight at Postgres, bypassing any
// pooler, matching the pre-v7 directUrl semantics.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Omitted entirely when no URL is set so `prisma generate`/`validate` stay
  // usable on a machine with no database configured.
  ...(url
    ? {
        datasource: {
          url,
          ...(process.env.SHADOW_DATABASE_URL
            ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
            : {}),
        },
      }
    : {}),
});
