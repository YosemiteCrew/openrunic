# Ops runbook

For openrunic maintainers. The operator-facing guide is
[docs/self-hosting.md](./self-hosting.md); this is the layer underneath it -
how the machinery works, why it is shaped the way it is, and what to do when a
drill goes red.

---

## The shape of the self-host stack

Four services, one of which exits on purpose.

```
postgres ──healthy──▶ migrate ──completed──▶ api ──healthy──▶ web
    (named volume)     (runs once)          (:4000)          (:3000)
```

`migrate` is the interesting one. It is a separate container built from a
separate target of the same Dockerfile, and the API and web containers are gated
on it exiting zero (`service_completed_successfully`). Two consequences worth
keeping:

- **An application container can never come up against a schema older than
  itself.** The gate is structural, not a startup check somebody has to
  remember to write.
- **The migration toolchain is not in the serving image.** `prisma migrate
deploy` needs the Prisma CLI, and the CLI loads `prisma.config.ts`, so it
  needs TypeScript too. None of that belongs in a long-lived process holding
  patient data.

`migrate` is idempotent: it waits for a real query to succeed, applies pending
migrations, and seeds **only into a database with no organisations in it**.
`docker compose up` is something operators run many times against the same
volume, and it must not fail the second time.

### Image sizes and why they are what they are

| Image               | Size    | Notes                                         |
| ------------------- | ------- | --------------------------------------------- |
| `openrunic-api`     | 390 MB  | `node:22-alpine` is 229 MB of that            |
| `openrunic-web`     | 281 MB  | Next.js standalone output                     |
| `openrunic-migrate` | 1.74 GB | the full toolchain, by necessity; short-lived |

Measured on arm64. The migrate image is large and that is the deliberate trade:
it exists so the two long-lived images do not have to carry a compiler and a
migration engine. It runs for a few seconds at boot and then exits.

Two things dominate, and both have a trap attached.

**The API image cannot be pruned with `pnpm install --prod`.** That rewrites
each package's own `node_modules` but does **not** garbage collect
`node_modules/.pnpm`, the virtual store those symlinks point into. Every package
the development install materialised is still there. Measured: 1.29 GB, carrying
Next.js, Storybook, Turbo and the TypeScript compiler into a Hono server that
imports none of them. `pnpm deploy --legacy --prod` writes a genuinely
standalone tree instead, and is what the Dockerfile uses.

**Prisma drags its whole authoring toolchain in through optional peers.**
`@prisma/client` declares `prisma` and `typescript` as optional peer
dependencies. Optional or not, both exist in this workspace, so pnpm resolves
them, and behind them come Prisma Studio's bundled UI, the schema engines, an
embedded Postgres and the compiler - about 215 MB. The Dockerfile deletes them
explicitly, with the list written out and commented.

That deletion is a judgement call, and the thing that keeps it honest is the
install drill: it boots the pruned image against a real Postgres and reads
seeded rows back through the client. A future Prisma release that starts needing
one of those packages fails the drill rather than a clinic.

### The web image

`output: 'standalone'` in `next.config.ts` plus `outputFileTracingRoot` pointed
at the monorepo root. The tracing root matters: pnpm links workspace
dependencies as symlinks into `../../node_modules`, and a trace rooted at
`apps/web` follows them outside its own root and silently drops the files. The
symptom is an image that builds cleanly and fails at runtime on a missing
module.

`NEXT_PUBLIC_*` values are inlined at build time, so the API address and the
transport mode are **build arguments**. There is no runtime environment variable
that can move them. Changing either means `docker compose build web`.

### No BuildKit

Nothing in either Dockerfile uses BuildKit-only syntax - no `RUN --mount`, no
`COPY --link`, no heredocs. Self-hosters run whatever Docker their distribution
shipped, and a build that needs `buildx` is a support ticket on day one.

For the same reason `@openrunic/ops` probes for Compose rather than assuming it:
it tries `docker compose`, falls back to `docker-compose`, and reports both
missing with install instructions. A host can have the plugin directory present
with a dangling symlink in it - an uninstalled Docker Desktop leaves exactly
that, making `docker compose` report "unknown command" while `docker-compose`
works perfectly.

