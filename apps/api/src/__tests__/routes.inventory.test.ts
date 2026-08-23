import { describe, expect, it } from 'vitest';

import type { ScopedRow } from '../repositories/rows.js';

import {
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_TENANT_A,
  DEMO_TENANT_B,
  bearer,
  createTestApp,
  FIXED_NOW,
  jsonBearer,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
} from './support.js';

/**
 * The stockroom, end to end.
 *
 * What these assert is not that the routes answer 201. It is the handful of
 * facts a practice would notice being wrong months later and could not then
 * reconstruct: that a course of tablets removes the course rather than the dose,
 * that the short-dated carton leaves first, that a refused dispense writes
 * nothing at all, that a count that agreed still says so, and that a balance
 * arrived at through four different acts comes out at the number somebody
 * standing in front of the shelf would count.
 *
 * Every figure asserted below is written out as a literal. Re-deriving one by
 * summing `signedQuantity` in the test would only prove that the test and the
 * route call the same package function.
 */

const ITEM_CAPSULE = testId(10);
const ITEM_VIAL = testId(11);
const ITEM_PATCH = testId(12);
const LOT_OLD = testId(20);
const LOT_NEW = testId(21);
const LOT_THIRD = testId(22);
const PATIENT = testId(1);
const OTHER_PATIENT = testId(2);
const WITNESS = testId(70);
/** The subject the `dev-clinician-a` token resolves to. */
const CLINICIAN_A = '01890000-0000-7000-8000-000000000101';
const TODAY = '2026-08-17';

type App = ReturnType<typeof createTestApp>['app'];

function facilityRow(overrides: Partial<ScopedRow<'Facility'>> = {}): ScopedRow<'Facility'> {
  return {
    ...storageColumns(DEMO_FACILITY_A),
    name: 'Testville Clinic',
    code: 'TVC',
    npi: null,
    posCode: '11',
    timezone: 'UTC',
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: 'US',
    phone: null,
    active: true,
    ...overrides,
  };
}

function itemRow(overrides: Partial<ScopedRow<'StockItem'>> = {}): ScopedRow<'StockItem'> {
  return {
    ...storageColumns(ITEM_CAPSULE),
    sku: 'AMOX-500',
    name: 'Amoxicillin 500 mg capsule',
    unit: 'capsule',
    rxnormCode: null,
    ndcCode: null,
    cvxCode: null,
    packSize: 20,
    reorderLevel: 50,
    controlled: false,
    controlledSchedule: null,
    active: true,
    ...overrides,
  };
}

function lotRow(overrides: Partial<ScopedRow<'StockLot'>> = {}): ScopedRow<'StockLot'> {
  return {
    ...storageColumns(LOT_OLD),
    itemId: ITEM_CAPSULE,
    facilityId: DEMO_FACILITY_A,
    lotNumber: 'LOT-OLD',
    status: 'AVAILABLE',
    expiresOn: new Date('2027-12-01T00:00:00.000Z'),
    openedOn: null,
    beyondUseDays: null,
    manufacturer: null,
    ndcCode: null,
    receivedOn: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function movementRow(
  overrides: Partial<ScopedRow<'StockMovement'>> = {}
): ScopedRow<'StockMovement'> {
  return {
    ...storageColumns(testId(30)),
    postingId: testId(40),
    lotId: LOT_OLD,
    itemId: ITEM_CAPSULE,
    facilityId: DEMO_FACILITY_A,
    kind: 'RECEIPT',
    quantity: 100,
    occurredOn: new Date('2026-01-01T00:00:00.000Z'),
    actorId: testId(951),
    reason: null,
    correctsMovementId: null,
    lotSeq: 1,
    ...overrides,
  };
}

function userRow(overrides: Partial<ScopedRow<'User'>> = {}): ScopedRow<'User'> {
  return {
    ...storageColumns(WITNESS),
    email: 'adaeze.okafor@clinic.invalid',
    givenName: 'Adaeze',
    familyName: 'Okafor',
    credential: 'RN',
    npi: null,
    dea: null,
    taxonomyCode: null,
    isProvider: false,
    locale: 'en-US',
    status: 'ACTIVE',
    lastLoginAt: null,
    ...overrides,
  };
}

/** The catalogue and one site, which every case below needs and none is about. */
function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Facility', facilityRow());
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  // The encounter the dispense fixtures file against. It was never seeded, and
  // nothing noticed until the routes started resolving the chart they write to:
  // every one of those tests was asserting a fill against an encounter that did
  // not exist.
  seed(created.dataset, 'Encounter', {
    ...storageColumns(testId(61)),
    facilityId: DEMO_FACILITY_A,
    patientId: PATIENT,
    providerId: testId(900),
    appointmentId: null,
    class: 'AMBULATORY',
    status: 'COMPLETED',
    reasonCode: null,
    reasonText: null,
    startedAt: FIXED_NOW,
    endedAt: null,
    signedAt: null,
    signedById: null,
  });
  seed(
    created.dataset,
    'StockItem',
    itemRow(),
    itemRow({
      ...storageColumns(ITEM_VIAL),
      sku: 'LIDO-1',
      name: 'Lidocaine 1% 10 mL vial',
      unit: 'mL',
      packSize: null,
      reorderLevel: null,
      controlled: true,
      controlledSchedule: '2',
    }),
    itemRow({
      ...storageColumns(ITEM_PATCH),
      sku: 'FENT-25',
      name: 'Fentanyl 25 mcg patch',
      unit: 'patch',
      packSize: null,
      reorderLevel: 5,
      controlled: true,
      controlledSchedule: '2',
    })
  );
  return created;
}

interface Movement {
  id: string;
  lotId: string;
  itemId: string;
  kind: string;
  quantity: number;
  occurredOn: string;
  reason: string | null;
  lotSeq: number;
}

interface Posting {
  id: string;
  kind: string;
  occurredOn: string;
  postedById: string;
  patientId: string | null;
  witnessedById: string | null;
  reference: string | null;
  movements: Movement[];
}

interface ItemStock {
  onHand: number;
  usable: number;
  needsReorder: boolean;
  asOf: string;
  lots: { lotId: string; lotNumber: string; onHand: number; unusableReason: string | null }[];
  unusable: { lotId: string; unusableReason: string | null; onHand: number }[];
}

async function post(
  app: App,
  path: string,
  body: Record<string, unknown>,
  token: string = TOKENS.clinicianA
): Promise<Response> {
  return app.request(`/bff/v0/inventory/${path}`, {
    method: 'POST',
    headers: jsonBearer(token),
    body: JSON.stringify(body),
  });
}

async function postOk(
  app: App,
  path: string,
  body: Record<string, unknown>,
  token: string = TOKENS.clinicianA
): Promise<Posting> {
  const res = await post(app, path, body, token);
  expect(res.status, path).toBe(201);
  return (await res.json()) as Posting;
}

async function stockOf(
  app: App,
  itemId: string,
  query = `facilityId=${DEMO_FACILITY_A}&asOf=${TODAY}`
): Promise<ItemStock> {
  const res = await app.request(`/bff/v0/inventory/items/${itemId}/stock?${query}`, {
    headers: bearer(TOKENS.clinicianA),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ItemStock;
}

/** A delivery of `quantity` into a named carton, which most cases start from. */
function delivery(
  lotNumber: string,
  quantity: number,
  line: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    facilityId: DEMO_FACILITY_A,
    occurredOn: '2026-08-01',
    lines: [{ itemId: ITEM_CAPSULE, lotNumber, quantity, ...line }],
  };
}

describe('receiving a delivery', () => {
  it('converts packs into stock units exactly once', async () => {
    const { app, dataset } = harness();

    const posting = await postOk(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      reference: 'PS-99213',
      note: 'carton arrived dented, contents intact',
      lines: [{ itemId: ITEM_CAPSULE, lotNumber: 'LOT-A', packs: 4, expiresOn: '2027-06-30' }],
    });

    // Four packs of twenty is eighty capsules, not four and not sixteen hundred.
    expect(posting.movements).toHaveLength(1);
    expect(posting.movements[0]?.quantity).toBe(80);
    expect(posting.reference).toBe('PS-99213');
    expect(dataset.table('StockLot')).toHaveLength(1);
    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(80);
  });

  it('refuses a delivery in packs for an item that has no pack size', async () => {
    const { app, dataset } = harness();

    const res = await post(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      lines: [{ itemId: ITEM_VIAL, lotNumber: 'LOT-V', packs: 3 }],
    });

    expect(res.status).toBe(422);
    expect(await res.text()).toContain('lines.0.packs');
    expect(dataset.table('StockMovement')).toHaveLength(0);
  });

  it('refuses a line that says its quantity both ways', async () => {
    const { app } = harness();

    const res = await post(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      lines: [{ itemId: ITEM_CAPSULE, lotNumber: 'LOT-A', packs: 2, quantity: 40 }],
    });

    expect(res.status).toBe(422);
  });

  /**
   * The same carton number arriving twice is a second delivery into the same
   * box. A second lot row would split one carton's history in two, and a recall
   * on that number would then find half of it.
   */
  it('posts a second delivery of a known carton against the same lot', async () => {
    const { app, dataset } = harness();

    await postOk(app, 'receipts', delivery('LOT-A', 40));
    const second = await postOk(app, 'receipts', delivery('LOT-A', 25));

    expect(dataset.table('StockLot')).toHaveLength(1);
    expect(second.movements[0]?.lotSeq).toBe(2);
    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(65);
  });

  it('keeps two lines naming one new carton in a single lot', async () => {
    const { app, dataset } = harness();

    const posting = await postOk(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      lines: [
        { itemId: ITEM_CAPSULE, lotNumber: 'LOT-A', quantity: 10 },
        { itemId: ITEM_CAPSULE, lotNumber: 'LOT-A', quantity: 5 },
      ],
    });

    expect(dataset.table('StockLot')).toHaveLength(1);
    expect(posting.movements.map((movement) => movement.lotSeq)).toEqual([1, 2]);
    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(15);
  });

  it('records the carton details the delivery came with', async () => {
    const { app, dataset } = harness();

    await postOk(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      lines: [
        {
          itemId: ITEM_CAPSULE,
          lotNumber: 'LOT-A',
          quantity: 10,
          expiresOn: '2027-06-30',
          receivedOn: '2026-07-30',
          beyondUseDays: 28,
          manufacturer: 'Testicorp',
          ndcCode: '00000-0000-00',
        },
      ],
    });

    expect(dataset.table('StockLot')[0]).toMatchObject({
      lotNumber: 'LOT-A',
      expiresOn: new Date('2027-06-30T00:00:00.000Z'),
      receivedOn: new Date('2026-07-30T00:00:00.000Z'),
      beyondUseDays: 28,
      manufacturer: 'Testicorp',
      ndcCode: '00000-0000-00',
    });
  });

  it('answers 404 for a delivery of an item this organisation does not have', async () => {
    const { app } = harness();

    const res = await post(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      lines: [{ itemId: testId(999), lotNumber: 'LOT-A', quantity: 1 }],
    });

    expect(res.status).toBe(404);
  });
});

