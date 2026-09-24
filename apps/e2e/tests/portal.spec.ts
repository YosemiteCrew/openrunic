import { expect, test, type Page } from '@playwright/test';

test('opens a private portal route through its real session gate', async ({ page }) => {
  await page.goto('/messages');

  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
});

/**
 * THE VOICE, IN A REAL BROWSER.
 *
 * Every other test of dictation and readback drives a `CapturePort` or a
 * `ReadbackPort` double, which is the right shape for the rules and says
 * nothing at all about the two adapters underneath them: those reach for
 * `SpeechRecognition` and `speechSynthesis`, neither of which exists under
 * jsdom, so the files that decide what the browser is actually asked have never
 * run anywhere but here.
 *
 * ## Why the API is fulfilled rather than served
 *
 * The assistant page is 404 until a probe says a practice configured one, and
 * `apps/api` mounts no agent router without a model endpoint. Standing one up
 * would put a database, a migration and a provider credential between this
 * suite and a question about a microphone. So the two agent routes and the
 * patient record are answered at the network boundary and everything above them
 * - the probe, the transcript, the readback rules, both platform adapters and
 * the real browser's own speech services - is the shipped code.
 *
 * ## Why both specs measure before they assert
 *
 * Neither speech service is a property of the product. `SpeechRecognition`
 * answers `downloadable` on a machine with no recogniser pack, and
 * `speechSynthesis.getVoices()` is empty on a Linux runner with no system
 * speech service - and in both cases the portal correctly draws a disabled
 * control and a sentence explaining it. A spec that assumed either answer would
 * be vacuous on the machine where it was wrong rather than failing, so each one
 * reads the browser's own answer first and asserts the rendering that answer
 * requires.
 */

/** `GET /bff/v0/agent/tools`, in the shape `parseAssistantCapabilities` reads. */
const CAPABILITIES = {
  model: {
    modelId: 'drill-model',
    endpointHost: 'models.drill.invalid',
    dataLeavesDeployment: false,
  },
  tools: [{ id: 'appointments', summary: 'Your appointments' }],
};

const PATIENT = {
  id: '01890000-0000-7000-8000-000000000501',
  name: 'Drill Patient',
  mrn: 'MRN-DRILL-1',
  dateOfBirth: '1979-04-02',
};

/**
 * The answer, ending in a full stop and carrying a source.
 *
 * Both are load-bearing rather than decoration: `speakableAnswer` refuses a turn
 * whose sources never arrived, so an unsourced fixture would settle as withheld
 * and the voice would never be offered it - which would look exactly like a
 * readback that does not work.
 */
const ANSWER = 'Your next appointment is on Tuesday the fourteenth at ten in the morning.';

/*
 * The wire names, not the union's. `parseAssistantEvent` maps `text-delta` onto
 * `text` and `turn-finished` onto `finished`, and returns null for a frame it
 * does not know - so a fixture written in the internal names streams a turn
 * that never answers and never settles, which is a broken fixture wearing the
 * costume of a broken product.
 */
const TURN_STREAM = `${[
  { type: 'text-delta', text: ANSWER },
  {
    type: 'sources',
    entries: [
      {
        resourceType: 'Appointment',
        resourceId: 'appt-drill-1',
        label: 'Next appointment',
        untrusted: false,
      },
    ],
  },
  { type: 'turn-finished', outcome: 'completed' },
]
  .map((event) => `data: ${JSON.stringify(event)}`)
  .join('\n\n')}\n\n`;

/** What the browser says when asked whether it can recognise speech on the device. */
type OnDeviceAnswer = string | null;

/** One utterance, as it was handed to the device's own synthesiser. */
interface SpokenRecord {
  text: string;
  lang: string;
  /** The voice the adapter picked, or null where it left the browser's default. */
  voiceLang: string | null;
}

declare global {
  interface Window {
    __spoken?: SpokenRecord[];
  }
}

/**
 * Answers the three requests the assistant page makes, and nothing else.
 *
 * Narrow patterns rather than one `**\/api\/**`: a route this suite has not
 * thought about should reach the portal's own proxy and fail there, visibly,
 * rather than be silently absorbed by a catch-all.
 */
async function configureAssistant(page: Page): Promise<void> {
  await page.route('**/api/bff/v0/agent/tools', (route) => route.fulfill({ json: CAPABILITIES }));
  await page.route('**/api/portal/patient', (route) => route.fulfill({ json: PATIENT }));
  await page.route('**/api/bff/v0/agent/turns', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: TURN_STREAM })
  );
}

