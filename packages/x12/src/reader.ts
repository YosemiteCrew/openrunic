import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { detectDelimiters } from './delimiters.js';
import type { Delimiters } from './delimiters.js';
import type { X12Error } from './errors.js';
import { readSegments, simpleAt } from './segments.js';
import type { Segment } from './segments.js';

/**
 * The envelope reader: ISA/GS/ST in, a validated tree out.
 *
 * Everything above this line in the package is bytes; everything below it is
 * transaction sets. The split exists so that an envelope bug cannot corrupt
 * mapping logic and a mapping bug cannot be mistaken for an envelope bug. A
 * mapper is only ever handed the segments strictly between an ST and its SE,
 * with the counts and control numbers already reconciled, so it never has to
 * ask whether it is looking at a trailer.
 *
 * Reconciliation is not optional. SE01, GE01 and IEA01 are the standard's own
 * checksums, and a document whose counts disagree with its contents has been
 * truncated, concatenated or re-wrapped somewhere in transport. Mapping it
 * anyway is how a payment gets posted against half a remittance.
 */

/** One transaction set: the ST header, its body, and its SE trailer. */
export interface X12Transaction {
  /** ST01, e.g. `837`, `835`, `277`, `999`, `270`, `271`. */
  readonly setIdentifier: string;
  /** ST02, echoed by SE02. */
  readonly controlNumber: string;
  /** ST03, the implementation convention reference, e.g. `005010X222A1`. */
  readonly implementationConvention: string;
  /** The segments strictly between ST and SE. */
  readonly segments: readonly Segment[];
  /** Index of the ST segment within the whole interchange, for error locations. */
  readonly startIndex: number;
}

/** One functional group: GS, its transaction sets, and GE. */
export interface X12FunctionalGroup {
  /** GS01, e.g. `HC` for claims, `HP` for remittance, `FA` for acknowledgement. */
  readonly functionalIdentifier: string;
  readonly applicationSender: string;
  readonly applicationReceiver: string;
  readonly date: string;
  readonly time: string;
  /** GS06, echoed by GE02. */
  readonly controlNumber: string;
  /** GS08, the version and implementation convention. */
  readonly version: string;
  readonly transactions: readonly X12Transaction[];
}

/** A whole interchange, delimiters included so a caller can re-emit it. */
export interface X12Interchange {
  readonly delimiters: Delimiters;
  readonly isa: Segment;
  /** ISA13, echoed by IEA02. */
  readonly controlNumber: string;
  /** ISA15: `P` for production, `T` for test. Worth surfacing loudly. */
  readonly usageIndicator: string;
  readonly groups: readonly X12FunctionalGroup[];
}

/**
 * Parses and reconciles a complete interchange.
 *
 * Fails closed: any structural problem returns an error rather than a partial
 * tree, because a caller holding half an interchange has no safe move.
 */
export function readInterchange(raw: string): Result<X12Interchange, X12Error> {
  const delimiters = detectDelimiters(raw);
  if (!delimiters.ok) return delimiters;

  // A document that reaches this line has already produced four valid
  // delimiters out of a 106 character ISA, so it necessarily tokenizes to at
  // least one segment. The `undefined` arm below is therefore a type guard
  // rather than a reachable state, and is folded into the "not an ISA" check
  // rather than given a branch of its own.
  const segments = readSegments(raw, delimiters.value);
  const isa = segments[0];
  if (isa === undefined || isa.tag !== 'ISA') {
    return err({
      kind: 'malformed_envelope',
      message: 'the first segment is not ISA',
      at: { segmentIndex: 0, segmentTag: isa?.tag ?? '' },
    });
  }

  const groups: X12FunctionalGroup[] = [];
  let index = 1;
  let iea: Segment | undefined;

  while (index < segments.length) {
    const current = segments[index];
    if (current === undefined) break;

    if (current.tag === 'IEA') {
      // Nothing advances the cursor here, deliberately. IEA closes the
      // interchange, so the loop is finished and no later line reads `index` -
      // the trailer checks below work from `iea` and `groups`. The increment
      // that used to sit here looked like bookkeeping and was dead, which is
      // what `no-useless-assignment` reports.
      iea = current;
      break;
    }

    if (current.tag !== 'GS') {
      return err({
        kind: 'unexpected_segment',
        message: `expected GS or IEA at the interchange level, found ${current.tag}`,
        at: { segmentIndex: index, segmentTag: current.tag },
        expected: ['GS', 'IEA'],
        actual: current.tag,
      });
    }

    const group = readGroup(segments, index, current);
    if (!group.ok) return group;
    groups.push(group.value.group);
    index = group.value.nextIndex;
  }

  if (iea === undefined) {
    return err({
      kind: 'malformed_envelope',
      message: 'the interchange has no IEA trailer',
      at: { segmentIndex: segments.length - 1, segmentTag: 'ISA' },
    });
  }

  const interchangeControl = simpleAt(isa, 13);
  const trailerControl = simpleAt(iea, 2);
  if (interchangeControl !== trailerControl) {
    return err({
      kind: 'control_mismatch',
      message: 'IEA02 does not echo ISA13',
      level: 'interchange',
      header: interchangeControl,
      trailer: trailerControl,
    });
  }

  const declaredGroups = Number(simpleAt(iea, 1));
  if (!Number.isInteger(declaredGroups) || declaredGroups !== groups.length) {
    return err({
      kind: 'count_mismatch',
      message: 'IEA01 does not match the number of functional groups present',
      level: 'interchange',
      counter: 'IEA01',
      declared: Number.isInteger(declaredGroups) ? declaredGroups : Number.NaN,
      actual: groups.length,
    });
  }

  return ok({
    delimiters: delimiters.value,
    isa,
    controlNumber: interchangeControl,
    usageIndicator: simpleAt(isa, 15),
    groups,
  });
}

