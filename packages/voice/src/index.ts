/**
 * `@openrunic/voice` - the speech seam.
 *
 * A surface imports from here and from nowhere lower. An adapter implements
 * {@link ReadbackPort}; the surface hands it a string that is already on the
 * screen, and neither one learns anything about the other.
 */

export { createPlatformReadback, platformSpeech } from './platform.js';
export type { PlatformSpeech } from './platform.js';

export { readbackAvailability } from './ports.js';
export type {
  ReadbackAvailability,
  ReadbackCapabilities,
  ReadbackEvent,
  ReadbackPort,
  ReadbackUnavailable,
  Utterance,
} from './ports.js';

export { SILENT, readbackReducer } from './readback.js';
export type { ReadbackAction, ReadbackEnding, ReadbackState, Speaking } from './readback.js';

export { usePageHidden } from './usePageHidden.js';

export { useReadback } from './useReadback.js';
export type { Readback } from './useReadback.js';
