import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';
import type { Size } from '../../types';

/** Terracotta is the default; olive means a healthy or complete result, red a failing one. */
export type ProgressTone = 'accent' | 'success' | 'danger';

/** React's CSSProperties is closed, so open it for the one custom property the CSS reads. */
type ProgressStyle = CSSProperties & Record<`--or-progress-${string}`, string>;

/** The scale a bar is measured against when the caller gives no usable `max`. */
const DEFAULT_MAX = 100;

export interface ProgressProps extends HTMLAttributes<HTMLElement> {
  /**
   * How far along, on the 0..`max` scale. Values outside the scale are clamped. Omit it
   * for the indeterminate bar, which is what says the amount is unknown.
   */
  value?: number;
  /**
   * Top of the scale. A max of zero or less has no range to measure against, so the bar
   * falls back to 100 rather than dividing by zero.
   */
  max?: number;
  /**
   * Accessible name, e.g. 'Export in progress'. Required: a bar with no name tells a
   * screen reader nothing about what is running.
   */
  label: string;
  /**
   * Show the label and the percentage as text above the track. With no `value` there is
   * no percentage to show, so the row is the label alone.
   */
  showValue?: boolean;
  /** accent = terracotta, the default; success = olive; danger = warm red. */
  tone?: ProgressTone;
  /** Track thickness: sm, md or lg. */
  size?: Size;
}

/**
 * A progress bar, determinate or indeterminate.
 *
 * The track carries `role="progressbar"` with the whole value set, and `aria-valuetext` is
 * the rounded percentage, so assistive technology announces "64%" rather than a bare 1284
 * against a scale it cannot see. Leave `value` off and `aria-valuenow` and `aria-valuetext`
 * are omitted entirely, which is what tells assistive technology the amount is unknown.
 *
 * Colour is never the signal on its own: `label` names what is running whether or not the
 * percentage is on screen, and `showValue` puts the number itself in text.
 */
export function Progress({
  value,
  max = DEFAULT_MAX,
  label,
  showValue = false,
  tone = 'accent',
  size = 'md',
  className,
  style,
  id,
  ...rest
}: ProgressProps) {
  const blockId = useFieldId(id);
  const labelId = `${blockId}-label`;

  /* A max of zero, a negative max or a max that is not a number leaves no range to divide
     by, so the bar falls back to the default scale instead of announcing NaN. */
  const scale = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX;
  /* A value that is not a finite number is not an amount, so the bar reads as
     indeterminate rather than drawing NaN across the track. */
  const amount = value !== undefined && Number.isFinite(value) ? value : undefined;
  /* Clamped so a caller passing -10 or 140 cannot draw outside the track or announce a
     percentage that cannot exist. */
  const clamped = amount === undefined ? 0 : Math.min(Math.max(amount, 0), scale);
  const percent = Math.round((clamped / scale) * 100);

  /* An inline custom property, and it is unavoidable here: the percentage is a runtime
     value, so the fill width cannot live in the stylesheet. Everything else about the bar
     (track, ink, radius, motion) is in Progress.css, and the indeterminate modifier
     ignores this property and drives the width from CSS instead. */
  const blockStyle: ProgressStyle = { '--or-progress-value': `${percent}%`, ...style };

  return (
    <div
      id={blockId}
      className={cx(
        'or-progress',
        `or-progress--${tone}`,
        `or-progress--${size}`,
        amount === undefined && 'or-progress--indeterminate',
        className
      )}
      style={blockStyle}
      {...rest}
    >
      {showValue ? (
        <div className="or-progress__header">
          <span className="or-progress__label" id={labelId}>
            {label}
          </span>
          {amount === undefined ? null : <span className="or-progress__value">{percent}%</span>}
        </div>
      ) : null}
      <div
        className="or-progress__track"
        role="progressbar"
        aria-label={showValue ? undefined : label}
        aria-labelledby={showValue ? labelId : undefined}
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-valuenow={amount === undefined ? undefined : clamped}
        aria-valuetext={amount === undefined ? undefined : `${percent}%`}
      >
        <span className="or-progress__fill" />
      </div>
    </div>
  );
}