---

## The migration-safety linter

`packages/ops/src/migration-lint`. Run it with `pnpm ops:lint-migrations`.

It replays the whole migration history into a small in-memory schema model, in
the order `migrate deploy` will apply them, and then reports statements that
destroy data or break a version that is currently running.

Replaying the history is what makes it useful rather than noisy. A single
`ALTER COLUMN ... TYPE` statement only carries the destination type, so
narrowing cannot be detected from it alone; the model knows what the column used
to be. The same model knows which tables this migration created, so `NOT NULL`
on a brand-new table is silent while the same statement against an existing
table is reported.

| Rule                       | Fires on                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `drop-table`               | `DROP TABLE` for a table an earlier migration created                                                     |
| `drop-column`              | `ALTER TABLE ... DROP COLUMN` on a pre-existing table                                                     |
| `not-null-without-default` | a `NOT NULL` column added with no default, or `SET NOT NULL` on a column with no default to backfill from |
| `type-narrowing`           | a type change that is not provably a widening                                                             |
| `rename`                   | any `RENAME`, which breaks a running older version instantly                                              |

Widening is a real lattice, not a string comparison: the integer and float
ladders, string length growth, dropping a bound entirely, and numeric precision
where **the integral part must survive too** - `NUMERIC(10,2)` to
`NUMERIC(11,4)` grows the precision and loses a digit before the decimal point,
so it is reported.

Anything the linter cannot prove safe, it reports. A false positive costs a
reviewer thirty seconds; a false negative costs a restore.

**It does not block.** Findings are annotations on the diff. The expand half of
an expand/contract pair is legitimate and necessary; what must not happen is it
shipping without anyone noticing. `--strict` makes findings fail, for a branch
that wants the harder rule.

### When the linter flags your migration

Ask whether the destructive half can wait a release.

- Removing a column: ship the release that stops writing it, let it run
  everywhere, drop it next release.
- Making a column `NOT NULL`: add a `DEFAULT` and backfill in one release, add
  the constraint in the next.
- Changing a type: add a new column, backfill, switch readers, drop the old one
  later.
- Renaming: add the new name, write both, migrate readers, remove the old one.

If it genuinely cannot wait, that is a maintenance-window release. Say so in the
release notes, because `pnpm ops:upgrade` will refuse the live path and the
operator needs to have been warned before they meet that message.

---

## Backup and restore

