import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FIXTURES } from './__fixtures__/index.js';
import * as x12 from './index.js';
import {
  toFrequencyCode,
  toPayerResponsibilityCode,
  toRelationshipCode,
  toX12Gender,
} from './domain.js';

/**
 * The package's runtime export list, pinned.
 *
 * Types are erased, so only values can be asserted this way. That is enough:
 * an accidentally removed export breaks a consumer at build time, and an
 * accidentally added one is a public-surface decision that should be made on
 * purpose rather than noticed six releases later.
 */

const EXPECTED_EXPORTS = [
  'ACCEPTED_ACK_CODES',
  'ACTIVE_ELIGIBILITY_CODES',
  'DEFAULT_DELIMITERS',
  'DEFAULT_SERVICE_TYPE_CODES',
  'IMPLEMENTATION_270',
  'IMPLEMENTATION_271',
  'IMPLEMENTATION_277',
  'IMPLEMENTATION_835',
  'IMPLEMENTATION_837P',
  'IMPLEMENTATION_999',
  'ISA_SEGMENT_LENGTH',
  'REJECTION_CATEGORY_CODES',
  'componentAt',
  'createControlNumberSource',
  'decode271',
  'decode277',
  'decode835',
  'decode999',
  'detectDelimiters',
  'encode270',
  'encode837P',
  'firstTransactionOfType',
  'formatAmount',
  'formatDate6',
  'formatDate8',
  'formatInterchangeControlNumber',
  'formatTime4',
  'formatTransactionControlNumber',
  'formatX12Error',
  'isEmptyAt',
  'locate',
  'padRight',
  'parseAmount',
  'parseDate8',
  'parseNumber',
  'readInterchange',
  'readSegments',
  'segment',
  'simpleAt',
  'toAckOutcomes',
  'toClaimStatusOutcomes',
  'toCoverageSummary',
  'toFrequencyCode',
  'toPayerResponsibilityCode',
  'toRelationshipCode',
  'toRemittanceLines',
  'toX12Gender',
  'validateControlNumbers',
  'validateDelimiters',
  'writeInterchange',
  'writeSegment',
] as const;

describe('public surface', () => {
  it('exports exactly the documented runtime names', () => {
    expect(Object.keys(x12).sort()).toEqual([...EXPECTED_EXPORTS]);
  });

  it('pins the implementation conventions this codec speaks', () => {
    expect({
      claim: x12.IMPLEMENTATION_837P,
      remittance: x12.IMPLEMENTATION_835,
      status: x12.IMPLEMENTATION_277,
      acknowledgement: x12.IMPLEMENTATION_999,
      inquiry: x12.IMPLEMENTATION_270,
      response: x12.IMPLEMENTATION_271,
    }).toEqual({
      claim: '005010X222A1',
      remittance: '005010X221A1',
      status: '005010X214',
      acknowledgement: '005010X231A1',
      inquiry: '005010X279A1',
      response: '005010X279A1',
    });
  });
});

describe('corpus integrity', () => {
  it('documents every fixture on disk, and ships every fixture it documents', () => {
    const onDisk = readdirSync(fileURLToPath(new URL('./__fixtures__', import.meta.url)))
      .filter((name) => name.endsWith('.edi'))
      .sort();
    expect(FIXTURES.map((fixture) => fixture.name).sort()).toEqual(onDisk);
  });

  it('says what each fixture exercises that no other one does', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.exercises.length, `${fixture.name} has no description`).toBeGreaterThan(40);
    }
    expect(new Set(FIXTURES.map((fixture) => fixture.exercises)).size).toBe(FIXTURES.length);
  });
});

describe('domain code mappings', () => {
  it('narrows administrative gender to the three codes 5010 accepts', () => {
    expect(toX12Gender('FEMALE')).toBe('F');
    expect(toX12Gender('MALE')).toBe('M');
    expect(toX12Gender('OTHER')).toBe('U');
    expect(toX12Gender('UNKNOWN')).toBe('U');
  });

  it('maps coverage rank onto the SBR01 responsibility sequence', () => {
    expect(toPayerResponsibilityCode('PRIMARY')).toBe('P');
    expect(toPayerResponsibilityCode('SECONDARY')).toBe('S');
    expect(toPayerResponsibilityCode('TERTIARY')).toBe('T');
  });

  it('maps the subscriber relationship onto SBR02 and PAT01', () => {
    expect(toRelationshipCode('self')).toBe('18');
    expect(toRelationshipCode('spouse')).toBe('01');
    expect(toRelationshipCode('child')).toBe('19');
    expect(toRelationshipCode('other')).toBe('G8');
  });

  it('maps claim frequency onto CLM05-3', () => {
    expect(toFrequencyCode('ORIGINAL')).toBe('1');
    expect(toFrequencyCode('REPLACEMENT')).toBe('7');
    expect(toFrequencyCode('VOID')).toBe('8');
  });
});
