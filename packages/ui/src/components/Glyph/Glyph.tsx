import type { CSSProperties, HTMLAttributes } from 'react';
import { brandAssetCssUrl } from '../../assets/brand';
import { cx } from '../../lib/cx';

/**
 * The mark is six identical chords holding each other up. Each layer below is clipped to
 * one sixth of the box, so the animated state brings the strokes up one after another,
 * `--glyph-stroke-stagger` (60ms) apart, exactly as the brand's signature asks.
 */
const STROKES = [1, 2, 3, 4, 5, 6];

/** React's CSSProperties is closed, so open it for the two custom properties the CSS reads. */
type GlyphStyle = CSSProperties & Record<`--or-glyph-${string}`, string>;

export interface GlyphProps extends HTMLAttributes<HTMLElement> {
  /**
   * What a screen reader calls the animated mark. A prop rather than a literal
   * because it is the one word this component says; the static mark announces
   * the product's name, which is not translated. See #196.
   */
  loadingLabel?: string;
  /** Rendered box in px. Never below 16px; use the favicon builds instead. */
  size?: number;
  /** Sweep the six strokes as a loading state. Use sparingly. */
  animate?: boolean;
  /** Any CSS colour; defaults to currentColor. Terracotta is permitted for the glyph alone. */
  color?: string;
  /**
   * Serve the mark from your own copy of the design system's assets/logo directory instead
   * of the glyph bundled with this package. The mark is a shipped file either way.
   */
  basePath?: string;
}

/**
 * The mark alone: a decorative accent (404, empty state, large in a cream or espresso
 * panel) or the brand's loading affordance when animated.
 *
 * The mark is a shipped file, never redrawn. `glyph.svg` is vendored into this package and
 * inlined by the bundler, so the mark renders out of the box with no hosting and no network
 * request; `basePath` still points at your own copy when you serve it. It is the
 * currentColor build, so the layers are masked and take their ink from `color`. Under
 * `prefers-reduced-motion` the animation is dropped for a static mark rather than left
 * mid-draw.
 */
export function Glyph({
  size = 48,
  animate = false,
  color = 'currentColor',
  basePath,
  loadingLabel = 'Loading',
  className,
  style,
  ...rest
}: GlyphProps) {
  const blockStyle: GlyphStyle = {
    '--or-glyph-src': brandAssetCssUrl('glyph.svg', basePath),
    '--or-glyph-ink': color,
    width: size,
    height: size,
    ...style,
  };

  return (
    <span
      className={cx('or-glyph', animate && 'or-glyph--animate', className)}
      role="img"
      /* The product's name when it is a mark, a word when it is a spinner. Only
         the word is a prop: `openrunic` is `openrunic` in every language. */
      aria-label={animate ? loadingLabel : 'openrunic'}
      style={blockStyle}
      {...rest}
    >
      <span className="or-glyph__track" />
      {animate ? STROKES.map((stroke) => <span key={stroke} className="or-glyph__stroke" />) : null}
    </span>
  );
}
