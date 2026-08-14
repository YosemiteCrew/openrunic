/**
 * Reading a server-sent-event stream that arrived over `fetch`.
 *
 * `EventSource` is the usual way to read one and it cannot be used here: it
 * only issues GET, and a turn carries a body. Reading the response stream
 * directly also means the request can be abandoned mid-answer, which is what
 * the stop control does.
 *
 * Only `data:` is read. The payload already carries its own `type`, so reading
 * the event name as well would create two sources of truth that can disagree.
 */

/** Frames are separated by a blank line, whatever the line ending. */
const FRAME_SEPARATOR = '\n\n';

const DATA_PREFIX = 'data:';

export interface DecodedFrames {
  /** The `data` payload of every frame that completed in this buffer. */
  payloads: string[];
  /** What is left over: a partial frame, carried into the next chunk. */
  rest: string;
}

/**
 * Splits whatever has arrived so far into complete frames plus a remainder.
 *
 * Pure, because the interesting cases are all about chunk boundaries: a frame
 * split across two network reads, a comment-only keep-alive, a trailing
 * fragment at the end of the stream.
 */
export function decodeFrames(buffer: string): DecodedFrames {
  const normalised = buffer.replaceAll('\r\n', '\n');
  const lastBreak = normalised.lastIndexOf(FRAME_SEPARATOR);
  if (lastBreak === -1) return { payloads: [], rest: normalised };

  const rest = normalised.slice(lastBreak + FRAME_SEPARATOR.length);
  const payloads: string[] = [];

  for (const frame of normalised.slice(0, lastBreak).split(FRAME_SEPARATOR)) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith(DATA_PREFIX))
      .map((line) => line.slice(DATA_PREFIX.length).trimStart())
      .join('\n');
    if (data !== '') payloads.push(data);
  }

  return { payloads, rest };
}

/**
 * Yields each frame's payload as it arrives.
 *
 * The reader is released in `finally`, so breaking out of the loop - which is
 * what stopping an answer does - closes the socket rather than leaving a
 * response draining in the background of somebody's phone.
 */
export async function* readStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const decoded = decodeFrames(buffer);
      buffer = decoded.rest;
      yield* decoded.payloads;
    }

    /* A stream that ends without its final blank line still carries a frame.
       Dropping it would lose the one event a reader is guaranteed, which is
       also the one the surface uses to settle the turn. */
    yield* decodeFrames(`${buffer}${FRAME_SEPARATOR}`).payloads;
  } finally {
    await reader.cancel().catch(() => {
      /* Cancelling an already-errored stream rejects. There is nothing left to
         do about it and the caller is unwinding anyway, so it is swallowed here
         rather than replacing whatever ended the loop. */
    });
  }
}
