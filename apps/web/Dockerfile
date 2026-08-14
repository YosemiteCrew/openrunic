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
ENV NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
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