describe('dispensing', () => {
  /**
   * The whole reason `courseTotal` exists. Three numbers are visible - 1, 2 and
   * 10 - and the quantity that leaves the shelf is none of them.
   */
  it('removes the whole course, not the dose', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 100));

    const posting = await postOk(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      course: { perDose: 1, dosesPerDay: 2, days: 10 },
    });

    expect(posting.movements[0]?.quantity).toBe(20);
    expect(posting.movements[0]?.kind).toBe('DISPENSE');
    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(80);
  });

  /**
   * First-expired-first-out, not first-in. The short-dated carton arrived five
   * months after the long-dated one; FIFO would hold it behind until it expired
   * on the shelf, which is waste that is invisible in the code and obvious in
   * the bin. Seeded in the wrong order deliberately, so the assertion is not
   * about `toSorted` being stable.
   */
  it('draws the short-dated carton first even though it arrived last', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'StockLot',
      lotRow({ ...storageColumns(LOT_OLD), lotNumber: 'LONG', expiresOn: new Date('2027-12-01') }),
      lotRow({
        ...storageColumns(LOT_NEW),
        lotNumber: 'SHORT',
        expiresOn: new Date('2026-09-01'),
        receivedOn: new Date('2026-06-01'),
      })
    );
    seed(
      dataset,
      'StockMovement',
      movementRow({ ...storageColumns(testId(30)), lotId: LOT_OLD, quantity: 100 }),
      movementRow({ ...storageColumns(testId(31)), lotId: LOT_NEW, quantity: 100 })
    );

    const posting = await postOk(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 30,
    });

    expect(posting.movements).toHaveLength(1);
    expect(posting.movements[0]?.lotId).toBe(LOT_NEW);
  });

  it('breaks a tie on expiry with whichever carton arrived first', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'StockLot',
      lotRow({
        ...storageColumns(LOT_NEW),
        lotNumber: 'LATE',
        expiresOn: new Date('2026-09-01'),
        receivedOn: new Date('2026-06-01'),
      }),
      lotRow({
        ...storageColumns(LOT_THIRD),
        lotNumber: 'EARLY',
        expiresOn: new Date('2026-09-01'),
        receivedOn: new Date('2026-02-01'),
      })
    );
    seed(
      dataset,
      'StockMovement',
      movementRow({ ...storageColumns(testId(30)), lotId: LOT_NEW, quantity: 50 }),
      movementRow({ ...storageColumns(testId(31)), lotId: LOT_THIRD, quantity: 50 })
    );

    const posting = await postOk(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 10,
    });

    expect(posting.movements[0]?.lotId).toBe(LOT_THIRD);
  });

  it('spreads a divisible request across two cartons under one posting', async () => {
    const { app, sink } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 12));
    await postOk(app, 'receipts', delivery('LOT-B', 30));

    const posting = await postOk(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 20,
    });

    expect(posting.movements.map((movement) => movement.quantity)).toEqual([12, 8]);
    expect(new Set(posting.movements.map((movement) => movement.id)).size).toBe(2);

    // One act, and the audit event says so by naming both lines. The
    // repositories' own events say which rows were touched, not that stock left
    // the building.
    const posted = sink.writes().filter((entry) => entry.event.action === 'stock.posted');
    const last = posted.at(-1)?.event.metadata as { movements: unknown[] };
    expect(last.movements).toHaveLength(2);
  });
});

