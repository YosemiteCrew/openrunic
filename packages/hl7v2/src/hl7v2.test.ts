import { describe, expect, it } from 'vitest';

import type { AdtMessage, MessageHeader, OrmMessage, OruMessage, VxuMessage } from './domain.js';
import { DEFAULT_DELIMITERS, escapeValue, readDelimiters, unescapeValue } from './encoding.js';
import { Hl7Error } from './errors.js';
import {
  acknowledge,
  buildAck,
  buildAdt,
  buildOrm,
  buildOru,
  buildVxu,
  parseAck,
  parseAdt,
  parseOrm,
  parseOru,
  parseVxu,
  inspect,
} from './messages.js';
import {
  component,
  field,
  joinComponents,
  parseMessage,
  renderMessage,
  repetitions,
  segmentNamed,
  segmentsNamed,
} from './message.js';
import { dateFromHl7, fromHl7, hl7Date, hl7Instant, writeTime } from './time.js';

/**
 * The round trip is the test that matters, for the same reason it does in the
 * document codec: a builder test asserts the pipes contain what its author
 * expected, a parser test asserts the parser reads what its author wrote, and
 * both pass while a field is written into a position nothing reads back.
 *
 * The other half is the format's own traps - the MSH off-by-one, the declared
 * delimiters, the escape sequences - each of which produces a message that looks
 * fine and means something else.
 */

const HEADER: MessageHeader = {
  sendingApplication: 'OPENRUNIC',
  sendingFacility: 'EXAMPLE_PRACTICE',
  receivingApplication: 'LABSYS',
  receivingFacility: 'EXAMPLE_LAB',
  sentAt: '2026-08-14T09:30:00.000Z',
  controlId: 'MSG00001',
  processingId: 'P',
  version: '2.5.1',
};

const PATIENT = {
  mrn: 'OR-100482',
  familyName: 'Patientsson',
  givenName: 'Testina',
  middleName: 'Q',
  birthDate: '1994-03-02',
  sex: 'F' as const,
  address: {
    line1: '1 Example Street',
    city: 'Testville',
    state: 'CA',
    postalCode: '90001',
    country: 'US',
  },
  phone: '+15550100',
};

const VISIT = {
  visitNumber: 'V-0001',
  patientClass: 'O',
  location: 'CLINIC-A',
  attendingProviderId: 'NPI-1234',
  attendingProviderName: 'Clinician',
  admittedAt: '2026-08-14T09:00:00.000Z',
};

describe('the format itself', () => {
  /**
   * The trap that defines this format. `MSH-1` is the field separator and
   * `MSH-2` the encoding characters, so splitting on the separator puts the
   * sending application in slot 2 while the standard calls it field 3. A parser
   * that indexes MSH like every other segment reads the sender as the receiver,
   * and the message still looks plausible.
   */
  it('numbers MSH fields the way the standard does, not the way a split does', () => {
    const parsed = parseMessage(
      'MSH|^~\\&|SENDER|SFAC|RECEIVER|RFAC|20260814093000||ADT^A01|C1|P|2.5.1'
    );
    const msh = segmentNamed(parsed, 'MSH');

    expect(field(msh, 1, parsed.delimiters)).toBe('|');
    expect(field(msh, 2, parsed.delimiters)).toBe('^~\\&');
    expect(field(msh, 3, parsed.delimiters)).toBe('SENDER');
    expect(field(msh, 10, parsed.delimiters)).toBe('C1');
  });

  it('numbers every other segment from one after the identifier', () => {
    const parsed = parseMessage(
      'MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1\rPID|1||MRN123'
    );
    const pid = segmentNamed(parsed, 'PID');

    expect(field(pid, 1, parsed.delimiters)).toBe('1');
    expect(field(pid, 3, parsed.delimiters)).toBe('MRN123');
  });

  /**
   * The delimiters are declared per message, not fixed by the standard. Almost
   * every message says `|^~\&`, and a parser that assumes so mangles the one
   * interface that does not.
   */
  it('reads whatever delimiters the message declares', () => {
    const parsed = parseMessage('MSH#@$/*#SENDER#SFAC#R#F#20260814093000##ADT@A01#C1#P#2.5.1');

    expect(parsed.delimiters).toEqual({
      field: '#',
      component: '@',
      repetition: '$',
      escape: '/',
      subcomponent: '*',
    });
    expect(field(segmentNamed(parsed, 'MSH'), 3, parsed.delimiters)).toBe('SENDER');
    expect(component(segmentNamed(parsed, 'MSH'), 9, 2, parsed.delimiters)).toBe('A01');
  });

  it('refuses a message that declares the same delimiter twice', () => {
    expect(() => readDelimiters('MSH|^~|&|SENDER')).toThrow(/delimiter twice/);
  });

  it('refuses a message that does not begin with MSH', () => {
    expect(() => parseMessage('PID|1||MRN')).toThrow(/must begin with MSH/);
    expect(() => parseMessage('   ')).toThrow(/empty/);
  });

  it('refuses an MSH too short to declare its delimiters', () => {
    expect(() => readDelimiters('MSH|^')).toThrow(/too short/);
  });

  /**
   * The standard says carriage return. A sender that uses newlines is out of
   * conformance and is also most senders at some point, usually because a file
   * went through a text editor - and refusing would lose a result over a byte
   * nobody chose.
   */
  it('accepts carriage returns, newlines and both', () => {
    const fields = 'MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1';

    for (const separator of ['\r', '\n', '\r\n']) {
      const parsed = parseMessage(`${fields}${separator}PID|1||MRN123`);

      expect(parsed.segments, separator).toHaveLength(2);
    }
  });

  it('writes carriage returns back, whatever it read', () => {
    const rendered = renderMessage(
      parseMessage('MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1\nPID|1||M')
    );

    expect(rendered).toContain('\r');
    expect(rendered).not.toContain('\n');
  });
});

