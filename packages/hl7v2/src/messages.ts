import { DEFAULT_DELIMITERS } from './encoding.js';
import type { Delimiters } from './encoding.js';
import type {
  Acknowledgement,
  AdtEvent,
  AdtMessage,
  Immunisation,
  ObservationRequest,
  ObservationResult,
  OrmMessage,
  OrmOrder,
  OruMessage,
  VxuMessage,
} from './domain.js';
import { Hl7Error } from './errors.js';
import {
  buildSegment,
  component,
  field,
  joinComponents,
  message,
  parseMessage,
  renderMessage,
  requireSegment,
  segmentNamed,
  type Hl7Message,
  type Segment,
} from './message.js';
import {
  buildMsh,
  buildPid,
  buildPv1,
  readCoded,
  readMessageType,
  readMsh,
  readPid,
  readPv1,
  readTriggerEvent,
  writeCoded,
  writeProvider,
} from './segments.js';
import { fromHl7, hl7Instant, writeTime } from './time.js';

/**
 * THE FOUR MESSAGE TYPES, BUILT AND READ.
 *
 * ADT tells this practice a patient was registered, admitted, discharged or
 * updated. ORU brings a result back from a laboratory. ORM sends an order out.
 * VXU reports an immunisation to a registry. Between them they are most of what
 * a small practice's interfaces carry.
 *
 * Each is a flat sequence of segments, and the grouping is positional rather
 * than nested: in an ORU, every OBX after an OBR belongs to that OBR until the
 * next OBR appears. That is the whole grammar, and getting it wrong attaches a
 * result to the previous order - which is a wrong value on the right patient,
 * the worst shape of interface defect there is.
 */

/** Groups a flat segment list by the segment that starts each group. */
function groupBy(
  segments: readonly Segment[],
  starts: string,
  members: readonly string[]
): Segment[][] {
  const groups: Segment[][] = [];
  for (const segment of segments) {
    if (segment.id === starts) {
      groups.push([segment]);
      continue;
    }
    if (!members.includes(segment.id)) continue;
    const current = groups[groups.length - 1];
    // A member segment before any group has started belongs to nothing. It is
    // dropped rather than attached to the group that comes after it, because
    // attaching it would file a result under an order it did not come from.
    if (current !== undefined) current.push(segment);
  }
  return groups;
}

/* ------------------------------------------------------------------ ADT -- */

/** The message structure each event uses, which a receiver routes on. */
const ADT_STRUCTURE: Readonly<Record<AdtEvent, string>> = {
  A01: 'ADT_A01',
  A03: 'ADT_A03',
  A04: 'ADT_A01',
  A08: 'ADT_A01',
};

export function buildAdt(adt: AdtMessage, delimiters: Delimiters = DEFAULT_DELIMITERS): string {
  const structure = ADT_STRUCTURE[adt.event];
  const segments: Segment[] = [
    buildMsh(adt.header, 'ADT', adt.event, structure, delimiters),
    // EVN carries when the event happened, which is not when the message was
    // sent. A registration entered at nine and transmitted at eleven is two
    // hours of difference that matters to anybody reconciling a timeline.
    buildSegment('EVN', { 1: adt.event, 2: hl7Instant(adt.occurredAt) }, delimiters),
    buildPid(adt.patient, delimiters),
  ];
  if (adt.visit !== undefined) segments.push(buildPv1(adt.visit, delimiters));

  return renderMessage(message(segments));
}

export function parseAdt(raw: string): AdtMessage {
  const parsed = parseMessage(raw);
  const { delimiters } = parsed;
  const msh = requireSegment(parsed, 'MSH');

  const type = readMessageType(msh, delimiters);
  if (type !== 'ADT') {
    throw new Hl7Error(`Expected an ADT message, received ${type === '' ? 'no type' : type}.`);
  }

  const event = readTriggerEvent(msh, delimiters);
  if (!isAdtEvent(event)) {
    throw new Hl7Error(
      `This codec handles ADT ${Object.keys(ADT_STRUCTURE).join(', ')}; this message is ${event === '' ? 'untyped' : event}.`
    );
  }

  const evn = segmentNamed(parsed, 'EVN');
  const visit = readPv1(segmentNamed(parsed, 'PV1'), delimiters);

  return {
    header: readMsh(msh, delimiters),
    event,
    // The event time, or the send time when the sender left EVN-2 empty. A
    // sender that omits it has not said the event happened at an unknown time;
    // it has said nothing, and the send time is the closest honest answer.
    occurredAt: fromHl7(field(evn, 2, delimiters)) ?? fromHl7(field(msh, 7, delimiters)) ?? '',
    patient: readPid(segmentNamed(parsed, 'PID'), delimiters),
    ...(visit === undefined ? {} : { visit }),
  };
}

