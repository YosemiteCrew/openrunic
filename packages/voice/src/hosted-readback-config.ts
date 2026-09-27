/**
 * The part of hosted readback both apps share: reading what the API says
 * about it, and choosing the synthesiser from that.
 *
 * Each app declares its own copy of the assistant's wire types, because the
 * server package must not reach a browser bundle. This block is the exception:
 * it decides where a person's text goes, so there is one reading of it rather
 * than two that could disagree.
 */

import { createBrowserHostedSynthesiser } from './browser-readback.js';
import type { BrowserReadbackOptions, ReadbackMint } from './browser-readback.js';
import { createHostedReadback } from './hosted-readback.js';
import type { HostedReadbackEgress } from './hosted-readback.js';
import type { ReadbackPort } from './ports.js';

/** A hosted text-to-speech service, as the assistant's capabilities name it. */
export interface HostedReadbackConfig {
  endpoint: string;
  agreement: string;
  languages: readonly string[];
}

/** Where spoken audio comes from, as the control says it before the toggle. */
export interface ReadbackEgress {
  host: string;
  agreement: string;
}

export interface ChosenReadback {
  port: ReadbackPort | null;
  /** Null while the text stays on the device. */
  egress: ReadbackEgress | null;
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Reads the `readback` block. Anything short of a whole one is none: text
 * must not leave the device on a half-read endpoint or an unnamed agreement.
 */
export function readHostedReadback(value: unknown): HostedReadbackConfig | null {
  if (!isRow(value)) return null;
  const endpoint = text(value.endpoint);
  const agreement = text(value.agreement);
  const { languages } = value;
  if (endpoint === null || agreement === null) return null;
  if (!Array.isArray(languages)) return null;
  const tags = languages.filter((tag): tag is string => text(tag) !== null);
  if (tags.length === 0) return null;
  return { endpoint, agreement, languages: tags };
}

/**
 * Reads a minted session. Throws on anything short of a whole credential.
 */
export function readReadbackCredential(value: unknown): ReadbackCredential {
  if (!isRow(value)) throw new Error('The readback session could not be read.');
  const endpoint = text(value.endpoint);
  const credential = text(value.credential);
  const expiresAt = text(value.expiresAt);
  const language = text(value.language);
  const agreement = text(value.agreement);
  if (
    endpoint === null ||
    credential === null ||
    expiresAt === null ||
    language === null ||
    agreement === null
  ) {
    throw new Error('The readback session could not be read.');
  }
  return { endpoint, credential, expiresAt, language, agreement };
}

/** What a minted session carries, as the client reads it. */
export interface ReadbackCredential {
  endpoint: string;
  credential: string;
  expiresAt: string;
  language: string;
  agreement: string;
}

/**
 * The hosted service when the API named one and this browser can reach it,
 * otherwise the device's own synthesiser.
 *
 * The fallback is safe because it is the default: the on-device adapter
 * refuses anything that would send text away. What matters is that the
 * control describes the one actually chosen, so the egress is returned beside
 * the port rather than read from the capabilities a second time.
 */
export function chooseReadback(
  readback: HostedReadbackConfig | null,
  mint: ReadbackMint
): ChosenReadback {
  if (readback !== null) {
    const options: BrowserReadbackOptions = {
      endpoint: readback.endpoint,
      languages: readback.languages,
      mint,
    };
    const synthesiser = createBrowserHostedSynthesiser(options);
    if (synthesiser !== null) {
      const egress: HostedReadbackEgress = {
        endpoint: readback.endpoint,
        agreement: readback.agreement,
      };
      return {
        port: createHostedReadback(synthesiser, egress),
        egress: { host: new URL(readback.endpoint).host, agreement: readback.agreement },
      };
    }
  }
  return { port: null, egress: null };
}
