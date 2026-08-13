import { describe, expect, it } from 'vitest';

import {
  moveItem,
  presentEligibility,
  PRIORITY_SEQUENCE,
  priorityForIndex,
} from '@/components/insurance';
import { mockCoveragesForPatient, mockVerifyEligibility, MOCK_PATIENTS } from '@/lib/api';

/**
 * Eligibility presentation. The line worth defending is the one between a payer
 * that said no and a payer that said nothing: they read differently and lead to
 * different actions at the desk.
 */

describe('presentEligibility', () => {
  it('gives every outcome a word, so colour is never the message', () => {
    for (const outcome of ['ACTIVE', 'INACTIVE', 'NOT_FOUND', 'UNAVAILABLE', null] as const) {
      expect(presentEligibility(outcome).label.length).toBeGreaterThan(0);
    }
  });

  it('keeps olive for active coverage and danger for a coverage problem', () => {
    expect(presentEligibility('ACTIVE').tone).toBe('success');
    expect(presentEligibility('INACTIVE').tone).toBe('danger');
    expect(presentEligibility('NOT_FOUND').tone).toBe('danger');
  });

  it('treats a payer outage as degraded, not as a refusal', () => {
    const outage = presentEligibility('UNAVAILABLE');
    expect(outage.degraded).toBe(true);
    expect(outage.tone).not.toBe('danger');
    expect(outage.guidance).toMatch(/check-in can continue/);
  });

  it('tells the desk what to do about every problem outcome', () => {
    expect(presentEligibility('INACTIVE').guidance.length).toBeGreaterThan(0);
    expect(presentEligibility('NOT_FOUND').guidance).toMatch(/member id/);
  });

  it('says nothing extra when the coverage is simply fine', () => {
    expect(presentEligibility('ACTIVE').guidance).toBe('');
  });
});

describe('priorityForIndex', () => {
  it('follows position, so reordering the cards is the whole edit', () => {
    expect(priorityForIndex(0)).toBe('PRIMARY');
    expect(priorityForIndex(1)).toBe('SECONDARY');
    expect(priorityForIndex(2)).toBe('TERTIARY');
  });

  it('keeps the last slot rather than inventing one past tertiary', () => {
    expect(priorityForIndex(9)).toBe(PRIORITY_SEQUENCE.at(-1));
    expect(priorityForIndex(-1)).toBe('PRIMARY');
  });
});

describe('moveItem', () => {
  it('moves an item and leaves the rest in order', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op off either end, so a disabled control cannot corrupt the list', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
});

describe('mockCoveragesForPatient', () => {
  it('returns coverage already in billing order', () => {
    const coverages = mockCoveragesForPatient(MOCK_PATIENTS[7]?.id ?? '');
    expect(coverages.map((coverage) => coverage.priority)).toEqual(['PRIMARY', 'SECONDARY']);
  });

  it('returns nothing for a self-pay patient', () => {
    expect(mockCoveragesForPatient('no-such-patient')).toEqual([]);
  });
});

describe('mockVerifyEligibility', () => {
  it('resolves rather than rejects when the payer does not answer', async () => {
    const result = await mockVerifyEligibility('0192f1a0-0000-7000-8000-00000000c005');
    expect(result.outcome).toBe('UNAVAILABLE');
  });

  it('answers not-found for a member the payer cannot match', async () => {
    const result = await mockVerifyEligibility('0192f1a0-0000-7000-8000-00000000c003');
    expect(result.outcome).toBe('NOT_FOUND');
  });

  it('carries the benefit detail back with an active answer', async () => {
    const result = await mockVerifyEligibility('0192f1a0-0000-7000-8000-00000000c001');
    expect(result.outcome).toBe('ACTIVE');
    expect(result.copayAmount).toBe(25);
    expect(result.deductibleRemaining).toBe(340);
  });
});