describe('escaping', () => {
  it('escapes the delimiters so a value can carry them', () => {
    expect(escapeValue("O'Brien & Sons | Ltd ^ Co", DEFAULT_DELIMITERS)).toBe(
      "O'Brien \\T\\ Sons \\F\\ Ltd \\S\\ Co"
    );
  });

  it('round-trips a value containing every delimiter', () => {
    const value = 'a|b^c~d\\e&f';

    expect(unescapeValue(escapeValue(value, DEFAULT_DELIMITERS), DEFAULT_DELIMITERS)).toBe(value);
  });

  it('reads a hex escape back as the characters it names', () => {
    expect(unescapeValue('a\\X0D0A\\b', DEFAULT_DELIMITERS)).toBe('a\r\nb');
  });

  it('reads a formatting break as a line break, because that is what makes a result readable', () => {
    expect(unescapeValue('line one\\.br\\line two', DEFAULT_DELIMITERS)).toBe('line one\nline two');
  });

  /**
   * `\Zxyz\` is a locally-defined escape somebody's interface uses. A value
   * silently missing a run of characters is far worse for the person reading the
   * chart than one carrying a sequence they can look up.
   */
  it('leaves an escape it does not know exactly as it arrived', () => {
    expect(unescapeValue('a\\Zlocal\\b', DEFAULT_DELIMITERS)).toBe('a\\Zlocal\\b');
  });

  it('carries an unterminated escape through rather than truncating the value', () => {
    expect(unescapeValue('important\\F', DEFAULT_DELIMITERS)).toBe('important\\F');
  });

  it('survives a patient name with an ampersand in it, end to end', () => {
    const message = buildAdt({
      header: HEADER,
      event: 'A04',
      occurredAt: '2026-08-14T09:00:00.000Z',
      patient: { ...PATIENT, familyName: "O'Brien & Sons" },
    });

    expect(message).toContain('\\T\\');
    expect(parseAdt(message).patient.familyName).toBe("O'Brien & Sons");
  });
});

