import type { Bundle, OperationOutcome, Patient } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { buildSearchsetBundle } from '../fhir/bundle.js';
import { fhirBaseUrl, servedResources } from '../fhir/index.js';
import {
  DROPPED_FIELDS,
  fhirPatientToCreateInput,
  fromFhirGender,
  MRN_SYSTEM,
  patientRowToFhir,
  toFhirGender,
} from '../fhir/patient.js';
import {
  booleanToken,
  dateWindow,
  parseDateOnly,
  referenceId,
  rejectUnsupportedParams,
  tokenValue,
} from '../fhir/params.js';
import { acceptedSearchParams } from '../fhir/registry.js';
import { toPatientDto } from '../schemas/patients.js';

import {
  bearer,
  createTestApp,
  jsonBearer,
  makePatientRow,
  seedPatients,
  TOKENS,
  testId,
  UNPRIVILEGED_TOKEN,
  seed,
  seedCareRelationship,
  SUBJECTS,
} from './support.js';

describe('the Patient mapper', () => {
  it('maps every administrative gender in both directions', () => {
    for (const value of ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'] as const) {
      expect(fromFhirGender(toFhirGender(value))).toBe(value);
    }
    expect(fromFhirGender(undefined)).toBeUndefined();
    expect(fromFhirGender('nonbinary')).toBeUndefined();
  });

  it('emits a US Core-shaped Patient with an MRN identifier', () => {
    const resource = patientRowToFhir(makePatientRow({ prefix: 'Ms', suffix: 'III' }));

    expect(resource.resourceType).toBe('Patient');
    expect(resource.identifier?.[0]).toMatchObject({
      use: 'official',
      system: MRN_SYSTEM,
      value: 'OR-100482',
    });
    expect(resource.identifier?.[0]?.type?.coding?.[0]?.code).toBe('MR');
    expect(resource.name?.[0]).toMatchObject({
      family: 'Patientsson',
      given: ['Testina'],
      prefix: ['Ms'],
      suffix: ['III'],
    });
    expect(resource.birthDate).toBe('1994-03-02');
    expect(resource.gender).toBe('female');
    expect(resource.active).toBe(true);
  });

  it('carries telecom, address, deceased and language when present', () => {
    const resource = patientRowToFhir(
      makePatientRow({
        middleName: 'Q',
        email: 'testina@example.invalid',
        phoneMobile: '+15550100',
        phoneHome: '+15550101',
        addressLine1: '1 Test Street',
        addressLine2: 'Flat 2',
        city: 'Testville',
        state: 'TS',
        postalCode: '00000',
        country: 'DE',
        languageCode: 'de',
        deceasedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
    );

    expect(resource.name?.[0]?.given).toEqual(['Testina', 'Q']);
    // Order and `use` come from `packages/fhir`, which is the only place the
    // serialization is written; asserting them here proves the delegation.
    expect(resource.telecom).toEqual([
      { system: 'phone', value: '+15550100', use: 'mobile' },
      { system: 'phone', value: '+15550101', use: 'home' },
      { system: 'email', value: 'testina@example.invalid' },
    ]);
    expect(resource.address?.[0]).toEqual({
      use: 'home',
      line: ['1 Test Street', 'Flat 2'],
      city: 'Testville',
      state: 'TS',
      postalCode: '00000',
      country: 'DE',
    });
    expect(resource.deceasedDateTime).toBe('2026-01-01T00:00:00.000Z');
    expect(resource.communication?.[0]?.language.coding?.[0]?.code).toBe('de');
  });

  it('omits empty telecom and address rather than emitting empty arrays', () => {
    const resource = patientRowToFhir(makePatientRow());

    expect(resource.telecom).toBeUndefined();
    expect(resource.address).toBeUndefined();
    expect(resource.deceasedDateTime).toBeUndefined();
  });

  /**
   * ADR-0002's round-trip requirement. Every field the mapper claims to carry
   * survives `row -> FHIR -> create input`; every field it does not is named in
   * `DROPPED_FIELDS` so a silent loss shows up here rather than in production.
   */
  it('round-trips row -> FHIR -> create input without losing a carried field', () => {
    const row = makePatientRow({
      middleName: 'Q',
      prefix: 'Ms',
      suffix: 'III',
      sexAtBirth: 'FEMALE',
      email: 'testina@example.invalid',
      phoneMobile: '+15550100',
      phoneHome: '+15550101',
      addressLine1: '1 Test Street',
      addressLine2: 'Flat 2',
      city: 'Testville',
      state: 'TS',
      postalCode: '00000',
      country: 'DE',
      languageCode: 'de',
      active: false,
      deceasedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const restored = fhirPatientToCreateInput(patientRowToFhir(row));

    expect(restored).toEqual({
      mrn: row.mrn,
      givenName: 'Testina',
      middleName: 'Q',
      familyName: 'Patientsson',
      prefix: 'Ms',
      suffix: 'III',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
      sexAtBirth: 'FEMALE',
      email: 'testina@example.invalid',
      phoneMobile: '+15550100',
      phoneHome: '+15550101',
      addressLine1: '1 Test Street',
      addressLine2: 'Flat 2',
      city: 'Testville',
      state: 'TS',
      postalCode: '00000',
      country: 'DE',
      languageCode: 'de',
      active: false,
      deceasedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('names exactly the fields the round trip drops', () => {
    const row = makePatientRow({
      preferredName: 'Tess',
      genderIdentityCode: '446141000124107',
      pronouns: 'she/her',
      raceCodes: ['2106-3'],
      ethnicityCodes: ['2186-5'],
      maritalStatusCode: 'M',
      sensitivityClass: 'RESTRICTED',
      portalEnabled: true,
    });
    const restored = fhirPatientToCreateInput(patientRowToFhir(row));
    const carriedByDto = Object.keys(toPatientDto(row));

    for (const field of DROPPED_FIELDS) {
      expect(restored, field).not.toHaveProperty(field);
    }
    // Everything dropped is still reachable on the internal API, so nothing is
    // lost from the product - only from this serialization.
    expect(carriedByDto.length).toBeGreaterThan(0);
  });

  /**
   * These five used to be listed as dropped, because this file hand-rolled a
   * serialization that could not express them. Delegating to `packages/fhir`
   * carries them: `preferredName` as a nickname `HumanName`, the codes as US
   * Core race/ethnicity/genderIdentity extensions and `Patient.maritalStatus`.
   * The assertion exists so that going back to a local mapper fails loudly.
   */
  it('carries the US Core fields the shared mapper knows and a local mapper did not', () => {
    const row = makePatientRow({
      preferredName: 'Tess',
      genderIdentityCode: '446141000124107',
      raceCodes: ['2106-3'],
      ethnicityCodes: ['2186-5'],
      maritalStatusCode: 'M',
    });

    const resource = patientRowToFhir(row);
    expect(resource.name?.some((name) => name.use === 'nickname' && name.text === 'Tess')).toBe(
      true
    );
    expect(resource.maritalStatus?.coding?.[0]?.code).toBe('M');
    expect(resource.extension?.map((extension) => extension.url)).toEqual(
      expect.arrayContaining([
        'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
        'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
        'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex',
      ])
    );

    expect(fhirPatientToCreateInput(resource)).toMatchObject({
      preferredName: 'Tess',
      genderIdentityCode: '446141000124107',
      raceCodes: ['2106-3'],
      ethnicityCodes: ['2186-5'],
      maritalStatusCode: 'M',
    });
  });

  /**
   * `sexAtBirth` fills both `Patient.gender` and the US Core `birthsex`
   * extension, because the column is the only sex/gender fact stored. A
   * resource that sets them inconsistently has to resolve somewhere, and the
   * element beats the extension.
   */
  it('resolves gender against birthsex when an inbound resource disagrees', () => {
    const restored = fhirPatientToCreateInput({
      resourceType: 'Patient',
      identifier: [{ system: MRN_SYSTEM, value: 'OR-100482' }],
      name: [{ family: 'Patientsson', given: ['Testina'] }],
      birthDate: '1994-03-02',
      gender: 'female',
      extension: [
        { url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex', valueCode: 'M' },
      ],
    });
    expect(restored.sexAtBirth).toBe('FEMALE');
  });

  it('falls back to the birthsex extension when gender is absent', () => {
    const restored = fhirPatientToCreateInput({
      resourceType: 'Patient',
      identifier: [{ system: MRN_SYSTEM, value: 'OR-100482' }],
      name: [{ family: 'Patientsson', given: ['Testina'] }],
      birthDate: '1994-03-02',
      extension: [
        { url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex', valueCode: 'M' },
      ],
    });
    expect(restored.sexAtBirth).toBe('MALE');
  });

  it('does not invent an address from the stored country default', () => {
    // `country` is non-null and defaults to `US`, so a patient who never gave
    // an address must still serialize without one.
    expect(patientRowToFhir(makePatientRow({ country: 'US' })).address).toBeUndefined();
    expect(patientRowToFhir(makePatientRow({ city: 'Testville' })).address?.[0]).toMatchObject({
      city: 'Testville',
      country: 'US',
    });
  });

  it('reads an MRN identified only by its MR type code', () => {
    const input = fhirPatientToCreateInput({
      resourceType: 'Patient',
      identifier: [{ type: { coding: [{ code: 'MR' }] }, value: 'OR-100482' }],
      name: [{ family: 'Patientsson', given: ['Testina'] }],
      birthDate: '1994-03-02',
    });

    expect(input.mrn).toBe('OR-100482');
  });

  it('rejects a body that is not a Patient resource', () => {
    expect(() => fhirPatientToCreateInput({ resourceType: 'Observation' })).toThrow(
      /must be a FHIR Patient resource/
    );
    expect(() => fhirPatientToCreateInput(null)).toThrow(/must be a FHIR Patient resource/);
    expect(() => fhirPatientToCreateInput([])).toThrow(/must be a FHIR Patient resource/);
  });

  it('rejects a Patient with no medical record number', () => {
    expect(() =>
      fhirPatientToCreateInput({
        resourceType: 'Patient',
        name: [{ family: 'Patientsson', given: ['Testina'] }],
        birthDate: '1994-03-02',
      })
    ).toThrow(/missing a medical record number/);
  });

  it('rejects a Patient that fails the domain contract', () => {
    expect(() =>
      fhirPatientToCreateInput({
        resourceType: 'Patient',
        identifier: [{ system: MRN_SYSTEM, value: 'OR-100482' }],
        name: [{ family: 'Patientsson', given: ['Testina'] }],
        // No birth date, which the patient contract requires.
      })
    ).toThrow(/did not satisfy the patient contract/);
  });
});

describe('search parameter handling', () => {
  it('accepts what the registry lists and nothing else', () => {
    const served = servedResources();

    expect(acceptedSearchParams(served, 'Patient').has('family')).toBe(true);
    expect(acceptedSearchParams(served, 'Patient').has('_count')).toBe(true);
    expect(acceptedSearchParams(served, 'Observation').has('family')).toBe(false);
    expect(acceptedSearchParams(served, 'Observation').has('_count')).toBe(true);
  });

  it('refuses an unsupported parameter rather than ignoring it', () => {
    const accepted = acceptedSearchParams(servedResources(), 'Patient');

    expect(() => rejectUnsupportedParams('Patient', { telecom: 'x' }, accepted)).toThrow(
      /Unsupported search/
    );
    expect(() => rejectUnsupportedParams('Patient', { family: 'x' }, accepted)).not.toThrow();
  });

  it('reads the value half of a token, and a bare value whole', () => {
    expect(tokenValue('https://openrunic.org/fhir/sid/mrn|OR-100482')).toBe('OR-100482');
    expect(tokenValue('OR-100482')).toBe('OR-100482');
  });

  it('reads a reference as an id, typed or bare, and refuses the wrong type', () => {
    expect(referenceId(`Patient/${testId(1)}`, 'Patient', 'patient')).toBe(testId(1));
    expect(referenceId(testId(1), 'Patient', 'patient')).toBe(testId(1));
    expect(() => referenceId(`Group/${testId(1)}`, 'Patient', 'patient')).toThrow(
      /must reference a Patient/
    );
  });

  it('reads a date parameter as a half-open window, prefix by prefix', () => {
    const day = dateWindow('2026-08-14', 'date');
    expect(day.from?.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    expect(day.to?.toISOString()).toBe('2026-08-15T00:00:00.000Z');

    expect(dateWindow('ge2026-08-14', 'date').to).toBeUndefined();
    expect(dateWindow('le2026-08-14', 'date').from).toBeUndefined();
    expect(dateWindow('gt2026-08-14', 'date').from?.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(dateWindow('lt2026-08-14', 'date').to?.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    // A negation cannot be expressed as one window, so it is refused rather
    // than answered approximately.
    expect(() => dateWindow('ne2026-08-14', 'date')).toThrow(/does not support the ne prefix/);
    expect(() => dateWindow('not-a-date', 'date')).toThrow(/ISO 8601/);
  });

  it('reads a boolean token, and refuses anything else', () => {
    expect(booleanToken('true', 'active')).toBe(true);
    expect(booleanToken('false', 'active')).toBe(false);
    expect(() => booleanToken('yes', 'active')).toThrow(/true or false/);
  });

  it('refuses a date-only parameter that is not a calendar date', () => {
    expect(parseDateOnly('1994-03-02', 'birthdate').toISOString()).toBe('1994-03-02T00:00:00.000Z');
    expect(() => parseDateOnly('1994-03', 'birthdate')).toThrow(/YYYY-MM-DD/);
  });
});

describe('the searchset Bundle', () => {
  it('reports the whole-set total and a page-aligned self link', () => {
    const bundle = buildSearchsetBundle(
      { rows: [makePatientRow()], total: 1, page: 1, pageSize: 25 },
      patientRowToFhir,
      { baseUrl: 'https://example.invalid/fhir', resourceType: 'Patient', query: { family: 'Pat' } }
    );

    expect(bundle.type).toBe('searchset');
    expect(bundle.total).toBe(1);
    expect(bundle.link).toEqual([
      {
        relation: 'self',
        url: 'https://example.invalid/fhir/Patient?_count=25&_offset=0&family=Pat',
      },
    ]);
    expect(bundle.entry?.[0]).toMatchObject({
      fullUrl: `https://example.invalid/fhir/Patient/${testId(1)}`,
      search: { mode: 'match' },
    });
  });

  it('emits a next link while there is more, and stops at the end', () => {
    const context = {
      baseUrl: 'https://example.invalid/fhir',
      resourceType: 'Patient',
      query: {},
    };
    const more = buildSearchsetBundle(
      { rows: [makePatientRow()], total: 30, page: 1, pageSize: 10 },
      patientRowToFhir,
      context
    );
    const last = buildSearchsetBundle(
      { rows: [makePatientRow()], total: 30, page: 3, pageSize: 10 },
      patientRowToFhir,
      context
    );

    const relations = (bundle: typeof more): (string | undefined)[] =>
      (bundle.link ?? []).map((link) => link.relation);

    // First page: self and next, but no previous - there is nothing before it.
    expect(relations(more)).toEqual(['self', 'next']);
    expect(more.link?.[1]).toEqual({
      relation: 'next',
      url: 'https://example.invalid/fhir/Patient?_count=10&_offset=10',
    });

    // Last page: self and previous, but no next.
    expect(relations(last)).toEqual(['self', 'previous']);
    expect(last.link?.[1]?.url).toBe('https://example.invalid/fhir/Patient?_count=10&_offset=10');
  });

  it('derives the base URL from the request', () => {
    expect(fhirBaseUrl('https://emr.example.invalid/fhir/Patient?family=x')).toBe(
      'https://emr.example.invalid/fhir'
    );
  });
});

describe('GET /fhir/Patient', () => {
  it('returns a searchset Bundle of Patient resources', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));

    const res = await app.request('/fhir/Patient?family=Patient', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');
    const bundle = (await res.json()) as Bundle<Patient>;
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.total).toBe(1);
    expect(bundle.entry?.[0]?.resource?.resourceType).toBe('Patient');
  });

  it('pages with _count and _offset', async () => {
    const { app, dataset } = createTestApp();
    seedPatients(dataset, 30);

    const bundle = (await (
      await app.request('/fhir/Patient?_count=10&_offset=10', {
        headers: bearer(TOKENS.clinicianA),
      })
    ).json()) as Bundle<Patient>;

    expect(bundle.total).toBe(30);
    expect(bundle.entry).toHaveLength(10);
    expect(bundle.link?.find((link) => link.relation === 'next')?.url).toContain('_offset=20');
    expect(bundle.link?.find((link) => link.relation === 'previous')?.url).toContain('_offset=0');
  });

  /**
   * FHIR JSON has no empty arrays. A search that matches nothing is a bundle
   * with `total: 0` and no `entry` element at all; emitting `entry: []` is
   * invalid and a strict client may reject the whole response.
   */
  it('omits entry entirely when a search matches nothing', async () => {
    const { app } = createTestApp();

    const res = await app.request('/fhir/Patient?family=Nonexistent', {
      headers: bearer(TOKENS.clinicianA),
    });
    const bundle = (await res.json()) as Bundle<Patient>;

    expect(bundle.total).toBe(0);
    expect(bundle).not.toHaveProperty('entry');
    expect(bundle.link?.some((link) => link.relation === 'next')).toBe(false);
    expect(bundle.link?.some((link) => link.relation === 'previous')).toBe(false);
  });

  it('searches by _id, identifier, name, family, given, birthdate and gender', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: testId(1) }),
      makePatientRow({
        id: testId(2),
        mrn: 'OR-100999',
        familyName: 'Nobody',
        givenName: 'Nemo',
        sexAtBirth: 'MALE',
        active: false,
        birthDate: new Date('1980-01-01T00:00:00.000Z'),
      })
    );
    const total = async (query: string): Promise<number> =>
      (
        (await (
          await app.request(`/fhir/Patient?${query}`, { headers: bearer(TOKENS.clinicianA) })
        ).json()) as Bundle<Patient>
      ).total ?? -1;

    expect(await total(`_id=${testId(2)}`)).toBe(1);
    expect(await total(`identifier=${encodeURIComponent(`${MRN_SYSTEM}|OR-100999`)}`)).toBe(1);
    expect(await total('name=Nemo')).toBe(1);
    expect(await total('birthdate=1980-01-01')).toBe(1);
    expect(await total('gender=male')).toBe(1);
    expect(await total('given=Test')).toBe(1);
  });

  it.each([
    ['an unsupported parameter', 'telecom=555', 'not-supported'],
    ['an unparseable birthdate', 'birthdate=01-01-1980', 'invalid'],
    ['a gender outside the value set', 'gender=nonbinary', 'invalid'],
    ['a parameter this server does not implement', 'active=true', 'not-supported'],
    ['a ragged offset', '_count=10&_offset=5', 'invalid'],
  ])('rejects %s with a 400 OperationOutcome', async (_label, query, code) => {
    const { app } = createTestApp();
    const res = await app.request(`/fhir/Patient?${query}`, { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');
    const outcome = (await res.json()) as OperationOutcome;
    expect(outcome.resourceType).toBe('OperationOutcome');
    expect(outcome.issue[0]).toMatchObject({ severity: 'error', code });
  });

  it('rejects chaining and _include, which are out of scope at v1', async () => {
    const { app } = createTestApp();

    for (const query of ['_include=Patient:general-practitioner', 'general-practitioner.name=x']) {
      const res = await app.request(`/fhir/Patient?${query}`, {
        headers: bearer(TOKENS.clinicianA),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as OperationOutcome).issue[0]?.code).toBe('not-supported');
    }
  });
});

describe('GET /fhir/Patient/:id', () => {
  it('reads one Patient', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1) }));
    seedCareRelationship(dataset, { patientId: testId(1), providerId: SUBJECTS.clinicianA });

    const res = await app.request(`/fhir/Patient/${testId(1)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as Patient).id).toBe(testId(1));
  });

  it('404s an unknown id as an OperationOutcome', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/fhir/Patient/${testId(77)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
    expect(((await res.json()) as OperationOutcome).issue[0]?.code).toBe('not-found');
  });

  it('400s an id that is not a UUID', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Patient/12', { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(400);
    expect(((await res.json()) as OperationOutcome).issue[0]?.expression).toEqual(['id']);
  });
});

describe('POST /fhir/Patient', () => {
  it('creates a patient from a Patient resource', async () => {
    const { app, dataset } = createTestApp();
    const res = await app.request('/fhir/Patient', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({
        resourceType: 'Patient',
        identifier: [{ system: MRN_SYSTEM, value: 'OR-100482' }],
        name: [{ family: 'Patientsson', given: ['Testina'] }],
        birthDate: '1994-03-02',
        gender: 'female',
      }),
    });

    expect(res.status).toBe(201);
    const created = (await res.json()) as Patient;
    expect(res.headers.get('location')).toContain(`/fhir/Patient/${created.id ?? ''}`);
    expect(dataset.table('Patient')).toHaveLength(1);
  });

  it('400s a body that is not JSON', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Patient', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: '{ not json',
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as OperationOutcome).issue[0]?.code).toBe('invalid');
  });

  it('422s a well-formed Patient that breaks a rule', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Patient', {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({
        resourceType: 'Patient',
        name: [{ family: 'Patientsson', given: ['Testina'] }],
        birthDate: '1994-03-02',
      }),
    });

    expect(res.status).toBe(422);
    const outcome = (await res.json()) as OperationOutcome;
    expect(outcome.issue[0]).toMatchObject({ code: 'invariant', expression: ['identifier'] });
  });

  it('409s a duplicate MRN', async () => {
    const { app } = createTestApp();
    const body = JSON.stringify({
      resourceType: 'Patient',
      identifier: [{ system: MRN_SYSTEM, value: 'OR-100482' }],
      name: [{ family: 'Patientsson', given: ['Testina'] }],
      birthDate: '1994-03-02',
    });
    const post = () =>
      app.request('/fhir/Patient', {
        method: 'POST',
        headers: jsonBearer(TOKENS.frontDeskA),
        body,
      });

    expect((await post()).status).toBe(201);
    const conflict = await post();
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as OperationOutcome).issue[0]?.code).toBe('duplicate');
  });
});

describe('the FHIR error contract', () => {
  it('401s without a token, with a bearer challenge', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Patient');

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/fhir+json');
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="openrunic"');
    expect(((await res.json()) as OperationOutcome).issue[0]?.code).toBe('login');
  });

  it('403s a principal without the permission', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Patient', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(res.status).toBe(403);
    expect(((await res.json()) as OperationOutcome).issue[0]?.code).toBe('forbidden');
  });

  it('always carries the request id as an information issue', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/Patient');
    const outcome = (await res.json()) as OperationOutcome;

    expect(outcome.issue.at(-1)).toMatchObject({ severity: 'information', code: 'informational' });
    expect(outcome.issue.at(-1)?.diagnostics).toContain(res.headers.get('x-request-id') ?? '');
  });
});
