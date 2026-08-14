# web

The hospital- and patient-facing web app of **openrunic**, an open-source operating system for
human health (AGPL-3.0). Today it is the staff EMR shell plus route skeletons; screens fill in
behind them.

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

## Layout

```text
src/app/<area>/page.tsx          Server component. Metadata only; renders the screen.
src/app/<area>/<Area>Screen.tsx  'use client'. The screen itself.
src/components/shell/            AppShell, TopBar, Breadcrumb, the navigation model
src/components/command/          Cmd-K palette and its registry
src/components/state/            LoadingState, ErrorState, AsyncBoundary, EmptyState re-export
src/lib/api/                     Typed client, hooks, and the mock-mode fixtures
src/lib/format.ts                Clinical formatting: names, MRNs, dates, money, vitals
```

The split between `page.tsx` and `<Area>Screen.tsx` is not optional: `@openrunic/ui` components
use React state, which the `react-server` condition does not provide, so anything that renders one
must be a client component.

Every screen composes from [`@openrunic/ui`](../../packages/ui). Do not fork one of its
components; if a screen needs something the library lacks, compose it here from the primitives and
raise the gap as a proposed library addition in the pull request.

## Data and mock mode

`NEXT_PUBLIC_API_MODE` selects the transport, and **mock is the default**: the live API needs
Postgres, and every screen must render fully in a demo, a test and a design review without one.

```sh
NEXT_PUBLIC_API_MODE=live       # talk to a running apps/api
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

The mock client implements the same contract as the live one, applies the same filters, sorts and
pagination, and fails the same way (an `ApiError` carrying an RFC 9457 problem document). Its
fixtures are deterministic and obviously synthetic: fixed ids, a fixed clinic day
(`MOCK_CLINIC_DAY`), Syntheta-style names, `OR-` MRNs. Never seed them from a real record.

## Sessions

```sh
SESSION_COOKIE_SECRET=   # server-side only; required outside development
```

The session cookie is signed with this key so that the idle timeout and the absolute lifetime
inside it cannot be rewritten by whoever holds the cookie. It is read on the server only and never
reaches the browser bundle, which is why it has no `NEXT_PUBLIC_` prefix.

Outside development it has no default. A deployment without it seals no cookies and recognises
none, so nobody can sign in and `POST /session` answers 503 saying exactly that; in development a
fixed value in `src/lib/auth/seal.ts` keeps a fresh clone runnable. Rotating the key signs out
every open session, which is the intended behaviour.

`src/lib/auth/session.ts` is the written-out reasoning for the whole session design: where the
token lives, what memory-only storage does and does not protect against, and how long a session
lasts. `src/lib/auth/idle.ts` carries the separate decision about what counts as somebody being at
the workstation.

## Assets that are not vendored

Two sets of files are deliberately absent from git, and the app degrades gracefully without them:

- **Fonts.** Bricolage Grotesque and Spline Sans Mono are self-hosted by policy (no third-party
  font CDN on a surface that renders PHI), but the binaries are not committed. Copy the variable
  builds from the design system's `assets/fonts/` into `public/fonts/`, keeping the filenames the
  `@font-face` rules in `src/app/globals.css` expect. Until then the fallback stacks carry the UI
  and only the optical-size axis is lost. Licences: SIL OFL 1.1 for both.
- **Brand marks.** Copy the design system's `assets/logo/` into `public/assets/logo/`. The shell's
  lockup and the empty-state glyph read from there.

## Accessibility floor

WCAG 2.1 AA is a gate, not a retrofit. Every screen keeps: semantic landmarks, a visible 2px
terracotta focus ring on every focusable element, full keyboard operation of the core loop, status
never signalled by colour alone, and no control that exists only on hover. The staff EMR is
desktop-first at 1440 with a 1024 floor and must not break at 768.
