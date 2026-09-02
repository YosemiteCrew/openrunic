import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import {
  allergyIntoleranceInput,
  appointmentCreateInput,
  appointmentStatusChangeInput,
  chargeItemInput,
  claimCreateInput,
  claimStatusChangeInput,
  clinicalNoteInput,
  conditionInput,
  procedureInput,
  consentGrantInput,
  coverageInput,
  diagnosticReportInput,
  documentInput,
  encounterCreateInput,
  formDefinitionCreateInput,
  formDefinitionPublishInput,
  formPromotedValueQuery,
  formSubmissionInput,
  immunizationInput,
  localDate,
  medicationRequestInput,
  medicationStatementInput,
  noteAddendumInput,
  observationInput,
  patientCreateInput,
  patientIdentifierInput,
  patientUpdateInput,
  payerInput,
  paymentCreateInput,
  promotionManifestInput,
  relatedPersonInput,
  remittanceInput,
  serviceRequestInput,
  specimenInput,
  statementInput,
  taskInput,
  terminologyCodeInput,
  timestamp,
} from './index.js';

const ID = {
  patient: '01920000-0000-7000-8000-000000000001',
  facility: '01920000-0000-7000-8000-000000000002',
  provider: '01920000-0000-7000-8000-000000000003',
  encounter: '01920000-0000-7000-8000-000000000004',
  coverage: '01920000-0000-7000-8000-000000000005',
  payer: '01920000-0000-7000-8000-000000000006',
  charge: '01920000-0000-7000-8000-000000000007',
  note: '01920000-0000-7000-8000-000000000008',
  claim: '01920000-0000-7000-8000-000000000009',
  form: '01920000-0000-7000-8000-00000000000a',
  remittance: '01920000-0000-7000-8000-00000000000b',
} as const;

