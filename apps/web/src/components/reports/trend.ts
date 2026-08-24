/**
 * The word that goes beside the sparkline, as a catalogue key.
 *
 * A literal map rather than a key built from the word, because a key assembled
 * at runtime is one no test and no reader can find. The drawing is decorative
 * and hidden from assistive technology, so this word is the only thing that
 * carries the direction to somebody who is not looking at the line.
 *
 * The fields are named `...Key` rather than `rising`/`falling`/`steady` because
 * that is one of the two shapes the catalogue drift test scans for. The caller
 * reaches these through `t(trendKey(series))`, which is not a literal call and
 * so is invisible to the other shape; without the suffix these three would be
 * the only messages on the dashboard nothing checked exists.
 */
const TREND = {
  risingKey: 'reports.trend.rising',
  fallingKey: 'reports.trend.falling',
  steadyKey: 'reports.trend.steady',
} as const;

export function trendKey(values: number[]): string {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined || first === last) return TREND.steadyKey;
  return last > first ? TREND.risingKey : TREND.fallingKey;
}