describe('ADT', () => {
  const adt: AdtMessage = {
    header: HEADER,
    event: 'A01',
    occurredAt: '2026-08-14T09:00:00.000Z',
    patient: PATIENT,
    visit: VISIT,
  };

  it('round-trips a registration', () => {
    expect(parseAdt(buildAdt(adt))).toEqual(adt);
  });

  it('round-trips without a visit, which a registration may not have', () => {
    const withoutVisit: AdtMessage = {
      header: HEADER,
      event: 'A01',
      occurredAt: '2026-08-14T09:00:00.000Z',
      patient: PATIENT,
    };

    expect(parseAdt(buildAdt(withoutVisit))).toEqual(withoutVisit);
  });

  it('round-trips a patient with nothing optional filled in', () => {
    const sparse: AdtMessage = {
      header: HEADER,
      event: 'A04',
      occurredAt: '2026-08-14T09:00:00.000Z',
      patient: { mrn: 'OR-2', familyName: 'Nullsson', givenName: 'Placeholder' },
    };

    expect(parseAdt(buildAdt(sparse))).toEqual(sparse);
  });

  /**
   * The event time is not the send time. A registration entered at nine and
   * transmitted at eleven is two hours of difference that matters to anybody
   * reconciling a timeline.
   */
  it('writes when the event happened, separately from when the message was sent', () => {
    const parsed = parseMessage(buildAdt({ ...adt, occurredAt: '2026-08-14T07:15:00.000Z' }));

    expect(field(segmentNamed(parsed, 'EVN'), 2, parsed.delimiters)).toBe('20260814071500+0000');
    expect(field(segmentNamed(parsed, 'MSH'), 7, parsed.delimiters)).toBe('20260814093000+0000');
  });

  it('falls back to the send time when the sender left the event time empty', () => {
    const raw = buildAdt(adt).replace('EVN|A01|20260814090000+0000', 'EVN|A01|');

    expect(parseAdt(raw).occurredAt).toBe(HEADER.sentAt);
  });

  it('declares the structure a receiver routes on', () => {
    const parsed = parseMessage(buildAdt({ ...adt, event: 'A03' }));

    expect(component(segmentNamed(parsed, 'MSH'), 9, 3, parsed.delimiters)).toBe('ADT_A03');
  });

  it('refuses a message that is not an ADT, and an event it does not handle', () => {
    expect(() => parseAdt(buildOru({ header: HEADER, patient: PATIENT, orders: [] }))).toThrow(
      /Expected an ADT/
    );
    expect(() => parseAdt(buildAdt(adt).replace('ADT^A01^ADT_A01', 'ADT^A11^ADT_A09'))).toThrow(
      /A01, A03, A04, A08/
    );
  });

  /**
   * A date alone is not a death notification. A sender that fills the date and
   * leaves the indicator empty has not said the patient died, and reading it as
   * if they had would put a date of death on a living person's chart.
   */
  it('records a death only when the sender sets the indicator, not merely the date', () => {
    const withDeath = buildAdt({
      ...adt,
      patient: { ...PATIENT, deceasedAt: '2026-08-01T00:00:00.000Z' },
    });
    // The indicator is PID-30 and is the only `|Y` in this message; removing it
    // leaves the date in PID-29 exactly where it was.
    const dateOnly = withDeath.replace('|Y', '|');

    expect(dateOnly).toContain('20260801000000+0000');
    expect(parseAdt(withDeath).patient.deceasedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(parseAdt(dateOnly).patient.deceasedAt).toBeUndefined();
  });

  /**
   * A date of birth read as an instant moves a day for anybody not on UTC, and a
   * date of birth that moves stops matching the patient on the other side.
   */
  it('writes a date of birth as a date, with no time on it', () => {
    const parsed = parseMessage(buildAdt(adt));

    expect(field(segmentNamed(parsed, 'PID'), 7, parsed.delimiters)).toBe('19940302');
  });
});

describe('ORU', () => {
  const oru: OruMessage = {
    header: HEADER,
    patient: PATIENT,
    visit: VISIT,
    orders: [
      {
        placerOrderNumber: 'ORD-1',
        fillerOrderNumber: 'LAB-1',
        service: { code: '24323-8', display: 'Comprehensive metabolic panel', system: 'LN' },
        requestedAt: '2026-07-01T08:00:00.000Z',
        observedAt: '2026-07-01T10:00:00.000Z',
        orderingProviderId: 'NPI-1234',
        orderingProviderName: 'Clinician',
        results: [
          {
            valueType: 'NM',
            identifier: { code: '2345-7', display: 'Glucose', system: 'LN' },
            value: '6.2',
            units: 'mmol/L',
            referenceRange: '3.9-5.5',
            abnormalFlag: 'H',
            status: 'F',
            observedAt: '2026-07-01T10:00:00.000Z',
            notes: ['Haemolysed sample', 'Repeat advised'],
          },
          {
            valueType: 'ST',
            identifier: { code: '5811-5', display: 'Ketones', system: 'LN' },
            value: 'negative',
            status: 'F',
          },
        ],
      },
      {
        placerOrderNumber: 'ORD-2',
        service: { code: '58410-2', display: 'Complete blood count', system: 'LN' },
        results: [
          {
            valueType: 'NM',
            identifier: { code: '718-7', display: 'Haemoglobin', system: 'LN' },
            value: '13.4',
            units: 'g/dL',
            status: 'P',
          },
        ],
      },
    ],
  };

  it('round-trips two orders, their results and their notes', () => {
    expect(parseOru(buildOru(oru))).toEqual(oru);
  });

  /**
   * The grammar is positional: every OBX after an OBR belongs to that OBR until
   * the next OBR appears. Getting it wrong files a result under the previous
   * order, which is a wrong value on the right patient.
   */
  it('attaches each result to the order it followed, not to the first one', () => {
    const parsed = parseOru(buildOru(oru));

    expect(parsed.orders[0]?.results).toHaveLength(2);
    expect(parsed.orders[1]?.results).toHaveLength(1);
    expect(parsed.orders[1]?.results[0]?.identifier.code).toBe('718-7');
  });

  it('attaches each note to the result it followed', () => {
    const parsed = parseOru(buildOru(oru));

    expect(parsed.orders[0]?.results[0]?.notes).toEqual(['Haemolysed sample', 'Repeat advised']);
    expect(parsed.orders[0]?.results[1]?.notes).toBeUndefined();
  });

  it('drops a result that arrived before any order, rather than filing it under the next one', () => {
    const raw = [
      'MSH|^~\\&|S|F|R|F|20260814093000||ORU^R01^ORU_R01|C1|P|2.5.1',
      'PID|1||MRN123||Nullsson^Placeholder',
      'OBX|1|NM|X^Orphan^LN||1||||||F',
      'OBR|1|ORD-9||Y^Real^LN',
      'OBX|1|NM|Z^Belongs^LN||2||||||F',
    ].join('\r');

    const parsed = parseOru(raw);

    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0]?.results).toHaveLength(1);
    expect(parsed.orders[0]?.results[0]?.identifier.code).toBe('Z');
  });

  it('reads a result with no status as final, which is what every real sender means', () => {
    const raw = [
      'MSH|^~\\&|S|F|R|F|20260814093000||ORU^R01^ORU_R01|C1|P|2.5.1',
      'PID|1||MRN123||Nullsson^Placeholder',
      'OBR|1|ORD-1||X^Panel^LN',
      'OBX|1|NM|Y^Test^LN||5',
    ].join('\r');

    expect(parseOru(raw).orders[0]?.results[0]?.status).toBe('F');
  });

  it('refuses a message that is not an ORU', () => {
    expect(() =>
      parseOru(buildVxu({ header: HEADER, patient: PATIENT, immunisations: [] }))
    ).toThrow(/Expected a ORU/);
  });
});

