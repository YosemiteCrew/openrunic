/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  codeableConcept,
  compact,
  money,
  period,
  present,
  readCents,
  readCode,
  readString,
  setOptional,
} from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

const COVERAGE_CLASS_SYSTEM = 'http://terminology.hl7.org/CodeSystem/coverage-class';

/** Coordination-of-benefits position. Three slots means three Coverage rows. */
export type DomainCoverageRank = 'PRIMARY' | 'SECONDARY' | 'TERTIARY';

export type DomainCoverageStatus = 'DRAFT' | 'ACTIVE' | 'CANCELLED' | 'ENTERED_IN_ERROR';

const COVERAGE_STATUS = enumMapping<DomainCoverageStatus, fhir4.Coverage['status']>({
  map: {
    DRAFT: 'draft',
    ACTIVE: 'active',
    CANCELLED: 'cancelled',
    ENTERED_IN_ERROR: 'entered-in-error',
  },
  fallback: 'ACTIVE',
});

const RANK_ORDER: Record<DomainCoverageRank, number> = {
  PRIMARY: 1,
  SECONDARY: 2,
  TERTIARY: 3,
};

const ORDER_RANK: Record<number, DomainCoverageRank> = {
  1: 'PRIMARY',
  2: 'SECONDARY',
  3: 'TERTIARY',
};

/** One insurance policy in one coordination-of-benefits slot. */
export interface DomainCoverage {
  id: string;
  patientId: string;
  payerId: string;
  rank: DomainCoverageRank;
  status: DomainCoverageStatus;
  memberId: string;
  groupNumber?: string;
  planName?: string;
  /** Subscriber relationship to the patient, e.g. `self`, `spouse`. */
  subscriberRelationshipCode: string;
  /** ISO 8601 date. */
  effectiveFrom?: string;
  /** ISO 8601 date. */
  effectiveTo?: string;
  copayCents?: number;
  deductibleCents?: number;
}

/**
 * Coverage columns with no FHIR R4 home.
 *
 * Subscriber demographics exist for the 837P NM1/DMG loops, and R4's
 * `Coverage.subscriber` is a reference, not a name and a date of birth.
 * `acceptAssignment` is an adjudication instruction that R4 carries on
 * ExplanationOfBenefit rather than Coverage. Both stay inside the billing
 * service, which is the only consumer that needs them.
 */
export const COVERAGE_DROPPED_FIELDS = [
  'tenantId',
  'subscriberGivenName',
  'subscriberFamilyName',
  'subscriberBirthDate',
  'acceptAssignment',
  'createdAt',
  'updatedAt',
] as const;

/** Maps a {@link DomainCoverage} to a FHIR R4 `Coverage`. */
export function toFhirCoverage(input: DomainCoverage): fhir4.Coverage {
  const classes = present<fhir4.CoverageClass>([
    input.groupNumber === undefined || input.groupNumber === ''
      ? undefined
      : {
          type: codeableConcept({ system: COVERAGE_CLASS_SYSTEM, code: 'group' }) ?? {},
          value: input.groupNumber,
        },
    input.planName === undefined || input.planName === ''
      ? undefined
      : {
          type: codeableConcept({ system: COVERAGE_CLASS_SYSTEM, code: 'plan' }) ?? {},
          value: input.planName,
        },
  ]);

  const costs = present<fhir4.CoverageCostToBeneficiary>([
    input.copayCents === undefined
      ? undefined
      : {
          type: codeableConcept({ system: SYSTEMS.coverageCopayType, code: 'copay' }),
          valueMoney: money(input.copayCents),
        },
    input.deductibleCents === undefined
      ? undefined
      : {
          type: codeableConcept({ system: SYSTEMS.coverageCopayType, code: 'deductible' }),
          valueMoney: money(input.deductibleCents),
        },
  ]);

  return compact<fhir4.Coverage>({
    resourceType: 'Coverage',
    id: input.id,
    status: COVERAGE_STATUS.toFhir(input.status),
    subscriberId: input.memberId,
    beneficiary: fhirReference('Patient', input.patientId),
    relationship: codeableConcept({
      system: SYSTEMS.subscriberRelationship,
      code: input.subscriberRelationshipCode,
    }),
    period: period(input.effectiveFrom, input.effectiveTo),
    payor: [fhirReference('Organization', input.payerId)],
    class: classes,
    order: RANK_ORDER[input.rank],
    costToBeneficiary: costs,
  });
}

function readClassValue(
  classes: fhir4.CoverageClass[] | undefined,
  code: string
): string | undefined {
  for (const entry of classes ?? []) {
    if (readCode(entry.type, COVERAGE_CLASS_SYSTEM) === code) {
      return readString(entry.value);
    }
  }
  return undefined;
}

function readCostCents(
  costs: fhir4.CoverageCostToBeneficiary[] | undefined,
  code: string
): number | undefined {
  for (const entry of costs ?? []) {
    if (readCode(entry.type, SYSTEMS.coverageCopayType) === code) {
      return readCents(entry.valueMoney);
    }
  }
  return undefined;
}

/** Maps a FHIR R4 `Coverage` back to a {@link DomainCoverage}. */
export function fromFhirCoverage(resource: fhir4.Coverage): DomainCoverage {
  const payor = resource.payor?.[0];
  const domain: DomainCoverage = {
    id: resource.id ?? '',
    patientId: referenceId(resource.beneficiary, 'Patient') ?? '',
    payerId: referenceId(payor, 'Organization') ?? '',
    rank: (resource.order === undefined ? undefined : ORDER_RANK[resource.order]) ?? 'PRIMARY',
    status: COVERAGE_STATUS.fromFhir(resource.status),
    memberId: resource.subscriberId ?? '',
    subscriberRelationshipCode:
      readCode(resource.relationship, SYSTEMS.subscriberRelationship) ?? '',
  };
  setOptional(domain, 'groupNumber', readClassValue(resource.class, 'group'));
  setOptional(domain, 'planName', readClassValue(resource.class, 'plan'));
  setOptional(domain, 'effectiveFrom', readString(resource.period?.start));
  setOptional(domain, 'effectiveTo', readString(resource.period?.end));
  setOptional(domain, 'copayCents', readCostCents(resource.costToBeneficiary, 'copay'));
  setOptional(domain, 'deductibleCents', readCostCents(resource.costToBeneficiary, 'deductible'));
  return domain;
}
