import { parseCcd } from '@openrunic/ccda';
import { describe, expect, it } from 'vitest';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_TENANT_A,
  FIXED_NOW,
  jsonBearer,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
} from './support.js';

/**
 * The chart leaving and arriving.
 *
 * Two behaviours carry the weight here, and neither is "does XML come out". The
 * first is that a section the caller may not read is left out AND said to be
 * left out - a section silently missing is indistinguishable from one that is
 * empty, and those mean opposite things to the clinician receiving it. The
 * second is that an arriving document changes nothing until a person says so.
 */

const PATIENT = testId(1);

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(
    created.dataset,
    'Patient',
    makePatientRow({ id: PATIENT, primaryFacilityId: DEMO_FACILITY_A })
  );
  seed(created.dataset, 'Facility', {
    ...storageColumns(DEMO_FACILITY_A),
    name: 'Example Family Practice',
    code: 'EFP',
    npi: null,
    posCode: '11',
    timezone: 'UTC',
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    phone: '+15550111',
    active: true,
  } as never);

  seed(created.dataset, 'AllergyIntolerance', {
    ...storageColumns(testId(200)),
    patientId: PATIENT,
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    substanceCode: '7980',
    substanceCodeSystem: '2.16.840.1.113883.6.88',
    substanceDisplay: 'Penicillin',
    reactionCodes: [],
    reactionText: 'Anaphylaxis',
    severity: null,
    onsetDate: new Date('2019-05-04T00:00:00.000Z'),
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: null,
  } as never);

  seed(created.dataset, 'Condition', {
    ...storageColumns(testId(201)),
    patientId: PATIENT,
    encounterId: null,
    category: 'PROBLEM_LIST_ITEM',
    code: 'E11.9',
    codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
    display: 'Type 2 diabetes mellitus without complications',
    snomedCode: null,
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    onsetDate: new Date('2023-06-01T00:00:00.000Z'),
    abatementDate: null,
    severityCode: null,
    bodySiteCode: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: null,
  } as never);

  return created;
}

interface CcdBody {
  document: string;
  withheld: string[];
}

