import { ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { X12Error } from './errors.js';
import { firstTransactionOfType, readInterchange } from './reader.js';
import type { X12Transaction } from './reader.js';
import { componentAt, simpleAt } from './segments.js';
import type { Segment } from './segments.js';

/**
 * The 999 implementation acknowledgement decoder.
 *
 * A 999 answers one question: did the syntax survive? It arrives within
 * minutes of a submission, long before any payer looks at the clinical
 * content, and a rejection here means the claim never entered adjudication at
 * all. That makes it the fastest feedback loop the billing system has, and the
 * reason this decoder keeps the segment and element error detail rather than
 * just the accept flag: `IK3` and `IK4` name the exact segment and element
 * that failed, which is what turns "the payer rejected it" into a fixable bug
 * in an encoder or a data-entry error on a claim.
 */

/** IK4: one element inside a failing segment. */
export interface ElementError {
  /** IK401-1, the element's position within its segment. */
  readonly elementPosition: number;
  /** IK401-2, the component position when the fault is inside a composite. */
  readonly componentPosition?: number;
  /** IK401-3, the occurrence when the element repeats. */
  readonly repeatPosition?: number;
  /** IK402, the data-element reference number. */
  readonly referenceNumber?: string;
  /** IK403, the implementation data element syntax error code. */
  readonly errorCode: string;
  /** IK404, the value that was rejected. Echoed back by the acknowledger. */
  readonly badValue?: string;
}

/** IK3: one failing segment, with whichever of its elements were named. */
export interface SegmentError {
  /** IK301, the segment's tag. */
  readonly segmentId: string;
  /** IK302, its position in the transaction set, counting ST as 1. */
  readonly segmentPosition: number;
  /** IK303, the loop it sits in. */
  readonly loopIdentifier?: string;
  /** IK304, the implementation segment syntax error code. */
  readonly errorCode?: string;
  readonly elementErrors: readonly ElementError[];
}

/** AK2 and IK5: one acknowledged transaction set. */
export interface TransactionAck {
  /** AK201, e.g. `837`. */
  readonly setIdentifier: string;
  /** AK202, echoing the ST02 we sent, which is how this is matched to a claim. */
  readonly controlNumber: string;
  /** AK203. */
  readonly implementationConvention?: string;
  /** IK501: `A` accepted, `E` accepted with errors, `R` rejected. */
  readonly acknowledgementCode: string;
  /** IK502 through IK506. */
  readonly errorCodes: readonly string[];
  readonly segmentErrors: readonly SegmentError[];
  /** True when the transaction set entered processing, which `E` also does. */
  readonly accepted: boolean;
}

/** AK9: the verdict on the functional group as a whole. */
export interface GroupAck {
  /** AK901: `A`, `E`, `P` partially accepted, `R` rejected. */
  readonly acknowledgementCode: string;
  readonly setsIncluded: number;
  readonly setsReceived: number;
  readonly setsAccepted: number;
  /** AK905 through AK909. */
  readonly errorCodes: readonly string[];
}

/** A decoded implementation acknowledgement. */
export interface AckReport999 {
  /** AK1: which functional group is being acknowledged. */
  readonly functionalGroup: {
    /** AK101, e.g. `HC`. */
    readonly identifier: string;
    /** AK102, echoing the GS06 we sent. */
    readonly controlNumber: string;
    /** AK103. */
    readonly version?: string;
  };
  readonly transactions: readonly TransactionAck[];
  readonly group: GroupAck;
  /** True when nothing in the group was rejected outright. */
  readonly accepted: boolean;
  readonly controlNumbers: {
    readonly interchange: string;
    readonly transaction: string;
  };
}

/** The implementation convention this decoder expects. */
export const IMPLEMENTATION_999 = '005010X231A1';

/**
 * Acknowledgement codes that mean the content entered processing.
 *
 * `E` is in the list on purpose: "accepted, but there were errors" means the
 * claim is being adjudicated and the errors are advisory. Treating `E` as a
 * failure would stall claims that are in fact being paid.
 */
export const ACCEPTED_ACK_CODES: readonly string[] = ['A', 'E', 'P'];

/** Decodes a complete 999 interchange. */
export function decode999(raw: string): Result<AckReport999, X12Error> {
  const interchange = readInterchange(raw);
  if (!interchange.ok) return interchange;

  const transaction = firstTransactionOfType(interchange.value, '999');
  if (!transaction.ok) return transaction;

  const report = mapAck(transaction.value);

  return ok({
    ...report,
    controlNumbers: {
      interchange: interchange.value.controlNumber,
      transaction: transaction.value.controlNumber,
    },
  });
}

type PartialAck = Omit<AckReport999, 'controlNumbers'>;

function mapAck(transaction: X12Transaction): PartialAck {
  let identifier = '';
  let controlNumber = '';
  let version: string | undefined;
  const transactions: TransactionAck[] = [];
  let group: GroupAck = {
    acknowledgementCode: '',
    setsIncluded: 0,
    setsReceived: 0,
    setsAccepted: 0,
    errorCodes: [],
  };

  let current: MutableTransactionAck | undefined;
  let currentSegmentError: MutableSegmentError | undefined;

  const finishSegmentError = (): void => {
    if (current !== undefined && currentSegmentError !== undefined) {
      current.segmentErrors.push({
        ...currentSegmentError,
        elementErrors: [...currentSegmentError.elementErrors],
      });
    }
    currentSegmentError = undefined;
  };
  const finishTransaction = (): void => {
    finishSegmentError();
    if (current !== undefined) {
      transactions.push({
        ...current,
        errorCodes: [...current.errorCodes],
        segmentErrors: [...current.segmentErrors],
        accepted: ACCEPTED_ACK_CODES.includes(current.acknowledgementCode),
      });
    }
    current = undefined;
  };

  for (const source of transaction.segments) {
    switch (source.tag) {
      case 'AK1': {
        identifier = simpleAt(source, 1);
        controlNumber = simpleAt(source, 2);
        version = emptyToUndefined(simpleAt(source, 3));
        break;
      }
      case 'AK2': {
        finishTransaction();
        current = {
          setIdentifier: simpleAt(source, 1),
          controlNumber: simpleAt(source, 2),
          implementationConvention: emptyToUndefined(simpleAt(source, 3)),
          acknowledgementCode: '',
          errorCodes: [],
          segmentErrors: [],
        };
        break;
      }
      case 'IK3': {
        finishSegmentError();
        if (current === undefined) break;
        currentSegmentError = {
          segmentId: simpleAt(source, 1),
          segmentPosition: Number(simpleAt(source, 2)),
          loopIdentifier: emptyToUndefined(simpleAt(source, 3)),
          errorCode: emptyToUndefined(simpleAt(source, 4)),
          elementErrors: [],
        };
        break;
      }
      case 'IK4': {
        if (currentSegmentError === undefined) break;
        currentSegmentError.elementErrors.push(readElementError(source));
        break;
      }
      case 'IK5': {
        finishSegmentError();
        if (current === undefined) break;
        current.acknowledgementCode = simpleAt(source, 1);
        current.errorCodes = collectCodes(source, 2, 6);
        break;
      }
      case 'AK9': {
        finishTransaction();
        group = {
          acknowledgementCode: simpleAt(source, 1),
          setsIncluded: toCount(simpleAt(source, 2)),
          setsReceived: toCount(simpleAt(source, 3)),
          setsAccepted: toCount(simpleAt(source, 4)),
          errorCodes: collectCodes(source, 5, 9),
        };
        break;
      }
      default:
        break;
    }
  }

  finishTransaction();

  return {
    functionalGroup: { identifier, controlNumber, version },
    transactions,
    group,
    accepted: ACCEPTED_ACK_CODES.includes(group.acknowledgementCode),
  };
}

interface MutableTransactionAck {
  setIdentifier: string;
  controlNumber: string;
  implementationConvention?: string;
  acknowledgementCode: string;
  errorCodes: readonly string[];
  segmentErrors: SegmentError[];
}

interface MutableSegmentError {
  segmentId: string;
  segmentPosition: number;
  loopIdentifier?: string;
  errorCode?: string;
  elementErrors: ElementError[];
}

function readElementError(source: Segment): ElementError {
  const component = componentAt(source, 1, 2);
  const repeat = componentAt(source, 1, 3);
  return {
    elementPosition: Number(componentAt(source, 1, 1)),
    componentPosition: component === '' ? undefined : Number(component),
    repeatPosition: repeat === '' ? undefined : Number(repeat),
    referenceNumber: emptyToUndefined(simpleAt(source, 2)),
    errorCode: simpleAt(source, 3),
    badValue: emptyToUndefined(simpleAt(source, 4)),
  };
}

function collectCodes(source: Segment, from: number, to: number): readonly string[] {
  const codes: string[] = [];
  for (let position = from; position <= to; position += 1) {
    const value = simpleAt(source, position);
    if (value !== '') codes.push(value);
  }
  return codes;
}

/** A missing or non-numeric count is read as zero rather than failing the parse. */
function toCount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyToUndefined(value: string): string | undefined {
  return value === '' ? undefined : value;
}

/**
 * The lifecycle decision a 999 drives, per transaction set we sent.
 *
 * Keyed by ST02 rather than by claim, because that is what the acknowledger
 * echoes and therefore the only thing that can be matched without guessing.
 */
export interface AckOutcome {
  /** The ST02 of the transaction set being acknowledged. */
  readonly transactionControlNumber: string;
  readonly accepted: boolean;
  /** A flat, renderable list of what failed, empty when accepted cleanly. */
  readonly faults: readonly string[];
}

/** Projects the acknowledgement into one outcome per submitted transaction set. */
export function toAckOutcomes(report: AckReport999): readonly AckOutcome[] {
  return report.transactions.map((transaction) => ({
    transactionControlNumber: transaction.controlNumber,
    accepted: transaction.accepted,
    faults: transaction.segmentErrors.flatMap((segmentError) => {
      const head = `${segmentError.segmentId} at position ${segmentError.segmentPosition}${
        segmentError.errorCode === undefined ? '' : ` (${segmentError.errorCode})`
      }`;
      if (segmentError.elementErrors.length === 0) return [head];
      return segmentError.elementErrors.map(
        (elementError) =>
          `${head}, element ${elementError.elementPosition} (${elementError.errorCode})`
      );
    }),
  }));
}
