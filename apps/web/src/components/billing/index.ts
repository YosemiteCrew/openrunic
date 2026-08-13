/**
 * The billing area's shared parts. Screens import from `@/components/billing`.
 *
 * Two of these exist because @openrunic/ui does not have them yet and forking a
 * library component would have been worse than composing one: `Drawer` (the
 * canon's side modal) and the toggle chip inside `ChargeLines`. Both are raised
 * as proposed library additions.
 */
export {
  ageingState,
  allocatedTotal,
  allocatedLines,
  ALLOCATION_HINTS,
  ALLOCATION_STATE_LABELS,
  allocationState,
  allocationStateName,
  arSummary,
  autoAllocate,
  blockingFindings,
  BUCKET_LABELS,
  BUCKET_ORDER,
  BUCKET_STATE_LABELS,
  bucketTone,
  bulkActionsFor,
  claimAgeDays,
  claimAgeingBands,
  claimCounts,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_TONE,
  diagnosisPointer,
  DUNNING_LABELS,
  feeSheetTotals,
  isBlockedByScrub,
  lineCharge,
  lineVariance,
  newChargeLine,
  nextDunningStage,
  receiptRows,
  remittanceSummary,
  RESOLUTION_LABELS,
  scrubFeeSheet,
  statementTotals,
  unallocated,
} from './billing';
export type {
  AgeingBand,
  AgeingState,
  AllocationState,
  ArSummary,
  BulkAction,
  ExceptionResolution,
  FeeSheetTotals,
  OpenItem,
  RemittanceSummary,
  ScrubFinding,
  ScrubSeverity,
  Variance,
} from './billing';
export { claimLifecycle } from './billing';
export { AllocationTable } from './AllocationTable';
export type { AllocationTableProps } from './AllocationTable';
export { ChargeLines } from './ChargeLines';
export type { ChargeLinesProps } from './ChargeLines';
export { ChargePicker } from './ChargePicker';
export type { ChargePickerProps } from './ChargePicker';
export { ClaimDrawer } from './ClaimDrawer';
export type { ClaimDrawerProps } from './ClaimDrawer';
export { ClaimTable } from './ClaimTable';
export type { ClaimTableProps } from './ClaimTable';
export { DiagnosisPanel } from './DiagnosisPanel';
export type { DiagnosisPanelProps } from './DiagnosisPanel';
export { Drawer } from './Drawer';
export type { DrawerProps } from './Drawer';
export { Money } from './Money';
export type { MoneyProps } from './Money';
export { Receipt } from './Receipt';
export type { ReceiptProps } from './Receipt';
export { RemittanceLines } from './RemittanceLines';
export type { RemittanceLinesProps } from './RemittanceLines';
export { ScrubPanel } from './ScrubPanel';
export type { ScrubPanelProps } from './ScrubPanel';
export { StatementDrawer } from './StatementDrawer';
export type { StatementDrawerProps } from './StatementDrawer';
export { ToastDock, useToasts } from './Toasts';
export type { ToastController, ToastDockProps, ToastMessage } from './Toasts';
