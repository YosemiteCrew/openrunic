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
 * drift. The microphone stays here, because it is still one app's decision -
 * see `capture.ts` for why it could ship at all.
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

export { createHostedReadback } from '@openrunic/voice';
export type {
  HostedReadbackEgress,
  HostedSynthesiser,
  Playback,
  PlaybackHandlers,
} from '@openrunic/voice';

export { createPortalHostedSynthesiser, createPortalHostedReadbackEgress } from './hosted-readback';

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