function isAdtEvent(value: string): value is AdtEvent {
  return Object.hasOwn(ADT_STRUCTURE, value);
}

/* ------------------------------------------------------------------ ORU -- */

export function buildOru(oru: OruMessage, delimiters: Delimiters = DEFAULT_DELIMITERS): string {
  const segments: Segment[] = [
    buildMsh(oru.header, 'ORU', 'R01', 'ORU_R01', delimiters),
    buildPid(oru.patient, delimiters),
  ];
  if (oru.visit !== undefined) segments.push(buildPv1(oru.visit, delimiters));

  for (const [orderIndex, order] of oru.orders.entries()) {
    segments.push(buildObr(order, orderIndex + 1, delimiters));
    for (const [resultIndex, result] of order.results.entries()) {
      segments.push(buildObx(result, resultIndex + 1, delimiters));
      for (const [noteIndex, note] of (result.notes ?? []).entries()) {
        segments.push(buildSegment('NTE', { 1: String(noteIndex + 1), 3: note }, delimiters));
      }
    }
  }

  return renderMessage(message(segments));
}

function buildObr(order: ObservationRequest, sequence: number, delimiters: Delimiters): Segment {
  return buildSegment(
    'OBR',
    {
      1: String(sequence),
      2: order.placerOrderNumber,
      3: order.fillerOrderNumber ?? '',
      4: writeCoded(order.service),
      6: order.requestedAt === undefined ? '' : writeTime(order.requestedAt),
      7: order.observedAt === undefined ? '' : writeTime(order.observedAt),
      16: writeProvider(order.orderingProviderId, order.orderingProviderName),
    },
    delimiters
  );
}

function buildObx(result: ObservationResult, sequence: number, delimiters: Delimiters): Segment {
  return buildSegment(
    'OBX',
    {
      1: String(sequence),
      2: result.valueType,
      3: writeCoded(result.identifier),
      // The value out of an inbound result, when this is a forward. A parsed
      // `\X0D\` decodes to a real carriage return, so before escaping covered
      // it this one field could append an OBX the sender never wrote.
      5: result.value,
      6: result.units ?? '',
      7: result.referenceRange ?? '',
      8: result.abnormalFlag ?? '',
      11: result.status,
      14: result.observedAt === undefined ? '' : writeTime(result.observedAt),
    },
    delimiters
  );
}

export function parseOru(raw: string): OruMessage {
  const parsed = parseMessage(raw);
  const { delimiters } = parsed;
  const msh = requireSegment(parsed, 'MSH');
  assertType(msh, 'ORU', delimiters);

  const visit = readPv1(segmentNamed(parsed, 'PV1'), delimiters);

  return {
    header: readMsh(msh, delimiters),
    patient: readPid(segmentNamed(parsed, 'PID'), delimiters),
    ...(visit === undefined ? {} : { visit }),
    orders: groupBy(parsed.segments, 'OBR', ['OBX', 'NTE']).map((group) =>
      readObrGroup(group, delimiters)
    ),
  };
}

