import type { AdministrativeGender, Appointment, SensitivityClass } from '@/lib/api';
import type {
  AllergyCategory,
  AllergySeverity,
  CareTeamRelationship,
  MedicationSource,
  NoteState,
  ProblemStatus,
} from '@/lib/api/chart/types';

/**
 * What this application calls its own chart enums, as catalogue keys.
 *
 * `lib/api/chart/types.ts` says it plainly: "Every enum here mirrors an enum
 * that already exists in `@openrunic/database`." None of them arrives from a
 * terminology server, so none of them arrives named - the API sends `SEVERE`
 * and says nothing about what to call it. `formatEnumLabel` was inventing the
 * English and the codebase was then treating its own invention as somebody
 * else's name for the value.
 *
 * An allergen, a reaction, a medication's name and a problem's code are the
 * other side of that line and stay exactly as they arrived.
 *
 * ## The `INLINE` maps are not the labels lowercased
 *
 * Three sentences drop one of these words into their middle, and did it with
 * `formatEnumLabel(x).toLowerCase()`. Lowercasing a translated word applies an
 * English rule to somebody else's grammar: German capitalises every noun, and a
 * language with case marking may need a different form entirely rather than a
 * different capital. So the in-sentence form is a key of its own, written by
 * whoever writes the language.
 */

export const ALLERGY_SEVERITY_LABELS: Record<AllergySeverity, { labelKey: string }> = {
  SEVERE: { labelKey: 'chart.allergySeverity.severe' },
  MODERATE: { labelKey: 'chart.allergySeverity.moderate' },
  MILD: { labelKey: 'chart.allergySeverity.mild' },
};

export const ALLERGY_CATEGORY_LABELS: Record<AllergyCategory, { labelKey: string }> = {
  DRUG: { labelKey: 'chart.allergyCategory.drug' },
  FOOD: { labelKey: 'chart.allergyCategory.food' },
  ENVIRONMENT: { labelKey: 'chart.allergyCategory.environment' },
};

export const MEDICATION_SOURCE_LABELS: Record<MedicationSource, { labelKey: string }> = {
  PRESCRIBED_HERE: { labelKey: 'chart.medicationSource.prescribedHere' },
  PATIENT_REPORTED: { labelKey: 'chart.medicationSource.patientReported' },
  RECONCILED: { labelKey: 'chart.medicationSource.reconciled' },
};

export const CARE_TEAM_LABELS: Record<CareTeamRelationship, { labelKey: string }> = {
  PRIMARY: { labelKey: 'chart.careTeam.primary' },
  CARE_TEAM: { labelKey: 'chart.careTeam.careTeam' },
  EXTERNAL: { labelKey: 'chart.careTeam.external' },
};

export const PROBLEM_STATUS_LABELS: Record<ProblemStatus, { labelKey: string }> = {
  ACTIVE: { labelKey: 'chart.problemStatus.active' },
  CHRONIC: { labelKey: 'chart.problemStatus.chronic' },
  RESOLVED: { labelKey: 'chart.problemStatus.resolved' },
};

/** For the middle of a sentence. See the header: not the label lowercased. */
export const PROBLEM_STATUS_INLINE: Record<ProblemStatus, { labelKey: string }> = {
  ACTIVE: { labelKey: 'chart.problemStatus.inline.active' },
  CHRONIC: { labelKey: 'chart.problemStatus.inline.chronic' },
  RESOLVED: { labelKey: 'chart.problemStatus.inline.resolved' },
};

/** `NONE` is "No note" rather than a state's name, which is why it is a key too. */
export const NOTE_STATE_LABELS: Record<NoteState, { labelKey: string }> = {
  NONE: { labelKey: 'chart.noteState.none' },
  DRAFT: { labelKey: 'chart.noteState.draft' },
  UNSIGNED: { labelKey: 'chart.noteState.unsigned' },
  COSIGN_PENDING: { labelKey: 'chart.noteState.cosignPending' },
  SIGNED: { labelKey: 'chart.noteState.signed' },
};

export const APPOINTMENT_STATUS_LABELS: Record<Appointment['status'], { labelKey: string }> = {
  PROPOSED: { labelKey: 'chart.appointmentStatus.proposed' },
  PENDING: { labelKey: 'chart.appointmentStatus.pending' },
  BOOKED: { labelKey: 'chart.appointmentStatus.booked' },
  ARRIVED: { labelKey: 'chart.appointmentStatus.arrived' },
  CHECKED_IN: { labelKey: 'chart.appointmentStatus.checkedIn' },
  ROOMED: { labelKey: 'chart.appointmentStatus.roomed' },
  IN_PROGRESS: { labelKey: 'chart.appointmentStatus.inProgress' },
  CHECKED_OUT: { labelKey: 'chart.appointmentStatus.checkedOut' },
  FULFILLED: { labelKey: 'chart.appointmentStatus.fulfilled' },
  CANCELLED: { labelKey: 'chart.appointmentStatus.cancelled' },
  NOSHOW: { labelKey: 'chart.appointmentStatus.noshow' },
  ENTERED_IN_ERROR: { labelKey: 'chart.appointmentStatus.enteredInError' },
};

/** In-sentence forms for the two the patient rail reads out. */
export const SEX_AT_BIRTH_INLINE: Record<AdministrativeGender, { labelKey: string }> = {
  FEMALE: { labelKey: 'chart.sexAtBirth.inline.female' },
  MALE: { labelKey: 'chart.sexAtBirth.inline.male' },
  OTHER: { labelKey: 'chart.sexAtBirth.inline.other' },
  UNKNOWN: { labelKey: 'chart.sexAtBirth.inline.unknown' },
};

/**
 * `NORMAL` is present and never rendered: the rail only raises a privacy flag
 * for a chart that is restricted. Complete anyway, because a `Partial` here
 * would make every read optional and push a `?? ''` to the call site, which is
 * how a missing word becomes a blank instead of an error.
 */
export const SENSITIVITY_INLINE: Record<SensitivityClass, { labelKey: string }> = {
  NORMAL: { labelKey: 'chart.sensitivity.inline.normal' },
  RESTRICTED: { labelKey: 'chart.sensitivity.inline.restricted' },
  VERY_RESTRICTED: { labelKey: 'chart.sensitivity.inline.veryRestricted' },
};
