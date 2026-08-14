import { describe, expect, it } from 'vitest';
import { ICON_STROKE_WIDTH, resolveLucideIcon, toLucideName } from './lucide';

describe('toLucideName', () => {
  it.each([
    ['heart-pulse', 'HeartPulse'],
    ['file-text', 'FileText'],
    ['check', 'Check'],
    ['arrow-up-1-0', 'ArrowUp10'],
    ['Check', 'Check'],
    ['shield_off', 'ShieldOff'],
    ['--download--', 'Download'],
  ])('maps %s to %s', (slug, expected) => {
    expect(toLucideName(slug)).toBe(expected);
  });
});

describe('resolveLucideIcon', () => {
  it('resolves a known slug to a component', () => {
    expect(resolveLucideIcon('arrow-right')).toBeTruthy();
  });

  it('returns undefined for an unknown slug', () => {
    expect(resolveLucideIcon('not-a-real-lucide-icon')).toBeUndefined();
  });

  it('memoises both hits and misses', () => {
    expect(resolveLucideIcon('download')).toBe(resolveLucideIcon('download'));
    expect(resolveLucideIcon('still-not-an-icon')).toBeUndefined();
    expect(resolveLucideIcon('still-not-an-icon')).toBeUndefined();
  });
});

describe('ICON_STROKE_WIDTH', () => {
  it('sits inside the brand stroke range of 1.5 to 1.75px', () => {
    expect(ICON_STROKE_WIDTH).toBeGreaterThanOrEqual(1.5);
    expect(ICON_STROKE_WIDTH).toBeLessThanOrEqual(1.75);
  });
});
