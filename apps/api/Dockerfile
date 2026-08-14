# openrunic API image.
#
# Build context is the REPOSITORY ROOT, not this directory, because the API is a
# workspace in a pnpm monorepo and needs the root lockfile plus two workspace
# packages (@openrunic/database, @openrunic/fhir) to build:
#
#   docker build -f apps/api/Dockerfile -t openrunic-api .
#
# Three published targets:
#   runtime  (default) the API server. Pruned to production dependencies.
#   migrate            the schema tool. Carries the Prisma CLI and the
#                      migration history, runs once at boot, then exits.
#
# No BuildKit-only syntax anywhere in this file (no RUN --mount, no COPY --link,
# no heredocs). Self-hosters run whatever Docker their distribution shipped, and
# a build that needs buildx is a support ticket on day one.

# Pinned by digest, not by tag alone. `node:22-alpine` is a moving target: it
# is republished on every 22.x patch, so two builds of the same commit can pick
# up different base images, and anyone who can push that tag chooses what runs
# in a clinic. The digest makes the base image part of the commit, the same way
# every GitHub Action in .github/workflows is pinned to a SHA.
#
# The tag is kept beside the digest because it is the only human-readable part;
# the digest alone says nothing about which Node this is. A digest goes stale by
# design - it stops tracking security patches - so this is bumped deliberately,
# by re-resolving the tag, rather than drifting on its own.
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# ---------------------------------------------------------------------------
# base - toolchain only, shared by every downstream stage.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base

# corepack activates the pnpm version pinned in the root package.json's
# `packageManager` field, so the image can never build with a different pnpm
# than the lockfile was written by.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    # The root package.json runs `husky` on prepare. There is no .git in the
    # build context (.dockerignore excludes it), so husky would fail the
    # install; HUSKY=0 is the documented way to turn it off.
    HUSKY=0
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# fetch - populate the pnpm store from the lockfile alone.
#
# This is the layer that makes rebuilds cheap. `pnpm fetch` reads only the
# lockfile, so editing application source never invalidates it; only a
# dependency change does.
# ---------------------------------------------------------------------------
FROM base AS fetch

# pnpm-workspace.yaml carries onlyBuiltDependencies and the security overrides,
# and package.json carries the pinned packageManager. All three belong to the
# dependency identity, so all three are copied before the fetch.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

# ---------------------------------------------------------------------------
# build - compile the API and the workspace packages it imports.
# ---------------------------------------------------------------------------
FROM fetch AS build

COPY . .

# --offline is the proof that the fetch layer was complete: if anything is
# missing from the store the build fails here rather than silently reaching the
# network and resolving a version the lockfile never saw.
RUN pnpm install --frozen-lockfile --offline

# The Prisma client is generated, never committed. Generating it inside the
# image is also what keeps the engine matched to the image's platform and libc
# rather than to whatever the developer's laptop is.
RUN pnpm --filter @openrunic/database exec prisma generate

# `api...` is turbo's "this package and its dependencies" selector, so the two
# workspace packages build in dependency order without naming them here.
RUN pnpm exec turbo run build --filter=api...

# ---------------------------------------------------------------------------
# migrate - schema management, run once at boot and then gone.
#
# Kept as its own target rather than folded into the runtime image on purpose:
# `prisma migrate deploy` needs the Prisma CLI and the full migration history,
# and neither belongs in a long-lived process that serves patient data. The
# runtime image below therefore has no migration tooling in it at all.
# ---------------------------------------------------------------------------
FROM build AS migrate

# This stage keeps the development dependencies on purpose. `prisma migrate
# deploy` needs the Prisma CLI, and the CLI loads prisma.config.ts - a
# TypeScript file - so TypeScript has to be present too. That is why the
# migration tooling is a separate image from the server rather than a few extra
# files inside it.
#
# No `chown -R /repo`: the tree is world-readable already, and recursively
# chowning a full development install would add a duplicate copy of every file
# as a new layer. The container only reads /repo; the one directory it writes
# is HOME, which is created for it below.
COPY apps/api/docker-entrypoint-migrate.sh /usr/local/bin/openrunic-migrate
RUN chmod 0755 /usr/local/bin/openrunic-migrate \
    && addgroup -g 10001 -S openrunic \
    && adduser -u 10001 -S -G openrunic -h /home/openrunic openrunic \
    && mkdir -p /home/openrunic \
    && chown openrunic:openrunic /home/openrunic

ENV HOME=/home/openrunic
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/openrunic-migrate"]