describe('ORM', () => {
  const orm: OrmMessage = {
    header: HEADER,
    patient: PATIENT,
    visit: VISIT,
    orders: [
      {
        placerOrderNumber: 'ORD-10',
        fillerOrderNumber: 'LAB-10',
        orderControl: 'NW',
        service: { code: '24323-8', display: 'Comprehensive metabolic panel', system: 'LN' },
        requestedAt: '2026-08-14T09:00:00.000Z',
        orderingProviderId: 'NPI-1234',
        orderingProviderName: 'Clinician',
        priority: 'R',
        notes: ['Fasting'],
      },
      {
        placerOrderNumber: 'ORD-11',
        orderControl: 'CA',
        service: { code: '58410-2', display: 'Complete blood count', system: 'LN' },
      },
    ],
  };

  it('round-trips two orders, one new and one cancelled', () => {
    expect(parseOrm(buildOrm(orm))).toEqual(orm);
  });

  it('keeps the order control, which is what says new from cancelled', () => {
    const parsed = parseOrm(buildOrm(orm));

    expect(parsed.orders.map((order) => order.orderControl)).toEqual(['NW', 'CA']);
  });

  it('attaches a note to the order it followed', () => {
    expect(parseOrm(buildOrm(orm)).orders[0]?.notes).toEqual(['Fasting']);
    expect(parseOrm(buildOrm(orm)).orders[1]?.notes).toBeUndefined();
  });

  it('refuses a message that is not an ORM', () => {
    expect(() => parseOrm(buildOru({ header: HEADER, patient: PATIENT, orders: [] }))).toThrow(
      /Expected a ORM/
    );
  });
});

describe('VXU', () => {
  const vxu: VxuMessage = {
    header: HEADER,
    patient: PATIENT,
    immunisations: [
      {
        sequence: 1,
        vaccine: { code: '150', display: 'Influenza, injectable', system: 'CVX' },
        administeredAt: '2025-10-12T00:00:00.000Z',
        amount: '0.5',
        units: 'mL',
        lotNumber: 'LOT-000A',
        manufacturer: { code: 'PMC', display: 'Sanofi Pasteur', system: 'MVX' },
        route: { code: 'IM', display: 'Intramuscular', system: 'NCIT' },
        site: { code: 'LD', display: 'Left deltoid', system: 'HL70163' },
        completionStatus: 'CP',
        administeringProviderId: 'NPI-1234',
      },
      {
        sequence: 2,
        vaccine: { code: '207', display: 'COVID-19 mRNA', system: 'CVX' },
        administeredAt: '2026-01-05T00:00:00.000Z',
        completionStatus: 'RE',
      },
    ],
  };

  it('round-trips both a dose given and a dose refused', () => {
    expect(parseVxu(buildVxu(vxu))).toEqual(vxu);
  });

  /**
   * A registry reading an empty amount cannot tell it from a zero dose, so the
   * standard's "not recorded" code is written instead - and read back as absent
   * rather than as a dose of nine hundred and ninety-nine units.
   */
  it('writes the not-recorded code for a missing amount, and reads it back as missing', () => {
    const parsed = parseMessage(buildVxu(vxu));
    const rxa = parsed.segments.filter((segment) => segment.id === 'RXA')[1];

    expect(field(rxa, 6, parsed.delimiters)).toBe('999');
    expect(parseVxu(buildVxu(vxu)).immunisations[1]?.amount).toBeUndefined();
  });

  it('refuses a message that is not a VXU', () => {
    expect(() =>
      parseVxu(
        buildAdt({
          header: HEADER,
          event: 'A04',
          occurredAt: HEADER.sentAt,
          patient: PATIENT,
        })
      )
    ).toThrow(/Expected a VXU/);
  });
});

