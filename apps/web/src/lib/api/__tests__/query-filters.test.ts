import { describe, expect, it } from 'vitest';

import { MOCK_ENCOUNTERS, MOCK_NOTES } from '@/lib/api/mock/records';
import {
  filterAppointments,
  filterEncounters,
  filterNotes,
  filterAuditEvents,
  filterDirectoryUsers,
  filterFacilities,
  filterClaims,
  filterFeeSheets,
  filterPatients,
  filterPayments,
  filterRemittances,
  filterStaffUsers,
  filterStatements,
  filterVisitRows,
  MOCK_APPOINTMENTS,
  MOCK_AUDIT_EVENTS,
  MOCK_CLAIMS,
  MOCK_DIRECTORY_FACILITIES,
  MOCK_DIRECTORY_USERS,
  MOCK_FEE_SHEETS,
  MOCK_PATIENTS,
  MOCK_PAYERS,
  MOCK_PAYMENTS,
  MOCK_REMITTANCES,
  MOCK_STAFF_USERS,
  MOCK_STATEMENT_ACCOUNTS,
  MOCK_VISIT_ROWS,
  totalsFor,
} from '@/lib/api';

/**
 * The query filters, which are the scoping guards the whole product leans on.
 *
 * Every one of these mirrors a filter the API will apply, and every one of them
 * is a place a leak can happen: a `patientId` that is read but not applied puts
 * another patient's ledger on screen, and a date bound that is off by a day puts
 * a claim in the wrong reporting period. They are unit-tested here rather than
 * only through screens because a screen test that happens to render one row
 * cannot tell a working filter from a filter that returned everything.
 */

const [CEDAR_MUTUAL, BIRCHWOOD, NORTHFIELD] = MOCK_PAYERS as [
  (typeof MOCK_PAYERS)[number],
  (typeof MOCK_PAYERS)[number],
  (typeof MOCK_PAYERS)[number],
];
const FACILITY_ONE = '0192f1a0-0000-7000-8000-00000000f001';
const FACILITY_THREE = '0192f1a0-0000-7000-8000-00000000f003';

describe('filterFeeSheets', () => {
  it('returns the whole day when nothing is asked of it', () => {
    expect(filterFeeSheets(MOCK_FEE_SHEETS)).toHaveLength(MOCK_FEE_SHEETS.length);
  });

  it('scopes to one patient, so a fee sheet cannot surface under another chart', () => {
    const target = MOCK_FEE_SHEETS[0]!.patient.id;
    const rows = filterFeeSheets(MOCK_FEE_SHEETS, { patientId: target });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((sheet) => sheet.patient.id === target)).toBe(true);
    expect(rows.length).toBeLessThan(MOCK_FEE_SHEETS.length);
  });

  it('separates the sheets still open from the ones already in the pipeline', () => {
    const open = filterFeeSheets(MOCK_FEE_SHEETS, { status: 'OPEN' });
    const ready = filterFeeSheets(MOCK_FEE_SHEETS, { status: 'READY' });

    expect(open.every((sheet) => sheet.status === 'OPEN')).toBe(true);
    expect(ready.every((sheet) => sheet.status === 'READY')).toBe(true);
    expect(open.length + ready.length).toBe(MOCK_FEE_SHEETS.length);
  });

  it('matches a service date by calendar day rather than by exact timestamp', () => {
    const day = MOCK_FEE_SHEETS[0]!.serviceDate.slice(0, 10);

    expect(filterFeeSheets(MOCK_FEE_SHEETS, { serviceDate: day })).toHaveLength(
      MOCK_FEE_SHEETS.length
    );
    expect(filterFeeSheets(MOCK_FEE_SHEETS, { serviceDate: '1999-01-01' })).toHaveLength(0);
  });
});