describe('when the shelf cannot supply it', () => {
  it('refuses a shortfall and writes nothing at all', async () => {
    const { app, dataset } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 5));
    const before = dataset.table('StockMovement').length;

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 40,
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('Only 5 of 40');
    expect(dataset.table('StockMovement')).toHaveLength(before);
    expect(dataset.table('StockPosting')).toHaveLength(1);
  });

  /**
   * The state that makes people distrust a system: the screen says there is no
   * stock, the fridge visibly has some, and both are true. Saying only
   * "insufficient" would send somebody looking for a carton that is right there.
   */
  it('says so when the stock is there but no single carton holds enough', async () => {
    const { app, dataset } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 10));
    await postOk(app, 'receipts', delivery('LOT-B', 10));
    const before = dataset.table('StockMovement').length;

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: false,
      quantity: 15,
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('no single lot holds 15');
    expect(dataset.table('StockMovement')).toHaveLength(before);
  });

  /**
   * A vial pierced three weeks before its printed expiry stops being usable when
   * the beyond-use window closes, not when the carton says. The window is
   * printed on nothing, which is why it is the one a practice forgets.
   */
  it('will not draw from a vial past its beyond-use window while its printed expiry is ahead', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'StockLot',
      lotRow({
        itemId: ITEM_VIAL,
        lotNumber: 'VIAL-1',
        expiresOn: new Date('2027-12-01'),
        openedOn: new Date('2026-08-01'),
        beyondUseDays: 7,
      })
    );
    seed(dataset, 'StockMovement', movementRow({ itemId: ITEM_VIAL, quantity: 10 }));

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_VIAL,
      patientId: PATIENT,
      divisible: true,
      quantity: 2,
    });

    expect(res.status).toBe(409);
    const stock = await stockOf(app, ITEM_VIAL);
    // Physically present and not usable: two different questions, two figures.
    expect(stock.onHand).toBe(10);
    expect(stock.usable).toBe(0);
    expect(stock.unusable[0]?.unusableReason).toContain('beyond-use date');
  });

  /**
   * A status this system does not recognise fails closed rather than falling
   * through to the expiry check. It is the one failure in the package that
   * reaches a patient - recalled stock reading as available - so the lot is
   * refused rather than assumed benign.
   */
  it('will not draw from a carton whose status it does not recognise', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'StockLot', lotRow({ status: 'RECALED' as ScopedRow<'StockLot'>['status'] }));
    seed(dataset, 'StockMovement', movementRow({ quantity: 40 }));

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 1,
    });

    expect(res.status).toBe(409);
    expect((await stockOf(app, ITEM_CAPSULE)).unusable[0]?.unusableReason).toContain(
      'not one this system knows'
    );
  });

  it('refuses a quantity too large to carry as a stock figure', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 5));

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 1e308,
    });

    expect(res.status).toBe(422);
    // The refusal moved from the package to the schema, so the message is
    // Zod's rather than `toStockPrecision`'s. What matters and is asserted is
    // that it is a 422 naming `quantity` - a figure the column cannot store is
    // refused where the client can still be told which field is wrong, rather
    // than at a read weeks later on a ledger row that cannot be taken back out.
    const body = (await res.json()) as { errors?: { path?: string }[] };
    expect(body.errors?.map((issue) => issue.path)).toContain('quantity');
  });

  it('refuses a course whose numbers multiply out past what can be carried', async () => {
    const { app } = harness();

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      course: { perDose: 1e300, dosesPerDay: 1e10, days: 10 },
    });

    expect(res.status).toBe(422);
    expect(await res.text()).toContain('course');
  });
});

describe('dispensing against a prescription', () => {
  function prescriptionRow(
    overrides: Partial<ScopedRow<'MedicationRequest'>> = {}
  ): ScopedRow<'MedicationRequest'> {
    return {
      ...storageColumns(testId(60)),
      patientId: PATIENT,
      encounterId: null,
      prescriberId: testId(951),
      rxnormCode: null,
      ndcCode: null,
      display: 'Amoxicillin 500 mg capsule',
      sig: {},
      sigText: 'One capsule twice daily for ten days',
      quantity: 20,
      quantityUnit: 'capsule',
      refills: 0,
      daysSupply: 10,
      dispenseAsWritten: false,
      controlledSchedule: null,
      pharmacyName: null,
      pharmacyNcpdpId: null,
      status: 'ACTIVE',
      intent: 'ORDER',
      erxRef: null,
      writtenAt: new Date('2026-08-16T00:00:00.000Z'),
      transmittedAt: null,
      ...overrides,
    };
  }

  it('records the prescription the fill was against', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'MedicationRequest', prescriptionRow());
    await postOk(app, 'receipts', delivery('LOT-A', 100));

    const posting = await postOk(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      prescriptionId: testId(60),
      encounterId: testId(61),
      note: 'handed to the patient at the counter',
      divisible: true,
      quantity: 20,
    });

    expect(posting.patientId).toBe(PATIENT);
    expect(dataset.table('StockPosting').at(-1)).toMatchObject({
      prescriptionId: testId(60),
      encounterId: testId(61),
      note: 'handed to the patient at the counter',
    });
  });

  /**
   * The two ids arrive separately and a mismatch would file a controlled removal
   * against the wrong chart - the shape of a diversion, and unrepairable on an
   * append-only table.
   */
  it('refuses a prescription that names a different patient', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Patient', makePatientRow({ id: OTHER_PATIENT, mrn: 'OR-100483' }));
    seed(dataset, 'MedicationRequest', prescriptionRow({ patientId: OTHER_PATIENT }));
    await postOk(app, 'receipts', delivery('LOT-A', 100));

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      prescriptionId: testId(60),
      divisible: true,
      quantity: 20,
    });

    expect(res.status).toBe(422);
    expect(await res.text()).toContain('prescriptionId');
  });

  it('answers 404, never 403, for a prescription in another organisation', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'MedicationRequest', prescriptionRow({ tenantId: DEMO_TENANT_B }));
    await postOk(app, 'receipts', delivery('LOT-A', 100));

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      prescriptionId: testId(60),
      divisible: true,
      quantity: 20,
    });

    expect(res.status).toBe(404);
  });
});

describe('administering a dose', () => {
  /**
   * The carton the dose came out of, not only its id. A second, untouched vial
   * is on the shelf as well, so this also asserts the answer names the lot that
   * was actually drawn from rather than everything in the fridge.
   */
  it('answers with the carton, so the number is not retyped off the box', async () => {
    const { app, dataset } = harness();
    await postOk(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      lines: [
        { itemId: ITEM_VIAL, lotNumber: 'VIAL-77', quantity: 10, expiresOn: '2027-03-31' },
        { itemId: ITEM_VIAL, lotNumber: 'VIAL-88', quantity: 10, expiresOn: '2028-01-31' },
      ],
    });

    const res = await post(app, 'administrations', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_VIAL,
      patientId: PATIENT,
      encounterId: testId(61),
      immunizationId: testId(62),
      note: 'left deltoid',
      divisible: false,
      quantity: 0.5,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      posting: Posting;
      lots: { lotNumber: string; expiresOn: string | null; quantity: number }[];
    };
    expect(body.posting.movements[0]?.kind).toBe('ADMINISTER');
    expect(body.lots).toHaveLength(1);
    expect(body.lots[0]).toMatchObject({
      lotId: body.posting.movements[0]?.lotId,
      lotNumber: 'VIAL-77',
      expiresOn: '2027-03-31',
      quantity: 0.5,
    });
    expect(dataset.table('StockPosting').at(-1)).toMatchObject({
      immunizationId: testId(62),
      encounterId: testId(61),
      note: 'left deltoid',
    });
    expect((await stockOf(app, ITEM_VIAL)).onHand).toBe(19.5);
  });

  /**
   * The same course arithmetic as a dispense, because a dose given over three
   * days from stock is still three days of stock leaving the shelf. It also
   * shows the carton with no printed expiry answering null rather than a
   * sentinel date nobody recorded.
   */
  it('takes a course on an administration too, and reports an undated carton as undated', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: '2026-08-01',
      lines: [{ itemId: ITEM_VIAL, lotNumber: 'VIAL-99', quantity: 10 }],
    });

    const res = await post(app, 'administrations', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_VIAL,
      patientId: PATIENT,
      divisible: true,
      course: { perDose: 0.5, dosesPerDay: 2, days: 3 },
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      lots: { lotNumber: string; expiresOn: string | null; quantity: number }[];
    };
    expect(body.lots).toHaveLength(1);
    expect(body.lots[0]).toMatchObject({
      lotNumber: 'VIAL-99',
      expiresOn: null,
      // Half a millilitre twice a day for three days is three millilitres, and
      // the course arithmetic is the same on this route as on a dispense.
      quantity: 3,
    });
  });
});