describe('acknowledgements', () => {
  it('round-trips an acceptance', () => {
    const ack = {
      header: HEADER,
      code: 'AA' as const,
      acknowledgedControlId: 'MSG00001',
      text: 'Filed',
    };

    expect(parseAck(buildAck(ack))).toEqual(ack);
  });

  it('quotes back the control id of the message it answers', () => {
    const original = buildOru({ header: HEADER, patient: PATIENT, orders: [] });

    const ack = parseAck(acknowledge(original, HEADER, { code: 'AA' }));

    expect(ack.acknowledgedControlId).toBe('MSG00001');
  });

  /**
   * A message that failed to parse still has to be answered, and it is exactly
   * the message whose control id matters most - so the sender can name it in a
   * support call.
   */
  it('answers a message it could not parse rather than throwing', () => {
    const ack = parseAck(
      acknowledge('not a message at all', HEADER, {
        code: 'AR',
        text: 'Could not parse',
      })
    );

    expect(ack.code).toBe('AR');
    expect(ack.acknowledgedControlId).toBe('');
    expect(ack.text).toBe('Could not parse');
  });

  it('reads the control id out of a message it can parse but does not model', () => {
    const raw = 'MSH|^~\\&|S|F|R|F|20260814093000||SIU^S12^SIU_S12|SCHED-9|P|2.5.1';

    expect(parseAck(acknowledge(raw, HEADER, { code: 'AE' })).acknowledgedControlId).toBe(
      'SCHED-9'
    );
  });

  it('refuses an acknowledgement whose code is not one', () => {
    const raw = buildAck({ header: HEADER, code: 'AA', acknowledgedControlId: 'X' }).replace(
      'MSA|AA',
      'MSA|ZZ'
    );

    expect(() => parseAck(raw)).toThrow(Hl7Error);
    expect(() => parseAck(raw)).toThrow(/not an acknowledgement code/);
  });

  it('refuses a message with no MSA at all', () => {
    expect(() => parseAck('MSH|^~\\&|S|F|R|F|20260814093000||ACK|C1|P|2.5.1')).toThrow(/no MSA/);
  });
});

describe('the processing id, which decides whether traffic is real', () => {
  /**
   * A message whose processing id nobody set is one a receiver must treat as
   * real. Treating real traffic as a test is the failure that loses a result
   * silently.
   */
  it('reads an unset processing id as production', () => {
    const raw = buildAdt({
      header: HEADER,
      event: 'A04',
      occurredAt: HEADER.sentAt,
      patient: PATIENT,
    }).replace('|P|2.5.1', '||2.5.1');

    expect(parseAdt(raw).header.processingId).toBe('P');
  });

  it('reads training and debugging when the sender says so', () => {
    for (const id of ['T', 'D'] as const) {
      const raw = buildAdt({
        header: { ...HEADER, processingId: id },
        event: 'A04',
        occurredAt: HEADER.sentAt,
        patient: PATIENT,
      });

      expect(parseAdt(raw).header.processingId, id).toBe(id);
    }
  });
});

describe('timestamps', () => {
  it('writes an instant in UTC and a date as a date', () => {
    expect(hl7Instant('2026-08-14T09:30:00.000Z')).toBe('20260814093000+0000');
    expect(hl7Instant('2026-08-14T09:30:00+05:30')).toBe('20260814040000+0000');
    expect(hl7Date('1994-03-02')).toBe('19940302');
    expect(writeTime('1994-03-02')).toBe('19940302');
    expect(writeTime('2026-08-14T09:30:00.000Z')).toBe('20260814093000+0000');
  });

  it('refuses what it cannot write rather than emitting NaN', () => {
    expect(() => hl7Instant('not a date')).toThrow(Hl7Error);
    expect(() => hl7Date('March 2nd')).toThrow(Hl7Error);
  });

  it('reads a timestamp at whatever precision it was written', () => {
    expect(fromHl7('20260814093000+0000')).toBe('2026-08-14T09:30:00.000Z');
    expect(fromHl7('20260814093000')).toBe('2026-08-14T09:30:00.000Z');
    expect(fromHl7('20260814093000-0500')).toBe('2026-08-14T14:30:00.000Z');
    expect(fromHl7('20260814093000.500+0000')).toBe('2026-08-14T09:30:00.000Z');
    expect(fromHl7('19940302')).toBe('1994-03-02');
    expect(fromHl7('202608')).toBe('2026-08-01');
    expect(fromHl7('2026')).toBe('2026-01-01');
  });

  it('treats an absent or blank timestamp as absent', () => {
    expect(fromHl7(undefined)).toBeUndefined();
    expect(fromHl7('  ')).toBeUndefined();
    expect(dateFromHl7(undefined)).toBeUndefined();
    expect(dateFromHl7('20260814093000+0000')).toBe('2026-08-14');
  });

  it('refuses a timestamp it cannot read, and one whose fields are impossible', () => {
    expect(() => fromHl7('yesterday')).toThrow(/Cannot read/);
    expect(() => fromHl7('20261345000000')).toThrow(/out of range/);
  });
});