describe('filterClaims', () => {
  it('scopes to one payer and to one patient independently', () => {
    const byPayer = filterClaims(MOCK_CLAIMS, { payerId: BIRCHWOOD.id });
    expect(byPayer.length).toBeGreaterThan(0);
    expect(byPayer.every((claim) => claim.payer.id === BIRCHWOOD.id)).toBe(true);

    const patientId = MOCK_CLAIMS[0]!.patient.id;
    const byPatient = filterClaims(MOCK_CLAIMS, { patientId });
    expect(byPatient.every((claim) => claim.patient.id === patientId)).toBe(true);
  });

  it('narrows to a single state, which is how the workbench queues work', () => {
    const denied = filterClaims(MOCK_CLAIMS, { status: 'DENIED' });

    expect(denied.length).toBeGreaterThan(0);
    expect(denied.every((claim) => claim.status === 'DENIED')).toBe(true);
  });

  it('searches claim number, patient name and MRN with one box', () => {
    expect(filterClaims(MOCK_CLAIMS, { q: 'CLM-24062' })).toHaveLength(1);
    expect(filterClaims(MOCK_CLAIMS, { q: 'stubbins' })[0]!.patient.name.family).toBe('Stubbins');
    expect(filterClaims(MOCK_CLAIMS, { q: 'OR-100517' })[0]!.patient.mrn).toBe('OR-100517');
    // Whitespace around a pasted MRN is the normal case, not the exception.
    expect(filterClaims(MOCK_CLAIMS, { q: '  or-100517  ' })[0]!.patient.mrn).toBe('OR-100517');
    expect(filterClaims(MOCK_CLAIMS, { q: 'no such claim' })).toHaveLength(0);
  });

  it('sorts by the column asked for, in the direction asked for', () => {
    const billedUp = filterClaims(MOCK_CLAIMS, { sort: 'billed' });
    const billedDown = filterClaims(MOCK_CLAIMS, { sort: 'billed', order: 'desc' });
    expect(billedUp[0]!.billed).toBeLessThanOrEqual(billedUp.at(-1)!.billed);
    expect(billedDown[0]!.billed).toBe(billedUp.at(-1)!.billed);

    const byService = filterClaims(MOCK_CLAIMS, { sort: 'serviceDate' });
    expect(byService[0]!.serviceDate <= byService.at(-1)!.serviceDate).toBe(true);

    // The default is how long a claim has sat in its current state, oldest
    // first, because that is the queue a biller works down.
    const bySince = filterClaims(MOCK_CLAIMS);
    expect(bySince[0]!.statusSince <= bySince.at(-1)!.statusSince).toBe(true);
  });

  it('leaves the source array untouched while sorting', () => {
    const before = MOCK_CLAIMS.map((claim) => claim.claimNumber);
    filterClaims(MOCK_CLAIMS, { sort: 'billed', order: 'desc' });

    expect(MOCK_CLAIMS.map((claim) => claim.claimNumber)).toEqual(before);
  });
});

describe('filterRemittances', () => {
  it('scopes to a payer and to a posting state', () => {
    expect(filterRemittances(MOCK_REMITTANCES, { payerId: CEDAR_MUTUAL.id })).toHaveLength(1);
    expect(filterRemittances(MOCK_REMITTANCES, { status: 'POSTED' })).toHaveLength(1);
    expect(
      filterRemittances(MOCK_REMITTANCES, { payerId: NORTHFIELD.id, status: 'POSTED' })
    ).toHaveLength(0);
    expect(filterRemittances(MOCK_REMITTANCES)).toHaveLength(MOCK_REMITTANCES.length);
  });
});

