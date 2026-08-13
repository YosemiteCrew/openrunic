import { describe, expect, it } from 'vitest';

import { hashCodeSystemContent } from './content-hash.js';
import { MAX_REPORTED_ROW_ISSUES, TSV_COLUMNS, loadCodeSystem } from './loader.js';
import type { CodeSystemFormat, TerminologyCodeInput } from './loader.js';

/**
 * The system, the codes and the practice below are all invented, and the URI is
 * under `example.invalid` so it can never resolve. A licensed code system must
 * never appear in this repository, including in a test fixture.
 */
const DEMO_SYSTEM = 'http://example.invalid/fs/demo-codes';

const ATTESTATION = {
  attestedBy: 'Testina Patientsson',
  attestedRole: 'Practice manager',
  attestedAt: '2026-08-13T09:00:00Z',
  licenceHeld: true,
  licenceStatement:
    'This practice holds a current licence permitting use of this content in this deployment.',
  licenceReference: 'AGREEMENT-0001',
};

function manifestFor(
  content: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    systemUri: DEMO_SYSTEM,
    systemVersion: '2026-01',
    sourceName: 'demo-codes 2026-01 export',
    sourceReleaseDate: '2026-01-15',
    contentHash: hashCodeSystemContent(content),
    attestation: ATTESTATION,
    ...overrides,
  };
}

function load(content: string, format: CodeSystemFormat, overrides?: Record<string, unknown>) {
  return loadCodeSystem({ manifest: manifestFor(content, overrides), content, format });
}

const NDJSON_CONTENT = [
  '{"code":"DX-1","display":"Invented condition one"}',
  '{"code":"DX-2","display":"Invented condition two","parentCode":"DX-1","isActive":false}',
].join('\n');

const TSV_CONTENT = [
  '\tDX-1\tInvented condition one\t\t\t',
  '\tDX-2\tInvented condition two\t\tDX-1\tfalse',
].join('\n');

const EXPECTED_ROWS: readonly TerminologyCodeInput[] = [
  {
    system: DEMO_SYSTEM,
    code: 'DX-1',
    display: 'Invented condition one',
    version: '2026-01',
    parentCode: null,
    isActive: true,
    properties: null,
  },
  {
    system: DEMO_SYSTEM,
    code: 'DX-2',
    display: 'Invented condition two',
    version: '2026-01',
    parentCode: 'DX-1',
    isActive: false,
    properties: null,
  },
];

describe('loading a payload', () => {
  it('turns line-delimited JSON into rows ready for insertion', () => {
    const result = load(NDJSON_CONTENT, 'ndjson');
    expect(result.ok && result.value.rows).toStrictEqual(EXPECTED_ROWS);
    expect(result.ok && result.value.format).toBe('ndjson');
    expect(result.ok && result.value.contentHash).toBe(hashCodeSystemContent(NDJSON_CONTENT));
    expect(result.ok && result.value.manifest.attestation.attestedBy).toBe('Testina Patientsson');
  });

  it('turns the delimited text format into exactly the same rows', () => {
    const result = load(TSV_CONTENT, 'tsv');
    expect(result.ok && result.value.rows).toStrictEqual(EXPECTED_ROWS);
  });

  it('skips a header line written by a spreadsheet export', () => {
    const content = [TSV_COLUMNS.join('\t'), TSV_CONTENT].join('\n');
    const result = load(content, 'tsv');
    expect(result.ok && result.value.rows).toStrictEqual(EXPECTED_ROWS);
  });

  it('lets a row state its own system and version as long as they agree', () => {
    const content = [DEMO_SYSTEM, 'DX-1', 'Invented condition one', '2026-01', '', 'true'].join(
      '\t'
    );
    const result = load(content, 'tsv');
    expect(result.ok && result.value.rows[0]?.system).toBe(DEMO_SYSTEM);
    expect(result.ok && result.value.rows[0]?.version).toBe('2026-01');
  });

  it('carries publisher properties through from line-delimited JSON', () => {
    const content =
      '{"code":"DX-9","display":"Invented condition nine","properties":{"chapter":"IX"},"parentCode":null}';
    const result = load(content, 'ndjson');
    expect(result.ok && result.value.rows[0]?.properties).toStrictEqual({ chapter: 'IX' });
    expect(result.ok && result.value.rows[0]?.parentCode).toBeNull();
  });

  it('ignores blank lines and tolerates carriage returns', () => {
    const content = `${NDJSON_CONTENT.split('\n').join('\r\n\r\n')}\r\n`;
    const result = load(content, 'ndjson');
    expect(result.ok && result.value.rows).toStrictEqual(EXPECTED_ROWS);
  });

  it('accepts a payload whose row count matches the manifest', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', { rowCount: 2 });
    expect(result.ok).toBe(true);
  });
});

