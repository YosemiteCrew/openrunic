# @openrunic/ui

The OpenRunic React component library: the design system's primitives, built once, typed, tested,
and responsive. Bone paper, espresso ink, one terracotta accent. Warm precision, no clinical blue.

Everything visual comes from the design tokens shipped in this package, so a component can never
drift from the brand by hard-coding a colour, a radius, or a duration.

## Install

**This package is not published to npm.** There is no `@openrunic/ui` on the registry and nothing
in this repository publishes one, so `npm install @openrunic/ui` fetches somebody else's package or
nothing at all. It is a workspace package inside the openrunic monorepo, and that is the only way
to consume it today.

Inside the monorepo, depend on it the way `apps/web` and `apps/portal` already do:

```jsonc
// apps/<your-app>/package.json
{
  "dependencies": {
    "@openrunic/ui": "workspace:*",
  },
}
```

Then install and build it, because the exports point at `dist/` and pnpm links the package
directory rather than a compiled copy:

```bash
pnpm install
pnpm --filter @openrunic/ui build
```

Turborepo builds it for you as a dependency of an app build; the explicit command is for the case
where you are working on the library itself, and `pnpm --filter @openrunic/ui dev` rebuilds it on
change.

`react` and `react-dom` (both `^19`) are peer dependencies, supplied by the consuming app.
`lucide-react` is a real dependency: icons are npm modules, never fetched from a CDN, so a page
rendering OpenRunic UI makes no network request for chrome.

Publishing to npm is a decision that has not been made rather than a step that has been forgotten.
Nothing here is API-stable yet, and a published package is a promise about names.

## Use

Import the stylesheet once, at the root of the app, then the components anywhere:

```tsx
import '@openrunic/ui/styles.css';
import { Button, Card } from '@openrunic/ui';

export function Vitals() {
  return (
    <Card
      overline="Vitals"
      title="Blood pressure"
      footer={
        <Button variant="ghost" size="sm" iconRight="arrow-right">
          History
        </Button>
      }
    >
      <p className="or-body">118 / 74 mmHg, measured this morning. Within range.</p>
    </Card>
  );
}
```

`styles.css` carries the tokens, the type roles (`.or-hero`, `.or-h1`, `.or-body`, `.or-mono`, and
the rest), a small element reset, and every component's rules, in that order. It is the only
stylesheet you need and the only one you should load.

### Importing the stylesheet

`import '@openrunic/ui/styles.css'` is the supported path, and it is a plain bundler import: put it
in the root layout or the app entry, once. A CSS `@import '@openrunic/ui/styles.css'` from your own
stylesheet works too.