describe('filterStatements', () => {
  it('narrows by ageing bucket and by how far dunning has gone', () => {
    const overdue = filterStatements(MOCK_STATEMENT_ACCOUNTS, { bucket: 'DAYS_31_60' });
    expect(overdue.length).toBeGreaterThan(1);
    expect(overdue.every((account) => account.bucket === 'DAYS_31_60')).toBe(true);

    expect(
      filterStatements(MOCK_STATEMENT_ACCOUNTS, { dunningStage: 'FINAL_NOTICE' })
    ).toHaveLength(1);
  });

  it('skips balances too small to be worth a stamp', () => {
    const worthChasing = filterStatements(MOCK_STATEMENT_ACCOUNTS, { minBalance: 50 });

    expect(worthChasing.every((account) => account.balance >= 50)).toBe(true);
    expect(worthChasing.length).toBeLessThan(MOCK_STATEMENT_ACCOUNTS.length);
    // The bound is inclusive: an account sitting exactly on it is still chased.
    expect(filterStatements(MOCK_STATEMENT_ACCOUNTS, { minBalance: 60 })).toHaveLength(3);
  });

  it('finds an account by the name the patient is called, not only the legal one', () => {
    // "Tess" is the preferred name; "Testina" is the legal given name. A biller
    // who only ever hears "Tess" has to be able to find the account.
    expect(filterStatements(MOCK_STATEMENT_ACCOUNTS, { q: 'tess' })[0]!.patient.mrn).toBe(
      'OR-100482'
    );
    expect(filterStatements(MOCK_STATEMENT_ACCOUNTS, { q: 'OR-100866' })[0]!.balance).toBe(310);
    expect(filterStatements(MOCK_STATEMENT_ACCOUNTS, { q: 'nobody' })).toHaveLength(0);
  });
});

describe('filterPayments', () => {
  it('scopes to one patient, so a receipt never lands on the wrong ledger', () => {
    const patientId = MOCK_PAYMENTS[0]!.patient.id;
    const rows = filterPayments(MOCK_PAYMENTS, { patientId });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patient.id).toBe(patientId);
  });

  it('narrows by tender, which is what a drawer reconciliation asks for', () => {
    expect(filterPayments(MOCK_PAYMENTS, { method: 'CASH' })).toHaveLength(1);
    expect(filterPayments(MOCK_PAYMENTS, { method: 'CHECK' })).toHaveLength(2);
    expect(filterPayments(MOCK_PAYMENTS, { method: 'CARD_ON_FILE' })).toHaveLength(2);
  });

  it('searches by receipt number and by patient name', () => {
    expect(filterPayments(MOCK_PAYMENTS, { q: 'RCP-70408' })[0]!.method.kind).toBe('CASH');
    expect(filterPayments(MOCK_PAYMENTS, { q: 'mockford' })[0]!.receiptNumber).toBe('RCP-70386');
    expect(filterPayments(MOCK_PAYMENTS, { q: 'RCP-00000' })).toHaveLength(0);
  });
});

describe('filterStaffUsers', () => {
  it('searches the legal name, the display name and the sign-in address', () => {
    expect(filterStaffUsers(MOCK_STAFF_USERS, { q: 'ada okafor' })).toHaveLength(1);
    // "Dr. Okafor" is the display name, which is the only form on the schedule.
    expect(filterStaffUsers(MOCK_STAFF_USERS, { q: 'dr. lindqvist' })).toHaveLength(1);
    expect(filterStaffUsers(MOCK_STAFF_USERS, { q: 'n.farkas@' })).toHaveLength(1);
    expect(filterStaffUsers(MOCK_STAFF_USERS, { q: 'nobody' })).toHaveLength(0);
  });

  it('matches a role anywhere in the list, not only the first one held', () => {
    const billers = filterStaffUsers(MOCK_STAFF_USERS, { role: 'BILLER' });

    expect(billers.map((user) => user.name)).toContain('Nils Farkas');
    expect(billers.every((user) => user.roles.includes('BILLER'))).toBe(true);
  });

  it('keeps deactivated and invited accounts out of the active list', () => {
    const active = filterStaffUsers(MOCK_STAFF_USERS, { status: 'ACTIVE' });

    expect(active.every((user) => user.status === 'ACTIVE')).toBe(true);
    expect(active.map((user) => user.name)).not.toContain('Wren Castellanos');
    expect(filterStaffUsers(MOCK_STAFF_USERS, { status: 'INVITED' })).toHaveLength(1);
  });

  it('scopes to a facility, which is the multi-site access boundary', () => {
    const atThird = filterStaffUsers(MOCK_STAFF_USERS, { facilityId: FACILITY_THREE });

    expect(atThird.map((user) => user.name)).toEqual(['Nils Farkas']);
    expect(filterStaffUsers(MOCK_STAFF_USERS, { facilityId: FACILITY_ONE }).length).toBeGreaterThan(
      atThird.length
    );
  });

  it('applies every clause together rather than the last one given', () => {
    expect(
      filterStaffUsers(MOCK_STAFF_USERS, {
        role: 'BILLER',
        status: 'ACTIVE',
        facilityId: FACILITY_THREE,
      }).map((user) => user.name)
    ).toEqual(['Nils Farkas']);
  });
});

