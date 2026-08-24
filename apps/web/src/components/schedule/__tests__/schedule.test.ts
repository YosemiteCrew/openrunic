import { en as EN_MESSAGES } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import {
  assignLanes,
  categoryViz,
  countByColumn,
  dayWindow,
  delayTier,
  findOpenSlots,
  FLOW_COLUMNS,
  givenName,
  groupByProvider,
  minutesBetween,
  minutesOfDay,
  nextStatus,
  presentStatus,
  rowForInstant,
  SLOT_MINUTES,
  toScheduleProvider,
} from '@/components/schedule';
import { MOCK_APPOINTMENTS, MOCK_DIRECTORY_USERS, MOCK_NOW, MOCK_PROVIDERS } from '@/lib/api';
import type { Appointment, UserDto } from '@/lib/api';

/**
 * The grid's arithmetic. Everything asserted here is what a front desk sees as
 * a position, a colour edge or a wait time, so a regression in this file is a
 * regression in what the day looks like.
 */

const DAY = '2026-08-12';

function appointment(id: string, at: string, minutes: number, providerId = 'p'): Appointment {
  const start = new Date(`${DAY}T${at}:00.000Z`);
  const end = new Date(start.getTime() + minutes * 60_000);
  return {
    id,
    facilityId: 'f',
    patientId: 'pat',
    providerId,
    type: { code: 'FOLLOWUP', display: 'Follow-up' },
    status: 'BOOKED',
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: minutes,
    room: null,
    reasonText: null,
    recurrenceGroupId: null,
    createdVia: 'STAFF',
    cancelReason: null,
    checkedInAt: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
  };
}

describe('presentStatus', () => {
  it('gives every status a word, never colour alone', () => {
    // The word arrives as a catalogue key, so what is asserted here is that
    // there is one. That it resolves to a real sentence rather than rendering
    // as the key itself is the catalogue drift test's job.
    for (const status of ['BOOKED', 'ROOMED', 'FULFILLED', 'NOSHOW', 'CANCELLED'] as const) {
      expect(EN_MESSAGES[presentStatus(status).labelKey]).toBeTruthy();
    }
  });

  it('reserves olive for a finished visit and danger for a failed one', () => {
    expect(presentStatus('CHECKED_OUT').tone).toBe('success');
    expect(presentStatus('NOSHOW').tone).toBe('danger');
    expect(presentStatus('ROOMED').tone).toBe('neutral');
  });

  it('marks finished visits as done so the grid can quieten them', () => {
    expect(presentStatus('FULFILLED').done).toBe(true);
    expect(presentStatus('IN_PROGRESS').done).toBe(false);
  });
});

describe('categoryViz', () => {
  it('keeps a known visit type on a fixed viz slot', () => {
    expect(categoryViz('FOLLOWUP')).toBe(1);
    expect(categoryViz('followup')).toBe(1);
  });

  it('gives an unknown code a stable slot inside the ramp', () => {
    const slot = categoryViz('SOMETHING-NEW');
    expect(slot).toBeGreaterThanOrEqual(1);
    expect(slot).toBeLessThanOrEqual(6);
    expect(categoryViz('SOMETHING-NEW')).toBe(slot);
  });
});

describe('minutesOfDay', () => {
  it('reads the clinic timezone, not the machine', () => {
    expect(minutesOfDay(`${DAY}T09:20:00.000Z`)).toBe(9 * 60 + 20);
  });

  it('returns null rather than a wrong number for an absent value', () => {
    expect(minutesOfDay(null)).toBeNull();
  });
});

describe('dayWindow', () => {
  it('shows the clinic day even when nothing is booked', () => {
    const window = dayWindow([]);
    expect(window.openMinutes).toBe(8 * 60);
    expect(window.closeMinutes).toBe(17 * 60);
    expect(window.rows).toBe((17 * 60 - 8 * 60) / SLOT_MINUTES);
  });

  it('widens for an add-on booked before the clinic opens', () => {
    expect(dayWindow([appointment('a', '07:20', 20)]).openMinutes).toBe(7 * 60);
  });

  it('widens for a visit that ends after the clinic closes', () => {
    expect(dayWindow([appointment('a', '17:40', 20)]).closeMinutes).toBe(18 * 60);
  });

  it('keeps the clinic day when a booking carries times it cannot read', () => {
    // A row that arrives with an unreadable instant must not be allowed to
    // widen the grid to the whole of history: the day the front desk is looking
    // at stays the clinic day, and the bad row simply does not move its edges.
    const broken: Appointment = { ...appointment('a', '09:00', 20), start: '', end: 'not-a-time' };
    const window = dayWindow([broken]);
    expect(window.openMinutes).toBe(8 * 60);
    expect(window.closeMinutes).toBe(17 * 60);
  });
});

