'use client';

/**
 * How far through a questionnaire the reader is.
 *
 * The bar is a native `<progress>` rather than a div wearing `role="progressbar"`: it is
 * a determinate progress indicator, which is the element's entire purpose, and the
 * platform then supplies the role and the value semantics rather than this file
 * restating them. The bar itself is decorative; the count beside it is the real signal,
 * so progress is readable without seeing the fill, and `aria-valuetext` repeats those
 * same words rather than leaving a screen reader to announce a bare percentage.
 */

export interface ProgressMeterProps {
  done: number;
  total: number;
  /** The count in words, e.g. '2 of 3 answered'. */
  label: string;
}

export function ProgressMeter({ done, total, label }: Readonly<ProgressMeterProps>) {
  return (
    <div className="portal-progress">
      <p className="or-small portal-progress__label">{label}</p>
      {/*
        `max` is floored at 1 because a form with no questions would otherwise render
        `max={0}`, which the HTML parser rejects and treats as 1 anyway - with `value` at
        0 the bar reads empty either way, which is the honest picture of a form there is
        nothing to answer.
      */}
      <progress
        aria-valuetext={label}
        className="portal-progress__track"
        max={Math.max(total, 1)}
        value={done}
      />
    </div>
  );
}