describe('filterAuditEvents', () => {
  it('answers who, what and why as separate questions', () => {
    const actorId = MOCK_AUDIT_EVENTS[0]!.actorId;
    const byActor = filterAuditEvents(MOCK_AUDIT_EVENTS, { actorId });
    expect(byActor.length).toBeGreaterThan(0);
    expect(byActor.length).toBeLessThan(MOCK_AUDIT_EVENTS.length);
    expect(byActor.every((event) => event.actorId === actorId)).toBe(true);

    const signs = filterAuditEvents(MOCK_AUDIT_EVENTS, { action: 'NOTE_SIGN' });
    expect(signs.length).toBeGreaterThan(0);
    expect(signs.every((event) => event.action === 'NOTE_SIGN')).toBe(true);

    const payment = filterAuditEvents(MOCK_AUDIT_EVENTS, { purposeOfUse: 'PAYMENT' });
    expect(payment.every((event) => event.purposeOfUse === 'PAYMENT')).toBe(true);
  });

  it('isolates break-glass access, the one read that always needs a reason', () => {
    const breakglass = filterAuditEvents(MOCK_AUDIT_EVENTS, { breakglassOnly: true });

    expect(breakglass).toHaveLength(1);
    expect(breakglass[0]!.breakglass).toBe(true);
    expect(breakglass[0]!.breakglassReason).toBeTruthy();
  });

  it('finds every touch of one chart, however the MRN was typed', () => {
    const upper = filterAuditEvents(MOCK_AUDIT_EVENTS, { patientMrn: 'OR-100482' });
    expect(upper.length).toBeGreaterThan(0);
    expect(upper.every((event) => event.patientMrn === 'OR-100482')).toBe(true);
    expect(filterAuditEvents(MOCK_AUDIT_EVENTS, { patientMrn: '  or-100482 ' })).toEqual(upper);

    // Events with no patient (a failed sign-in) must not be swept into a
    // patient's access history just because they have no MRN to compare.
    expect(upper.every((event) => event.patientMrn !== null)).toBe(true);
  });

  it('bounds the window at both ends, inclusively on each', () => {
    const onlyLatest = filterAuditEvents(MOCK_AUDIT_EVENTS, { from: '2026-08-12' });
    expect(onlyLatest.every((event) => event.occurredAt.slice(0, 10) >= '2026-08-12')).toBe(true);
    expect(onlyLatest.length).toBeLessThan(MOCK_AUDIT_EVENTS.length);

    const onlyEarliest = filterAuditEvents(MOCK_AUDIT_EVENTS, { to: '2026-08-11' });
    expect(onlyEarliest.every((event) => event.occurredAt.slice(0, 10) <= '2026-08-11')).toBe(true);

    expect(
      filterAuditEvents(MOCK_AUDIT_EVENTS, { from: '2026-08-11', to: '2026-08-12' })
    ).toHaveLength(MOCK_AUDIT_EVENTS.length);
    expect(filterAuditEvents(MOCK_AUDIT_EVENTS, { from: '2030-01-01' })).toHaveLength(0);
  });
});

