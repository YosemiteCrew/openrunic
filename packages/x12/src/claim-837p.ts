import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { ControlNumbers } from './control.js';
import type { Delimiters } from './delimiters.js';
import type {
  Adjustment,
  ClaimFrequency,
  NamedParty,
  PayerResponsibility,
  PersonName,
  PostalAddress,
  SubscriberRelationship,
  X12Gender,
} from './domain.js';
import { toFrequencyCode, toPayerResponsibilityCode, toRelationshipCode } from './domain.js';
import type { X12Error } from './errors.js';
import { formatAmount, formatDate8, formatTime4 } from './format.js';
import { segment } from './segments.js';
import type { Segment } from './segments.js';
import { writeInterchange } from './writer.js';

/**
 * The 837P professional claim encoder.
 *
 * This is the transaction that turns a fee sheet into money, and the one whose
 * defects are most expensive: a claim that bounces at the clearinghouse costs a
 * rework cycle, and a claim that is accepted but wrong costs a recoupment
 * months later. The encoder therefore refuses to emit a document it can tell is
 * unpayable. Every check below corresponds to an edit a real payer applies, so
 * failing here converts a three-week feedback loop into an actionable error on
 * the fee sheet.
 *
 * The mapper produces only the segments between ST and SE. The envelope, the
 * control numbers and the three self-check counts belong to `writer.ts`.
 */

/** Loop 1000A: whoever is transmitting, usually the practice or its billing service. */
export interface Submitter extends NamedParty {
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail?: string;
}

/** Loop 2010AA: the entity that gets paid. Its NPI and tax id are what a payer keys on. */
export interface BillingProvider {
  readonly organizationName: string;
  /** Ten digits. Checked, because a transposed NPI is rejected by every payer. */
  readonly npi: string;
  /** Employer identification number for REF*EI. */
  readonly taxId: string;
  /** Healthcare provider taxonomy for PRV*BI. */
  readonly taxonomyCode?: string;
  readonly address: PostalAddress;
}

/** Loops 2310B and 2310D: an individual clinician on the claim. */
export interface ProviderIndividual {
  readonly name: PersonName;
  readonly npi: string;
  readonly taxonomyCode?: string;
}

/** Loop 2310C: where the service happened, when that is not the billing address. */
export interface ServiceFacility {
  readonly name: string;
  readonly npi?: string;
  readonly address: PostalAddress;
}

/** Loop 2000B/2010BA: the policy holder. */
export interface Subscriber {
  readonly responsibility: PayerResponsibility;
  readonly relationship: SubscriberRelationship;
  readonly memberId: string;
  readonly groupNumber?: string;
  readonly groupName?: string;
  /** SBR09, the claim filing indicator, e.g. `CI` commercial, `MC` Medicaid. */
  readonly claimFilingCode: string;
  readonly name: PersonName;
  /** `YYYY-MM-DD`. Required when the subscriber is the patient. */
  readonly birthDate?: string;
  readonly gender?: X12Gender;
  readonly address?: PostalAddress;
}

/** Loop 2000C/2010CA: present only when the patient is not the subscriber. */
export interface DependentPatient {
  readonly name: PersonName;
  readonly birthDate: string;
  readonly gender: X12Gender;
  readonly address?: PostalAddress;
}

/** Loop 2300: the claim itself. */
export interface ClaimHeader {
  /** CLM01. The submitter's own control number, echoed back in the 835's CLP01. */
  readonly patientControlNumber: string;
  readonly totalChargeCents: number;
  /** CLM05-1, the CMS place-of-service code. */
  readonly placeOfServiceCode: string;
  readonly frequency: ClaimFrequency;
  /** CLM06. */
  readonly providerSignatureOnFile: boolean;
  /** CLM07: `A` assigned, `B` assignment accepted on clinical lab only, `C` not assigned. */
  readonly assignmentCode: 'A' | 'B' | 'C';
  /** CLM08. */
  readonly benefitsAssigned: boolean;
  /** CLM09: `I` informed consent, `Y` signed statement on file. */
  readonly releaseOfInformation: 'I' | 'Y';
  /** Up to twelve ICD-10-CM codes. The first is the principal diagnosis. */
  readonly diagnosisCodes: readonly string[];
  /** `YYYY-MM-DD`, DTP*431. */
  readonly onsetDate?: string;
  /** REF*F8. Required by the encoder whenever frequency is not `ORIGINAL`. */
  readonly priorPayerClaimControlNumber?: string;
}

