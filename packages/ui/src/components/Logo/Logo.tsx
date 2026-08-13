import type { CSSProperties, HTMLAttributes } from 'react';
import { brandAssetCssUrl, brandAssetUrl } from '../../assets/brand';
import type { BrandLogoFile } from '../../assets/brand';
import { cx } from '../../lib/cx';

export interface LogoProps extends HTMLAttributes<HTMLElement> {
  /** Which build to render. */
  variant?: 'horizontal' | 'stacked' | 'glyph';
  /** 'ink' inherits currentColor; 'light' = espresso on bone panel; 'dark' = bone on espresso panel. */
  theme?: 'ink' | 'light' | 'dark';
  /** Rendered height in px. */
  height?: number;
  /**
   * Serve the builds from your own copy of the design system's assets/logo directory
   * instead of the marks bundled with this package. The mark is a shipped file either way.
   */
  basePath?: string;
}

type LogoVariant = NonNullable<LogoProps['variant']>;
type LogoTheme = NonNullable<LogoProps['theme']>;

/** React's CSSProperties is closed, so open it for the custom property the CSS reads. */
type LogoStyle = CSSProperties & Record<`--or-logo-${string}`, string>;

/** The shipped builds, by variant and theme. */
const FILES: Record<LogoVariant, Record<LogoTheme, BrandLogoFile>> = {
  horizontal: {
    ink: 'lockup-horizontal.svg',
    light: 'lockup-horizontal-light.svg',
    dark: 'lockup-horizontal-dark.svg',
  },
  stacked: {
    // No currentColor build ships for the stacked lockup, so 'ink' resolves to the light
    // build and renders as an image rather than a mask.
    ink: 'lockup-stacked-light.svg',
    light: 'lockup-stacked-light.svg',
    dark: 'lockup-stacked-dark.svg',
  },
  glyph: {
    ink: 'glyph.svg',
    light: 'glyph-espresso.svg',
    dark: 'glyph-bone.svg',
  },
};

/** Intrinsic aspect ratio of each build, used to size the masked box. */
const RATIO: Record<LogoVariant, number> = {
  horizontal: 480 / 132,
  stacked: 320 / 280,
  glyph: 1,
};

/** Which variants ship a currentColor build that can be masked to the surrounding ink. */
const HAS_INK_BUILD: Record<LogoVariant, boolean> = {
  horizontal: true,
  stacked: false,
  glyph: true,
};

/**
 * The OpenRunic lockups and mark. Use it anywhere the brand appears - nav, footer, docs
 * header, end cards - and never retype the wordmark in a font.
 *
 * The marks are shipped files, never redrawn. All eight builds are vendored into this
 * package and inlined by the bundler, so the lockup renders out of the box with no hosting
 * and no network request; `basePath` still points at your own copies when you serve them.
 * `theme="ink"` renders the currentColor build through a mask, which is how the lockup
 * takes espresso on bone, bone on espresso, or a terracotta glyph; the light and dark
 * builds are images with their colours baked in.
 *
 * Clearspace is 0.5x the glyph height on all sides. Minimum sizes: glyph 16px, horizontal
 * lockup 120px wide, stacked 80px wide. Below 24px use the favicon builds in
 * `assets/icons`, not a scaled-down glyph. No gradients, shadows, outlines or rotation,
 * and never a terracotta wordmark.
 */
export function Logo({
  variant = 'horizontal',
  theme = 'ink',
  height = 32,
  basePath,
  className,
  style,
  ...rest
}: LogoProps) {
  const file = FILES[variant][theme];

  if (theme === 'ink' && HAS_INK_BUILD[variant]) {
    const maskStyle: LogoStyle = {
      '--or-logo-src': brandAssetCssUrl(file, basePath),
      width: Math.round(height * RATIO[variant]),
      height,
      ...style,
    };

    return (
      <span
        className={cx('or-logo', 'or-logo--mask', className)}
        role="img"
        aria-label="OpenRunic"
        style={maskStyle}
        {...rest}
      />
    );
  }

  return (
    <img
      className={cx('or-logo', 'or-logo--image', className)}
      src={brandAssetUrl(file, basePath)}
      alt="OpenRunic"
      style={{ height, width: 'auto', ...style }}
      {...rest}
    />
  );
}
