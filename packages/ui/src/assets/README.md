# Brand assets

These files are **vendored copies of openrunic's own brand assets**, exported from the openrunic
design-system project in Claude Design (the canonical source for the openrunic brand). They are
shipped artefacts, not generated at build time.

## Provenance

| Directory | Source path in the design system |
| --------- | -------------------------------- |
| `logo/`   | `assets/logo/`                   |
| `icons/`  | `assets/icons/`                  |
| `fonts/`  | `assets/fonts/`                  |

Two font binaries are the exception and did not come from the design system: they exceeded the
design tool's transfer limit, so they were taken from the upstream OFL release and converted from
TTF to WOFF2 with fontTools.

| File                                | Origin                                       |
| ----------------------------------- | -------------------------------------------- |
| `BricolageGrotesque-variable.woff2` | upstream OFL release, TTF converted to WOFF2 |
| `Fraunces-Italic-variable.woff2`    | upstream OFL release, TTF converted to WOFF2 |

Format conversion is not a redesign: the outlines, the variation axes and the reserved font names
are untouched, so both remain the same typeface under the same licence. The other three WOFF2 files
came from the design system unchanged.

Raster derivatives that live in the design system (`.png`, `.ico` favicons, `app-icon-512.png`,
`og-image-1200x630.png`) are deliberately **not** vendored here: this package ships vector and font
sources only. Applications that need raster icons generate them from `icons/app-icon.svg` and
`icons/og-image.svg`.

## The brand marks are shipped files, never redrawn

The glyph, the lockups and the app icon are **exact copies of the approved artwork**. They must not
be redrawn, re-traced, re-proportioned, or recoloured outside the variants provided here:

- `logo/glyph.svg`, `logo/lockup-horizontal.svg` use `currentColor`, so they inherit the surrounding
  text colour. That is the intended way to restyle a mark.
- `logo/glyph-bone.svg` / `logo/glyph-espresso.svg` and the `-light` / `-dark` lockups are the
  **only** hard-coded colourways (bone `#F5EFE6`, espresso `#2E211A`).

If a new colourway, orientation or crop is needed, it is produced in the design system and
re-exported here. Never hand-edit the artwork in this directory, and never substitute a
lookalike mark.

## Fonts are SIL Open Font License

Every font in `fonts/` is licensed under the **SIL Open Font License, Version 1.1**, and its licence
file sits alongside it in the same directory. Redistribution of the font binaries without the
accompanying `OFL-*.txt` file is a licence violation, so the two must always travel together:

| Font files                                                              | Licence file                 |
| ----------------------------------------------------------------------- | ---------------------------- |
| `BricolageGrotesque-variable.woff2`                                     | `OFL-BricolageGrotesque.txt` |
| `Fraunces-variable.woff2`, `Fraunces-Italic-variable.woff2`             | `OFL-Fraunces.txt`           |
| `SplineSansMono-variable.woff2`, `SplineSansMono-Italic-variable.woff2` | `OFL-SplineSansMono.txt`     |

Under the OFL these fonts may be bundled and redistributed with this package; they may not be sold
on their own, and any modified version may not use the reserved font names.

## How these files reach a consumer

The two kinds of asset ship by different routes, and neither is fetched from this directory at
runtime:

- **SVGs** are read as source by `src/assets/brand.ts` and encoded into data URIs, so a mark is
  part of the JavaScript bundle. There is no request to make and no file for an app to host.
- **Fonts** are copied to `dist/fonts/` by the `vendorFonts` plugin in `vite.config.ts`, and
  `tokens/fonts.css` points `url()` at that directory. They stay separate files so the browser can
  cache them independently and `font-display: swap` still works. The `OFL-*.txt` files are copied
  with them, which is what keeps redistribution licence-compliant.

Adding or renaming a file here means updating whichever of those two paths carries it.