describe('wasting what was drawn', () => {
  it('records the discard against the vial it was drawn from', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 20));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';

    const posting = await postOk(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId,
      quantity: 3,
      reason: 'dropped on the floor',
      patientId: PATIENT,
      note: 'remainder of the drawn dose',
    });

    expect(posting.patientId).toBe(PATIENT);
    expect(posting.movements[0]?.kind).toBe('WASTE');
    expect(posting.movements[0]?.reason).toBe('dropped on the floor');
    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(17);
  });

  it('refuses a waste with no reason', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 20));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';

    const res = await post(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId,
      quantity: 3,
      reason: '   ',
    });

    expect(res.status).toBe(422);
  });

  it('refuses to waste more than the carton held on the day named', async () => {
    const { app, dataset } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 20));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';
    const before = dataset.table('StockMovement').length;

    const res = await post(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId,
      quantity: 25,
      reason: 'spilled',
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('held 20');
    expect(dataset.table('StockMovement')).toHaveLength(before);
  });

  it('needs a witness before a controlled substance is destroyed', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'StockLot', lotRow({ itemId: ITEM_PATCH, lotNumber: 'PATCH-1' }));
    seed(dataset, 'StockMovement', movementRow({ itemId: ITEM_PATCH, quantity: 10 }));

    const res = await post(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId: LOT_OLD,
      quantity: 1,
      reason: 'patient declined',
    });

    expect(res.status).toBe(422);
    expect(await res.text()).toContain('witnessedById');
  });

  it('records the witness when there is one', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'User', userRow());
    seed(dataset, 'StockLot', lotRow({ itemId: ITEM_PATCH, lotNumber: 'PATCH-1' }));
    seed(dataset, 'StockMovement', movementRow({ itemId: ITEM_PATCH, quantity: 10 }));

    const posting = await postOk(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId: LOT_OLD,
      quantity: 1,
      reason: 'patient declined',
      witnessedById: WITNESS,
    });

    expect(posting.witnessedById).toBe(WITNESS);
  });

  /**
   * A witness id that names nobody is worse than a blank field, because it looks
   * like a second person was there.
   */
  it('refuses a witness who is not in this organisation', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'User', userRow({ tenantId: DEMO_TENANT_B }));
    seed(dataset, 'StockLot', lotRow({ itemId: ITEM_PATCH, lotNumber: 'PATCH-1' }));
    seed(dataset, 'StockMovement', movementRow({ itemId: ITEM_PATCH, quantity: 10 }));

    const res = await post(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId: LOT_OLD,
      quantity: 1,
      reason: 'patient declined',
      witnessedById: WITNESS,
    });

    expect(res.status).toBe(404);
  });

  it('answers 404 for a carton kept at another site', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'StockLot', lotRow({ facilityId: DEMO_FACILITY_B }));

    const res = await post(
      app,
      'wastages',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        lotId: LOT_OLD,
        quantity: 1,
        reason: 'spilled',
      },
      TOKENS.adminA
    );

    expect(res.status).toBe(404);
  });
});

describe('counting the shelf', () => {
  it('writes no movement when the shelf and the ledger agree, and still says so', async () => {
    const { app, dataset } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 40));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';
    const before = dataset.table('StockMovement').length;

    const res = await post(
      app,
      'counts',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        reason: 'monthly cycle count',
        lines: [{ lotId, counted: 40 }],
      },
      TOKENS.adminA
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      posting: Posting;
      variances: unknown[];
      agreed: { lotId: string; expected: number }[];
    };
    expect(body.variances).toEqual([]);
    expect(body.agreed).toEqual([{ lotId, counted: 40, expected: 40 }]);
    expect(body.posting.movements).toEqual([]);
    expect(dataset.table('StockMovement')).toHaveLength(before);
    // The posting exists even though nothing moved: "we counted, and it was
    // right" is a fact, not an absence.
    expect(dataset.table('StockPosting').at(-1)?.kind).toBe('COUNT');
  });

  it('writes a shortfall carrying both figures in its reason', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 40));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';

    const res = await post(
      app,
      'counts',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        reference: 'SHEET-3',
        note: 'counted twice, both times 37',
        reason: 'monthly cycle count',
        lines: [{ lotId, counted: 37 }],
      },
      TOKENS.adminA
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { posting: Posting; variances: { kind: string }[] };
    expect(body.variances[0]?.kind).toBe('COUNT_SHORTFALL');
    expect(body.posting.movements[0]?.quantity).toBe(3);
    expect(body.posting.movements[0]?.reason).toBe('monthly cycle count (counted 37, expected 40)');
    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(37);
  });

  it('writes a surplus when the shelf holds more than the ledger thought', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 40));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';

    const res = await post(
      app,
      'counts',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        reason: 'found a sleeve behind the box',
        lines: [{ lotId, counted: 44 }],
      },
      TOKENS.adminA
    );

    const body = (await res.json()) as { posting: Posting; variances: { kind: string }[] };
    expect(body.variances[0]?.kind).toBe('COUNT_SURPLUS');
    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(44);
  });

  it('refuses a count it cannot compare with the ledger', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 40));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';

    const res = await post(
      app,
      'counts',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        reason: 'monthly cycle count',
        lines: [{ lotId, counted: 1e308 }],
      },
      TOKENS.adminA
    );

    expect(res.status).toBe(422);
    expect(await res.text()).toContain('lines.0.counted');
  });

  it('answers 404 for a carton at another site', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'StockLot', lotRow({ facilityId: DEMO_FACILITY_B }));

    const res = await post(
      app,
      'counts',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        reason: 'monthly cycle count',
        lines: [{ lotId: LOT_OLD, counted: 1 }],
      },
      TOKENS.adminA
    );

    expect(res.status).toBe(404);
  });
});

/**
 * A recall, a quarantine, a retirement, and the release that undoes one.
 *
 * The point of the endpoint is not that it flips a column. It is that after it
 * has run, a question about a day before the change still gets the answer that
 * was true on that day - which is the whole promise `lots.ts` opens with and the
 * one field that could not keep it.
 *
 * The dates are all comfortably in the past, deliberately. The route refuses a
 * change dated after today at the site, and today is read from the real clock,
 * so a scenario built on dates near it would start failing on a particular
 * morning for a reason nobody would look for.
 */
