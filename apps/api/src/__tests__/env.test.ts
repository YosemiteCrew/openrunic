import { describe, expect, it } from 'vitest';

import { parseEnv, type Env } from '../env.js';

describe('parseEnv', () => {
  it('applies defaults when variables are absent', () => {
    const env: Env = parseEnv({});

    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('parses and coerces provided values', () => {
    const env = parseEnv({ PORT: '8080', NODE_ENV: 'production' });

    expect(env).toEqual({ PORT: 8080, NODE_ENV: 'production' });
  });

  it('rejects out-of-range ports', () => {
    expect(() => parseEnv({ PORT: '70000' })).toThrowError(/PORT/);
  });

  it('names every invalid variable without echoing values', () => {
    let caught: unknown;
    try {
      parseEnv({ PORT: 'not-a-port', NODE_ENV: 'staging' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('PORT');
    expect(message).toContain('NODE_ENV');
    // values must never leak into the error message
    expect(message).not.toContain('not-a-port');
    expect(message).not.toContain('staging');
  });
});