function readObrGroup(group: readonly Segment[], delimiters: Delimiters): ObservationRequest {
  const obr = group[0];
  const filler = field(obr, 3, delimiters);
  const requested = fromHl7(field(obr, 6, delimiters));
  const observed = fromHl7(field(obr, 7, delimiters));
  const providerId = component(obr, 16, 1, delimiters);
  const providerName = component(obr, 16, 2, delimiters);

  // NTE follows the OBX it annotates, so notes accumulate onto the result most
  // recently seen. A note before the first OBX belongs to the order rather than
  // to a result, and is dropped rather than attached to the first one.
  const results: ObservationResult[] = [];
  for (const segment of group.slice(1)) {
    if (segment.id === 'OBX') {
      results.push(readObx(segment, delimiters));
      continue;
    }
    const last = results[results.length - 1];
    if (last === undefined) continue;
    results[results.length - 1] = {
      ...last,
      notes: [...(last.notes ?? []), field(segment, 3, delimiters)],
    };
  }

  return {
    placerOrderNumber: component(obr, 2, 1, delimiters),
    ...(filler === '' ? {} : { fillerOrderNumber: filler }),
    service: readCoded(obr, 4, delimiters) ?? { code: '' },
    ...(requested === undefined ? {} : { requestedAt: requested }),
    ...(observed === undefined ? {} : { observedAt: observed }),
    ...(providerId === '' ? {} : { orderingProviderId: providerId }),
    ...(providerName === '' ? {} : { orderingProviderName: providerName }),
    results,
  };
}

function readObx(segment: Segment, delimiters: Delimiters): ObservationResult {
  const units = field(segment, 6, delimiters);
  const range = field(segment, 7, delimiters);
  const flag = field(segment, 8, delimiters);
  const observed = fromHl7(field(segment, 14, delimiters));

  return {
    valueType: field(segment, 2, delimiters),
    identifier: readCoded(segment, 3, delimiters) ?? { code: '' },
    value: field(segment, 5, delimiters),
    ...(units === '' ? {} : { units }),
    ...(range === '' ? {} : { referenceRange: range }),
    ...(flag === '' ? {} : { abnormalFlag: flag }),
    // `F` when the sender left it empty. An unstated status on a result is one a
    // receiving system must not file as final, but every real interface omits
    // it on final results, so the default matches the traffic and the field is
    // read when it is there.
    status: field(segment, 11, delimiters) === '' ? 'F' : field(segment, 11, delimiters),
    ...(observed === undefined ? {} : { observedAt: observed }),
  };
}

/* ------------------------------------------------------------------ ORM -- */

export function buildOrm(orm: OrmMessage, delimiters: Delimiters = DEFAULT_DELIMITERS): string {
  const segments: Segment[] = [
    buildMsh(orm.header, 'ORM', 'O01', 'ORM_O01', delimiters),
    buildPid(orm.patient, delimiters),
  ];
  if (orm.visit !== undefined) segments.push(buildPv1(orm.visit, delimiters));

  for (const [index, order] of orm.orders.entries()) {
    segments.push(
      buildSegment(
        'ORC',
        {
          1: order.orderControl,
          2: order.placerOrderNumber,
          3: order.fillerOrderNumber ?? '',
          9: order.requestedAt === undefined ? '' : writeTime(order.requestedAt),
          12: writeProvider(order.orderingProviderId, order.orderingProviderName),
        },
        delimiters
      )
    );
    segments.push(
      buildSegment(
        'OBR',
        {
          1: String(index + 1),
          2: order.placerOrderNumber,
          3: order.fillerOrderNumber ?? '',
          4: writeCoded(order.service),
          6: order.requestedAt === undefined ? '' : writeTime(order.requestedAt),
          16: writeProvider(order.orderingProviderId, order.orderingProviderName),
          27: order.priority ?? '',
        },
        delimiters
      )
    );
    for (const [noteIndex, note] of (order.notes ?? []).entries()) {
      segments.push(buildSegment('NTE', { 1: String(noteIndex + 1), 3: note }, delimiters));
    }
  }

  return renderMessage(message(segments));
}

export function parseOrm(raw: string): OrmMessage {
  const parsed = parseMessage(raw);
  const { delimiters } = parsed;
  const msh = requireSegment(parsed, 'MSH');
  assertType(msh, 'ORM', delimiters);

  const visit = readPv1(segmentNamed(parsed, 'PV1'), delimiters);

  return {
    header: readMsh(msh, delimiters),
    patient: readPid(segmentNamed(parsed, 'PID'), delimiters),
    ...(visit === undefined ? {} : { visit }),
    orders: groupBy(parsed.segments, 'ORC', ['OBR', 'NTE']).map((group) =>
      readOrcGroup(group, delimiters)
    ),
  };
}

