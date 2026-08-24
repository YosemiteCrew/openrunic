/**
 * The patient index and registration surfaces. Screens import from here and
 * nothing deeper.
 */
export { DuplicatePanel } from './DuplicatePanel';
export type { DuplicatePanelProps } from './DuplicatePanel';
export { LANGUAGE_OPTIONS, SENSITIVITY_LABELS, SEX_AT_BIRTH_LABELS } from './labels';
export { PatientTable } from './PatientTable';
export type { PatientTableProps } from './PatientTable';
export {
  BLOCKING_SCORE,
  EMPTY_DRAFT,
  findDuplicates,
  isBlocking,
  proposeMrn,
  REQUIRED_FIELDS,
  toPatientCreateBody,
  validateRegistration,
} from './registration';
export type {
  DuplicateMatch,
  FieldErrors,
  RegistrationDraft,
  RegistrationField,
} from './registration';
export { DEFAULT_VIEW_ID, SAVED_VIEWS, viewById } from './savedViews';
export type { SavedView } from './savedViews';