Every `url()` the stylesheet contains resolves, which is what makes that possible. A CSS loader
resolves each one at build time and fails the build on the first missing file, so a stylesheet
pointing at font binaries it does not ship cannot be imported at all. Earlier revisions had exactly
that problem and had to be copied into a `public/` directory and loaded with a `<link>` tag, which
then tripped framework lint rules about raw CSS tags. **That workaround is gone: do not copy the
stylesheet into `public/`, and do not link it by hand.** The five font files it references are
shipped in `dist/fonts/` beside it; see [Fonts](#fonts).

Components use React hooks (`useId`, `useState`), so in a server-components framework they render
in a client component, like any other React component library. Mark the file that renders them
`'use client'`; the stylesheet import itself has no such constraint and belongs in the root layout.

### Navigation

`Button` renders a `<button>` normally and an `<a>` when you give it `href`. Inside a routed app,
pass your router's Link as `as` and the button keeps every class, variant and state while the router
handles the transition, so moving between screens is a client transition rather than a full page
load:

```tsx
import Link from 'your-router';
import { Button } from '@openrunic/ui';

<Button href="/records" as={Link} iconRight="arrow-right">
  Records
</Button>;
```

The library never imports a router, so it stays framework-agnostic. `as` is typed as
`ComponentType<ButtonLinkProps>`, and `ButtonLinkProps` is exactly the anchor prop set Button would
have handed its own `<a>`, which is why any router's Link satisfies it.

## The token contract

Components read CSS custom properties and never literal values. Redefine a token and every
component follows; that is the entire theming story.

| Group      | Examples                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Colour     | `--bone`, `--cream`, `--espresso`, `--terracotta`, `--olive`, `--danger`                            |
| Ink weight | `--hazelnut-ink`, `--olive-ink`, `--caramel-ink-inverse`                                            |
| Semantic   | `--bg-page`, `--surface-card`, `--surface-field`, `--text-body`, `--action-primary`, `--focus-ring` |
| Spacing    | `--space-1` to `--space-10`, `--card-pad`, `--control-h-sm` / `-md` / `-lg`, `--content-max`        |
| Radius     | `--radius-sm` / `-md` / `-lg` / `-pill`, `--radius-card`, `--radius-field`, `--radius-button`       |
| Elevation  | `--shadow-raised`, `--shadow-overlay`, `--scrim-espresso`                                           |
| Motion     | `--ease-out`, `--dur-fast` / `--dur-base` / `--dur-slow`                                            |
| Type       | `--font-display` / `-text` / `-editorial` / `-mono`, `--text-hero` to `--text-caption`              |

House rules the components already enforce, so you get them for free:

- Depth is paper first: bone page, cream card, white field or data table. Only two shadow levels
  exist and at most one layer per screen should use one.
- Hover always darkens, never lightens, and is wrapped in `@media (hover: hover)` so a tap never
  leaves a control stuck in its hover skin.
- Focus is a 2px terracotta ring at 2px offset, through `:focus-visible`, on every interactive
  element.
- Disabled is `opacity: 0.42` with no colour change. Nothing scales, bounces, or blurs.
- Status is never colour alone. Every state that means something carries a text label too.
- Quiet text roles resolve to ink weights of the warm hues rather than the hues themselves, so
  every text token clears WCAG AA 4.5:1 on the paper it is drawn on. The raw hues stay for fills,
  marks and charts. Espresso surfaces re-point the ink roles for their subtree, so a component
  dropped on a band inherits ink drawn for espresso and needs no inverse variant of its own.

## Responsive

Mobile-first, three widths:

| Breakpoint | Width    | What changes                                                                                                                                                                       |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base       | < 768px  | Controls take a 44px minimum touch target; cards use 16px padding; tables scroll horizontally with a sticky first column; modals go full-screen; NavBar collapses to a menu button |
| md         | ≥ 768px  | Exact control heights (32 / 40 / 48px) and 24px `--card-pad` return; modals centre                                                                                                 |
| lg         | ≥ 1024px | SideNav becomes a persistent rail instead of an off-canvas drawer                                                                                                                  |

Nothing is hover-only: hover states are enhancements on top of an affordance that already works
by tap and by keyboard.

## Fonts

Three OFL families ship inside this package: **Bricolage Grotesque** (display, UI and body),
**Fraunces** (editorial longform only) and **Spline Sans Mono** (code, FHIR identifiers, tabular
readouts). All five variable WOFF2 faces live in `src/assets/fonts/` with their `OFL-*.txt` licence
files beside them, and the build copies both to `dist/fonts/`.

You do not have to do anything: importing the stylesheet is enough. `local()` is tried first in
every `@font-face`, so a machine that already has a family installed downloads nothing; otherwise
the face is fetched from `dist/fonts/`, which the bundler resolves and re-emits like any other
asset. If a face fails to load, the family falls back to the system stack in `tokens/typography.css`
(`-apple-system` / Georgia / `ui-monospace`) and only the optical-size axis is lost.

The fonts stay **separate files** rather than being inlined into the stylesheet. Vite's library mode
base64-inlines any asset a stylesheet resolves, which produced a 1,063 kB render-blocking stylesheet
and defeated `font-display: swap` outright. So `tokens/fonts.css` points at `./fonts/...`, a path
that resolves next to the _built_ stylesheet rather than next to the source one, and the
`vendorFonts` plugin in `vite.config.ts` puts the real files there. Move either end and both must
change; the comments in both files say so.

Fonts are never hotlinked from a CDN. That is a privacy decision, not a performance one.

## Brand marks

`Logo`, `Glyph`, `NavBar`, `SideNav`, `Footer` and `EmptyState` render **shipped SVG files**: the
brand rule is that a mark is a file and is never redrawn in code. All eight logo builds are vendored
into this package, so every one of those components works out of the box:

```tsx
<Logo variant="horizontal" height={28} />
<Glyph size={32} color="var(--terracotta)" />
<EmptyState title="No records yet" />
```

The marks are read as source at build time and inlined as data URIs, so they are part of the
JavaScript bundle: no network request, nothing for your app to host, and they render correctly
behind any route, base path or CDN prefix. All eight builds together cost about 3 kB gzipped.

If your app serves its own copies of the design system's `assets/logo/`, point `basePath` (or
`logoBasePath` / `glyphBasePath`) at that directory and the component uses yours instead:

