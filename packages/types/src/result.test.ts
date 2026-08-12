import { describe, expect, it } from 'vitest';

import { err, ok } from './index.js';
import type { Result } from './index.js';

describe('ok / err', () => {
  it('ok wraps a value with ok: true', () => {
    expect(ok(42)).toStrictEqual({ ok: true, value: 42 });
  });

  it('err wraps an error with ok: false', () => {
    const boom = new Error('boom');
    expect(err(boom)).toStrictEqual({ ok: false, error: boom });
  });

  it('narrows via the ok discriminant', () => {
    const parse = (raw: string): Result<number, string> => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? ok(parsed) : err(`not a number: ${raw}`);
    };

    const good = parse('7');
    if (good.ok) {
      expect(good.value).toBe(7);
    } else {
      expect.unreachable('expected ok');
    }

    const bad = parse('seven');
    if (bad.ok) {
      expect.unreachable('expected err');
    } else {
      expect(bad.error).toBe('not a number: seven');
    }
  });

  it('supports non-Error error types', () => {
    const failure = err({ code: 404, message: 'missing' });
    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe(404);
  });
});
