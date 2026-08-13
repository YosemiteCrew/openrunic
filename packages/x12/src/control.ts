import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { X12Error } from './errors.js';

/**
 * Control numbers are the codec's primary key into a payer's world.
 *
 * When an 835 arrives three weeks after submission, the only thing tying a
 * payment back to a claim is a control number the submitter chose. When a 999
 * rejects a group, the only thing identifying which group is GS06. Getting
 * these wrong does not produce a parse error; it produces money posted to the
 * wrong claim, which is why they are validated on encode and re-verified on
 * decode instead of being trusted.
 *
 * They are supplied by the caller rather than generated here so that encoding
 * stays a pure function. The billing service allocates them from a durable
 * sequence, which is also what makes byte-exact golden files possible.
 */
export interface ControlNumbers {
  /** ISA13. Nine digits, zero padded on the wire. */
  readonly interchange: number;
  /** GS06. One to nine digits. */
  readonly group: number;
  /**
   * ST02 for the group's first transaction. Subsequent transactions in the
   * same group take the next integers, which is what makes SE02 predictable.
   */
  readonly transactionStart: number;
}

const MAX_INTERCHANGE = 999_999_999;
const MAX_GROUP = 999_999_999;
const MAX_TRANSACTION = 999_999_999;

/**
 * Rejects control numbers that cannot be written to the wire.
 *
 * Zero is excluded deliberately: X12 permits it, but a zero control number is
 * almost always an uninitialized counter, and an interchange numbered 0 is
 * indistinguishable from a bug for the rest of its life.
 */
export function validateControlNumbers(numbers: ControlNumbers): Result<ControlNumbers, X12Error> {
  const checks: readonly (readonly [string, number, number])[] = [
    ['interchange', numbers.interchange, MAX_INTERCHANGE],
    ['group', numbers.group, MAX_GROUP],
    ['transactionStart', numbers.transactionStart, MAX_TRANSACTION],
  ];

  for (const [name, value, max] of checks) {
    if (!Number.isInteger(value) || value < 1 || value > max) {
      return err({
        kind: 'encode_precondition',
        message: `control number must be an integer from 1 to ${max}, received ${value}`,
        path: ['controlNumbers', name],
      });
    }
  }

  return ok(numbers);
}

/** ISA13 is fixed width; GS06 and ST02 are not, but padding ST02 keeps files aligned. */
export function formatInterchangeControlNumber(value: number): string {
  return String(value).padStart(9, '0');
}

/** ST02 is a minimum of four characters, so short counters are zero padded. */
export function formatTransactionControlNumber(value: number): string {
  return String(value).padStart(4, '0');
}

/**
 * A monotonic control-number allocator.
 *
 * Deliberately trivial and in-memory: durable allocation belongs to the
 * billing service, which owns a Postgres sequence per trading partner. This
 * exists so tests, the mock clearinghouse loop and the seed can produce
 * realistic ascending numbers without inventing their own counter.
 */
export interface ControlNumberSource {
  next(): number;
  readonly current: number;
}

/** Creates an allocator that hands out `start`, `start + 1`, and so on. */
export function createControlNumberSource(start = 1): ControlNumberSource {
  let value = start - 1;
  return {
    next(): number {
      value += 1;
      return value;
    },
    get current(): number {
      return value;
    },
  };
}
