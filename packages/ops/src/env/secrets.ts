import { randomBytes } from 'node:crypto';

/**
 * First-run secret generation.
 *
 * Two rules shape everything here.
 *
 * A generated secret is never returned to a caller that might print it, never
 * logged, and never echoed back for confirmation. `ensureEnvFile` reports which
 * keys it filled, not what it filled them with, so a support transcript of a
 * first run is safe to paste into an issue.
 *
 * And a generated password goes into a Postgres connection URL, so its alphabet
 * has to survive URL parsing. base64url has no `/`, `+`, `@`, `:` or `%`, which
 * are exactly the characters that turn a working password into a connection
 * string that fails with a confusing error a week later.
 */

/** The sentinel in .env.example that marks a value the installer must generate. */
export const GENERATE_SENTINEL = 'generate-me';

/** 32 bytes of CSPRNG output, base64url encoded. */
export function generateSecret(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new RangeError('generateSecret: byteLength must be an integer of at least 16');
  }
  return randomBytes(byteLength).toString('base64url');
}

export interface EnvLine {
  readonly key: string | null;
  readonly value: string;
  readonly raw: string;
}

/**
 * Parses a dotenv file into lines, keeping comments and blanks.
 *
 * Rewriting the file rather than regenerating it is deliberate: the operator's
 * comments and their ordering are part of how they understand the deployment,
 * and a tool that reflows their config file is a tool they stop running.
 */
export function parseEnvLines(contents: string): EnvLine[] {
  return contents.split('\n').map((raw) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw);
    if (match === null) return { key: null, value: '', raw };
    const rawValue = (match[1] === undefined ? '' : (match[2] ?? '')).trim();
    const unquoted = /^"(.*)"$/.exec(rawValue) ?? /^'(.*)'$/.exec(rawValue);
    return { key: match[1] ?? null, value: unquoted?.[1] ?? rawValue, raw };
  });
}

export interface FillResult {
  readonly contents: string;
  /** Keys whose sentinel was replaced with a fresh secret. Names only. */
  readonly generated: readonly string[];
}

/**
 * Replaces every `generate-me` sentinel with a fresh secret.
 *
 * Keys already holding a real value are left exactly as they are, which is what
 * makes running the installer against an existing deployment safe: it can add a
 * newly required secret without rotating the ones already in use.
 */
export function fillGeneratedSecrets(contents: string, generate = generateSecret): FillResult {
  const generated: string[] = [];

  const filled = contents
    .split('\n')
    .map((raw) => {
      // Split on the first '=' rather than matching the whole line. The regex
      // this replaced had `\s*` on both sides of the '=' and a trailing `.*`
      // that also matches spaces, so the engine could distribute a run of
      // blanks between them and backtrack quadratically (CodeQL
      // js/polynomial-redos). A line of a .env file is caller-supplied, and an
      // installer that hangs on a malformed file is an installer that hangs.
      const separator = raw.indexOf('=');
      if (separator === -1) return raw;

      const before = raw.slice(0, separator);
      const key = before.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return raw;

      const indent = before.slice(0, before.length - before.trimStart().length);
      const after = raw.slice(separator + 1);
      const value = after.trimStart();
      // Preserved verbatim so a file that writes `KEY = value` keeps its shape.
      const equals = `${before.slice(indent.length + key.length)}=${after.slice(0, after.length - value.length)}`;
      const bare = value.trim().replace(/^["']|["']$/g, '');
      if (bare !== GENERATE_SENTINEL) return raw;

      generated.push(key);
      return `${indent}${key}${equals}${generate()}`;
    })
    .join('\n');

  return { contents: filled, generated };
}

/** Keys present in the template but absent from the current file. */
export function missingKeys(template: string, current: string): string[] {
  const have = new Set(
    parseEnvLines(current)
      .map((line) => line.key)
      .filter((key): key is string => key !== null)
  );
  return parseEnvLines(template)
    .map((line) => line.key)
    .filter((key): key is string => key !== null && !have.has(key));
}