/** Asserts a schema accepts `value`, surfacing the zod error when it does not. */
function accepts<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`expected accept, got: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  return result.data;
}

function rejects(schema: ZodType, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

/** Returns `source` without `key`, for the "rejects a missing X" cases. */
function without<T extends object>(source: T, key: keyof T | string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

// ---------------------------------------------------------------------------

describe('common primitives', () => {
  it('reads a bare YYYY-MM-DD as UTC midnight so a timezone cannot shift a birth date', () => {
    expect(accepts(localDate, '1991-04-17').toISOString()).toBe('1991-04-17T00:00:00.000Z');
  });

  it('accepts a Date instance unchanged', () => {
    const date = new Date('1991-04-17T00:00:00.000Z');
    expect(accepts(localDate, date)).toStrictEqual(date);
  });

  it.each(['17/04/1991', '1991-4-7', 'yesterday', '', 19910417])(
    'rejects %s as a local date',
    (value) => {
      rejects(localDate, value);
    }
  );

  it('parses an ISO instant', () => {
    expect(accepts(timestamp, '2026-08-13T09:30:00.000Z').getTime()).toBe(
      Date.parse('2026-08-13T09:30:00.000Z')
    );
  });

  it('rejects an unparsable instant', () => {
    rejects(timestamp, 'half past nine');
  });
});

// ---------------------------------------------------------------------------

const validPatient = {
  mrn: 'OR-100482',
  givenName: 'Testina',
  familyName: 'Patientsson',
  birthDate: '1991-04-17',
};

describe('patientCreateInput', () => {
  it('accepts a minimal patient', () => {
    expect(accepts(patientCreateInput, validPatient).mrn).toBe('OR-100482');
  });

  it('accepts the full demographic set', () => {
    accepts(patientCreateInput, {
      ...validPatient,
      primaryFacilityId: ID.facility,
      middleName: 'Q',
      prefix: 'Ms',
      suffix: 'II',
      preferredName: 'Tess',
      sexAtBirth: 'FEMALE',
      genderIdentityCode: '446141000124107',
      pronouns: 'she/her',
      raceCodes: ['2106-3'],
      ethnicityCodes: ['2186-5'],
      languageCode: 'en-US',
      maritalStatusCode: 'S',
      email: 'testina@example.invalid',
      phoneMobile: '+15550100482',
      addressLine1: '4 Placeholder Way',
      city: 'Springfield',
      state: 'OR',
      postalCode: '97477',
      country: 'US',
      sensitivityClass: 'RESTRICTED',
      portalEnabled: true,
      active: true,
    });
  });

  it.each(['mrn', 'givenName', 'familyName', 'birthDate'] as const)(
    'rejects a missing %s',
    (key) => {
      rejects(patientCreateInput, without(validPatient, key));
    }
  );

  it.each([
    ['an unknown key', { ...validPatient, ssn: '000-00-0000' }],
    ['a caller-supplied id', { ...validPatient, id: ID.patient }],
    ['a caller-supplied tenant', { ...validPatient, tenantId: ID.patient }],
    ['an empty mrn', { ...validPatient, mrn: '' }],
    ['an invalid email', { ...validPatient, email: 'not-an-email' }],
    ['a gender outside the closed set', { ...validPatient, sexAtBirth: 'F' }],
    ['a sensitivity class outside the closed set', { ...validPatient, sensitivityClass: 'SECRET' }],
    ['a three-letter country', { ...validPatient, country: 'USA' }],
    ['a non-uuid facility', { ...validPatient, primaryFacilityId: 'facility-1' }],
  ])('rejects %s', (_label, value) => {
    rejects(patientCreateInput, value);
  });
});

describe('patientUpdateInput', () => {
  it('accepts a partial update', () => {
    accepts(patientUpdateInput, { preferredName: 'Tess' });
  });

  it('accepts an empty update', () => {
    accepts(patientUpdateInput, {});
  });

  it('does not allow the mrn to be reassigned', () => {
    rejects(patientUpdateInput, { mrn: 'OR-999999' });
  });
});

describe('patientIdentifierInput', () => {
  it('accepts an external identifier', () => {
    accepts(patientIdentifierInput, {
      patientId: ID.patient,
      system: 'http://hl7.org/fhir/sid/us-ssn',
      value: '000-00-0000',
      use: 'SECONDARY',
      typeCode: 'SS',
    });
  });

  it.each([
    ['a missing system', { patientId: ID.patient, value: 'x' }],
    ['a missing value', { patientId: ID.patient, system: 'urn:x' }],
    [
      'a use outside the closed set',
      { patientId: ID.patient, system: 'urn:x', value: 'y', use: 'PRIMARY' },
    ],
  ])('rejects %s', (_label, value) => {
    rejects(patientIdentifierInput, value);
  });
});

describe('relatedPersonInput', () => {
  it('accepts a guardian', () => {
    accepts(relatedPersonInput, {
      patientId: ID.patient,
      relationshipCode: 'MTH',
      givenName: 'Marta',
      familyName: 'Patientsson',
      isGuardian: true,
      phone: '+15550100483',
    });
  });

  it('rejects a missing relationship code', () => {
    rejects(relatedPersonInput, {
      patientId: ID.patient,
      givenName: 'Marta',
      familyName: 'Patientsson',
    });
  });
});

describe('payerInput', () => {
  it('accepts a payer', () => {
    accepts(payerInput, { name: 'Placeholder Mutual', x12PayerId: 'PM001', claimFilingCode: 'CI' });
  });

  it('rejects an empty name', () => {
    rejects(payerInput, { name: '' });
  });
});

describe('coverageInput', () => {
  const validCoverage = {
    patientId: ID.patient,
    payerId: ID.payer,
    memberId: 'PM-4471102',
    rank: 'PRIMARY',
  };

  it('accepts a primary policy', () => {
    accepts(coverageInput, validCoverage);
  });

  it('accepts an effective period in order', () => {
    accepts(coverageInput, {
      ...validCoverage,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    });
  });

  it('rejects an effective period that ends before it starts', () => {
    rejects(coverageInput, {
      ...validCoverage,
      effectiveFrom: '2026-12-31',
      effectiveTo: '2026-01-01',
    });
  });

  it('rejects a rank outside the three coordination-of-benefits slots', () => {
    rejects(coverageInput, { ...validCoverage, rank: 'QUATERNARY' });
  });

  it('rejects a negative copay', () => {
    rejects(coverageInput, { ...validCoverage, copayCents: -500 });
  });
});

describe('consentGrantInput', () => {
  it('accepts an active treatment consent', () => {
    accepts(consentGrantInput, { patientId: ID.patient, scope: 'TREATMENT' });
  });

  it('rejects a revoked consent with no revocation timestamp', () => {
    rejects(consentGrantInput, { patientId: ID.patient, scope: 'TREATMENT', status: 'REVOKED' });
  });

  it('accepts a revoked consent that records when', () => {
    accepts(consentGrantInput, {
      patientId: ID.patient,
      scope: 'PORTAL_ACCESS',
      status: 'REVOKED',
      revokedAt: '2026-08-13T09:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------

const validAppointment = {
  facilityId: ID.facility,
  patientId: ID.patient,
  providerId: ID.provider,
  typeCode: 'OV-20',
  typeDisplay: 'Office visit, 20 minutes',
  start: '2026-08-17T15:00:00.000Z',
  end: '2026-08-17T15:20:00.000Z',
  durationMinutes: 20,
};

describe('appointmentCreateInput', () => {
  it('accepts a booked appointment', () => {
    accepts(appointmentCreateInput, validAppointment);
  });

  it('accepts an unassigned block with no patient', () => {
    accepts(appointmentCreateInput, without(validAppointment, 'patientId'));
  });

  it('rejects an appointment that ends before it starts', () => {
    rejects(appointmentCreateInput, { ...validAppointment, end: '2026-08-17T14:00:00.000Z' });
  });

  it('rejects a zero-length appointment', () => {
    rejects(appointmentCreateInput, { ...validAppointment, end: validAppointment.start });
  });

  it.each([
    ['a duration over a day', { durationMinutes: 1441 }],
    ['a zero duration', { durationMinutes: 0 }],
    ['a status outside the closed set', { status: 'MAYBE' }],
    ['a createdVia outside the closed set', { createdVia: 'TELEPATHY' }],
  ])('rejects %s', (_label, patch) => {
    rejects(appointmentCreateInput, { ...validAppointment, ...patch });
  });
});

describe('appointmentStatusChangeInput', () => {
  it('accepts a Flow Board transition', () => {
    accepts(appointmentStatusChangeInput, {
      appointmentId: ID.encounter,
      status: 'ROOMED',
      room: 'Exam 2',
    });
  });

  it('rejects an unknown status', () => {
    rejects(appointmentStatusChangeInput, { appointmentId: ID.encounter, status: 'WAITING' });
  });
});

const validEncounter = {
  facilityId: ID.facility,
  patientId: ID.patient,
  providerId: ID.provider,
  startedAt: '2026-08-17T15:02:00.000Z',
};

describe('encounterCreateInput', () => {
  it('accepts an ambulatory encounter', () => {
    accepts(encounterCreateInput, validEncounter);
  });

  it('rejects an encounter that ends before it starts', () => {
    rejects(encounterCreateInput, { ...validEncounter, endedAt: '2026-08-17T14:00:00.000Z' });
  });

  it('rejects an inpatient class, which is out of scope', () => {
    rejects(encounterCreateInput, { ...validEncounter, class: 'INPATIENT' });
  });
});

describe('clinicalNoteInput', () => {
  const validNote = {
    patientId: ID.patient,
    encounterId: ID.encounter,
    authorId: ID.provider,
    title: 'Office visit',
    blocks: [{ type: 'heading', text: 'Subjective' }],
  };

  it('accepts a draft note', () => {
    accepts(clinicalNoteInput, validNote);
  });

  it('accepts the AI draft review state as a first-class value', () => {
    accepts(clinicalNoteInput, { ...validNote, state: 'AI_DRAFT_REVIEW' });
  });

  it('rejects blocks that are not a list of objects', () => {
    rejects(clinicalNoteInput, { ...validNote, blocks: 'Subjective: cough' });
  });

  it('rejects an unknown note state', () => {
    rejects(clinicalNoteInput, { ...validNote, state: 'FINALISED' });
  });
});

describe('noteAddendumInput', () => {
  it('accepts an addendum', () => {
    accepts(noteAddendumInput, {
      noteId: ID.note,
      authorId: ID.provider,
      blocks: [{ type: 'paragraph', text: 'Corrected laterality.' }],
      reason: 'Correction',
    });
  });

  it('rejects an addendum with no author', () => {
    rejects(noteAddendumInput, { noteId: ID.note, blocks: [] });
  });
});

describe('procedureInput', () => {
  const validProcedure = {
    patientId: ID.patient,
    code: '45378',
    display: 'Diagnostic colonoscopy',
    performedStart: '2026-08-12T09:00:00.000Z',
  };

  it('accepts a procedure that happened at a moment', () => {
    accepts(procedureInput, validProcedure);
  });

  it('accepts one that took a span', () => {
    accepts(procedureInput, {
      ...validProcedure,
      performedEnd: '2026-08-12T09:45:00.000Z',
    });
  });

  it('rejects an end before the start', () => {
    /* A procedure that finished before it began is a typo, and stored it turns
       into a negative duration in every report that measures one. */
    rejects(procedureInput, {
      ...validProcedure,
      performedEnd: '2026-08-12T08:00:00.000Z',
    });
  });

  it('accepts an end equal to the start, which a zero-length record can be', () => {
    accepts(procedureInput, {
      ...validProcedure,
      performedEnd: validProcedure.performedStart,
    });
  });

  it('rejects a not-done reason on a procedure that was done', () => {
    /*
     * The reason belongs to the status that needs one. Attached to a COMPLETED
     * procedure it reads as a reason it was carried out, which is a different
     * clinical claim and a field FHIR spells differently.
     */
    rejects(procedureInput, {
      ...validProcedure,
      status: 'COMPLETED',
      notDoneReason: 'Declined by the patient',
    });
  });

  it('accepts the reason when the status is the one that takes it', () => {
    accepts(procedureInput, {
      ...validProcedure,
      status: 'NOT_DONE',
      notDoneReason: 'Declined by the patient',
    });
  });

  it('rejects a status outside the closed set', () => {
    rejects(procedureInput, { ...validProcedure, status: 'FINISHED' });
  });
});

describe('conditionInput', () => {
  const validCondition = {
    patientId: ID.patient,
    code: 'J45.909',
    display: 'Unspecified asthma, uncomplicated',
  };

  it('accepts a problem-list entry', () => {
    accepts(conditionInput, validCondition);
  });

  it('defaults nothing it is not given: the code system stays optional', () => {
    expect(accepts(conditionInput, validCondition).codeSystem).toBeUndefined();
  });

  it('rejects abatement before onset', () => {
    rejects(conditionInput, {
      ...validCondition,
      onsetDate: '2026-05-01',
      abatementDate: '2026-04-01',
    });
  });

  it('rejects a clinical status outside the closed set', () => {
    rejects(conditionInput, { ...validCondition, clinicalStatus: 'CURED' });
  });

  it('accepts any code string, because terminology is bring-your-own', () => {
    accepts(conditionInput, { ...validCondition, code: 'LOCAL-42', codeSystem: 'local' });
  });
});

describe('allergyIntoleranceInput', () => {
  it('accepts a drug allergy', () => {
    accepts(allergyIntoleranceInput, {
      patientId: ID.patient,
      substanceDisplay: 'Penicillin G',
      substanceCode: '7980',
      substanceCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
      criticality: 'HIGH',
      severity: 'SEVERE',
      reactionCodes: ['247472004'],
    });
  });

  it('rejects a missing substance display', () => {
    rejects(allergyIntoleranceInput, { patientId: ID.patient, criticality: 'HIGH' });
  });

  it('rejects a severity outside the closed set', () => {
    rejects(allergyIntoleranceInput, {
      patientId: ID.patient,
      substanceDisplay: 'Penicillin G',
      severity: 'CATASTROPHIC',
    });
  });
});

describe('medicationStatementInput', () => {
  it('accepts a reported medication', () => {
    accepts(medicationStatementInput, {
      patientId: ID.patient,
      display: 'Albuterol 90 mcg inhaler',
      source: 'REPORTED',
    });
  });

  it('rejects a source outside the closed set', () => {
    rejects(medicationStatementInput, {
      patientId: ID.patient,
      display: 'Albuterol',
      source: 'GUESSED',
    });
  });
});

describe('medicationRequestInput', () => {
  const validRx = {
    patientId: ID.patient,
    prescriberId: ID.provider,
    display: 'Amoxicillin 500 mg capsule',
    sigText: 'Take 1 capsule by mouth three times daily for 10 days',
    quantity: 30,
    quantityUnit: 'capsule',
    refills: 0,
  };

  it('accepts a prescription', () => {
    accepts(medicationRequestInput, validRx);
  });

  it('accepts a controlled schedule', () => {
    accepts(medicationRequestInput, { ...validRx, controlledSchedule: '3' });
  });

  it.each([
    ['a zero quantity', { quantity: 0 }],
    ['a negative quantity', { quantity: -1 }],
    ['fractional refills', { refills: 1.5 }],
    ['negative refills', { refills: -1 }],
    ['schedule 1, which is not prescribable', { controlledSchedule: '1' }],
    ['a missing sig', { sigText: '' }],
  ])('rejects %s', (_label, patch) => {
    rejects(medicationRequestInput, { ...validRx, ...patch });
  });
});

describe('immunizationInput', () => {
  it('accepts an administered dose', () => {
    accepts(immunizationInput, {
      patientId: ID.patient,
      cvxCode: '150',
      display: 'Influenza, injectable, quadrivalent',
      administeredAt: '2026-08-17T15:30:00.000Z',
      doseQuantity: 0.5,
      doseUnit: 'mL',
    });
  });

  it('rejects a missing administration time', () => {
    rejects(immunizationInput, { patientId: ID.patient, cvxCode: '150', display: 'Influenza' });
  });
});

describe('observationInput', () => {
  const validVital = {
    patientId: ID.patient,
    code: '8867-4',
    display: 'Heart rate',
    valueNumber: 72,
    unit: '/min',
    effectiveAt: '2026-08-17T15:05:00.000Z',
  };

  it('accepts a numeric vital', () => {
    accepts(observationInput, validVital);
  });

  it('accepts a coded social-history answer', () => {
    accepts(observationInput, {
      patientId: ID.patient,
      category: 'SOCIAL_HISTORY',
      code: '72166-2',
      display: 'Tobacco smoking status',
      valueCode: '266919005',
      effectiveAt: '2026-08-17T15:05:00.000Z',
    });
  });

  it('rejects an observation with no value at all', () => {
    rejects(observationInput, without(validVital, 'valueNumber'));
  });

  it('rejects a numeric value with no UCUM unit', () => {
    rejects(observationInput, without(validVital, 'unit'));
  });

  it('rejects a reference range that is inverted', () => {
    rejects(observationInput, { ...validVital, referenceLow: 100, referenceHigh: 60 });
  });

  it('rejects a non-finite value', () => {
    rejects(observationInput, { ...validVital, valueNumber: Number.POSITIVE_INFINITY });
  });
});

// ---------------------------------------------------------------------------

const validOrder = {
  patientId: ID.patient,
  orderedById: ID.provider,
  code: '58410-2',
  codeSystem: 'http://loinc.org',
  display: 'CBC with differential panel',
};

describe('serviceRequestInput', () => {
  it('accepts a routine lab order', () => {
    accepts(serviceRequestInput, validOrder);
  });

  it('accepts every order priority', () => {
    for (const priority of ['ROUTINE', 'URGENT', 'ASAP', 'STAT']) {
      accepts(serviceRequestInput, { ...validOrder, priority });
    }
  });

  it('rejects a priority outside the closed set', () => {
    rejects(serviceRequestInput, { ...validOrder, priority: 'WHENEVER' });
  });

  it('rejects a missing code system, because a bare code is unresolvable', () => {
    rejects(serviceRequestInput, without(validOrder, 'codeSystem'));
  });
});

describe('specimenInput', () => {
  const validSpecimen = {
    patientId: ID.patient,
    typeCode: '119297000',
    typeDisplay: 'Blood specimen',
  };

  it('accepts a collected specimen', () => {
    accepts(specimenInput, {
      ...validSpecimen,
      collectedAt: '2026-08-17T15:40:00.000Z',
      receivedAt: '2026-08-17T17:00:00.000Z',
      accessionNumber: 'ACC-0001',
    });
  });

  it('rejects a specimen received before it was collected', () => {
    rejects(specimenInput, {
      ...validSpecimen,
      collectedAt: '2026-08-17T17:00:00.000Z',
      receivedAt: '2026-08-17T15:40:00.000Z',
    });
  });

  it('rejects an unsatisfactory specimen with no rejection reason', () => {
    rejects(specimenInput, { ...validSpecimen, status: 'UNSATISFACTORY' });
  });
});

describe('diagnosticReportInput', () => {
  const validReport = {
    patientId: ID.patient,
    code: '58410-2',
    display: 'CBC with differential panel',
  };

  it('accepts a report with discrete results', () => {
    accepts(diagnosticReportInput, {
      ...validReport,
      status: 'FINAL',
      abnormalFlag: 'ABNORMAL',
      results: [
        {
          sequence: 1,
          code: '718-7',
          display: 'Haemoglobin',
          valueNumber: 11.1,
          unit: 'g/dL',
          referenceLow: 12,
          referenceHigh: 16,
          abnormalFlag: 'ABNORMAL',
          effectiveAt: '2026-08-17T18:00:00.000Z',
        },
      ],
    });
  });

  it('rejects an abnormal flag outside the closed set', () => {
    rejects(diagnosticReportInput, { ...validReport, abnormalFlag: 'PANIC' });
  });

  it('rejects a result line with no effective instant', () => {
    rejects(diagnosticReportInput, {
      ...validReport,
      results: [{ sequence: 1, code: '718-7', display: 'Haemoglobin' }],
    });
  });
});

describe('documentInput', () => {
  const validDocument = {
    category: '11488-4',
    title: 'Consult note (inbound fax)',
    storageKey: 'tenants/demo/documents/0001.pdf',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    byteSize: 20_480,
    source: 'FAX',
  };

  it('accepts an inbound fax', () => {
    accepts(documentInput, validDocument);
  });

  it.each([
    ['a short digest', { sha256: 'a'.repeat(63) }],
    ['an uppercase digest', { sha256: 'A'.repeat(64) }],
    ['a zero byte size', { byteSize: 0 }],
    ['a source outside the closed set', { source: 'CARRIER_PIGEON' }],
  ])('rejects %s', (_label, patch) => {
    rejects(documentInput, { ...validDocument, ...patch });
  });
});

describe('taskInput', () => {
  const validTask = {
    type: 'RESULT',
    title: 'Review abnormal CBC',
    assigneeType: 'USER',
    assigneeUserId: ID.provider,
  };

  it('accepts a user-assigned result task', () => {
    accepts(taskInput, validTask);
  });

  it('accepts a team-pool task', () => {
    accepts(taskInput, {
      type: 'REFILL',
      title: 'Refill request',
      assigneeType: 'TEAM',
      assigneeTeamKey: 'nursing',
    });
  });

  it('rejects a task assigned to both a user and a team', () => {
    rejects(taskInput, { ...validTask, assigneeTeamKey: 'nursing' });
  });

  it('rejects a task assigned to nobody', () => {
    rejects(taskInput, without(validTask, 'assigneeUserId'));
  });

  it('rejects a USER assignee named by team key', () => {
    rejects(taskInput, { type: 'RESULT', title: 'x', assigneeType: 'USER', assigneeTeamKey: 'n' });
  });

  it('rejects a task type outside the closed set', () => {
    rejects(taskInput, { ...validTask, type: 'ERRAND' });
  });
});

// ---------------------------------------------------------------------------

const validCharge = {
  facilityId: ID.facility,
  encounterId: ID.encounter,
  patientId: ID.patient,
  code: '99213',
  display: 'Office visit, established patient, low complexity',
  unitPriceCents: 14_500,
  totalPriceCents: 14_500,
  renderingProviderId: ID.provider,
  serviceDate: '2026-08-17',
  diagnosisPointers: [1],
};

describe('chargeItemInput', () => {
  it('accepts a fee-sheet line', () => {
    accepts(chargeItemInput, validCharge);
  });

  it('accepts up to four modifiers', () => {
    accepts(chargeItemInput, { ...validCharge, modifiers: ['25', 'GT', '59', 'XU'] });
  });

  it('rejects a fifth modifier, which 837P cannot carry', () => {
    rejects(chargeItemInput, { ...validCharge, modifiers: ['25', 'GT', '59', 'XU', 'GY'] });
  });

  it('rejects a one-character modifier', () => {
    rejects(chargeItemInput, { ...validCharge, modifiers: ['2'] });
  });

  it('rejects a negative price', () => {
    rejects(chargeItemInput, { ...validCharge, totalPriceCents: -100 });
  });

  it('rejects fractional cents', () => {
    rejects(chargeItemInput, { ...validCharge, totalPriceCents: 145.5 });
  });

  it('rejects a zero-based diagnosis pointer', () => {
    rejects(chargeItemInput, { ...validCharge, diagnosisPointers: [0] });
  });

  it('rejects a voided charge with no reason', () => {
    rejects(chargeItemInput, { ...validCharge, status: 'VOIDED' });
  });
});

describe('claimCreateInput', () => {
  const validClaim = {
    patientId: ID.patient,
    encounterId: ID.encounter,
    coverageId: ID.coverage,
    payerId: ID.payer,
    diagnosisCodes: ['J45.909'],
    lines: [
      {
        chargeItemId: ID.charge,
        sequence: 1,
        code: '99213',
        chargedCents: 14_500,
        serviceDateFrom: '2026-08-17',
        diagnosisPointers: [1],
      },
    ],
  };

  it('accepts a professional claim', () => {
    accepts(claimCreateInput, validClaim);
  });

  it('rejects a claim with no lines', () => {
    rejects(claimCreateInput, { ...validClaim, lines: [] });
  });

  it('rejects a claim with no diagnoses', () => {
    rejects(claimCreateInput, { ...validClaim, diagnosisCodes: [] });
  });

  it('rejects duplicate line sequences', () => {
    const line = validClaim.lines[0];
    rejects(claimCreateInput, { ...validClaim, lines: [line, line] });
  });

  it('rejects a diagnosis pointer past the end of the diagnosis list', () => {
    rejects(claimCreateInput, {
      ...validClaim,
      lines: [{ ...validClaim.lines[0], diagnosisPointers: [2] }],
    });
  });

  it('rejects a replacement claim that does not name the claim it replaces', () => {
    rejects(claimCreateInput, { ...validClaim, frequency: 'REPLACEMENT' });
  });

  it('accepts a replacement claim that does', () => {
    accepts(claimCreateInput, {
      ...validClaim,
      frequency: 'REPLACEMENT',
      priorClaimId: ID.claim,
    });
  });

  it('rejects a status outside the lifecycle', () => {
    rejects(claimCreateInput, { ...validClaim, status: 'MAILED' });
  });
});

describe('claimStatusChangeInput', () => {
  it.each(['system', '999', '277', '835', 'user'])(
    'accepts a transition sourced from %s',
    (source) => {
      accepts(claimStatusChangeInput, { claimId: ID.claim, status: 'ACKNOWLEDGED', source });
    }
  );

  it('rejects an unknown source', () => {
    rejects(claimStatusChangeInput, { claimId: ID.claim, status: 'PAID', source: 'phone-call' });
  });
});

// ---------------------------------------------------------------------------

describe('paymentCreateInput', () => {
  const validPayment = {
    patientId: ID.patient,
    source: 'PATIENT',
    method: 'CARD',
    amountCents: 2_500,
  };

  it('accepts a patient copay', () => {
    accepts(paymentCreateInput, validPayment);
  });

  it('accepts allocations that fit within the payment', () => {
    accepts(paymentCreateInput, {
      ...validPayment,
      allocations: [{ patientId: ID.patient, claimId: ID.claim, amountCents: 2_500 }],
    });
  });

  it('rejects allocations that exceed the payment', () => {
    rejects(paymentCreateInput, {
      ...validPayment,
      allocations: [{ patientId: ID.patient, claimId: ID.claim, amountCents: 9_900 }],
    });
  });

  it('rejects an allocation that targets nothing', () => {
    rejects(paymentCreateInput, {
      ...validPayment,
      allocations: [{ patientId: ID.patient, amountCents: 100 }],
    });
  });

  it('rejects a zero allocation', () => {
    rejects(paymentCreateInput, {
      ...validPayment,
      allocations: [{ patientId: ID.patient, claimId: ID.claim, amountCents: 0 }],
    });
  });

  it('rejects a payment from neither a patient nor a payer', () => {
    rejects(paymentCreateInput, without(validPayment, 'patientId'));
  });

  it('rejects an ERA payment with no remittance', () => {
    rejects(paymentCreateInput, { ...validPayment, source: 'PAYER_ERA', payerId: ID.payer });
  });

  it('rejects anything that looks like an instrument number', () => {
    rejects(paymentCreateInput, { ...validPayment, cardNumber: '4111111111111111' });
  });

  it('rejects a non-ISO currency', () => {
    rejects(paymentCreateInput, { ...validPayment, currency: 'DOLLARS' });
  });
});

describe('remittanceInput', () => {
  const validRemittance = {
    payerId: ID.payer,
    checkOrEftNumber: 'EFT-0001',
    totalPaidCents: 11_000,
  };

  it('accepts an 835 with lines', () => {
    accepts(remittanceInput, {
      ...validRemittance,
      lines: [
        {
          sequence: 0,
          claimId: ID.claim,
          payerControlNumber: 'PM-0001',
          chargedCents: 14_500,
          allowedCents: 11_000,
          paidCents: 11_000,
          adjustmentGroupCode: 'CO',
          adjustmentReasonCode: '45',
        },
      ],
    });
  });

  it('rejects duplicate line sequences', () => {
    rejects(remittanceInput, {
      ...validRemittance,
      lines: [{ sequence: 0 }, { sequence: 0 }],
    });
  });

  it('rejects an adjustment group code outside the X12 set', () => {
    rejects(remittanceInput, {
      ...validRemittance,
      lines: [{ sequence: 0, adjustmentGroupCode: 'ZZ' }],
    });
  });
});

describe('statementInput', () => {
  const validStatement = { patientId: ID.patient, balanceCents: 3_500 };

  it('accepts a statement', () => {
    accepts(statementInput, validStatement);
  });

  it('rejects a pay link with no expiry', () => {
    rejects(statementInput, { ...validStatement, payLinkToken: 'a'.repeat(43) });
  });

  it('accepts a pay link that expires', () => {
    accepts(statementInput, {
      ...validStatement,
      payLinkToken: 'a'.repeat(43),
      payLinkExpiresAt: '2026-09-13T00:00:00.000Z',
    });
  });

  it('rejects a period that ends before it starts', () => {
    rejects(statementInput, {
      ...validStatement,
      periodStart: '2026-08-31',
      periodEnd: '2026-08-01',
    });
  });

  it('rejects a short pay-link token', () => {
    rejects(statementInput, {
      ...validStatement,
      payLinkToken: 'short',
      payLinkExpiresAt: '2026-09-13T00:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------

describe('promotionManifestInput', () => {
  const validManifest = {
    definitionKey: 'intake-vitals',
    definitionVersion: 1,
    fields: [{ fieldKey: 'painScore', type: 'number' }],
  };

  it('accepts a manifest', () => {
    accepts(promotionManifestInput, validManifest);
  });

  it('rejects a duplicated field key', () => {
    rejects(promotionManifestInput, {
      ...validManifest,
      fields: [
        { fieldKey: 'painScore', type: 'number' },
        { fieldKey: 'painScore', type: 'text' },
      ],
    });
  });

  it('rejects a quantity field with no default unit', () => {
    rejects(promotionManifestInput, {
      ...validManifest,
      fields: [{ fieldKey: 'weight', type: 'quantity' }],
    });
  });

  it('rejects a field key that is not an identifier', () => {
    rejects(promotionManifestInput, {
      ...validManifest,
      fields: [{ fieldKey: 'pain-score', type: 'number' }],
    });
  });

  it('rejects a promoted type outside the catalogue', () => {
    rejects(promotionManifestInput, {
      ...validManifest,
      fields: [{ fieldKey: 'signature', type: 'signature' }],
    });
  });
});

describe('formDefinitionCreateInput', () => {
  const validDefinition = {
    key: 'intake-vitals',
    version: 1,
    title: 'Intake vitals',
    bindTo: 'ENCOUNTER',
    definition: { fields: [] },
  };

  it('accepts a draft definition', () => {
    accepts(formDefinitionCreateInput, validDefinition);
  });

  it.each([
    ['a non-kebab key', { key: 'IntakeVitals' }],
    ['a zero version', { version: 0 }],
    ['a binding outside the four consumers', { bindTo: 'INVOICE' }],
    ['a non-object definition', { definition: '[]' }],
  ])('rejects %s', (_label, patch) => {
    rejects(formDefinitionCreateInput, { ...validDefinition, ...patch });
  });
});

describe('formDefinitionPublishInput', () => {
  it('accepts a publish with compiled artefacts', () => {
    accepts(formDefinitionPublishInput, { formDefinitionId: ID.form, compiled: { zod: {} } });
  });

  it('rejects a publish with no compiled artefacts', () => {
    rejects(formDefinitionPublishInput, { formDefinitionId: ID.form });
  });
});

describe('formSubmissionInput', () => {
  const validSubmission = {
    formDefinitionId: ID.form,
    patientId: ID.patient,
    values: { painScore: 4 },
  };

  it('accepts a patient-completed submission', () => {
    accepts(formSubmissionInput, { ...validSubmission, completedByType: 'PATIENT' });
  });

  it('rejects a staff-completed submission with no user', () => {
    rejects(formSubmissionInput, { ...validSubmission, completedByType: 'USER' });
  });

  it('rejects a completed submission with no completion time', () => {
    rejects(formSubmissionInput, {
      ...validSubmission,
      completedByType: 'PATIENT',
      status: 'COMPLETED',
    });
  });

  it('rejects values that are not a JSON object', () => {
    rejects(formSubmissionInput, { ...validSubmission, values: [1, 2] });
  });
});

describe('formPromotedValueQuery', () => {
  it('accepts a per-patient graph query', () => {
    accepts(formPromotedValueQuery, { patientId: ID.patient, fieldKey: 'painScore' });
  });

  it('accepts a cross-patient report query scoped to a definition', () => {
    accepts(formPromotedValueQuery, { definitionKey: 'intake-vitals', fieldKey: 'painScore' });
  });

  it('rejects an unscoped query that would scan every promoted value', () => {
    rejects(formPromotedValueQuery, { fieldKey: 'painScore' });
  });

  it('rejects an inverted date window', () => {
    rejects(formPromotedValueQuery, {
      patientId: ID.patient,
      fieldKey: 'painScore',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
  });
});

describe('terminologyCodeInput', () => {
  it('accepts a loaded code', () => {
    accepts(terminologyCodeInput, {
      system: 'http://loinc.org',
      code: '8867-4',
      display: 'Heart rate',
    });
  });

  it('accepts a system this repository has never heard of', () => {
    accepts(terminologyCodeInput, {
      system: 'urn:oid:2.16.840.1.113883.6.1',
      code: 'x',
      display: 'y',
    });
  });

  it('rejects an empty code', () => {
    rejects(terminologyCodeInput, { system: 'http://loinc.org', code: '', display: 'Heart rate' });
  });
});
