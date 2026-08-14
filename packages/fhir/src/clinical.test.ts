import { describe, expect, it } from 'vitest';

import {
  ALLERGY_INTOLERANCE_DROPPED_FIELDS,
  CONDITION_CATEGORY_SYSTEM,
  CONDITION_DROPPED_FIELDS,
  IMMUNIZATION_DROPPED_FIELDS,
  LOCAL_STATUS_EXTENSION,
  MEDICATION_REQUEST_DROPPED_FIELDS,
  MEDICATION_REQUEST_STATUS,
  MEDICATION_SOURCE_EXTENSION,
  MEDICATION_STATEMENT_DROPPED_FIELDS,
  SYSTEMS,
  fromFhirAllergyIntolerance,
  fromFhirCondition,
  fromFhirImmunization,
  fromFhirMedicationRequest,
  fromFhirMedicationStatement,
  toFhirAllergyIntolerance,
  toFhirCondition,
  toFhirImmunization,
  toFhirMedicationRequest,
  toFhirMedicationStatement,
} from './index.js';
import type {
  DomainAllergyIntolerance,
  DomainCondition,
  DomainImmunization,
  DomainMedicationRequest,
  DomainMedicationStatement,
} from './index.js';
import { describeRoundTrips, expectDroppedFields } from './test-support/round-trip.js';

