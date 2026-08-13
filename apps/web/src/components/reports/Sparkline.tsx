'use client';

import type { ReactElement } from 'react';

/**
 * The sparkline cell (canon C26), composed in the app.
 *
 * PROPOSED LIBRARY ADDITION. 32px tall, no axes, no gridlines, no fill: it
 * shows a direction, and the number beside it carries the value. It is
 * decorative by construction, so it is hidden from assistive technology and the
 * caller states the trend in words.
 */

export interface SparklineProps {
  /** Oldest first. Fewer than two points renders nothing. */
  values: number[];
  /** Drawn width in px. Height is fixed at 32. */
  width?: number;
}

const HEIGHT = 32;

export function Sparkline({ values, width = 96 }: Readonly<SparklineProps>): ReactElement | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; it draws as a straight line instead.
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = HEIGHT - 2 - ((value - min) / span) * (HEIGHT - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="or-sparkline"
      width={width}
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      <polyline points={points} fill="none" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}