describe('filterVisitRows and totalsFor', () => {
  it('narrows the report by date, provider, status and visit type', () => {
    const oneDay = filterVisitRows(MOCK_VISIT_ROWS, { from: '2026-08-12', to: '2026-08-12' });
    expect(oneDay.length).toBeGreaterThan(0);
    expect(oneDay.every((row) => row.date === '2026-08-12')).toBe(true);

    const provider = MOCK_VISIT_ROWS[0]!.providerId;
    expect(
      filterVisitRows(MOCK_VISIT_ROWS, { providerId: provider }).every(
        (row) => row.providerId === provider
      )
    ).toBe(true);

    expect(
      filterVisitRows(MOCK_VISIT_ROWS, { status: 'NOSHOW' }).every((row) => row.status === 'NOSHOW')
    ).toBe(true);

    expect(
      filterVisitRows(MOCK_VISIT_ROWS, { visitType: 'Telehealth' }).every(
        (row) => row.visitType === 'Telehealth'
      )
    ).toBe(true);
  });

  it('totals the filtered set, not the whole table', () => {
    const all = totalsFor(MOCK_VISIT_ROWS);
    const oneDay = filterVisitRows(MOCK_VISIT_ROWS, { from: '2026-08-12', to: '2026-08-12' });
    const dayTotals = totalsFor(oneDay);

    expect(all.visits).toBe(MOCK_VISIT_ROWS.length);
    expect(dayTotals.visits).toBe(oneDay.length);
    expect(dayTotals.visits).toBeLessThan(all.visits);
    expect(dayTotals.charges).toBeLessThan(all.charges);
    expect(dayTotals.minutes).toBe(oneDay.reduce((sum, row) => sum + row.durationMinutes, 0));
  });

  it('keeps money exact instead of accumulating float dust', () => {
    const charges = totalsFor(MOCK_VISIT_ROWS).charges;

    expect(Number(charges.toFixed(2))).toBe(charges);
    expect(totalsFor([])).toEqual({ visits: 0, minutes: 0, charges: 0 });
  });
});

describe('filterPatients, the clauses the chart search leans on', () => {
  it('matches an exact MRN and an exact birth date', () => {
    const target = MOCK_PATIENTS[0]!;

    expect(filterPatients(MOCK_PATIENTS, { mrn: target.mrn })).toHaveLength(1);
    // Exact, not prefix: a partial MRN must not open the wrong chart.
    expect(filterPatients(MOCK_PATIENTS, { mrn: target.mrn.slice(0, 6) })).toHaveLength(0);

    const sameBirthDate = filterPatients(MOCK_PATIENTS, { birthDate: target.birthDate });
    expect(sameBirthDate.every((patient) => patient.birthDate === target.birthDate)).toBe(true);
  });

  it('sorts by birth date and by when the record was created', () => {
    const byBirth = filterPatients(MOCK_PATIENTS, { sort: 'birthDate' });
    expect(byBirth[0]!.birthDate <= byBirth.at(-1)!.birthDate).toBe(true);

    const newestFirst = filterPatients(MOCK_PATIENTS, { sort: 'createdAt', order: 'desc' });
    expect(newestFirst[0]!.createdAt >= newestFirst.at(-1)!.createdAt).toBe(true);
  });
});