describe('taking a lot out of use', () => {
  const RECEIVED = '2026-01-05';
  const RECALLED_ON = '2026-03-10';
  const BEFORE = '2026-03-01';
  const AFTER = '2026-03-20';

  interface LotView {
    id: string;
    lotNumber: string;
    status: string;
  }

  interface StatusChangeResponse {
    posting: Posting;
    lots: { lotId: string; lotNumber: string; from: string; to: string; effectiveOn: string }[];
  }

  async function lotsAt(app: App, query: string): Promise<LotView[]> {
    const res = await app.request(`/bff/v0/inventory/lots?facilityId=${DEMO_FACILITY_A}&${query}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status, query).toBe(200);
    return ((await res.json()) as { data: LotView[] }).data;
  }

  /** One carton, delivered through the route so it carries an opening entry. */
  async function received(app: App, lotNumber = 'LOT-R'): Promise<string> {
    const posting = await postOk(app, 'receipts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: RECEIVED,
      lines: [{ itemId: ITEM_CAPSULE, lotNumber, quantity: 60 }],
    });
    return posting.movements[0]?.lotId ?? '';
  }

  function recall(lotId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      facilityId: DEMO_FACILITY_A,
      occurredOn: RECALLED_ON,
      status: 'RECALLED',
      reason: 'manufacturer notice: particulate matter in the fill',
      reference: 'FDA-2026-114',
      lotIds: [lotId],
      ...overrides,
    };
  }

  /**
   * The acceptance criterion this whole feature was raised for.
   *
   * A carton available on the first and recalled on the tenth reads available on
   * the first, in both directions, and the failure this replaces was the
   * dangerous one: a reconciliation of the first came up short against a shelf
   * that had been correct, with the discrepancy pointing at nothing.
   */
  it('answers a question about a day before the recall with the state on that day', async () => {
    const { app } = harness();
    const lotId = await received(app);

    const res = await post(app, 'status-changes', recall(lotId));
    expect(res.status).toBe(201);

    const before = await lotsAt(app, `asOf=${BEFORE}&lotNumber=LOT-R`);
    const after = await lotsAt(app, `asOf=${AFTER}&lotNumber=LOT-R`);
    expect(before[0]?.status).toBe('AVAILABLE');
    expect(after[0]?.status).toBe('RECALLED');

    // And the same question of the balance report, which reaches the package
    // through an entirely different path: the recalled carton is drawable on the
    // first and carries a reason naming its status on the twentieth.
    const stockBefore = await stockOf(
      app,
      ITEM_CAPSULE,
      `facilityId=${DEMO_FACILITY_A}&asOf=${BEFORE}`
    );
    const stockAfter = await stockOf(
      app,
      ITEM_CAPSULE,
      `facilityId=${DEMO_FACILITY_A}&asOf=${AFTER}`
    );
    expect(stockBefore.usable).toBe(60);
    expect(stockAfter.usable).toBe(0);
    expect(stockAfter.unusable[0]?.unusableReason).toContain('recalled');
  });

  /**
   * The column and the history cannot disagree about today.
   *
   * The lot list narrows on `StockLot.status`, which the database can index, and
   * reports the status resolved from the history. A recall written to the
   * history and not copied to the column would produce a `status=RECALLED`
   * listing with the recalled carton missing from it - which is the query a
   * pharmacist runs first and the one direction that hurts somebody.
   */
  it('puts the lot into the status filter it now belongs to', async () => {
    const { app } = harness();
    const lotId = await received(app);

    expect((await lotsAt(app, 'status=RECALLED')).map((lot) => lot.id)).not.toContain(lotId);
    expect((await post(app, 'status-changes', recall(lotId))).status).toBe(201);

    expect((await lotsAt(app, 'status=RECALLED')).map((lot) => lot.id)).toEqual([lotId]);
    expect((await lotsAt(app, 'status=AVAILABLE')).map((lot) => lot.id)).not.toContain(lotId);
  });

  /** The one posting kind that moves no stock: the cartons stay where they are. */
  it('writes no movement and leaves the balance alone', async () => {
    const { app } = harness();
    const lotId = await received(app);

    const res = await post(app, 'status-changes', recall(lotId));
    const body = (await res.json()) as StatusChangeResponse;

    expect(body.posting.kind).toBe('STATUS_CHANGE');
    expect(body.posting.movements).toEqual([]);
    expect(body.posting.reference).toBe('FDA-2026-114');
    expect(body.lots).toEqual([
      {
        lotId,
        lotNumber: 'LOT-R',
        from: 'AVAILABLE',
        to: 'RECALLED',
        effectiveOn: RECALLED_ON,
      },
    ]);

    // Still physically present. A recall is not a disposal, and reporting it as
    // one would lose the stock somebody has to account for and destroy.
    const stock = await stockOf(app, ITEM_CAPSULE, `facilityId=${DEMO_FACILITY_A}&asOf=${AFTER}`);
    expect(stock.onHand).toBe(60);
    expect(stock.usable).toBe(0);
  });

  /** One notice, eleven cartons, one act - and one sequence per lot. */
  it('holds every lot a single notice names', async () => {
    const { app } = harness();
    const first = await received(app, 'LOT-R1');
    const second = await received(app, 'LOT-R2');

    const res = await post(app, 'status-changes', recall(first, { lotIds: [first, second] }));
    const body = (await res.json()) as StatusChangeResponse;

    expect(body.lots.map((lot) => lot.lotId)).toEqual([first, second]);
    expect((await lotsAt(app, 'status=RECALLED')).map((lot) => lot.id)).toEqual([first, second]);
  });

  it('records who acted, when, and why', async () => {
    const { app, dataset } = harness();
    const lotId = await received(app);

    await post(app, 'status-changes', recall(lotId));

    const changes = dataset
      .table('StockLotStatusChange')
      .filter((row) => (row as unknown as { lotId: string }).lotId === lotId);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({
      status: 'RECALLED',
      lotSeq: 2,
      actorId: CLINICIAN_A,
      reason: 'manufacturer notice: particulate matter in the fill',
    });
  });

  it('refuses a change dated after today at the site', async () => {
    const { app } = harness();
    const lotId = await received(app);

    const res = await post(app, 'status-changes', recall(lotId, { occurredOn: '2099-01-01' }));

    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('occurredOn');
  });

  /**
   * An entry behind one already recorded would leave the lot's column asserting
   * a state the history no longer supports, in a table that offers no way to put
   * it back.
   */
  it('refuses a change dated before one already recorded against the lot', async () => {
    const { app } = harness();
    const lotId = await received(app);
    expect((await post(app, 'status-changes', recall(lotId))).status).toBe(201);

    const res = await post(app, 'status-changes', recall(lotId, { occurredOn: '2026-02-01' }));

    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('lotIds.0');
  });

  /** Including the opening entry, so a recall cannot predate the delivery. */
  it('refuses a change dated before the lot was received', async () => {
    const { app } = harness();
    const lotId = await received(app);

    const res = await post(app, 'status-changes', recall(lotId, { occurredOn: '2025-12-01' }));

    expect(res.status).toBe(422);
  });

  it('refuses a lot held at another site', async () => {
    const { app, dataset } = harness();
    seed(
      dataset,
      'StockLot',
      lotRow({ ...storageColumns(LOT_THIRD), facilityId: DEMO_FACILITY_B, lotNumber: 'LOT-ELSE' })
    );

    const res = await post(app, 'status-changes', recall(LOT_THIRD), TOKENS.adminA);

    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('not at this facility');
  });

  it('refuses a lot that does not exist', async () => {
    const { app } = harness();

    expect((await post(app, 'status-changes', recall(testId(99)))).status).toBe(404);
  });

  it('refuses a notice naming one lot twice', async () => {
    const { app } = harness();
    const lotId = await received(app);

    const res = await post(app, 'status-changes', recall(lotId, { lotIds: [lotId, lotId] }));

    expect(res.status).toBe(422);
  });

  it('refuses a change with no reason', async () => {
    const { app } = harness();
    const lotId = await received(app);

    const res = await post(app, 'status-changes', recall(lotId, { reason: '   ' }));

    expect(res.status).toBe(422);
  });

  /**
   * The asymmetry, and the reason for it: putting a hold on stock refuses stock
   * nobody has proved is bad, and taking one off hands out stock somebody
   * thought was. Only the second can reach a patient.
   */
  it('lets a clinician quarantine and refuses them the release', async () => {
    const { app } = harness();
    const lotId = await received(app);

    const held = await post(app, 'status-changes', recall(lotId, { status: 'QUARANTINED' }));
    expect(held.status).toBe(201);

    const release = await post(
      app,
      'status-changes',
      recall(lotId, {
        status: 'AVAILABLE',
        occurredOn: AFTER,
        reason: 'supplier confirmed the lot',
      })
    );
    expect(release.status).toBe(403);

    const byAdmin = await post(
      app,
      'status-changes',
      recall(lotId, {
        status: 'AVAILABLE',
        occurredOn: AFTER,
        reason: 'supplier confirmed the lot',
      }),
      TOKENS.adminA
    );
    expect(byAdmin.status).toBe(201);
    expect((await lotsAt(app, 'status=AVAILABLE')).map((lot) => lot.id)).toContain(lotId);
    // And the quarantine is still the answer for the fortnight it was in force.
    expect((await lotsAt(app, `asOf=${RECALLED_ON}&lotNumber=LOT-R`))[0]?.status).toBe(
      'QUARANTINED'
    );
  });

  it('refuses a role holding no inventory grant', async () => {
    const { app } = harness();
    const lotId = await received(app);

    expect((await post(app, 'status-changes', recall(lotId), TOKENS.billerA)).status).toBe(403);
    expect(
      (
        await app.request('/bff/v0/inventory/status-changes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(recall(lotId)),
        })
      ).status
    ).toBe(401);
  });

  /**
   * Refused rather than resolved either way. The filter is a column predicate
   * applied before paging and the reported status is resolved after it, so the
   * pair pages one question and answers another - and they agree for every lot
   * whose status has never changed, which is why nobody would notice.
   */
  it('refuses a status filter and an as-of date together', async () => {
    const { app } = harness();

    const res = await app.request(
      `/bff/v0/inventory/lots?facilityId=${DEMO_FACILITY_A}&status=AVAILABLE&asOf=${BEFORE}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('asOf');
  });
});

