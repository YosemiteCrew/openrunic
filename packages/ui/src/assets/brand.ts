import glyph from './logo/glyph.svg?raw';
import glyphBone from './logo/glyph-bone.svg?raw';
import glyphEspresso from './logo/glyph-espresso.svg?raw';
import lockupHorizontal from './logo/lockup-horizontal.svg?raw';
import lockupHorizontalDark from './logo/lockup-horizontal-dark.svg?raw';
import lockupHorizontalLight from './logo/lockup-horizontal-light.svg?raw';
import lockupStackedDark from './logo/lockup-stacked-dark.svg?raw';
import lockupStackedLight from './logo/lockup-stacked-light.svg?raw';

/**
 * Turn SVG source into a data URI that is safe inside both a CSS `url("...")` and a JSX
 * `src` attribute.
 *
 * Percent-encoding rather than base64: it is roughly a third smaller for markup this
 * repetitive, and it leaves the mark readable in devtools instead of an opaque blob.
 *
 * The escape order matters. `%` goes first, or the escapes introduced below would be
 * re-escaped into nonsense. `#` is the one that actually breaks things if missed: every
 * hard-coded colourway carries a hex like `#2E211A`, and a raw `#` starts a URL fragment,
 * which silently truncates the mark to a blank box.
 */
function svgToDataUri(svg: string): string {
  const encoded = svg
    .trim()
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, '%22')
    .replace(/&/g, '%26')
    /* A literal newline is not valid inside a url(), and these files are single-line
       markup, so folding whitespace costs nothing and guards a reformatted export. */
    .replace(/[\r\n\t]+/g, ' ');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * The eight shipped logo builds, keyed by their filename in the design system's
 * `assets/logo/`. The key is the filename on purpose: it is what a consumer hosting their
 * own copies would put on disk, so `basePath` and the bundled default stay symmetrical.
 *
 * These are the approved artwork, vendored verbatim and never redrawn. Each is read at
 * build time and inlined as a data URI, so a mark is part of the bundle rather than a
 * network request, and it renders correctly from any route, behind any basePath or CDN
 * prefix, and with no file for the consuming app to host.
 *
 * `?raw` plus an explicit encoder, rather than a plain asset import, because Vite decides
 * whether to inline an asset by file size in dev and unconditionally in library mode. That
 * split meant the same import produced a data URI under test and a path in the build for
 * some files and not others. Encoding here makes dev, test and build produce byte-identical
 * output, so what the tests assert is what consumers get.
 */
const LOGO_FILES = {
  'glyph.svg': svgToDataUri(glyph),
  'glyph-bone.svg': svgToDataUri(glyphBone),
  'glyph-espresso.svg': svgToDataUri(glyphEspresso),
  'lockup-horizontal.svg': svgToDataUri(lockupHorizontal),
  'lockup-horizontal-dark.svg': svgToDataUri(lockupHorizontalDark),
  'lockup-horizontal-light.svg': svgToDataUri(lockupHorizontalLight),
  'lockup-stacked-dark.svg': svgToDataUri(lockupStackedDark),
  'lockup-stacked-light.svg': svgToDataUri(lockupStackedLight),
} as const;

/** Filename of a shipped logo build. */
export type BrandLogoFile = keyof typeof LOGO_FILES;

/**
 * URL for a brand mark: the bundled copy by default, the consumer's own when they pass a
 * `basePath`. An app that serves the marks itself keeps full control; every other app gets
 * a working mark with no hosting, no copying and no 404.
 */
export function brandAssetUrl(file: BrandLogoFile, basePath?: string): string {
  if (basePath === undefined) return LOGO_FILES[file];
  return `${encodeURI(basePath)}/${file}`;
}

/**
 * The same URL wrapped for CSS. Always double-quoted: a data URI carries characters that
 * would end an unquoted `url()` early, and quoting is harmless for a plain path.
 */
export function brandAssetCssUrl(file: BrandLogoFile, basePath?: string): string {
  return `url("${brandAssetUrl(file, basePath)}")`;
}
