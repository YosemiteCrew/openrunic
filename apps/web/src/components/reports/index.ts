/**
 * The reports area's composed components. `Sparkline` is a proposed library
 * addition (canon C26); `StatTile` and `BarMeter` are compositions of `Card`,
 * `Badge` and tokens that belong to this area rather than to the library.
 */
export { BarMeter } from './BarMeter';
export type { BarMeterProps, BarMeterRow } from './BarMeter';
export { trendKey } from './trend';
export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
export { StatTile } from './StatTile';
export type { StatTileProps } from './StatTile';
