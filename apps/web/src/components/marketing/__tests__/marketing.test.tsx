import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
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
import type { Pillar } from '@/components/marketing';
import { otherPillars } from '@/components/marketing/links';

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
    expect(PILLARS.map((pillar) => pillar.title)).toEqual([
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
    expect(otherPillars('/for/patients').map((pillar) => pillar.title)).toEqual([
      'Hospitals and clinics',
      'Developers',
    ]);
  });

  it('leaves the whole set standing on a page that is not a pillar', () => {
    expect(otherPillars('/')).toHaveLength(3);
  });
});

describe('Lockup', () => {
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
    render(<SiteHeader />);

    expect(screen.getByRole('link', { name: 'openrunic home' })).toHaveAttribute('href', '/');
  });

  it('offers the three audiences and the source', () => {
    render(<SiteHeader />);
    const nav = screen.getByRole('navigation', { name: 'Site' });

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Hospitals', 'Patients', 'Developers', 'Source']);
  });

  it('marks the section being read, and marks only that one', () => {
    render(<SiteHeader active="/for/developers" />);

    expect(screen.getByRole('link', { name: 'Developers' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Patients' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing when the page is not one of the sections', () => {
    render(<SiteHeader active="/" />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });
});

describe('SiteFooter', () => {
  it('carries the compliance footnote', () => {
    render(<SiteFooter />);

    expect(
      screen.getByText('openrunic is open-source software, not a certified medical device.')
    ).toBeInTheDocument();
  });

  it('names the licence rather than leaving it to be inferred', () => {
    render(<SiteFooter />);

    expect(screen.getByRole('link', { name: 'Licence: AGPL-3.0-only' })).toHaveAttribute(
      'href',
      OFFSITE.licence
    );
  });

  it('groups its links into named navigation landmarks', () => {
    render(<SiteFooter />);

    expect(screen.getAllByRole('navigation').map((nav) => nav.getAttribute('aria-label'))).toEqual([
      'Project',
      'Contribute',
      'Governance',
    ]);
  });
});

describe('PillarCard', () => {
  /* Its own pillar rather than one from PILLARS: the card is measured on its
     contract, so the real copy can be rewritten without reds appearing here. */
  const pillar: Pillar = {
    title: 'Hospitals and clinics',
    href: '/for/hospitals',
    summary: 'What this audience gets, in one line.',
    points: ['The first thing', 'The second thing'],
  };

  it('titles the card at level 3, under the band that holds it', () => {
    render(<PillarCard pillar={pillar} />);

    expect(screen.getByRole('heading', { level: 3, name: pillar.title })).toBeInTheDocument();
  });

  it('names its link for the audience rather than "read more"', () => {
    render(<PillarCard pillar={pillar} />);

    expect(
      screen.getByRole('link', { name: /openrunic for hospitals and clinics/i })
    ).toHaveAttribute('href', pillar.href);
  });

  it('lists what that audience gets', () => {
    render(<PillarCard pillar={pillar} />);

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(
      pillar.points.length
    );
  });
});

describe('PointList', () => {
  it('makes each point a heading, so a long band can be navigated by one', () => {
    render(<PointList points={[{ title: 'A decision', body: 'And the reason for it.' }]} />);

    expect(screen.getByRole('heading', { level: 3, name: 'A decision' })).toBeInTheDocument();
    expect(screen.getByText('And the reason for it.')).toBeInTheDocument();
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
    render(<OtherAudiences current="/for/hospitals" />);
    const region = screen.getByRole('region', { name: 'The other audiences' });

    expect(within(region).getAllByRole('article')).toHaveLength(2);
    expect(within(region).queryByRole('heading', { name: 'Hospitals and clinics' })).toBeNull();
  });

  it('takes the band tone from the page, so the alternation survives', () => {
    render(<OtherAudiences current="/for/developers" tone="bone" />);

    expect(screen.getByRole('region', { name: 'The other audiences' })).toHaveClass(
      'or-mk-section--bone'
    );
  });
});

describe('PublicPage', () => {
  it('lands the root layout skip link on a focusable main landmark', () => {
    render(
      <PublicPage active="/">
        <p>Content</p>
      </PublicPage>
    );
    const main = screen.getByRole('main');

    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('frames its content with the masthead and the closing band', () => {
    render(
      <PublicPage active="/for/patients">
        <p>Content</p>
      </PublicPage>
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Patients' })).toHaveAttribute('aria-current', 'page');
  });
});