/**
 * Asks this browser what it can recognise on the device, with the same question
 * `createPlatformCapture` asks.
 *
 * Null means the constructor has no `available` at all, which is the one answer
 * that would make the spec below vacuous: the adapter is then null, the control
 * draws nothing, and an assertion about a disabled button would pass by never
 * finding one. It is asserted against rather than skipped on.
 */
function onDeviceRecognition(page: Page, language: string): Promise<OnDeviceAnswer> {
  return page.evaluate(async (lang) => {
    const scope = globalThis as {
      SpeechRecognition?: { available?: (query: unknown) => Promise<string> };
      webkitSpeechRecognition?: { available?: (query: unknown) => Promise<string> };
    };
    const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    const available = Constructor?.available;
    if (typeof available !== 'function') return null;
    return available.call(Constructor, { langs: [lang], processLocally: true });
  }, language);
}

/**
 * The languages this device can speak in, once its list has settled.
 *
 * A browser answers with an empty list for the first moment of its life and
 * then corrects itself, which is why the adapter subscribes to `voiceschanged`
 * rather than asking once. This waits for that same event, and the callers
 * re-read the list after asserting so that a list which arrived late fails as a
 * disagreement rather than passing as a device with no voice.
 */
function deviceVoices(page: Page): Promise<string[] | null> {
  return page.evaluate(async () => {
    const synthesis = globalThis.speechSynthesis as SpeechSynthesis | undefined;
    if (synthesis === undefined) return null;
    if (synthesis.getVoices().length === 0) {
      // ponytail: a bounded wait, because "no voices yet" and "no voices at all"
      // are the same silence. The re-read after the assertion is what turns a
      // list arriving after this window into a failure rather than a flake.
      await new Promise<void>((resolve) => {
        const settled = () => {
          synthesis.removeEventListener('voiceschanged', settled);
          resolve();
        };
        synthesis.addEventListener('voiceschanged', settled);
        globalThis.setTimeout(settled, 2000);
      });
    }
    return synthesis.getVoices().map((voice) => voice.lang);
  });
}

function primarySubtag(tag: string): string {
  return (tag.split('-')[0] ?? '').toLowerCase();
}

/** The language the page is in, read off the document rather than assumed. */
async function pageLanguage(page: Page): Promise<string> {
  return primarySubtag((await page.locator('html').getAttribute('lang')) ?? '');
}

async function openAssistant(page: Page): Promise<void> {
  await configureAssistant(page);
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible();
}

test('the microphone control says what this browser really answers about on-device recognition', async ({
  page,
}) => {
  await openAssistant(page);
  const language = await pageLanguage(page);

  const answer = await onDeviceRecognition(page, language);
  expect(
    answer,
    'this browser has no SpeechRecognition.available, so the portal draws no dictation control at all and every assertion below would pass by finding nothing'
  ).not.toBeNull();

  const speak = page.getByRole('button', { name: 'Speak your question' });

  if (answer === 'available') {
    await expect(
      page.getByText('Your device turns your speech into writing on the device itself', {
        exact: false,
      })
    ).toBeVisible();
    await expect(speak).toBeEnabled();
    return;
  }

  const note =
    answer === 'downloadable' || answer === 'downloading'
      ? 'This device could do this once its language pack for this page is installed'
      : 'This device cannot turn speech into writing in the language this page is in';

  await expect(page.getByText(note, { exact: false })).toBeVisible();
  await expect(speak).toBeDisabled();
});

test("the readback control says what this device's voice list says", async ({ page }) => {
  await openAssistant(page);
  const language = await pageLanguage(page);

  const voices = await deviceVoices(page);
  expect(
    voices,
    'this browser has no speechSynthesis, so the portal draws no readback control at all and every assertion below would pass by finding nothing'
  ).not.toBeNull();

  const aloud = page.getByRole('switch', { name: 'Read answers aloud' });
  const speaks = (voices ?? []).some((tag) => primarySubtag(tag) === language);

  if (voices?.length === 0) {
    await expect(
      page.getByText('This device has no voice installed', { exact: false })
    ).toBeVisible();
    await expect(aloud).toBeDisabled();
  } else if (speaks) {
    await expect(aloud).toBeEnabled();
  } else {
    await expect(
      page.getByText('This device has no voice for the language this page is in', { exact: false })
    ).toBeVisible();
    await expect(aloud).toBeDisabled();
  }

  /* The list that was asserted against is the list that was read. Voices arrive
     late on several browsers, and one that arrived after the measurement above
     would leave this spec asserting a device with no voice against a control
     that had already found one. */
  expect(await page.evaluate(() => globalThis.speechSynthesis.getVoices().length)).toBe(
    voices?.length
  );
});

