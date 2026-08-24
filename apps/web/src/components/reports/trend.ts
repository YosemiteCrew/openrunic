/**
 * Which way a tile's sparkline is pointing, and what to call it.
 *
 * The function used to return the English word directly. That made it the one
 * place on the dashboard a translator could not reach: "rising" was produced by
 * a comparison rather than written down anywhere, so there was nothing to open.
 *
 * These are words this codebase wrote about its own drawing, which is what
 * makes them copy at all. A tile's label, its detail and its state word arrive
 * from the API already named and are never given a second name here.
 */

/** Which way the line goes. The word for it lives in the catalogue. */
export type Trend = 'rising' | 'falling' | 'steady';

/**
 * Carried as `labelKey` data rather than looked up here, for the two reasons
 * `components/orders/labels.ts` gives: the reader's language is not known at
 * module scope, and `catalogue-drift.test.ts` reads `somethingKey:` out of the
 * source, so a key defined nowhere fails the build instead of rendering as
 * itself beside a number.
 */
export const TREND_LABELS: Record<Trend, { labelKey: string }> = {
  rising: { labelKey: 'reports.trend.rising' },
  falling: { labelKey: 'reports.trend.falling' },
  steady: { labelKey: 'reports.trend.steady' },
};

/**
 * A series with fewer than two readings, or one that ends where it started, is
 * steady. That is a statement about the drawing rather than about the practice:
 * two equal endpoints with a spike between them still draw a line that arrives
 * where it left.
 */
export function trendOf(values: number[]): Trend {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined || first === last) return 'steady';
  return last > first ? 'rising' : 'falling';
}