describe('what the shelf says', () => {
  /**
   * Four acts, one number. Every figure here is a literal somebody could arrive
   * at by hand: a hundred in, twenty dispensed, three wasted, and then a count
   * that found seventy-five rather than the seventy-seven the ledger expected.
   */
  it('arrives at the figure a person standing in front of it would count', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 100));
    const lotId = (await stockOf(app, ITEM_CAPSULE)).lots[0]?.lotId ?? '';

    await postOk(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 20,
    });
    await postOk(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId,
      quantity: 3,
      reason: 'blister pack damaged',
    });
    await post(
      app,
      'counts',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        reason: 'monthly cycle count',
        lines: [{ lotId, counted: 75 }],
      },
      TOKENS.adminA
    );

    const stock = await stockOf(app, ITEM_CAPSULE);
    expect(stock.onHand).toBe(75);
    expect(stock.usable).toBe(75);
    expect(stock.lots[0]?.onHand).toBe(75);
  });

  /**
   * A carton with no ledger line at all is a lot somebody created and never
   * stocked. It reads as zero rather than dropping out of the report: a lot the
   * balance screen does not mention is one nobody will notice is empty.
   */
  it('reports a carton that has never been stocked as holding nothing', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'StockLot', lotRow({ lotNumber: 'NEVER-STOCKED' }));

    const stock = await stockOf(app, ITEM_CAPSULE);

    expect(stock.onHand).toBe(0);
    expect(stock.lots).toEqual([
      expect.objectContaining({ lotNumber: 'NEVER-STOCKED', onHand: 0 }),
    ]);
  });

  it('flags an item whose usable stock has fallen to its reorder level', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 50));

    // Reorder level is inclusive: 50 against a level of 50 is already due.
    expect((await stockOf(app, ITEM_CAPSULE)).needsReorder).toBe(true);
  });

  /**
   * The snapshot is taken with no page limit. A limit would return a
   * confidently wrong number with no error at all, which is worse than a slow
   * answer - so this seeds more movements than one page holds.
   */
  it('sums a ledger longer than a single page', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'StockLot', lotRow());
    for (let index = 0; index < 120; index += 1) {
      seed(
        dataset,
        'StockMovement',
        movementRow({ ...storageColumns(testId(1000 + index)), quantity: 1, lotSeq: index + 1 })
      );
    }

    expect((await stockOf(app, ITEM_CAPSULE)).onHand).toBe(120);
  });

  it('answers 404 for an item this organisation does not have', async () => {
    const { app } = harness();

    const res = await app.request(
      `/bff/v0/inventory/items/${testId(999)}/stock?facilityId=${DEMO_FACILITY_A}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(404);
  });

  it('answers 404 for a site this organisation does not have', async () => {
    const { app } = harness();

    const res = await app.request(
      `/bff/v0/inventory/items/${ITEM_CAPSULE}/stock?facilityId=${testId(998)}`,
      { headers: bearer(TOKENS.adminA) }
    );

    expect(res.status).toBe(404);
  });

  it('answers 400 for an id that is not a uuid', async () => {
    const { app } = harness();

    const res = await app.request(
      `/bff/v0/inventory/items/not-a-uuid/stock?facilityId=${DEMO_FACILITY_A}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(400);
  });
});

