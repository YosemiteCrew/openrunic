/**
 * The speech boundary, stated as a port rather than as a browser API.
 *
 * Everything vendor-shaped lives behind this interface: the voice list, the
 * codec, the event names, the SDK if a deployer ever configures one. Nothing on
 * the other side of it knows what is speaking. That is the property ADR-0005
 * asks for at the model boundary, applied to the second boundary this surface
 * grew, and it is why replacing the voice is an adapter change and not a change
 * to any rule about what may be said aloud.
 *
 * **Nothing here takes a record, an identifier or a question.** A port is handed
 * a string that is already on the screen, and it has no way to ask for another
 * one. An adapter therefore cannot widen what the reader hears, whatever it is
 * wired to, because it is never told that there is more.
 *
 * The shapes below are the whole contract. `capabilities` is asked before
 * anything is spoken, so an adapter that cannot speak the language of the page
 * says so instead of mispronouncing somebody's appointment at them.
 * `onCapabilities` exists because the browser's own voice list arrives late and
 * an adapter that answered "no voices" once must be able to correct itself.
 *
 * Events arrive on one subscription rather than on a callback handed to each
 * `speak`. An adapter that speaks is a thing that reports, continuously, and a
 * callback per utterance would make every caller decide what to do with an
 * event that arrives after the utterance it belonged to - which is a decision
 * with one right answer, taken once, by the surface.
 */

/** What an adapter can do, asked before it is asked to do anything. */
export interface ReadbackCapabilities {
  /**
   * BCP-47 tags this adapter can speak. Empty is a legitimate answer and means
   * it can speak nothing at all, which is not the same as being absent.
   */
  languages: readonly string[];
  /** Whether an utterance already in progress can be stopped. */
  interruption: boolean;
}

/** One thing to say. The text is a copy of what is on the screen. */
export interface Utterance {
  /** The turn this came from, echoed back on every event about it. */
  id: string;
  text: string;
  /** BCP-47. The adapter has already said it can speak this one. */
  language: string;
}

/**
 * What an adapter reports.
 *
 * `started` is not merely informational: it is the difference between a request
 * to speak and speech, and the surface says "reading" on the second of those.
 * There is no progress event and no partial transcript, because neither would
 * be used and both would be a second copy of a record's words in flight.
 */
export type ReadbackEvent =
  | { type: 'started'; id: string }
  | { type: 'finished'; id: string }
  | { type: 'failed'; id: string };

export interface ReadbackPort {
  capabilities: () => ReadbackCapabilities;
  /** Called when the answer to `capabilities` may have changed. Returns an unsubscribe. */
  onCapabilities: (listener: () => void) => () => void;
  /** Called for each {@link ReadbackEvent} the voice produces. Returns an unsubscribe. */
  onEvent: (listener: (event: ReadbackEvent) => void) => () => void;
  /**
   * Says one utterance.
   *
   * Contractually replaces anything already speaking, so a caller never has to
   * cancel first and no two answers can overlap.
   */
  speak: (utterance: Utterance) => void;
  /** Stops immediately and drops anything queued. Safe to call when silent. */
  cancel: () => void;
}

/** Why nothing will be read aloud. Each one reads differently to the person. */
export type ReadbackUnavailable =
  /** This build or this browser has no speech at all. */
  | 'no-adapter'
  /** There is speech, and no voices installed to do it with. */
  | 'no-voice'
  /** There are voices, and none of them speaks the language of this page. */
  | 'language';

export type ReadbackAvailability =
  { status: 'unavailable'; reason: ReadbackUnavailable } | { status: 'available' };

/**
 * Whether this page can be read aloud, answered before anything is said.
 *
 * Matching is by primary subtag, so a page in `es` is read by an `es-MX` voice.
 * Refusing that would leave most of the world silent over a region code, and an
 * accent a reader did not choose is a smaller harm than no answer: the words
 * are the record's, and they are on the screen beside the sound.
 */
export function readbackAvailability(
  port: ReadbackPort | null,
  language: string
): ReadbackAvailability {
  if (port === null) return { status: 'unavailable', reason: 'no-adapter' };

  const { languages } = port.capabilities();
  if (languages.length === 0) return { status: 'unavailable', reason: 'no-voice' };

  const wanted = primarySubtag(language);
  const speaks = languages.some((tag) => primarySubtag(tag) === wanted);
  return speaks ? { status: 'available' } : { status: 'unavailable', reason: 'language' };
}

function primarySubtag(tag: string): string {
  return (tag.split('-')[0] ?? '').toLowerCase();
}
