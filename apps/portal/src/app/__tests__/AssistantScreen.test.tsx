import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantScreen } from '@/app/assistant/AssistantScreen';
import { AssistantProvider } from '@/components/assistant';
import type { AssistantAvailability, AssistantEvent, TurnRequest } from '@/lib/assistant';
import type { PortalApi } from '@/lib/api/types';
import { fails, never, stubApi } from '@/__tests__/support';

/**
 * The assistant page, as somebody with a phone meets it.
 *
 * The first three cases are the ones that decide whether this feature is safe
 * to ship at all: a portal whose practice configured nothing has no assistant,
 * a portal that has not heard back yet has no assistant, and a portal whose
 * probe broke has no assistant. All three render the same way, which is not at
 * all.
 */

const notFound = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ notFound, usePathname: () => '/assistant' }));

/* next/link needs the app router context, which no unit test renders. A plain
   anchor keeps the href, the words and the tab order, which is what these
   assertions are about. */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ENABLED: AssistantAvailability = {
  status: 'enabled',
  capabilities: {
    service: {
      modelId: 'a-model',
      endpointHost: 'inference.example.invalid',
      dataLeavesDeployment: true,
    },
    capabilities: [
      { id: 'record.list', summary: 'Reads your own health record.' },
      { id: 'visits.list', summary: 'Reads your own appointments.' },
      { id: 'bills.list', summary: 'Reads your own bills.' },
    ],
  },
};

const APPOINTMENT_SOURCE = {
  resourceType: 'Appointment',
  resourceId: 'appointment-9',
  label: 'Follow-up',
  untrusted: false,
};

function scripted(events: AssistantEvent[], onRequest?: (request: TurnRequest) => void) {
  return async function* run(request: TurnRequest): AsyncGenerator<AssistantEvent> {
    onRequest?.(request);
    for (const event of events) {
      /* One tick between events, so the page sees them arrive rather than
         receiving the whole turn in the render that started it. That is the
         order a real stream delivers in, and it is the order the streaming
         states are drawn for. */
      await Promise.resolve();
      yield event;
    }
  };
}

interface MountOptions {
  availability?: AssistantAvailability;
  probeRejects?: boolean;
  probeNeverSettles?: boolean;
  events?: AssistantEvent[];
  onRequest?: (request: TurnRequest) => void;
  api?: PortalApi;
}

function mount(options: MountOptions = {}) {
  const probe = (): Promise<AssistantAvailability> => {
    if (options.probeNeverSettles === true) return never();
    if (options.probeRejects === true) return Promise.reject(new Error('the probe broke'));
    return Promise.resolve(options.availability ?? { status: 'absent' });
  };

  return render(
    <AssistantProvider probe={probe} runTurn={scripted(options.events ?? [], options.onRequest)}>
      <AssistantScreen api={options.api ?? stubApi()} />
    </AssistantProvider>
  );
}

beforeEach(() => {
  notFound.mockClear();
});

