#!/bin/sh
# Creates the role the API connects as, which is NOT the role that owns the
# schema.
#
# Row-level security is this deployment's last line of tenant isolation, and it
# has one property that decides where it can run: a SUPERUSER bypasses every
# policy, silently and completely. The official Postgres image's POSTGRES_USER
# is a superuser created by initdb, so an API pointed at it works perfectly and
# proves nothing - every query returns the right rows because the application
# narrowed them, and the backstop underneath was never asked.
#
# So the API gets its own login role. It is not a superuser, does not hold
# BYPASSRLS, and does not own the tables, so every policy applies to it - and
# the migrations set FORCE ROW LEVEL SECURITY, so they would apply even if it
# did. A query that reaches Postgres without declaring `openrunic.tenant_id`
# then returns nothing rather than everything, which is the direction this
# failure should go.
#
# Only CREATE ROLE is here. The privileges are granted by section 4 of
# 20260813120000_row_level_security, which runs as the owner during `migrate`,
# refuses a role holding SUPERUSER or BYPASSRLS, and attaches default privileges
# so a table added by a later migration needs no second grant. Doing it there
# rather than here means one description of what this role may do, in the place
# that also creates the policies it is subject to.
#
# `migrate` keeps the owner: it creates tables, and this role must not be able
# to.
#
# This runs once, at initdb, on an empty data directory. A deployment upgrading
# an existing volume creates the role by hand; packages/database/README.md and
# docs/self-hosting.md both carry the statement.
set -eu

: "${POSTGRES_DB:?required. docker-compose.yml supplies it.}"
: "${OPENRUNIC_DB_APP_USER:?required. See .env.example, or run pnpm setup:selfhost.}"

# Deliberately no message on this one, so the shell's own "parameter null or not
# set" is what prints. Text after `:?` reads to a secret scanner as the value of
# the name in front of it, and a name ending in PASSWORD followed by a sentence
# is exactly the shape of a hardcoded credential. GitGuardian flagged this line
# for that reason and was right to look. The variable name is in the message the
# shell prints anyway, which is the part an operator needs; .env.example carries
# the rest.
: "${OPENRUNIC_DB_APP_PASSWORD:?}"

# The password is read by psql from the environment it already inherits, with
# `\getenv`, rather than passed on the command line.
#
# Two reasons, and the second is the one that matters. A `--set name=value`
# argument lands in the process's argv, which is world-readable through /proc on
# most hosts, so for as long as this script runs the database password is legible
# to anything else on the box. And the heredoc is quoted, so the shell expands
# nothing inside it and a password containing a quote, a dollar or a backslash is
# a value rather than syntax.
#
# `format(%I/%L)` then quotes the identifier and the literal the way Postgres
# itself would, so neither can carry SQL either.
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv approle OPENRUNIC_DB_APP_USER
\getenv appsecret OPENRUNIC_DB_APP_PASSWORD

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT',
  :'approle', :'appsecret')
\gexec

-- Connect and nothing else. Every table privilege comes from the migration.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'approle')
\gexec
SQL
