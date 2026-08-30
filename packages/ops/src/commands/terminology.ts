import { writeFile } from 'node:fs/promises';

import { loadCodeSystem, CODE_SYSTEM_FORMATS } from '@openrunic/terminology';
import type {
  CodeSystemFormat,
  CodeSystemLoad,
  CodeSystemLoadError,
  CodeSystemContentReader,
} from '@openrunic/terminology';

/**
 * Verifying a code system a deployer supplies, before a row of it is written.
 *
 * `packages/terminology` ships the loader and says in its own header that
 * reading the file is the CLI's job. Nothing filled that seam, so a deployment
 * holding a LOINC or SNOMED licence had the loader, the manifest schema and the
 * attestation gate available and no way to reach any of them - short of posting
 * a hundred thousand codes at `/terminology` one at a time.
 *
 * ## Why this verifies rather than writes
 *
 * The value in that package is the refusals: an unsigned attestation, a payload
 * that is not the file the manifest describes, a truncated export. Those are
 * the checks worth having in front of a load, and they are all decided before a
 * database is touched. Writing the rows afterwards is an ordinary insert that
 * the `/terminology` route and `\copy` both already do, and neither needs this
 * command's help.
 *
 * So this answers one question - may these rows be loaded, and what exactly are
 * they - and emits the normalised form for whichever writer the deployment
 * uses. A command that also wrote would have to hold a database connection and
 * a tenant, and would turn a licence check into a migration.
 */

/** Reads a file. Injected so the command is testable without a filesystem. */
export type FileReader = CodeSystemContentReader;

export interface TerminologyVerifyRequest {
  readonly manifestPath: string;
  readonly contentPath: string;
  readonly format: CodeSystemFormat;
  /** Where to write the normalised rows as NDJSON. Omitted means verify only. */
  readonly emitPath?: string;
  readonly readFile: FileReader;
  readonly writeFile?: (path: string, contents: string) => Promise<void>;
}

export interface TerminologyVerifyReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** `2.83` and `112405` read better than `2.83` and `112405` unspaced. */
function count(rows: number): string {
  return rows.toLocaleString('en-US');
}

function describeFailure(error: CodeSystemLoadError): readonly string[] {
  const lines = [`Refused: ${error.message}`];

  if (error.kind === 'invalid_manifest' || error.kind === 'missing_attestation') {
    // Each issue on its own line: a deployer fixing a manifest is editing a
    // file, and a semicolon-joined paragraph is not a checklist.
    for (const issue of error.issues) lines.push(`  - ${issue}`);
  }

  if (error.kind === 'content_hash_mismatch') {
    lines.push(`  manifest says  ${error.expected}`);
    lines.push(`  file is        ${error.actual}`);
    lines.push('  The payload is not the file the manifest describes.');
  }

  if (error.kind === 'invalid_rows') {
    // Line numbers, because the deployer's next move is opening the file at one.
    for (const issue of error.issues) {
      lines.push(`  line ${String(issue.line)}: ${issue.kind} - ${issue.message}`);
    }
  }

  if (error.kind === 'row_count_mismatch') {
    lines.push('  A truncated download reads as a smaller code system rather than as an error.');
  }

  return lines;
}

function describeSuccess(load: CodeSystemLoad, emitPath: string | undefined): readonly string[] {
  const { manifest } = load;
  const lines = [
    `Verified ${manifest.systemUri} ${manifest.systemVersion}`,
    `  source        ${manifest.sourceName}, released ${manifest.sourceReleaseDate}`,
    `  rows          ${count(load.rows.length)}`,
    `  content hash  ${load.contentHash}`,
    `  attested by   ${manifest.attestation.attestedBy} at ${manifest.attestation.attestedAt}`,
    `  statement     ${manifest.attestation.licenceStatement}`,
  ];
  if (manifest.attestation.licenceReference !== undefined) {
    lines.push(`  reference     ${manifest.attestation.licenceReference}`);
  }
  lines.push(
    emitPath === undefined
      ? '  Nothing written. Pass --emit <path> for the normalised rows.'
      : `  Wrote normalised rows to ${emitPath}`
  );
  return lines;
}

/**
 * Verifies one code system load and, when asked, emits the normalised rows.
 *
 * The rows are emitted as NDJSON rather than in the input format, because what
 * comes out is the normalised shape the database takes: the manifest's system
 * and version filled in on every row, duplicates already refused, and defaults
 * applied. Handing back the input would hand back the deployer's problem.
 */
export async function verifyCodeSystem(
  request: TerminologyVerifyRequest
): Promise<TerminologyVerifyReport> {
  let manifestText: string;
  let content: string;
  try {
    manifestText = await request.readFile(request.manifestPath);
    content = await request.readFile(request.contentPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, lines: [`Refused: could not read the input (${reason}).`] };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, lines: [`Refused: the manifest is not JSON (${reason}).`] };
  }

  const result = loadCodeSystem({ manifest, content, format: request.format });
  if (!result.ok) return { ok: false, lines: describeFailure(result.error) };

  if (request.emitPath !== undefined) {
    const write = request.writeFile ?? ((p, c) => writeFile(p, c, 'utf8'));
    const ndjson = `${result.value.rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await write(request.emitPath, ndjson);
  }

  return { ok: true, lines: describeSuccess(result.value, request.emitPath) };
}

/** Whether a string names a format the loader understands. */
export function isCodeSystemFormat(value: string): value is CodeSystemFormat {
  return (CODE_SYSTEM_FORMATS as readonly string[]).includes(value);
}
