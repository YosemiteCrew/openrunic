/**
 * Shared prop vocabulary for @openrunic/ui.
 *
 * Every union here is copied from the design system's `.d.ts` files verbatim. Import the
 * alias instead of re-typing the union so the whole library stays in step; only declare a
 * union locally when it belongs to exactly one component.
 */

/** Control height scale: 32px / 40px / 48px (`--control-h-sm|md|lg`). */
export type Size = 'sm' | 'md' | 'lg';

/**
 * Lucide icon slug in kebab-case, e.g. 'heart-pulse', 'file-text', 'arrow-right'.
 * Resolve it with `resolveLucideIcon` from `src/lib/lucide`.
 */
export type IconSlug = string;

/**
 * primary = terracotta-deep fill; secondary = espresso outline; ghost = cream wash on
 * hover; inverse = bone fill for espresso bands; danger = warm red, destructive only.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'danger';

/** IconButton offers the three chrome-safe variants only. */
export type IconButtonVariant = 'primary' | 'secondary' | 'ghost';

/** Paper steps: bone page -> cream card -> white field/table, plus the espresso inverse. */
export type SurfaceTone = 'cream' | 'bone' | 'white' | 'inverse';

/** Health semantics: olive = in range, hazelnut = informational, red = out of range. */
export type StatusTone = 'success' | 'neutral' | 'danger';

/** Badge adds two non-clinical tones on top of the status three. */
export type BadgeTone = StatusTone | 'accent' | 'ink';

/** Toast swaps 'neutral' for 'info'; the wording differs, the ink does not. */
export type ToastTone = 'info' | 'success' | 'danger';

/** Full-width band backgrounds; the alternation is the system's visual rhythm. */
export type BandTone = 'bone' | 'espresso';

/** Table column alignment. */
export type Align = 'left' | 'right' | 'center';

/** Placement of a floating element relative to its anchor. */
export type Side = 'top' | 'bottom' | 'left' | 'right';
