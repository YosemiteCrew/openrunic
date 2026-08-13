import { describe, expect, it } from 'vitest';

import {
  CONCEPT_KEY_SEPARATOR,
  clampLimit,
  clampOffset,
  compareExpansionOrder,
  compareSearchOrder,
  conceptKey,
  displayContains,
  displayStartsWith,
} from './ordering.js';
import { MAX_PAGE_SIZE } from './service.js';
import type { TerminologyConcept } from './service.js';
import { PROBLEM_SYSTEM, PROCEDURE_SYSTEM } from './test-support/fixture.js';

const base: TerminologyConcept = {
  system: PROBLEM_SYSTEM,
  code: 'PB-100',
  display: 'Aching elbow',
  version: '2026-01',
  parentCode: null,
  isActive: true,
  properties: null,
};

describe('sort keys', () => {
  it('orders an expansion by system before display', () => {
    const other = { ...base, system: PROCEDURE_SYSTEM, display: 'Aardvark' };
    expect(compareExpansionOrder(other, base)).toBeGreaterThan(0);
    expect(compareExpansionOrder(base, other)).toBeLessThan(0);
  });

  it('orders a search by display before system', () => {
    const other = { ...base, system: PROCEDURE_SYSTEM, display: 'Aardvark' };
    expect(compareSearchOrder(other, base)).toBeLessThan(0);
  });

  it('falls through display and code to version, so the key is total', () => {
    const older = { ...base, version: '2025-01' };
    expect(compareExpansionOrder(older, base)).toBeLessThan(0);
    expect(compareSearchOrder(older, base)).toBeLessThan(0);
    expect(compareExpansionOrder(base, { ...base })).toBe(0);
    expect(compareSearchOrder(base, { ...base })).toBe(0);
  });

  it('separates two codes that differ only by code', () => {
    const sibling = { ...base, code: 'PB-101' };
    expect(compareExpansionOrder(base, sibling)).toBeLessThan(0);
    expect(compareSearchOrder(base, sibling)).toBeLessThan(0);
  });

  it('keys a concept on the identity the unique constraint uses', () => {
    expect(conceptKey(base)).toBe(
      [PROBLEM_SYSTEM, 'PB-100', '2026-01'].join(CONCEPT_KEY_SEPARATOR)
    );
    expect(conceptKey({ ...base, version: '2025-01' })).not.toBe(conceptKey(base));
  });

  it('keys on a separator no publisher can put inside a code', () => {
    const awkward = { ...base, code: `PB-100${CONCEPT_KEY_SEPARATOR}x` };
    expect(conceptKey(awkward)).not.toBe(conceptKey(base));
  });
});

describe('paging bounds', () => {
  it('falls back to the caller default for an absent or nonsensical limit', () => {
    expect(clampLimit(undefined, 20)).toBe(20);
    expect(clampLimit(Number.NaN, 20)).toBe(20);
    expect(clampLimit(Number.POSITIVE_INFINITY, 20)).toBe(20);
  });

  it('keeps a limit inside one page', () => {
    expect(clampLimit(5, 20)).toBe(5);
    expect(clampLimit(0, 20)).toBe(1);
    expect(clampLimit(-4, 20)).toBe(1);
    expect(clampLimit(7.9, 20)).toBe(7);
    expect(clampLimit(MAX_PAGE_SIZE + 500, 20)).toBe(MAX_PAGE_SIZE);
  });

  it('never lets an offset go backwards', () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(-9)).toBe(0);
    expect(clampOffset(3.7)).toBe(3);
  });
});

describe('display matching', () => {
  it('matches a substring in any case', () => {
    expect(displayContains('Aching left elbow', 'LEFT')).toBe(true);
    expect(displayContains('Aching left elbow', 'ankle')).toBe(false);
  });

  it('matches a prefix in any case', () => {
    expect(displayStartsWith('Aching left elbow', 'ach')).toBe(true);
    expect(displayStartsWith('Aching left elbow', 'left')).toBe(false);
  });
});
