/**
 * A {@link RealtimeTransport} for a browser: the microphone track, a WebRTC
 * peer connection, and the credential the API mints for it.
 *
 * {@link ./realtime-capture.ts} decides which of the service's events count;
 * this file only moves bytes, and it is shaped by the three things a browser
 * transport could get wrong on its own:
 *
 * - **The credential is fetched, never configured.** The service's own key is
 *   the deployer's, on the server. What reaches this file is a short-lived
 *   credential from `POST /bff/v0/agent/realtime/sessions`, asked for on the
 *   press and dropped with the session.
 * - **Only to the endpoint the page was told about.** The transport is built
 *   with the endpoint the capabilities response named - the same one the
 *   capture adapter shows as its egress. A credential issued for any other
 *   address is refused rather than followed, so what the screen says and where
 *   the audio goes cannot come apart.
 * - **Audio goes one way.** The microphone track is added send-only and no
 *   receiving track is offered, so a service that speaks has nowhere on this
 *   page to be heard. Its text arrives on the data channel, where the capture
 *   adapter drops everything that is not a transcript of the reader's words.
 *
 * WebRTC only: the offer is posted to the endpoint over `https`. A deployment
 * whose endpoint is a socket gets no browser transport from this file, and so
 * no hosted dictation, rather than a guess at a socket protocol.
 */

import type { CaptureFailure } from './capture.js';
import type {
  RealtimeConnection,
  RealtimeHandlers,
  RealtimeTransport,
} from './realtime-capture.js';

/** What the API hands back for one session, as far as this file reads it. */
export interface RealtimeCredential {
  endpoint: string;
  credential: string;
}

/**
 * Asks the API for a credential. The app's code, because the app owns its
 * session and its proxy; told the language and nothing about the record.
 */
export type RealtimeMint = (language: string, signal: AbortSignal) => Promise<RealtimeCredential>;

/** The three browser capabilities this transport needs. Injected in tests. */
export interface BrowserMedia {
  microphone: () => Promise<MediaStream>;
  peer: () => RTCPeerConnection;
  fetch: typeof fetch;
}

/**
 * The browser's own, or null where any of the three is missing - a server
 * render, an insecure origin, an old browser.
 */
export function browserMedia(scope: Partial<typeof globalThis> = globalThis): BrowserMedia | null {
  const devices = scope.navigator?.mediaDevices;
  const Peer = scope.RTCPeerConnection;
  const doFetch = scope.fetch;
  if (typeof devices?.getUserMedia !== 'function' || Peer === undefined || doFetch === undefined) {
    return null;
  }
  return {
    microphone: () => devices.getUserMedia({ audio: true }),
    peer: () => new Peer(),
    fetch: (input, init) => doFetch(input, init),
  };
}

export interface BrowserRealtimeOptions {
  /** The endpoint the capabilities response named. Nothing else is contacted. */
  endpoint: string;
  languages: readonly string[];
  turnDetection: RealtimeTransport['turnDetection'];
  mint: RealtimeMint;
  /** Label of the data channel the service's events arrive on. */
  channel?: string;
  /** Absent means the browser's own; null means there is none. */
  media?: BrowserMedia | null;
  /**
   * How long after stop the service has to deliver the last words before the
   * session is ended without them. Milliseconds.
   */
  settleMs?: number;
}

const DEFAULT_CHANNEL = 'events';
const DEFAULT_SETTLE_MS = 10_000;

function isHttps(endpoint: string): boolean {
  try {
    return new URL(endpoint).protocol === 'https:';
  } catch {
    return false;
  }
}

/** How a refused or missing microphone reads to the person who pressed. */
function microphoneFailure(error: unknown): CaptureFailure {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
    return 'no-audio';
  }
  return 'failed';
}

