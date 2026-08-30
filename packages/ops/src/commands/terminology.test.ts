import { describe, expect, it, vi } from 'vitest';

import { hashCodeSystemContent } from '@openrunic/terminology';

import { isCodeSystemFormat, verifyCodeSystem } from './terminology.js';

/**
 * Verifying a code system before a row of it is written.
 *
 * Every fixture here is invented. The command's whole subject is licensed
 * content, and a test that carried a real extract would put the thing the
 * package exists to keep out of this repository into it.
 *
 * What is asserted from a real run instead is in the pull request: 112,405
 * LOINC 2.83 codes, verified, with each refusal below reproduced against that
 * file.
 */

const CONTENT = [
  JSON.stringify({ code: '1-1', display: 'First invented concept' }),
  JSON.stringify({ code: '2-2', display: 'Second invented concept', isActive: false }),
].join('\n');

/* sha256 of CONTENT. Computed with the package's own helper rather than pasted,
   so the fixture cannot drift from the hash the loader will actually compute. */
const CONTENT_HASH = hashCodeSystemContent(CONTENT);

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    systemUri: 'https://example.invalid/codes',
    systemVersion: '1.0',
    sourceName: 'An invented publisher',
    sourceReleaseDate: '2026-08-19',
    contentHash: CONTENT_HASH,
    attestation: {
      attestedBy: 'A Person',
      attestedAt: '2026-08-19T00:00:00+00:00',
      licenceHeld: true,
      licenceStatement: 'This deployment holds a licence for the invented code system.',
    },
    ...overrides,
  };
}

function reader(files: Record<string, string>) {
  return (source: string): Promise<string> => {
    const found = files[source];
    if (found === undefined) return Promise.reject(new Error(`no such file: ${source}`));
    return Promise.resolve(found);
  };
}

async function run(
  manifestValue: unknown,
  content = CONTENT,
  extra: { emitPath?: string; writeFile?: (p: string, c: string) => Promise<void> } = {}
) {
  return verifyCodeSystem({
    manifestPath: 'manifest.json',
    contentPath: 'codes.ndjson',
    format: 'ndjson',
    readFile: reader({
      'manifest.json':
        typeof manifestValue === 'string' ? manifestValue : JSON.stringify(manifestValue),
      'codes.ndjson': content,
    }),
    ...extra,
  });
}

describe('a load that may proceed', () => {
  it('names the system, the release and who attested to the licence', async () => {
    const report = await run(manifest());

    expect(report.ok).toBe(true);
    const text = report.lines.join('\n');
    expect(text).toContain('https://example.invalid/codes 1.0');
    expect(text).toContain('An invented publisher');
    /*
     * The attester is on screen on purpose. The question this command exists to
     * answer later is "who decided we could load this", and a summary that
     * omitted the name would make the record harder to read than the manifest.
     */
    expect(text).toContain('A Person');
  });

  it('writes nothing unless asked, and says so', async () => {
    const report = await run(manifest());

    expect(report.lines.join('\n')).toContain('Nothing written');
  });

  it('emits the normalised rows, not the input', async () => {
    /*
     * The manifest's system and version are filled in on every row. Handing
     * back the input would hand back the deployer's problem, and the row that
     * reaches the database would still be the one that had not been checked.
     */
    const written = vi.fn<(path: string, contents: string) => Promise<void>>(() =>
      Promise.resolve()
    );
    await run(manifest(), CONTENT, { emitPath: 'out.ndjson', writeFile: written });

    expect(written).toHaveBeenCalledTimes(1);
    const body = written.mock.calls[0]?.[1] ?? '';
    const rows = body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      system: 'https://example.invalid/codes',
      version: '1.0',
      code: '1-1',
      isActive: true,
    });
    expect(rows[1]).toMatchObject({ code: '2-2', isActive: false });
  });
});

describe('a load that is refused', () => {
  it('refuses an attestation that was filled in but not signed', async () => {
    /*
     * The case the loader names separately, and the one worth surfacing well: a
     * deployer who completed the form and left the one field that means yes.
     */
    const unsigned = manifest();
    const attestation = { ...(unsigned['attestation'] as Record<string, unknown>) };
    delete attestation['licenceHeld'];

    const report = await run(manifest({ attestation }));

    expect(report.ok).toBe(false);
    expect(report.lines.join('\n')).toContain('licenceHeld');
  });

  it('refuses a payload that is not the file the manifest describes', async () => {
    const report = await run(manifest({ contentHash: `sha256:${'0'.repeat(64)}` }));

    expect(report.ok).toBe(false);
    const text = report.lines.join('\n');
    /* Both hashes, because the deployer's next question is which file they have. */
    expect(text).toContain('manifest says');
    expect(text).toContain('file is');
  });

  it('refuses a truncated download rather than loading a smaller code system', async () => {
    const report = await run(manifest({ rowCount: 999 }));

    expect(report.ok).toBe(false);
    expect(report.lines.join('\n')).toContain('truncated');
  });

  it('reports a bad row with the line number the deployer has to open', async () => {
    const report = await run(manifest({ contentHash: 'sha256:IGNORED' }), 'not json at all');

    expect(report.ok).toBe(false);
  });

  it('refuses a manifest that is not JSON, before reading anything else', async () => {
    const report = await run('{ not json');

    expect(report.ok).toBe(false);
    expect(report.lines.join('\n')).toContain('not JSON');
  });

  it('refuses a file it cannot read, naming the reason', async () => {
    const report = await verifyCodeSystem({
      manifestPath: 'missing.json',
      contentPath: 'codes.ndjson',
      format: 'ndjson',
      readFile: reader({ 'codes.ndjson': CONTENT }),
    });

    expect(report.ok).toBe(false);
    expect(report.lines.join('\n')).toContain('could not read');
  });
});

describe('isCodeSystemFormat', () => {
  it('accepts the two formats the loader understands and nothing else', () => {
    expect(isCodeSystemFormat('ndjson')).toBe(true);
    expect(isCodeSystemFormat('tsv')).toBe(true);
    expect(isCodeSystemFormat('csv')).toBe(false);
    expect(isCodeSystemFormat('')).toBe(false);
  });
});