/** Loop 2430: what a prior payer already did to one service line. */
export interface LineAdjudication {
  /** The other payer's identifier, echoing the 2330B NM109. */
  readonly otherPayerIdentifier: string;
  readonly procedureCode: string;
  readonly modifiers: readonly string[];
  readonly paidCents: number;
  readonly paidUnits: number;
  readonly adjustments: readonly Adjustment[];
  /** `YYYY-MM-DD`, DTP*573. */
  readonly adjudicationDate: string;
}

/** Loop 2400: one billable service. */
export interface ServiceLine {
  /** LX01. One-based and contiguous; the encoder checks that. */
  readonly sequence: number;
  /** CPT or HCPCS. */
  readonly procedureCode: string;
  /** At most four, two characters each. */
  readonly modifiers: readonly string[];
  readonly chargeCents: number;
  readonly units: number;
  /** SV103: `UN` units, `MJ` minutes. */
  readonly unitBasis: 'UN' | 'MJ';
  /** SV105, when the line differs from the claim's place of service. */
  readonly placeOfServiceCode?: string;
  /** One-based pointers into `ClaimHeader.diagnosisCodes`. At most four. */
  readonly diagnosisPointers: readonly number[];
  /** `YYYY-MM-DD`. */
  readonly serviceDateFrom: string;
  /** `YYYY-MM-DD`. When present and different, DTP*472 becomes an RD8 range. */
  readonly serviceDateTo?: string;
  /** REF*6R. The line's own id, so an 835 SVC can be matched back to a ClaimLine. */
  readonly lineControlNumber?: string;
  readonly priorAdjudication?: LineAdjudication;
}

/** Loops 2320 and 2330: what another payer on this patient has already done. */
export interface OtherCoverage {
  readonly responsibility: PayerResponsibility;
  readonly relationship: SubscriberRelationship;
  readonly memberId: string;
  readonly groupNumber?: string;
  readonly claimFilingCode: string;
  readonly name: PersonName;
  readonly payer: NamedParty;
  /** AMT*D, what that payer paid on this claim. */
  readonly payerPaidCents: number;
  /** AMT*B6, what that payer allowed. */
  readonly allowedCents?: number;
  /** Claim-level CAS from that payer's adjudication. */
  readonly adjustments: readonly Adjustment[];
  readonly benefitsAssigned: boolean;
  readonly releaseOfInformation: 'I' | 'Y';
  /** `YYYY-MM-DD`, DTP*573 in loop 2330B. */
  readonly adjudicationDate?: string;
}

/** Everything one professional claim needs, with nothing derivable left over. */
export interface ClaimEnvelope {
  readonly submitter: Submitter;
  readonly receiver: NamedParty;
  readonly billingProvider: BillingProvider;
  readonly subscriber: Subscriber;
  readonly patient?: DependentPatient;
  readonly payer: NamedParty;
  readonly claim: ClaimHeader;
  readonly lines: readonly ServiceLine[];
  readonly renderingProvider?: ProviderIndividual;
  readonly supervisingProvider?: ProviderIndividual;
  readonly serviceFacility?: ServiceFacility;
  readonly otherCoverage?: readonly OtherCoverage[];
  /** BHT03: the submitter's batch reference for this transaction. */
  readonly originatorTransactionId: string;
  /** BHT04 and BHT05. Supplied so encoding stays a pure function of its input. */
  readonly created: Date;
}

