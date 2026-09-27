import { describe, expect, it } from 'vitest';
import { chooseCapture, readHostedDictation, readRealtimeCredential } from '../index.js';
import type { BrowserMedia, HostedDictation, RealtimeMint } from '../index.js';

/**
 * Reading what the API says about hosted dictation, and choosing a microphone
 * from it. Both apps call these, so a whole block is the only thing that can
 * send audio anywhere and anything less keeps it on the device.
 */

const DICTATION: HostedDictation = {
  endpoint: 'https://speech.example.test/v1/realtime',
  agreement: 'a synthetic agreement with a fictional provider',
  languages: ['en-US', 'es'],
  turnDetection: 'server',
};

describe('readHostedDictation', () => {
  it('reads a whole block', () => {
    expect(readHostedDictation(DICTATION)).toEqual(DICTATION);
    expect(readHostedDictation({ ...DICTATION, turnDetection: 'manual' })?.turnDetection).toBe(
      'manual'
    );
  });

  it('keeps only the language tags it can read', () => {
    expect(readHostedDictation({ ...DICTATION, languages: ['es', 3, '', ' '] })?.languages).toEqual(
      ['es']
    );
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['not an object', 'on'],
    ['no endpoint', { ...DICTATION, endpoint: 7 }],
    ['a blank endpoint', { ...DICTATION, endpoint: ' ' }],
    ['no agreement', { ...DICTATION, agreement: undefined }],
    ['a blank agreement', { ...DICTATION, agreement: '  ' }],
    ['an unknown turn detection', { ...DICTATION, turnDetection: 'auto' }],
    ['no language list', { ...DICTATION, languages: 'en' }],
    ['no readable language', { ...DICTATION, languages: [1, ''] }],
  ])('reads %s as none', (_name, value) => {
    expect(readHostedDictation(value)).toBeNull();
  });
});

describe('readRealtimeCredential', () => {
  it('reads the endpoint and the credential, and nothing else', () => {
    expect(
      readRealtimeCredential({
        endpoint: DICTATION.endpoint,
        credential: 'synthetic-value',
        agreement: 'x',
      })
    ).toEqual({ endpoint: DICTATION.endpoint, credential: 'synthetic-value' });
  });

  it.each([
    ['no credential', { endpoint: DICTATION.endpoint }],
    ['an empty credential', { endpoint: DICTATION.endpoint, credential: '' }],
    ['no endpoint', { credential: 'x' }],
    ['not an object', 'x'],
  ])('refuses %s', (_name, value) => {
    expect(() => readRealtimeCredential(value)).toThrow();
  });
});

const REFUSE: RealtimeMint = () => Promise.reject(new Error('unused'));

function media(): BrowserMedia {
  return {
    microphone: () => Promise.reject(new Error('unused')),
    peer: () => {
      throw new Error('unused');
    },
    fetch: () => Promise.reject(new Error('unused')),
  };
}

describe('chooseCapture', () => {
  it('uses the hosted service and names where the audio goes', async () => {
    const chosen = chooseCapture(DICTATION, REFUSE, media());
    expect(chosen.egress).toEqual({ host: 'speech.example.test', agreement: DICTATION.agreement });
    // The hosted port answers from the service's languages, not the device's.
    expect(await chosen.port?.available('es-MX')).toEqual({ status: 'available' });
    expect(await chosen.port?.available('fr')).toEqual({
      status: 'unavailable',
      reason: 'language',
    });
  });

  it('keeps the device when no service is named', () => {
    expect(chooseCapture(null, REFUSE, media()).egress).toBeNull();
  });

  it('keeps the device when this browser cannot reach the service', () => {
    expect(chooseCapture(DICTATION, REFUSE, null).egress).toBeNull();
    expect(
      chooseCapture({ ...DICTATION, endpoint: 'wss://speech.example.test' }, REFUSE, media()).egress
    ).toBeNull();
  });

  it('asks the browser for its own capabilities when none are injected', () => {
    // jsdom has no peer connection, so the device's recogniser is chosen.
    expect(chooseCapture(DICTATION, REFUSE).egress).toBeNull();
  });
});
