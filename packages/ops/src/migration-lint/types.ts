/**
 * Postgres type comparison, only as deep as the narrowing question needs.
 *
 * A column type change rewrites the table, and if the new type cannot hold what
 * the old one held, the rewrite fails partway through a deploy - on the
 * clinic's data, at whatever hour the upgrade was scheduled. So the linter has
 * to be able to say whether a change is a widening (always safe to apply to
 * existing rows) or not.
 *
 * The default answer is "not a widening". Anything this file does not
 * positively recognise as safe is reported, which is the correct bias: a false
 * positive costs a reviewer thirty seconds, a false negative costs a restore.
 */

/** A type with its precision arguments split out, e.g. `NUMERIC(10,2)`. */
export interface ParsedType {
  readonly base: string;
  readonly params: readonly number[];
}

const ALIASES = new Map<string, string>([
  ['INT', 'INT4'],
  ['INTEGER', 'INT4'],
  ['SMALLINT', 'INT2'],
  ['BIGINT', 'INT8'],
  ['BOOL', 'BOOLEAN'],
  ['CHARACTER VARYING', 'VARCHAR'],
  ['CHARACTER', 'CHAR'],
  ['BPCHAR', 'CHAR'],
  ['DECIMAL', 'NUMERIC'],
  ['DOUBLE PRECISION', 'FLOAT8'],
  ['REAL', 'FLOAT4'],
  ['TIMESTAMP WITHOUT TIME ZONE', 'TIMESTAMP'],
  ['TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ'],
  ['TIME WITHOUT TIME ZONE', 'TIME'],
  ['TIME WITH TIME ZONE', 'TIMETZ'],
]);

/** Integer and float families, ordered narrow to wide. */
const NUMERIC_LADDERS: readonly (readonly string[])[] = [
  ['INT2', 'INT4', 'INT8'],
  ['FLOAT4', 'FLOAT8'],
];

export function parseType(raw: string): ParsedType {
  const collapsed = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  // `collapsed` already has single spaces, so every quantifier here is fixed or
  // bounded by a character class that cannot cross the delimiter it stops at.
  // The previous spelling paired a lazy `(.*?)` with `\s*`, which overlap, and
  // backtracked quadratically on a long parenthesis-free string.
  const withParams = /^([^(]*)\(([^)]*)\) ?(\[\])?$/.exec(collapsed);

  const rawBase = (
    withParams === null ? collapsed : `${withParams[1] ?? ''}${withParams[3] ?? ''}`
  ).trim();
  const params =
    withParams === null
      ? []
      : (withParams[2] ?? '')
          .split(',')
          .map((part) => Number.parseInt(part.trim(), 10))
          .filter((value) => Number.isFinite(value));

  // Alias lookup happens on the array-free base so `INTEGER[]` normalises too.
  const isArray = rawBase.endsWith('[]');
  const scalar = isArray ? rawBase.slice(0, -2).trim() : rawBase;
  const base = ALIASES.get(scalar) ?? scalar;

  return { base: isArray ? `${base}[]` : base, params };
}

/**
 * Renders a type back the way it was written, precision included.
 *
 * The precision is usually the whole story - `VARCHAR(64)` to `VARCHAR(8)` is a
 * narrowing and `VARCHAR` to `VARCHAR` is nothing at all, and a message that
 * prints the second when it means the first tells the reviewer their migration
 * is fine.
 */
export function formatType(type: ParsedType): string {
  return type.params.length === 0 ? type.base : `${type.base}(${type.params.join(',')})`;
}

function ladderIndex(base: string): { ladder: readonly string[]; index: number } | null {
  for (const ladder of NUMERIC_LADDERS) {
    const index = ladder.indexOf(base);
    if (index !== -1) return { ladder, index };
  }
  return null;
}

/**
 * True when every value of `from` is representable in `to`.
 *
 * Same type is trivially a widening, which matters because Prisma re-emits an
 * unchanged type whenever anything else about the column changes.
 */
export function isWidening(from: ParsedType, to: ParsedType): boolean {
  if (from.base === to.base) {
    // No length or precision on either side: nothing to compare.
    if (from.params.length === 0 && to.params.length === 0) return true;
    // Dropping the limit entirely (VARCHAR(20) -> VARCHAR) is a widening.
    if (to.params.length === 0) return true;
    if (from.params.length === 0) return false;

    if (from.base === 'NUMERIC') {
      const [fromPrecision = 0, fromScale = 0] = from.params;
      const [toPrecision = 0, toScale = 0] = to.params;
      // The integral part must not shrink either, so compare both halves.
      return (
        toPrecision >= fromPrecision &&
        toScale >= fromScale &&
        toPrecision - toScale >= fromPrecision - fromScale
      );
    }

    const [fromLength = 0] = from.params;
    const [toLength = 0] = to.params;
    return toLength >= fromLength;
  }

  // Character types: any bounded string fits in an unbounded one.
  if ((from.base === 'VARCHAR' || from.base === 'CHAR') && to.base === 'TEXT') return true;
  if (from.base === 'CHAR' && to.base === 'VARCHAR' && to.params.length === 0) return true;

  const fromLadder = ladderIndex(from.base);
  const toLadder = ladderIndex(to.base);
  if (fromLadder !== null && toLadder !== null && fromLadder.ladder === toLadder.ladder) {
    return toLadder.index > fromLadder.index;
  }

  return false;
}
