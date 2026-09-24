/**
 * Speech, as something the portal talks to rather than something it is.
 *
 * Nothing in here decides what a patient may hear. That lives beside the
 * transcript, with every other rule about what a patient may be shown, because
 * the two questions have one answer: the words read aloud are the words on the
 * screen.
 *
 * The readback half is `@openrunic/voice` and is re-exported rather than
 * re-stated: the staff surface reads answers aloud under the same port and the
 * same reducer, and a second copy of either is the thing that would let the two
 * drift. The microphone followed it once the staff surface needed to ask by
 * voice too, for the same reason.
 */

export { createPlatformReadback, platformSpeech, readbackAvailability } from '@openrunic/voice';
export type {
  PlatformSpeech,
  ReadbackAvailability,
  ReadbackCapabilities,
  ReadbackEvent,
  ReadbackPort,
  ReadbackUnavailable,
  Utterance,
} from '@openrunic/voice';

export { captureAvailability, createPlatformCapture, platformRecognition } from '@openrunic/voice';
export { chooseCapture } from '@openrunic/voice';
export type {
  OnDeviceQuery,
  PlatformRecognition,
  Recognition,
  CaptureAvailability,
  CaptureEvent,
  CaptureFailure,
  CapturePort,
  CaptureSession,
  CaptureUnavailable,
  BrowserMedia,
  DictationEgress,
  RealtimeMint,
} from '@openrunic/voice';