describe('filterAppointments, the clauses the day views lean on', () => {
  it('scopes a day to one provider, one patient and one facility', () => {
    const sample = MOCK_APPOINTMENTS[0]!;

    expect(
      filterAppointments(MOCK_APPOINTMENTS, { providerId: sample.providerId }).every(
        (appointment) => appointment.providerId === sample.providerId
      )
    ).toBe(true);

    const forPatient = filterAppointments(MOCK_APPOINTMENTS, {
      patientId: sample.patientId ?? undefined,
    });
    expect(forPatient.length).toBeGreaterThan(0);
    expect(forPatient.every((appointment) => appointment.patientId === sample.patientId)).toBe(
      true
    );

    expect(filterAppointments(MOCK_APPOINTMENTS, { facilityId: 'no-such-facility' })).toHaveLength(
      0
    );
  });

  it('sorts by start time by default and by creation order on request', () => {
    const byStart = filterAppointments(MOCK_APPOINTMENTS);
    expect(byStart[0]!.start <= byStart.at(-1)!.start).toBe(true);

    const latestBookedFirst = filterAppointments(MOCK_APPOINTMENTS, {
      sort: 'createdAt',
      order: 'desc',
    });
    expect(latestBookedFirst[0]!.createdAt >= latestBookedFirst.at(-1)!.createdAt).toBe(true);
  });
});

/**
 * The directory filters.
 *
 * They matter for the same reason the rest of this file does, and for one more:
 * these two lists are where the ids a booking is written with come from. A
 * provider picker that ignored `isProvider` would offer the receptionist as a
 * clinician, and the booking that followed would name a user the API will not
 * accept as a provider.
 */
describe('filterFacilities', () => {
  const ANNEX = {
    ...(MOCK_DIRECTORY_FACILITIES[0] as (typeof MOCK_DIRECTORY_FACILITIES)[number]),
    id: 'f-closed',
    name: 'Birchwood Annex',
    code: 'BIRCH',
    active: false,
  };
  const rows = [...MOCK_DIRECTORY_FACILITIES, ANNEX];

  it('drops a closed site, which is not somewhere anyone can be booked', () => {
    expect(filterFacilities(rows, { active: true }).map((row) => row.id)).not.toContain('f-closed');
  });

  it('keeps a closed site when nothing was asked about status', () => {
    expect(filterFacilities(rows)).toHaveLength(rows.length);
  });

  it('searches the name and the short code, which is what is on the door', () => {
    expect(filterFacilities(rows, { q: 'birch' }).map((row) => row.id)).toEqual(['f-closed']);
    expect(filterFacilities(rows, { q: 'CEDAR' })).toHaveLength(1);
  });

  it('sorts by name by default, and by code or creation when asked', () => {
    expect(filterFacilities(rows).map((row) => row.name)).toEqual([
      'Birchwood Annex',
      'Cedar Clinic',
    ]);
    expect(filterFacilities(rows, { sort: 'code' }).map((row) => row.code)).toEqual([
      'BIRCH',
      'CEDAR',
    ]);
    expect(filterFacilities(rows, { sort: 'createdAt', order: 'desc' })).toHaveLength(2);
  });
});

describe('filterDirectoryUsers', () => {
  it('answers the clinician picker with clinicians only', () => {
    const picked = filterDirectoryUsers(MOCK_DIRECTORY_USERS, { isProvider: true });

    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((row) => row.isProvider)).toBe(true);
    // The fixture directory holds a front-desk account, so this is a real cut
    // rather than a filter that happened to match everything.
    expect(picked.length).toBeLessThan(MOCK_DIRECTORY_USERS.length);
  });

  it('answers the inverse cut as well, so the flag is applied and not merely read', () => {
    const staff = filterDirectoryUsers(MOCK_DIRECTORY_USERS, { isProvider: false });
    expect(staff.every((row) => !row.isProvider)).toBe(true);
  });

  it('drops an account that is no longer active', () => {
    const leaver = { ...(MOCK_DIRECTORY_USERS[0] as (typeof MOCK_DIRECTORY_USERS)[number]) };
    const rows = [
      { ...leaver, id: 'u-gone', status: 'DEACTIVATED' as const },
      ...MOCK_DIRECTORY_USERS,
    ];

    expect(filterDirectoryUsers(rows, { status: 'ACTIVE' }).map((row) => row.id)).not.toContain(
      'u-gone'
    );
  });

  it('searches given name, family name and email', () => {
    expect(filterDirectoryUsers(MOCK_DIRECTORY_USERS, { q: 'lindqvist' })).toHaveLength(1);
    expect(filterDirectoryUsers(MOCK_DIRECTORY_USERS, { q: 'ada' })).toHaveLength(1);
    expect(filterDirectoryUsers(MOCK_DIRECTORY_USERS, { q: 'r.mbeki@' })).toHaveLength(1);
    expect(filterDirectoryUsers(MOCK_DIRECTORY_USERS, { q: 'nobody here' })).toHaveLength(0);
  });

  it('sorts by family name by default, and by email or creation when asked', () => {
    expect(filterDirectoryUsers(MOCK_DIRECTORY_USERS).map((row) => row.familyName)).toEqual([
      'Lindqvist',
      'Mbeki',
      'Okafor',
    ]);
    expect(
      filterDirectoryUsers(MOCK_DIRECTORY_USERS, { sort: 'email', order: 'desc' })[0]?.email
    ).toBe('r.mbeki@cedar.clinic.invalid');
    expect(filterDirectoryUsers(MOCK_DIRECTORY_USERS, { sort: 'createdAt' })).toHaveLength(3);
  });
});