describe('refusing a load without a complete attestation', () => {
  it('refuses a manifest that carries no attestation at all', () => {
    const result = loadCodeSystem({
      manifest: manifestFor(NDJSON_CONTENT, { attestation: undefined }),
      content: NDJSON_CONTENT,
      format: 'ndjson',
    });
    expect(!result.ok && result.error.kind).toBe('missing_attestation');
    expect(!result.ok && result.error.message).toContain('Refusing to load');
  });

  it('refuses an attestation that does not assert a licence is held', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', {
      attestation: { ...ATTESTATION, licenceHeld: false },
    });
    expect(!result.ok && result.error.kind).toBe('missing_attestation');
  });

  it('refuses an attestation with nobody named against it', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', {
      attestation: { ...ATTESTATION, attestedBy: '' },
    });
    expect(!result.ok && result.error.kind).toBe('missing_attestation');
  });

  it('refuses an attestation that states nothing about the licence', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', {
      attestation: {
        attestedBy: 'Testina Patientsson',
        attestedAt: '2026-08-13T09:00:00Z',
        licenceHeld: true,
      },
    });
    expect(!result.ok && result.error.kind).toBe('missing_attestation');
  });

  it('refuses an attestation dated with something that is not a timestamp', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', {
      attestation: { ...ATTESTATION, attestedAt: 'last Tuesday' },
    });
    expect(!result.ok && result.error.kind).toBe('missing_attestation');
  });
});

describe('refusing an unusable manifest', () => {
  it('refuses something that is not a manifest at all', () => {
    const result = loadCodeSystem({ manifest: null, content: NDJSON_CONTENT, format: 'ndjson' });
    expect(!result.ok && result.error.kind).toBe('invalid_manifest');
  });

  it('refuses a system that is not a canonical URI', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', { systemUri: 'demo-codes' });
    expect(!result.ok && result.error.kind).toBe('invalid_manifest');
    expect(
      !result.ok && result.error.kind === 'invalid_manifest' && result.error.issues[0]
    ).toContain('systemUri');
  });

  it('refuses a load that cannot name the release it came from', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', { systemVersion: '' });
    expect(!result.ok && result.error.kind).toBe('invalid_manifest');
  });

  it('refuses an unrecognized manifest key rather than ignoring it', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', { notes: 'loaded by hand' });
    expect(!result.ok && result.error.kind).toBe('invalid_manifest');
  });

  it('refuses a hash that is not an algorithm and a digest', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', { contentHash: 'deadbeef' });
    expect(!result.ok && result.error.kind).toBe('invalid_manifest');
  });
});

describe('refusing a payload the manifest does not describe', () => {
  it('refuses content whose hash does not match the manifest', () => {
    const result = loadCodeSystem({
      manifest: manifestFor('a different export entirely'),
      content: NDJSON_CONTENT,
      format: 'ndjson',
    });
    expect(!result.ok && result.error.kind).toBe('content_hash_mismatch');
    expect(!result.ok && result.error.message).toContain(hashCodeSystemContent(NDJSON_CONTENT));
  });

  it('refuses an empty file', () => {
    const result = load('', 'ndjson');
    expect(!result.ok && result.error.kind).toBe('empty_content');
  });

  it('refuses a file that is nothing but a header row', () => {
    const result = load(TSV_COLUMNS.join('\t'), 'tsv');
    expect(!result.ok && result.error.kind).toBe('empty_content');
  });

  it('refuses a payload with fewer rows than the manifest promised', () => {
    const result = load(NDJSON_CONTENT, 'ndjson', { rowCount: 5 });
    expect(!result.ok && result.error.kind).toBe('row_count_mismatch');
    expect(!result.ok && result.error.kind === 'row_count_mismatch' && result.error.actual).toBe(2);
  });
});

