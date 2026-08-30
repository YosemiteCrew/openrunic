/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import {
  codeExtension,
  localStatusExtension,
  openrunicCodeSystem,
  openrunicExtension,
  readCodeExtension,
  readLocalStatus,
} from './extensions.js';
import {
  codeableConcept,
  codeableConcepts,
  compact,
  money,
  present,
  readCents,
  readCode,
  readCodes,
  readQuantityValue,
  readString,
  setOptional,
  simpleQuantity,
} from './primitives.js';
import { fhirReference, optionalReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/** Carries the 837P CLM05-3 frequency code, which R4 Claim does not model. */
export const CLAIM_FREQUENCY_EXTENSION = openrunicExtension('claim-frequency');

/** Code system for Openrunic's claim frequency values. */
export const CLAIM_FREQUENCY_SYSTEM = openrunicCodeSystem('claim-frequency');

export type DomainClaimStatus =
  | 'DRAFT'
  | 'SCRUBBED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'DENIED'
  | 'PAID'
  | 'PARTIAL'
  | 'REBILLED'
  | 'VOID';

export type DomainClaimFrequency = 'ORIGINAL' | 'REPLACEMENT' | 'VOID';

const CLAIM_FREQUENCIES: readonly DomainClaimFrequency[] = ['ORIGINAL', 'REPLACEMENT', 'VOID'];

/**
 * The claim lifecycle ledger has ten states; FHIR R4 `Claim.status` has four,
 * because R4 puts adjudication on ClaimResponse. Seven of the ten therefore
 * also travel in the local-status extension, which is what keeps a submitted,
 * denied and rebilled claim distinguishable over the API.
 */
export const CLAIM_STATUS = enumMapping<DomainClaimStatus, fhir4.Claim['status']>({
  map: {
    DRAFT: 'draft',
    SCRUBBED: 'draft',
    SUBMITTED: 'active',
    ACKNOWLEDGED: 'active',
    REJECTED: 'active',
    DENIED: 'active',
    PAID: 'active',
    PARTIAL: 'active',
    REBILLED: 'active',
    VOID: 'cancelled',
  },
  canonical: { draft: 'DRAFT', active: 'SUBMITTED', cancelled: 'VOID' },
  fallback: 'DRAFT',
});

/** One service line on a claim. */
export interface DomainClaimLine {
  sequence: number;
  /** CPT or HCPCS code. */
  code: string;
  codeSystem: string;
  modifiers: string[];
  units: number;
  chargedCents: number;
  /** 1-based indices into the claim's diagnosis list (837P SV107). */
  diagnosisPointers: number[];
  /** ISO 8601 date. */
  serviceDateFrom: string;
  /** ISO 8601 date. */
  serviceDateTo?: string;
}

/** A professional claim, as submitted. */
export interface DomainClaim {
  id: string;
  patientId: string;
  coverageId: string;
  payerId: string;
  /** Billing provider; the API resolves it from the encounter. */
  providerId: string;
  /**
   * What `providerId` names.
   *
   * R4 allows `Claim.provider` to reference a Practitioner, a PractitionerRole
   * or an Organization, and this server needs two of those: the person who
   * treated the patient normally, and the practice itself when the encounter
   * behind the claim is unreadable in the caller's scope. Emitting the second
   * as `Practitioner/{id}` shipped a reference to a Practitioner that does not
   * exist, and once Organization was served it resolved - at the wrong type,
   * which is harder to notice than a 404.
   *
   * Absent means Practitioner, so a caller that has only ever had people here
   * keeps working.
   */
  providerType?: 'Practitioner' | 'Organization';
  status: DomainClaimStatus;
  frequency: DomainClaimFrequency;
  /** Claim-level diagnosis list; line pointers index into it. */
  diagnosisCodes: string[];
  totalChargedCents: number;
  /** ISO 8601 instant. */
  createdAt: string;
  lines: DomainClaimLine[];
}

/**
 * Claim columns that stay inside Openrunic.
 *
 * Adjudicated money (`totalPaidCents`, `totalAdjustedCents`,
 * `patientResponsibilityCents`) belongs to ClaimResponse and to the remittance
 * ledger, not to the claim as submitted. `snapshot` and `controlNumbers` are
 * the as-built X12 payload, `id`-linked correction chains (`secondaryOfId`,
 * `priorClaimId`) are lifecycle plumbing, and `ClaimLine.chargeItemId` links a
 * line back to the fee sheet, which no FHIR element carries.
 *
 * `encounterId` is dropped because R4 hangs the encounter off each
 * `Claim.item`, one per line: Openrunic bills one encounter per claim, so
 * repeating it on every line would encode the same fact many times and lose it
 * entirely on a claim with no lines yet.
 */
export const CLAIM_DROPPED_FIELDS = [
  'tenantId',
  'encounterId',
  'totalPaidCents',
  'totalAdjustedCents',
  'patientResponsibilityCents',
  'secondaryOfId',
  'priorClaimId',
  'controlNumbers',
  'snapshot',
  'statusReason',
  'submittedAt',
  'acknowledgedAt',
  'adjudicatedAt',
  'chargeItemId',
  'updatedAt',
] as const;

function toClaimItem(line: DomainClaimLine): fhir4.ClaimItem {
  return compact<fhir4.ClaimItem>({
    sequence: line.sequence,
    diagnosisSequence: line.diagnosisPointers,
    productOrService:
      codeableConcept({ system: line.codeSystem, code: line.code }) ??
      ({} as fhir4.CodeableConcept),
    modifier: codeableConcepts(line.modifiers, SYSTEMS.cpt),
    servicedDate: line.serviceDateFrom,
    servicedPeriod:
      line.serviceDateTo === undefined || line.serviceDateTo === ''
        ? undefined
        : { start: line.serviceDateFrom, end: line.serviceDateTo },
    quantity: simpleQuantity(line.units),
    net: money(line.chargedCents),
  });
}

function fromClaimItem(item: fhir4.ClaimItem): DomainClaimLine {
  const coding = item.productOrService?.coding?.[0];
  const line: DomainClaimLine = {
    sequence: item.sequence ?? 0,
    code: coding?.code ?? '',
    codeSystem: coding?.system ?? '',
    modifiers: readCodes(item.modifier, SYSTEMS.cpt),
    units: readQuantityValue(item.quantity) ?? 0,
    chargedCents: readCents(item.net) ?? 0,
    diagnosisPointers: item.diagnosisSequence ? [...item.diagnosisSequence] : [],
    serviceDateFrom: item.servicedDate ?? item.servicedPeriod?.start ?? '',
  };
  setOptional(line, 'serviceDateTo', readString(item.servicedPeriod?.end));
  return line;
}

/** Maps a {@link DomainClaim} to a FHIR R4 `Claim`. */
export function toFhirClaim(input: DomainClaim): fhir4.Claim {
  const diagnosis: fhir4.ClaimDiagnosis[] = input.diagnosisCodes.map((code, index) => ({
    sequence: index + 1,
    diagnosisCodeableConcept: codeableConcept({ system: SYSTEMS.icd10cm, code }) ?? {},
  }));

  return compact<fhir4.Claim>({
    resourceType: 'Claim',
    id: input.id,
    extension: present<fhir4.Extension>([
      localStatusExtension(CLAIM_STATUS, input.status),
      codeExtension(CLAIM_FREQUENCY_EXTENSION, input.frequency),
    ]),
    status: CLAIM_STATUS.toFhir(input.status),
    type: codeableConcept({ system: SYSTEMS.claimType, code: 'professional' }) ?? {},
    use: 'claim',
    patient: fhirReference('Patient', input.patientId),
    created: input.createdAt,
    provider: fhirReference(input.providerType ?? 'Practitioner', input.providerId),
    priority: codeableConcept({ system: SYSTEMS.processPriority, code: 'normal' }) ?? {},
    insurance: [
      {
        sequence: 1,
        focal: true,
        coverage: fhirReference('Coverage', input.coverageId),
      },
    ],
    insurer: optionalReference('Organization', input.payerId),
    diagnosis,
    item: input.lines.map(toClaimItem),
    total: money(input.totalChargedCents),
  });
}

/** The billing provider and what it is, from either reference type. */
function readProvider(reference: fhir4.Reference | undefined): {
  providerId: string;
  providerType?: 'Organization';
} {
  const organisation = referenceId(reference, 'Organization');
  if (organisation !== undefined) return { providerId: organisation, providerType: 'Organization' };
  return { providerId: referenceId(reference, 'Practitioner') ?? '' };
}

/** Maps a FHIR R4 `Claim` back to a {@link DomainClaim}. */
export function fromFhirClaim(resource: fhir4.Claim): DomainClaim {
  const frequency = readCodeExtension(resource.extension, CLAIM_FREQUENCY_EXTENSION);
  const domain: DomainClaim = {
    id: resource.id ?? '',
    patientId: referenceId(resource.patient, 'Patient') ?? '',
    coverageId: referenceId(resource.insurance?.[0]?.coverage, 'Coverage') ?? '',
    payerId: referenceId(resource.insurer, 'Organization') ?? '',
    // Reads back whichever of the two types it was written as, so the
    // round trip does not quietly turn the practice into a practitioner.
    ...readProvider(resource.provider),
    status: readLocalStatus(CLAIM_STATUS, resource.extension, resource.status),
    frequency: CLAIM_FREQUENCIES.find((value) => value === frequency) ?? 'ORIGINAL',
    diagnosisCodes: (resource.diagnosis ?? []).map(
      (entry) => readCode(entry.diagnosisCodeableConcept, SYSTEMS.icd10cm) ?? ''
    ),
    totalChargedCents: readCents(resource.total) ?? 0,
    createdAt: resource.created ?? '',
    lines: (resource.item ?? []).map(fromClaimItem),
  };
  return domain;
}