function readOrcGroup(group: readonly Segment[], delimiters: Delimiters): OrmOrder {
  const orc = group[0];
  const obr = group.find((segment) => segment.id === 'OBR');
  const notes = group
    .filter((segment) => segment.id === 'NTE')
    .map((segment) => field(segment, 3, delimiters));

  const filler = field(orc, 3, delimiters);
  const requested = fromHl7(field(orc, 9, delimiters));
  const providerId = component(orc, 12, 1, delimiters);
  const providerName = component(orc, 12, 2, delimiters);
  const priority = field(obr, 27, delimiters);

  return {
    placerOrderNumber: component(orc, 2, 1, delimiters),
    ...(filler === '' ? {} : { fillerOrderNumber: filler }),
    orderControl: field(orc, 1, delimiters),
    service: readCoded(obr, 4, delimiters) ?? { code: '' },
    ...(requested === undefined ? {} : { requestedAt: requested }),
    ...(providerId === '' ? {} : { orderingProviderId: providerId }),
    ...(providerName === '' ? {} : { orderingProviderName: providerName }),
    ...(priority === '' ? {} : { priority }),
    ...(notes.length === 0 ? {} : { notes }),
  };
}

/* ------------------------------------------------------------------ VXU -- */

export function buildVxu(vxu: VxuMessage, delimiters: Delimiters = DEFAULT_DELIMITERS): string {
  const segments: Segment[] = [
    buildMsh(vxu.header, 'VXU', 'V04', 'VXU_V04', delimiters),
    buildPid(vxu.patient, delimiters),
  ];

  for (const immunisation of vxu.immunisations) {
    segments.push(
      buildSegment('ORC', { 1: 'RE', 3: String(immunisation.sequence) }, delimiters),
      buildRxa(immunisation, delimiters)
    );
  }

  return renderMessage(message(segments));
}

function buildRxa(immunisation: Immunisation, delimiters: Delimiters): Segment {
  return buildSegment(
    'RXA',
    {
      // RXA-1 and RXA-2 are the give sub-id pair; a single administration is 0/1,
      // which is what every registry expects and what nothing else parses.
      1: '0',
      2: String(immunisation.sequence),
      3: writeTime(immunisation.administeredAt),
      5: writeCoded(immunisation.vaccine),
      // `999` is the code for "amount not recorded". A registry reading an empty
      // amount cannot tell it from a zero dose.
      6: immunisation.amount ?? '999',
      7: immunisation.units ?? '',
      9: writeCoded(immunisation.route),
      10: writeProvider(immunisation.administeringProviderId, undefined),
      11: writeCoded(immunisation.site),
      // A lot number is transcribed off a vial by hand and stored as free text,
      // so it is exactly the sort of field an injected separator arrives in.
      15: immunisation.lotNumber ?? '',
      17: writeCoded(immunisation.manufacturer),
      20: immunisation.completionStatus,
    },
    delimiters
  );
}

export function parseVxu(raw: string): VxuMessage {
  const parsed = parseMessage(raw);
  const { delimiters } = parsed;
  const msh = requireSegment(parsed, 'MSH');
  assertType(msh, 'VXU', delimiters);

  return {
    header: readMsh(msh, delimiters),
    patient: readPid(segmentNamed(parsed, 'PID'), delimiters),
    immunisations: parsed.segments
      .filter((segment) => segment.id === 'RXA')
      .map((segment, index) => readRxa(segment, index + 1, delimiters)),
  };
}

