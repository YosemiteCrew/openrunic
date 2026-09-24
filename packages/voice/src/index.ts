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

export { SILENT, endingFor, readbackReducer, speakableTurns } from './readback.js';
export type { ReadbackAction, ReadbackEnding, ReadbackState, Speaking } from './readback.js';

export { captureAvailability } from './capture.js';
export type {
  CaptureAvailability,
  CaptureEvent,
  CaptureFailure,
  CapturePort,
  CaptureSession,
  CaptureUnavailable,
} from './capture.js';

export { createPlatformCapture, platformRecognition } from './platform-capture.js';
export type { OnDeviceQuery, PlatformRecognition, Recognition } from './platform-capture.js';

export { createRealtimeCapture } from './realtime-capture.js';
export type {
  RealtimeConnection,
  RealtimeEgress,
  RealtimeHandlers,
  RealtimeTransport,
} from './realtime-capture.js';

export { IDLE, appendDictation, dictationReducer } from './dictation.js';
export type {
  DictationAction,
  DictationEnding,
  DictationPhase,
  DictationSession,
  DictationState,
} from './dictation.js';

export { useDictation } from './useDictation.js';
export type { Dictation } from './useDictation.js';

export { usePageHidden } from './usePageHidden.js';

export { useReadback } from './useReadback.js';
export type { Readback } from './useReadback.js';
