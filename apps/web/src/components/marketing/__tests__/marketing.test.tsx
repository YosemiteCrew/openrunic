import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { appCatalogue } from '@openrunic/i18n';
import { describe, expect, it, vi } from 'vitest';

import {
  CtaLink,
  Hero,
  Lockup,
  OFFSITE,
  OtherAudiences,
  PILLARS,
  PillarCard,
  PointList,
  PublicPage,
  Section,
  SiteFooter,
  SiteHeader,
  StatusNote,
} from '@/components/marketing';
import { otherPillars } from '@/components/marketing/links';

/* The real catalogue in the source language. These components render keys now,
   so an assertion about the words a visitor reads has to go through it -
   asserting on a key alone would pass against a key that resolves to nothing,
   which is exactly what `catalogue-drift.test.ts` exists to catch. */
const EN = appCatalogue.messages['en'] ?? {};

/* The public pages are server components with no router in a unit test, so
   next/link is stubbed down to the anchor it renders in the browser. */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('OFFSITE', () => {
  /*
   * These pages have exactly one failure mode a type-check cannot see: a link
   * that goes somewhere else. Every destination is off-site, so a relative
   * path, an http scheme or a stray host is a defect however plausible the
   * label beside it reads.
   */
  it.each(Object.entries(OFFSITE))('%s points at the project over https', (_name, url) => {
    expect(url).toMatch(/^https:\/\/github\.com\/YosemiteCrew\/openrunic(\/|$)/);
  });
});

