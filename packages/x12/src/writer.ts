import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { formatInterchangeControlNumber, formatTransactionControlNumber } from './control.js';
import type { ControlNumbers } from './control.js';
import { DEFAULT_DELIMITERS, validateDelimiters } from './delimiters.js';
import type { Delimiters } from './delimiters.js';
import type { X12Error } from './errors.js';
import { formatDate6, formatDate8, formatTime4, padRight } from './format.js';
import { segment, writeSegment } from './segments.js';
import type { Segment } from './segments.js';

/**
 * The envelope writer: transaction bodies in, a wrapped interchange out.
 *
 * The mappers in this package produce only the segments between ST and SE.
 * They never write an ISA, never choose a control number and never count
 * anything. Every count element the standard defines as a self-check is
 * computed here from what was actually emitted, so the three ways a document
 * can lie about itself, SE01, GE01 and IEA01, are all structurally impossible
 * to get wrong. That is the entire reason this file is separate from the
 * mappers: a mapping bug can produce a wrong claim, but it cannot produce a
 * malformed envelope.
 */

/** A trading partner identifier as ISA and GS want it. */
export interface TradingPartnerAddress {
  /** ISA05 or ISA07, e.g. `ZZ` for mutually defined, `30` for a tax id. */
  readonly qualifier: string;
  /** ISA06 or ISA08, up to 15 characters. */
  readonly id: string;
  /** GS02 or GS03. Often the same as `id`, but not required to be. */
  readonly applicationId: string;
}

/** One transaction set to be wrapped. Body segments only, no ST and no SE. */
export interface TransactionDraft {
  /** ST01. */
  readonly setIdentifier: string;
  /** ST03, the implementation convention reference. */
  readonly implementationConvention: string;
  readonly segments: readonly Segment[];
}

/** One functional group to be wrapped. */
export interface FunctionalGroupDraft {
  /** GS01, e.g. `HC`, `HB`, `HP`, `FA`. */
  readonly functionalIdentifier: string;
  /** GS08, e.g. `005010X222A1`. */
  readonly version: string;
  readonly transactions: readonly TransactionDraft[];
}

/** Everything the writer needs, with nothing derivable left to the caller. */
export interface InterchangeDraft {
  readonly sender: TradingPartnerAddress;
  readonly receiver: TradingPartnerAddress;
  /** Stamped into ISA09/ISA10 and GS04/GS05. Supplied, never read from a clock. */
  readonly created: Date;
  /** ISA15. `T` keeps a test file from ever being mistaken for a live one. */
  readonly usageIndicator: 'P' | 'T';
  readonly controlNumbers: ControlNumbers;
  readonly groups: readonly FunctionalGroupDraft[];
  readonly delimiters?: Delimiters;
}

const ISA_ID_WIDTH = 15;
const ISA_QUALIFIER_WIDTH = 2;

/**
 * Serializes a complete interchange.
 *
 * Rejects an empty interchange and an empty group: X12 permits neither, and
 * more to the point, a caller that produced one has a bug worth surfacing
 * before a partner's parser surfaces it for them.
 */
export function writeInterchange(draft: InterchangeDraft): Result<string, X12Error> {
  const delimiters = validateDelimiters(draft.delimiters ?? DEFAULT_DELIMITERS);
  if (!delimiters.ok) return delimiters;

  if (draft.groups.length === 0) {
    return err({
      kind: 'encode_precondition',
      message: 'an interchange must carry at least one functional group',
      path: ['groups'],
    });
  }

  for (const [name, party] of [
    ['sender', draft.sender],
    ['receiver', draft.receiver],
  ] as const) {
    if (party.id.length === 0 || party.id.length > ISA_ID_WIDTH) {
      return err({
        kind: 'encode_precondition',
        message: `the ${name} interchange id must be 1 to ${ISA_ID_WIDTH} characters`,
        path: [name, 'id'],
      });
    }
    if (party.qualifier.length !== ISA_QUALIFIER_WIDTH) {
      return err({
        kind: 'encode_precondition',
        message: `the ${name} interchange qualifier must be exactly two characters`,
        path: [name, 'qualifier'],
      });
    }
  }

  const lines: string[] = [];
  const interchangeControl = formatInterchangeControlNumber(draft.controlNumbers.interchange);

  lines.push(
    writeSegment(
      segment(
        'ISA',
        '00',
        padRight('', 10),
        '00',
        padRight('', 10),
        draft.sender.qualifier,
        padRight(draft.sender.id, ISA_ID_WIDTH),
        draft.receiver.qualifier,
        padRight(draft.receiver.id, ISA_ID_WIDTH),
        formatDate6(draft.created),
        formatTime4(draft.created),
        delimiters.value.repetition,
        '00501',
        interchangeControl,
        '0',
        draft.usageIndicator,
        delimiters.value.component
      ),
      delimiters.value
    )
  );

  let groupControl = draft.controlNumbers.group;
  for (const [groupIndex, group] of draft.groups.entries()) {
    if (group.transactions.length === 0) {
      return err({
        kind: 'encode_precondition',
        message: 'a functional group must carry at least one transaction set',
        path: ['groups', String(groupIndex), 'transactions'],
      });
    }

    const groupControlText = String(groupControl);
    lines.push(
      writeSegment(
        segment(
          'GS',
          group.functionalIdentifier,
          draft.sender.applicationId,
          draft.receiver.applicationId,
          formatDate8(draft.created),
          formatTime4(draft.created),
          groupControlText,
          'X',
          group.version
        ),
        delimiters.value
      )
    );

    let transactionControl = draft.controlNumbers.transactionStart;
    for (const transaction of group.transactions) {
      const controlText = formatTransactionControlNumber(transactionControl);
      lines.push(
        writeSegment(
          segment(
            'ST',
            transaction.setIdentifier,
            controlText,
            transaction.implementationConvention
          ),
          delimiters.value
        )
      );
      for (const bodySegment of transaction.segments) {
        lines.push(writeSegment(bodySegment, delimiters.value));
      }
      // SE01 counts ST and SE themselves, hence the two.
      const segmentCount = transaction.segments.length + 2;
      lines.push(writeSegment(segment('SE', String(segmentCount), controlText), delimiters.value));
      transactionControl += 1;
    }

    lines.push(
      writeSegment(
        segment('GE', String(group.transactions.length), groupControlText),
        delimiters.value
      )
    );
    groupControl += 1;
  }

  lines.push(
    writeSegment(segment('IEA', String(draft.groups.length), interchangeControl), delimiters.value)
  );

  return ok(lines.join(''));
}
