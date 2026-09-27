'use client';

/**
 * A hosted text-to-speech synthesiser for the portal.
 *
 * Reads the deployment's hosted voice configuration from environment variables
 * and builds a {@link HostedSynthesiser} that calls the configured endpoint.
 * Returns null when the deployment has not configured a hosted voice.
 *
 * The synthesiser is deliberately minimal: it posts the text and language to the
 * endpoint, receives an audio response, and plays it through an Audio element.
 * A deployment that needs a different codec, authentication or streaming
 * behaviour should supply its own {@link HostedSynthesiser} rather than editing
 * this file.
 */

import type { HostedSynthesiser, Playback } from '@openrunic/voice';

interface HostedVoiceConfig {
  endpoint: string;
  agreement: string;
  languages: readonly string[];
}

/** Reads the hosted voice configuration from the environment. */
function readHostedVoiceConfig(): HostedVoiceConfig | null {
  /* NEXT_PUBLIC_ variables are exposed to the client by Next.js. The unprefixed
     OPENRUNIC_ variables are set in docker-compose and available at build time
     when the image is built with them. We check both for flexibility. */
  const endpoint =
    process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT?.trim() ??
    process.env.OPENRUNIC_HOSTED_VOICE_ENDPOINT?.trim();
  const agreement =
    process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT?.trim() ??
    process.env.OPENRUNIC_HOSTED_VOICE_AGREEMENT?.trim();
  const languages =
    process.env.NEXT_PUBLIC_HOSTED_VOICE_LANGUAGES?.trim() ??
    process.env.OPENRUNIC_HOSTED_VOICE_LANGUAGES?.trim();

  if (!endpoint || !agreement) return null;

  const langs = languages
    ? languages
        .split(',')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    : ['en-GB'];

  return { endpoint, agreement, languages: langs };
}

/**
 * Creates a hosted synthesiser that calls a TTS HTTP endpoint.
 *
 * The endpoint is expected to accept POST requests with a JSON body:
 *   { text: string; language: string }
 *
 * And return an audio response (e.g. audio/mpeg, audio/wav, audio/ogg).
 * The synthesiser plays the audio through an HTMLAudioElement.
 */
export function createPortalHostedSynthesiser(): HostedSynthesiser | null {
  const config = readHostedVoiceConfig();
  if (!config) return null;

  return {
    languages: config.languages,
    play: ({ text, language }, handlers) => {
      const controller = new AbortController();
      let audio: HTMLAudioElement | null = null;

      const cleanup = () => {
        if (audio) {
          audio.pause();
          audio.src = '';
          audio = null;
        }
      };

      const playback: Playback = {
        stop: () => {
          controller.abort();
          cleanup();
        },
      };

      /* Fetch the audio from the hosted TTS service. */
      fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/*, */*',
        },
        body: JSON.stringify({ text, language }),
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`TTS request failed: ${response.status}`);
          }
          return response.blob();
        })
        .then((blob) => {
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          audio = new Audio(url);
          audio.onended = () => {
            URL.revokeObjectURL(url);
            cleanup();
            handlers.finished();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            cleanup();
            handlers.failed();
          };
          audio
            .play()
            .then(() => handlers.started())
            .catch(() => handlers.failed());
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          cleanup();
          handlers.failed();
        });

      return playback;
    },
  };
}

/** The egress configuration for the hosted readback port. */
export function createPortalHostedReadbackEgress(): { endpoint: string; agreement: string } | null {
  const config = readHostedVoiceConfig();
  if (!config) return null;
  return { endpoint: config.endpoint, agreement: config.agreement };
}
