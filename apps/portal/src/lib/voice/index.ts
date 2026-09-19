/**
 * Speech, as something the portal talks to rather than something it is.
 *
 * Nothing in here decides what a patient may hear. That lives beside the
 * transcript, with every other rule about what a patient may be shown, because
 * the two questions have one answer: the words read aloud are the words on the
 * screen.
 */

export { createPlatformReadback, platformSpeech } from './platform';
export type { PlatformSpeech } from './platform';

export { createPlatformCapture, platformRecognition } from './platform-capture';
export type { OnDeviceQuery, PlatformRecognition, Recognition } from './platform-capture';

export { captureAvailability } from './capture';
export type {
  CaptureAvailability,
  CaptureEvent,
  CaptureFailure,
  CapturePort,
  CaptureSession,
  CaptureUnavailable,
} from './capture';

export { readbackAvailability } from './ports';
export type {
  ReadbackAvailability,
  ReadbackCapabilities,
  ReadbackEvent,
  ReadbackPort,
  ReadbackUnavailable,
  Utterance,
} from './ports';
