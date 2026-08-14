import type { ClaimEnvelope, Encode837POptions } from '../claim-837p.js';
import type { EligibilityRequest, Encode270Options } from '../eligibility-270.js';

/**
 * The synthetic inputs behind every encode golden file.
 *
 * Shared between the golden-file generator and the tests so that a golden can
 * never drift from the input that produced it: if somebody changes an input
 * without regenerating, the byte comparison fails immediately rather than at
 * the next payer submission.
 *
 * Every identity here is obviously invented. No real practice, clinician,
 * patient, payer or trading partner appears anywhere in this corpus, and the
 * usage indicator is `T` throughout so a fixture that escaped into a transport
 * would be rejected as a test file rather than adjudicated.
 */

/** One fixed instant, so ISA09, ISA10, GS04, GS05 and BHT04 are reproducible. */
export const FIXTURE_CREATED = new Date('2026-03-16T14:05:00.000Z');

export const FIXTURE_837P_OPTIONS: Encode837POptions = {
  sender: { qualifier: 'ZZ', id: 'CEDARHOLLOW', applicationId: 'CEDARHOLLOW' },
  receiver: { qualifier: 'ZZ', id: 'ROUTINGSVC', applicationId: 'ROUTINGSVC' },
  usageIndicator: 'T',
  controlNumbers: { interchange: 100001, group: 1, transactionStart: 1 },
};

const SUBMITTER = {
  name: 'CEDAR HOLLOW BILLING',
  identifier: 'CHB0001',
  contactName: 'ROSALIND FENWORTH',
  contactPhone: '5085550137',
};

const RECEIVER = { name: 'CLAIMS ROUTING SERVICE', identifier: 'CRS0001' };

const BILLING_PROVIDER = {
  organizationName: 'CEDAR HOLLOW FAMILY PRACTICE',
  npi: '1902874651',
  taxId: '861234567',
  taxonomyCode: '207Q00000X',
  address: {
    line1: '412 LANTERN WAY',
    city: 'WESTFORD MILLS',
    state: 'VT',
    postalCode: '054520114',
  },
};

const PAYER = {
  name: 'NORTHWIND MUTUAL HEALTH',
  identifier: 'NWMH1',
  address: {
    line1: 'PO BOX 88120',
    city: 'GRANITE FALLS',
    state: 'VT',
    postalCode: '056010120',
  },
};

const SECONDARY_PAYER = { name: 'FOXGLOVE BENEFIT TRUST', identifier: 'FGBT9' };

const SELF_SUBSCRIBER = {
  responsibility: 'PRIMARY',
  relationship: 'self',
  memberId: 'NWMH445566',
  groupNumber: 'GRP7781',
  claimFilingCode: 'CI',
  name: { family: 'PATIENTSSON', given: 'TESTINA', middle: 'R' },
  birthDate: '1984-03-11',
  gender: 'F',
  address: {
    line1: '9 HAWTHORN LANE',
    city: 'WESTFORD MILLS',
    state: 'VT',
    postalCode: '054520221',
  },
} as const;

const RENDERING_PROVIDER = {
  name: { family: 'QUINTERO', given: 'MARISOL' },
  npi: '1801234561',
  taxonomyCode: '207Q00000X',
};

function baseEnvelope(): ClaimEnvelope {
  return {
    submitter: SUBMITTER,
    receiver: RECEIVER,
    billingProvider: BILLING_PROVIDER,
    subscriber: SELF_SUBSCRIBER,
    payer: PAYER,
    renderingProvider: RENDERING_PROVIDER,
    claim: {
      patientControlNumber: 'CLM00000001',
      totalChargeCents: 14_800,
      placeOfServiceCode: '11',
      frequency: 'ORIGINAL',
      providerSignatureOnFile: true,
      assignmentCode: 'A',
      benefitsAssigned: true,
      releaseOfInformation: 'Y',
      diagnosisCodes: ['M25511'],
    },
    lines: [
      {
        sequence: 1,
        procedureCode: '99213',
        modifiers: [],
        chargeCents: 14_800,
        units: 1,
        unitBasis: 'UN',
        diagnosisPointers: [1],
        serviceDateFrom: '2026-03-12',
        lineControlNumber: 'LN00000001',
      },
    ],
    originatorTransactionId: 'BATCH0001',
    created: FIXTURE_CREATED,
  };
}

