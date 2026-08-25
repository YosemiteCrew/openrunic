/**
 * The tab title helper.
 *
 * `routes.test.tsx` covers it through the routes that use it, which is the shape
 * that matters. What that cannot reach is the branch for a route with no
 * description of its own: every route in this application has one today, and the
 * branch exists for the first one that does not.
 */

import { describe, expect, it, vi } from 'vitest';

import { pageMetadata } from '../metadata';

let requestHeaders = new Headers();

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(requestHeaders) }));

describe('pageMetadata', () => {
  it('titles the tab and describes the page in the readers language', async () => {
    requestHeaders = new Headers({ cookie: 'or_locale=es' });

    await expect(
      pageMetadata({
        titleKey: 'portal.bills.page.title',
        descriptionKey: 'portal.bills.page.description',
      })
    ).resolves.toEqual({
      title: 'Facturas',
      description: 'Sus facturas, el motivo de cada cargo y cómo pagarlas.',
    });
  });

  it('omits the description entirely for a route that has none', async () => {
    /*
     * Omitted rather than set to `undefined`. Next reads a present-but-undefined
     * value as a deliberate override of the root layout's description, so the
     * difference between the two shapes is a page that ships with no description
     * at all versus one that inherits the application's.
     */
    requestHeaders = new Headers();

    const metadata = await pageMetadata({ titleKey: 'portal.bills.page.title' });

    expect(metadata).toEqual({ title: 'Bills' });
    expect('description' in metadata).toBe(false);
  });

  it('puts a value the message names into the title', async () => {
    /*
     * The reason `values` exists: two tabs open on two people must be impossible
     * to confuse. Nothing in the portal names a patient in a tab yet, so this
     * asserts on the mechanism using a message that does take a value.
     */
    requestHeaders = new Headers();

    const metadata = await pageMetadata({
      titleKey: 'portal.home.unread.other',
      values: { count: '3' },
    });

    expect(metadata.title).toBe('3 messages you have not read.');
  });
});