/** The interchange-level facts the mapper does not own. */
export interface Encode837POptions {
  readonly sender: {
    readonly qualifier: string;
    readonly id: string;
    readonly applicationId: string;
  };
  readonly receiver: {
    readonly qualifier: string;
    readonly id: string;
    readonly applicationId: string;
  };
  readonly usageIndicator: 'P' | 'T';
  readonly controlNumbers: ControlNumbers;
  readonly delimiters?: Delimiters;
}

/** The implementation convention this encoder writes, stamped into ST03 and GS08. */
export const IMPLEMENTATION_837P = '005010X222A1';

const MAX_DIAGNOSES = 12;
const MAX_MODIFIERS = 4;
const MAX_POINTERS = 4;

/**
 * Encodes one professional claim as a complete 837P interchange.
 *
 * One claim per interchange, which is not a limitation so much as a decision:
 * batching claims makes a single malformed claim reject the whole batch at the
 * clearinghouse, and the operational cost of tracing that back outweighs the
 * transport saving. The billing service submits claims individually and
 * reconciles them individually.
 */
export function encode837P(
  envelope: ClaimEnvelope,
  options: Encode837POptions
): Result<string, X12Error> {
  const validated = validateEnvelope(envelope);
  if (!validated.ok) return validated;

  const body = buildTransaction(envelope);

  return writeInterchange({
    sender: options.sender,
    receiver: options.receiver,
    created: envelope.created,
    usageIndicator: options.usageIndicator,
    controlNumbers: options.controlNumbers,
    delimiters: options.delimiters,
    groups: [
      {
        functionalIdentifier: 'HC',
        version: IMPLEMENTATION_837P,
        transactions: [
          {
            setIdentifier: '837',
            implementationConvention: IMPLEMENTATION_837P,
            segments: body,
          },
        ],
      },
    ],
  });
}

function validateEnvelope(envelope: ClaimEnvelope): Result<true, X12Error> {
  const { claim, lines } = envelope;

  if (lines.length === 0) {
    return fail('a claim must carry at least one service line', ['lines']);
  }
  if (claim.diagnosisCodes.length === 0) {
    return fail('a claim must carry at least one diagnosis code', ['claim', 'diagnosisCodes']);
  }
  if (claim.diagnosisCodes.length > MAX_DIAGNOSES) {
    return fail(
      `a claim carries at most ${MAX_DIAGNOSES} diagnosis codes, received ${claim.diagnosisCodes.length}`,
      ['claim', 'diagnosisCodes']
    );
  }
  if (claim.frequency !== 'ORIGINAL' && claim.priorPayerClaimControlNumber === undefined) {
    return fail(
      'a replacement or void claim must carry the payer control number of the claim it acts on',
      ['claim', 'priorPayerClaimControlNumber']
    );
  }
  if (envelope.subscriber.relationship === 'self' && envelope.patient !== undefined) {
    return fail('a self-insured patient must not also be sent as a dependent', ['patient']);
  }
  if (envelope.subscriber.relationship !== 'self' && envelope.patient === undefined) {
    return fail('a patient who is not the subscriber must be sent as a dependent', ['patient']);
  }
  if (envelope.subscriber.relationship === 'self') {
    if (envelope.subscriber.birthDate === undefined || envelope.subscriber.gender === undefined) {
      return fail('a subscriber who is the patient must carry a birth date and a gender', [
        'subscriber',
        'birthDate',
      ]);
    }
  }

  const npiCheck = checkNpi(envelope.billingProvider.npi, ['billingProvider', 'npi']);
  if (!npiCheck.ok) return npiCheck;
  if (envelope.renderingProvider !== undefined) {
    const rendering = checkNpi(envelope.renderingProvider.npi, ['renderingProvider', 'npi']);
    if (!rendering.ok) return rendering;
  }

  let lineTotal = 0;
  for (const [index, line] of lines.entries()) {
    const path = ['lines', String(index)];
    if (line.sequence !== index + 1) {
      return fail(
        `service line sequence must be one-based and contiguous, expected ${index + 1} but found ${line.sequence}`,
        [...path, 'sequence']
      );
    }
    if (line.modifiers.length > MAX_MODIFIERS) {
      return fail(`a service line carries at most ${MAX_MODIFIERS} modifiers`, [
        ...path,
        'modifiers',
      ]);
    }
    if (line.diagnosisPointers.length === 0 || line.diagnosisPointers.length > MAX_POINTERS) {
      return fail(`a service line carries one to ${MAX_POINTERS} diagnosis pointers`, [
        ...path,
        'diagnosisPointers',
      ]);
    }
    for (const pointer of line.diagnosisPointers) {
      if (!Number.isInteger(pointer) || pointer < 1 || pointer > claim.diagnosisCodes.length) {
        return fail(
          `diagnosis pointer ${pointer} does not reference one of the claim's ${claim.diagnosisCodes.length} diagnosis codes`,
          [...path, 'diagnosisPointers']
        );
      }
    }
    if (line.units <= 0) {
      return fail('a service line must carry a positive unit count', [...path, 'units']);
    }
    lineTotal += line.chargeCents;
  }

  if (lineTotal !== claim.totalChargeCents) {
    return fail(
      `the claim total of ${claim.totalChargeCents} does not equal the sum of its lines, ${lineTotal}`,
      ['claim', 'totalChargeCents']
    );
  }

  return ok(true);
}

