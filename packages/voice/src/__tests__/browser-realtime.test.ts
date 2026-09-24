import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserMedia, createBrowserRealtimeTransport, createRealtimeCapture } from '../index.js';
import type {
  BrowserMedia,
  CaptureEvent,
  RealtimeCredential,
  RealtimeHandlers,
  RealtimeTransport,
} from '../index.js';

/**
 * The browser transport, over doubles of the microphone, the peer connection
 * and fetch. Nothing here opens a microphone or contacts a service; what is
 * pinned is what the transport asks each of them for, and that every way out
 * turns the microphone off.
 */

const ENDPOINT = 'https://speech.example.test/v1/realtime';

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

function stream(tracks = [new FakeTrack()]) {
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  };
}

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  sent: string[] = [];
  closed = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly label: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed += 1;
  }
  opens() {
    this.readyState = 'open';
    this.onopen?.();
  }
}

class FakePeer {
  transceivers: { track: unknown; init: unknown }[] = [];
  channels: FakeChannel[] = [];
  offered: unknown = null;
  answered: unknown = null;
  closed = 0;
  connectionState: RTCPeerConnectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  addTransceiver(track: unknown, init: unknown) {
    this.transceivers.push({ track, init });
  }
  createDataChannel(label: string) {
    const channel = new FakeChannel(label);
    this.channels.push(channel);
    return channel;
  }
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'synthetic-offer' });
  }
  setLocalDescription(description: unknown) {
    this.offered = description;
    return Promise.resolve();
  }
  setRemoteDescription(description: unknown) {
    this.answered = description;
    return Promise.resolve();
  }
  close() {
    this.closed += 1;
  }
  becomes(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Rig {
  media: BrowserMedia;
  peers: FakePeer[];
  microphones: number;
  requests: { url: string; init: RequestInit | undefined }[];
}

function rig(
  options: {
    microphone?: () => Promise<unknown>;
    answer?: () => Promise<Response>;
  } = {}
): Rig {
  const state: Rig = {
    peers: [],
    microphones: 0,
    requests: [],
    media: {
      microphone: () => {
        state.microphones += 1;
        return (options.microphone ?? (() => Promise.resolve(stream())))() as Promise<MediaStream>;
      },
      peer: () => {
        const peer = new FakePeer();
        state.peers.push(peer);
        return peer as unknown as RTCPeerConnection;
      },
      fetch: (input, init) => {
        state.requests.push({ url: String(input as string), init });
        return (options.answer ?? (() => Promise.resolve(new Response('synthetic-answer'))))();
      },
    },
  };
  return state;
}

function recorder() {
  const calls: string[] = [];
  const messages: unknown[] = [];
  const handlers: RealtimeHandlers = {
    listening: () => calls.push('listening'),
    message: (message) => {
      calls.push('message');
      messages.push(message);
    },
    closed: () => calls.push('closed'),
    failed: (reason) => calls.push(`failed:${reason}`),
  };
  return { calls, messages, handlers };
}

function transport(
  media: BrowserMedia,
  mint: (language: string, signal: AbortSignal) => Promise<RealtimeCredential> = () =>
    Promise.resolve({ endpoint: ENDPOINT, credential: 'synthetic-short-lived-value' }),
  extra: { channel?: string; settleMs?: number } = {}
): RealtimeTransport {
  const built = createBrowserRealtimeTransport({
    endpoint: ENDPOINT,
    languages: ['en-US'],
    turnDetection: 'server',
    mint,
    media,
    ...extra,
  });
  if (built === null) throw new Error('expected a transport');
  return built;
}

describe('whether there is a transport at all', () => {
  it('is none without the browser capabilities', () => {
    expect(
      createBrowserRealtimeTransport({
        endpoint: ENDPOINT,
        languages: ['en'],
        turnDetection: 'server',
        mint: () => Promise.reject(new Error('unused')),
        media: null,
      })
    ).toBeNull();
  });

  it.each(['wss://speech.example.test/v1/realtime', 'not a url', 'http://speech.example.test'])(
    'is none for an endpoint it cannot post an offer to: %s',
    (endpoint) => {
      expect(
        createBrowserRealtimeTransport({
          endpoint,
          languages: ['en'],
          turnDetection: 'server',
          mint: () => Promise.reject(new Error('unused')),
          media: rig().media,
        })
      ).toBeNull();
    }
  );

  it('carries the languages and turn detection it was configured with', () => {
    const built = createBrowserRealtimeTransport({
      endpoint: ENDPOINT,
      languages: ['es', 'en-GB'],
      turnDetection: 'manual',
      mint: () => Promise.reject(new Error('unused')),
      media: rig().media,
    });
    expect(built).toMatchObject({ languages: ['es', 'en-GB'], turnDetection: 'manual' });
  });

  it('uses the browser capabilities when none are injected, and has none here', () => {
    // jsdom has neither a microphone nor a peer connection.
    expect(
      createBrowserRealtimeTransport({
        endpoint: ENDPOINT,
        languages: ['en'],
        turnDetection: 'server',
        mint: () => Promise.reject(new Error('unused')),
      })
    ).toBeNull();
  });
});

describe('browserMedia', () => {
  const Peer = class {
    made = true;
  };
  const getUserMedia = (constraints: unknown) => Promise.resolve(constraints);
  const doFetch = (input: unknown) => Promise.resolve(input);

  it('is null when any of the three is missing', () => {
    expect(browserMedia({} as never)).toBeNull();
    expect(
      browserMedia({
        navigator: { mediaDevices: {} },
        RTCPeerConnection: Peer,
        fetch: doFetch,
      } as never)
    ).toBeNull();
    expect(
      browserMedia({ navigator: { mediaDevices: { getUserMedia } }, fetch: doFetch } as never)
    ).toBeNull();
    expect(
      browserMedia({
        navigator: { mediaDevices: { getUserMedia } },
        RTCPeerConnection: Peer,
      } as never)
    ).toBeNull();
  });

  it('asks for audio only, and calls through to the browser', async () => {
    const media = browserMedia({
      navigator: { mediaDevices: { getUserMedia } },
      RTCPeerConnection: Peer,
      fetch: doFetch,
    } as never);
    expect(media).not.toBeNull();
    expect(await media?.microphone()).toEqual({ audio: true });
    expect(media?.peer()).toBeInstanceOf(Peer);
    expect(await media?.fetch('https://example.test/offer')).toBe('https://example.test/offer');
  });
});

describe('opening a session', () => {
  it('mints, opens the microphone send-only, and posts the offer to the named endpoint', async () => {
    const media = rig();
    const asked: string[] = [];
    const { calls, handlers } = recorder();
    transport(media.media, (language, signal) => {
      asked.push(language);
      expect(signal.aborted).toBe(false);
      return Promise.resolve({ endpoint: ENDPOINT, credential: 'synthetic-short-lived-value' });
    }).open({ language: 'en-US' }, handlers);
    await tick();

    expect(asked).toEqual(['en-US']);
    const [peer] = media.peers;
    expect(peer?.transceivers).toEqual([
      { track: expect.any(FakeTrack), init: { direction: 'sendonly' } },
    ]);
    expect(peer?.channels.map((channel) => channel.label)).toEqual(['events']);
    expect(peer?.offered).toEqual({ type: 'offer', sdp: 'synthetic-offer' });
    expect(media.requests).toHaveLength(1);
    expect(media.requests[0]?.url).toBe(ENDPOINT);
    expect(media.requests[0]?.init).toMatchObject({
      method: 'POST',
      body: 'synthetic-offer',
      headers: {
        authorization: 'Bearer synthetic-short-lived-value',
        'content-type': 'application/sdp',
      },
      redirect: 'error',
    });
    expect(peer?.answered).toEqual({ type: 'answer', sdp: 'synthetic-answer' });
    // Nothing is reported until the channel is really open.
    expect(calls).toEqual([]);
  });

  it('says listening when the channel opens, not before', async () => {
    const media = rig();
    const { calls, handlers } = recorder();
    transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    media.peers[0]?.channels[0]?.opens();
    expect(calls).toEqual(['listening']);
  });

  it('uses the configured channel label', async () => {
    const media = rig();
    transport(media.media, undefined, { channel: 'service-events' }).open(
      { language: 'en' },
      recorder().handlers
    );
    await tick();
    expect(media.peers[0]?.channels[0]?.label).toBe('service-events');
  });

  it('posts an empty body for an offer with no description', async () => {
    const media = rig();
    const original = media.media.peer;
    media.media.peer = () => {
      const peer = original();
      (peer as unknown as FakePeer).createOffer = () => Promise.resolve({ type: 'offer' } as never);
      return peer;
    };
    transport(media.media).open({ language: 'en' }, recorder().handlers);
    await tick();
    expect(media.requests[0]?.init?.body).toBe('');
  });
});

describe('what arrives on the channel', () => {
  async function opened() {
    const media = rig();
    const record = recorder();
    const connection = transport(media.media).open({ language: 'en' }, record.handlers);
    await tick();
    const channel = media.peers[0]?.channels[0];
    if (channel === undefined) throw new Error('expected a channel');
    channel.opens();
    return { media, record, channel, connection };
  }

  it('passes each message on parsed', async () => {
    const { record, channel } = await opened();
    channel.onmessage?.({ data: '{"type":"a.vendor.event","item_id":"x"}' });
    expect(record.messages).toEqual([{ type: 'a.vendor.event', item_id: 'x' }]);
  });

  it('passes on something unreadable as nothing, for the adapter to drop', async () => {
    const { record, channel } = await opened();
    channel.onmessage?.({ data: 'not json' });
    channel.onmessage?.({ data: new ArrayBuffer(4) });
    expect(record.messages).toEqual([null, null]);
  });

  it('sends a client event as JSON', async () => {
    const { channel, connection } = await opened();
    connection.send({ type: 'input_audio_buffer.commit' });
    expect(channel.sent).toEqual(['{"type":"input_audio_buffer.commit"}']);
  });

  it('reports a channel the service closed once, and turns the microphone off', async () => {
    const { media, record, channel, connection } = await opened();
    channel.onclose?.();
    channel.onclose?.();
    connection.close();
    expect(record.calls).toEqual(['listening', 'closed']);
    expect(media.peers[0]?.closed).toBe(1);
  });

  it('reports a failed connection, and ignores the states before it', async () => {
    const { media, record } = await opened();
    media.peers[0]?.becomes('connected');
    media.peers[0]?.becomes('failed');
    media.peers[0]?.becomes('failed');
    expect(record.calls).toEqual(['listening', 'failed:failed']);
  });

  it('hears nothing more once closed', async () => {
    const { record, channel, connection } = await opened();
    connection.close();
    channel.onmessage?.({ data: '{"type":"late"}' });
    channel.onopen?.();
    channel.onclose?.();
    connection.send({ type: 'input_audio_buffer.commit' });
    expect(record.calls).toEqual(['listening']);
    expect(channel.sent).toEqual([]);
  });
});

describe('every way out turns the microphone off', () => {
  it('stop before the channel opened ends the session with nothing to wait for', async () => {
    const media = rig();
    const { calls, handlers } = recorder();
    const connection = transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    connection.send({ type: 'input_audio_buffer.commit' });

    expect(calls).toEqual(['closed']);
    expect(media.peers[0]?.closed).toBe(1);
    expect(media.peers[0]?.channels[0]?.sent).toEqual([]);
  });

  it('a mint that fails asks for no microphone', async () => {
    const media = rig();
    const { calls, handlers } = recorder();
    transport(media.media, () => Promise.reject(new Error('409'))).open(
      { language: 'en' },
      handlers
    );
    await tick();
    expect(calls).toEqual(['failed:failed']);
    expect(media.microphones).toBe(0);
  });

  it('a credential for an endpoint nobody named is refused before the microphone', async () => {
    const media = rig();
    const { calls, handlers } = recorder();
    transport(media.media, () =>
      Promise.resolve({ endpoint: 'https://elsewhere.example.test', credential: 'x' })
    ).open({ language: 'en' }, handlers);
    await tick();
    expect(calls).toEqual(['failed:failed']);
    expect(media.microphones).toBe(0);
    expect(media.requests).toEqual([]);
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-audio'],
    ['NotReadableError', 'no-audio'],
    ['OverconstrainedError', 'no-audio'],
    ['AbortError', 'failed'],
  ])('a microphone refused with %s reads as %s', async (name, reason) => {
    const error = new Error('refused');
    error.name = name;
    const media = rig({ microphone: () => Promise.reject(error) });
    const { calls, handlers } = recorder();
    transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    expect(calls).toEqual([`failed:${reason}`]);
    expect(media.peers).toEqual([]);
  });

  it('a refusal that is not even an error reads as a failure', async () => {
    const media = rig({ microphone: () => Promise.reject(new Error('refused')) });
    const { calls, handlers } = recorder();
    transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    expect(calls).toEqual(['failed:failed']);
  });

  it('a stream with no audio track is no microphone', async () => {
    const media = rig({ microphone: () => Promise.resolve(stream([])) });
    const { calls, handlers } = recorder();
    transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    expect(calls).toEqual(['failed:no-audio']);
    expect(media.peers).toEqual([]);
  });

  it('closing while the credential is on its way cancels it and asks for no microphone', async () => {
    const media = rig();
    const minting = deferred<RealtimeCredential>();
    let signal: AbortSignal | null = null;
    const { calls, handlers } = recorder();
    const connection = transport(media.media, (_language, given) => {
      signal = given;
      return minting.promise;
    }).open({ language: 'en' }, handlers);
    connection.close();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    minting.resolve({ endpoint: ENDPOINT, credential: 'x' });
    await tick();
    expect(calls).toEqual([]);
    expect(media.microphones).toBe(0);
  });

  it('closing during the permission prompt stops the track the grant arrives with', async () => {
    const granting = deferred<unknown>();
    const media = rig({ microphone: () => granting.promise });
    const { calls, handlers } = recorder();
    const connection = transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    connection.close();
    const late = stream();
    granting.resolve(late);
    await tick();
    expect(late.tracks[0]?.stopped).toBe(true);
    expect(media.peers).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('a service that refuses the offer is a failure, and the track stops', async () => {
    const granted = stream();
    const media = rig({
      microphone: () => Promise.resolve(granted),
      answer: () => Promise.resolve(new Response('no', { status: 401 })),
    });
    const { calls, handlers } = recorder();
    transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    expect(calls).toEqual(['failed:failed']);
    expect(granted.tracks[0]?.stopped).toBe(true);
    expect(media.peers[0]?.closed).toBe(1);
    expect(media.peers[0]?.channels[0]?.closed).toBe(1);
  });

  it('a network that drops the offer is a failure', async () => {
    const media = rig({ answer: () => Promise.reject(new TypeError('network')) });
    const { calls, handlers } = recorder();
    transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    expect(calls).toEqual(['failed:failed']);
  });

  it('an answer that arrives after close is not applied', async () => {
    const answering = deferred<Response>();
    const media = rig({ answer: () => answering.promise });
    const { calls, handlers } = recorder();
    const connection = transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    connection.close();
    answering.resolve(new Response('late-answer'));
    await tick();
    expect(media.peers[0]?.answered).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('under the capture adapter', () => {
  it('turns the service transcript into the words the reader said', async () => {
    const media = rig();
    const port = createRealtimeCapture(transport(media.media), {
      endpoint: ENDPOINT,
      agreement: 'a synthetic agreement',
    });
    if (port === null) throw new Error('expected a port');
    const seen: CaptureEvent[] = [];
    port.onEvent((event) => seen.push(event));

    port.start({ id: 's1', language: 'en-US' });
    await tick();
    const channel = media.peers[0]?.channels[0];
    channel?.opens();
    channel?.onmessage?.({
      data: JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'i1',
        transcript: 'is the dose due',
      }),
    });
    channel?.onmessage?.({ data: JSON.stringify({ type: 'response.output_audio.delta' }) });

    expect(seen).toEqual([
      { type: 'listening', id: 's1' },
      { type: 'heard', id: 's1', text: 'is the dose due', final: true },
    ]);
  });
});

describe('stop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function listening(settleMs?: number) {
    const granted = stream();
    const media = rig({ microphone: () => Promise.resolve(granted) });
    const record = recorder();
    const connection = transport(
      media.media,
      undefined,
      settleMs === undefined ? {} : { settleMs }
    ).open({ language: 'en' }, record.handlers);
    await tick();
    const channel = media.peers[0]?.channels[0];
    if (channel === undefined) throw new Error('expected a channel');
    channel.opens();
    return { granted, media, record, connection, channel };
  }

  it('turns the microphone off at once and still hears the words already sent', async () => {
    const { granted, record, connection, channel, media } = await listening();
    connection.mute?.();
    expect(granted.tracks[0]?.stopped).toBe(true);
    expect(media.peers[0]?.closed).toBe(0);

    channel.onmessage?.({ data: '{"type":"late.but.wanted"}' });
    expect(record.messages).toEqual([{ type: 'late.but.wanted' }]);
    connection.close();
  });

  it('ends a session the service never finishes, once, after the settle time', async () => {
    const { record, connection, media } = await listening(500);
    vi.useFakeTimers();
    connection.mute?.();
    connection.mute?.();
    vi.advanceTimersByTime(499);
    expect(record.calls).toEqual(['listening']);
    vi.advanceTimersByTime(1);
    expect(record.calls).toEqual(['listening', 'closed']);
    expect(media.peers[0]?.closed).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(record.calls).toEqual(['listening', 'closed']);
  });

  it('waits ten seconds by default', async () => {
    const { record, connection } = await listening();
    vi.useFakeTimers();
    connection.mute?.();
    vi.advanceTimersByTime(9_999);
    expect(record.calls).toEqual(['listening']);
    vi.advanceTimersByTime(1);
    expect(record.calls).toEqual(['listening', 'closed']);
  });

  it('forgets the deadline once the session has ended', async () => {
    const { record, connection, channel } = await listening(500);
    vi.useFakeTimers();
    connection.mute?.();
    channel.onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(record.calls).toEqual(['listening', 'closed']);
    connection.mute?.();
    vi.advanceTimersByTime(1_000);
    expect(record.calls).toEqual(['listening', 'closed']);
  });
});

describe('a browser that refuses the peer connection', () => {
  it('reports a failure and turns the microphone off', async () => {
    const granted = stream();
    const media = rig({ microphone: () => Promise.resolve(granted) });
    media.media.peer = () => {
      throw new Error('too many peer connections');
    };
    const { calls, handlers } = recorder();
    transport(media.media).open({ language: 'en' }, handlers);
    await tick();
    expect(calls).toEqual(['failed:failed']);
    expect(granted.tracks[0]?.stopped).toBe(true);
  });
});