/** Fixture 1: the baseline every other 837P fixture is a variation of. */
export function singleLineClaim(): ClaimEnvelope {
  return baseEnvelope();
}

/** Fixture 2: four lines, modifiers, multi-unit dosing and multi-pointer justification. */
export function multipleLinesClaim(): ClaimEnvelope {
  const base = baseEnvelope();
  return {
    ...base,
    claim: {
      ...base.claim,
      patientControlNumber: 'CLM00000002',
      totalChargeCents: 33_150,
      diagnosisCodes: ['M25511', 'E119', 'I10'],
      onsetDate: '2026-02-27',
    },
    lines: [
      {
        sequence: 1,
        procedureCode: '99214',
        modifiers: ['25'],
        chargeCents: 21_400,
        units: 1,
        unitBasis: 'UN',
        diagnosisPointers: [1, 2, 3],
        serviceDateFrom: '2026-03-12',
        lineControlNumber: 'LN00000011',
      },
      {
        sequence: 2,
        procedureCode: '20610',
        modifiers: ['RT', '59'],
        chargeCents: 8_900,
        units: 1,
        unitBasis: 'UN',
        diagnosisPointers: [1],
        serviceDateFrom: '2026-03-12',
        lineControlNumber: 'LN00000012',
      },
      {
        sequence: 3,
        procedureCode: '36415',
        modifiers: [],
        chargeCents: 1_200,
        units: 1,
        unitBasis: 'UN',
        diagnosisPointers: [2],
        serviceDateFrom: '2026-03-12',
        lineControlNumber: 'LN00000013',
      },
      {
        sequence: 4,
        procedureCode: '96372',
        modifiers: [],
        chargeCents: 1_650,
        units: 3,
        unitBasis: 'UN',
        placeOfServiceCode: '11',
        diagnosisPointers: [2],
        serviceDateFrom: '2026-03-12',
        serviceDateTo: '2026-03-14',
        lineControlNumber: 'LN00000014',
      },
    ],
  };
}

/** Fixture 3: the patient is the subscriber's child, so the 2000C loop exists. */
export function dependentPatientClaim(): ClaimEnvelope {
  const base = baseEnvelope();
  return {
    ...base,
    subscriber: {
      responsibility: 'PRIMARY',
      relationship: 'child',
      memberId: 'NWMH445566',
      groupNumber: 'GRP7781',
      claimFilingCode: 'CI',
      name: { family: 'PATIENTSSON', given: 'TESTINA', middle: 'R' },
      address: SELF_SUBSCRIBER.address,
    },
    patient: {
      name: { family: 'PATIENTSSON', given: 'JUNIPER' },
      birthDate: '2016-07-02',
      gender: 'M',
      address: SELF_SUBSCRIBER.address,
    },
    claim: { ...base.claim, patientControlNumber: 'CLM00000003' },
  };
}

/** Fixture 4: coordination of benefits, with the primary's adjudication attached. */
export function secondaryCoverageClaim(): ClaimEnvelope {
  const base = baseEnvelope();
  return {
    ...base,
    subscriber: { ...SELF_SUBSCRIBER, responsibility: 'SECONDARY' },
    payer: SECONDARY_PAYER,
    claim: { ...base.claim, patientControlNumber: 'CLM00000004' },
    otherCoverage: [
      {
        responsibility: 'PRIMARY',
        relationship: 'self',
        memberId: 'NWMH445566',
        groupNumber: 'GRP7781',
        claimFilingCode: 'CI',
        name: SELF_SUBSCRIBER.name,
        payer: { name: PAYER.name, identifier: PAYER.identifier },
        payerPaidCents: 9_240,
        allowedCents: 11_550,
        adjustments: [
          {
            groupCode: 'CO',
            details: [{ reasonCode: '45', amountCents: 3_250 }],
          },
          {
            groupCode: 'PR',
            details: [{ reasonCode: '2', amountCents: 2_310 }],
          },
        ],
        benefitsAssigned: true,
        releaseOfInformation: 'Y',
        adjudicationDate: '2026-03-30',
      },
    ],
    lines: [
      {
        sequence: 1,
        procedureCode: '99213',
        modifiers: [],
        chargeCents: 14_800,
        units: 1,
        unitBasis: 'UN',
        diagnosisPointers: [1],
        serviceDateFrom: '2026-03-12',
        lineControlNumber: 'LN00000001',
        priorAdjudication: {
          otherPayerIdentifier: PAYER.identifier,
          procedureCode: '99213',
          modifiers: [],
          paidCents: 9_240,
          paidUnits: 1,
          adjustments: [
            {
              groupCode: 'CO',
              details: [{ reasonCode: '45', amountCents: 3_250 }],
            },
            {
              groupCode: 'PR',
              details: [{ reasonCode: '2', amountCents: 2_310 }],
            },
          ],
          adjudicationDate: '2026-03-30',
        },
      },
    ],
  };
}