function checkNpi(npi: string, path: readonly string[]): Result<true, X12Error> {
  return /^\d{10}$/.test(npi)
    ? ok(true)
    : fail(`an NPI must be ten digits, received "${npi}"`, path);
}

function fail(message: string, path: readonly string[]): Result<never, X12Error> {
  return err({ kind: 'encode_precondition', message, path });
}

function buildTransaction(envelope: ClaimEnvelope): readonly Segment[] {
  const out: Segment[] = [];
  const { submitter, receiver, billingProvider, subscriber, patient, payer, claim } = envelope;

  out.push(
    segment(
      'BHT',
      '0019',
      '00',
      envelope.originatorTransactionId,
      formatDate8(envelope.created),
      formatTime4(envelope.created),
      'CH'
    )
  );

  // Loop 1000A submitter, then 1000B receiver.
  out.push(segment('NM1', '41', '2', submitter.name, '', '', '', '', '46', submitter.identifier));
  const contact: string[] = ['IC', submitter.contactName, 'TE', submitter.contactPhone];
  if (submitter.contactEmail !== undefined) contact.push('EM', submitter.contactEmail);
  out.push(segment('PER', ...contact));
  out.push(segment('NM1', '40', '2', receiver.name, '', '', '', '', '46', receiver.identifier));

  // Loop 2000A billing provider.
  out.push(segment('HL', '1', '', '20', '1'));
  if (billingProvider.taxonomyCode !== undefined) {
    out.push(segment('PRV', 'BI', 'PXC', billingProvider.taxonomyCode));
  }
  out.push(
    segment(
      'NM1',
      '85',
      '2',
      billingProvider.organizationName,
      '',
      '',
      '',
      '',
      'XX',
      billingProvider.npi
    )
  );
  out.push(...addressSegments(billingProvider.address));
  out.push(segment('REF', 'EI', billingProvider.taxId));

  // Loop 2000B subscriber. The hierarchical child code flips when a dependent
  // loop follows, which is the one place the patient relationship changes the
  // document's shape rather than just a code.
  const hasDependent = patient !== undefined;
  out.push(segment('HL', '2', '1', '22', hasDependent ? '1' : '0'));
  out.push(
    segment(
      'SBR',
      toPayerResponsibilityCode(subscriber.responsibility),
      hasDependent ? '' : toRelationshipCode(subscriber.relationship),
      subscriber.groupNumber ?? '',
      subscriber.groupName ?? '',
      '',
      '',
      '',
      '',
      subscriber.claimFilingCode
    )
  );
  out.push(
    segment(
      'NM1',
      'IL',
      '1',
      subscriber.name.family,
      subscriber.name.given,
      subscriber.name.middle ?? '',
      '',
      subscriber.name.suffix ?? '',
      'MI',
      subscriber.memberId
    )
  );
  if (subscriber.address !== undefined) out.push(...addressSegments(subscriber.address));
  if (subscriber.birthDate !== undefined && subscriber.gender !== undefined) {
    out.push(segment('DMG', 'D8', compactDate(subscriber.birthDate), subscriber.gender));
  }
  out.push(segment('NM1', 'PR', '2', payer.name, '', '', '', '', 'PI', payer.identifier));
  if (payer.address !== undefined) out.push(...addressSegments(payer.address));

  // Loop 2000C dependent, present only when the patient is somebody else.
  if (patient !== undefined) {
    out.push(segment('HL', '3', '2', '23', '0'));
    out.push(segment('PAT', toRelationshipCode(subscriber.relationship)));
    out.push(
      segment(
        'NM1',
        'QC',
        '1',
        patient.name.family,
        patient.name.given,
        patient.name.middle ?? '',
        '',
        patient.name.suffix ?? ''
      )
    );
    if (patient.address !== undefined) out.push(...addressSegments(patient.address));
    out.push(segment('DMG', 'D8', compactDate(patient.birthDate), patient.gender));
  }

  // Loop 2300, the claim.
  out.push(
    segment(
      'CLM',
      claim.patientControlNumber,
      formatAmount(claim.totalChargeCents),
      '',
      '',
      [claim.placeOfServiceCode, 'B', toFrequencyCode(claim.frequency)],
      claim.providerSignatureOnFile ? 'Y' : 'N',
      claim.assignmentCode,
      claim.benefitsAssigned ? 'Y' : 'N',
      claim.releaseOfInformation
    )
  );
  if (claim.onsetDate !== undefined) {
    out.push(segment('DTP', '431', 'D8', compactDate(claim.onsetDate)));
  }
  if (claim.priorPayerClaimControlNumber !== undefined) {
    out.push(segment('REF', 'F8', claim.priorPayerClaimControlNumber));
  }
  out.push(segment('HI', ...diagnosisElements(claim.diagnosisCodes)));

  if (envelope.renderingProvider !== undefined) {
    const rendering = envelope.renderingProvider;
    out.push(
      segment(
        'NM1',
        '82',
        '1',
        rendering.name.family,
        rendering.name.given,
        rendering.name.middle ?? '',
        '',
        rendering.name.suffix ?? '',
        'XX',
        rendering.npi
      )
    );
    if (rendering.taxonomyCode !== undefined) {
      out.push(segment('PRV', 'PE', 'PXC', rendering.taxonomyCode));
    }
  }
  if (envelope.serviceFacility !== undefined) {
    const facility = envelope.serviceFacility;
    out.push(
      segment(
        'NM1',
        '77',
        '2',
        facility.name,
        '',
        '',
        '',
        '',
        ...(facility.npi === undefined ? [] : ['XX', facility.npi])
      )
    );
    out.push(...addressSegments(facility.address));
  }
  if (envelope.supervisingProvider !== undefined) {
    const supervising = envelope.supervisingProvider;
    out.push(
      segment(
        'NM1',
        'DQ',
        '1',
        supervising.name.family,
        supervising.name.given,
        supervising.name.middle ?? '',
        '',
        supervising.name.suffix ?? '',
        'XX',
        supervising.npi
      )
    );
  }

  for (const other of envelope.otherCoverage ?? []) {
    out.push(...otherCoverageSegments(other));
  }

  for (const line of envelope.lines) {
    out.push(...serviceLineSegments(line));
  }

  return out;
}