test('reads an answer aloud through the voice already on this device', async ({ page }) => {
  await page.addInitScript(() => {
    /* Wrapped rather than replaced: the real synthesiser still speaks, and this
       records what was handed to it. What goes out is the assertion - a control
       that says it is reading says nothing about which words reached the
       device, or in which voice. */
    window.__spoken = [];
    const synthesis = globalThis.speechSynthesis as SpeechSynthesis | undefined;
    if (synthesis === undefined) return;
    const speak = synthesis.speak.bind(synthesis);
    synthesis.speak = (utterance: SpeechSynthesisUtterance) => {
      window.__spoken?.push({
        text: utterance.text,
        lang: utterance.lang,
        voiceLang: utterance.voice?.lang ?? null,
      });
      speak(utterance);
    };
  });

  await openAssistant(page);
  const language = await pageLanguage(page);

  const voices = await deviceVoices(page);
  const speaks = (voices ?? []).some((tag) => primarySubtag(tag) === language);
  /* The drill installs a speech service, so on CI a missing voice is a broken
     runner rather than a device without one, and skipping would hide it. */
  if (process.env.CI === 'true') {
    expect(
      speaks,
      `the drill runner has no ${language} speech voice; check the speech service install and the --enable-speech-dispatcher flag`
    ).toBe(true);
  }
  test.skip(
    !speaks,
    `this machine has no ${language} speech voice, so there is nothing here to read an answer aloud with; the rendering that absence produces is asserted by the readback control spec`
  );

  /* On before the question, not after it: a turn that settles while the switch
     is off is recorded as offered and never spoken, which is what stops turning
     the switch on from reading the whole conversation back at somebody. */
  await page.getByRole('switch', { name: 'Read answers aloud' }).click();

  await page.getByLabel('Your question').fill('When is my next appointment?');
  await page.getByRole('button', { name: 'Ask' }).click();

  await expect(page.getByText(ANSWER)).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => window.__spoken ?? []), {
      message: 'the answer on screen was never handed to the device',
    })
    .toHaveLength(1);

  const [spoken] = await page.evaluate(() => window.__spoken ?? []);

  /* The words spoken are the words rendered, rather than the model's prose or a
     summary of it: there is one path from a record to the reader, and this is
     the only place it can be seen end to end. */
  expect(spoken?.text).toBe(ANSWER);
  expect(spoken?.lang).toBe(language);
  /* A voice chosen by the page's language rather than left to the browser's
     default, which on several of them is the system language. */
  expect(primarySubtag(spoken?.voiceLang ?? '')).toBe(language);
});

/**
 * Hosted dictation, in a real browser (#585).
 *
 * The practice configured a transcription service, so the capabilities carry a
 * `dictation` block and the page builds its microphone on the browser's real
 * peer connection rather than the device's recogniser. The credential route is
 * answered at the network boundary with a refusal - the ceiling-spent answer -
 * so no microphone is opened and no service is contacted, and what is asserted
 * is the part a person sees: where their voice would go before they press, and
 * a refusal reading as a stopped microphone rather than as nothing.
 */
const HOSTED = {
  endpoint: 'https://speech.drill.invalid/v1/realtime',
  agreement: 'the drill agreement with a fictional provider',
  languages: ['en-US', 'es'],
  turnDetection: 'server',
};

test('hosted dictation says where the voice goes before the press, and a refusal reads as a stopped microphone', async ({
  page,
}) => {
  const minted: unknown[] = [];
  const offered: string[] = [];
  await page.route('**/api/bff/v0/agent/tools', (route) =>
    route.fulfill({ json: { ...CAPABILITIES, dictation: HOSTED } })
  );
  await page.route('**/api/portal/patient', (route) => route.fulfill({ json: PATIENT }));
  await page.route('**/api/bff/v0/agent/realtime/sessions', (route) => {
    minted.push(route.request().postDataJSON());
    return route.fulfill({
      status: 409,
      json: { title: 'daily-session-budget-exhausted', status: 409 },
    });
  });
  await page.route('https://speech.drill.invalid/**', (route) => {
    offered.push(route.request().url());
    return route.abort();
  });

  await page.goto('/assistant');
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible();

  await expect(
    page.getByText('The microphone button sends what you say to speech.drill.invalid', {
      exact: false,
    })
  ).toBeVisible();
  await expect(page.getByText(HOSTED.agreement, { exact: false })).toBeVisible();

  const speak = page.getByRole('button', { name: 'Speak your question' });
  await expect(speak).toBeEnabled();
  await speak.click();

  await expect(
    page.getByText('The microphone stopped. You can try again, or type your question.')
  ).toBeVisible();
  await expect(speak).toBeEnabled();
  expect(minted).toEqual([{ language: await pageLanguage(page) }]);
  expect(offered).toEqual([]);
});