describe('the reports the stockroom runs', () => {
  it('lists the cartons at a site, soonest to expire first', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-LONG', 10, { expiresOn: '2027-12-01' }));
    await postOk(app, 'receipts', delivery('LOT-SHORT', 10, { expiresOn: '2026-09-01' }));

    const res = await app.request(
      `/bff/v0/inventory/lots?facilityId=${DEMO_FACILITY_A}&itemId=${ITEM_CAPSULE}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { lotNumber: string }[]; page: { total: number } };
    expect(body.data.map((lot) => lot.lotNumber)).toEqual(['LOT-SHORT', 'LOT-LONG']);
    expect(body.page.total).toBe(2);
  });

  it('narrows the carton list to a window on the expiry date', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-LONG', 10, { expiresOn: '2027-12-01' }));
    await postOk(app, 'receipts', delivery('LOT-SHORT', 10, { expiresOn: '2026-09-01' }));
    await postOk(app, 'receipts', delivery('LOT-NEVER', 10));

    const res = await app.request(
      `/bff/v0/inventory/lots?facilityId=${DEMO_FACILITY_A}&expiringBefore=2026-10-01&status=AVAILABLE&lotNumber=LOT-SHORT&sort=lotNumber`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    const body = (await res.json()) as { data: { lotNumber: string }[] };
    expect(body.data.map((lot) => lot.lotNumber)).toEqual(['LOT-SHORT']);
  });

  it('drops an expiring carton that is already empty, because it is not work', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-SOON', 10, { expiresOn: '2026-08-25' }));
    await postOk(app, 'receipts', delivery('LOT-EMPTY', 10, { expiresOn: '2026-08-26' }));
    const stock = await stockOf(app, ITEM_CAPSULE);
    const empty = stock.lots.find((lot) => lot.lotNumber === 'LOT-EMPTY')?.lotId ?? '';
    await postOk(app, 'wastages', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      lotId: empty,
      quantity: 10,
      reason: 'cold-chain excursion',
    });

    const res = await app.request(
      `/bff/v0/inventory/expiring?facilityId=${DEMO_FACILITY_A}&asOf=${TODAY}&days=30&itemId=${ITEM_CAPSULE}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      asOf: string;
      through: string;
      data: { lotNumber: string; onHand: number }[];
    };
    expect(body.through).toBe('2026-09-16');
    expect(body.data.map((lot) => lot.lotNumber)).toEqual(['LOT-SOON']);
  });

  /**
   * With no `asOf` the report is taken as of today at the facility's own
   * timezone. The fixture's dates are far enough out that the answer does not
   * depend on which day the suite runs.
   */
  it('takes today from the facility when the caller names no date', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 10, { expiresOn: '2099-01-01' }));

    const res = await app.request(`/bff/v0/inventory/expiring?facilityId=${DEMO_FACILITY_A}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    const body = (await res.json()) as { asOf: string; data: unknown[] };
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    // Nothing expires within thirty days of any day this suite could run on.
    expect(body.data).toEqual([]);
  });

  /**
   * The gap between physical and usable stock is the finding. An item with a
   * hundred units in an expired carton reads as full on a stock report and can
   * supply nobody.
   */
  it('judges the reorder report against usable stock, not physical stock', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'StockLot', lotRow({ expiresOn: new Date('2026-07-01T00:00:00.000Z') }));
    seed(dataset, 'StockMovement', movementRow({ quantity: 100 }));

    const res = await app.request(
      `/bff/v0/inventory/reorder?facilityId=${DEMO_FACILITY_A}&asOf=${TODAY}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data).toEqual([
      {
        itemId: ITEM_CAPSULE,
        sku: 'AMOX-500',
        name: 'Amoxicillin 500 mg capsule',
        unit: 'capsule',
        reorderLevel: 50,
        // A hundred capsules on the shelf and none of them usable, because the
        // carton expired in July. A reorder decision made on `onHand` would
        // suppress the replenishment precisely when the shelf is empty.
        onHand: 100,
        usable: 0,
      },
      {
        itemId: ITEM_PATCH,
        sku: 'FENT-25',
        name: 'Fentanyl 25 mcg patch',
        unit: 'patch',
        reorderLevel: 5,
        onHand: 0,
        usable: 0,
      },
    ]);
  });

  it('leaves out an item that is stocked above its level', async () => {
    const { app } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 200));

    const res = await app.request(
      `/bff/v0/inventory/reorder?facilityId=${DEMO_FACILITY_A}&asOf=${TODAY}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    const body = (await res.json()) as { data: { sku: string }[] };
    expect(body.data.map((entry) => entry.sku)).toEqual(['FENT-25']);
  });
});

describe('the catalogue', () => {
  const draft = {
    sku: 'IBU-200',
    name: 'Ibuprofen 200 mg tablet',
    unit: 'tablet',
    packSize: 100,
    reorderLevel: 30,
  };

  it('records a new item and reads it back', async () => {
    const { app } = harness();

    const created = await app.request('/bff/v0/inventory/items', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({
        ...draft,
        rxnormCode: '310965',
        ndcCode: '00000-0000-01',
        cvxCode: '208',
        controlled: false,
        controlledSchedule: '4',
        active: true,
      }),
    });

    expect(created.status).toBe(201);
    const item = (await created.json()) as { id: string; sku: string; active: boolean };
    expect(item.active).toBe(true);

    const read = await app.request(`/bff/v0/inventory/items/${item.id}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { sku: string }).sku).toBe('IBU-200');
  });

  it('refuses a second item with the same catalogue code', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/inventory/items', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ ...draft, sku: 'AMOX-500' }),
    });

    expect(res.status).toBe(409);
  });

  it('refuses a unit this system cannot count in', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/inventory/items', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ ...draft, unit: 'box' }),
    });

    expect(res.status).toBe(422);
  });

  /**
   * The unit is what every quantity already in the ledger means, and the sku is
   * what the practice orders against. The patch schema is strict, so sending
   * either is refused rather than dropped - a client that believed a unit change
   * had been applied would go on reading the same numbers as something else.
   */
  it('refuses to amend the unit or the catalogue code', async () => {
    const { app } = harness();

    for (const patch of [{ unit: 'tablet' }, { sku: 'AMOX-501' }]) {
      const res = await app.request(`/bff/v0/inventory/items/${ITEM_CAPSULE}`, {
        method: 'PATCH',
        headers: jsonBearer(TOKENS.clinicianA),
        body: JSON.stringify(patch),
      });
      expect(res.status, JSON.stringify(patch)).toBe(422);
    }
  });

  it('amends what an item may change', async () => {
    const { app } = harness();

    const res = await app.request(`/bff/v0/inventory/items/${ITEM_CAPSULE}`, {
      method: 'PATCH',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ reorderLevel: 10, active: false }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { reorderLevel: number }).toMatchObject({
      reorderLevel: 10,
      active: false,
    });
  });

  it('searches the catalogue by code and by name, folded', async () => {
    const { app } = harness();

    const res = await app.request(
      '/bff/v0/inventory/items?q=amox&active=true&controlled=false&unit=capsule&sort=sku',
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sku: string }[] };
    expect(body.data.map((item) => item.sku)).toEqual(['AMOX-500']);
  });

  it('lists the whole catalogue by name when the caller filters nothing', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/inventory/items', {
      headers: bearer(TOKENS.clinicianA),
    });

    const body = (await res.json()) as { data: { sku: string }[] };
    expect(body.data.map((item) => item.sku)).toEqual(['AMOX-500', 'FENT-25', 'LIDO-1']);
  });

  it('finds the controlled half of the catalogue on its own', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/inventory/items?controlled=true&active=false', {
      headers: bearer(TOKENS.clinicianA),
    });

    const body = (await res.json()) as { data: unknown[] };
    // Controlled, but none of them retired: the two filters are ANDed, not ORed.
    expect(body.data).toEqual([]);
  });

  /**
   * `/inventory/items/:id` is registered after `/inventory/items/:id/stock`, and
   * getting that order wrong is a wrong-handler 200 rather than a startup error.
   */
  it('does not let the item route swallow the balance route', async () => {
    const { app } = harness();

    const stock = await stockOf(app, ITEM_CAPSULE);

    expect(stock).toHaveProperty('usable');
  });
});

