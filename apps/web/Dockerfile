# openrunic web image.
#
# Build context is the REPOSITORY ROOT:
#
#   docker build -f apps/web/Dockerfile -t openrunic-web .
#
# Next.js inlines every NEXT_PUBLIC_* value at build time, so the API address
# and the transport mode are build arguments. Changing either one requires a
# rebuild; there is no runtime environment variable that can move them.
#
# No BuildKit-only syntax: this has to build on whatever Docker the operator's
# distribution shipped.

# Pinned by digest for the reasons written out in apps/api/Dockerfile: the tag
# moves on every 22.x patch, and the base image should be part of the commit.
# Keep the two files on the same digest - they share a build and there is no
# reason for the API and the web app to run different Node images.
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    HUSKY=0
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# fetch - lockfile-only dependency layer, invalidated only by a dependency
# change and not by editing a component.
# ---------------------------------------------------------------------------
FROM base AS fetch
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM fetch AS build

ARG NEXT_PUBLIC_API_MODE=live
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
# Off, and given a value rather than left unset on purpose. Next inlines a
# NEXT_PUBLIC_* that has a build-time value and leaves the expression to read
# process.env when it does not, so an image built with no value at all could be
# turned into a demonstration by an environment variable at run time. Baking
# `false` in is what makes the header comment above true of this one too: it
# takes a rebuild to move it. See docs/demo.md.
ARG NEXT_PUBLIC_DEMO_MODE=false
ENV NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY . .
RUN pnpm install --frozen-lockfile --offline

# `public/` is optional in Next and this repository does not always have one.
# Creating it here means the COPY in the runtime stage has something to copy
# rather than failing the build on a missing path.
RUN mkdir -p apps/web/public

# `web...` builds the workspace packages web imports before web itself.
RUN pnpm exec turbo run build --filter=web...

# ---------------------------------------------------------------------------
# runtime
#
# Three copies, and the order matters. `standalone` carries the server and its
# traced node_modules but deliberately excludes the static assets and public
# files, because a real deployment usually serves those from a CDN. Self-hosted
# clinics have no CDN, so both are copied back in.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Next's standalone server binds 127.0.0.1 unless told otherwise, which
    # inside a container means nothing outside it can ever connect.
    HOSTNAME=0.0.0.0

# Take Alpine's current openssl before anything else runs.
#
# CVE-2026-14456 is a high-severity flaw in libssl3/libcrypto3. Alpine shipped
# the fix as 3.5.8-r0; the Node image still carries 3.5.7-r0 because it has not
# been rebuilt since. Re-resolving the tag above does not help - the digest
# pinned there already IS the current node:22-alpine, so there is nothing newer
# to bump to. The patch exists in the package repository and not yet in the
# image, which is the one case the digest comment's "bump it deliberately"
# answer cannot reach.
#
# This upgrades every apk package rather than naming the two. A named list is a
# second place to maintain and it goes stale silently: the next Alpine advisory
# lands and this line still says libssl3. Pinning a version is worse again,
# because Alpine drops superseded versions from the index and the build starts
# failing the day 3.5.8-r0 is replaced.
#
# The cost is that the OS package set is no longer byte-for-byte reproducible
# from the digest alone: two builds of this commit a month apart can differ.
# That is a real trade against what the digest is for, and it is the right way
# round for an image serving patient data - a reproducible build of a known-
# vulnerable openssl is not the property worth keeping.
RUN apk --no-cache upgrade

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

RUN addgroup -g 10001 -S openrunic \
    && adduser -u 10001 -S -G openrunic -h /home/openrunic openrunic

WORKDIR /app

COPY --from=build --chown=openrunic:openrunic /repo/apps/web/.next/standalone ./
COPY --from=build --chown=openrunic:openrunic /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=openrunic:openrunic /repo/apps/web/public ./apps/web/public

USER 10001:10001
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# The tracing root is the monorepo root, so the server lands at the path it
# occupies in the repository rather than at the root of the output.
CMD ["node", "apps/web/server.js"]