# ---------------------------------------------------------------------------
# prune - assemble the production tree in a stage that never saw a dev install.
#
# The obvious approach - re-run install with --prod on top of the build stage -
# does not work, and fails quietly rather than loudly. `pnpm install --prod
# --filter` rewrites each package's own node_modules, but it does NOT garbage
# collect node_modules/.pnpm, the virtual store every one of those symlinks
# points into. The store still holds all 807 packages the full install
# materialised, so copying the tree carries Next.js, Storybook, Turbo, sharp and
# the TypeScript compiler into a server image that imports none of them. That
# route measured 1.29 GB.
#
# So this stage starts from `fetch`, which has the populated content-addressable
# store but an empty virtual store, and installs production dependencies only.
# Nothing else can be present, because nothing else was ever written here.
# ---------------------------------------------------------------------------
FROM build AS prune

# `pnpm deploy` is the only thing that produces a genuinely standalone tree.
# `pnpm install --prod --filter` does not: it rewrites each package's own
# node_modules but never garbage collects node_modules/.pnpm, the virtual store
# those symlinks point into, so all 807 packages of the development install
# survive and the image measured 1.29 GB. deploy writes a fresh tree containing
# only the selected project's production closure - 172 packages.
#
# --legacy is required by pnpm 10, which otherwise refuses to deploy from a
# workspace that has not opted into injected dependencies.
RUN pnpm --filter=api --prod --legacy deploy /out

# Strip Prisma's optional peer graph.
#
# @prisma/client declares `prisma` (the CLI) and `typescript` as OPTIONAL PEER
# dependencies. Optional or not, both are present in this workspace, so pnpm
# resolves them and the deploy drags in the entire authoring toolchain behind
# them: the CLI, Prisma Studio's bundled UI (React, elkjs), the schema engines,
# an embedded Postgres for `prisma dev`, and the TypeScript compiler. That is
# ~215 MB of tooling in a process whose only Prisma surface is
# `new PrismaClient({ adapter })` and a query.
#
# Deleting them is safe because the generated client talks to Postgres through
# @prisma/adapter-pg and a WebAssembly query compiler that ships inside
# @prisma/client/runtime; none of these packages is on that path. "Safe" here is
# not an assertion - the compose smoke drill boots this image against a real
# Postgres and reads seeded rows through this client, so a future Prisma release
# that starts needing one of them fails the drill instead of failing a clinic.
WORKDIR /out/node_modules/.pnpm
RUN rm -rf prisma@* @prisma+studio-core@* @prisma+dev@* @prisma+engines@* \
           @prisma+get-platform@* @electric-sql+pglite@* effect@* elkjs@* \
           typescript@* react-dom@* react@*

WORKDIR /out
RUN find node_modules -name '*.d.ts' -delete \
    && find node_modules -name '*.d.mts' -delete \
    && find node_modules -name '*.map' -delete \
    && find . -name '*.tsbuildinfo' -delete \
    && rm -rf src __tests__ eslint.config.mjs vitest.config.mts sonar-project.properties \
              tsconfig.json tsconfig.build.json

# ---------------------------------------------------------------------------
# runtime - what actually serves traffic.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    PORT=4000

# Strip the package manager out of the runtime.
#
# This stage runs one command - `node` on a built bundle - and never installs
# anything. npm ships inside the Node image with its own vendored dependency
# tree (tar, sigstore, ip-address, brace-expansion, picomatch), and those carry
# advisories that have nothing to do with this application: they are not in our
# lockfile, they are not reachable from our code, and no change to package.json
# can fix them. The container scan reads the whole filesystem, so it reported
# them as vulnerabilities in an image serving patient data, which is technically
# accurate and exactly the sort of finding that trains people to ignore scanners.
#
# Deleting it answers the finding honestly rather than muting it, and a runtime
# with no package manager is a runtime an attacker cannot install anything into.
# corepack goes for the same reason: nothing here resolves a package manager.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && ! command -v npm

# A fixed high uid/gid rather than an auto-assigned one: the number is what a
# bind-mounted host directory has to be owned by, so it has to be stable and
# documented (docs/self-hosting.md quotes it).
RUN addgroup -g 10001 -S openrunic \
    && adduser -u 10001 -S -G openrunic -h /home/openrunic openrunic

WORKDIR /app
COPY --from=prune --chown=openrunic:openrunic /out /app

USER 10001:10001
EXPOSE 4000

# Readiness, not liveness. `/healthz` only proves the process is running, and a
# process whose database has gone is running perfectly while answering nothing.
# Checking /readyz means a database outage shows up as an unhealthy container
# instead of a green one. No curl or wget dependency: node is already here.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
