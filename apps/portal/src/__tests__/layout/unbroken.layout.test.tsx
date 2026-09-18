import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { page } from 'vitest/browser';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppointmentsScreen } from '@/app/appointments/AppointmentsScreen';
import { BillsScreen } from '@/app/bills/BillsScreen';
import { FormsScreen } from '@/app/forms/FormsScreen';
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
] as const;

/*
 * The health record is deliberately not in that list yet, and it is the one screen that still
 * fails this check.
 *
 * Its badge carries `ClinicalDocument.format`, which the API builds at
 * `apps/api/src/routes/portal.ts` as a raw MIME type and a raw byte count - and the Word
 * document type alone is 71 unbroken characters of ordinary production data. `.or-badge` is
 * `white-space: nowrap` on purpose, because a status pill is the size of its text, so the
 * wrap rule this suite relies on cannot reach it and should not.
 *
 * That is a data-shape defect rather than a stylesheet one: the badge is right and its input
 * is wrong. Adding the screen here would mean either weakening the assertion or breaking the
 * badge, so it waits for the fix that gives the portal a bounded label to render.
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
