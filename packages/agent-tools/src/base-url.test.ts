import { describe, expect, it } from 'vitest';

import { trimTrailingSlashes } from './base-url.js';

describe('trimTrailingSlashes', () => {
  it('leaves a URL without a trailing slash untouched', () => {
    expect(trimTrailingSlashes('https://api.example.test/fhir')).toBe(
      'https://api.example.test/fhir'
    );
  });

  it('removes a single trailing slash', () => {
    expect(trimTrailingSlashes('https://api.example.test/')).toBe('https://api.example.test');
  });

  it('removes a run of trailing slashes', () => {
    expect(trimTrailingSlashes('https://api.example.test/fhir////')).toBe(
      'https://api.example.test/fhir'
    );
  });

  it('keeps interior slashes', () => {
    expect(trimTrailingSlashes('https://api.example.test//a//b//')).toBe(
      'https://api.example.test//a//b'
    );
  });

  it('handles the empty string and an all-slash string', () => {
    expect(trimTrailingSlashes('')).toBe('');
    expect(trimTrailingSlashes('////')).toBe('');
  });

  /**
   * The regex this helper replaced was quadratic: a long run of slashes made the
   * engine retry from every position. A linear scan stays flat, so a pathological
   * input finishes in well under the budget a backtracking engine would blow.
   */
  it('stays linear on a pathological run of slashes', () => {
    const pathological = `${'/'.repeat(200_000)}x${'/'.repeat(200_000)}`;
    const started = performance.now();
    const result = trimTrailingSlashes(pathological);
    const elapsedMs = performance.now() - started;

    expect(result).toBe(`${'/'.repeat(200_000)}x`);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