/**
 * `filterEncounters` and `filterNotes` were the two filters in this file's
 * subject that nothing had ever queried, so every clause on them was read but
 * never applied. Writing these found the two of them defaulting to descending
 * while the four beside them, and `sortOrderField` in the API's own pagination
 * schema, default to ascending. That is now aligned, which is also what makes
 * the signature sort agree with the comment above it.
 */

/* A second site, so a facility filter has something to separate. Every fixture
   visit is at one clinic, and a filter that returns none or all is satisfied by
   one that compares the wrong field. */
const OTHER_FACILITY = 'facility-that-is-not-cedar';
const VISITS = MOCK_ENCOUNTERS.map((visit, index) =>
  index === 0 ? { ...visit, facilityId: OTHER_FACILITY } : visit
);

describe('filterEncounters', () => {
  it('returns every visit oldest first when nothing is asked of it', () => {
    const all = filterEncounters(MOCK_ENCOUNTERS);

    expect(all).toHaveLength(MOCK_ENCOUNTERS.length);
    const startedAt = all.map((visit) => visit.startedAt);
    expect(startedAt).toEqual([...startedAt].sort());
  });

  it('scopes to a facility, so a visit cannot surface under another site', () => {
    const moved = VISITS[0];
    expect(moved).toBeDefined();
    if (moved === undefined) return;

    expect(filterEncounters(VISITS, { facilityId: OTHER_FACILITY })).toEqual([moved]);
    expect(filterEncounters(VISITS, { facilityId: moved.facilityId })).toHaveLength(1);
    expect(filterEncounters(VISITS, { facilityId: 'nowhere' })).toHaveLength(0);
  });

  it('scopes to a provider and to a status independently', () => {
    const provider = MOCK_ENCOUNTERS[0]?.providerId;
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    const theirs = filterEncounters(MOCK_ENCOUNTERS, { providerId: provider });
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.length).toBeLessThan(MOCK_ENCOUNTERS.length);
    expect(theirs.every((visit) => visit.providerId === provider)).toBe(true);

    const open = filterEncounters(MOCK_ENCOUNTERS, { status: 'IN_PROGRESS' });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((visit) => visit.status === 'IN_PROGRESS')).toBe(true);
    expect(open.length).toBeLessThan(MOCK_ENCOUNTERS.length);
  });

  it('takes the window from inclusively and to exclusively', () => {
    /*
     * The asymmetry is the point, and it is what lets consecutive windows tile
     * a day without a visit landing in two of them or in neither. `from` uses
     * `<` to reject and `to` uses `>=`, so a visit starting exactly at `from`
     * is kept and one starting exactly at `to` belongs to the next window.
     */
    const second = MOCK_ENCOUNTERS[1];
    expect(second).toBeDefined();
    if (second === undefined) return;

    const fromItsStart = filterEncounters(MOCK_ENCOUNTERS, { from: second.startedAt });
    expect(fromItsStart.map((visit) => visit.id)).toContain(second.id);

    const toItsStart = filterEncounters(MOCK_ENCOUNTERS, { to: second.startedAt });
    expect(toItsStart.map((visit) => visit.id)).not.toContain(second.id);

    /* And together they tile: no visit in both halves, none in neither. */
    expect(fromItsStart.length + toItsStart.length).toBe(MOCK_ENCOUNTERS.length);
  });

  it('reverses on request', () => {
    const ascending = filterEncounters(MOCK_ENCOUNTERS, {});
    const descending = filterEncounters(MOCK_ENCOUNTERS, { order: 'desc' });

    expect(descending.map((visit) => visit.id)).toEqual(
      [...ascending].reverse().map((visit) => visit.id)
    );
  });
});

