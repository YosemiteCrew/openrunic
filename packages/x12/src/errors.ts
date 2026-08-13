/**
 * The codec's error vocabulary.
 *
 * Every fallible entry point in this package returns `Result<T, X12Error>`
 * rather than throwing, and `X12Error` is a discriminated union rather than a
 * string. The reason is operational: an 837P that a payer rejects, or an 835
 * that will not parse, becomes a work item somebody has to action. A billing
 * clerk needs "segment SV1 at position 42, element 02 is not a valid amount",
 * not a stack trace, and the claim-lifecycle service needs to branch on the
 * *kind* of failure to decide whether to retry, re-scrub or escalate. A string
 * message can do neither without being parsed back apart.
 *
 * Exceptions are reserved for programmer errors, which in this package means
 * nothing: the whole surface is `Result`.
 */

/** Where in a document a problem was found, in reader terms. */
export interface X12Location {
  /** Zero-based index of the segment within the whole interchange. */
  readonly segmentIndex: number;
  /** The segment's tag, e.g. `CLM`. Empty when the segment could not be read. */
  readonly segmentTag: string;
  /** One-based element position within the segment, when the fault is elemental. */
  readonly elementPosition?: number;
}

/** Which envelope level a control-number or count fault belongs to. */
export type X12EnvelopeLevel = 'interchange' | 'group' | 'transaction';

/**
 * The failure union.
 *
 * The variants are deliberately coarse enough to branch on (nine kinds, not
 * ninety) and specific enough to render: each carries the values that were
 * compared, so a message can be rebuilt without re-reading the document.
 */
export type X12Error =
  /** The input was empty or contained no segment terminator at all. */
  | { readonly kind: 'empty_input'; readonly message: string }
  /**
   * The interchange envelope itself is unreadable: the ISA is not 106
   * characters, the IEA is missing, a group is unterminated. Nothing inside
   * can be trusted, so mapping never runs.
   */
  | { readonly kind: 'malformed_envelope'; readonly message: string; readonly at?: X12Location }
  /** A segment appeared where the transaction set does not allow it. */
  | {
      readonly kind: 'unexpected_segment';
      readonly message: string;
      readonly at: X12Location;
      readonly expected: readonly string[];
      readonly actual: string;
    }
  /** A segment the transaction set requires was not present. */
  | { readonly kind: 'missing_segment'; readonly message: string; readonly tag: string }
  /** A required element was absent or empty. */
  | { readonly kind: 'missing_element'; readonly message: string; readonly at: X12Location }
  /** An element was present but could not be read as its declared data type. */
  | {
      readonly kind: 'invalid_element';
      readonly message: string;
      readonly at: X12Location;
      readonly value: string;
      readonly expected: string;
    }
  /**
   * A trailer's control number does not echo its header's: IEA02 against
   * ISA13, GE02 against GS06, SE02 against ST02. This is the classic symptom
   * of two documents concatenated by a broken transport, so it is fatal.
   */
  | {
      readonly kind: 'control_mismatch';
      readonly message: string;
      readonly level: X12EnvelopeLevel;
      readonly header: string;
      readonly trailer: string;
    }
  /** A trailer's count element disagrees with what was actually present. */
  | {
      readonly kind: 'count_mismatch';
      readonly message: string;
      readonly level: X12EnvelopeLevel;
      /** The element that carried the declared count. */
      readonly counter: 'SE01' | 'GE01' | 'IEA01';
      readonly declared: number;
      readonly actual: number;
    }
  /** The document is well formed but is not a transaction set this codec maps. */
  | {
      readonly kind: 'unsupported_transaction';
      readonly message: string;
      readonly transactionSet: string;
      readonly supported: readonly string[];
    }
  /**
   * An encode input could not produce a valid document: a claim with no
   * service lines, an amount that will not fit X12's numeric field, a control
   * number outside its legal range. Carries a dotted path into the input so
   * the fee-sheet UI can point at the offending value.
   */
  | {
      readonly kind: 'encode_precondition';
      readonly message: string;
      readonly path: readonly string[];
    };

/** The `kind` discriminant, useful for exhaustive switches and for metrics. */
export type X12ErrorKind = X12Error['kind'];

/**
 * Renders an error as one human line.
 *
 * Kept here rather than in a UI package so that logs, the claim's
 * `statusReason` column and the screen all say exactly the same thing.
 */
export function formatX12Error(error: X12Error): string {
  const where = 'at' in error && error.at !== undefined ? ` ${formatLocation(error.at)}` : '';
  return `[${error.kind}]${where} ${error.message}`;
}

function formatLocation(at: X12Location): string {
  const tag = at.segmentTag === '' ? '?' : at.segmentTag;
  const element =
    at.elementPosition === undefined ? '' : `${String(at.elementPosition).padStart(2, '0')} of `;
  return `(${element}segment ${tag} #${at.segmentIndex})`;
}
