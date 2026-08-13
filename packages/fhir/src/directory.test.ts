import { describe, expect, it } from 'vitest';

import {
  COVERAGE_DROPPED_FIELDS,
  FACILITY_CODE_SYSTEM,
  LOCATION_DROPPED_FIELDS,
  ORGANIZATION_DROPPED_FIELDS,
  PRACTITIONER_DROPPED_FIELDS,
  PRACTITIONER_ROLE_DROPPED_FIELDS,
  SYSTEMS,
  X12_PAYER_SYSTEM,
  fromFhirCoverage,
  fromFhirLocation,
  fromFhirOrganization,
  fromFhirPractitioner,
  fromFhirPractitionerRole,
  toFhirCoverage,
  toFhirLocation,
  toFhirOrganization,
  toFhirPractitioner,
  toFhirPractitionerRole,
} from './index.js';
import type {
  DomainCoverage,
  DomainLocation,
  DomainOrganization,
  DomainPractitioner,
  DomainPractitionerRole,
} from './index.js';
import { describeRoundTrips, expectDroppedFields } from './test-support/round-trip.js';

describe('practitioner mapping', () => {
  const full: DomainPractitioner = {
    id: 'u-1',
    familyName: 'Okafor',
    givenNames: ['Adaeze'],
    credential: 'MD',
    npi: '1234567893',
    dea: 'BO1234563',
    email: 'a.okafor@example.invalid',
    active: true,
  };
  const sparse: DomainPractitioner = { id: 'u-2', familyName: 'Nolan', givenNames: [] };
  const degenerate: DomainPractitioner = { id: '', familyName: '', givenNames: [] };

  it('writes the NPI and DEA as typed identifiers', () => {
    const resource = toFhirPractitioner(full);
    expect(resource.identifier).toStrictEqual([
      {
        type: { coding: [{ system: SYSTEMS.identifierType, code: 'NPI' }] },
        system: SYSTEMS.npi,
        value: '1234567893',
      },
      {
        type: { coding: [{ system: SYSTEMS.identifierType, code: 'DEA' }] },
        system: SYSTEMS.dea,
        value: 'BO1234563',
      },
    ]);
  });

  it('carries the credential as a name suffix', () => {
    expect(toFhirPractitioner(full).name?.[0]?.suffix).toStrictEqual(['MD']);
  });

  it('documents the User columns that stay inside Openrunic', () => {
    expectDroppedFields(full, PRACTITIONER_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'Practitioner',
      toFhir: toFhirPractitioner,
      fromFhir: fromFhirPractitioner,
    },
    [
      { label: 'full', domain: full },
      { label: 'sparse', domain: sparse },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('practitioner role mapping', () => {
  const full: DomainPractitionerRole = {
    id: 'ur-1',
    practitionerId: 'u-1',
    organizationId: 'org-1',
    locationIds: ['fac-1', 'fac-2'],
    specialtyCodes: ['207Q00000X'],
    roleCode: 'provider',
    email: 'a.okafor@example.invalid',
    active: true,
  };
  const sparse: DomainPractitionerRole = {
    id: 'ur-2',
    practitionerId: 'u-2',
    locationIds: ['fac-1'],
    specialtyCodes: [],
  };
  const degenerate: DomainPractitionerRole = {
    id: '',
    practitionerId: '',
    locationIds: [],
    specialtyCodes: [],
  };

  it('references each granted facility as a Location', () => {
    expect(toFhirPractitionerRole(full).location).toStrictEqual([
      { type: 'Location', reference: 'Location/fac-1' },
      { type: 'Location', reference: 'Location/fac-2' },
    ]);
  });

  it('documents the grant columns that stay inside Openrunic', () => {
    expectDroppedFields(full, PRACTITIONER_ROLE_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'PractitionerRole',
      toFhir: toFhirPractitionerRole,
      fromFhir: fromFhirPractitionerRole,
    },
    [
      { label: 'full', domain: full },
      { label: 'sparse', domain: sparse },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('organization mapping', () => {
  const payer: DomainOrganization = {
    id: 'pay-1',
    name: 'Cascade Mutual Health',
    typeCode: 'ins',
    x12PayerId: '00901',
    claimFilingCode: 'CI',
    phone: '+15550140',
    addressLine1: '400 Basalt Street',
    city: 'Ashford',
    state: 'OR',
    postalCode: '97001',
    country: 'US',
    active: true,
  };
  const practice: DomainOrganization = {
    id: 'org-1',
    name: 'Alder Creek Family Medicine',
    typeCode: 'prov',
    npi: '1234567893',
  };
  const degenerate: DomainOrganization = { id: '', name: '' };

  it('writes the X12 payer id as its own identifier', () => {
    expect(toFhirOrganization(payer).identifier).toStrictEqual([
      { system: X12_PAYER_SYSTEM, value: '00901' },
    ]);
  });

  it('documents the tenant columns that stay inside Openrunic', () => {
    expectDroppedFields(payer, ORGANIZATION_DROPPED_FIELDS);
  });

  describeRoundTrips(
    {
      resourceType: 'Organization',
      toFhir: toFhirOrganization,
      fromFhir: fromFhirOrganization,
    },
    [
      { label: 'payer', domain: payer },
      { label: 'practice', domain: practice },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('location mapping', () => {
  const full: DomainLocation = {
    id: 'fac-1',
    name: 'Alder Creek Family Medicine',
    code: 'ACFM',
    npi: '1234567893',
    posCode: '11',
    managingOrganizationId: 'org-1',
    phone: '+15550110',
    addressLine1: '1 Alder Way',
    addressLine2: 'Suite 3',
    city: 'Ashford',
    state: 'OR',
    postalCode: '97001',
    country: 'US',
    active: true,
  };
  const closed: DomainLocation = {
    id: 'fac-2',
    name: 'Basalt Street Annex',
    code: 'BSA',
    active: false,
  };
  const degenerate: DomainLocation = { id: '', name: '', code: '' };

  it('maps the facility code to an identifier and active to a status', () => {
    const resource = toFhirLocation(full);
    expect(resource.identifier?.[0]).toStrictEqual({
      system: FACILITY_CODE_SYSTEM,
      value: 'ACFM',
    });
    expect(resource.status).toBe('active');
    expect(toFhirLocation(closed).status).toBe('inactive');
  });

  it('reads a suspended location as inactive', () => {
    expect(fromFhirLocation({ resourceType: 'Location', status: 'suspended' }).active).toBe(false);
  });

  it('documents the facility columns that stay inside Openrunic', () => {
    expectDroppedFields(full, LOCATION_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Location', toFhir: toFhirLocation, fromFhir: fromFhirLocation },
    [
      { label: 'full', domain: full },
      { label: 'closed', domain: closed },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});

describe('coverage mapping', () => {
  const full: DomainCoverage = {
    id: 'cov-1',
    patientId: 'pat-1',
    payerId: 'pay-1',
    rank: 'PRIMARY',
    status: 'ACTIVE',
    memberId: 'CM-99001',
    groupNumber: 'GRP-42',
    planName: 'Cascade Choice PPO',
    subscriberRelationshipCode: 'self',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    copayCents: 2500,
    deductibleCents: 150000,
  };
  const secondary: DomainCoverage = {
    id: 'cov-2',
    patientId: 'pat-1',
    payerId: 'pay-2',
    rank: 'SECONDARY',
    status: 'DRAFT',
    memberId: 'SEC-1',
    subscriberRelationshipCode: 'spouse',
  };
  const degenerate: DomainCoverage = {
    id: '',
    patientId: '',
    payerId: '',
    rank: 'TERTIARY',
    status: 'CANCELLED',
    memberId: '',
    subscriberRelationshipCode: '',
  };

  it('maps the coordination-of-benefits rank to an order', () => {
    expect(toFhirCoverage(full).order).toBe(1);
    expect(toFhirCoverage(secondary).order).toBe(2);
    expect(toFhirCoverage(degenerate).order).toBe(3);
  });

  it('maps cents to money without floating-point drift', () => {
    const resource = toFhirCoverage(full);
    expect(resource.costToBeneficiary?.[0]?.valueMoney).toStrictEqual({
      value: 25,
      currency: 'USD',
    });
    expect(resource.costToBeneficiary?.[1]?.valueMoney).toStrictEqual({
      value: 1500,
      currency: 'USD',
    });
  });

  it('defaults an unknown coverage order to the primary slot', () => {
    expect(
      fromFhirCoverage({
        resourceType: 'Coverage',
        status: 'active',
        order: 9,
        beneficiary: { reference: 'Patient/pat-1' },
        payor: [{ reference: 'Organization/pay-1' }],
      }).rank
    ).toBe('PRIMARY');
  });

  it('documents the subscriber columns that stay inside the billing service', () => {
    expectDroppedFields(full, COVERAGE_DROPPED_FIELDS);
  });

  describeRoundTrips(
    { resourceType: 'Coverage', toFhir: toFhirCoverage, fromFhir: fromFhirCoverage },
    [
      { label: 'full', domain: full },
      { label: 'secondary', domain: secondary },
      { label: 'degenerate', domain: degenerate },
    ]
  );
});
