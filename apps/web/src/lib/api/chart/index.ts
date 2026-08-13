/**
 * The chart aggregate's public surface: types, client and hooks.
 *
 * Chart screens import from `@/lib/api/chart`; everything else in the app keeps
 * importing `@/lib/api`. When the API implements these routes the two barrels
 * merge and no screen changes.
 */
export { chartApi, createHttpChartClient, createMockChartClient } from './client';
export type { ChartClient, MockChartClientOptions } from './client';
export { clinicNow } from './clock';
/**
 * The note command library. It is a fixture today because it is user-scoped
 * configuration with no endpoint yet; when one lands this becomes a read like
 * any other and the note editor's prop does not change.
 */
export { MOCK_SLASH_COMMANDS as SLASH_COMMANDS } from '../mock/chart';
export { useChartSummary, useEncounterNote } from './hooks';
export type { ChartHookOptions } from './hooks';
export * from './types';
