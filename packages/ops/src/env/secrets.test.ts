import { describe, expect, it } from 'vitest';

import {
  GENERATE_SENTINEL,
  fillGeneratedSecrets,
  generateSecret,
  missingKeys,
  parseEnvLines,
} from './secrets.js';

describe('generateSecret', () => {
  it('returns URL-safe characters only, because it goes into a connection URL', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateSecret()));
    expect(seen.size).toBe(100);
  });

  it('refuses a length short enough to be guessable', () => {
    expect(() => generateSecret(8)).toThrow(RangeError);
    expect(() => generateSecret(16.5)).toThrow(RangeError);
  });
});

describe('parseEnvLines', () => {
  it('reads keys and values, ignoring comments and blanks', () => {
    const lines = parseEnvLines('# a comment\n\nFOO=bar\nBAZ = qux\n');

    expect(lines.filter((line) => line.key !== null).map((line) => [line.key, line.value])).toEqual(
      [
        ['FOO', 'bar'],
        ['BAZ', 'qux'],
      ]
    );
  });

  it('unwraps quoted values', () => {
    expect(parseEnvLines('A="one"\nB=\'two\'').map((line) => line.value)).toEqual(['one', 'two']);
  });
});

describe('fillGeneratedSecrets', () => {
  it('replaces every sentinel and reports the key names', () => {
    const result = fillGeneratedSecrets(
      `POSTGRES_PASSWORD=${GENERATE_SENTINEL}\nAPI_SECRET=${GENERATE_SENTINEL}\n`
    );

    expect(result.generated).toEqual(['POSTGRES_PASSWORD', 'API_SECRET']);
    expect(result.contents).not.toContain(GENERATE_SENTINEL);
  });

  it('never reports the value it generated, only the key', () => {
    const result = fillGeneratedSecrets(`SECRET=${GENERATE_SENTINEL}`, () => 'super-secret-value');

    expect(result.generated).toEqual(['SECRET']);
    expect(result.generated.join()).not.toContain('super-secret-value');
  });

  it('leaves a value that is already set completely alone', () => {
    const input = 'POSTGRES_PASSWORD=already-chosen\n';
    const result = fillGeneratedSecrets(input);

    expect(result.contents).toBe(input);
    expect(result.generated).toEqual([]);
  });

  it('preserves comments, blank lines and ordering', () => {
    const result = fillGeneratedSecrets(
      `# leading comment\n\nA=1\nPASSWORD=${GENERATE_SENTINEL}\n# trailing\n`
    );

    const lines = result.contents.split('\n');
    expect(lines[0]).toBe('# leading comment');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('A=1');
    expect(lines[4]).toBe('# trailing');
  });

  it('matches the sentinel through surrounding quotes and spacing', () => {
    const result = fillGeneratedSecrets(`  PASSWORD = "${GENERATE_SENTINEL}"`);
    expect(result.generated).toEqual(['PASSWORD']);
  });

  it('does not treat a comment mentioning the sentinel as a key', () => {
    const input = `# set this to ${GENERATE_SENTINEL}\n`;
    expect(fillGeneratedSecrets(input).generated).toEqual([]);
  });
});

describe('missingKeys', () => {
  it('names keys the template has and the current file does not', () => {
    expect(missingKeys('A=1\nB=2\nC=3\n', 'A=x\nC=y\n')).toEqual(['B']);
  });

  it('is empty when the file is complete or has extras of its own', () => {
    expect(missingKeys('A=1\n', 'A=x\nEXTRA=y\n')).toEqual([]);
  });
});
