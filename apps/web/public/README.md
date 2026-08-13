# apps/web/public

Static files served from the site root. Two directories are expected here and are **not
committed**, because they are binaries the design system owns rather than source this repo
authors. Until they are dropped in, the app runs and every screen works - the browser falls back
to the system font stacks and the brand marks resolve to nothing - but the console carries a 404
for each missing file and the typography is not the designed typography.

## fonts/

`@openrunic/ui/styles.css` and `src/app/globals.css` both declare `@font-face` rules pointing at
`/fonts/...`. Copy the variable builds out of the design system's `assets/fonts/`, keeping the
filenames:

```text
public/fonts/
  BricolageGrotesque-variable.woff2
  BricolageGrotesque-variable.ttf
  Fraunces-variable.woff2
  Fraunces-Italic-variable.woff2
  SplineSansMono-variable.woff2
  SplineSansMono-Italic-variable.woff2
```

All three families are SIL OFL 1.1. Copy the `OFL-*.txt` licences alongside them.

They are self-hosted by policy: no third-party font CDN on a surface that renders PHI, so a
hotlink is not an acceptable substitute for the missing files.

## assets/logo/

The `Logo`, `Glyph` and `Footer` components in `@openrunic/ui` render shipped SVG builds rather
than redrawing the mark. `EmptyState` also points its glyph here. Copy the design system's
`assets/logo/` directory across:

```text
public/assets/logo/
  glyph.svg
  lockup-horizontal.svg
  lockup-horizontal-light.svg
  lockup-horizontal-dark.svg
  lockup-stacked.svg
  lockup-stacked-light.svg
  lockup-stacked-dark.svg
```

Never regenerate these by setting the wordmark in a font.
