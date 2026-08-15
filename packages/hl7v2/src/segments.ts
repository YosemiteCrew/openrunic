import type { Delimiters } from './encoding.js';
import type { CodedValue, MessageHeader, Patient, Visit } from './domain.js';
import { buildSegment, component, field, joinComponents, type Segment } from './message.js';
import { dateFromHl7, fromHl7, hl7Instant, writeTime } from './time.js';

/**
 * THE SEGMENTS EVERY MESSAGE IN THIS PACKAGE IS MADE OF.
 *
 * MSH, PID and PV1 appear in all four message types, so they are built and read
 * once here. The alternative - each message type assembling its own - is how one
 * interface comes to write the patient identifier in `PID-3` and another in
 * `PID-2`, both of which parse and only one of which the receiver can match on.
 *
 * Field numbers below are the standard's, and the comments name them, because
 * `PID-7` means nothing to a reader and "date of birth" means everything.
 */

/** `code^display^system`, the CE/CWE data type most fields use. */
export function writeCoded(value: CodedValue | undefined, delimiters: Delimiters): string {
  if (value === undefined) return '';
  return joinComponents([value.code, value.display ?? '', value.system ?? ''], delimiters);
}

export function readCoded(
  segment: Segment | undefined,
  number: number,
  delimiters: Delimiters
): CodedValue | undefined {
  const code = component(segment, number, 1, delimiters);
  if (code === '') return undefined;
  const display = component(segment, number, 2, delimiters);
  const system = component(segment, number, 3, delimiters);
  return {
    code,
    ...(display === '' ? {} : { display }),
    ...(system === '' ? {} : { system }),
  };
}

/**
 * MSH.
 *
 * `MSH-9` is the message type, written as `type^event^structure`: `ADT^A01^ADT_A01`.
 * All three components are written. A receiver that routes on the structure and
 * finds it missing has to guess from the event, and the guess is wrong for the
 * events that share a structure.
 */
export function buildMsh(
  header: MessageHeader,
  messageType: string,
  triggerEvent: string,
  structure: string,
  delimiters: Delimiters
): Segment {
  return buildSegment('MSH', {
    1: delimiters.field,
    2: `${delimiters.component}${delimiters.repetition}${delimiters.escape}${delimiters.subcomponent}`,
    3: header.sendingApplication,
    4: header.sendingFacility,
    5: header.receivingApplication,
    6: header.receivingFacility,
    7: hl7Instant(header.sentAt),
    9: joinComponents([messageType, triggerEvent, structure], delimiters),
    10: header.controlId,
    11: header.processingId,
    12: header.version,
  });
}

export function readMsh(segment: Segment, delimiters: Delimiters): MessageHeader {
  const processing = field(segment, 11, delimiters);
  return {
    sendingApplication: field(segment, 3, delimiters),
    sendingFacility: field(segment, 4, delimiters),
    receivingApplication: field(segment, 5, delimiters),
    receivingFacility: field(segment, 6, delimiters),
    sentAt: fromHl7(field(segment, 7, delimiters)) ?? '',
    controlId: field(segment, 10, delimiters),
    // Anything other than the three defined values is read as production. A
    // message whose processing id nobody set is one a receiver must treat as
    // real, because treating real traffic as a test is the failure that loses a
    // result silently.
    processingId: processing === 'T' || processing === 'D' ? processing : 'P',
    version: field(segment, 12, delimiters),
  };
}

/** The trigger event out of `MSH-9`, which is what a router switches on. */
export function readTriggerEvent(segment: Segment, delimiters: Delimiters): string {
  return component(segment, 9, 2, delimiters);
}

export function readMessageType(segment: Segment, delimiters: Delimiters): string {
  return component(segment, 9, 1, delimiters);
}

/**
 * PID.
 *
 * `PID-3` is the identifier list and `PID-5` the name. Both are repeating
 * fields in the standard; this codec writes one of each, which is what a
 * practice with a single medical record number has, and reads the first of each.
 */
