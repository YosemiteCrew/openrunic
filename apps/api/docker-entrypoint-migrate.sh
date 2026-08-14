#!/bin/sh
# Boot-time schema step for the self-hosted stack.
#
# Runs as its own short-lived container before the API and web containers are
# allowed to start (docker-compose.yml gates them on this exiting successfully).
# Three jobs, in order:
#
#   1. wait until the database answers a real query
#   2. apply every pending migration
#   3. seed the demo practice, but only into an empty database
#
# Idempotent by construction, because `docker compose up` is something an
# operator runs many times against the same volume and it must not fail the
# second time.

set -eu

log() {
  # Timestamped so the compose log reads as a boot sequence rather than a few
  # unattributed lines between two containers' output.
  printf '%s  migrate  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

fail() {
  log "ERROR: $1"
  exit 1
}

HELPER=/repo/apps/api/docker-migrate-helper.mjs

if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is not set. Copy .env.example to .env and fill it in, or run 'pnpm setup:selfhost'."
fi

# ---------------------------------------------------------------------------
# 1. Wait for the database.
# ---------------------------------------------------------------------------
log "waiting for the database"
if ! node "$HELPER" wait "${OPENRUNIC_DB_WAIT_ATTEMPTS:-60}"; then
  fail "the database never became reachable. Check that the postgres service is running and that the credentials in .env are correct."
fi
log "database is reachable"

# ---------------------------------------------------------------------------
# 2. Apply migrations.
#
# `migrate deploy` only applies pending migrations forward and never rewrites
# history. It is the only Prisma migration command that is safe to point at a
# database holding real patient records.
# ---------------------------------------------------------------------------
log "applying migrations"
cd /repo/packages/database
pnpm exec prisma migrate deploy
log "migrations applied"

# ---------------------------------------------------------------------------
# 3. Seed, only into an empty database.
#
# The demo practice is written with fixed primary keys, so a second seed fails
# on a unique violation and would take the whole boot down with it. The check is
# on the Organisation table rather than a marker file, because the Postgres
# volume is the only thing carrying state between runs.
#
# OPENRUNIC_SEED=never is how a real clinic turns the demo data off for good.
# ---------------------------------------------------------------------------
seed_mode="${OPENRUNIC_SEED:-if-empty}"

if [ "$seed_mode" = "never" ]; then
  log "seeding disabled (OPENRUNIC_SEED=never)"
  exit 0
fi

# Not `organisations=$(...)` on its own: a probe that cannot answer must stop
# the boot, not be read as "empty". The seed writes fixed primary keys, so
# seeding a database that already holds a practice dies on a unique violation -
# after the operator has been told the database looked empty.
if ! organisations=$(node "$HELPER" count-organisations); then
  fail "could not read the organisation count, so it is not safe to decide whether to seed. The database was reachable a moment ago; check the compose logs for the reason above."
fi

if [ "$organisations" != "0" ]; then
  log "database already holds ${organisations} organisation(s); not seeding"
  exit 0
fi

log "seeding the demo practice"
node /repo/packages/database/dist/seed/run.js
log "seed complete"
