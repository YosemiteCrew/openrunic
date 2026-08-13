import { describe, expect, it } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('joins class names with a single space', () => {
    expect(cx('or-btn', 'or-btn--primary')).toBe('or-btn or-btn--primary');
  });

  it('drops every falsy value', () => {
    expect(cx('or-btn', false, null, undefined, '', 'or-btn--full')).toBe('or-btn or-btn--full');
  });

  it('returns an empty string when nothing survives', () => {
    expect(cx()).toBe('');
    expect(cx(false, undefined)).toBe('');
  });

  it('keeps a leading falsy value from producing a leading space', () => {
    expect(cx(undefined, 'or-card')).toBe('or-card');
  });
});
