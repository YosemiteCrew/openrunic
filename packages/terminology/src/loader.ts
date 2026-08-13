import { z } from 'zod';
import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { CONTENT_HASH_PATTERN, hashCodeSystemContent } from './content-hash.js';
import { conceptKey } from './ordering.js';
import type { TerminologyConcept } from './service.js';

/**
 * Ingesting a code system the DEPLOYER supplies.
 *
 * Openrunic ships loaders, never content. The clinically useful code systems
 * are licensed: some need a paid licence, some need a national affiliate
 * agreement, and the terms differ per country and per deployment. A project
 * that bundled them would be redistributing content it has no right to
 * redistribute, and would be making a licensing decision on behalf of every
 * practice that installs it. So the file comes from the deployer, and this
 * module's job is to turn it into rows while making the licensing decision
 * explicit and recorded.
 *
 * That is what the MANIFEST is for. It is not metadata for its own sake; each
 * field answers a question somebody will ask later:
 *
 *   * `systemUri` and `systemVersion`: which system is this, and which release?
 *     A code means nothing without both, and a second load has to be able to
 *     supersede the first rather than collide with it.
 *   * `sourceName` and `sourceReleaseDate`: where did the file come from?
 *   * `contentHash`: is this the file the manifest describes? A load is
 *     verifiable and repeatable, or it is a mystery table.
 *   * `attestation`: WHO said this deployment holds a licence to use this
 *     content, WHEN they said it, and in their own words WHAT they are
 *     asserting. A load without a complete attestation is refused. That refusal
 *     is the entire point of this module: it puts a name and a timestamp
 *     against every piece of licensed content in the database, so the answer to
 *     "who decided we could load this" is a record instead of an argument.
 *
 * The module is deliberately IO-free. It takes the file's CONTENT as a string
 * and never opens a file, which keeps a leaf library away from the filesystem
 * and makes every case below testable with a string literal. Reading the file
 * is the CLI's job; {@link CodeSystemContentReader} is the seam it fills.
 */

/** A normalized row, ready to be written to `TerminologyCode`. */
export type TerminologyCodeInput = TerminologyConcept;

/**
 * How the CLI hands a file to the loader.
 *
 * Typed as a port rather than assumed to be `fs.readFile` so that the same
 * command can load from a path today and from an object store or an HTTP
 * response later without this package learning about any of them.
 */
export type CodeSystemContentReader = (source: string) => Promise<string>;

/** The two payload formats a deployer is likely to already have. */
export const CODE_SYSTEM_FORMATS = ['ndjson', 'tsv'] as const;

/** One of {@link CODE_SYSTEM_FORMATS}. */
export type CodeSystemFormat = (typeof CODE_SYSTEM_FORMATS)[number];

/**
 * Column order for the `tsv` format, fixed and positional.
 *
 * Tab-separated with no quoting and no escaping, because that is what a
 * spreadsheet export and a `psql \copy` both produce and what a deployer can
 * inspect with `less`. The trade is that a display containing a tab or a
 * newline cannot be represented; a file with such displays has to use `ndjson`.
 * A first line that is exactly these column names is treated as a header and
 * skipped, since exports usually include one.
 *
 * `system` and `version` may be left empty, in which case the row inherits the
 * manifest's values. If they are filled in they must agree with the manifest:
 * one file loads one release of one system, and a row that says otherwise is a
 * mistake worth stopping for.
 */
export const TSV_COLUMNS = [
  'system',
  'code',
  'display',
  'version',
  'parentCode',
  'isActive',
] as const;

/**
 * How many row problems are reported before parsing gives up.
 *
 * A malformed export usually has one problem repeated on every line. Fifty
 * examples is enough to diagnose it; a million would be a denial of service
 * against the operator reading them.
 */
export const MAX_REPORTED_ROW_ISSUES = 50;

const attestationSchema = z.strictObject({
  /** A person, not a service account: somebody has to be answerable for it. */
  attestedBy: z.string().min(1),
  attestedRole: z.string().min(1).optional(),
  attestedAt: z.iso.datetime({ offset: true }),
  /**
   * Must be exactly `true`. A boolean that can only hold one acceptable value
   * is how a deployer says yes deliberately: there is no default, no absent
   * field that means consent, and nothing for a template to fill in silently.
   */
  licenceHeld: z.literal(true),
  /** The assertion in the deployer's own words, so the record is readable years later. */
  licenceStatement: z.string().min(1),
  /** Agreement number, contract reference or URL, when there is one to cite. */
  licenceReference: z.string().min(1).optional(),
});