`pnpm ops:backup` writes a `pg_dump --format=custom` archive and a manifest
beside it. The manifest is the point: exact row counts per table (via
`query_to_xml`, not the planner's `n_live_tup` estimate), the applied migration
list, the archive's SHA-256, and a per-table digest of one patient's entire
chart.

That last one is what separates "the restore ran" from "the chart is the chart".
Row counts prove the right _number_ of rows came back. The digest hashes the
full text form of every row referencing the sample patient, across every table
with a `patientId` column, so a single shifted timestamp or altered character
changes it.

State is read **before** the dump on purpose. The other order can record counts
higher than the archive contains and fail its own verification.

`pnpm ops:verify-backup` restores into a scratch database - never the live one -
and compares all of it. Run it after every backup. In CI it is a required leg.

### Restore drill

```bash
pnpm ops:backup
pnpm ops:verify-backup
docker compose exec -T postgres psql -U openrunic -d postgres \
  -v ON_ERROR_STOP=1 -c 'DROP DATABASE openrunic WITH (FORCE);'
pnpm ops:restore -- --yes
docker compose restart api
```

The budget is fifteen minutes end to end, asserted in CI.

### Object storage

There isn't any yet, and the manifest says so explicitly in an empty
`objectStores` array rather than by omission. Documents currently live in
Postgres, so the dump is complete.

**When a blob store is added, the backup must capture it in the same pass.** A
restore that brings back charts whose attachments are gone is worse than an
obvious failure, because it looks like it worked.

---

## Upgrades

`planUpgrade` in `packages/ops/src/commands/upgrade-plan.ts` is the whole
decision, and it is pure so it can be tested without a cluster. Pending
migrations that are all additive get the zero-downtime path: migrations first,
containers second, old version serving throughout. Any pending destructive
migration forces the maintenance-window path.

A destructive migration that has **already been applied** does not force a
window. Its risk is spent; holding a later upgrade for it would be superstition.

Migrations run before containers are replaced. If they fail, the previous
containers are still running and still serving, and nothing has been swapped.

### What each flag does

`pnpm ops:upgrade` on its own is a **dry run**. It runs every pre-flight check,
prints the plan, prints anything that failed, applies nothing and exits 0. That
is the whole contract, and it holds no matter what the checks said: the command
an operator reaches for when they are unsure has to be the one that cannot do
anything.

`--apply` is the only flag that applies an upgrade. A failed check stops an
`--apply` run before the first migration; `--apply --force` is the deliberate
override and is recorded in the output as such. `--force` on its own changes
nothing, because a run without `--apply` is still a dry run.

`decideUpgrade` in `packages/ops/src/commands/upgrade.ts` is that ordering, kept
separate from the command that prints it so it can be tested - including the
case where the checks failed and the operator did not ask to apply.

### When the plan is destructive

`path: maintenance-window` means at least one pending migration removes or
narrows something the running version still reads. There is no ordering of this
upgrade that keeps serving through it, so the window is not a preference.

```bash
pnpm ops:backup && pnpm ops:verify-backup   # do not skip the verify
docker compose stop web api                 # traffic stops before the schema moves
pnpm ops:upgrade -- --apply --force         # --force: the plan is knowingly destructive
docker compose up -d --wait api web         # new containers on the new schema
```

Step 3 needs `--force` because the `migration safety` check fails for exactly
this plan, and it keeps failing once the containers are stopped: stopping them
is what makes the window safe, not what makes the migration additive. The check
is reporting the SQL, not the traffic.

**If step 3 fails**, the database is the thing to fix and the containers are
already down, so nothing is serving a half-migrated schema. Restore the backup
from step 1 (`pnpm ops:restore -- --yes`), bring the previous release's
containers back up, and take the failure to the release notes before trying
again.

Do this outside clinic hours. The release notes say when a window is needed;
`pnpm ops:upgrade` says so too, before anything is applied.

---

## The full-day clinical drill

`apps/e2e`. This is the acceptance test for the product: book, check in, room,
chart, sign, order, result, charge, claim, remit, pay, check out, audit.

It runs the web application in **mock mode**, so it needs no database, no API and
no seed, which is what lets it gate every pull request instead of running
nightly. Axe runs on every screen it visits, at 1440, 768 and 375 pixels wide -
and below 1024 the navigation rail collapses behind a Menu button and becomes a
dialog, so the narrow projects exercise a genuinely different shell.

### Two limits of mock mode, and why they are written into the spec

Both were established by reading the mock layer, not by assumption, and both are
recorded in the header of `clinical-day.spec.ts`.

**Nothing persists.** Every screen holds its writes in component state. The mock
client says so itself: _"a fixture that accepts writes teaches screens to trust
state the server never saw."_ An appointment booked in step 1 is not visible in
step 2. So the drill is thirteen scenarios rather than one session, plus the two
chains that genuinely do survive within a single screen - the flow board, and
the billing workbench.

**The audit trail is a static fixture.** Signing a note in mock mode appends
nothing, and there is no `APPOINTMENT_BOOK`, `CHECK_IN` or `PAYMENT` action in
the enum at all. So the audit step asserts what is true and useful - that the
compliance record renders and carries the clinical actions the day is made of -
and does not claim to prove the steps above wrote to it.

Proving _that_ needs the live API against a seeded database, and is the natural
next piece of work: the same spec, pointed at a compose-booted stack, with the
audit assertions upgraded from "these actions exist" to "these actions were
caused by the steps above".

**Step 10 is not "post a remittance".** There is no posting control anywhere on
that screen, deliberately - remittances arrive through the clearinghouse adapter
and post themselves, so no file is ever handled by a human. The human act that
remains is dispositioning the exception lines auto-posting could not resolve,
and that is what the drill does.

### Route guard

`apps/e2e/scripts/run-drill.mjs` checks that all eleven clinical routes exist
before running. When they do not, it prints a loud "DID NOT RUN" block and exits
zero, so a branch with nothing to drill does not fail on it - and the drill turns
itself on the moment those screens merge, with nobody having to remember.

If you see that block in a CI log on a branch that _should_ have the screens,
the route list in that script has drifted from the app.

---

## CI

`.github/workflows/_ops.yaml`, called from `ci.yaml`, four legs:

| Leg                | Runs               | Budget           |
| ------------------ | ------------------ | ---------------- |
| Migration safety   | always, cheap      | -                |
| Full-day drill     | always             | 30 min           |
| Install drill      | always, cold cache | 30 min, asserted |
| Backup and restore | always             | 15 min, asserted |

The install and backup legs are by far the slowest in the pipeline. That is a
deliberate trade: the claims they check are ones a clinic otherwise discovers at
the worst possible time.

The upgrade gate rides on those two legs rather than getting one of its own: the
install leg has rows and no backup, so `pnpm ops:upgrade` must refuse to apply
and must still exit 0 as a dry run; the backup leg has a verified backup, so the
same command must come back clean. Both assert the exit code, because a gate that
turns the safe command into a refusal is a regression a passing drill cannot see.

The budgets are asserted, not just measured. If a change makes the install take
thirty-one minutes, CI says so rather than letting the documentation quietly
become false.

Conventions, matching the rest of `.github/workflows`: every action pinned to a
full SHA with a trailing version comment, `permissions: contents: read` at the
top, `persist-credentials: false` on every checkout, and no `secrets: inherit`.

---

## Downtime mode

`apps/web/src/lib/downtime` and `apps/web/src/components/downtime`. Three
states, because they need three different messages: `online`, `degraded` (the
server is up, the database is not) and `offline` (nothing answers).

Two design decisions here were both found by running it, not by reading it.

**The probe is same-origin.** The browser must not fetch the API directly: it is
a different origin, it sends no CORS headers, and a request the browser blocks is
indistinguishable from a server that is down. The first version did exactly that
and produced a permanent "cannot reach openrunic" banner on a completely healthy
stack - the worst possible failure, because a banner that is always on is one
staff stop reading. `/api/health` is a Next route handler that makes the check
server-side, inside the network, by service name.

**Readiness, not liveness.** `/healthz` proves the API process is running, and a
process whose database has gone is running perfectly while unable to answer a
single clinical question. Probing it reported a database outage as healthy.
`/readyz` runs `SELECT 1` and answers 503 when it fails, so the outage is visible
to the web application _and_ to the container runtime - the API's Docker
healthcheck reads `/readyz` for the same reason.

Both endpoints are in `DEFAULT_PUBLIC_PATHS`. A healthcheck has no credentials
and never will; an authenticated readiness probe answers 401 forever, the
container never turns healthy, and nothing depending on it starts. That was the
third bug this sequence found.

The health route distinguishes the two failures by status code, and the
distinction carries the whole message: **503** means the API answered and cannot
serve (database outage, "records cannot be saved"), **502** means the API did not
answer at all (total outage, "cannot reach openrunic"). Collapsing both into 503
makes the banner say "read-only" during a total outage, which is wrong.

Verified live against the compose stack in all four states: healthy (no banner),
`docker compose stop postgres` (degraded), `docker compose stop api` (offline),
and recovery (banner clears by itself).

---

## What the ops CLI is allowed to read

`openrunic-ops` reads and writes files the operator names. That is the job:
`restore` exists to be pointed at an archive carried in from a different machine.
So "this path came from an argument" is the design, and the useful question is
not whether a path is a variable but where the value came from. There are four
sources, and they are the whole list:

1. **Constants derived from where the code is installed.** `docker-compose.yml`
   and `packages/database/prisma/migrations`, both resolved from the CLI's own
   module path in `packages/ops/src/cli.ts`.
2. **`.env` beside the compose file.** `OPENRUNIC_BACKUP_DIR` is resolved against
   the repository root, so an absolute value wins. That is deliberate - backups
   belong on a different disk - and the file is the operator's own, held at mode
   0600 by `ensureEnvFile` on every run.
3. **Arguments the operator typed**: the manifest path for `verify-backup` and
   `restore`, `--dir` for `lint-migrations`.
4. **A field inside a backup manifest**: `archive`.

Only the fourth crosses a trust boundary. A manifest is a file from somewhere
else by the time it is read - another disk, removable media, a rebuilt server -
and the restore turns that field into a path. `readManifest` therefore holds it
to a plain filename beside the manifest: not absolute, no separator of either
platform's kind, not `.` or `..`. `commands/manifest.test.ts` is that boundary,
nine cases of it, including `../../etc/passwd` and a Windows-separated climb.

The first three are the operator, on their own machine, in a shell they already
have. Constraining those would not remove an ability they lack; it would only
break restoring a backup that lives somewhere else.

Two related properties, since they are what make the above sufficient: nothing in
this package runs through a shell (`shell: false` on every spawn in
`process/run.ts` and `db/postgres.ts`, and no string form anywhere), and the two
values that reach SQL text rather than a bind parameter - a database name and a
sample patient id - are held to `SAFE_IDENTIFIER` and a UUID pattern in
`db/postgres.ts`.

### The scanner's file-inclusion findings

The SAST scanner in CI reports "potential file inclusion attack via reading file"
against this package, once per call that opens a path held in a variable. Every
one of them was reviewed against the list above before being accepted, and the
finding it would have to be for one of them to be real is: a path that reaches
the filesystem from somewhere other than those four sources, or a manifest field
that gets there without passing `readManifest`.

**This reasoning expires** if `openrunic-ops` ever gains an entry point that is
not a local operator - an HTTP trigger, a daemon, a job that takes its arguments
from a queue - or if a fifth path source appears. Either of those changes who
supplies the value, which is the only thing this rests on, so the review has to
be redone rather than the finding re-ignored.

---

## Known gaps

Written down because a gap nobody has named is a gap nobody will close.

**Authentication has to be configured, and it is silent about being absent in
exactly one direction.** With the OIDC variables set, the API verifies every
bearer token against the provider's published key set and the web app redirects
staff there to sign in. Without them, `OPENRUNIC_AUTH_MODE=demo-tokens` maps
published tokens onto seeded users. That variable has no default, so a
deployment cannot arrive there by accident, and the API prints a banner naming
itself unauthenticated on every boot.

A half-set OIDC configuration does not fall back: `envSchema` refuses to start
with two of the three variables present, saying they must be set together or
not at all. So the failure mode to watch for is not a typo in a value, which
fails at the first token, but a deployment that never set them and nobody
noticed. The boot banner is what says so.

**The demo tenant id was not the seeded tenant id.** `DEMO_PRINCIPALS` in
`apps/api/src/auth/static-resolver.ts` hardcodes a tenant id; the seed mints its
own from a fixed UUIDv7 clock. They are different values, so a stack wired to the
static table authenticates fine and then shows an empty practice - healthy,
and empty. `apps/api/src/server/demo-principals.ts` closes this from the
deployment side by looking the organisation up by slug. **When real
authentication lands, the fixture table and the seed should be reconciled at the
source** and this resolver deleted.

**`NEEDS_PRISMA` in `scripts/ci/affected-matrix.mjs` does not include `api`,**
though `apps/api` now depends on `@openrunic/database`. Its own comment
anticipates this. Jobs for the `api` workspace do not run `prisma generate`.

**No object storage in the backup path.** See above. This becomes a data-loss
bug the day attachments move out of Postgres.

**The install budget is measured on one machine shape.** Almost all of it is
compilation. Publishing pre-built images would take the first run from tens of
minutes to about one, and is the obvious next improvement to the operator
experience.
