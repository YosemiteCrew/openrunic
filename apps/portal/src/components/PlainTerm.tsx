'use client';

/**
 * A clinical term with its plain-language gloss beside it.
 *
 * The record has to keep the coded term - it is what the practice wrote down and what a
 * patient will need to quote elsewhere. When the record also stores a plain-language gloss,
 * it renders underneath rather than the interface inventing one.
 */

export interface PlainTermProps {
  /** The term as recorded, e.g. 'Hypothyroidism'. */
  term: string;
  /** The coding reference, e.g. 'E03.9'. Omit when the record has no code. */
  code?: string;
  /** The plain-language gloss shown beside the term. */
  plain: string | null;
}

export function PlainTerm({ term, code, plain }: Readonly<PlainTermProps>) {
  return (
    <span className="portal-term">
      <span className="portal-term__clinical">{code ? `${term}, ${code}` : term}</span>
      {plain === null ? null : <span className="portal-term__plain">{plain}</span>}
    </span>
  );
}
