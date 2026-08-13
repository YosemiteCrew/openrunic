import { describe, expect, it } from 'vitest';
import { brandAssetCssUrl, brandAssetUrl } from './brand';
import type { BrandLogoFile } from './brand';

/**
 * Every build the design system ships, with the two things that identify its artwork: the
 * viewBox, which says which mark it is, and the stroke, which says which colourway. Wiring
 * a key to the wrong file is the mistake this table exists to catch, and it is the kind of
 * mistake nothing else would notice: a lockup rendered in place of a glyph still renders.
 */
const BUILDS: Array<[BrandLogoFile, string, string]> = [
  ['glyph.svg', '0 0 240 240', 'currentColor'],
  ['glyph-bone.svg', '0 0 240 240', '#F5EFE6'],
  ['glyph-espresso.svg', '0 0 240 240', '#2E211A'],
  ['lockup-horizontal.svg', '0 0 480 132', 'currentColor'],
  ['lockup-horizontal-dark.svg', '0 0 480 132', '#F5EFE6'],
  ['lockup-horizontal-light.svg', '0 0 480 132', '#2E211A'],
  ['lockup-stacked-dark.svg', '0 0 320 280', '#F5EFE6'],
  ['lockup-stacked-light.svg', '0 0 320 280', '#2E211A'],
];

const FILES = BUILDS.map(([file]) => file);

describe('brandAssetUrl', () => {
  /* The whole point of vendoring: the mark travels inside the bundle. If this ever stops
     being a data URI the library has started fetching its own brand over the network, and
     every consumer inherits a request that can 404, be blocked, or arrive after paint. */
  it.each(FILES)('inlines %s into the bundle rather than fetching it', (file) => {
    expect(brandAssetUrl(file).startsWith('data:image/svg+xml')).toBe(true);
  });

  it.each(BUILDS)('wires %s to artwork with viewBox %s and stroke %s', (file, viewBox, stroke) => {
    const svg = decodeURIComponent(brandAssetUrl(file));
    expect(svg).toContain(`viewBox="${viewBox}"`);
    expect(svg).toContain(`stroke="${stroke}"`);
  });

  /* A raw '#' would start a URL fragment and truncate the mark to a blank box, so the
     hard-coded colourways are the ones most likely to break silently. */
  it.each(BUILDS)('leaves no unescaped hash in %s', (file) => {
    expect(brandAssetUrl(file)).not.toContain('#');
  });

  /* The bug this guards: a default of 'assets/logo/...' made every consumer request a file
     the package never shipped, so the mark 404ed on every screen until the app hosted its
     own copies. The default has to come from the bundler, never from a bare guess at the
     consuming app's directory layout. */
  it.each(FILES)('never defaults %s to an unhosted relative path', (file) => {
    expect(brandAssetUrl(file)).not.toBe(`assets/logo/${file}`);
  });

  it('gives every build a distinct url', () => {
    expect(new Set(FILES.map((file) => brandAssetUrl(file))).size).toBe(FILES.length);
  });

  it('resolves against a caller basePath instead when one is given', () => {
    expect(brandAssetUrl('glyph.svg', '/brand/logo')).toBe('/brand/logo/glyph.svg');
  });

  it('encodes a basePath that contains characters a url cannot carry raw', () => {
    expect(brandAssetUrl('glyph.svg', '/brand/open runic')).toBe('/brand/open%20runic/glyph.svg');
  });

  it('treats an empty basePath as a caller-supplied root, not as absent', () => {
    expect(brandAssetUrl('glyph.svg', '')).toBe('/glyph.svg');
  });
});

describe('brandAssetCssUrl', () => {
  /* Quoting is not cosmetic: the inlined data URI carries parentheses and single quotes,
     either of which would end an unquoted url() early and leave the mask pointing at
     nothing. */
  it.each(FILES)('wraps %s in a double-quoted css url', (file) => {
    expect(brandAssetCssUrl(file)).toBe(`url("${brandAssetUrl(file)}")`);
  });

  it('quotes a caller basePath the same way', () => {
    expect(brandAssetCssUrl('lockup-horizontal.svg', '/brand')).toBe(
      'url("/brand/lockup-horizontal.svg")'
    );
  });
});
