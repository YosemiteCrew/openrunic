/**
 * The word that goes beside the sparkline, as a catalogue key.
 *
 * A literal map rather than a key built from the word, because a key assembled
 * at runtime is one no test and no reader can find. The drawing is decorative
 * and hidden from assistive technology, so this word is the only thing that
 * carries the direction to somebody who is not looking at the line.
 */
const TREND_KEY = {
  rising: 'reports.trend.rising',
  falling: 'reports.trend.falling',
  steady: 'reports.trend.steady',
} as const;

export function trendKey(values: number[]): string {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined || first === last) return TREND_KEY.steady;
  return last > first ? TREND_KEY.rising : TREND_KEY.falling;
}
