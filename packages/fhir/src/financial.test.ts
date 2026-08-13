import { describe, expect, it } from 'vitest';

import {
  ACTOR_SYSTEM,
  ACTOR_TYPE_SYSTEM,
  AUDIT_ACTION_SYSTEM,
  AUDIT_OUTCOME_EXTENSION,
  BREAKGLASS_EXTENSION,
  CLAIM_DROPPED_FIELDS,
  CLAIM_FREQUENCY_EXTENSION,
  CLAIM_STATUS,
  CONSENT_DROPPED_FIELDS,
  CONSENT_SCOPE_SYSTEM,
  CONSENT_STATUS,
  LOCAL_STATUS_EXTENSION,
  PROVENANCE_DROPPED_FIELDS,
  SYSTEMS,
  fromFhirClaim,
  fromFhirConsent,
  fromFhirProvenance,
  toFhirClaim,
  toFhirConsent,
  toFhirProvenance,
} from './index.js';
import type { DomainClaim, DomainConsentGrant, DomainProvenance } from './index.js';
import { describeRoundTrips, expectDroppedFields } from './test-support/round-trip.js';

describe('claim mapping', () => {
  const denied: DomainClaim = {
    id: 'clm-1',
    patientId: 'pat-1',
    coverageId: 'cov-1',
    payerId: 'pay-1',
    providerId: 'u-1',
    status: 'DENIED',
    frequency: 'ORIGINAL',
    diagnosisCodes: ['I10', 'E11.9'],
    totalChargedCents: 24500,
    createdAt: '2026-08-13T19:00:00.000Z',
    lines: [
      {
        sequence: 1,
        code: '99213',
        codeSystem: SYSTEMS.cpt,
        modifiers: ['25'],
        units: 1,
        chargedCents: 17500,
        diagnosisPointers: [1],
        serviceDateFrom: '2026-08-13',
      },
      {
        sequence: 2,
        code: '36415',
        codeSystem: SYSTEMS.cpt,
        modifiers: [],
        units: 1,
        chargedCents: 7000,
        diagnosisPointers: [1, 2],
        serviceDateFrom: '2026-08-13',
        serviceDateTo: '2026-08-14',
      },
    ],
  };
  const draft: DomainClaim = {
    id: 'clm-2',
    patientId: 'pat-1',
    coverageId: 'cov-1',
    payerId: 'pay-1',
    providerId: 'u-1',
    status: 'DRAFT',
    frequency: 'REPLACEMENT',
    diagnosisCodes: [],
    totalChargedCents: 0,
    createdAt: '2026-08-13T19:05:00.000Z',
    lines: [],
  };
  const degenerate: DomainClaim = {
    id: '',
    patientId: '',
    coverageId: '',
    payerId: '',
    providerId: '',
    status: 'VOID',
    frequency: 'VOID',
    diagnosisCodes: [],
    totalChargedCents: 0,
    createdAt: '',
    lines: [],
  };

  it('keeps the lifecycle state R4 cannot express', () => {
    const resource = toFhirClaim(denied);
    expect(resource.status).toBe('active');
    expect(resource.extension).toContainEqual({
      url: LOCAL_STATUS_EXTENSION,
      valueCode: 'DENIED',
    });
    expect(CLAIM_STATUS.lossyValues).toStrictEqual([
      'SCRUBBED',
      'ACKNOWLEDGED',
      'REJECTED',
      'DENIED',
      'PAID',
      'PARTIAL',
      'REBILLED',
    ]);
  });

  it('carries the 837P frequency code in an extension', () => {
    expect(toFhirClaim(draft).extension).toContainEqual({
      url: CLAIM_FREQUENCY_EXTENSION,
      valueCode: 'REPLACEMENT',
    });
  });

  it('numbers the diagnosis list so line pointers stay meaningful', () => {
    expect(toFhirClaim(denied).diagnosis).toStrictEqual([
      {
        sequence: 1,
        diagnosisCodeableConcept: { coding: [{ system: SYSTEMS.icd10cm, code: 'I10' }] },
      },
      {
        sequence: 2,
        diagnosisCodeableConcept: { coding: [{ system: SYSTEMS.icd10cm, code: 'E11.9' }] },
      },
    ]);
    expect(toFhirClaim(denied).item?.[1]?.diagnosisSequence).toStrictEqual([1, 2]);
  });

  it('maps integer cents to money and back without drift', () => {
    const resource = toFhirClaim(denied);
    expect(resource.total).toStrictEqual({ value: 245, currency: 'USD' });
    expect(resource.item?.[0]?.net).toStrictEqual({ value: 175, currency: 'USD' });
    expect(fromFhirClaim(resource).totalChargedCents).toBe(24500);
  });

  it('always states the claim type, use and priority R4 requires', () => {
    const resource = toFhirClaim(draft);
    expect(resource.use).toBe('claim');
    expect(resource.type).toStrictEqual({
      coding: [{ system: SYSTEMS.claimType, code: 'professional' }],
    });
    expect(resource.priority).toStrictEqual({
      coding: [{ system: SYSTEMS.processPriority, code: 'normal' }],
    });
  });

  it('degrades a hand-written claim that carries almost nothing', () => {
    expect(
      fromFhirClaim({
        resourceType: 'Claim',
        status: 'active',
        type: {},
        use: 'claim',
        patient: {},
        created: '',
        provider: {},
        priority: {},
        insurance: [{ sequence: 1, focal: true, coverage: {} }],
        diagnosis: [{ sequence: 1, diagnosisCodeableConcept: {} }],
        item: [{ sequence: 1, productOrService: {}, servicedPeriod: { start: '2026-08-13' } }],
      })
    ).toStrictEqual({
      id: '',
      patientId: '',
      coverageId: '',
      payerId: '',
      providerId: '',
      status: 'SUBMITTED',
      frequency: 'ORIGINAL',
      diagnosisCodes: [''],
      totalChargedCents: 0,
      createdAt: '',
      lines: [
        {
          sequence: 1,
          code: '',
          codeSystem: '',
          modifiers: [],
          units: 0,
          chargedCents: 0,
          diagnosisPointers: [],
          serviceDateFrom: '2026-08-13',
        },
      ],
    });
  });

  it('documents the adjudication columns that stay inside the ledger', () => {
    expectDroppedFields(denied, CLAIM_DROPPED_FIELDS);
  });

  describeRoundTrips({ resourceType: 'Claim', toFhir: toFhirClaim, fromFhir: fromFhirClaim }, [
    { label: 'denied', domain: denied },
    { label: 'draft', domain: draft },
    { label: 'degenerate', domain: degenerate },
  ]);
});

