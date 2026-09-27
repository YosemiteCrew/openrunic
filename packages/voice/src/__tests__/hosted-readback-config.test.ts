import { describe, expect, it, vi } from 'vitest';
import {
  chooseReadback,
  readHostedReadback,
  readReadbackCredential,
} from '../hosted-readback-config.js';

/**
 * The shared logic for hosted readback: reading the capabilities and choosing
 * the synthesiser. Mirrors hosted-dictation.test.ts.
 */

const READBACK = {
  endpoint: 'https://tts.example.test/v1/synthesize',
  agreement: 'a synthetic agreement with a fictional provider',
  languages: ['en-GB', 'es'],
};

function scriptedMint(
  mintImpl: (language: string) => Promise<{
    endpoint: string;
    credential: string;
    expiresAt: string;
    language: string;
    agreement: string;
  }> = async () => ({
    endpoint: 'https://tts.example.test/v1/synthesize',
    credential: 'synthetic-credential',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    language: 'en-GB',
    agreement: 'a synthetic agreement with a fictional provider',
  })
) {
  return vi.fn<typeof mintImpl>().mockImplementation(mintImpl);
}

describe('readHostedReadback', () => {
  it('reads a whole one', () => {
    expect(readHostedReadback(READBACK)).toEqual(READBACK);
  });

  it('reads a broken one as no hosted readback', () => {
    expect(readHostedReadback({ ...READBACK, agreement: '' })).toBeNull();
    expect(readHostedReadback({ ...READBACK, endpoint: '' })).toBeNull();
    expect(readHostedReadback({ ...READBACK, languages: [] })).toBeNull();
    expect(readHostedReadback({ ...READBACK, languages: [''] })).toBeNull();
  });

  it('reads an older server with no block as no hosted readback', () => {
    expect(readHostedReadback(null)).toBeNull();
    expect(readHostedReadback({})).toBeNull();
    expect(readHostedReadback({ languages: ['en-GB'] })).toBeNull();
  });
});

describe('readReadbackCredential', () => {
  it('reads a valid credential', () => {
    const credential = {
      endpoint: 'https://tts.example.test/v1/synthesize',
      credential: 'synthetic-credential',
      expiresAt: '2026-01-01T00:00:00.000Z',
      language: 'en-GB',
      agreement: 'a synthetic agreement',
    };
    expect(readReadbackCredential(credential)).toEqual(credential);
  });

  it('throws on missing endpoint', () => {
    expect(() =>
      readReadbackCredential({
        endpoint: '',
        credential: 'synthetic-credential',
        expiresAt: '2026-01-01T00:00:00.000Z',
        language: 'en-GB',
        agreement: 'a synthetic agreement',
      })
    ).toThrow();
  });

  it('throws on missing credential', () => {
    expect(() =>
      readReadbackCredential({
        endpoint: 'https://tts.example.test/v1/synthesize',
        credential: '',
        expiresAt: '2026-01-01T00:00:00.000Z',
        language: 'en-GB',
        agreement: 'a synthetic agreement',
      })
    ).toThrow();
  });
});

describe('chooseReadback', () => {
  it('returns null port when no readback is configured', () => {
    const mint = scriptedMint();
    const result = chooseReadback(null, mint);
    expect(result.port).toBeNull();
    expect(result.egress).toBeNull();
  });

  it('returns null port when the browser cannot reach the service (non-HTTPS)', () => {
    const readback = {
      endpoint: 'http://tts.example.test/v1/synthesize',
      agreement: 'a synthetic agreement with a fictional provider',
      languages: ['en-GB', 'es'],
    };
    const mint = scriptedMint();
    const result = chooseReadback(readback, mint);
    expect(result.port).toBeNull();
    expect(result.egress).toBeNull();
  });
});