/**
 * Runtime shape of a manifest. Exported so a CLI can reject a bad manifest
 * before it reads a payload that might be very large.
 */
export const codeSystemManifestSchema = z.strictObject({
  systemUri: z.url(),
  /**
   * Required, even though the column defaults to `''`. A load that cannot name
   * the release it came from cannot be reproduced or superseded; a publisher
   * with no version scheme gets a date stamp.
   */
  systemVersion: z.string().min(1),
  sourceName: z.string().min(1),
  sourceReleaseDate: z.iso.date(),
  contentHash: z.string().regex(CONTENT_HASH_PATTERN),
  /** Expected row count, when the publisher states one. Checked, so a truncated file is caught. */
  rowCount: z.int().min(0).optional(),
  attestation: attestationSchema,
});

/** The deployer's statement that this content may be used here. */
export interface CodeSystemLicenceAttestation {
  readonly attestedBy: string;
  readonly attestedRole?: string;
  readonly attestedAt: string;
  readonly licenceHeld: true;
  readonly licenceStatement: string;
  readonly licenceReference?: string;
}

/** Everything recorded about one load, verified before a single row is written. */
export interface CodeSystemManifest {
  readonly systemUri: string;
  readonly systemVersion: string;
  readonly sourceName: string;
  readonly sourceReleaseDate: string;
  readonly contentHash: string;
  readonly rowCount?: number;
  readonly attestation: CodeSystemLicenceAttestation;
}

/** The manifest is not a usable manifest. */
export interface InvalidManifestError {
  readonly kind: 'invalid_manifest';
  readonly message: string;
  readonly issues: readonly string[];
}

/** The manifest is well-formed apart from the attestation, which is the one part that is never optional. */
export interface MissingAttestationError {
  readonly kind: 'missing_attestation';
  readonly message: string;
  readonly issues: readonly string[];
}

/** The payload is not the payload the manifest describes. */
export interface ContentHashMismatchError {
  readonly kind: 'content_hash_mismatch';
  readonly message: string;
  readonly expected: string;
  readonly actual: string;
}

/** The payload carried no rows. Silently loading nothing is how a deployment ends up with an empty code system it believes is populated. */
export interface EmptyContentError {
  readonly kind: 'empty_content';
  readonly message: string;
}

/** Why one row could not be turned into a `TerminologyCode`. */
export type CodeSystemRowIssueKind =
  | 'wrong_column_count'
  | 'malformed_json'
  | 'invalid_row'
  | 'system_mismatch'
  | 'version_mismatch'
  | 'duplicate_code';

/** One row problem, with the line number a deployer needs to open the file at. */
export interface CodeSystemRowIssue {
  readonly line: number;
  readonly kind: CodeSystemRowIssueKind;
  readonly message: string;
}

/** At least one row was unusable, so none of them are loaded. */
export interface InvalidRowsError {
  readonly kind: 'invalid_rows';
  readonly message: string;
  readonly issues: readonly CodeSystemRowIssue[];
}

/** The payload parsed, but not into the number of rows the manifest promised. */
export interface RowCountMismatchError {
  readonly kind: 'row_count_mismatch';
  readonly message: string;
  readonly expected: number;
  readonly actual: number;
}

/** Every way a load is refused. */
export type CodeSystemLoadError =
  | InvalidManifestError
  | MissingAttestationError
  | ContentHashMismatchError
  | EmptyContentError
  | InvalidRowsError
  | RowCountMismatchError;

/** A verified load: the manifest that authorized it and the rows it produced. */
export interface CodeSystemLoad {
  readonly manifest: CodeSystemManifest;
  readonly format: CodeSystemFormat;
  /** The verified hash, ready to be recorded alongside the rows. */
  readonly contentHash: string;
  readonly rows: readonly TerminologyCodeInput[];
}

/** What the loader is given. The manifest is `unknown` because it comes from a file a human wrote. */
export interface LoadCodeSystemRequest {
  readonly manifest: unknown;
  readonly content: string;
  readonly format: CodeSystemFormat;
}