describe('rowForInstant', () => {
  it('puts the first slot on row one', () => {
    const window = dayWindow([]);
    expect(rowForInstant(`${DAY}T08:00:00.000Z`, window)).toBe(1);
    expect(rowForInstant(`${DAY}T09:00:00.000Z`, window)).toBe(7);
  });
});

describe('assignLanes', () => {
  it('gives a clear day the full column width', () => {
    const window = dayWindow([]);
    const placed = assignLanes([appointment('a', '09:00', 20)], window);
    expect(placed[0]?.lanes).toBe(1);
    expect(placed[0]?.lane).toBe(0);
  });

  it('splits a double-booked slot into two lanes rather than hiding one', () => {
    const window = dayWindow([]);
    const placed = assignLanes(
      [appointment('a', '09:00', 20), appointment('b', '09:10', 20)],
      window
    );
    expect(placed.map((entry) => entry.lane).sort()).toEqual([0, 1]);
    expect(placed.every((entry) => entry.lanes === 2)).toBe(true);
  });

  it('keeps a later, non-overlapping visit at full width', () => {
    const window = dayWindow([]);
    const placed = assignLanes(
      [appointment('a', '09:00', 20), appointment('b', '09:10', 20), appointment('c', '11:00', 20)],
      window
    );
    expect(placed.find((entry) => entry.appointment.id === 'c')?.lanes).toBe(1);
  });

  it('reuses a lane that has freed up instead of adding a third', () => {
    // 09:00-09:20, 09:10-09:30, then 09:20-09:40. The third overlaps the second
    // but starts exactly when the first ends, so it belongs in the first's
    // lane. Opening a third lane instead would narrow every card on a busy
    // morning for no reason.
    const window = dayWindow([]);
    const placed = assignLanes(
      [appointment('a', '09:00', 20), appointment('b', '09:10', 20), appointment('c', '09:20', 20)],
      window
    );
    expect(placed.find((entry) => entry.appointment.id === 'c')?.lane).toBe(0);
    expect(placed.every((entry) => entry.lanes === 2)).toBe(true);
  });

  it('spans at least one row so a zero-length booking is still visible', () => {
    const window = dayWindow([]);
    const placed = assignLanes([appointment('a', '09:00', 0)], window);
    expect(placed[0]?.rowEnd).toBeGreaterThan(placed[0]?.rowStart ?? 0);
  });
});

describe('groupByProvider', () => {
  it('keeps a column for a provider with an empty day', () => {
    const columns = groupByProvider([], ['p1', 'p2']);
    expect(columns.get('p1')).toEqual([]);
    expect(columns.get('p2')).toEqual([]);
  });

  it('drops appointments belonging to a provider not shown', () => {
    const columns = groupByProvider([appointment('a', '09:00', 20, 'other')], ['p1']);
    expect(columns.get('p1')).toEqual([]);
  });
});

