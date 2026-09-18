import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { page } from 'vitest/browser';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppointmentsScreen } from '@/app/appointments/AppointmentsScreen';
import { BillsScreen } from '@/app/bills/BillsScreen';
import { FormsScreen } from '@/app/forms/FormsScreen';
import { HealthRecordScreen } from '@/app/health-record/HealthRecordScreen';
import { HomeScreen } from '@/app/HomeScreen';
import { MessagesScreen } from '@/app/messages/MessagesScreen';
import { buildFixtures, createMockApi } from '@/lib/api';
import type { PortalApi } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { UNBROKEN_MARK, UNBROKEN_RUN, stuffEveryString } from './unbroken';

/**
 * No screen widens the page, whatever text the record holds.
 *
 * #501 was one unbroken appointment reason pushing the document to 5844px inside a 1425px
 * viewport. It was fixed twice, at two sites - `.or-card__title` in the component library
 * (#502) and `.portal-record__meta` here (#504) - because the first fix was made against the
 * site in the report rather than against the defect. This suite is the answer to that: the
 * input goes into every string the portal renders, so a third site fails here rather than in
 * front of a patient.
 *
 * Read the config beside it for why this is a separate suite in a real browser: jsdom reports
 * every width as 0, so the assertion below cannot fail there.
 */

const VIEWPORTS = [
  // The width the report measured, and the narrow breakpoint it also measured. A single width
  // would be a choice about which half of the responsive range to watch.
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'narrow', width: 375, height: 812 },
] as const;

const SCREENS = [
  { name: 'home', mount: (api: PortalApi) => <HomeScreen api={api} /> },
  { name: 'appointments', mount: (api: PortalApi) => <AppointmentsScreen api={api} /> },
  { name: 'messages', mount: (api: PortalApi) => <MessagesScreen api={api} /> },
  { name: 'bills', mount: (api: PortalApi) => <BillsScreen api={api} /> },
  { name: 'forms', mount: (api: PortalApi) => <FormsScreen api={api} /> },
  { name: 'health-record', mount: (api: PortalApi) => <HealthRecordScreen api={api} /> },
] as const;

/*
 * The health record joined this list in #507, and what it took is the reason the list is
 * worth reading. Two of its fields reached an `.or-badge`, which is `white-space: nowrap`
 * because a status pill is the size of its text - so the wrap rule the assertion below
 * relies on cannot reach them and should not. The API was composing both: a document's
 * media type with its byte count, and a dose as a quantity joined to a free-text unit.
 *
 * Neither was fixed in the stylesheet. The document badge now renders a label from a set
 * the portal owns, and the dose moved to the meta line, where wrapping is the right answer
 * for a value the record does not bound. A screen is in this list when its widths hold for
 * a reason rather than because its fixture is short.
 */

/** The element the chrome puts a screen inside, so the widths here are the app's widths. */
function mainElement(): HTMLElement {
  const main = document.createElement('main');
  main.className = 'portal__main';
  main.id = 'portal-main';
  document.body.append(main);
  return main;
}

afterEach(() => {
  document.querySelectorAll('#portal-main').forEach((element) => element.remove());
});

describe.each(SCREENS)('$name', ({ mount }) => {
  it.each(VIEWPORTS)('fits the page at $label ($width)', async ({ width, height }) => {
    await page.viewport(width, height);

    const stuffed = stuffEveryString(buildFixtures());
    // The walk found something to do. Without this, a fixture builder that changed shape
    // would leave every assertion below passing over an unmutated screen.
    expect(stuffed.mutated).toBeGreaterThan(0);

    render(mount(createMockApi(stuffed.value)), { container: mainElement() });

    // The run reached the DOM: it is the load-bearing half of this test, and a screen that
    // renders none of its record - an error state, an empty state, a query that never
    // settled - is a screen whose width says nothing about the defect.
    const marked = await screen.findAllByText(new RegExp(UNBROKEN_MARK));
    expect(marked.length).toBeGreaterThan(0);

    const doc = document.documentElement;
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
  });
});

/**
 * The shell wraps text; a number is the exception, and an exception nobody measures is a
 * comment. Rendered too narrow for its content and asserted to be the height it is with a
 * short value - one line, whatever it costs in overflow.
 *
 * The control is the load-bearing half. `.or-body` gets the same treatment and must come out
 * TALLER than its own short reference, so a measurement that cannot see wrapping at all fails
 * here rather than passing every case above it.
 */
describe('what must not break', () => {
  const DIGITS = '1234567890'.repeat(9);
  const LETTERS = 'M'.repeat(90);

  /** Renders markup too narrow for its content and returns the height of `selector`. */
  function heightOf(html: string, selector: string): number {
    const main = mainElement();
    // Narrow enough that 90 characters cannot fit at any of these type sizes.
    main.style.width = '220px';
    main.innerHTML = html;
    const element = main.querySelector(selector);
    if (element === null) throw new Error(`nothing matched ${selector}`);
    return (element as HTMLElement).clientHeight;
  }

  it('keeps a figure on one line rather than splitting the number', async () => {
    await page.viewport(1440, 900);

    const short = heightOf(`<p class="portal-figure">12</p>`, '.portal-figure');
    const long = heightOf(`<p class="portal-figure">${DIGITS}</p>`, '.portal-figure');

    expect(long).toBe(short);
  });

  it('keeps a money figure on one line without a rule of its own', async () => {
    await page.viewport(1440, 900);

    // `.portal-money` is `white-space: nowrap`, which suppresses every soft wrap opportunity
    // inside it - and `overflow-wrap` has nothing to act on where there are none. So the
    // figure is already safe and a reset on it would be a rule that never fires. The property
    // is asserted here rather than argued in a comment, because the protection comes from the
    // parent and would leave with it.
    const money = (amount: string) =>
      `<span class="portal-money"><span class="portal-money__figure">${amount}</span></span>`;

    const short = heightOf(money('12'), '.portal-money__figure');
    const long = heightOf(money(DIGITS), '.portal-money__figure');

    expect(long).toBe(short);
  });

  it('wraps body copy given the same treatment, which is what proves the check can see it', async () => {
    await page.viewport(1440, 900);

    const short = heightOf(`<p class="or-body">12</p>`, '.or-body');
    const long = heightOf(`<p class="or-body">${LETTERS}</p>`, '.or-body');

    expect(long).toBeGreaterThan(short);
  });
});

describe('what the walk leaves alone', () => {
  it('skips currency codes and nothing else', () => {
    const { exempt } = stuffEveryString(buildFixtures());

    // Pinned as a set rather than a count: a second currency, or a free-text value that
    // happens to be three capitals, changes this and should be looked at rather than
    // absorbed. An exemption is the cheapest place to hide an unchecked claim.
    expect(new Set(exempt)).toEqual(new Set(['GBP']));
  });

  it('skips them because Intl refuses anything that is not a currency code', () => {
    expect(
      () => new Intl.NumberFormat('en-GB', { style: 'currency', currency: UNBROKEN_RUN })
    ).toThrow(RangeError);
  });

  it('skips nothing else, because a mutated instant prints rather than throwing', () => {
    const t = createTranslator(appCatalogue, 'en');

    // The reason dates are in the population: `formatted()` hands back its input when the
    // date is invalid, so a stuffed instant becomes one more unbroken run on the screen.
    expect(formatDateTime(t, UNBROKEN_RUN)).toBe(UNBROKEN_RUN);
  });
});