describe('condition mapping', () => {
  const problem: DomainCondition = {
    id: 'cond-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    category: 'PROBLEM_LIST_ITEM',
    code: 'I10',
    codeSystem: SYSTEMS.icd10cm,
    display: 'Essential hypertension',
    snomedCode: '59621000',
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    onsetDate: '2024-03-11',
    severityCode: '6736007',
    bodySiteCode: '80891009',
    note: 'Controlled on a single agent.',
    recordedAt: '2026-08-13T16:10:00.000Z',
  };
  const surgery: DomainCondition = {
    id: 'cond-2',
    patientId: 'pat-1',
    category: 'SURGERY',
    code: '0DTJ0ZZ',
    codeSystem: SYSTEMS.icd10cm,
    display: 'Cholecystectomy',
    clinicalStatus: 'RESOLVED',
    verificationStatus: 'CONFIRMED',
    abatementDate: '2019-07-02',
    recordedAt: '2026-08-13T16:12:00.000Z',
  };
  const degenerate: DomainCondition = {
    id: '',
    patientId: '',
    category: 'ENCOUNTER_DIAGNOSIS',
    code: '',
    codeSystem: '',
    display: '',
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'UNCONFIRMED',
    recordedAt: '',
  };

  it('carries the primary code and the SNOMED equivalent in one concept', () => {
    expect(toFhirCondition(problem).code).toStrictEqual({
      coding: [
        { system: SYSTEMS.icd10cm, code: 'I10' },
        { system: SYSTEMS.snomed, code: '59621000' },
      ],
      text: 'Essential hypertension',
    });
  });

  it('keeps the local issue-list categories in their own code system', () => {
    expect(toFhirCondition(problem).category).toStrictEqual([
      { coding: [{ system: SYSTEMS.conditionCategory, code: 'problem-list-item' }] },
    ]);
    expect(toFhirCondition(surgery).category).toStrictEqual([
      { coding: [{ system: CONDITION_CATEGORY_SYSTEM, code: 'surgery' }] },
    ]);
  });

  it('documents the condition columns that stay inside Openrunic', () => {
    expectDroppedFields(problem, CONDITION_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Condition', toFhir: toFhirCondition, fromFhir: fromFhirCondition },
    [
      { label: 'problem', domain: problem },
      { label: 'surgery', domain: surgery },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('allergy intolerance mapping', () => {
  const full: DomainAllergyIntolerance = {
    id: 'alg-1',
    patientId: 'pat-1',
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    substanceCode: '7980',
    substanceCodeSystem: SYSTEMS.rxnorm,
    substanceDisplay: 'Penicillin G',
    reactionCodes: ['247472004'],
    reactionText: 'Hives within an hour',
    severity: 'SEVERE',
    onsetDate: '2015-05-04',
    note: 'Reported by the patient.',
    recordedAt: '2026-08-13T16:14:00.000Z',
  };
  const uncoded: DomainAllergyIntolerance = {
    id: 'alg-2',
    patientId: 'pat-1',
    type: 'INTOLERANCE',
    category: 'FOOD',
    criticality: 'LOW',
    clinicalStatus: 'INACTIVE',
    substanceDisplay: 'Lactose',
    reactionCodes: [],
    reactionText: 'Bloating',
    recordedAt: '2026-08-13T16:15:00.000Z',
  };
  const degenerate: DomainAllergyIntolerance = {
    id: '',
    patientId: '',
    type: 'ALLERGY',
    category: 'ENVIRONMENT',
    criticality: 'UNABLE_TO_ASSESS',
    clinicalStatus: 'RESOLVED',
    substanceDisplay: '',
    reactionCodes: [],
    recordedAt: '',
  };

  it('emits a text-only manifestation when the reaction has no coded term', () => {
    expect(toFhirAllergyIntolerance(uncoded).reaction).toStrictEqual([
      {
        manifestation: [{ text: 'Unspecified reaction' }],
        description: 'Bloating',
      },
    ]);
  });

  it('omits the reaction entirely when there is nothing to say', () => {
    expect(toFhirAllergyIntolerance(degenerate).reaction).toBeUndefined();
  });

  it('documents the allergy columns that stay inside Openrunic', () => {
    expectDroppedFields(full, ALLERGY_INTOLERANCE_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'AllergyIntolerance',
      toFhir: toFhirAllergyIntolerance,
      fromFhir: fromFhirAllergyIntolerance,
    },
    [
      { label: 'coded', domain: full },
      { label: 'uncoded', domain: uncoded },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('immunization mapping', () => {
  const administered: DomainImmunization = {
    id: 'imm-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    status: 'COMPLETED',
    cvxCode: '150',
    mvxCode: 'SKB',
    ndcCode: '58160-905-52',
    display: 'Influenza, injectable, quadrivalent',
    lotNumber: 'AB-4471',
    expirationDate: '2027-03-31',
    siteCode: 'LA',
    routeCode: 'IM',
    doseQuantity: 0.5,
    doseUnit: 'mL',
    administeredAt: '2026-08-13T16:20:00.000Z',
    administeredById: 'u-2',
    visDate: '2025-08-06',
  };
  const refused: DomainImmunization = {
    id: 'imm-2',
    patientId: 'pat-1',
    status: 'NOT_DONE',
    cvxCode: '208',
    display: 'COVID-19 mRNA',
    refusalReasonCode: 'PATOBJ',
    administeredAt: '2026-08-13T16:22:00.000Z',
  };
  const degenerate: DomainImmunization = {
    id: '',
    patientId: '',
    status: 'ENTERED_IN_ERROR',
    cvxCode: '',
    display: '',
    administeredAt: '',
  };

  it('carries the manufacturer as an MVX logical reference', () => {
    expect(toFhirImmunization(administered).manufacturer).toStrictEqual({
      identifier: { system: SYSTEMS.mvx, value: 'SKB' },
    });
  });

  it('carries the VIS publication date as an education entry', () => {
    expect(toFhirImmunization(administered).education).toStrictEqual([
      { publicationDate: '2025-08-06' },
    ]);
  });

  it('documents the registry columns that stay inside Openrunic', () => {
    expectDroppedFields(administered, IMMUNIZATION_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'Immunization',
      toFhir: toFhirImmunization,
      fromFhir: fromFhirImmunization,
    },
    [
      { label: 'administered', domain: administered },
      { label: 'refused', domain: refused },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('medication request mapping', () => {
  const transmitted: DomainMedicationRequest = {
    id: 'rx-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    prescriberId: 'u-1',
    rxnormCode: '314076',
    ndcCode: '00093-7367-01',
    display: 'Lisinopril 10 mg tablet',
    sigText: 'Take 1 tablet by mouth once daily.',
    quantity: 30,
    quantityUnit: 'tablet',
    refills: 3,
    daysSupply: 30,
    dispenseAsWritten: false,
    pharmacyName: 'Alder Creek Pharmacy',
    pharmacyNcpdpId: '1234567',
    status: 'TRANSMITTED',
    intent: 'ORDER',
    writtenAt: '2026-08-13T16:25:00.000Z',
  };
  const draft: DomainMedicationRequest = {
    id: 'rx-2',
    patientId: 'pat-1',
    prescriberId: 'u-1',
    display: 'Amoxicillin 500 mg capsule',
    sigText: 'Take 1 capsule three times daily for 10 days.',
    quantity: 30,
    quantityUnit: 'capsule',
    refills: 0,
    dispenseAsWritten: true,
    status: 'DRAFT',
    intent: 'PLAN',
    writtenAt: '2026-08-13T16:26:00.000Z',
  };
  const degenerate: DomainMedicationRequest = {
    id: '',
    patientId: '',
    prescriberId: '',
    display: '',
    sigText: '',
    quantity: 0,
    quantityUnit: '',
    refills: 0,
    dispenseAsWritten: false,
    status: 'ACTIVE',
    intent: 'ORDER',
    writtenAt: '',
  };

  it('keeps the prescription lifecycle states FHIR collapses', () => {
    const resource = toFhirMedicationRequest(transmitted);
    expect(resource.status).toBe('active');
    expect(resource.extension).toStrictEqual([
      { url: LOCAL_STATUS_EXTENSION, valueCode: 'TRANSMITTED' },
    ]);
    expect(MEDICATION_REQUEST_STATUS.lossyValues).toStrictEqual([
      'PENDED',
      'SIGNED',
      'TRANSMITTED',
    ]);
  });

  it('maps dispense-as-written to a substitution rule, not a free-text note', () => {
    expect(toFhirMedicationRequest(transmitted).substitution).toStrictEqual({
      allowedBoolean: true,
    });
    expect(toFhirMedicationRequest(draft).substitution).toStrictEqual({
      allowedBoolean: false,
    });
  });

  it('carries the pharmacy as an NCPDP logical reference with a display', () => {
    expect(toFhirMedicationRequest(transmitted).dispenseRequest?.performer).toStrictEqual({
      identifier: { system: SYSTEMS.ncpdp, value: '1234567' },
      display: 'Alder Creek Pharmacy',
    });
  });

  it('documents the prescription columns that stay inside Openrunic', () => {
    expectDroppedFields(transmitted, MEDICATION_REQUEST_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'MedicationRequest',
      toFhir: toFhirMedicationRequest,
      fromFhir: fromFhirMedicationRequest,
    },
    [
      { label: 'transmitted', domain: transmitted },
      { label: 'draft', domain: draft },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('medication statement mapping', () => {
  const reported: DomainMedicationStatement = {
    id: 'ms-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    rxnormCode: '860975',
    display: 'Metformin 500 mg tablet',
    sigText: 'Twice daily with meals.',
    status: 'ACTIVE',
    source: 'REPORTED',
    effectiveStart: '2023-01-09',
    reportedAt: '2026-08-13T16:28:00.000Z',
    note: 'Started by an outside clinic.',
  };
  const stopped: DomainMedicationStatement = {
    id: 'ms-2',
    patientId: 'pat-1',
    display: 'Ibuprofen 200 mg tablet',
    status: 'STOPPED',
    source: 'IMPORTED',
    effectiveStart: '2022-04-01',
    effectiveEnd: '2022-05-01',
    reportedAt: '2026-08-13T16:29:00.000Z',
  };
  const degenerate: DomainMedicationStatement = {
    id: '',
    patientId: '',
    display: '',
    status: 'UNKNOWN',
    source: 'REPORTED',
    reportedAt: '',
  };

  it('carries the source in an extension, since R4 has nowhere for it', () => {
    expect(toFhirMedicationStatement(reported).extension).toStrictEqual([
      { url: MEDICATION_SOURCE_EXTENSION, valueCode: 'REPORTED' },
    ]);
  });

  it('falls back to a reported source when the extension is absent', () => {
    expect(
      fromFhirMedicationStatement({
        resourceType: 'MedicationStatement',
        status: 'active',
        subject: { reference: 'Patient/pat-1' },
      }).source
    ).toBe('REPORTED');
  });

  it('documents the statement columns that stay inside Openrunic', () => {
    expectDroppedFields(reported, MEDICATION_STATEMENT_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'MedicationStatement',
      toFhir: toFhirMedicationStatement,
      fromFhir: fromFhirMedicationStatement,
    },
    [
      { label: 'reported', domain: reported },
      { label: 'stopped', domain: stopped },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});
