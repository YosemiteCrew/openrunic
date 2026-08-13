# @openrunic/ui

The OpenRunic React component library: the design system's primitives, built once, typed, tested,
and responsive. Bone paper, espresso ink, one terracotta accent. Warm precision, no clinical blue.

Everything visual comes from the design tokens shipped in this package, so a component can never
drift from the brand by hard-coding a colour, a radius, or a duration.

## Install

```bash
pnpm add @openrunic/ui react react-dom
```

`react` and `react-dom` (both `^19`) are peer dependencies. `lucide-react` is a real dependency:
icons are npm modules, never fetched from a CDN, so a page rendering OpenRunic UI makes no network
request for chrome.

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

## The token contract

Components read CSS custom properties and never literal values. Redefine a token and every
component follows; that is the entire theming story.

| Group     | Examples                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------- |
| Colour    | `--bone`, `--cream`, `--espresso`, `--terracotta`, `--olive`, `--danger`                            |
| Semantic  | `--bg-page`, `--surface-card`, `--surface-field`, `--text-body`, `--action-primary`, `--focus-ring` |
| Spacing   | `--space-1` to `--space-10`, `--card-pad`, `--control-h-sm` / `-md` / `-lg`, `--content-max`        |
| Radius    | `--radius-sm` / `-md` / `-lg` / `-pill`, `--radius-card`, `--radius-field`, `--radius-button`       |
| Elevation | `--shadow-raised`, `--shadow-overlay`, `--scrim-espresso`                                           |
| Motion    | `--ease-out`, `--dur-fast` / `--dur-base` / `--dur-slow`                                            |
| Type      | `--font-display` / `-text` / `-editorial` / `-mono`, `--text-hero` to `--text-caption`              |

House rules the components already enforce, so you get them for free:

- Depth is paper first: bone page, cream card, white field or data table. Only two shadow levels
  exist and at most one layer per screen should use one.
- Hover always darkens, never lightens, and is wrapped in `@media (hover: hover)` so a tap never
  leaves a control stuck in its hover skin.
- Focus is a 2px terracotta ring at 2px offset, through `:focus-visible`, on every interactive
  element.
- Disabled is `opacity: 0.42` with no colour change. Nothing scales, bounces, or blurs.
- Status is never colour alone. Every state that means something carries a text label too.

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

The library references three self-hosted OFL families - **Bricolage Grotesque** (display, UI and
body), **Fraunces** (editorial longform only) and **Spline Sans Mono** (code, FHIR identifiers,
tabular readouts). The binaries are **not** bundled here.

To get the intended typography, copy them out of the design system's `assets/fonts/` into a
`fonts/` directory beside the stylesheet you serve, so the relative `./fonts/...` URLs in
`tokens/fonts.css` resolve:

```text
your-app/public/
  styles.css                 <- from @openrunic/ui/styles.css
  fonts/
    BricolageGrotesque-variable.woff2
    BricolageGrotesque-variable.ttf
    Fraunces-variable.woff2
    Fraunces-Italic-variable.woff2
    SplineSansMono-variable.woff2
    SplineSansMono-Italic-variable.woff2
```

Without them nothing breaks: `--font-text` and friends fall back to `-apple-system` / Georgia /
`ui-monospace`, and the only loss is the variable optical-size axis that makes the system look
bespoke. `local()` is tried first, so a machine that already has a family installed downloads
nothing. Fonts are never hotlinked from a CDN - that is a privacy decision, not a performance one.

## Scripts

```bash
pnpm --filter @openrunic/ui storybook    # component workshop on :6007
pnpm --filter @openrunic/ui test         # vitest + coverage floors
pnpm --filter @openrunic/ui type-check
pnpm --filter @openrunic/ui lint
pnpm --filter @openrunic/ui build        # dist/index.js, dist/index.d.ts, dist/styles.css
```

Storybook is the design-sync preview surface as well as the workshop: every component ships a
`Default`, one story per meaningful variant and state, and a `Responsive` story wherever layout
changes across a breakpoint. All clinical content in stories and tests is synthetic.

## Licence

AGPL-3.0-only, same as the rest of openrunic.
