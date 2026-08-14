/**
 * WHAT A DOCUMENT CARRIES, INDEPENDENT OF HOW IT IS WRITTEN.
 *
 * This is not a Prisma row and not a FHIR resource. It is the small shape that
 * sits between them and the XML, and it exists so that the codec can be tested
 * without a database and so that the mapping from the practice's tables is one
 * readable function rather than a hundred lines of XML building interleaved with
 * repository calls.
 *
 * Everything optional here is optional in real charts. A medication with no stop
 * date is an active one; an allergy with no reaction recorded is the majority of
 * allergies; a result with no interpretation is a normal result at a laboratory
 * that does not flag them. Making any of these required would mean inventing a
 * value, and an invented value in a document another clinician reads is worse
 * than an absent one.
 */

/** A code, a system, and something a human can read. */
export interface CodedValue {
  /** Absent when the practice recorded a name and no code, which happens. */
  readonly code?: string;
  /** OID of the code system. Required whenever `code` is present. */
  readonly codeSystem?: string;
  readonly display: string;
}

export interface Address {
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

export type AdministrativeGender = 'male' | 'female' | 'other' | 'unknown';

export interface DocumentPatient {
  readonly id: string;
  readonly mrn: string;
  readonly givenName: string;
  readonly familyName: string;
  /** `YYYY-MM-DD`. A date, never an instant: see time.ts. */
  readonly birthDate: string;
  readonly gender: AdministrativeGender;
  readonly languageCode?: string;
  readonly address?: Address;
  readonly phone?: string;
  readonly email?: string;
}

export interface Organisation {
  /** OID or other stable identifier for the practice. */
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly address?: Address;
}

export interface Author {
  readonly id: string;
  readonly givenName: string;
  readonly familyName: string;
  /** NPI where the practice holds one. */
  readonly npi?: string;
}

export type ClinicalStatus = 'active' | 'completed' | 'aborted' | 'suspended';

export interface AllergyEntry {
  readonly id: string;
  readonly substance: CodedValue;
  readonly reaction?: string;
  readonly criticality?: 'low' | 'high' | 'unable-to-assess';
  readonly status: ClinicalStatus;
  /** `YYYY-MM-DD`. */
  readonly onsetDate?: string;
}

export interface MedicationEntry {
  readonly id: string;
  readonly medication: CodedValue;
  /** The instruction as written for the patient. */
  readonly sig?: string;
  readonly status: ClinicalStatus;
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface ProblemEntry {
  readonly id: string;
  readonly problem: CodedValue;
  readonly status: ClinicalStatus;
  readonly onsetDate?: string;
  readonly resolvedDate?: string;
}

export interface ObservationEntry {
  readonly id: string;
  readonly code: CodedValue;
  /** The measured value, as recorded. Absent for a qualitative result. */
  readonly value?: string;
  /** UCUM unit. Absent when the value has none. */
  readonly unit?: string;
  /** ISO instant or `YYYY-MM-DD`. */
  readonly effectiveAt?: string;
  /** `N`, `H`, `L`, `A` and the rest of the HL7 interpretation codes. */
  readonly interpretation?: string;
  readonly referenceRange?: string;
}

export interface ResultEntry {
  readonly id: string;
  /** The panel or battery the observations belong to. */
  readonly panel: CodedValue;
  readonly effectiveAt?: string;
  readonly observations: readonly ObservationEntry[];
}

export interface ImmunisationEntry {
  readonly id: string;
  readonly vaccine: CodedValue;
  readonly administeredAt?: string;
  readonly status: ClinicalStatus;
  readonly lotNumber?: string;
}

export interface EncounterEntry {
  readonly id: string;
  readonly type: CodedValue;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly facilityName?: string;
}

export interface PlanEntry {
  readonly id: string;
  readonly activity: CodedValue;
  readonly scheduledFor?: string;
  readonly status: ClinicalStatus;
}

/** Smoking status and the rest: a coded observation about the person. */
export interface SocialHistoryEntry {
  readonly id: string;
  readonly observation: CodedValue;
  readonly value: CodedValue;
  readonly effectiveAt?: string;
}

/**
 * A Continuity of Care Document.
 *
 * Every section list may be empty. An empty section is still written, with the
 * `nullFlavor` the specification asks for, because "this practice has no
 * allergies recorded for this patient" and "this document does not cover
 * allergies" are different statements and a receiving clinician needs to know
 * which one they are reading.
 */
export interface CcdDocument {
  /** Stable identifier for this document instance. */
  readonly id: string;
  readonly title: string;
  /** When the document was assembled. ISO instant. */
  readonly effectiveAt: string;
  readonly patient: DocumentPatient;
  readonly custodian: Organisation;
  readonly author: Author;
  /** The span of care the document summarises, when it covers one. */
  readonly coveringPeriod?: { readonly start: string; readonly end?: string };
  readonly allergies: readonly AllergyEntry[];
  readonly medications: readonly MedicationEntry[];
  readonly problems: readonly ProblemEntry[];
  readonly results: readonly ResultEntry[];
  readonly vitals: readonly ResultEntry[];
  readonly immunisations: readonly ImmunisationEntry[];
  readonly encounters: readonly EncounterEntry[];
  readonly plan: readonly PlanEntry[];
  readonly socialHistory: readonly SocialHistoryEntry[];
}
