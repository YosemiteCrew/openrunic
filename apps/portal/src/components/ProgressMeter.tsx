'use client';

/**
 * How far through a questionnaire the reader is.
 *
 * The bar is decorative; the count beside it is the real signal, so progress is readable
 * without seeing the fill. `aria-valuetext` repeats the same words rather than leaving a
 * screen reader to announce a bare percentage.
 */

import type { CSSProperties } from 'react';

export interface ProgressMeterProps {
  done: number;
  total: number;
  /** The count in words, e.g. '2 of 3 answered'. */
  label: string;
}

/** Custom property rather than an inline width, so the stylesheet keeps the transition. */
interface MeterStyle extends CSSProperties {
  '--portal-progress-fill': string;
}

export function ProgressMeter({ done, total, label }: ProgressMeterProps) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const style: MeterStyle = { '--portal-progress-fill': `${percent}%` };

  return (
    <div className="portal-progress">
      <p className="or-small portal-progress__label">{label}</p>
      <div
        className="portal-progress__track"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={label}
        style={style}
      >
        <span className="portal-progress__fill" />
      </div>
    </div>
  );
}