describe('the segment helpers, at their edges', () => {
  const parsed = parseMessage(
    'MSH|^~\\&|S|F|R|F|20260814093000||ORU^R01|C1|P|2.5.1\rPID|1||MRN^^^^MR||Nullsson^Placeholder\rOBX|1|NM|A^x^LN~B^y^LN'
  );

  it('answers nothing for a segment that is not there', () => {
    expect(segmentNamed(parsed, 'ZZZ')).toBeUndefined();
    expect(segmentsNamed(parsed, 'ZZZ')).toEqual([]);
    expect(field(undefined, 3, parsed.delimiters)).toBe('');
    expect(component(undefined, 3, 1, parsed.delimiters)).toBe('');
  });

  it('answers nothing for a field the segment does not reach', () => {
    expect(field(segmentNamed(parsed, 'PID'), 99, parsed.delimiters)).toBe('');
    expect(component(segmentNamed(parsed, 'PID'), 99, 1, parsed.delimiters)).toBe('');
    expect(component(segmentNamed(parsed, 'PID'), 5, 9, parsed.delimiters)).toBe('');
  });

  it('reads a field with no component separator as its own first component', () => {
    expect(component(segmentNamed(parsed, 'PID'), 1, 1, parsed.delimiters)).toBe('1');
  });

  it('splits a repeating field, and answers nothing for one that is absent or empty', () => {
    expect(repetitions(segmentNamed(parsed, 'OBX'), 3, parsed.delimiters)).toEqual([
      'A^x^LN',
      'B^y^LN',
    ]);
    expect(repetitions(segmentNamed(parsed, 'OBX'), 99, parsed.delimiters)).toEqual([]);
    expect(repetitions(undefined, 3, parsed.delimiters)).toEqual([]);
  });

  it('refuses a segment with no identifier', () => {
    expect(() => parseMessage('MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1\rPI')).toThrow(
      /no identifier/
    );
  });

  it('refuses to look for a segment the message does not have', () => {
    expect(() => parseAck('MSH|^~\\&|S|F|R|F|20260814093000||ACK|C1|P|2.5.1')).toThrow(Hl7Error);
  });

  /**
   * `SMITH^^^^` and `SMITH` mean the same thing, and the shorter is what a
   * receiving system's log is readable in. Interior empties are kept, because
   * `SMITH^^JR` says something the trimmed form would not.
   */
  it('trims trailing empty components and keeps the interior ones', () => {
    expect(joinComponents(['SMITH', '', '', ''], DEFAULT_DELIMITERS)).toBe('SMITH');
    expect(joinComponents(['SMITH', '', 'JR'], DEFAULT_DELIMITERS)).toBe('SMITH^^JR');
    expect(joinComponents([], DEFAULT_DELIMITERS)).toBe('');
  });

  it('carries an error location a person can act on', () => {
    try {
      parseMessage('MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1\rPI');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Hl7Error);
      expect((error as Hl7Error).segment).toBe(2);
    }
  });
});

describe('the parts of a message this codec does not model', () => {
  /**
   * A practice's interfaces carry more than four message types, and a receiver
   * has to be able to look at one it does not model - to route it, log it, or
   * tell somebody what arrived.
   */
  it('parses a message type it has no builder for', () => {
    const parsed = inspect(
      'MSH|^~\\&|SCHED|F|R|F|20260814093000||SIU^S12^SIU_S12|S1|P|2.5.1\rSCH|APPT-1||||||ROUTINE'
    );

    expect(segmentNamed(parsed, 'SCH')).toBeDefined();
    expect(field(segmentNamed(parsed, 'SCH'), 1, parsed.delimiters)).toBe('APPT-1');
  });

  it('keeps a segment it does not know when re-rendering', () => {
    const raw = 'MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1\rZPD|1|local extension';

    expect(renderMessage(inspect(raw))).toBe(raw);
  });
});