const codeSystemRowSchema = z.strictObject({
  system: z.string().min(1).optional(),
  code: z.string().min(1),
  display: z.string().min(1),
  version: z.string().min(1).optional(),
  parentCode: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
});

type RawCodeRow = z.infer<typeof codeSystemRowSchema>;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}

function rowIssue(line: number, kind: CodeSystemRowIssueKind, message: string): CodeSystemRowIssue {
  return { line, kind, message };
}

/** Booleans a spreadsheet might have written. An empty cell means "not stated", which for status means active. */
function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === 'true' || normalized === '1') {
    return true;
  }
  return normalized === 'false' || normalized === '0' ? false : null;
}

function parseTsvLine(raw: string, line: number): Result<RawCodeRow, CodeSystemRowIssue> {
  const fields = raw.split('\t');
  if (fields.length !== TSV_COLUMNS.length) {
    return err(
      rowIssue(
        line,
        'wrong_column_count',
        `expected ${TSV_COLUMNS.length} tab-separated columns (${TSV_COLUMNS.join(', ')}), found ${fields.length}`
      )
    );
  }
  const [system = '', code = '', display = '', version = '', parentCode = '', isActive = ''] =
    fields;
  if (code.trim() === '' || display.trim() === '') {
    return err(rowIssue(line, 'invalid_row', 'code and display are both required'));
  }
  const active = parseBoolean(isActive);
  if (active === null) {
    return err(
      rowIssue(
        line,
        'invalid_row',
        `isActive must be true, false, 1, 0 or empty, found "${isActive}"`
      )
    );
  }
  return ok({
    ...(system === '' ? {} : { system }),
    code,
    display,
    ...(version === '' ? {} : { version }),
    parentCode: parentCode === '' ? null : parentCode,
    isActive: active,
  });
}

function parseNdjsonLine(raw: string, line: number): Result<RawCodeRow, CodeSystemRowIssue> {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (cause) {
    // Stringified rather than unwrapped: the parser's own message names the
    // offending position, which is what the deployer needs.
    return err(rowIssue(line, 'malformed_json', String(cause)));
  }
  const parsed = codeSystemRowSchema.safeParse(document);
  if (!parsed.success) {
    return err(rowIssue(line, 'invalid_row', formatIssues(parsed.error).join('; ')));
  }
  return ok(parsed.data);
}

/**
 * Fills a row's system and version from the manifest, and refuses a row that
 * contradicts it. One file describes one release of one system: a row claiming
 * otherwise means two exports were concatenated, which would put half a
 * system's codes under the wrong URI where nothing would ever find them.
 */
function normalizeRow(
  raw: RawCodeRow,
  manifest: CodeSystemManifest,
  line: number
): Result<TerminologyCodeInput, CodeSystemRowIssue> {
  if (raw.system !== undefined && raw.system !== manifest.systemUri) {
    return err(
      rowIssue(
        line,
        'system_mismatch',
        `row states system ${raw.system}, manifest states ${manifest.systemUri}`
      )
    );
  }
  if (raw.version !== undefined && raw.version !== manifest.systemVersion) {
    return err(
      rowIssue(
        line,
        'version_mismatch',
        `row states version ${raw.version}, manifest states ${manifest.systemVersion}`
      )
    );
  }
  return ok({
    system: manifest.systemUri,
    code: raw.code,
    display: raw.display,
    version: manifest.systemVersion,
    parentCode: raw.parentCode ?? null,
    isActive: raw.isActive ?? true,
    properties: raw.properties ?? null,
  });
}

function isTsvHeader(raw: string): boolean {
  return raw === TSV_COLUMNS.join('\t');
}

