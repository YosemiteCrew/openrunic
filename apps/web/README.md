# web

The hospital- and patient-facing web app of **openrunic**, an open-source operating system for
human health (AGPL-3.0). It is a minimal Next.js App Router skeleton today and will grow into the
UI for a modern, lightweight EMR.

## Running within the monorepo

Install dependencies from the repository root, then use pnpm filters (or `turbo run <task>`):

```sh
pnpm install
pnpm --filter web dev        # start the dev server
pnpm --filter web build      # production build
pnpm --filter web lint       # ESLint (flat config)
pnpm --filter web type-check # tsc --noEmit against the strict base config
pnpm --filter web test       # Vitest with istanbul coverage
```

Coverage output lands in `coverage/` (`coverage-final.json` is the file CI merges across shards).
