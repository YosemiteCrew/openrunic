import type { CSSProperties, HTMLAttributes } from 'react';
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
  /** Rendered box in px. Never below 16px; use the favicon builds instead. */
  size?: number;
  /** Sweep the six strokes as a loading state. Use sparingly. */
  animate?: boolean;
  /** Any CSS colour; defaults to currentColor. Terracotta is permitted for the glyph alone. */
  color?: string;
  /** Path to the copied assets/logo directory, relative to the page. */
  basePath?: string;
}

/**
 * The mark alone: a decorative accent (404, empty state, large in a cream or espresso
 * panel) or the brand's loading affordance when animated.
 *
 * The mark is a shipped file, never redrawn: copy the eight builds from the design
 * system's `assets/logo/` into the app's public directory and point `basePath` at it.
 * `glyph.svg` is the currentColor build, so the layers are masked and take their ink from
 * `color`. Under `prefers-reduced-motion` the animation is dropped for a static mark
 * rather than left mid-draw.
 */
export function Glyph({
  size = 48,
  animate = false,
  color = 'currentColor',
  basePath = 'assets/logo',
  className,
  style,
  ...rest
}: GlyphProps) {
  const blockStyle: GlyphStyle = {
    '--or-glyph-src': `url(${basePath}/glyph.svg)`,
    '--or-glyph-ink': color,
    width: size,
    height: size,
    ...style,
  };

  return (
    <span
      className={cx('or-glyph', animate && 'or-glyph--animate', className)}
      role="img"
      aria-label={animate ? 'Loading' : 'OpenRunic'}
      style={blockStyle}
      {...rest}
    >
      <span className="or-glyph__track" />
      {animate ? STROKES.map((stroke) => <span key={stroke} className="or-glyph__stroke" />) : null}
    </span>
  );
}