interface GroupCursor {
  readonly group: X12FunctionalGroup;
  readonly nextIndex: number;
}

function readGroup(
  segments: readonly Segment[],
  startIndex: number,
  gs: Segment
): Result<GroupCursor, X12Error> {
  const transactions: X12Transaction[] = [];
  let index = startIndex + 1;
  let ge: Segment | undefined;

  while (index < segments.length) {
    const current = segments[index];
    if (current === undefined) break;

    if (current.tag === 'GE') {
      ge = current;
      index += 1;
      break;
    }

    if (current.tag !== 'ST') {
      return err({
        kind: 'unexpected_segment',
        message: `expected ST or GE inside a functional group, found ${current.tag}`,
        at: { segmentIndex: index, segmentTag: current.tag },
        expected: ['ST', 'GE'],
        actual: current.tag,
      });
    }

    const transaction = readTransaction(segments, index, current);
    if (!transaction.ok) return transaction;
    transactions.push(transaction.value.transaction);
    index = transaction.value.nextIndex;
  }

  if (ge === undefined) {
    return err({
      kind: 'malformed_envelope',
      message: 'the functional group has no GE trailer',
      at: { segmentIndex: startIndex, segmentTag: 'GS' },
    });
  }

  const headerControl = simpleAt(gs, 6);
  const trailerControl = simpleAt(ge, 2);
  if (headerControl !== trailerControl) {
    return err({
      kind: 'control_mismatch',
      message: 'GE02 does not echo GS06',
      level: 'group',
      header: headerControl,
      trailer: trailerControl,
    });
  }

  const declared = Number(simpleAt(ge, 1));
  if (!Number.isInteger(declared) || declared !== transactions.length) {
    return err({
      kind: 'count_mismatch',
      message: 'GE01 does not match the number of transaction sets present',
      level: 'group',
      counter: 'GE01',
      declared: Number.isInteger(declared) ? declared : Number.NaN,
      actual: transactions.length,
    });
  }

  return ok({
    group: {
      functionalIdentifier: simpleAt(gs, 1),
      applicationSender: simpleAt(gs, 2),
      applicationReceiver: simpleAt(gs, 3),
      date: simpleAt(gs, 4),
      time: simpleAt(gs, 5),
      controlNumber: headerControl,
      version: simpleAt(gs, 8),
      transactions,
    },
    nextIndex: index,
  });
}

interface TransactionCursor {
  readonly transaction: X12Transaction;
  readonly nextIndex: number;
}

function readTransaction(
  segments: readonly Segment[],
  startIndex: number,
  st: Segment
): Result<TransactionCursor, X12Error> {
  const body: Segment[] = [];
  let index = startIndex + 1;
  let se: Segment | undefined;

  while (index < segments.length) {
    const current = segments[index];
    if (current === undefined) break;
    if (current.tag === 'SE') {
      se = current;
      index += 1;
      break;
    }
    if (current.tag === 'ST' || current.tag === 'GE' || current.tag === 'IEA') {
      return err({
        kind: 'unexpected_segment',
        message: `the transaction set is not terminated by SE before ${current.tag}`,
        at: { segmentIndex: index, segmentTag: current.tag },
        expected: ['SE'],
        actual: current.tag,
      });
    }
    body.push(current);
    index += 1;
  }

  if (se === undefined) {
    return err({
      kind: 'malformed_envelope',
      message: 'the transaction set has no SE trailer',
      at: { segmentIndex: startIndex, segmentTag: 'ST' },
    });
  }

  const headerControl = simpleAt(st, 2);
  const trailerControl = simpleAt(se, 2);
  if (headerControl !== trailerControl) {
    return err({
      kind: 'control_mismatch',
      message: 'SE02 does not echo ST02',
      level: 'transaction',
      header: headerControl,
      trailer: trailerControl,
    });
  }

  // SE01 counts every segment from ST through SE inclusive, which is why the
  // body length gets two added rather than being compared directly.
  const declared = Number(simpleAt(se, 1));
  const actual = body.length + 2;
  if (!Number.isInteger(declared) || declared !== actual) {
    return err({
      kind: 'count_mismatch',
      message: 'SE01 does not match the number of segments in the transaction set',
      level: 'transaction',
      counter: 'SE01',
      declared: Number.isInteger(declared) ? declared : Number.NaN,
      actual,
    });
  }

  return ok({
    transaction: {
      setIdentifier: simpleAt(st, 1),
      controlNumber: headerControl,
      implementationConvention: simpleAt(st, 3),
      segments: body,
      startIndex,
    },
    nextIndex: index,
  });
}

/**
 * Pulls the single transaction set of a given type out of an interchange.
 *
 * Every decoder in this package handles one transaction at a time, because the
 * lifecycle services process one remittance or one acknowledgement at a time.
 * This helper centralizes the "is this even the right document" check so each
 * decoder does not repeat it, and so the `unsupported_transaction` error reads
 * identically no matter which decoder produced it.
 */
export function firstTransactionOfType(
  interchange: X12Interchange,
  setIdentifier: string
): Result<X12Transaction, X12Error> {
  const found: string[] = [];
  for (const group of interchange.groups) {
    for (const transaction of group.transactions) {
      if (transaction.setIdentifier === setIdentifier) return ok(transaction);
      found.push(transaction.setIdentifier);
    }
  }
  return err({
    kind: 'unsupported_transaction',
    message: `expected a ${setIdentifier} transaction set, the interchange carries ${
      found.length === 0 ? 'none' : found.join(', ')
    }`,
    transactionSet: found[0] ?? '',
    supported: [setIdentifier],
  });
}