export function buildPid(patient: Patient, delimiters: Delimiters): Segment {
  const address =
    patient.address === undefined
      ? ''
      : joinComponents(
          [
            patient.address.line1 ?? '',
            '',
            patient.address.city ?? '',
            patient.address.state ?? '',
            patient.address.postalCode ?? '',
            patient.address.country ?? '',
          ],
          delimiters
        );

  return buildSegment('PID', {
    1: '1',
    // `MR` is the identifier type: a medical record number rather than a social
    // security number or a driving licence, which the same field can carry.
    3: joinComponents([patient.mrn, '', '', '', 'MR'], delimiters),
    5: joinComponents(
      [patient.familyName, patient.givenName, patient.middleName ?? ''],
      delimiters
    ),
    7: patient.birthDate === undefined ? '' : writeTime(patient.birthDate),
    8: patient.sex ?? '',
    11: address,
    13: patient.phone ?? '',
    // `PID-30` is the death indicator and `PID-29` the date. Writing the date
    // without the indicator leaves a receiver deciding for itself whether a date
    // means the patient died.
    29: patient.deceasedAt === undefined ? '' : writeTime(patient.deceasedAt),
    30: patient.deceasedAt === undefined ? '' : 'Y',
  });
}

export function readPid(segment: Segment | undefined, delimiters: Delimiters): Patient {
  const sex = field(segment, 8, delimiters);
  const birth = dateFromHl7(field(segment, 7, delimiters));
  const deceased = fromHl7(field(segment, 29, delimiters));
  const middle = component(segment, 5, 3, delimiters);
  const phone = field(segment, 13, delimiters);
  const address = readAddress(segment, delimiters);

  return {
    mrn: component(segment, 3, 1, delimiters),
    familyName: component(segment, 5, 1, delimiters),
    givenName: component(segment, 5, 2, delimiters),
    ...(middle === '' ? {} : { middleName: middle }),
    ...(birth === undefined ? {} : { birthDate: birth }),
    ...(sex === 'M' || sex === 'F' || sex === 'O' || sex === 'U' ? { sex } : {}),
    ...(address === undefined ? {} : { address }),
    ...(phone === '' ? {} : { phone }),
    // The date alone is not a death notification. A sender that fills the date
    // and leaves the indicator empty has not said the patient died, and reading
    // it as if they had would put a date of death on a living person's chart.
    ...(deceased === undefined || field(segment, 30, delimiters) !== 'Y'
      ? {}
      : { deceasedAt: deceased }),
  };
}

function readAddress(segment: Segment | undefined, delimiters: Delimiters): Patient['address'] {
  const parts = {
    line1: component(segment, 11, 1, delimiters),
    city: component(segment, 11, 3, delimiters),
    state: component(segment, 11, 4, delimiters),
    postalCode: component(segment, 11, 5, delimiters),
    country: component(segment, 11, 6, delimiters),
  };

  const address = Object.fromEntries(
    Object.entries(parts).filter(([, value]) => value !== '')
  ) as NonNullable<Patient['address']>;

  return Object.keys(address).length === 0 ? undefined : address;
}

/** PV1: the visit. `PV1-2` is the patient class and `PV1-19` the visit number. */
export function buildPv1(visit: Visit, delimiters: Delimiters): Segment {
  return buildSegment('PV1', {
    1: '1',
    2: visit.patientClass,
    3: visit.location ?? '',
    7:
      visit.attendingProviderId === undefined
        ? ''
        : joinComponents(
            [visit.attendingProviderId, visit.attendingProviderName ?? ''],
            delimiters
          ),
    19: visit.visitNumber,
    44: visit.admittedAt === undefined ? '' : writeTime(visit.admittedAt),
    45: visit.dischargedAt === undefined ? '' : writeTime(visit.dischargedAt),
  });
}

export function readPv1(segment: Segment | undefined, delimiters: Delimiters): Visit | undefined {
  if (segment === undefined) return undefined;

  const location = field(segment, 3, delimiters);
  const providerId = component(segment, 7, 1, delimiters);
  const providerName = component(segment, 7, 2, delimiters);
  const admitted = fromHl7(field(segment, 44, delimiters));
  const discharged = fromHl7(field(segment, 45, delimiters));

  return {
    visitNumber: component(segment, 19, 1, delimiters),
    patientClass: field(segment, 2, delimiters),
    ...(location === '' ? {} : { location }),
    ...(providerId === '' ? {} : { attendingProviderId: providerId }),
    ...(providerName === '' ? {} : { attendingProviderName: providerName }),
    ...(admitted === undefined ? {} : { admittedAt: admitted }),
    ...(discharged === undefined ? {} : { dischargedAt: discharged }),
  };
}

/** A provider reference: `id^family^given`. */
export function writeProvider(
  id: string | undefined,
  name: string | undefined,
  delimiters: Delimiters
): string {
  if (id === undefined || id === '') return '';
  return joinComponents([id, name ?? ''], delimiters);
}