describe('refusing unusable rows', () => {
  function issuesOf(result: ReturnType<typeof load>) {
    return !result.ok && result.error.kind === 'invalid_rows' ? result.error.issues : [];
  }

  it('refuses the same code twice in one file, naming the second line', () => {
    const content = [
      '{"code":"DX-1","display":"Invented condition one"}',
      '{"code":"DX-1","display":"Invented condition one, again"}',
    ].join('\n');
    const issues = issuesOf(load(content, 'ndjson'));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('duplicate_code');
    expect(issues[0]?.line).toBe(2);
  });

  it('refuses a row with the wrong number of columns', () => {
    const content = ['\tDX-1\tInvented condition one\t\t\t', '\tDX-2\tToo few columns'].join('\n');
    const issues = issuesOf(load(content, 'tsv'));
    expect(issues[0]?.kind).toBe('wrong_column_count');
    expect(issues[0]?.line).toBe(2);
    expect(issues[0]?.message).toContain('found 3');
  });

  it('refuses a row with no code or no display', () => {
    const content = '\t\tInvented condition one\t\t\t';
    expect(issuesOf(load(content, 'tsv'))[0]?.kind).toBe('invalid_row');
  });

  it('refuses a status cell that is not a status', () => {
    const content = '\tDX-1\tInvented condition one\t\t\tperhaps';
    const issues = issuesOf(load(content, 'tsv'));
    expect(issues[0]?.kind).toBe('invalid_row');
    expect(issues[0]?.message).toContain('perhaps');
  });

  it('refuses a line that is not JSON', () => {
    const issues = issuesOf(load('{"code":"DX-1",', 'ndjson'));
    expect(issues[0]?.kind).toBe('malformed_json');
  });

  it('refuses a JSON row that is missing a required field', () => {
    const issues = issuesOf(load('{"code":"DX-1"}', 'ndjson'));
    expect(issues[0]?.kind).toBe('invalid_row');
    expect(issues[0]?.message).toContain('display');
  });

  it('refuses a JSON row carrying a column nobody defined', () => {
    const issues = issuesOf(
      load('{"code":"DX-1","display":"Invented condition one","weight":3}', 'ndjson')
    );
    expect(issues[0]?.kind).toBe('invalid_row');
  });

  it('refuses a row whose system disagrees with the manifest', () => {
    const content =
      '{"code":"DX-1","display":"Invented condition one","system":"http://example.invalid/fs/somewhere-else"}';
    const issues = issuesOf(load(content, 'ndjson'));
    expect(issues[0]?.kind).toBe('system_mismatch');
    expect(issues[0]?.message).toContain('somewhere-else');
  });

  it('refuses a row whose version disagrees with the manifest', () => {
    const content = '{"code":"DX-1","display":"Invented condition one","version":"2019-04"}';
    expect(issuesOf(load(content, 'ndjson'))[0]?.kind).toBe('version_mismatch');
  });

  it('stops reporting once the operator has enough examples', () => {
    const content = Array.from({ length: 60 }, (_unused, index) => `broken-${index}`).join('\n');
    const issues = issuesOf(load(content, 'tsv'));
    expect(issues).toHaveLength(MAX_REPORTED_ROW_ISSUES);
  });

  it('loads nothing at all when any row is unusable', () => {
    const content = [
      '{"code":"DX-1","display":"Invented condition one"}',
      'not json',
      '{"code":"DX-3","display":"Invented condition three"}',
    ].join('\n');
    const result = load(content, 'ndjson');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('1 row(s)');
  });
});
