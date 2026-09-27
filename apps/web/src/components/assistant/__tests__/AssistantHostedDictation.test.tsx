import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BrowserMedia, RealtimeMint } from '@openrunic/voice';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AssistantDictation,
  AssistantLauncher,
  AssistantPanel,
  AssistantProvider,
} from '@/components/assistant';
import type { RunAgentTurn } from '@/components/assistant';
import { CommandProvider } from '@/components/command';
import { mintRealtimeSession, parseAgentCapabilities } from '@/lib/agent';
import type { AgentCapabilities, AgentDictation } from '@/lib/agent';
import type { ApiClientConfig } from '@/lib/api';

/**
 * Hosted dictation on the staff surface (#585): the API names a service, the
 * panel builds a microphone that sends audio there, and the control says so
 * before anyone presses it.
 *
 * The browser's microphone, peer connection and fetch are doubles. No audio is
 * produced and no service is contacted.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/schedule',
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const DICTATION: AgentDictation = {
  endpoint: 'https://speech.example.test/v1/realtime',
  agreement: 'a synthetic agreement with a fictional provider',
  languages: ['en-US'],
  turnDetection: 'server',
};

const BASE = {
  model: { modelId: 'm', endpointHost: 'h', remote: false, dataLeavesDeployment: false },
  tools: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('reading the dictation block', () => {
  it('reads a whole one', () => {
    expect(parseAgentCapabilities({ ...BASE, dictation: DICTATION })?.dictation).toEqual(DICTATION);
  });

  it('reads a broken one as no hosted dictation, and keeps the assistant', () => {
    const parsed = parseAgentCapabilities({ ...BASE, dictation: { ...DICTATION, agreement: '' } });
    expect(parsed?.model.modelId).toBe('m');
    expect(parsed?.dictation).toBeNull();
  });

  it('reads an older server with no block as no hosted dictation', () => {
    expect(parseAgentCapabilities(BASE)?.dictation).toBeNull();
  });
});

describe('mintRealtimeSession', () => {
  function config(fetchImpl: typeof fetch): ApiClientConfig {
    return { baseUrl: 'https://api.test', fetchImpl, getToken: () => 'token-1' };
  }

  it('asks for a language and nothing about the record', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        json({ endpoint: DICTATION.endpoint, credential: 'synthetic-value', agreement: 'x' })
      );
    const signal = new AbortController().signal;
    const minted = await mintRealtimeSession(config(fetchImpl as never), 'en-GB', signal);

    expect(minted).toEqual({ endpoint: DICTATION.endpoint, credential: 'synthetic-value' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/bff/v0/agent/realtime/sessions');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body as string)).toEqual({ language: 'en-GB' });
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it.each([
    ['a refusal', () => json({ title: 'spent' }, 409)],
    ['a body with no credential', () => json({ endpoint: DICTATION.endpoint })],
  ])('rejects %s', async (_name, answer) => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(answer()));
    await expect(
      mintRealtimeSession(config(fetchImpl as never), 'en', new AbortController().signal)
    ).rejects.toThrow();
  });
});

describe('defaultMintRealtime', () => {
  it('asks the configured API', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_MODE', 'live');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test');
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ endpoint: DICTATION.endpoint, credential: 'synthetic-value' }));
    vi.stubGlobal('fetch', fetchImpl);

    const live = await import('@/components/assistant/transport');
    await live.defaultMintRealtime('en', new AbortController().signal);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/bff/v0/agent/realtime/sessions');
  });
});

/* A peer connection and data channel just real enough to carry one session. */
class Channel {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
}

function media() {
  const channels: Channel[] = [];
  const stopped: number[] = [];
  const doubles: BrowserMedia = {
    microphone: () =>
      Promise.resolve({
        getTracks: () => [{ stop: () => stopped.push(1) }],
        getAudioTracks: () => [{ stop: () => stopped.push(1) }],
      } as unknown as MediaStream),
    peer: () =>
      ({
        addTransceiver: vi.fn(),
        createDataChannel: () => {
          const channel = new Channel();
          channels.push(channel);
          return channel;
        },
        createOffer: () => Promise.resolve({ type: 'offer', sdp: 'synthetic-offer' }),
        setLocalDescription: () => Promise.resolve(),
        setRemoteDescription: () => Promise.resolve(),
        close: vi.fn(),
        connectionState: 'new',
      }) as unknown as RTCPeerConnection,
    fetch: () => Promise.resolve(new Response('synthetic-answer')),
  };
  return { doubles, channels, stopped };
}

describe('the control', () => {
  const IDLE = { phase: 'idle', session: null, heard: '', ended: 'none' } as const;

  it('says where the audio goes before the press', () => {
    render(
      <AssistantDictation
        availability={{ status: 'available' }}
        state={IDLE as never}
        egress={{ host: 'speech.example.test', agreement: 'a synthetic agreement' }}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(screen.getByText(/sends what you say to speech\.example\.test/)).toBeInTheDocument();
    expect(screen.getByText(/under a synthetic agreement/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing is sent anywhere/)).toBeNull();
  });

  it('blames the service, not the device, for a language it does not write', () => {
    render(
      <AssistantDictation
        availability={{ status: 'unavailable', reason: 'language' }}
        state={IDLE as never}
        egress={{ host: 'speech.example.test', agreement: 'a synthetic agreement' }}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(screen.getByText(/speech service this practice uses/)).toBeInTheDocument();
    expect(screen.queryByText(/without sending the sound away/)).toBeNull();
  });
});

describe('the panel with a hosted service', () => {
  const run: RunAgentTurn = () =>
    (async function* none() {
      await Promise.resolve();
    })();

  it('mints on the press, and writes what the service transcribed into the box', async () => {
    const capabilities: AgentCapabilities = { ...BASE, dictation: DICTATION };
    const rig = media();
    const mint = vi.fn<RealtimeMint>().mockResolvedValue({
      endpoint: DICTATION.endpoint,
      credential: 'synthetic-value',
    });
    render(
      <CommandProvider>
        <AssistantProvider
          probe={() => Promise.resolve({ status: 'enabled', capabilities })}
          runTurn={run}
        >
          <AssistantLauncher />
          <AssistantPanel readback={null} mintRealtime={mint} realtimeMedia={rig.doubles} />
        </AssistantProvider>
      </CommandProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Assistant' }));

    expect(
      await screen.findByText(/sends what you say to speech\.example\.test/)
    ).toBeInTheDocument();
    expect(mint).not.toHaveBeenCalled();

    const speak = await screen.findByRole('button', { name: 'Speak your question' });
    await waitFor(() => expect(speak).toBeEnabled());
    fireEvent.click(speak);
    await waitFor(() => expect(rig.channels).toHaveLength(1));
    expect(mint).toHaveBeenCalledWith('en', expect.any(AbortSignal));

    const channel = rig.channels[0] as Channel;
    act(() => {
      channel.readyState = 'open';
      channel.onopen?.();
      channel.onmessage?.({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'i1',
          transcript: 'which slots are free on Thursday',
        }),
      });
    });

    expect(screen.getByRole('textbox', { name: /Ask about this record/ })).toHaveValue(
      'which slots are free on Thursday'
    );

    /* Stop with everything already transcribed sends no commit, and the
       microphone goes off. */
    fireEvent.click(screen.getByRole('button', { name: 'Stop the microphone' }));
    await waitFor(() => expect(rig.stopped.length).toBeGreaterThan(0));
    expect(channel.send).not.toHaveBeenCalled();
  });
});