describe('findOpenSlots', () => {
  const providerIds = MOCK_PROVIDERS.map((provider) => provider.id);

  it('answers with five slots in one call', () => {
    const slots = findOpenSlots(MOCK_APPOINTMENTS, providerIds, DAY, new Date(MOCK_NOW));
    expect(slots).toHaveLength(5);
  });

  it('never offers a slot in the past', () => {
    const slots = findOpenSlots(MOCK_APPOINTMENTS, providerIds, DAY, new Date(MOCK_NOW));
    for (const slot of slots) expect(slot.start >= MOCK_NOW).toBe(true);
  });

  it('never offers a slot that clashes with a booked visit', () => {
    const slots = findOpenSlots(MOCK_APPOINTMENTS, providerIds, DAY, new Date(MOCK_NOW));
    for (const slot of slots) {
      const clash = MOCK_APPOINTMENTS.some(
        (booked) =>
          booked.status !== 'CANCELLED' &&
          booked.providerId === slot.providerId &&
          booked.start < slot.end &&
          booked.end > slot.start
      );
      expect(clash).toBe(false);
    }
  });

  it('treats a cancelled visit as free time', () => {
    const cancelled: Appointment = {
      ...appointment('x', '09:00', 20, 'p1'),
      status: 'CANCELLED',
    };
    const slots = findOpenSlots([cancelled], ['p1'], DAY, new Date(`${DAY}T09:00:00.000Z`));
    expect(slots[0]?.start).toBe(`${DAY}T09:00:00.000Z`);
  });

  it('returns nothing when the visit does not fit the remaining day', () => {
    const slots = findOpenSlots([], ['p1'], DAY, new Date(`${DAY}T16:55:00.000Z`), {
      durationMinutes: 60,
    });
    expect(slots).toEqual([]);
  });
});

describe('delayTier', () => {
  it('leaves a fresh arrival alone', () => {
    expect(delayTier('ARRIVED', 4)).toBe('none');
  });

  it('raises caution at fifteen minutes and delay at thirty', () => {
    expect(delayTier('CHECKED_IN', 15)).toBe('caution');
    expect(delayTier('ROOMED', 31)).toBe('delayed');
  });

  it('never calls a visit in progress delayed: nobody is waiting', () => {
    expect(delayTier('IN_PROGRESS', 90)).toBe('none');
    expect(delayTier('CHECKED_OUT', 90)).toBe('none');
  });
});

describe('minutesBetween', () => {
  it('counts whole minutes', () => {
    expect(minutesBetween(`${DAY}T10:00:00.000Z`, new Date(`${DAY}T10:20:00.000Z`))).toBe(20);
  });

  it('reads a missing or future start as zero, never as a countdown', () => {
    expect(minutesBetween(null, new Date())).toBe(0);
    expect(minutesBetween(`${DAY}T11:00:00.000Z`, new Date(`${DAY}T10:00:00.000Z`))).toBe(0);
  });
});

describe('nextStatus', () => {
  it('advances one step along the flow sequence', () => {
    expect(nextStatus('ARRIVED')).toBe('CHECKED_IN');
    expect(nextStatus('ROOMED')).toBe('IN_PROGRESS');
  });

  it('stops at the end of the line and off it', () => {
    expect(nextStatus('CHECKED_OUT')).toBeNull();
    expect(nextStatus('CANCELLED')).toBeNull();
  });
});

describe('countByColumn', () => {
  it('reports zero rather than omitting an empty column', () => {
    const counts = countByColumn([]);
    for (const column of FLOW_COLUMNS) expect(counts[column.id]).toBe(0);
  });

  it('folds fulfilled visits into checked out', () => {
    const done: Appointment = { ...appointment('a', '09:00', 20), status: 'FULFILLED' };
    expect(countByColumn([done]).DONE).toBe(1);
  });
});

describe('givenName', () => {
  it('prefers what the patient is actually called', () => {
    expect(
      givenName({
        given: 'Testina',
        middle: null,
        family: 'Patientsson',
        prefix: null,
        suffix: null,
        preferred: 'Tess',
      })
    ).toBe('Tess');
  });

  it('falls back to the given name', () => {
    expect(
      givenName({
        given: 'Exampla',
        middle: null,
        family: 'Testperson',
        prefix: null,
        suffix: null,
        preferred: null,
      })
    ).toBe('Exampla');
  });
});

describe('toScheduleProvider', () => {
  const okafor = MOCK_DIRECTORY_USERS[0] as UserDto;

  it('heads the column with the name the directory carries', () => {
    expect(toScheduleProvider(okafor)).toEqual({
      id: okafor.id,
      name: 'Ada Okafor',
      role: 'MD',
    });
  });

  it('says nothing where the directory says nothing', () => {
    // `credential` is nullable on the wire, and plenty of people who hold a
    // column hold no letters after their name. The sub-line is then empty
    // rather than filled in with a guess.
    expect(toScheduleProvider({ ...okafor, credential: null }).role).toBe('');
  });
});
