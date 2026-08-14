# apps/web

Next.js 16. The staff EMR, the public marketing pages, and the clinician assistant.

## One client contract, two implementations

`src/lib/api` defines `ApiClient` once and implements it twice: an in-memory mock and an HTTP
client. Screens depend on the contract, never on either implementation.

When you add a call, add it in three places or none: the contract, the HTTP client, and the mock. A
method that exists only in the mock is a screen that works in the demo and fails in a clinic, which
is the failure this layout exists to prevent. Derive the request and response shapes by reading
`apps/api/src/routes/`, not by guessing from the screen.

Both paths return RFC 9457 problem documents, so error handling is written once.

## A screen must not claim an outcome it did not achieve

Every action reaches the API. A handler that sets local state and shows a success toast is telling a
clinician their work is saved when it is not.

Some screens are still on local state and are listed as such in their own comments. If you touch
one, wire it; if you cannot, make sure it does not report success.

## Accessibility evidence is keyboard tests, not axe

There is no Storybook here, so the axe pass in CI does not cover this app. Where a Sonar
accessibility rule is suppressed, the justification is a named keyboard test, and the suppression
comment says which one. `sonar-project.properties` is the worked example: it names the "keyboard
only" blocks that stand behind the ARIA exclusions.

The combobox surfaces (command palette, slash menu) deliberately keep their options unfocusable and
drive everything through `aria-activedescendant` on the input. That is the WAI-ARIA pattern, and
several linters read it as a defect. Do not "fix" it by making options focusable.

## The design system is upstream

Colours, spacing, type and components come from `@openrunic/ui`. No hex values here. Terracotta is
for actions and never for status. Marks are shipped files, never redrawn in code.

## Mock data is synthetic and CI checks it

Fixture identities come from the seed's pool in `packages/database/src/seed/data.ts`. `MOCK_PATIENTS`
is **sorted by family name**, so an index into it is a position in an alphabetical list, not a
reference to a person: look patients up by MRN in tests, or a fixture rename will silently repoint
your test at somebody else while still reading as though it meant the right one.

```bash
pnpm --filter web test          # coverage floors: 95 / 90 / 95 / 95
pnpm --filter web lint
pnpm run doctor                 # React Doctor, 95 minimum
```
