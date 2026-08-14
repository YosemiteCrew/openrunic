import { describe, expect, it } from 'vitest';

import {
  ABNORMAL_FLAG_EXTENSION,
  DIAGNOSTIC_REPORT_DROPPED_FIELDS,
  DIAGNOSTIC_REPORT_EXTENSION,
  DOCUMENT_REFERENCE_DROPPED_FIELDS,
  DOCUMENT_SOURCE_EXTENSION,
  DOCUMENT_STATUS,
  LOCAL_STATUS_EXTENSION,
  OBSERVATION_DROPPED_FIELDS,
  RESULT_OBSERVATION_DROPPED_FIELDS,
  SERVICE_REQUEST_DROPPED_FIELDS,
  SERVICE_REQUEST_STATUS,
  SPECIMEN_DROPPED_FIELDS,
  SPECIMEN_TYPE_EXTENSION,
  SYSTEMS,
  UCUM_SYSTEM,
  fromFhirDiagnosticReport,
  fromFhirDocumentReference,
  fromFhirObservation,
  fromFhirResultObservation,
  fromFhirServiceRequest,
  fromFhirSpecimen,
  toFhirDiagnosticReport,
  toFhirDocumentReference,
  toFhirObservation,
  toFhirResultObservation,
  toFhirServiceRequest,
  toFhirSpecimen,
} from './index.js';
import type {
  DomainDiagnosticReport,
  DomainDocument,
  DomainObservation,
  DomainResultObservation,
  DomainServiceRequest,
  DomainSpecimen,
} from './index.js';
import { describeRoundTrips, expectDroppedFields } from './test-support/round-trip.js';