function readRxa(segment: Segment, fallbackSequence: number, delimiters: Delimiters): Immunisation {
  const amount = field(segment, 6, delimiters);
  const units = field(segment, 7, delimiters);
  const lot = field(segment, 15, delimiters);
  const provider = component(segment, 10, 1, delimiters);
  const sequence = Number.parseInt(field(segment, 2, delimiters), 10);

  return {
    sequence: Number.isInteger(sequence) ? sequence : fallbackSequence,
    vaccine: readCoded(segment, 5, delimiters) ?? { code: '' },
    administeredAt: fromHl7(field(segment, 3, delimiters)) ?? '',
    // `999` means the sender did not record an amount, so it comes back absent
    // rather than as a dose of nine hundred and ninety-nine units.
    ...(amount === '' || amount === '999' ? {} : { amount }),
    ...(units === '' ? {} : { units }),
    ...(lot === '' ? {} : { lotNumber: lot }),
    ...(readCoded(segment, 17, delimiters) === undefined
      ? {}
      : { manufacturer: readCoded(segment, 17, delimiters) }),
    ...(readCoded(segment, 9, delimiters) === undefined
      ? {}
      : { route: readCoded(segment, 9, delimiters) }),
    ...(readCoded(segment, 11, delimiters) === undefined
      ? {}
      : { site: readCoded(segment, 11, delimiters) }),
    completionStatus: field(segment, 20, delimiters) === '' ? 'CP' : field(segment, 20, delimiters),
    ...(provider === '' ? {} : { administeringProviderId: provider }),
  };
}

/* ------------------------------------------------------------------ ACK -- */

/**
 * The acknowledgement.
 *
 * Every message this practice receives is answered with one, and the answer is
 * how the sender learns whether to retry. An interface that accepts silently is
 * one where a laboratory believes a result was filed that never was.
 */
export function buildAck(
  ack: Acknowledgement,
  delimiters: Delimiters = DEFAULT_DELIMITERS
): string {
  return renderMessage(
    message([
      buildMsh(ack.header, 'ACK', 'R01', 'ACK', delimiters),
      buildSegment(
        'MSA',
        {
          1: ack.code,
          // Echoed straight back off the message being acknowledged, which makes
          // it the shortest path from an inbound value to an outbound segment.
          2: ack.acknowledgedControlId,
          3: ack.text ?? '',
        },
        delimiters
      ),
    ])
  );
}

export function parseAck(raw: string): Acknowledgement {
  const parsed = parseMessage(raw);
  const { delimiters } = parsed;
  const msa = requireSegment(parsed, 'MSA');
  const code = field(msa, 1, delimiters);
  const text = field(msa, 3, delimiters);

  if (code !== 'AA' && code !== 'AE' && code !== 'AR') {
    throw new Hl7Error(
      `MSA-1 is ${code === '' ? 'empty' : code}, which is not an acknowledgement code.`
    );
  }

  return {
    header: readMsh(requireSegment(parsed, 'MSH'), delimiters),
    code,
    acknowledgedControlId: field(msa, 2, delimiters),
    ...(text === '' ? {} : { text }),
  };
}

/**
 * Acknowledges a message that arrived, without needing it parsed first.
 *
 * A message that failed to parse still has to be answered, and it is exactly the
 * message whose control id matters most - so the sender can name it in a
 * support call. Reading MSH-10 out of the raw text is the most this can do for a
 * message it could not otherwise read.
 */
export function acknowledge(
  raw: string,
  header: MessageHeaderForAck,
  outcome: { code: Acknowledgement['code']; text?: string }
): string {
  let controlId = '';
  try {
    const parsed = parseMessage(raw);
    controlId = field(requireSegment(parsed, 'MSH'), 10, parsed.delimiters);
  } catch {
    controlId = '';
  }

  return buildAck({
    header,
    code: outcome.code,
    acknowledgedControlId: controlId,
    ...(outcome.text === undefined ? {} : { text: outcome.text }),
  });
}

/** The header fields an acknowledgement needs; the rest are derived. */
type MessageHeaderForAck = Acknowledgement['header'];

function assertType(msh: Segment, expected: string, delimiters: Delimiters): void {
  const type = readMessageType(msh, delimiters);
  if (type !== expected) {
    throw new Hl7Error(
      `Expected a ${expected} message, received ${type === '' ? 'no type' : type}.`
    );
  }
}

/** The parsed message, for a caller that wants to inspect one this codec does not model. */
export function inspect(raw: string): Hl7Message {
  return parseMessage(raw);
}

export { joinComponents };
