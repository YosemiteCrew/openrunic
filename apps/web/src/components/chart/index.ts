/**
 * The chart's composed components. Both chart routes import from here.
 *
 * `ChartTabs` and the rail are proposed additions to `@openrunic/ui`: the
 * library has no tab primitive and no patient header today, and both are
 * written to move across unchanged.
 */
export { appointmentOnDay, nextBookedAppointment } from './appointments';
export { panelId, tabId } from './ids';
export { ChartRail } from './ChartRail';
export type { ChartRailProps } from './ChartRail';
export { ChartTabs } from './ChartTabs';
export type { ChartTabItem, ChartTabsProps } from './ChartTabs';
export { PatientContextRail } from './PatientContextRail';
export type { PatientContextRailProps } from './PatientContextRail';
export {
  CareTeamPanel,
  DocumentsPanel,
  MedicationsPanel,
  ResultsPanel,
  VisitsPanel,
} from './RecordPanels';
export { SummaryPanel } from './SummaryPanel';
export type { SummaryPanelProps } from './SummaryPanel';
