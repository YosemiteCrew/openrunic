/**
 * Every identifier the codec writes, in one place.
 *
 * CDA is built out of OIDs, and an OID with a digit wrong produces a document
 * that parses perfectly and means something else: a receiving system matches on
 * `templateId/@root` to decide which template it is reading, so a typo in one of
 * these turns a medication list into an unrecognised section that the other side
 * files and never shows anybody.
 *
 * They live here rather than beside the code that writes them so that the values
 * can be read against the published tables in one pass, which is the only review
 * of this data that actually catches anything.
 */

/** The code systems referenced by identity and by name. */
export const CODE_SYSTEMS = {
  LOINC: { oid: '2.16.840.1.113883.6.1', name: 'LOINC' },
  SNOMED: { oid: '2.16.840.1.113883.6.96', name: 'SNOMED CT' },
  RXNORM: { oid: '2.16.840.1.113883.6.88', name: 'RxNorm' },
  ICD10CM: { oid: '2.16.840.1.113883.6.90', name: 'ICD-10-CM' },
  CVX: { oid: '2.16.840.1.113883.12.292', name: 'CVX' },
  CPT: { oid: '2.16.840.1.113883.6.12', name: 'CPT' },
  UCUM: { oid: '2.16.840.1.113883.6.8', name: 'UCUM' },
  ACT_CODE: { oid: '2.16.840.1.113883.5.4', name: 'HL7ActCode' },
  ADMIN_GENDER: { oid: '2.16.840.1.113883.5.1', name: 'AdministrativeGender' },
  CONFIDENTIALITY: { oid: '2.16.840.1.113883.5.25', name: 'Confidentiality' },
  OBSERVATION_INTERPRETATION: { oid: '2.16.840.1.113883.5.83', name: 'ObservationInterpretation' },
} as const;

/** Document-level template identifiers. */
export const DOCUMENT_TEMPLATES = {
  /** US Realm Header. */
  US_REALM_HEADER: { root: '2.16.840.1.113883.10.20.22.1.1', extension: '2015-08-01' },
  /** Continuity of Care Document. */
  CCD: { root: '2.16.840.1.113883.10.20.22.1.2', extension: '2015-08-01' },
} as const;

/** `ClinicalDocument/typeId`, which is the same on every CDA release 2 document. */
export const CDA_TYPE_ID = { root: '2.16.840.1.113883.1.3', extension: 'POCD_HD000040' } as const;

/** The document code: LOINC 34133-9, Summarization of Episode Note. */
export const CCD_DOCUMENT_CODE = {
  code: '34133-9',
  display: 'Summarization of Episode Note',
} as const;

/**
 * Section templates.
 *
 * Each carries the entries-required variant where one exists, because a section
 * this codec writes always writes entries. Declaring the entries-optional
 * template over a section that has machine-readable entries understates the
 * document, and a receiving system that chooses between narrative and entries on
 * the template id would then read the narrative.
 */
export const SECTION_TEMPLATES = {
  ALLERGIES: { root: '2.16.840.1.113883.10.20.22.2.6.1', extension: '2015-08-01' },
  MEDICATIONS: { root: '2.16.840.1.113883.10.20.22.2.1.1', extension: '2014-06-09' },
  PROBLEMS: { root: '2.16.840.1.113883.10.20.22.2.5.1', extension: '2015-08-01' },
  RESULTS: { root: '2.16.840.1.113883.10.20.22.2.3.1', extension: '2015-08-01' },
  VITALS: { root: '2.16.840.1.113883.10.20.22.2.4.1', extension: '2015-08-01' },
  IMMUNISATIONS: { root: '2.16.840.1.113883.10.20.22.2.2.1', extension: '2015-08-01' },
  ENCOUNTERS: { root: '2.16.840.1.113883.10.20.22.2.22.1', extension: '2015-08-01' },
  PLAN_OF_TREATMENT: { root: '2.16.840.1.113883.10.20.22.2.10', extension: '2014-06-09' },
  SOCIAL_HISTORY: { root: '2.16.840.1.113883.10.20.22.2.17', extension: '2015-08-01' },
} as const;

/** Entry-level templates, one per clinical statement this codec writes. */
export const ENTRY_TEMPLATES = {
  ALLERGY_CONCERN: { root: '2.16.840.1.113883.10.20.22.4.30', extension: '2015-08-01' },
  ALLERGY_OBSERVATION: { root: '2.16.840.1.113883.10.20.22.4.7', extension: '2014-06-09' },
  REACTION_OBSERVATION: { root: '2.16.840.1.113883.10.20.22.4.9', extension: '2014-06-09' },
  CRITICALITY_OBSERVATION: { root: '2.16.840.1.113883.10.20.22.4.145', extension: undefined },
  MEDICATION_ACTIVITY: { root: '2.16.840.1.113883.10.20.22.4.16', extension: '2014-06-09' },
  PROBLEM_CONCERN: { root: '2.16.840.1.113883.10.20.22.4.3', extension: '2015-08-01' },
  PROBLEM_OBSERVATION: { root: '2.16.840.1.113883.10.20.22.4.4', extension: '2015-08-01' },
  RESULT_ORGANISER: { root: '2.16.840.1.113883.10.20.22.4.1', extension: '2015-08-01' },
  RESULT_OBSERVATION: { root: '2.16.840.1.113883.10.20.22.4.2', extension: '2015-08-01' },
  VITAL_SIGNS_ORGANISER: { root: '2.16.840.1.113883.10.20.22.4.26', extension: '2015-08-01' },
  VITAL_SIGN_OBSERVATION: { root: '2.16.840.1.113883.10.20.22.4.27', extension: '2014-06-09' },
  IMMUNISATION_ACTIVITY: { root: '2.16.840.1.113883.10.20.22.4.52', extension: '2015-08-01' },
  ENCOUNTER_ACTIVITY: { root: '2.16.840.1.113883.10.20.22.4.49', extension: '2015-08-01' },
  PLANNED_ACT: { root: '2.16.840.1.113883.10.20.22.4.39', extension: '2014-06-09' },
  SOCIAL_HISTORY_OBSERVATION: { root: '2.16.840.1.113883.10.20.22.4.38', extension: '2015-08-01' },
} as const;

export interface TemplateId {
  readonly root: string;
  readonly extension?: string;
}