describe('who may touch it', () => {
  const READ = `/bff/v0/inventory/items/${ITEM_CAPSULE}/stock?facilityId=${DEMO_FACILITY_A}`;

  it('refuses a request with no token', async () => {
    const { app } = harness();

    expect((await app.request(READ)).status).toBe(401);
    expect(
      (
        await app.request('/bff/v0/inventory/receipts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(delivery('LOT-A', 1)),
        })
      ).status
    ).toBe(401);
  });

  it('refuses a role holding no inventory grant at all', async () => {
    const { app } = harness();

    expect((await app.request(READ, { headers: bearer(TOKENS.billerA) })).status).toBe(403);
    expect((await post(app, 'receipts', delivery('LOT-A', 1), TOKENS.billerA)).status).toBe(403);
  });

  /**
   * The separation the whole `inventory.adjust` permission exists for: the
   * person who dispenses is not the person who reconciles the difference away.
   */
  it('refuses a clinician the cycle count while letting them dispense', async () => {
    const { app } = harness();

    const res = await post(app, 'counts', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      reason: 'monthly cycle count',
      lines: [{ lotId: LOT_OLD, counted: 1 }],
    });

    expect(res.status).toBe(403);
  });

  it('lets the front desk read the shelf and not book anything in', async () => {
    const { app } = harness();

    expect((await app.request(READ, { headers: bearer(TOKENS.frontDeskA) })).status).toBe(200);
    expect((await post(app, 'receipts', delivery('LOT-A', 1), TOKENS.frontDeskA)).status).toBe(403);
  });

  /**
   * A patient-scoped token is refused outright. Every inventory spec is
   * `compartment: 'closed'`, which narrows the reads, but neither storage
   * implementation consults it on a create - so the write path needs its own
   * refusal rather than relying on no role bundle granting the permission.
   */
  it('refuses a patient-scoped token the stockroom entirely', async () => {
    const { app } = harness();

    expect(
      (await post(app, 'receipts', delivery('LOT-A', 1), TOKENS.compartmentAdminA)).status
    ).toBe(403);
    expect((await app.request(READ, { headers: bearer(TOKENS.compartmentAdminA) })).status).toBe(
      404
    );
  });

  /**
   * 404 rather than 403, because a 403 confirms the id exists and turns the API
   * into a cross-tenant enumeration oracle for another practice's catalogue.
   */
  it("reads another organisation's item as absent, never as forbidden", async () => {
    const { app } = harness();

    const res = await app.request(
      `/bff/v0/inventory/items/${ITEM_CAPSULE}/stock?facilityId=${DEMO_FACILITY_B}`,
      { headers: bearer(TOKENS.adminB) }
    );

    expect(res.status).toBe(404);
  });

  it('refuses a site the principal holds no grant for', async () => {
    const { app } = harness();

    const res = await app.request(
      `/bff/v0/inventory/items/${ITEM_CAPSULE}/stock?facilityId=${DEMO_FACILITY_B}`,
      { headers: bearer(TOKENS.clinicianA) }
    );

    expect(res.status).toBe(403);
  });

  it('refuses a write against a site the principal holds no grant for', async () => {
    const { app } = harness();

    const res = await post(app, 'receipts', {
      ...delivery('LOT-A', 1),
      facilityId: DEMO_FACILITY_B,
    });

    expect(res.status).toBe(403);
  });

  /**
   * The rule with the sharpest failure mode in this repository, per
   * `apps/api/AGENTS.md`: any field naming who did something comes from the
   * verified principal, and a body that carries one is refused rather than
   * ignored - because ignoring it silently is how a caller comes to believe it
   * was honoured.
   */
  it('takes who posted the act from the token, and refuses a body that names one', async () => {
    const { app, dataset } = harness();

    const posting = await postOk(app, 'receipts', delivery('LOT-A', 1));

    expect(posting.postedById).toBe(CLINICIAN_A);
    expect(dataset.table('StockMovement').at(-1)?.actorId).toBe(CLINICIAN_A);

    const refused = await post(app, 'receipts', {
      ...delivery('LOT-A', 1),
      postedById: testId(1),
    });
    expect(refused.status).toBe(422);
  });

  it('keeps the ledger inside the organisation that wrote it', async () => {
    const { app, dataset } = harness();
    await postOk(app, 'receipts', delivery('LOT-A', 10));

    expect(dataset.table('StockMovement').every((row) => row.tenantId === DEMO_TENANT_A)).toBe(
      true
    );
  });
});

describe('the defects the adversarial review found', () => {
  /**
   * A dispense that moves nothing is worse than a refusal.
   *
   * A quantity below the stock grid rounds to zero, `allocate` takes its
   * `requested <= 0` early return and reports no shortfall, so the route wrote
   * a posting with no movement lines and answered 201 - a DISPENSE stamped on a
   * patient chart that took nothing off the shelf, reading to everyone
   * downstream as a fill that happened.
   */
  it('refuses a dispense whose quantity rounds to nothing', async () => {
    const { app } = harness();

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      quantity: 0.0000001,
    });

    expect(res.status).toBe(422);
  });

  /**
   * Every id on a posting was checked except the two deciding whose record it
   * lands on. Against Postgres an unknown patient is a foreign key violation
   * rendered as a bare 500, and - because the relation references `Patient.id`
   * with no tenant component - another organisation's patient satisfies the
   * constraint and the removal lands on a foreign chart.
   */
  /**
   * The case the route guard exists for, which the schema cannot reach.
   *
   * Each course field is a valid quantity on the grid; their product is not.
   * A millionth of a unit once a day for one day multiplies out to a millionth
   * of a millionth, which rounds to nothing - so the schema passes it and only
   * the route can tell that the dispense would move no stock.
   */
  it('refuses a course whose product rounds to nothing, though each field is valid', async () => {
    const { app } = harness();

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      divisible: true,
      course: { perDose: 0.000001, dosesPerDay: 0.000001, days: 1 },
    });

    expect(res.status).toBe(422);
  });

  it('refuses a dispense filed against a patient that does not exist', async () => {
    const { app } = harness();

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: testId(9999),
      divisible: true,
      quantity: 1,
    });

    expect(res.status).toBe(404);
  });

  it('refuses a dispense whose encounter belongs to another patient', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'Patient', makePatientRow({ id: testId(1010), mrn: 'OR-777777' }));
    const encounter = dataset.table('Encounter').find((row) => row.id === testId(61));
    expect(encounter, 'the fixture seeds the encounter this test repoints').toBeDefined();
    Object.assign(encounter!, { patientId: testId(1010) });

    const res = await post(app, 'dispenses', {
      facilityId: DEMO_FACILITY_A,
      occurredOn: TODAY,
      itemId: ITEM_CAPSULE,
      patientId: PATIENT,
      encounterId: testId(61),
      divisible: true,
      quantity: 1,
    });

    expect(res.status).toBe(400);
  });

  /**
   * A lot named twice on a count sheet is one count entered twice. Each line
   * read the balance before any of this posting's lines were written, so the
   * second line's expected figure did not include the first's variance and the
   * same discrepancy was applied twice - on an append-only ledger, against an
   * audit trail showing two shortfalls that never happened.
   */
  it('refuses a count sheet that names one lot twice', async () => {
    const { app } = harness();

    const res = await post(
      app,
      'counts',
      {
        facilityId: DEMO_FACILITY_A,
        occurredOn: TODAY,
        reason: 'monthly cycle count',
        lines: [
          { lotId: LOT_OLD, counted: 37 },
          { lotId: LOT_OLD, counted: 37 },
        ],
      },
      TOKENS.adminA
    );

    expect(res.status).toBe(422);
  });
});