```tsx
<Logo variant="horizontal" height={28} basePath="/assets/logo" />
<EmptyState title="No records yet" glyphBasePath="/assets/logo" />
```

## Scripts

```bash
pnpm --filter @openrunic/ui storybook        # component workshop on :6007
pnpm --filter @openrunic/ui build-storybook  # static workshop into storybook-static/
pnpm --filter @openrunic/ui test             # vitest + coverage floors
pnpm --filter @openrunic/ui test-storybook   # every story, in a browser, with axe
pnpm --filter @openrunic/ui type-check
pnpm --filter @openrunic/ui lint
pnpm --filter @openrunic/ui build            # dist/index.js, dist/index.d.ts, dist/styles.css
```

## Storybook

`pnpm --filter @openrunic/ui storybook` opens the workshop on
[localhost:6007](http://localhost:6007). It is the design-sync preview surface as well as the
workshop: every component ships a `Default`, one story per meaningful variant and state, and a
`Responsive` story wherever layout changes across a breakpoint. All clinical content in stories
and tests is synthetic.

The main branch publishes the same workshop to **<https://yosemitecrew.github.io/openrunic/>**,
so the component library is browsable without checking the repository out. The page goes live
once Pages is enabled for the repository with "GitHub Actions" as the source; until then the
`Publish to GitHub Pages` job in `.github/workflows/storybook.yml` is the only thing that fails,
and only on main.

## Story tests

`test-storybook` runs every CSF3 story in this package as a test, in a pinned headless Chromium:

- the story renders, and a render error fails the run;
- its `play` function runs, so interaction assertions are part of the suite;
- [axe](https://github.com/dequelabs/axe-core) checks the rendered result, and a violation fails
  the run (`.storybook/preview.ts` sets `a11y.test: 'error'`).

It is Storybook's Vitest addon, driven by `vitest.storybook.config.ts`, kept apart from
`vitest.config.ts` so the jsdom unit suite keeps its own coverage floors. First run in a fresh
checkout needs the browser:

```bash
pnpm --filter @openrunic/ui exec playwright install chromium
pnpm --filter @openrunic/ui test-storybook
```

There is exactly one axe exception in the library, and it is scoped to the disabled rows of the
six controls that have a disabled state (Checkbox, Input, Radio, Select, Switch, Textarea). WCAG
1.4.3 exempts text inside an inactive user interface component, and disabled here is 0.42 opacity
on the wrapper with no colour change, so axe sees ordinary text at 1.77:1 with no `disabled`
attribute of its own to go by. The rule stays enabled and its selector is narrowed to skip that
one subtree; `Checkbox.stories.tsx` carries the full reasoning and the other five point at it.
Nothing is disabled globally.

## Visual regression

There is deliberately **no** screenshot diffing in this package yet. The library would fail such a
gate for reasons that have nothing to do with a regression:

- The rendering stack under the story tests is not pinned. The three OFL families _are_ bundled
  (see [Fonts](#fonts)), so the glyphs are the same everywhere, but `.github/workflows/storybook.yml`
  runs on `ubuntu-latest` and installs Chromium with `playwright install --with-deps`. The image,
  and with it fontconfig, FreeType and HarfBuzz, moves underneath us; a rasteriser or hinting change
  shifts antialiasing across every baseline at once, and a baseline that a runner-image update can
  invalidate is not evidence of anything.
- Every component is pre-alpha and changing weekly. A gate that gets re-baselined on most pull
  requests stops being a gate and becomes a rubber stamp with binaries attached to it.
- The axe and interaction suite above already runs in a real browser, so structural and contrast
  regressions - the ones that actually hurt - are caught without pixel comparison.

What would have to be true before adding it: a pinned browser and rendering stack via the Playwright
container image rather than the runner's own, animations and transitions disabled in the preview, a
fixed viewport and device scale factor, and a component API stable enough that a diff means a
mistake rather than progress. The font half of that list is already done, which is the one
precondition this package has met. When those hold, the natural home is a third job in `.github/workflows/storybook.yml`
alongside the two that exist.

## Licence

AGPL-3.0-only, same as the rest of openrunic.