describe('a portal whose practice configured no assistant', () => {
  it('has no assistant page at all', async () => {
    mount({ availability: { status: 'absent' } });

    await vi.waitFor(() => {
      expect(notFound).toHaveBeenCalled();
    });
    expect(screen.queryByRole('heading', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('has no assistant page when the probe broke, exactly as when there is none', async () => {
    mount({ probeRejects: true });

    await vi.waitFor(() => {
      expect(notFound).toHaveBeenCalled();
    });
    expect(screen.queryByRole('heading', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('shows nothing at all while the probe is still in flight, and does not answer 404 yet', () => {
    const { container } = mount({ probeNeverSettles: true });

    /* Neither guess is acceptable here. Guessing present would flash a working
       assistant at a practice that has none; guessing absent would answer 404
       on every first load of a practice that has one. */
    expect(container).toBeEmptyDOMElement();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('a portal whose practice configured one', () => {
  it('says what it can and cannot do before the box, not after it', async () => {
    mount({ availability: ENABLED });

    const notice = await screen.findByRole('complementary', {
      name: 'What this can and cannot do',
    });
    expect(notice).toHaveTextContent('It cannot tell you what something means');
    expect(notice).toHaveTextContent('message your care team');

    // The notice comes first in the document, so it is read before a question
    // has been written rather than after it has been sent.
    const box = await screen.findByLabelText('Your question');
    expect(notice.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the service and says plainly that what is typed leaves the practice', async () => {
    mount({ availability: ENABLED });

    expect(await screen.findByText(/a-model/)).toBeInTheDocument();
    expect(screen.getByText(/inference\.example\.invalid/)).toBeInTheDocument();
    expect(screen.getByText(/sent out of your practice/)).toBeInTheDocument();
  });

  it('says so just as plainly when nothing leaves the practice', async () => {
    mount({
      availability: {
        status: 'enabled',
        capabilities: {
          ...ENABLED.capabilities,
          service: { ...ENABLED.capabilities.service, dataLeavesDeployment: false },
        },
      } as AssistantAvailability,
    });

    expect(await screen.findByText(/stays on the practice/)).toBeInTheDocument();
  });

  it('lists what it is allowed to look at, in the reader own words', async () => {
    mount({ availability: ENABLED });

    expect(await screen.findByText('What it is allowed to look at')).toBeInTheDocument();
    expect(screen.getByText('Reads your own health record.')).toBeInTheDocument();
    expect(screen.getByText('Reads your own bills.')).toBeInTheDocument();
  });

  it('waits for the record to load before it will take a question', async () => {
    mount({ availability: ENABLED, api: stubApi({ getPatient: never }) });

    expect(await screen.findByText('Loading your record.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();
  });

  it('offers the ordinary retry when the record does not load, and still takes no question', async () => {
    mount({ availability: ENABLED, api: stubApi({ getPatient: fails }) });

    expect(await screen.findByText('Your record did not load.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();
  });
});

describe('asking a question', () => {
  it('sends the reader own chart, so a capability has something to check the answer against', async () => {
    const requests: TurnRequest[] = [];
    mount({
      availability: ENABLED,
      events: [
        { type: 'text', text: 'You have one appointment booked.' },
        { type: 'sources', entries: [APPOINTMENT_SOURCE] },
        { type: 'finished', outcome: 'completed' },
      ],
      onRequest: (request) => requests.push(request),
    });

    await userEvent.type(await screen.findByLabelText('Your question'), 'When am I next in?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await screen.findByText('You have one appointment booked.');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      message: 'When am I next in?',
      turnIndex: 0,
      chartPatientId: 'patient-or-100482',
    });
  });

  it('shows every record an answer came from, as a link into the reader own portal', async () => {
    mount({
      availability: ENABLED,
      events: [
        { type: 'text', text: 'You have one appointment booked.' },
        { type: 'sources', entries: [APPOINTMENT_SOURCE] },
        { type: 'finished', outcome: 'completed' },
      ],
    });

    await userEvent.type(await screen.findByLabelText('Your question'), 'When am I next in?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('Where this came from')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'see it in your appointments' });
    expect(link).toHaveAttribute('href', '/appointments');
    // The link into the record carries no record identifier, because no portal
    // route takes one. A citation cannot point into anybody's chart, including
    // the reader's own.
    expect(link.getAttribute('href')).not.toContain('appointment-9');
  });

  it('shows nothing when the words arrived without the records behind them', async () => {
    mount({
      availability: ENABLED,
      events: [
        { type: 'text', text: 'Your thyroid has been improving steadily.' },
        { type: 'finished', outcome: 'completed' },
      ],
    });

    await userEvent.type(await screen.findByLabelText('Your question'), 'How is my thyroid?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/came back without the records/)).toBeInTheDocument();
    expect(screen.queryByText('Your thyroid has been improving steadily.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write to your care team' })).toBeInTheDocument();
  });

  it('throws the answer away and speaks up when a record from another chart arrived', async () => {
    mount({
      availability: ENABLED,
      events: [
        { type: 'text', text: 'Somebody else has an appointment on Tuesday.' },
        { type: 'failed', code: 'AGENT_COMPARTMENT_VIOLATION' },
        { type: 'finished', outcome: 'failed' },
      ],
    });

    await userEvent.type(await screen.findByLabelText('Your question'), 'When am I next in?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('was not from your record');
    expect(alert).toHaveTextContent('tell your care team');
    expect(screen.queryByText(/Somebody else/)).not.toBeInTheDocument();
  });

  it('draws no records under an answer that was thrown away', async () => {
    mount({
      availability: ENABLED,
      events: [
        { type: 'text', text: 'You have one appointment booked.' },
        { type: 'sources', entries: [APPOINTMENT_SOURCE] },
        /* The stream died after the records had arrived, which is how a reader
           reaches a settled turn holding a ledger for an answer that never
           landed. */
        { type: 'failed', code: 'ASSISTANT_UNREACHABLE' },
        { type: 'finished', outcome: 'failed' },
      ],
    });

    await userEvent.type(await screen.findByLabelText('Your question'), 'When am I next in?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be reached');
    // A citation list under a failure reads as an answer that was checked.
    expect(screen.queryByText('Where this came from')).not.toBeInTheDocument();
    expect(screen.queryByText('You have one appointment booked.')).not.toBeInTheDocument();
  });

  it('refuses to show a draft change, because a patient must never be handed one', async () => {
    mount({
      availability: ENABLED,
      events: [
        { type: 'failed', code: 'ASSISTANT_UNEXPECTED_DRAFT' },
        { type: 'finished', outcome: 'failed' },
      ],
    });

    await userEvent.type(await screen.findByLabelText('Your question'), 'Move my appointment');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing in your record has changed'
    );
  });

  it('offers the stop control only while an answer is arriving', async () => {
    mount({
      availability: ENABLED,
      events: [
        { type: 'text', text: 'You have one appointment booked.' },
        { type: 'sources', entries: [APPOINTMENT_SOURCE] },
        { type: 'finished', outcome: 'completed' },
      ],
    });

    await screen.findByLabelText('Your question');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });
});

describe('a question that is for a person', () => {
  it('is answered here, and is never sent anywhere', async () => {
    const requests: TurnRequest[] = [];
    mount({ availability: ENABLED, onRequest: (request) => requests.push(request) });

    await userEvent.type(
      await screen.findByLabelText('Your question'),
      'Should I stop taking my tablets?'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/This one is for a person/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write to your care team' })).toHaveAttribute(
      'href',
      '/messages'
    );
    // The words of a question about somebody's own symptoms were not posted to
    // an inference endpoint in order to be declined there.
    expect(requests).toEqual([]);
  });
});

describe('how the page reads', () => {
  /** Words that would tell a reader how worried to be, or make a clinical claim. */
  const BANNED = [
    'diagnose',
    'diagnosis',
    'triage',
    'acuity',
    'urgency',
    'urgent',
    'advice',
    'recommend',
    'severity',
  ];

  /** Shorthand somebody would have to look up. */
  const SHORTHAND = [
    'mrn',
    'dob',
    'prn',
    'icd',
    'cpt',
    'snomed',
    'loinc',
    'cvx',
    'rxnorm',
    'ehr',
    'emr',
    'phi',
    'fhir',
  ];

  /** Long sentences are where plain language goes wrong first. */
  const MAX_WORDS_PER_SENTENCE = 25;

  /**
   * A question to put before the page is read, and the words that mean the turn
   * has settled.
   *
   * A case that supplies events without asking anything reads the same empty
   * page as the case above it, so the events have to be driven through the box
   * for the state under test to exist at all.
   */
  interface Asked {
    question: string;
    settlesOn: RegExp;
  }

  async function visibleText(options: MountOptions, asked?: Asked): Promise<string> {
    const { container, unmount } = mount(options);
    await screen.findByRole('heading', { name: 'Assistant' });

    if (asked !== undefined) {
      await userEvent.type(await screen.findByLabelText('Your question'), asked.question);
      await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
      // Read once the turn has landed: the words under test are the ones a
      // reader is left looking at, not the ones passing through mid-stream.
      await screen.findByText(asked.settlesOn);
    }

    const text = container.textContent ?? '';
    unmount();
    return text;
  }

  const READING_CASES: [string, MountOptions, Asked | undefined][] = [
    ['before anything is asked', { availability: ENABLED }, undefined],
    [
      'when the answer is withheld',
      {
        availability: ENABLED,
        events: [
          { type: 'text', text: 'Unsourced.' },
          { type: 'finished', outcome: 'completed' },
        ],
      },
      { question: 'What is on my record?', settlesOn: /came back without the records/ },
    ],
    [
      'when the turn failed',
      {
        availability: ENABLED,
        events: [
          { type: 'failed', code: 'AGENT_COMPARTMENT_VIOLATION' },
          { type: 'finished', outcome: 'failed' },
        ],
      },
      { question: 'When am I next in?', settlesOn: /was not from your record/ },
    ],
    [
      'when the record did not load',
      { availability: ENABLED, api: stubApi({ getPatient: fails }) },
      undefined,
    ],
  ];

  it.each(READING_CASES)(
    'uses no clinical shorthand and no loaded words, %s',
    async (_case, options, asked) => {
      const words = (await visibleText(options, asked)).toLowerCase().split(/[^a-z]+/);

      for (const word of BANNED) expect(words, word).not.toContain(word);
      for (const word of SHORTHAND) expect(words, word).not.toContain(word);
    }
  );

  it('writes in sentences somebody can read on a phone', async () => {
    const text = await visibleText({ availability: ENABLED });

    for (const sentence of text.split(/[.!?]/)) {
      const words = sentence
        .trim()
        .split(/\s+/)
        .filter((word) => word !== '');
      expect(words.length, sentence.trim()).toBeLessThanOrEqual(MAX_WORDS_PER_SENTENCE);
    }
  });
});
