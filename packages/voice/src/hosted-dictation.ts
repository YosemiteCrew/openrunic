/**
 * The part of hosted dictation both apps share: reading what the API says
 * about it, and choosing the microphone from that.
 *
 * Each app declares its own copy of the assistant's wire types, because the
 * server package must not reach a browser bundle. This block is the exception:
 * it decides where a person's voice goes, so there is one reading of it rather
 * than two that could disagree.
 */

import { createBrowserRealtimeTransport } from './browser-realtime.js';
import type { BrowserMedia, RealtimeCredential, RealtimeMint } from './browser-realtime.js';
import type { CapturePort } from './capture.js';
import { createPlatformCapture } from './platform-capture.js';
import { createRealtimeCapture } from './realtime-capture.js';

/** A hosted transcription service, as the assistant's capabilities name it. */
export interface HostedDictation {
  endpoint: string;
  agreement: string;
  languages: readonly string[];
  turnDetection: 'server' | 'manual';
}

/** Where dictated audio goes, as the control says it before the press. */
export interface DictationEgress {
  host: string;
  agreement: string;
}

export interface ChosenCapture {
  port: CapturePort | null;
  /** Null while the audio stays on the device. */
  egress: DictationEgress | null;
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Reads the `dictation` block. Anything short of a whole one is none: audio
 * must not leave the device on a half-read endpoint or an unnamed agreement.
 */
export function readHostedDictation(value: unknown): HostedDictation | null {
  if (!isRow(value)) return null;
  const endpoint = text(value.endpoint);
  const agreement = text(value.agreement);
  const { languages, turnDetection } = value;
  if (endpoint === null || agreement === null) return null;
  if (turnDetection !== 'server' && turnDetection !== 'manual') return null;
  if (!Array.isArray(languages)) return null;
  const tags = languages.filter((tag): tag is string => text(tag) !== null);
  if (tags.length === 0) return null;
  return { endpoint, agreement, languages: tags, turnDetection };
}

/** Reads a minted session. Throws on anything short of a whole credential. */
export function readRealtimeCredential(value: unknown): RealtimeCredential {
  const endpoint = isRow(value) ? text(value.endpoint) : null;
  const credential = isRow(value) ? text(value.credential) : null;
  if (endpoint === null || credential === null) {
    throw new Error('The dictation session could not be read.');
  }
  return { endpoint, credential };
}

/**
 * The hosted service when the API named one and this browser can reach it,
 * otherwise the device's own recogniser.
 *
 * The fallback is safe because it is the default: the on-device adapter
 * refuses anything that would send audio away. What matters is that the
 * control describes the one actually chosen, so the egress is returned beside
 * the port rather than read from the capabilities a second time.
 */
export function chooseCapture(
  dictation: HostedDictation | null,
  mint: RealtimeMint,
  media?: BrowserMedia | null
): ChosenCapture {
  if (dictation !== null) {
    const transport = createBrowserRealtimeTransport({
      endpoint: dictation.endpoint,
      languages: dictation.languages,
      turnDetection: dictation.turnDetection,
      mint,
      ...(media === undefined ? {} : { media }),
    });
    if (transport !== null) {
      return {
        port: createRealtimeCapture(transport, {
          endpoint: dictation.endpoint,
          agreement: dictation.agreement,
        }),
        egress: { host: new URL(dictation.endpoint).host, agreement: dictation.agreement },
      };
    }
  }
  return { port: createPlatformCapture(), egress: null };
}