describe('messages recorded with nothing optional filled in', () => {
  /**
   * Most of a message is optional fields, and the branch that handles an absent
   * one is the branch a fixture full of tidy data never reaches. A laboratory
   * that sends a value and a code and nothing else is not an edge case; it is
   * most analysers.
   */
  const SPARSE_PATIENT = { mrn: 'OR-2', familyName: 'Nullsson', givenName: 'Placeholder' };

  it('round-trips a result with no units, range, flag or time', () => {
    const oru: OruMessage = {
      header: HEADER,
      patient: SPARSE_PATIENT,
      orders: [
        {
          placerOrderNumber: 'ORD-1',
          service: { code: 'X' },
          results: [{ valueType: 'NM', identifier: { code: 'Y' }, value: '1', status: 'F' }],
        },
      ],
    };

    expect(parseOru(buildOru(oru))).toEqual(oru);
  });

  it('round-trips an order with no filler number, provider, priority or notes', () => {
    const orm: OrmMessage = {
      header: HEADER,
      patient: SPARSE_PATIENT,
      orders: [{ placerOrderNumber: 'ORD-1', orderControl: 'NW', service: { code: 'X' } }],
    };

    expect(parseOrm(buildOrm(orm))).toEqual(orm);
  });

  it('round-trips an immunisation with nothing but a vaccine and a date', () => {
    const vxu: VxuMessage = {
      header: HEADER,
      patient: SPARSE_PATIENT,
      immunisations: [
        {
          sequence: 1,
          vaccine: { code: '150' },
          administeredAt: '2025-10-12T00:00:00.000Z',
          completionStatus: 'CP',
        },
      ],
    };

    expect(parseVxu(buildVxu(vxu))).toEqual(vxu);
  });

  it('round-trips a visit with nothing but a number and a class', () => {
    const adt: AdtMessage = {
      header: HEADER,
      event: 'A08',
      occurredAt: HEADER.sentAt,
      patient: SPARSE_PATIENT,
      visit: { visitNumber: 'V-9', patientClass: 'I' },
    };

    expect(parseAdt(buildAdt(adt))).toEqual(adt);
  });

  it('reads a coded field that carries only a code', () => {
    const parsed = parseOru(
      [
        'MSH|^~\\&|S|F|R|F|20260814093000||ORU^R01^ORU_R01|C1|P|2.5.1',
        'PID|1||MRN||Nullsson^Placeholder',
        'OBR|1|ORD-1||PANEL',
        'OBX|1|NM|GLU||6.2',
      ].join('\r')
    );

    expect(parsed.orders[0]?.service).toEqual({ code: 'PANEL' });
    expect(parsed.orders[0]?.results[0]?.identifier).toEqual({ code: 'GLU' });
  });

  it('reads an order and a result whose coded fields are empty', () => {
    const parsed = parseOru(
      [
        'MSH|^~\\&|S|F|R|F|20260814093000||ORU^R01^ORU_R01|C1|P|2.5.1',
        'PID|1||MRN||Nullsson^Placeholder',
        'OBR|1|ORD-1',
        'OBX|1|NM|||6.2',
      ].join('\r')
    );

    expect(parsed.orders[0]?.service).toEqual({ code: '' });
    expect(parsed.orders[0]?.results[0]?.identifier).toEqual({ code: '' });
  });

  it('falls back to position when an RXA carries no sequence number', () => {
    const parsed = parseVxu(
      [
        'MSH|^~\\&|S|F|R|F|20260814093000||VXU^V04^VXU_V04|C1|P|2.5.1',
        'PID|1||MRN||Nullsson^Placeholder',
        'RXA|0||20251012|150^Influenza^CVX|999',
      ].join('\r')
    );

    expect(parsed.immunisations[0]?.sequence).toBe(1);
    expect(parsed.immunisations[0]?.completionStatus).toBe('CP');
  });

  it('reads a patient with no address and no name components beyond the family', () => {
    const parsed = parseAdt(
      [
        'MSH|^~\\&|S|F|R|F|20260814093000||ADT^A04^ADT_A01|C1|P|2.5.1',
        'EVN|A04|20260814090000',
        'PID|1||MRN||Nullsson',
      ].join('\r')
    );

    expect(parsed.patient).toEqual({ mrn: 'MRN', familyName: 'Nullsson', givenName: '' });
  });

  it('carries an error with no location when there is none to give', () => {
    const error = new Hl7Error('something went wrong');

    expect(error.message).toBe('something went wrong');
    expect(error.segment).toBeUndefined();
    expect(error.segmentId).toBeUndefined();
  });
});