describe('PILLARS', () => {
  it('names the three audiences the project is organised around', () => {
    expect(PILLARS.map((pillar) => EN[pillar.titleKey])).toEqual([
      'Hospitals and clinics',
      'Patients',
      'Developers',
    ]);
  });

  /*
   * A fourth pillar covering research data-sharing is planned and unbuilt. The
   * length assertion above is the guard: adding it to this list is how it would
   * reach the site, and it must not until it exists.
   */
  it('gives every pillar its own page', () => {
    const hrefs = PILLARS.map((pillar) => pillar.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('leaves out the pillar being read and keeps the other two in order', () => {
    expect(otherPillars('/for/patients').map((pillar) => EN[pillar.titleKey])).toEqual([
      'Hospitals and clinics',
      'Developers',
    ]);
  });

  it('leaves the whole set standing on a page that is not a pillar', () => {
    expect(otherPillars('/')).toHaveLength(3);
  });
});

describe('Lockup', () => {
  /*
   * The mark is a labelled box rather than an `<img>` so that one shipped file
   * can take espresso on the bone masthead and bone on the espresso footer,
   * which only a mask can do. What that must not cost is the mark's place in
   * the reading order, so these two pin the pair a screen reader actually uses:
   * the role, and the name. An `<img alt="openrunic">` would expose the same
   * two, and swapping to one would trade the band ink away for nothing.
   */
  it('is artwork with a name, not a decorative box', () => {
    render(<Lockup />);

    expect(screen.getByRole('img', { name: 'openrunic' })).toBeInTheDocument();
  });

  it('is drawn through the library mask rather than as its own image', () => {
    render(<Lockup />);

    expect(screen.getByRole('img', { name: 'openrunic' })).toHaveClass('or-logo--mask');
  });
});

describe('SiteHeader', () => {
  it('reaches home through the lockup and names where that goes', () => {
    render(<SiteHeader locale="en" />);

    expect(screen.getByRole('link', { name: 'openrunic home' })).toHaveAttribute('href', '/en');
  });

  /**
   * The masthead on a Spanish page has to point at Spanish pages, and read as
   * Spanish while doing it. These are prerendered one per language, so
   * `/for/hospitals` does not exist as an address any more, and a masthead that
   * kept linking there would bounce every reader through the redirect and back
   * into whichever language their browser asked for - discarding the one they
   * are visibly reading. Every element is found by its Spanish name, so the
   * same test now also refuses a masthead whose addresses follow the language
   * and whose words do not.
   */
  it('keeps every internal link inside the language being read', () => {
    render(<SiteHeader locale="es" />);
    const nav = screen.getByRole('navigation', { name: 'Sitio' });

    expect(screen.getByRole('link', { name: 'Inicio de openrunic' })).toHaveAttribute(
      'href',
      '/es'
    );
    expect(within(nav).getByRole('link', { name: 'Hospitales' })).toHaveAttribute(
      'href',
      '/es/for/hospitals'
    );
    // The repository link is off-site and keeps its absolute URL.
    expect(within(nav).getByRole('link', { name: 'Código fuente' }).getAttribute('href')).toMatch(
      /^https?:\/\//u
    );
  });

  it('offers the three audiences and the source', () => {
    render(<SiteHeader locale="en" />);
    const nav = screen.getByRole('navigation', { name: 'Site' });

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Hospitals', 'Patients', 'Developers', 'Source']);
  });

  it('marks the section being read, and marks only that one', () => {
    render(<SiteHeader active="/for/developers" locale="en" />);

    expect(screen.getByRole('link', { name: 'Developers' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Patients' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing when the page is not one of the sections', () => {
    render(<SiteHeader active="/" locale="en" />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });
});

describe('SiteFooter', () => {
  it('carries the compliance footnote', () => {
    render(<SiteFooter locale="en" />);

    expect(
      screen.getByText('openrunic is open-source software, not a certified medical device.')
    ).toBeInTheDocument();
  });

  it('names the licence rather than leaving it to be inferred', () => {
    render(<SiteFooter locale="en" />);

    expect(screen.getByRole('link', { name: 'Licence: AGPL-3.0-only' })).toHaveAttribute(
      'href',
      OFFSITE.licence
    );
  });

  it('groups its links into named navigation landmarks', () => {
    render(<SiteFooter locale="en" />);

    expect(screen.getAllByRole('navigation').map((nav) => nav.getAttribute('aria-label'))).toEqual([
      'Project',
      'Contribute',
      'Governance',
    ]);
  });
});

describe('PillarCard', () => {
  /* The real hospitals pillar rather than an invented one. The card renders
     catalogue keys now, so a fixture carrying made-up keys would assert that
     the card puts a key where a heading belongs. Every expectation below still
     goes through the catalogue or through the fixture's own length, so the copy
     can be rewritten without reds appearing here. */
  const pillar = PILLARS[0]!;

  it('titles the card at level 3, under the band that holds it', () => {
    render(<PillarCard pillar={pillar} locale="en" />);

    expect(
      screen.getByRole('heading', { level: 3, name: EN[pillar.titleKey] })
    ).toBeInTheDocument();
  });

  it('names its link for the audience rather than "read more"', () => {
    render(<PillarCard pillar={pillar} locale="en" />);

    expect(
      screen.getByRole('link', { name: /openrunic for hospitals and clinics/i })
    ).toHaveAttribute('href', '/en/for/hospitals');
  });

  /**
   * The same guarantee the masthead makes, and this card used to break.
   *
   * `Pillar.href` is the unprefixed `/for/hospitals`, which no page answers on:
   * `proxy.ts` redirects it to whatever the reader's cookie or `Accept-Language`
   * asks for. Rendering it raw meant a reader on `/es` who clicked a card was
   * bounced out of the language they were visibly reading and into the one their
   * browser had asked for, which is the failure `SiteHeader`'s own locale test
   * exists to refuse.
   *
   * Asserted against the literal address rather than against `pillar.href` with
   * a prefix built the same way the component builds it, because a test that
   * repeats the implementation cannot fail when the implementation is wrong -
   * which is exactly how the assertion above shipped pinning the bug.
   */
  it('keeps its link inside the language being read', () => {
    render(<PillarCard pillar={pillar} locale="es" />);

    expect(screen.getByRole('link', { name: /openrunic para hospitales/i })).toHaveAttribute(
      'href',
      '/es/for/hospitals'
    );
  });

  it('lists what that audience gets', () => {
    render(<PillarCard pillar={pillar} locale="en" />);

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(
      pillar.pointKeys.length
    );
  });

  /* The card is prerendered once per language, so the locale it is handed has
     to reach the words rather than only the addresses around them. */
  it('renders its copy in the language the page was built for', () => {
    render(<PillarCard pillar={pillar} locale="es" />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Hospitales y clínicas' })
    ).toBeInTheDocument();
  });
});

describe('PointList', () => {
  const point = {
    titleKey: 'marketing.home.foundations.audit.title',
    bodyKey: 'marketing.home.foundations.audit.body',
  };

  it('makes each point a heading, so a long band can be navigated by one', () => {
    render(<PointList points={[point]} locale="en" />);

    expect(screen.getByRole('heading', { level: 3, name: EN[point.titleKey] })).toBeInTheDocument();
    expect(screen.getByText(EN[point.bodyKey] ?? '')).toBeInTheDocument();
  });
});

describe('Section', () => {
  it('names its own region through the heading it already has', () => {
    render(
      <Section id="band" title="A band">
        <p>Content</p>
      </Section>
    );
    const region = screen.getByRole('region', { name: 'A band' });

    expect(within(region).getByRole('heading', { level: 2 })).toHaveAttribute('id', 'band');
  });

  it('paints bone unless asked for cream', () => {
    const { rerender } = render(
      <Section id="band" title="A band">
        <p>Content</p>
      </Section>
    );

    expect(screen.getByRole('region', { name: 'A band' })).toHaveClass('or-mk-section--bone');

    rerender(
      <Section id="band" title="A band" tone="cream">
        <p>Content</p>
      </Section>
    );

    expect(screen.getByRole('region', { name: 'A band' })).toHaveClass('or-mk-section--cream');
  });

  it('renders the lead only when there is one', () => {
    const { rerender } = render(
      <Section id="band" title="A band">
        <p>Content</p>
      </Section>
    );

    expect(screen.queryByText('The lead')).not.toBeInTheDocument();

    rerender(
      <Section id="band" title="A band" lead="The lead">
        <p>Content</p>
      </Section>
    );

    expect(screen.getByText('The lead')).toBeInTheDocument();
  });
});

describe('Hero', () => {
  it('puts the page heading at level 1 under its eyebrow', () => {
    render(<Hero eyebrow="For nobody" title="A heading" lead="A lead." />);

    expect(screen.getByRole('heading', { level: 1, name: 'A heading' })).toBeInTheDocument();
    expect(screen.getByText('For nobody')).toBeInTheDocument();
  });

  it('draws no action row and no note when it is given neither', () => {
    render(<Hero eyebrow="For nobody" title="A heading" lead="A lead." />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('renders the actions and the note it is given', () => {
    render(
      <Hero
        eyebrow="For nobody"
        title="A heading"
        lead="A lead."
        actions={<CtaLink href={OFFSITE.repo}>Read the source</CtaLink>}
      >
        <StatusNote label="Status">Pre-alpha.</StatusNote>
      </Hero>
    );

    expect(screen.getByRole('link', { name: 'Read the source' })).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveTextContent('Pre-alpha.');
  });
});

describe('CtaLink', () => {
  it('is an anchor, because every call to action here leaves the site', () => {
    render(<CtaLink href={OFFSITE.wiki}>Documentation</CtaLink>);

    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      OFFSITE.wiki
    );
  });

  it('draws the espresso outline unless it is asked to lead', () => {
    const { rerender } = render(<CtaLink href={OFFSITE.wiki}>Documentation</CtaLink>);

    expect(screen.getByRole('link')).toHaveClass('or-btn--secondary');

    rerender(
      <CtaLink href={OFFSITE.wiki} variant="primary">
        Documentation
      </CtaLink>
    );

    expect(screen.getByRole('link')).toHaveClass('or-btn--primary');
  });
});

describe('StatusNote', () => {
  it('labels the fact it carries, so the note is not an unexplained box', () => {
    render(<StatusNote label="Where the project is">Pre-alpha.</StatusNote>);

    expect(screen.getByText('Where the project is')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveTextContent('Pre-alpha.');
  });
});

describe('OtherAudiences', () => {
  it('offers the two audiences the page is not about', () => {
    render(<OtherAudiences current="/for/hospitals" locale="en" />);
    const region = screen.getByRole('region', { name: 'The other audiences' });

    expect(within(region).getAllByRole('article')).toHaveLength(2);
    expect(within(region).queryByRole('heading', { name: 'Hospitals and clinics' })).toBeNull();
  });

  it('takes the band tone from the page, so the alternation survives', () => {
    render(<OtherAudiences current="/for/developers" locale="en" tone="bone" />);

    expect(screen.getByRole('region', { name: 'The other audiences' })).toHaveClass(
      'or-mk-section--bone'
    );
  });
});

describe('PublicPage', () => {
  it('lands the root layout skip link on a focusable main landmark', () => {
    render(
      <PublicPage active="/" locale="en">
        <p>Content</p>
      </PublicPage>
    );
    const main = screen.getByRole('main');

    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('frames its content with the masthead and the closing band', () => {
    render(
      <PublicPage active="/for/patients" locale="en">
        <p>Content</p>
      </PublicPage>
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Patients' })).toHaveAttribute('aria-current', 'page');
  });
});