function parse(data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

export function createBrowserRealtimeTransport(
  options: BrowserRealtimeOptions
): RealtimeTransport | null {
  const media = options.media === undefined ? browserMedia() : options.media;
  if (media === null || !isHttps(options.endpoint)) return null;
  const label = options.channel ?? DEFAULT_CHANNEL;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

  const open = (session: { language: string }, handlers: RealtimeHandlers): RealtimeConnection => {
    const controller = new AbortController();
    let stream: MediaStream | null = null;
    let peer: RTCPeerConnection | null = null;
    let channel: RTCDataChannel | null = null;
    let done = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;

    const stopMicrophone = () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
    };

    /* Every exit comes through here, once: the microphone light goes off on
       every path, including the ones where the page never heard back. */
    const release = () => {
      if (done) return;
      done = true;
      if (deadline !== null) clearTimeout(deadline);
      controller.abort();
      channel?.close();
      peer?.close();
      stopMicrophone();
    };
    const fail = (reason: CaptureFailure) => {
      if (done) return;
      release();
      handlers.failed(reason);
    };

    const connect = async () => {
      let minted: RealtimeCredential;
      try {
        minted = await options.mint(session.language, controller.signal);
      } catch {
        fail('failed');
        return;
      }
      if (done) return;
      if (minted.endpoint !== options.endpoint) {
        fail('failed');
        return;
      }

      let granted: MediaStream;
      try {
        granted = await media.microphone();
      } catch (error) {
        fail(microphoneFailure(error));
        return;
      }
      stream = granted;
      if (done) {
        /* Closed during the permission prompt: the grant arrived after the
           reader stopped wanting it, and the light must not stay on. */
        for (const track of granted.getTracks()) track.stop();
        return;
      }
      const track = granted.getAudioTracks()[0];
      if (track === undefined) {
        fail('no-audio');
        return;
      }

      /* Everything from here can throw - a browser can refuse another peer
         connection - and the microphone is already open, so every throw has
         to reach the release below rather than escape as a rejection. */
      try {
        const connection = media.peer();
        peer = connection;
        connection.addTransceiver(track, { direction: 'sendonly' });
        const events = connection.createDataChannel(label);
        channel = events;
        events.onopen = () => {
          if (!done) handlers.listening();
        };
        /* A data channel frame from the peer this session opened, not a message
           from another window: there is no origin to check, and the capture
           adapter reads every frame as untrusted anyway. */
        const received = (frame: { data: unknown }) => {
          if (!done) handlers.message(parse(frame.data));
        };
        events.onmessage = received;
        events.onclose = () => {
          if (done) return;
          release();
          handlers.closed();
        };
        connection.onconnectionstatechange = () => {
          if (connection.connectionState === 'failed') fail('failed');
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        const response = await media.fetch(minted.endpoint, {
          method: 'POST',
          body: offer.sdp ?? '',
          headers: {
            authorization: `Bearer ${minted.credential}`,
            'content-type': 'application/sdp',
          },
          signal: controller.signal,
          // The offer goes to the named endpoint and nowhere it points onward.
          redirect: 'error',
        });
        if (!response.ok) throw new Error('The service refused the offer.');
        const answer = await response.text();
        /* Closed while the answer was in flight: the connection is already
           gone, and applying the answer to it would only throw. */
        if (!done) await connection.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch {
        fail('failed');
      }
    };
    void connect();

    return {
      send: (message) => {
        if (done) return;
        if (channel?.readyState === 'open') {
          channel.send(JSON.stringify(message));
          return;
        }
        /* Stopped before the channel opened: nothing was heard, so there is
           nothing to commit and nothing to wait for. */
        release();
        handlers.closed();
      },
      close: release,
      mute: () => {
        if (done) return;
        stopMicrophone();
        /* A service that never answers must not hold the session open. */
        deadline ??= setTimeout(() => {
          release();
          handlers.closed();
        }, settleMs);
      },
    };
  };

  return { languages: options.languages, turnDetection: options.turnDetection, open };
}
