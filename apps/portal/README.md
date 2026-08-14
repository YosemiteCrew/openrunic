# portal

The openrunic patient portal: what a patient sees of their own care. Next.js 16, React 19,
built on `@openrunic/ui`.

Six sections, each a route: home, health record, messages, appointments, forms and bills.
A seventh, the assistant, exists only where a practice configured one. The same API as the
practice EMR sits behind it, read as a **patient** principal rather than as staff, so no
request the portal can make carries a patient id the client chose.

```bash
pnpm --filter portal dev          # http://localhost:3300
pnpm --filter portal lint
pnpm --filter portal type-check
pnpm --filter portal test         # vitest + coverage floors
pnpm --filter portal build
```

## Mock mode

Mock mode is the default, so the portal renders, builds and tests with no database and no
API running. Fixtures live in `src/lib/api/fixtures.ts` and are deterministic: fixed dates,
fixed ids and invented identities only. A session behaves like a real account - a sent
message stays in its thread, a cancelled appointment moves to the past list, a paid
statement clears its balance - but nothing is persisted.

| Variable               | Default | Effect                                          |
| ---------------------- | ------- | ----------------------------------------------- |
| `NEXT_PUBLIC_API_MODE` | `mock`  | `live` talks to the API; anything else is mock. |
| `NEXT_PUBLIC_API_URL`  | (none)  | API origin, used only in live mode.             |

Anything other than the exact string `live` resolves to mock. A typo must never be the
thing that puts a real record on screen.

## Layout

Mobile-first, one `<nav>` in the DOM at every width:

| Width    | Navigation                      |
| -------- | ------------------------------- |
| < 768px  | Fixed bottom tab bar            |
| ≥ 768px  | Horizontal strip under the head |
| ≥ 1024px | Persistent left rail            |

Rendering a separate navigation per breakpoint would put the same six links in the
accessibility tree three times, so the layout changes and the markup does not. Content is
capped at `--content-max` (1120px) and no touch target goes below 44px.

## The stylesheet

`@openrunic/ui` is consumed the way its README prescribes: as one **served** stylesheet,
not a bundler import. Its `@font-face` rules point at font binaries the package
deliberately does not ship, and a bundler asked to resolve those URLs fails the build.
`scripts/copy-ui-styles.mjs` copies it into `public/` on dev and build, and the layout
links it.

Typography degrades to the system stacks until the six OFL font files are dropped into
`public/fonts/`. Nothing breaks without them; the only loss is the variable optical-size
axis.

## The assistant

Off unless a deployer configured an inference endpoint, and decided in
[ADR-0006](../../docs/adr/0006-patient-agent-surface.md). There is no build flag for it: the
portal asks the API once per app load, and treats every answer other than a clear yes - a
404, a 401, a 500, a dead socket, a body it cannot read - as no assistant.

- While the probe is in flight, `/assistant` renders **nothing**. No spinner and no
  skeleton: guessing present would flash a working assistant at a practice that has none,
  and guessing absent would answer 404 on every first load of a practice that has one.
- Once the probe settles as absent, `/assistant` is a **404** and the navigation has its
  usual six entries. There is no disabled tab and no page explaining what is missing.
- It can reach three read capabilities, all bound to the reader's own chart: their health
  record, their appointments and their bills. It cannot write anything, cannot interpret a
  result, and cannot show an answer whose records did not arrive with it.
- When the honest answer is "ask your care team", it says so and links to the messages
  screen. A question that asks for a judgement rather than for a record is answered here and
  never sent anywhere.

In mock mode there is no API to ask, so the answer is no assistant without a request. That
is why the default demo has six sections.

## Conventions

- **Two files per route.** A server `page.tsx` holding metadata, plus a `'use client'`
  screen. `@openrunic/ui` ships no `'use client'` directive, so a server component that
  imported one of its components directly would fail the build.
- **Screens take an injected `api`.** It defaults to the app's own data source and is
  replaced in tests, which is how the loading, empty and error states are exercised without
  a network.
- **Synthetic data only**, everywhere, always.

## Voice

Plain language, short sentences, the reader addressed as "you". No "we" in system messages.
No clinical term without a plain-language gloss beside it. No measured value without its
unit and a labelled range state. Empty and error states state the fact, then the next
action. No exclamation marks.
