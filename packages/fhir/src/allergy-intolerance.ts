/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  annotations,
  codeableConcept,
  codeableConcepts,
  compact,
  present,
  readAnnotation,
  readCode,
  readCodes,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

export type DomainAllergyType = 'ALLERGY' | 'INTOLERANCE';
export type DomainAllergyCategory = 'FOOD' | 'MEDICATION' | 'ENVIRONMENT' | 'BIOLOGIC';
export type DomainAllergyCriticality = 'LOW' | 'HIGH' | 'UNABLE_TO_ASSESS';
export type DomainAllergyClinicalStatus = 'ACTIVE' | 'INACTIVE' | 'RESOLVED';
export type DomainReactionSeverity = 'MILD' | 'MODERATE' | 'SEVERE';

const ALLERGY_TYPE = enumMapping<DomainAllergyType, NonNullable<fhir4.AllergyIntolerance['type']>>({
  map: { ALLERGY: 'allergy', INTOLERANCE: 'intolerance' },
  fallback: 'ALLERGY',
});

type FhirAllergyCategory = NonNullable<fhir4.AllergyIntolerance['category']>[number];
type FhirReactionSeverity = NonNullable<fhir4.AllergyIntoleranceReaction['severity']>;

const ALLERGY_CATEGORY = enumMapping<DomainAllergyCategory, FhirAllergyCategory>({
  map: {
    FOOD: 'food',
    MEDICATION: 'medication',
    ENVIRONMENT: 'environment',
    BIOLOGIC: 'biologic',
  },
  fallback: 'MEDICATION',
});

const ALLERGY_CRITICALITY = enumMapping<
  DomainAllergyCriticality,
  NonNullable<fhir4.AllergyIntolerance['criticality']>
>({
  map: { LOW: 'low', HIGH: 'high', UNABLE_TO_ASSESS: 'unable-to-assess' },
  fallback: 'UNABLE_TO_ASSESS',
});

const ALLERGY_CLINICAL_STATUS = enumMapping<DomainAllergyClinicalStatus, string>({
  map: { ACTIVE: 'active', INACTIVE: 'inactive', RESOLVED: 'resolved' },
  fallback: 'ACTIVE',
});

const REACTION_SEVERITY = enumMapping<DomainReactionSeverity, FhirReactionSeverity>({
  map: { MILD: 'mild', MODERATE: 'moderate', SEVERE: 'severe' },
  fallback: 'MILD',
});

/** A substance the patient reacts to, with the reaction it produced. */
export interface DomainAllergyIntolerance {
  id: string;
  patientId: string;
  type: DomainAllergyType;
  category: DomainAllergyCategory;
  criticality: DomainAllergyCriticality;
  clinicalStatus: DomainAllergyClinicalStatus;
  /** RxNorm or SNOMED CT substance code. */
  substanceCode?: string;
  substanceCodeSystem?: string;
  substanceDisplay: string;
  /** SNOMED CT manifestation codes. */
  reactionCodes: string[];
  reactionText?: string;
  severity?: DomainReactionSeverity;
  /** ISO 8601 date. */
  onsetDate?: string;
  note?: string;
  /** ISO 8601 instant. */
  recordedAt: string;
}

/** `recordedById` is provenance and is served as a Provenance resource. */
export const ALLERGY_INTOLERANCE_DROPPED_FIELDS = [
  'tenantId',
  'recordedById',
  'createdAt',
  'updatedAt',
] as const;

/**
 * FHIR requires at least one manifestation inside a reaction. When Openrunic
 * has a severity or a free-text description but no coded manifestation, the
 * mapper emits a text-only manifestation so the resource stays valid; reading
 * it back yields the same empty code list.
 */
const UNCODED_MANIFESTATION = 'Unspecified reaction';

/** Maps a {@link DomainAllergyIntolerance} to a FHIR R4 `AllergyIntolerance`. */
export function toFhirAllergyIntolerance(
  input: DomainAllergyIntolerance
): fhir4.AllergyIntolerance {
  const hasReaction =
    input.reactionCodes.length > 0 ||
    input.reactionText !== undefined ||
    input.severity !== undefined;

  const manifestation =
    input.reactionCodes.length > 0
      ? codeableConcepts(input.reactionCodes, SYSTEMS.snomed)
      : [{ text: UNCODED_MANIFESTATION }];

  const reaction: fhir4.AllergyIntoleranceReaction[] = hasReaction
    ? [
        compact<fhir4.AllergyIntoleranceReaction>({
          manifestation,
          description: input.reactionText,
          severity:
            input.severity === undefined ? undefined : REACTION_SEVERITY.toFhir(input.severity),
        }),
      ]
    : [];

  return compact<fhir4.AllergyIntolerance>({
    resourceType: 'AllergyIntolerance',
    id: input.id,
    clinicalStatus: codeableConcept({
      system: SYSTEMS.allergyClinical,
      code: ALLERGY_CLINICAL_STATUS.toFhir(input.clinicalStatus),
    }),
    type: ALLERGY_TYPE.toFhir(input.type),
    category: [ALLERGY_CATEGORY.toFhir(input.category)],
    criticality: ALLERGY_CRITICALITY.toFhir(input.criticality),
    code: compact<fhir4.CodeableConcept>({
      coding: present<fhir4.Coding>([
        input.substanceCode === undefined || input.substanceCode === ''
          ? undefined
          : compact({ system: input.substanceCodeSystem, code: input.substanceCode }),
      ]),
      text: input.substanceDisplay === '' ? undefined : input.substanceDisplay,
    }),
    patient: fhirReference('Patient', input.patientId),
    onsetDateTime: input.onsetDate,
    recordedDate: input.recordedAt,
    note: annotations(input.note),
    reaction,
  });
}

/** Maps a FHIR R4 `AllergyIntolerance` back to a {@link DomainAllergyIntolerance}. */
export function fromFhirAllergyIntolerance(
  resource: fhir4.AllergyIntolerance
): DomainAllergyIntolerance {
  const primary = resource.code?.coding?.[0];
  const reaction = resource.reaction?.[0];

  const domain: DomainAllergyIntolerance = {
    id: resource.id ?? '',
    patientId: referenceId(resource.patient, 'Patient') ?? '',
    type: ALLERGY_TYPE.fromFhir(resource.type),
    category: ALLERGY_CATEGORY.fromFhir(resource.category?.[0]),
    criticality: ALLERGY_CRITICALITY.fromFhir(resource.criticality),
    clinicalStatus: ALLERGY_CLINICAL_STATUS.fromFhir(
      readCode(resource.clinicalStatus, SYSTEMS.allergyClinical)
    ),
    substanceDisplay: resource.code?.text ?? '',
    reactionCodes: readCodes(reaction?.manifestation, SYSTEMS.snomed),
    recordedAt: resource.recordedDate ?? '',
  };
  setOptional(domain, 'substanceCode', readString(primary?.code));
  setOptional(domain, 'substanceCodeSystem', readString(primary?.system));
  setOptional(domain, 'reactionText', readString(reaction?.description));
  if (reaction?.severity !== undefined) {
    domain.severity = REACTION_SEVERITY.fromFhir(reaction.severity);
  }
  setOptional(domain, 'onsetDate', readString(resource.onsetDateTime));
  setOptional(domain, 'note', readAnnotation(resource.note));
  return domain;
}