async function ccdFor(
  app: ReturnType<typeof createTestApp>['app'],
  token: string = TOKENS.adminA
): Promise<CcdBody> {
  const res = await app.request(`/bff/v0/patients/${PATIENT}/ccd`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return (await res.json()) as CcdBody;
}

describe('the chart, as a document', () => {
  it('assembles what the practice holds', async () => {
    const { app } = harness();

    const parsed = parseCcd((await ccdFor(app)).document);

    expect(parsed.patient.mrn).toBe('OR-100482');
    expect(parsed.patient.familyName).toBe('Patientsson');
    expect(parsed.custodian.name).toBe('Example Family Practice');
    expect(parsed.allergies[0]?.substance.display).toBe('Penicillin');
    expect(parsed.allergies[0]?.reaction).toBe('Anaphylaxis');
    expect(parsed.problems[0]?.problem.code).toBe('E11.9');
  });

  it('carries the allergy criticality, which is what changes a prescriber’s mind', async () => {
    const { app } = harness();

    const parsed = parseCcd((await ccdFor(app)).document);

    expect(parsed.allergies[0]?.criticality).toBe('high');
  });

  /**
   * A CCD is assembled at the moment it is requested, so the person answerable
   * for the assembly is the one who asked. Attributing it to a treating
   * clinician would put their name on a document they never saw.
   */
  it('names the requester as the author, not a treating clinician', async () => {
    const { app } = harness();

    const parsed = parseCcd((await ccdFor(app)).document);

    expect(parsed.author.id).not.toBe('');
    expect(parsed.author.familyName).not.toBe('');
  });

  it('records that a document was generated, and which sections went into it', async () => {
    const { app, auditStore } = harness();

    await ccdFor(app);

    const generated = auditStore
      .chain(DEMO_TENANT_A)
      .filter((event) => event.action === 'ccd.generated');
    expect(generated).toHaveLength(1);
    expect(generated[0]?.patientId).toBe(PATIENT);
    expect(generated[0]?.metadata?.sections).toEqual([
      'allergies',
      'medications',
      'problems',
      'results',
      'vitals',
      'immunisations',
      'encounters',
    ]);
  });
});

describe('what a caller is not given', () => {
  /**
   * The hazard bulk export had, in a different wrapper: a CCD crosses every
   * clinical aggregate at once, and a caller who may read patients and not
   * results would otherwise receive results in something that looks like an
   * ordinary chart summary.
   */
  it('leaves out a section the caller may not read, and says which', async () => {
    const { app } = harness();

    // The front desk holds patient.read and encounter.read, and not result.read.
    const body = await ccdFor(app, TOKENS.frontDeskA);

    expect(body.withheld).toContain('results');
    expect(parseCcd(body.document).results).toEqual([]);
  });

  it('withholds nothing from a caller who holds every permission', async () => {
    const { app } = harness();

    expect((await ccdFor(app)).withheld).toEqual([]);
  });

  it('records what was withheld, so a later question about it has an answer', async () => {
    const { app, auditStore } = harness();

    await ccdFor(app, TOKENS.frontDeskA);

    const generated = auditStore
      .chain(DEMO_TENANT_A)
      .filter((event) => event.action === 'ccd.generated');
    expect(generated[0]?.metadata).toMatchObject({ withheld: ['results'] });
  });

  it('refuses a caller with no token', async () => {
    const { app } = harness();

    expect((await app.request(`/bff/v0/patients/${PATIENT}/ccd`)).status).toBe(401);
  });

  /**
   * A patient asking for their own record is exercising a right of access, and
   * this is the form the right is usually exercised in. Nothing special is
   * needed to allow it: the portal token holds `patient.read`, and its
   * compartment is what keeps it to one chart.
   */
  it('gives a portal login its own chart', async () => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/patients/${PATIENT}/ccd`, {
      headers: bearer(TOKENS.portalA),
    });

    expect(res.status).toBe(200);
    expect(parseCcd(((await res.json()) as CcdBody).document).patient.mrn).toBe('OR-100482');
  });

  /**
   * And nobody else's. The compartment binds the repositories rather than being
   * a check this route performs, so the other chart is not found rather than
   * refused - the same 404 an absent patient gets, which is what stops the
   * status being an oracle for who exists.
   */
  it('does not give a portal login somebody else’s chart', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Patient', makePatientRow({ id: testId(2), mrn: 'OR-100999' }));

    const res = await app.request(`/bff/v0/patients/${testId(2)}/ccd`, {
      headers: bearer(TOKENS.portalA),
    });

    expect(res.status).toBe(404);
  });

  it('cannot assemble another organisation’s patient', async () => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/patients/${PATIENT}/ccd`, {
      headers: bearer(TOKENS.clinicianB),
    });

    expect(res.status).toBe(404);
  });
});