function otherCoverageSegments(other: OtherCoverage): readonly Segment[] {
  const out: Segment[] = [];
  out.push(
    segment(
      'SBR',
      toPayerResponsibilityCode(other.responsibility),
      toRelationshipCode(other.relationship),
      other.groupNumber ?? '',
      '',
      '',
      '',
      '',
      '',
      other.claimFilingCode
    )
  );
  for (const adjustment of other.adjustments) {
    out.push(adjustmentSegment(adjustment));
  }
  out.push(segment('AMT', 'D', formatAmount(other.payerPaidCents)));
  if (other.allowedCents !== undefined) {
    out.push(segment('AMT', 'B6', formatAmount(other.allowedCents)));
  }
  out.push(
    segment('OI', '', '', other.benefitsAssigned ? 'Y' : 'N', '', '', other.releaseOfInformation)
  );
  out.push(
    segment(
      'NM1',
      'IL',
      '1',
      other.name.family,
      other.name.given,
      other.name.middle ?? '',
      '',
      '',
      'MI',
      other.memberId
    )
  );
  out.push(
    segment('NM1', 'PR', '2', other.payer.name, '', '', '', '', 'PI', other.payer.identifier)
  );
  if (other.adjudicationDate !== undefined) {
    out.push(segment('DTP', '573', 'D8', compactDate(other.adjudicationDate)));
  }
  return out;
}

