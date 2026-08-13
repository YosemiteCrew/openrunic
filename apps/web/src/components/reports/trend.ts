/** "rising", "falling", "steady" - the word that goes beside the drawing. */
export function trendWord(values: number[]): string {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined || first === last) return 'steady';
  return last > first ? 'rising' : 'falling';
}
