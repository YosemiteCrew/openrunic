/**
 * Just enough SQL lexing to split a Prisma migration into statements.
 *
 * This is not a SQL parser and does not try to be one. It exists to answer two
 * questions honestly: where does each statement start and end, and which
 * characters in it are code rather than comment or literal text. Getting that
 * wrong in either direction is what makes naive `split(';')` linters useless -
 * they flag a DROP COLUMN written inside a comment, and they miss one written
 * after a semicolon that lived inside a string.
 */

/** One SQL statement, with the source position needed to report it. */
export interface SqlStatement {
  /** The statement with comments removed and whitespace collapsed. */
  readonly text: string;
  /** Same text uppercased, so rules match keywords without re-casing. */
  readonly upper: string;
  /** 1-based line in the source file where the statement begins. */
  readonly line: number;
  /** The statement exactly as written, for quoting back to the reviewer. */
  readonly raw: string;
}

interface ScanState {
  index: number;
  line: number;
}

/** Postgres allows `$$...$$` and `$tag$...$tag$`; both must survive intact. */
function readDollarTag(source: string, at: number): string | null {
  if (source[at] !== '$') return null;
  let cursor = at + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '$') return source.slice(at, cursor + 1);
    // Tags are identifiers. Anything else means this `$` was not a quote.
    if (char === undefined || !/[A-Za-z0-9_]/.test(char)) return null;
    cursor += 1;
  }
  return null;
}

function countNewlines(text: string): number {
  let count = 0;
  for (const char of text) if (char === '\n') count += 1;
  return count;
}

/**
 * Splits SQL into statements, dropping comments and preserving literals.
 *
 * Handles line comments, block comments (nested, as Postgres allows),
 * single-quoted strings with `''` escapes, double-quoted identifiers with `""`
 * escapes, and dollar-quoted bodies.
 */
export function splitStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  const state: ScanState = { index: 0, line: 1 };

  let code = '';
  let raw = '';
  let startLine = 1;
  let sawContent = false;

  const flush = (): void => {
    const text = code.replace(/\s+/g, ' ').trim();
    if (text !== '') {
      statements.push({ text, upper: text.toUpperCase(), line: startLine, raw: raw.trim() });
    }
    code = '';
    raw = '';
    sawContent = false;
  };

  /**
   * Records where the statement's first real character sits.
   *
   * Called only when code is about to be appended, never on entering a comment.
   * A statement preceded by a block comment starts where the SQL starts, not
   * where the comment does, and reporting the comment's line sends the reviewer
   * to the wrong place in the file.
   */
  const noteContent = (line: number): void => {
    if (sawContent) return;
    startLine = line;
    sawContent = true;
  };

  while (state.index < source.length) {
    const char = source[state.index] ?? '';
    const next = source[state.index + 1] ?? '';

    // Line comment: consumed, never emitted.
    if (char === '-' && next === '-') {
      const end = source.indexOf('\n', state.index);
      const stop = end === -1 ? source.length : end;
      raw += source.slice(state.index, stop);
      state.index = stop;
      continue;
    }

    // Block comment, nested.
    if (char === '/' && next === '*') {
      let depth = 0;
      const begin = state.index;
      while (state.index < source.length) {
        if (source[state.index] === '/' && source[state.index + 1] === '*') {
          depth += 1;
          state.index += 2;
        } else if (source[state.index] === '*' && source[state.index + 1] === '/') {
          depth -= 1;
          state.index += 2;
          if (depth === 0) break;
        } else {
          if (source[state.index] === '\n') state.line += 1;
          state.index += 1;
        }
      }
      raw += source.slice(begin, state.index);
      continue;
    }

    // Quoted literal or identifier: copied through verbatim so a semicolon or a
    // keyword inside it can never be read as code.
    if (char === "'" || char === '"') {
      const quote = char;
      const begin = state.index;
      noteContent(state.line);
      state.index += 1;
      while (state.index < source.length) {
        if (source[state.index] === quote) {
          if (source[state.index + 1] === quote) {
            state.index += 2;
            continue;
          }
          state.index += 1;
          break;
        }
        if (source[state.index] === '\n') state.line += 1;
        state.index += 1;
      }
      const chunk = source.slice(begin, state.index);
      code += chunk;
      raw += chunk;
      continue;
    }

    const tag = char === '$' ? readDollarTag(source, state.index) : null;
    if (tag !== null) {
      noteContent(state.line);
      const closing = source.indexOf(tag, state.index + tag.length);
      const stop = closing === -1 ? source.length : closing + tag.length;
      const chunk = source.slice(state.index, stop);
      state.line += countNewlines(chunk);
      code += chunk;
      raw += chunk;
      state.index = stop;
      continue;
    }

    if (char === ';') {
      raw += char;
      state.index += 1;
      flush();
      continue;
    }

    if (char === '\n') state.line += 1;
    else if (!/\s/.test(char)) noteContent(state.line);
    code += char;
    raw += char;
    state.index += 1;
  }

  flush();
  return statements;
}
