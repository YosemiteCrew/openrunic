import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MarketingLayout, { metadata as marketingMetadata } from '../layout';
import HomePage, { metadata as homeMetadata } from '../page';
import DevelopersPage, { metadata as developersMetadata } from '../for/developers/page';
import HospitalsPage, { metadata as hospitalsMetadata } from '../for/hospitals/page';
import PatientsPage, { metadata as patientsMetadata } from '../for/patients/page';

/* Server components with no router in a unit test, so next/link is stubbed
   down to the anchor it renders in the browser. */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/*
 * The pages are asynchronous server components now, because the reader's
 * language is resolved from the request before anything renders. So they are
 * called and their resolved output is rendered - `await Page()` is what the
 * framework does, and it is the only way to render one from a test. The request
 * headers are stubbed for the same reason the root layout's test stubs them:
 * `headers()` needs a request, and there is not one here.
 */
let requestHeaders = new Headers();

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(requestHeaders) }));

beforeEach(() => {
  requestHeaders = new Headers();
});

async function renderPage(Page: () => Promise<React.ReactElement>): Promise<void> {
  render(await Page());
}

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

describe('the marketing route group', () => {
  /*
   * The root layout of this app declares robots noindex/nofollow, because the
   * staff EMR has no business in a search index and a chart URL certainly does
   * not. That default is fail-closed, so the public pages have to opt back in,
   * and this group layout is the single place that does it. Next merges
   * metadata field by field from the root down, so this replaces the root's
   * robots for everything under `(marketing)` and nothing else.
   */
  it('opts the public pages back into search indexes', () => {
    expect(marketingMetadata.robots).toEqual({ index: true, follow: true });
  });

  it('renders its children and adds no frame of its own', () => {
    render(<MarketingLayout>{<p>Content</p>}</MarketingLayout>);

    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });
});

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

  /*
   * The language comes off the request, in one pass, before the first byte. A
   * public page that arrived in English and swapped once JavaScript loaded
   * would have shown the wrong language to the person least able to read it.
   */
  it('renders in the language the browser asked for', async () => {
    requestHeaders = new Headers({ 'accept-language': 'es-MX,es;q=0.9,en;q=0.5' });

    await renderPage(Page);

    expect(
      screen.getByText(
        'openrunic es software de código abierto, no un dispositivo médico certificado.'
      )
    ).toBeInTheDocument();
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
