/**
 * Reading a server-sent-event stream that arrived over `fetch`.
 *
 * `EventSource` is the usual way to read SSE and it cannot be used here: it
 * only issues GET, and a turn carries a body. So the stream is read off the
 * response directly, which also means the request can be aborted mid-answer -
 * the whole point of the stop control.
 *
 * Only `data:` is read. `apps/api` writes the event name and the payload, and
 * the payload already carries its own `type`, so reading both would create two
 * sources of truth that could disagree.
 */

/** SSE frames are separated by a blank line, whatever the line ending. */
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
 * fragment at end of stream.
 */
export function decodeSseFrames(buffer: string): DecodedFrames {
  const normalised = buffer.replace(/\r\n/g, '\n');
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
 * The reader is cancelled in `finally`, so breaking out of the loop - which is
 * what stopping an answer does - releases the socket rather than leaving a
 * response draining in the background.
 */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const decoded = decodeSseFrames(buffer);
      buffer = decoded.rest;
      yield* decoded.payloads;
    }

    // A stream that ends without its final blank line still carries a frame.
    // Dropping it would lose `turn-finished`, which is the one event a reader
    // is guaranteed and the one the surface uses to settle.
    const tail = decodeSseFrames(`${buffer}${FRAME_SEPARATOR}`);
    yield* tail.payloads;
  } finally {
    await reader.cancel().catch(() => {
      // Cancelling an already-errored stream rejects. There is nothing left to
      // do about it and the caller is already unwinding, so it is swallowed
      // here rather than replacing whatever ended the loop.
    });
  }
}
