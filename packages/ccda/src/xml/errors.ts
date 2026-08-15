/**
 * One error type for the whole codec, carrying where it went wrong.
 *
 * A C-CDA arrives from another vendor's system, which means it arrives wrong
 * sooner or later - truncated, re-encoded, or built by a generator with its own
 * reading of the specification. When that happens the person debugging it has
 * the document in one window and this message in another, and "unexpected token"
 * costs them an hour that "unexpected `<` at offset 4211, inside <observation>"
 * does not.
 */
export class CcdaError extends Error {
  /** Byte offset into the source document, where one is known. */
  readonly offset?: number;

  constructor(message: string, offset?: number) {
    super(offset === undefined ? message : `${message} (at offset ${offset})`);
    this.name = 'CcdaError';
    if (offset !== undefined) this.offset = offset;
  }
}
