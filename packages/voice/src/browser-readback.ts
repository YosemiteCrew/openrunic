/**
 * A {@link HostedSynthesiser} for a browser: fetch audio from the hosted TTS
 * service and play it through an `<audio>` element.
 *
 * {@link ./hosted-readback.ts} decides which of the service's events count;
 * this file only moves bytes, and it is shaped by the three things a browser
 * synthesiser could get wrong on its own:
 *
 * - **The credential is fetched, never configured.** The service's own key is
 *   the deployer's, on the server. What reaches this file is a short-lived
 *   credential from `POST /bff/v0/agent/readback/sessions`, asked for when the
 *   voice is turned on and dropped when it is turned off.
 * - **Only to the endpoint the page was told about.** The synthesiser is built
 *   with the endpoint the capabilities response named - the same one the
 *   readback adapter shows as its egress. A credential issued for any other
 *   address is refused rather than followed, so what the screen says and where
 *   the text goes cannot come apart.
 * - **Audio comes one way.** The service returns audio bytes; this file plays
 *   them. No microphone, no WebRTC, no data channel.
 *
 * HTTPS only: the request is posted to the endpoint over `https`. A deployment
 * whose endpoint is not HTTPS gets no browser synthesiser from this file, and
 * so no hosted readback, rather than a guess at a socket protocol.
 */

import type { HostedSynthesiser, Playback, PlaybackHandlers } from './hosted-readback.js';

/** What the API hands back for one session, as far as this file reads it. */
export interface ReadbackCredential {
  endpoint: string;
  credential: string;
  expiresAt: string;
  language: string;
  agreement: string;
}

/**
 * Asks the API for a credential. The app's code, because the app owns its
 * session and its proxy; told the language and nothing about the record.
 */
export type ReadbackMint = (language: string, signal: AbortSignal) => Promise<ReadbackCredential>;

export interface BrowserReadbackOptions {
  /** The endpoint the capabilities response named. Nothing else is contacted. */
  endpoint: string;
  languages: readonly string[];
  mint: ReadbackMint;
  /** Absent means the browser's own fetch; null means there is none. */
  fetch?: typeof fetch | null;
}

/**
 * The browser's own fetch, or null where it is missing - a server render.
 */
function browserFetch(scope: Partial<typeof globalThis> = globalThis): typeof fetch | null {
  const doFetch = scope.fetch;
  if (typeof doFetch !== 'function') return null;
  return (input, init) => doFetch(input, init);
}

function isHttps(endpoint: string): boolean {
  try {
    return new URL(endpoint).protocol === 'https:';
  } catch {
    return false;
  }
}

export function createBrowserHostedSynthesiser(
  options: BrowserReadbackOptions
): HostedSynthesiser | null {
  const doFetch = options.fetch === undefined ? browserFetch() : options.fetch;
  if (doFetch === null || !isHttps(options.endpoint)) return null;

  let currentCredential: ReadbackCredential | null = null;
  let credentialExpiry: number = 0;
  const controller = new AbortController();

  /** Ensures we have a valid credential for the given language. */
  const ensureCredential = async (language: string): Promise<ReadbackCredential | null> => {
    const now = Date.now();
    if (
      currentCredential !== null &&
      now < credentialExpiry &&
      currentCredential.language === language
    ) {
      return currentCredential;
    }

    try {
      const minted = await options.mint(language, controller.signal);
      if (minted.endpoint !== options.endpoint) return null;
      currentCredential = minted;
      credentialExpiry = new Date(minted.expiresAt).getTime();
      return minted;
    } catch {
      return null;
    }
  };

  const play = (
    speech: { text: string; language: string },
    handlers: PlaybackHandlers
  ): Playback => {
    let audio: HTMLAudioElement | null = null;
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (audio !== null) {
        audio.pause();
        audio.src = '';
        audio = null;
      }
    };

    const run = async () => {
      const credential = await ensureCredential(speech.language);
      if (credential === null) {
        if (!stopped) handlers.failed();
        return;
      }

      try {
        const response = await doFetch(credential.endpoint, {
          method: 'POST',
          body: JSON.stringify({ text: speech.text, language: speech.language }),
          headers: {
            authorization: `Bearer ${credential.credential}`,
            'content-type': 'application/json',
            accept: 'audio/mpeg, audio/ogg, audio/wav, audio/*',
          },
          signal: controller.signal,
          redirect: 'error',
        });

        if (stopped) return;

        if (!response.ok) {
          if (!stopped) handlers.failed();
          return;
        }

        const blob = await response.blob();
        if (stopped) return;

        const url = URL.createObjectURL(blob);
        audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (!stopped) handlers.finished();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (!stopped) handlers.failed();
        };

        if (!stopped) handlers.started();
        await audio.play();
      } catch {
        if (!stopped) handlers.failed();
      }
    };

    void run();

    return { stop };
  };

  return {
    languages: options.languages,
    play,
  };
}