describe('the cost of parsing', () => {
  /**
   * The input arrives off a socket from another organisation, so the parser's
   * worst case is somebody else's choice. This is the regression test for the
   * shape that used to be quadratic: a long run of whitespace, which an anchored
   * `\s+$` walks repeatedly and `trim` does not.
   */
  it('stays fast on a message that is mostly whitespace', () => {
    const padded = `${' '.repeat(200_000)}MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1${' '.repeat(200_000)}`;

    const started = performance.now();
    const parsed = parseMessage(padded);
    const elapsed = performance.now() - started;

    expect(parsed.segments).toHaveLength(1);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('stays fast on a message with very many segments', () => {
    const segments = Array.from(
      { length: 20_000 },
      (_, index) => `OBX|${String(index + 1)}|NM|X||1`
    );
    const raw = ['MSH|^~\\&|S|F|R|F|20260814093000||ORU^R01|C1|P|2.5.1', ...segments].join('\r');

    const started = performance.now();
    const parsed = parseMessage(raw);
    const elapsed = performance.now() - started;

    expect(parsed.segments).toHaveLength(20_001);
    expect(elapsed).toBeLessThan(2_000);
  });
});

/**
 * SEGMENT INJECTION.
 *
 * A field carrying a raw carriage return is a field that ends its segment and
 * starts another, so a value with `\rOBX|...` in it does not corrupt one message
 * - it adds a result to it, and the receiving system files that result under the
 * patient and order the real segments named. The values that reach these
 * builders are names, lot numbers, control ids and free text, all of which
 * arrive from a chart, a request body or another organisation's message.
 *
 * Two properties are asserted for every one of them: the message still has
 * exactly the segments the builder wrote, and the value comes back out of the
 * parser unchanged. The second is what stops the fix being "strip the
 * character", which would silently rewrite clinical text.
 */
describe('a value that tries to end its own segment', () => {
  const CARRIAGE = '\r';
  const injected = (payload: string): string => `Legitimate${CARRIAGE}${payload}`;

  it('escapes a carriage return rather than emitting it', () => {
    const escaped = escapeValue('before\rafter', DEFAULT_DELIMITERS);

    expect(escaped).toBe('before\\X0D\\after');
    expect(unescapeValue(escaped, DEFAULT_DELIMITERS)).toBe('before\rafter');
  });

  it('escapes a line feed too, because the parser accepts one as a separator', () => {
    const escaped = escapeValue('before\nafter', DEFAULT_DELIMITERS);

    expect(escaped).toBe('before\\X0A\\after');
    expect(unescapeValue(escaped, DEFAULT_DELIMITERS)).toBe('before\nafter');
  });

  it('keeps a control id from appending segments to a VXU', () => {
    const vxu: VxuMessage = {
      header: { ...HEADER, controlId: injected('PID|1||FORGED^^^^MR|') },
      patient: PATIENT,
      immunisations: [
        {
          sequence: 1,
          administeredAt: '2026-08-14T09:00:00.000Z',
          vaccine: { code: '08', display: 'Hep B' },
          completionStatus: 'CP',
        },
      ],
    };

    const raw = buildVxu(vxu);
    const parsed = parseMessage(raw);

    expect(parsed.segments.map((segment) => segment.id)).toEqual(['MSH', 'PID', 'ORC', 'RXA']);
    expect(parseVxu(raw).header.controlId).toBe(vxu.header.controlId);
  });

  it('keeps a lot number from appending an RXA to a VXU', () => {
    const vxu: VxuMessage = {
      header: HEADER,
      patient: PATIENT,
      immunisations: [
        {
          sequence: 1,
          administeredAt: '2026-08-14T09:00:00.000Z',
          vaccine: { code: '08', display: 'Hep B' },
          lotNumber: injected('RXA|0|2|20260814090000||99^Forged||||||||||||||CP'),
          completionStatus: 'CP',
        },
      ],
    };

    const raw = buildVxu(vxu);

    expect(segmentsNamed(parseMessage(raw), 'RXA')).toHaveLength(1);
    expect(parseVxu(raw).immunisations[0]?.lotNumber).toBe(vxu.immunisations[0]?.lotNumber);
  });

  it('keeps a patient name from appending a PID to any message', () => {
    const adt: AdtMessage = {
      header: HEADER,
      event: 'A01',
      occurredAt: '2026-08-14T09:00:00.000Z',
      patient: { ...PATIENT, familyName: injected('PID|1||FORGED^^^^MR|') },
    };

    const raw = buildAdt(adt);

    expect(segmentsNamed(parseMessage(raw), 'PID')).toHaveLength(1);
    expect(parseAdt(raw).patient.familyName).toBe(adt.patient.familyName);
  });

  /**
   * The forwarding case, which is the one that needs no attacker inside the
   * practice at all. HL7 lets a sender write a carriage return as `\X0D\`, the
   * parser decodes it to the real character as it must, and a naive re-emit then
   * turns that decoded value back into syntax. Parse, then build, then parse.
   */
  it('survives a hostile value that arrived escaped in an inbound message', () => {
    const hostile = 'MSH|^~\\&|LAB|EXT|OPENRUNIC|PRACTICE|20260814093000||ORU^R01|C1|P|2.5.1\r';
    const pid = 'PID|1||OR-1^^^^MR|| Patientsson^Testina\r';
    const obr = 'OBR|1|PLACER1||1234-5^Glucose\r';
    // `\X0D\` is a carriage return the standard allows a sender to write.
    const obx = 'OBX|1|NM|1234-5^Glucose||5.4\\X0D\\OBX|2|NM|9999-9^Forged||99|||A||F\r';

    const inbound = parseOru(hostile + pid + obr + obx);
    expect(inbound.orders[0]?.results[0]?.value).toContain('\r');

    const forwarded = parseMessage(buildOru(inbound));

    expect(segmentsNamed(forwarded, 'OBX')).toHaveLength(1);
    expect(parseOru(buildOru(inbound)).orders[0]?.results[0]?.value).toBe(
      inbound.orders[0]?.results[0]?.value
    );
  });

  it('keeps an acknowledged control id from appending an MSA', () => {
    const raw = buildAck({
      header: HEADER,
      code: 'AA',
      acknowledgedControlId: injected('MSA|AE|OTHER|Rejected'),
    });

    expect(segmentsNamed(parseMessage(raw), 'MSA')).toHaveLength(1);
    expect(parseAck(raw).acknowledgedControlId).toContain('\r');
  });

  /**
   * The backstop, for a segment this package did not build. `buildSegment`
   * escapes, so nothing inside the codec can reach this - but a caller holding
   * the exported `Segment` type can write `fields` directly, and a future
   * builder could too. It refuses rather than escaping, because a raw separator
   * here means the caller and the renderer disagree about whether the field
   * holds data or syntax.
   */
  it('refuses to render a segment somebody assembled without escaping', () => {
    const message = parseMessage('MSH|^~\\&|S|F|R|F|20260814093000||ADT^A01|C1|P|2.5.1');
    const forged = { id: 'PID', fields: ['', '1', '', 'OR-1\rOBX|1|NM|X||9'] };

    expect(() => renderMessage({ ...message, segments: [...message.segments, forged] })).toThrow(
      Hl7Error
    );
  });

  it('still writes MSH-2 as the delimiters it declares, not as escaped text', () => {
    const raw = buildAdt({
      header: HEADER,
      event: 'A01',
      occurredAt: '2026-08-14T09:00:00.000Z',
      patient: PATIENT,
    });

    expect(raw.startsWith('MSH|^~\\&|')).toBe(true);
    expect(readDelimiters(raw.split('\r')[0] ?? '')).toEqual(DEFAULT_DELIMITERS);
  });
});
