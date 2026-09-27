/**
 * Speech, as something the web app talks to rather than something it is.
 *
 * Re-exports the voice primitives from `@openrunic/voice` and provides
 * hosted voice factory functions for the staff surface.
 */

export { createHostedReadback } from '@openrunic/voice';
export type {
  HostedReadbackEgress,
  HostedSynthesiser,
  Playback,
  PlaybackHandlers,
} from '@openrunic/voice';

export { createPlatformReadback } from '@openrunic/voice';

export { createWebHostedSynthesiser, createWebHostedReadbackEgress } from './hosted-readback';