describe('observation mapping', () => {
  const vital: DomainObservation = {
    id: 'obs-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    category: 'VITAL_SIGNS',
    status: 'FINAL',
    code: '8480-6',
    codeSystem: SYSTEMS.loinc,
    display: 'Systolic blood pressure',
    valueNumber: 128,
    unit: 'mm[Hg]',
    referenceLow: 90,
    referenceHigh: 120,
    interpretationCode: 'H',
    bodySiteCode: '368209003',
    effectiveAt: '2026-08-13T16:05:00.000Z',
    issuedAt: '2026-08-13T16:06:00.000Z',
    performerId: 'u-2',
  };
  const sdoh: DomainObservation = {
    id: 'obs-2',
    patientId: 'pat-1',
    category: 'SDOH',
    status: 'FINAL',
    code: '88122-7',
    codeSystem: SYSTEMS.loinc,
    display: 'Worried food would run out',
    valueCode: 'LA28397-0',
    effectiveAt: '2026-08-13T16:07:00.000Z',
  };
  const survey: DomainObservation = {
    id: 'obs-3',
    patientId: 'pat-1',
    category: 'SURVEY',
    status: 'PRELIMINARY',
    code: '44249-1',
    codeSystem: SYSTEMS.loinc,
    display: 'PHQ-9 total score',
    valueBoolean: false,
    effectiveAt: '2026-08-13T16:08:00.000Z',
  };
  const degenerate: DomainObservation = {
    id: '',
    patientId: '',
    category: 'LABORATORY',
    status: 'FINAL',
    code: '',
    codeSystem: '',
    display: '',
    effectiveAt: '',
  };

  it('puts SDOH in the US Core category system and vitals in the HL7 one', () => {
    expect(toFhirObservation(sdoh).category).toStrictEqual([
      { coding: [{ system: SYSTEMS.usCoreCategory, code: 'sdoh' }] },
    ]);
    expect(toFhirObservation(vital).category).toStrictEqual([
      { coding: [{ system: SYSTEMS.observationCategory, code: 'vital-signs' }] },
    ]);
  });

  it('emits a UCUM quantity with its reference range', () => {
    const resource = toFhirObservation(vital);
    expect(resource.valueQuantity).toStrictEqual({
      value: 128,
      unit: 'mm[Hg]',
      system: UCUM_SYSTEM,
      code: 'mm[Hg]',
    });
    expect(resource.referenceRange).toStrictEqual([
      {
        low: { value: 90, unit: 'mm[Hg]', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
        high: { value: 120, unit: 'mm[Hg]', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
      },
    ]);
  });

  it('keeps only the highest-precedence value when several are populated', () => {
    const resource = toFhirObservation({ ...vital, valueText: 'ignored', valueCode: 'ignored' });
    expect(resource.valueQuantity?.value).toBe(128);
    expect(resource).not.toHaveProperty('valueString');
    expect(resource).not.toHaveProperty('valueCodeableConcept');
  });

  it('documents the observation columns that stay inside Openrunic', () => {
    expectDroppedFields(vital, OBSERVATION_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Observation', toFhir: toFhirObservation, fromFhir: fromFhirObservation },
    [
      { label: 'vital sign', domain: vital },
      { label: 'SDOH answer', domain: sdoh },
      { label: 'boolean survey', domain: survey },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('result observation mapping', () => {
  const abnormal: DomainResultObservation = {
    id: 'res-1',
    diagnosticReportId: 'dr-1',
    patientId: 'pat-1',
    status: 'FINAL',
    code: '718-7',
    codeSystem: SYSTEMS.loinc,
    display: 'Haemoglobin',
    valueNumber: 10.2,
    unit: 'g/dL',
    referenceLow: 12,
    referenceHigh: 16,
    referenceRangeText: '12.0-16.0 g/dL',
    interpretationCode: 'L',
    abnormalFlag: 'ABNORMAL',
    effectiveAt: '2026-08-13T17:00:00.000Z',
  };
  const textual: DomainResultObservation = {
    id: 'res-2',
    diagnosticReportId: 'dr-1',
    patientId: 'pat-1',
    status: 'FINAL',
    code: '600-7',
    codeSystem: SYSTEMS.loinc,
    display: 'Culture',
    valueText: 'No growth after 48 hours',
    abnormalFlag: 'NORMAL',
    effectiveAt: '2026-08-13T17:01:00.000Z',
  };
  const degenerate: DomainResultObservation = {
    id: '',
    diagnosticReportId: '',
    patientId: '',
    status: 'REGISTERED',
    code: '',
    codeSystem: '',
    display: '',
    abnormalFlag: 'NORMAL',
    effectiveAt: '',
  };

  it('links the result back to its report through an extension', () => {
    expect(toFhirResultObservation(abnormal).extension).toStrictEqual([
      {
        url: DIAGNOSTIC_REPORT_EXTENSION,
        valueReference: { type: 'DiagnosticReport', reference: 'DiagnosticReport/dr-1' },
      },
      { url: ABNORMAL_FLAG_EXTENSION, valueCode: 'ABNORMAL' },
    ]);
  });

  it('files every discrete result under the laboratory category', () => {
    expect(toFhirResultObservation(textual).category).toStrictEqual([
      { coding: [{ system: SYSTEMS.observationCategory, code: 'laboratory' }] },
    ]);
  });

  it('documents the result columns that stay inside Openrunic', () => {
    expectDroppedFields(abnormal, RESULT_OBSERVATION_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'Observation',
      toFhir: toFhirResultObservation,
      fromFhir: fromFhirResultObservation,
    },
    [
      { label: 'abnormal result', domain: abnormal },
      { label: 'textual result', domain: textual },
      { label: 'degenerate result', domain: degenerate },
    ]
  );
});

describe('diagnostic report mapping', () => {
  const lab: DomainDiagnosticReport = {
    id: 'dr-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    serviceRequestId: 'sr-1',
    specimenId: 'spec-1',
    status: 'FINAL',
    category: 'LAB',
    code: '58410-2',
    codeSystem: SYSTEMS.loinc,
    display: 'CBC panel',
    performingLabName: 'Cascade Reference Laboratory',
    abnormalFlag: 'ABNORMAL',
    narrative: 'Mild anaemia.',
    resultIds: ['res-1', 'res-2'],
    effectiveAt: '2026-08-13T17:00:00.000Z',
    issuedAt: '2026-08-13T17:05:00.000Z',
  };
  const imaging: DomainDiagnosticReport = {
    id: 'dr-2',
    patientId: 'pat-1',
    status: 'PRELIMINARY',
    category: 'IMAGING',
    code: '36643-5',
    codeSystem: SYSTEMS.loinc,
    display: 'Chest X-ray',
    abnormalFlag: 'NORMAL',
    resultIds: [],
    issuedAt: '2026-08-13T17:10:00.000Z',
  };
  const degenerate: DomainDiagnosticReport = {
    id: '',
    patientId: '',
    status: 'REGISTERED',
    category: 'THERAPY',
    code: '',
    codeSystem: '',
    display: '',
    abnormalFlag: 'CRITICAL',
    resultIds: [],
    issuedAt: '',
  };

  it('maps lab and imaging onto the HL7 diagnostic service sections', () => {
    expect(toFhirDiagnosticReport(lab).category).toStrictEqual([
      { coding: [{ system: SYSTEMS.diagnosticServiceSection, code: 'LAB' }] },
    ]);
    expect(toFhirDiagnosticReport(imaging).category).toStrictEqual([
      { coding: [{ system: SYSTEMS.diagnosticServiceSection, code: 'RAD' }] },
    ]);
  });

  it('references every discrete result', () => {
    expect(toFhirDiagnosticReport(lab).result).toStrictEqual([
      { type: 'Observation', reference: 'Observation/res-1' },
      { type: 'Observation', reference: 'Observation/res-2' },
    ]);
  });

  it('documents the report columns that stay inside Openrunic', () => {
    expectDroppedFields(lab, DIAGNOSTIC_REPORT_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'DiagnosticReport',
      toFhir: toFhirDiagnosticReport,
      fromFhir: fromFhirDiagnosticReport,
    },
    [
      { label: 'lab', domain: lab },
      { label: 'imaging', domain: imaging },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('service request mapping', () => {
  const lab: DomainServiceRequest = {
    id: 'sr-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    orderedById: 'u-1',
    category: 'LAB',
    status: 'TRANSMITTED',
    intent: 'ORDER',
    priority: 'ROUTINE',
    code: '58410-2',
    codeSystem: SYSTEMS.loinc,
    display: 'CBC panel',
    specimenTypeCode: '119297000',
    reasonCodes: ['D64.9'],
    note: 'Fasting not required.',
    requisitionNumber: 'REQ-000123',
    performingLabName: 'Cascade Reference Laboratory',
    requestedAt: '2026-08-13T16:35:00.000Z',
    scheduledFor: '2026-08-14T14:00:00.000Z',
  };
  const referral: DomainServiceRequest = {
    id: 'sr-2',
    patientId: 'pat-1',
    orderedById: 'u-1',
    category: 'REFERRAL',
    status: 'PENDED',
    intent: 'PROPOSAL',
    priority: 'STAT',
    code: '306206005',
    codeSystem: SYSTEMS.snomed,
    display: 'Referral to cardiology',
    reasonCodes: [],
    requestedAt: '2026-08-13T16:36:00.000Z',
  };
  const degenerate: DomainServiceRequest = {
    id: '',
    patientId: '',
    orderedById: '',
    category: 'THERAPY',
    status: 'DRAFT',
    intent: 'ORDER',
    priority: 'ROUTINE',
    code: '',
    codeSystem: '',
    display: '',
    reasonCodes: [],
    requestedAt: '',
  };

  it('keeps the order lifecycle states FHIR collapses', () => {
    expect(toFhirServiceRequest(lab).status).toBe('active');
    expect(toFhirServiceRequest(lab).extension).toContainEqual({
      url: LOCAL_STATUS_EXTENSION,
      valueCode: 'TRANSMITTED',
    });
    expect(SERVICE_REQUEST_STATUS.lossyValues).toStrictEqual([
      'PENDED',
      'TRANSMITTED',
      'IN_PROGRESS',
      'RESULTED',
    ]);
  });

  it('carries the compendium specimen type in an extension', () => {
    expect(toFhirServiceRequest(lab).extension).toContainEqual({
      url: SPECIMEN_TYPE_EXTENSION,
      valueCode: '119297000',
    });
  });

  it('uses the standard requisition identifier for the requisition number', () => {
    expect(toFhirServiceRequest(lab).requisition?.value).toBe('REQ-000123');
  });

  it('documents the order columns that stay inside Openrunic', () => {
    expectDroppedFields(lab, SERVICE_REQUEST_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'ServiceRequest',
      toFhir: toFhirServiceRequest,
      fromFhir: fromFhirServiceRequest,
    },
    [
      { label: 'lab order', domain: lab },
      { label: 'referral', domain: referral },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('specimen mapping', () => {
  const collected: DomainSpecimen = {
    id: 'spec-1',
    patientId: 'pat-1',
    serviceRequestId: 'sr-1',
    status: 'AVAILABLE',
    accessionNumber: 'ACC-778201',
    typeCode: '119297000',
    typeDisplay: 'Blood specimen',
    collectionMethodCode: '129300006',
    bodySiteCode: '368209003',
    collectedAt: '2026-08-13T16:45:00.000Z',
    collectedById: 'u-2',
    receivedAt: '2026-08-13T16:58:00.000Z',
    containerType: 'Lavender top tube',
    volumeValue: 4,
    volumeUnit: 'mL',
    note: 'Transported at room temperature.',
  };
  const rejected: DomainSpecimen = {
    id: 'spec-2',
    patientId: 'pat-1',
    status: 'UNSATISFACTORY',
    typeCode: '122575003',
    typeDisplay: 'Urine specimen',
    rejectionReason: 'Insufficient volume',
  };
  const degenerate: DomainSpecimen = {
    id: '',
    patientId: '',
    status: 'ENTERED_IN_ERROR',
    typeCode: '',
    typeDisplay: '',
  };

  it('uses the accession identifier rather than a plain identifier', () => {
    expect(toFhirSpecimen(collected).accessionIdentifier?.value).toBe('ACC-778201');
  });

  it('omits the collection element entirely when nothing was collected', () => {
    expect(toFhirSpecimen(rejected).collection).toBeUndefined();
  });

  it('documents the specimen columns that stay inside Openrunic', () => {
    expectDroppedFields(collected, SPECIMEN_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Specimen', toFhir: toFhirSpecimen, fromFhir: fromFhirSpecimen },
    [
      { label: 'collected', domain: collected },
      { label: 'rejected', domain: rejected },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('document reference mapping', () => {
  const fax: DomainDocument = {
    id: 'doc-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    category: '11488-4',
    title: 'Cardiology consult note',
    url: 'Binary/doc-1',
    contentType: 'application/pdf',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    byteSize: 20481,
    source: 'FAX',
    status: 'INBOX',
    sensitivityClass: 'RESTRICTED',
    receivedAt: '2026-08-13T18:00:00.000Z',
  };
  const filed: DomainDocument = {
    id: 'doc-2',
    category: '34133-9',
    title: 'Summary of care',
    contentType: 'application/pdf',
    sha256: 'ab',
    byteSize: 1,
    source: 'GENERATED',
    status: 'FILED',
    sensitivityClass: 'NORMAL',
    receivedAt: '2026-08-13T18:05:00.000Z',
  };
  const degenerate: DomainDocument = {
    id: '',
    category: '',
    title: '',
    contentType: '',
    sha256: '',
    byteSize: 0,
    source: 'UPLOAD',
    status: 'ENTERED_IN_ERROR',
    sensitivityClass: 'VERY_RESTRICTED',
    receivedAt: '',
  };

  it('keeps inbox and filed distinguishable behind one FHIR status', () => {
    expect(toFhirDocumentReference(fax).status).toBe('current');
    expect(toFhirDocumentReference(filed).status).toBe('current');
    expect(toFhirDocumentReference(filed).extension).toContainEqual({
      url: LOCAL_STATUS_EXTENSION,
      valueCode: 'FILED',
    });
    expect(DOCUMENT_STATUS.lossyValues).toStrictEqual(['FILED']);
  });

  it('carries the intake source in an extension', () => {
    expect(toFhirDocumentReference(fax).extension).toContainEqual({
      url: DOCUMENT_SOURCE_EXTENSION,
      valueCode: 'FAX',
    });
  });

  it('converts the hex digest to the base64 hash FHIR requires', () => {
    const attachment = toFhirDocumentReference(fax).content[0]?.attachment;
    expect(attachment?.hash).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(attachment?.size).toBe(20481);
  });

  it('omits a malformed digest rather than serializing it as a lie', () => {
    const attachment = toFhirDocumentReference({ ...fax, sha256: 'zz' }).content[0]?.attachment;
    expect(attachment).not.toHaveProperty('hash');
  });

  it('maps the sensitivity class to a confidentiality security label', () => {
    expect(toFhirDocumentReference(fax).securityLabel).toStrictEqual([
      { coding: [{ system: SYSTEMS.confidentiality, code: 'R' }] },
    ]);
  });

  it('documents the document columns that stay inside Openrunic', () => {
    expectDroppedFields(fax, DOCUMENT_REFERENCE_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'DocumentReference',
      toFhir: toFhirDocumentReference,
      fromFhir: fromFhirDocumentReference,
    },
    [
      { label: 'inbound fax', domain: fax },
      { label: 'generated', domain: filed },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});