/** Fixture 5: a replacement claim, frequency 7, naming the claim it supersedes. */
export function correctedClaim(): ClaimEnvelope {
  const base = baseEnvelope();
  return {
    ...base,
    claim: {
      ...base.claim,
      patientControlNumber: 'CLM00000005',
      frequency: 'REPLACEMENT',
      priorPayerClaimControlNumber: 'NWMH20260318004417',
    },
  };
}

/** Fixture 6: a void, frequency 8, which a payer treats differently again. */
export function voidedClaim(): ClaimEnvelope {
  const base = baseEnvelope();
  return {
    ...base,
    claim: {
      ...base.claim,
      patientControlNumber: 'CLM00000006',
      frequency: 'VOID',
      priorPayerClaimControlNumber: 'NWMH20260318004417',
    },
  };
}

/** Fixture 7: every optional provider loop present at once. */
export function fullProviderLoopsClaim(): ClaimEnvelope {
  const base = baseEnvelope();
  return {
    ...base,
    claim: { ...base.claim, patientControlNumber: 'CLM00000007' },
    serviceFacility: {
      name: 'CEDAR HOLLOW CLINIC NORTH',
      npi: '1710293847',
      address: {
        line1: '77 MILLPOND ROAD',
        line2: 'SUITE 210',
        city: 'GRANITE FALLS',
        state: 'VT',
        postalCode: '056010440',
      },
    },
    supervisingProvider: {
      name: { family: 'BRAMBLEWOOD', given: 'ANDERS' },
      npi: '1610293846',
    },
  };
}

export const FIXTURE_270_OPTIONS: Encode270Options = {
  sender: { qualifier: 'ZZ', id: 'CEDARHOLLOW', applicationId: 'CEDARHOLLOW' },
  receiver: { qualifier: 'ZZ', id: 'NWMH1', applicationId: 'NWMH1' },
  usageIndicator: 'T',
  controlNumbers: { interchange: 100002, group: 2, transactionStart: 1 },
};

/** Fixture 18: a plain subscriber-level coverage inquiry. */
export function eligibilityRequest(): EligibilityRequest {
  return {
    payer: { name: PAYER.name, identifier: PAYER.identifier },
    provider: {
      name: BILLING_PROVIDER.organizationName,
      npi: BILLING_PROVIDER.npi,
    },
    subscriber: {
      memberId: SELF_SUBSCRIBER.memberId,
      name: SELF_SUBSCRIBER.name,
      birthDate: SELF_SUBSCRIBER.birthDate,
      gender: SELF_SUBSCRIBER.gender,
    },
    serviceDate: '2026-03-16',
    traceNumber: 'ELG000000042',
    originatorCompanyId: '9861234567',
    originatorTransactionId: 'ELGBATCH01',
    created: FIXTURE_CREATED,
  };
}

/** Fixture 19: the same inquiry about a dependent, which adds the 2000D level. */
export function dependentEligibilityRequest(): EligibilityRequest {
  return {
    ...eligibilityRequest(),
    dependent: {
      name: { family: 'PATIENTSSON', given: 'JUNIPER' },
      birthDate: '2016-07-02',
      gender: 'M',
      relationship: 'child',
    },
    serviceTypeCodes: ['30', '98'],
    traceNumber: 'ELG000000043',
    originatorTransactionId: 'ELGBATCH02',
  };
}
