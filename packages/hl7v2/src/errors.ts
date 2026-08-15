/**
 * One error type for the codec, carrying where it went wrong.
 *
 * An HL7 v2 message arrives over a socket from a laboratory analyser, a
 * registration system, or an immunisation registry, and it arrives wrong sooner
 * or later. When it does, somebody is looking at a wall of pipe characters
 * trying to find the fault, and `segment 7 (OBX), field 5` is the difference
 * between a five-minute fix and an afternoon.
 */
export class Hl7Error extends Error {
  /** 1-based segment index, when the fault is inside a segment. */
  readonly segment?: number;
  /** The three-letter segment identifier, when it is known. */
  readonly segmentId?: string;

  constructor(message: string, location?: { segment?: number; segmentId?: string }) {
    const where =
      location?.segmentId === undefined
        ? ''
        : ` (segment ${String(location.segment ?? '?')}, ${location.segmentId})`;
    super(`${message}${where}`);
    this.name = 'Hl7Error';
    if (location?.segment !== undefined) this.segment = location.segment;
    if (location?.segmentId !== undefined) this.segmentId = location.segmentId;
  }
}
