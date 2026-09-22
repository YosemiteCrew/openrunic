import type { AdministrativeGender, Appointment, SensitivityClass } from '@/lib/api';
import type {
  AllergyCategory,
  AllergySeverity,
  CareTeamRelationship,
  MedicationSource,
  MedicationStatus,
  NoteState,
  ProblemStatus,
} from '@/lib/api/chart/types';

/**
 * What this application calls its own chart enums, as catalogue keys.
 *
 * `lib/api/chart/types.ts` claims every enum in it mirrors one in
 * `@openrunic/database`, and that claim is not true: `AllergyCategory`,
 * `MedicationSource` and `NoteState` are Prisma enums, while `AllergySeverity`,
 * `CareTeamRelationship` and `ProblemStatus` exist only in the web contract.
 * That file has been corrected; this note records it because the difference
 * looks like it should decide something and does not.
 *
 * What decides it is whether anything outside this codebase supplies a display,
 * and for every one of these the answer is no. A Prisma enum stores the member,
 * not a word for it; a view-model union does not even do that. Either way the
 * API sends `SEVERE` and says nothing about what to call it, so
 * `formatEnumLabel` was inventing the English and the codebase was then reading
 * its own invention back as somebody else's name for the value.
 *
 * An allergen, a reaction, a medication's name and a problem's code ARE named
 * elsewhere, and they stay exactly as they arrived.
 * *
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
  REPORTED: { labelKey: 'chart.medicationSource.reported' },
  PRESCRIBED: { labelKey: 'chart.medicationSource.prescribed' },
  RECONCILED: { labelKey: 'chart.medicationSource.reconciled' },
  IMPORTED: { labelKey: 'chart.medicationSource.imported' },
};

/**
 * Every medication state, each with its own words.
 *
 * A `Record` over the union, so adding a state to `MedicationStatus` fails to
 * compile here instead of rendering as a raw enum name or, worse, as the wrong
 * neighbour. `medicationStatusLabelKey` below reads it with a fallback, and
 * says why that is not the same thing as typing it with one.
 */
export const MEDICATION_STATUS_LABELS: Record<MedicationStatus, { labelKey: string }> = {
  ACTIVE: { labelKey: 'chart.medicationStatus.active' },
  COMPLETED: { labelKey: 'chart.medicationStatus.completed' },
  ENTERED_IN_ERROR: { labelKey: 'chart.medicationStatus.enteredInError' },
  INTENDED: { labelKey: 'chart.medicationStatus.intended' },
  NOT_TAKEN: { labelKey: 'chart.medicationStatus.notTaken' },
  ON_HOLD: { labelKey: 'chart.medicationStatus.onHold' },
  STOPPED: { labelKey: 'chart.medicationStatus.stopped' },
  UNKNOWN: { labelKey: 'chart.medicationStatus.unknown' },
};

/**
 * A word for a medication enum member that arrived over the wire.
 *
 * The two `Record`s here are exhaustive over the unions above, and that is a
 * claim about this build rather than about the server. `requestJson` casts the
 * response body instead of parsing it, so the `status` and `source` on a
 * medication row are whatever the API sent: a member added to the Prisma enum
 * before this build knows the word for it reaches these lookups, and an indexed
 * read of it is `undefined`. `undefined.labelKey` is a `TypeError` thrown during
 * render, which `DowntimeBoundary` in `app/_shell/AppShell.tsx` catches - it
 * wraps `SessionGate`, so it is above every signed-in screen rather than around
 * this panel. Caught is not contained: the boundary replaces everything inside
 * it, so one row this build has no word for costs the reader the whole screen -
 * no tabs, no patient rail, no navigation, and the seven medications the build
 * *can* name gone with the one it cannot. Measured on a running chart at
 * `/patients/<id>`, not inferred: the page renders "this screen could not be
 * displayed" and a reference code, and `getByRole('tab')` counts zero.
 *
 * So the read is widened to a string key deliberately, which is what the value
 * actually is at this boundary, and the fallback is load-bearing rather than
 * defensive: the type cannot see the case, so nothing but this stops it. The
 * `Record` type is unchanged, so adding a member to `MedicationStatus` still
 * fails to compile above rather than silently landing on the fallback here.
 *
 * `unrecognised` is deliberately not `UNKNOWN`. `UNKNOWN` is a state the API
 * records, and it means nobody knows whether the patient takes the medication.
 * This means the API knows the state and this build has no word for it. They are
 * different sentences to a prescriber and folding one into the other is the same
 * defect the panel's complement exists to prevent.
 */
const WIDENED_STATUS: Record<string, { labelKey: string } | undefined> = MEDICATION_STATUS_LABELS;
const WIDENED_SOURCE: Record<string, { labelKey: string } | undefined> = MEDICATION_SOURCE_LABELS;

export function medicationStatusLabelKey(status: MedicationStatus): string {
  return WIDENED_STATUS[status]?.labelKey ?? 'chart.medicationStatus.unrecognised';
}

export function medicationSourceLabelKey(source: MedicationSource): string {
  return WIDENED_SOURCE[source]?.labelKey ?? 'chart.medicationSource.unrecognised';
}

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