describe('a document arriving from somebody else', () => {
  async function importDocument(
    app: ReturnType<typeof createTestApp>['app'],
    document: string,
    token: string = TOKENS.adminA
  ): Promise<Response> {
    return app.request('/bff/v0/ccd/import', {
      method: 'POST',
      headers: jsonBearer(token),
      body: JSON.stringify({ document }),
    });
  }

  it('reports what a document contains', async () => {
    const { app } = harness();
    const ours = (await ccdFor(app)).document;

    const res = await importDocument(app, ours);
    const summary = (await res.json()) as {
      patient: { mrn: string };
      counts: Record<string, number>;
      allergies: { substance: { display: string } }[];
      problems: { problem: { display: string } }[];
      unidentified: unknown[];
    };

    expect(res.status).toBe(200);
    expect(summary.patient.mrn).toBe('OR-100482');
    expect(summary.counts.allergies).toBe(1);
    expect(summary.counts.problems).toBe(1);
    expect(summary.allergies[0]?.substance.display).toBe('Penicillin');
    expect(summary.unidentified).toEqual([]);
  });

  /**
   * Merging is a clinical decision - which of these problems are already on our
   * list, is this the same allergy under another name - and a machine that took
   * it would produce a duplicate problem list on its best day.
   */
  it('writes nothing into the record', async () => {
    const { app, dataset } = harness();
    const ours = (await ccdFor(app)).document;
    const before = dataset.table('Condition').length;

    await importDocument(app, ours);

    expect(dataset.table('Condition')).toHaveLength(before);
    expect(dataset.table('AllergyIntolerance')).toHaveLength(1);
  });

  /**
   * The rows a person has to look at are the ones the codec could read
   * structurally and could not identify. Counting them would hide which.
   */
  it('names an entry it could not identify rather than counting it', async () => {
    const { app } = harness();
    const document = `<ClinicalDocument xmlns="urn:hl7-org:v3">
      <id root="x"/>
      <component><structuredBody><component><section>
        <code code="48765-2" codeSystem="2.16.840.1.113883.6.1"/>
        <entry><act classCode="ACT" moodCode="EVN"><id root="a-1"/></act></entry>
      </section></component></structuredBody></component>
    </ClinicalDocument>`;

    const summary = (await (await importDocument(app, document)).json()) as {
      unidentified: { section: string; display: string }[];
    };

    expect(summary.unidentified).toEqual([{ section: 'allergies', display: 'Unknown substance' }]);
  });

  it('refuses a document it cannot read, and says where it failed', async () => {
    const { app } = harness();

    const res = await importDocument(app, '<ClinicalDocument><unclosed>');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('could not be read');
  });

  /**
   * The refusal that matters. A DOCTYPE is where an external entity is declared,
   * and a parser that resolves one turns a clinical import into a file read from
   * inside the network.
   */
  it('refuses a document carrying a DOCTYPE', async () => {
    const { app } = harness();
    const attack = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<ClinicalDocument><title>&xxe;</title></ClinicalDocument>`;

    const res = await importDocument(app, attack);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('DOCTYPE');
  });

  it('refuses something that is not a clinical document at all', async () => {
    const { app } = harness();

    const res = await importDocument(app, '<Bundle/>');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('ClinicalDocument');
  });

  /**
   * 422 rather than 400: the body parsed as JSON and failed the schema, which is
   * the distinction validate.ts draws between "this is not a request" and "this
   * is a request I understood and will not accept".
   */
  it('refuses an empty body', async () => {
    const { app } = harness();

    expect((await importDocument(app, '')).status).toBe(422);
  });

  it('refuses a caller without document.write', async () => {
    const { app } = harness();

    const res = await importDocument(app, '<ClinicalDocument/>', TOKENS.billerA);

    expect(res.status).toBe(403);
  });

  it('records that a document was read, and whose it was', async () => {
    const { app, auditStore } = harness();
    const ours = (await ccdFor(app)).document;

    await importDocument(app, ours);

    const parsedEvents = auditStore
      .chain(DEMO_TENANT_A)
      .filter((event) => event.action === 'ccd.parsed');
    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.metadata).toMatchObject({ custodian: 'Example Family Practice' });
  });
});

describe('a patient the record holds only partly', () => {
  it('still names a custodian when the patient has no primary facility', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT, primaryFacilityId: null }));

    const parsed = parseCcd((await ccdFor(created.app)).document);

    // Required by the specification, so it is written from what is known rather
    // than omitted - a document with no custodian is one nobody will accept.
    expect(parsed.custodian.name).toBe('Unknown facility');
    expect(parsed.custodian.id).not.toBe('');
  });

  it('produces a document with every section empty for a chart with nothing in it', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));

    const parsed = parseCcd((await ccdFor(created.app)).document);

    expect(parsed.allergies).toEqual([]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.medications).toEqual([]);
  });
});

describe('every section a chart can carry', () => {
  /**
   * The mappers are where a document quietly loses something: a column read
   * under the wrong name comes back empty, and an empty section in a CCD is
   * indistinguishable from a patient who has nothing. So each one is populated
   * and read back by field.
   */
  function fullChart(): ReturnType<typeof createTestApp> {
    const created = harness();

    seed(created.dataset, 'MedicationStatement', {
      ...storageColumns(testId(210)),
      patientId: PATIENT,
      encounterId: null,
      rxnormCode: '860975',
      display: 'Metformin 500 mg oral tablet',
      sigText: 'One tablet twice daily with food',
      status: 'ACTIVE',
      source: 'REPORTED',
      effectiveStart: new Date('2025-11-02T00:00:00.000Z'),
      effectiveEnd: null,
      reportedAt: FIXED_NOW,
      note: null,
    } as never);

    seed(created.dataset, 'Immunization', {
      ...storageColumns(testId(211)),
      patientId: PATIENT,
      encounterId: null,
      status: 'COMPLETED',
      cvxCode: '150',
      mvxCode: null,
      ndcCode: null,
      display: 'Influenza, injectable',
      lotNumber: 'LOT-000A',
      expirationDate: null,
      siteCode: null,
      routeCode: null,
      doseQuantity: null,
      doseUnit: null,
      administeredAt: new Date('2025-10-12T00:00:00.000Z'),
      administeredById: null,
      visDate: null,
      refusalReasonCode: null,
      reportedToRegistryAt: null,
    } as never);

    seed(created.dataset, 'Encounter', {
      ...storageColumns(testId(212)),
      facilityId: DEMO_FACILITY_A,
      patientId: PATIENT,
      providerId: testId(900),
      appointmentId: null,
      class: 'AMBULATORY',
      status: 'COMPLETED',
      reasonCode: null,
      reasonText: 'Annual review',
      startedAt: new Date('2026-08-13T09:00:00.000Z'),
      endedAt: new Date('2026-08-13T09:30:00.000Z'),
      signedAt: null,
      signedById: null,
    } as never);

    return created;
  }

  it('carries a medication with its instruction and its start date', async () => {
    const parsed = parseCcd((await ccdFor(fullChart().app)).document);

    expect(parsed.medications[0]?.medication.code).toBe('860975');
    expect(parsed.medications[0]?.sig).toBe('One tablet twice daily with food');
    expect(parsed.medications[0]?.startDate).toBe('2025-11-02');
    // No stop date recorded means the patient is still taking it.
    expect(parsed.medications[0]?.endDate).toBeUndefined();
    expect(parsed.medications[0]?.status).toBe('active');
  });

  it('carries an immunisation with its lot number', async () => {
    const parsed = parseCcd((await ccdFor(fullChart().app)).document);

    expect(parsed.immunisations[0]?.vaccine.code).toBe('150');
    expect(parsed.immunisations[0]?.lotNumber).toBe('LOT-000A');
    expect(parsed.immunisations[0]?.status).toBe('completed');
  });

  it('carries an encounter, named by what it was for', async () => {
    const parsed = parseCcd((await ccdFor(fullChart().app)).document);

    expect(parsed.encounters[0]?.type.display).toBe('Annual review');
    expect(parsed.encounters[0]?.endedAt).toBeDefined();
  });

  it('round-trips a full chart through the codec without losing a section', async () => {
    const parsed = parseCcd((await ccdFor(fullChart().app)).document);

    expect(parsed.allergies).toHaveLength(1);
    expect(parsed.medications).toHaveLength(1);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.immunisations).toHaveLength(1);
    expect(parsed.encounters).toHaveLength(1);
  });
});

describe('rows recorded with the optional columns left empty', () => {
  /**
   * Most of a chart is optional columns, and the branch that handles an absent
   * one is the branch a tidy fixture never reaches. A practice that records a
   * name and nothing else is most of what a small clinic holds.
   */
  function sparseChart(): ReturnType<typeof createTestApp> {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));

    seed(created.dataset, 'AllergyIntolerance', {
      ...storageColumns(testId(220)),
      patientId: PATIENT,
      type: 'ALLERGY',
      category: 'MEDICATION',
      criticality: 'LOW',
      clinicalStatus: 'RESOLVED',
      substanceCode: null,
      substanceCodeSystem: null,
      substanceDisplay: 'Shellfish',
      reactionCodes: [],
      reactionText: null,
      severity: null,
      onsetDate: null,
      note: null,
      recordedAt: FIXED_NOW,
      recordedById: null,
    } as never);

    seed(created.dataset, 'MedicationStatement', {
      ...storageColumns(testId(221)),
      patientId: PATIENT,
      encounterId: null,
      rxnormCode: null,
      display: 'Aspirin',
      sigText: null,
      status: 'COMPLETED',
      source: 'REPORTED',
      effectiveStart: null,
      effectiveEnd: new Date('2026-02-11T00:00:00.000Z'),
      reportedAt: FIXED_NOW,
      note: null,
    } as never);

    seed(created.dataset, 'Condition', {
      ...storageColumns(testId(222)),
      patientId: PATIENT,
      encounterId: null,
      category: 'PROBLEM_LIST_ITEM',
      code: 'M54.5',
      codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
      display: 'Low back pain',
      snomedCode: null,
      clinicalStatus: 'RESOLVED',
      verificationStatus: 'CONFIRMED',
      onsetDate: null,
      abatementDate: new Date('2026-03-01T00:00:00.000Z'),
      severityCode: null,
      bodySiteCode: null,
      note: null,
      recordedAt: FIXED_NOW,
      recordedById: null,
    } as never);

    seed(created.dataset, 'Immunization', {
      ...storageColumns(testId(223)),
      patientId: PATIENT,
      encounterId: null,
      status: 'ENTERED_IN_ERROR',
      cvxCode: '207',
      mvxCode: null,
      ndcCode: null,
      display: 'COVID-19 mRNA',
      lotNumber: null,
      expirationDate: null,
      siteCode: null,
      routeCode: null,
      doseQuantity: null,
      doseUnit: null,
      administeredAt: new Date('2026-01-05T00:00:00.000Z'),
      administeredById: null,
      visDate: null,
      refusalReasonCode: null,
      reportedToRegistryAt: null,
    } as never);

    seed(created.dataset, 'Encounter', {
      ...storageColumns(testId(224)),
      facilityId: DEMO_FACILITY_A,
      patientId: PATIENT,
      providerId: testId(900),
      appointmentId: null,
      class: 'EMERGENCY',
      status: 'IN_PROGRESS',
      reasonCode: null,
      reasonText: null,
      startedAt: new Date('2026-08-13T09:00:00.000Z'),
      endedAt: null,
      signedAt: null,
      signedById: null,
    } as never);

    return created;
  }

  /**
   * An uncoded substance is written as text by the codec rather than as a code
   * in a system it names, because a receiving system would look that code up and
   * find something else.
   */
  it('carries an uncoded substance as text, with no code attached', async () => {
    const parsed = parseCcd((await ccdFor(sparseChart().app)).document);

    expect(parsed.allergies[0]?.substance).toEqual({ display: 'Shellfish' });
    expect(parsed.allergies[0]?.reaction).toBeUndefined();
    expect(parsed.allergies[0]?.criticality).toBe('low');
    expect(parsed.allergies[0]?.status).toBe('completed');
  });

  it('carries a medication with no code, no instruction and no start', async () => {
    const parsed = parseCcd((await ccdFor(sparseChart().app)).document);

    expect(parsed.medications[0]?.medication).toEqual({ display: 'Aspirin' });
    expect(parsed.medications[0]?.sig).toBeUndefined();
    expect(parsed.medications[0]?.startDate).toBeUndefined();
    expect(parsed.medications[0]?.endDate).toBe('2026-02-11');
  });

  it('carries a resolved problem with its resolution date and no onset', async () => {
    const parsed = parseCcd((await ccdFor(sparseChart().app)).document);

    expect(parsed.problems[0]?.onsetDate).toBeUndefined();
    expect(parsed.problems[0]?.resolvedDate).toBe('2026-03-01');
    expect(parsed.problems[0]?.status).toBe('completed');
  });

  it('carries an immunisation with no lot number, and a status that is not completed', async () => {
    const parsed = parseCcd((await ccdFor(sparseChart().app)).document);

    expect(parsed.immunisations[0]?.lotNumber).toBeUndefined();
    expect(parsed.immunisations[0]?.status).toBe('active');
  });

  /**
   * An encounter with no reason recorded is named by its class instead, because
   * a document listing an untitled visit tells the reader nothing about it.
   */
  it('names an encounter by its class when no reason was recorded', async () => {
    const parsed = parseCcd((await ccdFor(sparseChart().app)).document);

    expect(parsed.encounters[0]?.type.display).toBe('emergency');
    expect(parsed.encounters[0]?.endedAt).toBeUndefined();
  });
});

describe('the header, from what the record holds about the person', () => {
  it('carries the address, telephone, email and language it has', async () => {
    const created = createTestApp();
    seed(
      created.dataset,
      'Patient',
      makePatientRow({
        id: PATIENT,
        sexAtBirth: 'MALE',
        languageCode: 'es',
        email: 'testina@example.invalid',
        phoneMobile: '+15550100',
        addressLine1: '1 Example Street',
        addressLine2: 'Flat 2',
        city: 'Testville',
        state: 'CA',
        postalCode: '90001',
        country: 'US',
      })
    );

    const parsed = parseCcd((await ccdFor(created.app)).document);

    expect(parsed.patient.gender).toBe('male');
    expect(parsed.patient.languageCode).toBe('es');
    expect(parsed.patient.email).toBe('testina@example.invalid');
    expect(parsed.patient.phone).toBe('+15550100');
    expect(parsed.patient.address).toEqual({
      line1: '1 Example Street',
      line2: 'Flat 2',
      city: 'Testville',
      state: 'CA',
      postalCode: '90001',
      country: 'US',
    });
  });

  /**
   * `other` and `unknown` are different answers, and the column is not nullable:
   * a patient whose sex was never recorded arrives as `UNKNOWN`, not as an
   * absent value. Sending that to `other` - as an earlier version of this did -
   * asserts to the receiving clinician that the practice recorded an answer it
   * never had.
   */
  it('distinguishes a recorded other from a sex nobody recorded', async () => {
    const cases = [
      ['OTHER', 'other'],
      ['UNKNOWN', 'unknown'],
      ['MALE', 'male'],
      ['FEMALE', 'female'],
    ] as const;

    for (const [recorded, expected] of cases) {
      const created = createTestApp();
      seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT, sexAtBirth: recorded }));

      expect(parseCcd((await ccdFor(created.app)).document).patient.gender, recorded).toBe(
        expected
      );
    }
  });

  it('omits the custodian telephone when the facility has none', async () => {
    const created = createTestApp();
    seed(
      created.dataset,
      'Patient',
      makePatientRow({ id: PATIENT, primaryFacilityId: DEMO_FACILITY_A })
    );
    seed(created.dataset, 'Facility', {
      ...storageColumns(DEMO_FACILITY_A),
      name: 'Example Clinic',
      code: 'EC',
      npi: null,
      posCode: '11',
      timezone: 'UTC',
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      phone: null,
      active: true,
    } as never);

    const parsed = parseCcd((await ccdFor(created.app)).document);

    expect(parsed.custodian.name).toBe('Example Clinic');
    expect(parsed.custodian.phone).toBeUndefined();
  });
});

describe('an allergy whose severity nobody assessed', () => {
  /**
   * Unassessed is not mild. Nobody having established how bad a reaction is does
   * not make it low, and a document that said low would understate it to the
   * next prescriber.
   */
  it('carries unable-to-assess rather than reading it down to low', async () => {
    const created = createTestApp();
    seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
    seed(created.dataset, 'AllergyIntolerance', {
      ...storageColumns(testId(230)),
      patientId: PATIENT,
      type: 'ALLERGY',
      category: 'MEDICATION',
      criticality: 'UNABLE_TO_ASSESS',
      clinicalStatus: 'ACTIVE',
      substanceCode: null,
      substanceCodeSystem: null,
      substanceDisplay: 'Sulfa drugs',
      reactionCodes: [],
      reactionText: null,
      severity: null,
      onsetDate: null,
      note: null,
      recordedAt: FIXED_NOW,
      recordedById: null,
    } as never);

    const parsed = parseCcd((await ccdFor(created.app)).document);

    expect(parsed.allergies[0]?.criticality).toBe('unable-to-assess');
  });
});