function serviceLineSegments(line: ServiceLine): readonly Segment[] {
  const out: Segment[] = [];
  out.push(segment('LX', String(line.sequence)));
  out.push(
    segment(
      'SV1',
      ['HC', line.procedureCode, ...line.modifiers],
      formatAmount(line.chargeCents),
      line.unitBasis,
      String(line.units),
      line.placeOfServiceCode ?? '',
      '',
      line.diagnosisPointers.map(String)
    )
  );
  out.push(
    line.serviceDateTo !== undefined && line.serviceDateTo !== line.serviceDateFrom
      ? segment(
          'DTP',
          '472',
          'RD8',
          `${compactDate(line.serviceDateFrom)}-${compactDate(line.serviceDateTo)}`
        )
      : segment('DTP', '472', 'D8', compactDate(line.serviceDateFrom))
  );
  if (line.lineControlNumber !== undefined) {
    out.push(segment('REF', '6R', line.lineControlNumber));
  }
  if (line.priorAdjudication !== undefined) {
    const prior = line.priorAdjudication;
    out.push(
      segment(
        'SVD',
        prior.otherPayerIdentifier,
        formatAmount(prior.paidCents),
        ['HC', prior.procedureCode, ...prior.modifiers],
        '',
        String(prior.paidUnits)
      )
    );
    for (const adjustment of prior.adjustments) {
      out.push(adjustmentSegment(adjustment));
    }
    out.push(segment('DTP', '573', 'D8', compactDate(prior.adjudicationDate)));
  }
  return out;
}

/**
 * Writes one CAS segment, stacking up to six triplets.
 *
 * Stacking is what makes CAS awkward: the same segment carries between one and
 * six independent adjustments in fixed positional slots, and a seventh has to
 * start a new segment. Writing them one per segment would be legal but is not
 * what payers send back, so the round-trip fixtures would stop resembling real
 * traffic.
 */
function adjustmentSegment(adjustment: Adjustment): Segment {
  const elements: string[] = [adjustment.groupCode];
  for (const detail of adjustment.details.slice(0, 6)) {
    elements.push(
      detail.reasonCode,
      formatAmount(detail.amountCents),
      detail.quantity === undefined ? '' : String(detail.quantity)
    );
  }
  return segment('CAS', ...elements);
}

/**
 * Builds the HI segment's composite elements.
 *
 * The first diagnosis takes qualifier `ABK` because it is the principal one and
 * the rest take `ABF`. Payers reject a claim with two principal diagnoses, and
 * a caller that simply listed codes has no way to know that, so the encoder
 * assigns the qualifiers rather than accepting them.
 */
function diagnosisElements(codes: readonly string[]): readonly (readonly string[])[] {
  return codes.map((code, index) => [index === 0 ? 'ABK' : 'ABF', code]);
}

function addressSegments(address: PostalAddress): readonly Segment[] {
  const street =
    address.line2 === undefined
      ? segment('N3', address.line1)
      : segment('N3', address.line1, address.line2);
  const locality =
    address.countryCode === undefined
      ? segment('N4', address.city, address.state, address.postalCode)
      : segment('N4', address.city, address.state, address.postalCode, address.countryCode);
  return [street, locality];
}

/** Strips the hyphens from `YYYY-MM-DD`, which is all a D8 element is. */
function compactDate(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}