describe('filterNotes', () => {
  it('returns every note oldest first when nothing is asked of it', () => {
    const all = filterNotes(MOCK_NOTES);

    expect(all).toHaveLength(MOCK_NOTES.length);
    const createdAt = all.map((note) => note.createdAt);
    expect(createdAt).toEqual([...createdAt].sort());
  });

  it('scopes to a visit, to an author and to a state independently', () => {
    const first = MOCK_NOTES[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    expect(filterNotes(MOCK_NOTES, { encounterId: first.encounterId })).toEqual([first]);

    const theirs = filterNotes(MOCK_NOTES, { authorId: first.authorId });
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((note) => note.authorId === first.authorId)).toBe(true);
    expect(theirs.length).toBeLessThan(MOCK_NOTES.length);

    const unsigned = filterNotes(MOCK_NOTES, { state: 'UNSIGNED' });
    expect(unsigned.length).toBeGreaterThan(0);
    expect(unsigned.every((note) => note.state === 'UNSIGNED')).toBe(true);
  });

  it('sorts by signature with the unsigned notes last, and first when reversed', () => {
    /*
     * A note with no signature has no value to sort on, and the sentinel it is
     * given has to put it at the end of an ascending sort rather than at the
     * start: `signedAt` sorted ascending is a completion order, and a note that
     * was never completed comes after every note that was. The API agrees, by
     * way of `signedAt?.getTime() ?? POSITIVE_INFINITY` in its own spec.
     *
     * Reversing has to carry the unsigned notes with it. A sentinel applied
     * before the direction, as here, does; one applied after would pin them to
     * the same end in both directions, and the board chasing missing
     * signatures is the one that asks for the reversed order.
     */
    const signedFirst = filterNotes(MOCK_NOTES, { sort: 'signedAt' });
    const unsignedCount = MOCK_NOTES.filter((note) => note.signedAt === null).length;
    expect(unsignedCount).toBeGreaterThan(0);

    const tail = signedFirst.slice(-unsignedCount);
    expect(tail.every((note) => note.signedAt === null)).toBe(true);
    expect(signedFirst.slice(0, -unsignedCount).every((note) => note.signedAt !== null)).toBe(true);

    const reversed = filterNotes(MOCK_NOTES, { sort: 'signedAt', order: 'desc' });
    expect(reversed.slice(0, unsignedCount).every((note) => note.signedAt === null)).toBe(true);
  });

  it('sorts by creation when asked for that instead, which is the default column', () => {
    /* The two sorts have to disagree on this fixture set, or the signature
       assertions above would hold for a function that ignored `sort`. */
    const byCreation = filterNotes(MOCK_NOTES, { sort: 'createdAt' });
    const bySignature = filterNotes(MOCK_NOTES, { sort: 'signedAt' });

    expect(byCreation.map((note) => note.id)).not.toEqual(bySignature.map((note) => note.id));
    expect(byCreation.map((note) => note.id)).toEqual(
      filterNotes(MOCK_NOTES).map((note) => note.id)
    );
  });
});
