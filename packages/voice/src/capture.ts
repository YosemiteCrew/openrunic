/**
 * The microphone boundary, stated as a port rather than as a browser API.
 *
 * It is the mirror of {@link ./ports.ts}, and it is a separate decision from it
 * for the reason #512 gave when it shipped readback without capture: reading an
 * answer out sends nothing anywhere, and turning speech into words is only that
 * harmless while it happens on the device. Every hosted recogniser - including
 * the one a browser exposes by default - is health data leaving the deployment,
 * and ADR-0005 rule 6 wants an endpoint, a credential and a separate
 * acknowledgement naming the executed agreement before that may ship. An
 * on-device recogniser has none of those to name, which is what lets this
 * arrive with no configuration surface at all.
 *
 * That argument only holds while the audio really does stay on the device, so
 * it is not left to the adapter's good intentions. {@link CapturePort.available}
 * is asked before anything is captured and answers on-device support
 * specifically; a browser that cannot answer that question is refused rather
 * than tried, because the failure mode of trying is that somebody's voice is
 * transcribed by a third party and nothing on the screen says so.
 *
 * **Nothing here takes a record, an identifier or a question.** A session is a
 * language and an id the caller made up. An adapter is never told whose surface
 * it is listening in, what is on the screen, or what was asked before, so a
 * swapped-in adapter cannot widen what it hears any more than a swapped-in voice
 * could widen what it says.
 *
 * **What comes back is text for the person, not for the product.** The words go
 * into the box the reader types in, and pressing Ask stays a press. Nothing in
 * this file can reach the assistant, so no arrangement of speech can start a
 * turn, a booking or a payment: the surface that can do those things is given a
 * string and a human hand.
 */

/** Why nothing can be dictated. Each one reads differently to the person. */
export type CaptureUnavailable =
  /** This build or this browser has no on-device recogniser at all. */
  | 'no-adapter'
  /** There is one, and it does not do the language of this page on the device. */
  | 'language'
  /** It would do this language on the device once its language pack is installed. */
  | 'not-installed';

export type CaptureAvailability =
  { status: 'unavailable'; reason: CaptureUnavailable } | { status: 'available' };

/** Why capture stopped without words. Each one is said out loud to the reader. */
export type CaptureFailure =
  /** The browser or the person refused the microphone. */
  | 'denied'
  /** The microphone worked and nobody said anything. */
  | 'no-speech'
  /** There was no usable microphone to open. */
  | 'no-audio'
  /**
   * The recogniser would only have done this by sending the audio away.
   *
   * The distinction the reader is owed: nothing was heard *because* nothing was
   * allowed to leave, rather than because their device is broken.
   */
  | 'off-device'
  /** Something else went wrong, and there is nothing useful to say about it. */
  | 'failed';

/** One stretch of listening. The id is the caller's, and comes back on every event. */
export interface CaptureSession {
  id: string;
  /** BCP-47. The adapter has already said it can do this one on the device. */
  language: string;
}

/**
 * What an adapter reports.
 *
 * `listening` is not merely informational: it is the difference between asking
 * for the microphone and the microphone being open, and the surface says
 * "listening" on the second of those. A label drawn from the button press would
 * claim an open microphone during the permission prompt, which is the one moment
 * the claim is most likely to be wrong and most alarming to be wrong about.
 *
 * `heard` carries text and nothing else - no confidence, no alternatives, no
 * timing. An interim result is the reader's own words on their own screen; a
 * final one is what goes in the box.
 */
export type CaptureEvent =
  | { type: 'listening'; id: string }
  | { type: 'heard'; id: string; text: string; final: boolean }
  | { type: 'ended'; id: string }
  | { type: 'failed'; id: string; reason: CaptureFailure };

export interface CapturePort {
  /**
   * Whether this page's language can be recognised **on the device**, answered
   * before the microphone is touched.
   *
   * Asynchronous because the honest answer is: the browser has to look, and on
   * some devices it has to look at what is installed rather than at a list it
   * ships with.
   */
  available: (language: string) => Promise<CaptureAvailability>;
  /** Called for each {@link CaptureEvent}. Returns an unsubscribe. */
  onEvent: (listener: (event: CaptureEvent) => void) => () => void;
  /** Opens the microphone for one question. Never called without an explicit press. */
  start: (session: CaptureSession) => void;
  /** Stops listening and keeps what was said. */
  stop: () => void;
  /** Stops listening and drops what was said. Safe to call when nothing is open. */
  abort: () => void;
}

/**
 * The three answers the browser's on-device check gives, as the three things
 * the reader needs to be told.
 *
 * `downloadable` and `downloading` are one answer here on purpose. Both mean the
 * device could do this and cannot do it yet, and neither is something this
 * surface acts on: fetching a language pack is a download somebody did not ask
 * for, on a connection this product knows nothing about, for a feature they have
 * not turned on. So it says what is true and stops.
 */
export function captureAvailability(onDevice: string): CaptureAvailability {
  switch (onDevice) {
    case 'available':
      return { status: 'available' };
    case 'downloadable':
    case 'downloading':
      return { status: 'unavailable', reason: 'not-installed' };
    default:
      return { status: 'unavailable', reason: 'language' };
  }
}