describe('consent mapping', () => {
  const portal: DomainConsentGrant = {
    id: 'con-1',
    patientId: 'pat-1',
    scope: 'PORTAL_ACCESS',
    status: 'EXPIRED',
    relatedPersonId: 'rp-1',
    documentId: 'doc-1',
    policyText: 'Proxy portal access for a minor, expires at 18.',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: '2026-06-30T00:00:00.000Z',
  };
  const treatment: DomainConsentGrant = {
    id: 'con-2',
    patientId: 'pat-1',
    scope: 'TREATMENT',
    status: 'ACTIVE',
    effectiveFrom: '2026-08-13T15:50:00.000Z',
  };
  const degenerate: DomainConsentGrant = {
    id: '',
    patientId: '',
    scope: 'FINANCIAL',
    status: 'PROPOSED',
    effectiveFrom: '',
  };

  it('keeps the precise scope in category and a core code in scope', () => {
    const resource = toFhirConsent(portal);
    expect(resource.category).toStrictEqual([
      { coding: [{ system: CONSENT_SCOPE_SYSTEM, code: 'portal-access' }] },
    ]);
    expect(resource.scope).toStrictEqual({
      coding: [{ system: SYSTEMS.consentScope, code: 'patient-privacy' }],
    });
  });

  it('keeps expired distinguishable from revoked', () => {
    expect(toFhirConsent(portal).status).toBe('inactive');
    expect(toFhirConsent(portal).extension).toStrictEqual([
      { url: LOCAL_STATUS_EXTENSION, valueCode: 'EXPIRED' },
    ]);
    expect(CONSENT_STATUS.lossyValues).toStrictEqual(['EXPIRED']);
  });

  it('documents the consent columns that stay inside Openrunic', () => {
    expectDroppedFields(portal, CONSENT_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Consent', toFhir: toFhirConsent, fromFhir: fromFhirConsent },
    [
      { label: 'portal proxy', domain: portal },
      { label: 'treatment', domain: treatment },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('provenance mapping', () => {
  const breakglass: DomainProvenance = {
    id: 'aud-1',
    targetType: 'Patient',
    targetId: 'pat-1',
    occurredAt: '2026-08-13T19:30:00.000Z',
    actorType: 'user',
    actorId: 'u-1',
    actorDisplay: 'Dr. Adaeze Okafor',
    action: 'patient.read',
    purposeOfUse: 'ETREAT',
    breakglass: true,
    outcome: 'success',
  };
  const machine: DomainProvenance = {
    id: 'aud-2',
    targetType: 'DiagnosticReport',
    targetId: 'dr-1',
    occurredAt: '2026-08-13T19:31:00.000Z',
    actorType: 'adapter',
    actorId: 'labs-mock',
    action: 'result.ingest',
    breakglass: false,
    outcome: 'success',
  };
  const degenerate: DomainProvenance = {
    id: '',
    targetType: 'Claim',
    occurredAt: '',
    actorType: '',
    actorId: '',
    action: '',
    breakglass: false,
    outcome: '',
  };

  it('references a human actor literally and a machine actor logically', () => {
    expect(toFhirProvenance(breakglass).agent[0]?.who).toStrictEqual({
      type: 'Practitioner',
      reference: 'Practitioner/u-1',
      display: 'Dr. Adaeze Okafor',
    });
    expect(toFhirProvenance(machine).agent[0]?.who).toStrictEqual({
      identifier: { system: ACTOR_SYSTEM, value: 'labs-mock' },
    });
  });

  it('types the agent so the actor kind survives without an enum', () => {
    expect(toFhirProvenance(machine).agent[0]?.type).toStrictEqual({
      coding: [{ system: ACTOR_TYPE_SYSTEM, code: 'adapter' }],
    });
  });

  it('carries breakglass and outcome as extensions', () => {
    expect(toFhirProvenance(breakglass).extension).toStrictEqual([
      { url: BREAKGLASS_EXTENSION, valueBoolean: true },
      { url: AUDIT_OUTCOME_EXTENSION, valueCode: 'success' },
    ]);
    expect(toFhirProvenance(machine).extension).toContainEqual({
      url: BREAKGLASS_EXTENSION,
      valueBoolean: false,
    });
  });

  it('codes the action and the purpose of use', () => {
    const resource = toFhirProvenance(breakglass);
    expect(resource.activity).toStrictEqual({
      coding: [{ system: AUDIT_ACTION_SYSTEM, code: 'patient.read' }],
    });
    expect(resource.reason).toStrictEqual([
      { coding: [{ system: SYSTEMS.actReason, code: 'ETREAT' }] },
    ]);
  });

  it('targets a type alone when the audited row has no id', () => {
    expect(toFhirProvenance(degenerate).target).toStrictEqual([{ type: 'Claim' }]);
  });

  it('documents the audit columns that stay inside Openrunic', () => {
    expectDroppedFields(breakglass, PROVENANCE_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Provenance', toFhir: toFhirProvenance, fromFhir: fromFhirProvenance },
    [
      { label: 'breakglass read', domain: breakglass },
      { label: 'machine action', domain: machine },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});
