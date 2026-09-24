import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantScreen } from '@/app/assistant/AssistantScreen';
import { AssistantComposer, AssistantProvider } from '@/components/assistant';
import { mintRealtimeSession, parseAssistantCapabilities } from '@/lib/assistant';
import type { AssistantAvailability } from '@/lib/assistant';
import type { BrowserMedia, RealtimeMint } from '@/lib/voice';
import { stubApi } from '@/__tests__/support';

/**
 * Hosted dictation on the patient portal (#585): the practice configured a
 * transcription service, and the page says where the reader's voice goes
 * before they press anything.
 *
 * The browser's microphone, peer connection and fetch are doubles. No audio is
 * produced and no service is contacted.
 */

vi.mock('next/navigation', () => ({ notFound: vi.fn(), usePathname: () => '/assistant' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const DICTATION = {
  endpoint: 'https://speech.example.test/v1/realtime',
  agreement: 'a synthetic agreement with a fictional provider',
  languages: ['en-US'],
  turnDetection: 'server' as const,
};

const MODEL = {
  modelId: 'a-model',
  endpointHost: 'inference.example.invalid',
  dataLeavesDeployment: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('reading the dictation block', () => {
  it('reads a whole one, and none from an older server', () => {
    expect(
      parseAssistantCapabilities({ model: MODEL, tools: [], dictation: DICTATION })?.dictation
    ).toEqual(DICTATION);
    expect(parseAssistantCapabilities({ model: MODEL, tools: [] })?.dictation).toBeNull();
  });
});

describe('mintRealtimeSession', () => {
  it('asks through the portal proxy for a language and nothing about the record', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ endpoint: DICTATION.endpoint, credential: 'synthetic-value' }));
    const signal = new AbortController().signal;
    const minted = await mintRealtimeSession(
      { baseUrl: '/api', fetchImpl: fetchImpl as never },
      'es',
      signal
    );

    expect(minted).toEqual({ endpoint: DICTATION.endpoint, credential: 'synthetic-value' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bff/v0/agent/realtime/sessions');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body as string)).toEqual({ language: 'es' });
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('rejects a refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ title: 'spent' }, 409));
    await expect(
      mintRealtimeSession(
        { baseUrl: '/api', fetchImpl: fetchImpl as never },
        'en',
        new AbortController().signal
      )
    ).rejects.toThrow();
  });

  it('is what the page uses by default', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ endpoint: DICTATION.endpoint, credential: 'synthetic-value' }));
    vi.stubGlobal('fetch', fetchImpl);
    const live = await import('@/lib/assistant');
    await live.defaultMintRealtime('en', new AbortController().signal);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/bff/v0/agent/realtime/sessions');
  });
});

describe('the control', () => {
  const unavailable = {
    available: async () => ({ status: 'unavailable', reason: 'language' }) as const,
    onEvent: () => () => undefined,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };

  it('blames the practice service, not the device, for a language it does not write', async () => {
    render(
      <AssistantComposer
        answering={false}
        capture={unavailable}
        chartPatientId="p1"
        dictationEgress={{ host: 'speech.example.test', agreement: 'a synthetic agreement' }}
        onAsk={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(await screen.findByText(/speech service your practice uses/)).toBeInTheDocument();
    expect(screen.queryByText(/without sending the sound away/)).toBeNull();
  });
});

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

describe('the page with a hosted service', () => {
  it('says where the voice goes, mints on the press, and writes the words into the box', async () => {
    const availability: AssistantAvailability = {
      status: 'enabled',
      capabilities: {
        service: MODEL,
        capabilities: [{ id: 'record.list', summary: 'Reads your own health record.' }],
        dictation: DICTATION,
      },
    };
    const rig = media();
    const mint = vi.fn<RealtimeMint>().mockResolvedValue({
      endpoint: DICTATION.endpoint,
      credential: 'synthetic-value',
    });
    render(
      <AssistantProvider
        probe={() => Promise.resolve(availability)}
        runTurn={() =>
          (async function* none() {
            await Promise.resolve();
          })()
        }
      >
        <AssistantScreen
          api={stubApi()}
          readback={null}
          mintRealtime={mint}
          realtimeMedia={rig.doubles}
        />
      </AssistantProvider>
    );

    expect(
      await screen.findByText(/sends what you say to speech\.example\.test/)
    ).toBeInTheDocument();
    expect(screen.getByText(/a synthetic agreement with a fictional provider/)).toBeInTheDocument();
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
          transcript: 'when is my next appointment',
        }),
      });
    });
    expect(screen.getByRole('textbox')).toHaveValue('when is my next appointment');

    fireEvent.click(screen.getByRole('button', { name: 'Stop the microphone' }));
    await waitFor(() => expect(rig.stopped.length).toBeGreaterThan(0));
  });
});
