import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PublicLayout, { generateMetadata, generateStaticParams } from '../layout';
import HomePage, { metadata as homeMetadata } from '../page';
import DevelopersPage, { metadata as developersMetadata } from '../for/developers/page';
import HospitalsPage, { metadata as hospitalsMetadata } from '../for/hospitals/page';
import PatientsPage, { metadata as patientsMetadata } from '../for/patients/page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

/* Server components with no router in a unit test, so next/link is stubbed
   down to the anchor it renders in the browser. */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const PAGES = [
  {
    route: '/',
    Page: HomePage,
    metadata: homeMetadata,
    heading: 'Open-source operating system for human health',
    /* The masthead link this page is behind, or none for home. */
    current: undefined,
  },
  {
    route: '/for/hospitals',
    Page: HospitalsPage,
    metadata: hospitalsMetadata,
    heading: 'Run the clinical day on software you control',
    current: 'Hospitals',
  },
  {
    route: '/for/patients',
    Page: PatientsPage,
    metadata: patientsMetadata,
    heading: 'Your record, in a format that can leave',
    current: 'Patients',
  },
  {
    route: '/for/developers',
    Page: DevelopersPage,
    metadata: developersMetadata,
    heading: 'An open platform with the boundary written down',
    current: 'Developers',
  },
] as const;

/** Every heading on the page, in document order, as its level. */
function headingLevels(): number[] {
  return [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((node) =>
    Number(node.tagName.slice(1))
  );
}

describe('the public route group', () => {
  /*
   * `apps/web` declares robots noindex/nofollow by default, because the staff
   * EMR has no business in a search index and a chart URL certainly does not.
   * That default is fail-closed, so the public pages have to opt back in, and
   * this layout is the single place that does it.
   */
  it('opts the public pages back into search indexes', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });

    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  /*
   * Prerendering one page per language creates several URLs carrying the same
   * article. Without an hreflang pointing at each other a crawler has to guess
   * which is canonical, and these pages are indexable, so the guess would be
   * ours to live with.
   */
  it('points each language at the others, so the duplicates are declared', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'es' }) });

    expect(metadata.alternates?.canonical).toBe('/es');
    expect(metadata.alternates?.languages).toMatchObject({ en: '/en', es: '/es' });
  });

  /*
   * The property the whole change is for: one prerendered page per language.
   * Read from the catalogue rather than listed, so adding a language stays a
   * catalogue file and one line.
   */
  it('builds one page per supported locale', () => {
    expect(generateStaticParams()).toEqual([{ locale: 'en' }, { locale: 'es' }]);
  });

  /**
   * Only the refusal is asserted here. What the layout renders when it accepts
   * is `AppShell`, which the `(app)` layout suite already drives end to end -
   * and rendering it from this file would mean mocking the router the session
   * gate reads, to re-test a shell that is not what this layout decides.
   *
   * A path segment is caller-supplied. `generateStaticParams` builds the
   * supported ones, but nothing stops a request for `/fr`, and rendering it
   * would put an unknown string into `<html lang>` and show a reader every
   * message key instead of every message.
   */
  it('refuses a language this build carries no catalogue for', async () => {
    await expect(
      PublicLayout({
        children: <p>contenu</p>,
        params: Promise.resolve({ locale: 'fr' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

/**
 * The pages are async server components: they take the language segment from
 * the URL, which is what lets them prerender once per language. `await Page(…)`
 * is what the framework does with one, and it is the only way to render one
 * from a test.
 */
async function renderPage(
  Page: (props: { params: Promise<{ locale: string }> }) => Promise<React.JSX.Element>
) {
  render(await Page({ params: Promise.resolve({ locale: 'en' }) }));
}

describe.each(PAGES)('$route', ({ Page, metadata, heading, current }) => {
  it('has exactly one h1, and it states what the page is', async () => {
    await renderPage(Page);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('descends its heading outline one level at a time', async () => {
    await renderPage(Page);
    const levels = headingLevels();

    expect(levels[0]).toBe(1);
    levels.forEach((level, index) => {
      // The first heading has nothing above it, so it compares against itself.
      const previous = levels[index - 1] ?? level;

      expect(level - previous).toBeLessThanOrEqual(1);
    });
  });

  it('names the browser tab', () => {
    expect(metadata.title).toBeDefined();
    expect(metadata.description).toBeTruthy();
  });

  it('carries the compliance footnote in the closing band', async () => {
    await renderPage(Page);

    expect(
      screen.getByText('openrunic is open-source software, not a certified medical device.')
    ).toBeInTheDocument();
  });

  it('marks its own section in the masthead', async () => {
    await renderPage(Page);
    const marked = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent);

    expect(marked).toEqual(current === undefined ? [] : [current]);
  });

  it('states where the project actually is before it states anything else', async () => {
    await renderPage(Page);

    expect(screen.getByRole('complementary')).toHaveTextContent(/pre-alpha|no releases/i);
  });
});

describe('page titles', () => {
  it('gives the home page a tab that says what openrunic is', () => {
    expect(homeMetadata.title).toEqual({
      absolute: 'openrunic - open-source operating system for human health',
    });
  });

  it('titles each audience page after its audience', () => {
    expect([hospitalsMetadata.title, patientsMetadata.title, developersMetadata.title]).toEqual([
      'For hospitals and clinics',
      'For patients',
      'For developers',
    ]);
  });
});

describe('what the pages claim', () => {
  /*
   * The two assertions this whole surface exists to keep true. openrunic is
   * certified by nobody, and compliance is a property of a deployment rather
   * than of source code; if either sentence is ever softened out of the home
   * page, that is a defect and not a copy edit.
   */
  it('says plainly that openrunic is not certified', async () => {
    await renderPage(HomePage);

    expect(
      screen.getByRole('heading', { level: 3, name: 'openrunic is not certified for anything' })
    ).toBeInTheDocument();
    expect(screen.getByText(/compliance is a property of a deployment/i)).toBeInTheDocument();
  });

  it('offers the three audiences and no fourth', async () => {
    await renderPage(HomePage);
    const audiences = screen.getByRole('region', { name: 'Three audiences' });

    expect(audiences.querySelectorAll('article')).toHaveLength(3);
  });
});