function parseRows(
  manifest: CodeSystemManifest,
  content: string,
  format: CodeSystemFormat
): { rows: TerminologyCodeInput[]; issues: CodeSystemRowIssue[] } {
  const rows: TerminologyCodeInput[] = [];
  const issues: CodeSystemRowIssue[] = [];
  // The unique key the table enforces. Catching a collision here gives the
  // deployer a line number instead of a constraint violation halfway through
  // an insert.
  const seen = new Set<string>();
  let atFirstRow = true;
  let line = 0;

  for (const rawLine of content.split('\n')) {
    line += 1;
    if (issues.length >= MAX_REPORTED_ROW_ISSUES) {
      break;
    }
    // Files exported on Windows arrive with CRLF; the carriage return would
    // otherwise become part of the last column's value.
    const raw = rawLine.replace(/\r$/, '');
    if (raw.trim() === '') {
      continue;
    }
    if (atFirstRow && format === 'tsv' && isTsvHeader(raw)) {
      atFirstRow = false;
      continue;
    }
    atFirstRow = false;

    const parsed = format === 'tsv' ? parseTsvLine(raw, line) : parseNdjsonLine(raw, line);
    if (!parsed.ok) {
      issues.push(parsed.error);
      continue;
    }
    const normalized = normalizeRow(parsed.value, manifest, line);
    if (!normalized.ok) {
      issues.push(normalized.error);
      continue;
    }
    const key = conceptKey(normalized.value);
    if (seen.has(key)) {
      issues.push(
        rowIssue(line, 'duplicate_code', `code ${normalized.value.code} appears more than once`)
      );
      continue;
    }
    seen.add(key);
    rows.push(normalized.value);
  }

  return { rows, issues };
}

/**
 * Verifies a deployer-supplied code system and normalizes it into rows.
 *
 * Synchronous and free of IO by construction: everything it needs is in the
 * arguments, so a load is a pure function of the manifest and the payload and
 * can be tested, replayed and diffed. Writing the rows is the caller's job, and
 * it should happen in one transaction with a record of `manifest.attestation`.
 *
 * Checks run in the order a sceptic would run them: is the manifest a manifest,
 * did somebody attest to the licence, is this the file the manifest describes,
 * did it contain anything, does every row parse, and is that as many rows as
 * were promised. The first failure stops the load; nothing is partially
 * applied, because half a code system is worse than none.
 */
export function loadCodeSystem(
  request: LoadCodeSystemRequest
): Result<CodeSystemLoad, CodeSystemLoadError> {
  const parsedManifest = codeSystemManifestSchema.safeParse(request.manifest);
  if (!parsedManifest.success) {
    const issues = formatIssues(parsedManifest.error);
    // An otherwise-good manifest that fails only on the attestation is the case
    // worth naming: it is a deployer who filled the form in but did not sign
    // it, and they need to be told that rather than handed a schema error.
    const attestationOnly = parsedManifest.error.issues.every(
      (issue) => issue.path[0] === 'attestation'
    );
    if (attestationOnly) {
      return err({
        kind: 'missing_attestation',
        message: `Refusing to load: the manifest carries no complete licence attestation (${issues.join('; ')}).`,
        issues,
      });
    }
    return err({
      kind: 'invalid_manifest',
      message: `Refusing to load: the manifest is not usable (${issues.join('; ')}).`,
      issues,
    });
  }
  const manifest: CodeSystemManifest = parsedManifest.data;

  const actual = hashCodeSystemContent(request.content);
  if (actual !== manifest.contentHash) {
    return err({
      kind: 'content_hash_mismatch',
      message: `Refusing to load: the payload hashes to ${actual}, the manifest expects ${manifest.contentHash}.`,
      expected: manifest.contentHash,
      actual,
    });
  }

  if (request.content.trim() === '') {
    return err({
      kind: 'empty_content',
      message: `Refusing to load: ${manifest.sourceName} contains no rows.`,
    });
  }

  const { rows, issues } = parseRows(manifest, request.content, request.format);
  if (issues.length > 0) {
    return err({
      kind: 'invalid_rows',
      message: `Refusing to load: ${issues.length} row(s) of ${manifest.sourceName} could not be read.`,
      issues,
    });
  }
  if (rows.length === 0) {
    return err({
      kind: 'empty_content',
      message: `Refusing to load: ${manifest.sourceName} contains no rows.`,
    });
  }
  if (manifest.rowCount !== undefined && manifest.rowCount !== rows.length) {
    return err({
      kind: 'row_count_mismatch',
      message: `Refusing to load: the manifest promises ${manifest.rowCount} rows, the payload has ${rows.length}.`,
      expected: manifest.rowCount,
      actual: rows.length,
    });
  }

  return ok({ manifest, format: request.format, contentHash: actual, rows });
}
