import { describe, expect, it, vi } from 'vitest';

import { decodeSseFrames, readSseStream } from '@/lib/agent';

/** A stream that hands out exactly the chunks given, in order, then closes. */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const payloads: string[] = [];
  for await (const payload of readSseStream(stream)) payloads.push(payload);
  return payloads;
}

describe('decodeSseFrames', () => {
  it('reads the data line and drops the event name beside it', () => {
    const decoded = decodeSseFrames('event: step\ndata: {"a":1}\n\n');
    expect(decoded.payloads).toEqual(['{"a":1}']);
    expect(decoded.rest).toBe('');
  });

  it('carries a half-arrived frame into the next chunk', () => {
    const first = decodeSseFrames('data: {"a":1}\n\ndata: {"b"');
    expect(first.payloads).toEqual(['{"a":1}']);
    expect(first.rest).toBe('data: {"b"');

    const second = decodeSseFrames(`${first.rest}:2}\n\n`);
    expect(second.payloads).toEqual(['{"b":2}']);
  });

  it('joins a payload that was split across data lines', () => {
    expect(decodeSseFrames('data: one\ndata: two\n\n').payloads).toEqual(['one\ntwo']);
  });

  it('ignores a keep-alive comment, which carries no data line', () => {
    expect(decodeSseFrames(': keep-alive\n\ndata: real\n\n').payloads).toEqual(['real']);
  });

  it('reads frames a proxy rewrote with carriage returns', () => {
    expect(decodeSseFrames('data: {"a":1}\r\n\r\n').payloads).toEqual(['{"a":1}']);
  });
});

describe('readSseStream', () => {
  it('yields each frame as it arrives, across chunk boundaries', async () => {
    expect(await collect(streamOf(['data: one\n\ndat', 'a: two\n\n']))).toEqual(['one', 'two']);
  });

  it('does not drop a final frame that arrived without its blank line', async () => {
    // The last event of a turn is always `turn-finished`, and it is the event
    // the surface settles on. Losing it to a missing terminator would leave the
    // panel claiming to be answering forever.
    expect(await collect(streamOf(['data: last']))).toEqual(['last']);
  });

  it('cancels the source when the caller stops early', async () => {
    // Stopping an answer breaks out of this loop. If the reader were not
    // released the response would keep draining in the background, which is
    // the socket a stopped turn is supposed to give back.
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: one\n\ndata: two\n\n'));
      },
      cancel,
    });

    for await (const payload of readSseStream(stream)) {
      expect(payload).toBe('one');
      break;
    }

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('lets the error that ended the stream stand, not the cancel that follows it', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('socket died'));
      },
    });

    await expect(collect(stream)).rejects.toThrow('socket died');
  });
});
