import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { brandAssetCssUrl } from '../../assets/brand';
import { Footer } from './Footer';
import type { FooterColumn } from './Footer';

const NOTE = 'The open-source operating system for human health.';

const COLUMNS: FooterColumn[] = [
  { title: 'Product', links: ['Records', 'Care team', 'Consent'] },
  { title: 'Open source', links: ['GitHub', 'Licence'] },
];

describe('Footer', () => {
  it('renders a contentinfo band with the lockup, the note and every column', () => {
    render(<Footer columns={COLUMNS} note={NOTE} />);

    const band = screen.getByRole('contentinfo');
    expect(band).toHaveClass('or-footer');
    expect(screen.getByRole('img', { name: 'openrunic' })).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toHaveClass('or-footer__note');

    const product = screen.getByRole('navigation', { name: 'Product' });
    const links = within(product).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Records', 'Care team', 'Consent']);
    expect(screen.getByRole('navigation', { name: 'Open source' })).toBeInTheDocument();
  });

  it('sets an overline on each column title and a distinct encoded fragment on each link', () => {
    render(<Footer columns={COLUMNS} />);

    expect(screen.getByText('Open source')).toHaveClass('or-overline', 'or-footer__column-title');
    expect(screen.getByRole('link', { name: 'Care team' })).toHaveAttribute('href', '#Care%20team');
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', '#GitHub');
  });

  it('omits the note and the sibling rule when neither is supplied', () => {
    const { container } = render(<Footer columns={COLUMNS} />);
    expect(container.querySelector('.or-footer__note')).toBeNull();
    expect(container.querySelector('.or-footer__sibling')).toBeNull();
  });

  it('renders the sibling note below a hairline rule', () => {
    const { container } = render(
      <Footer
        columns={COLUMNS}
        siblingNote={
          <>
            AGPL-3.0 - Sibling project: <b>Yosemite Crew</b>, for animal health.
          </>
        }
      />
    );
    expect(container.querySelector('.or-footer__sibling')).toHaveTextContent(
      'AGPL-3.0 - Sibling project: Yosemite Crew, for animal health.'
    );
  });

  it('renders the band with no columns at all', () => {
    render(<Footer note="Self-hosted or managed. No telemetry by default." />);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.queryAllByRole('navigation')).toHaveLength(0);
  });

  it('masks the bundled lockup by default and honours a caller asset directory', () => {
    const { container, rerender } = render(<Footer columns={COLUMNS} />);
    const read = () =>
      container
        .querySelector<HTMLElement>('.or-footer__logo')
        ?.style.getPropertyValue('--or-footer-logo-src');

    expect(read()).toBe(brandAssetCssUrl('lockup-horizontal.svg'));
    expect(read()).toContain('data:image/svg+xml');

    rerender(<Footer columns={COLUMNS} logoBasePath="/brand/open runic" />);
    expect(read()).toBe('url("/brand/open%20runic/lockup-horizontal.svg")');
  });

  it('merges className and forwards native attributes', () => {
    render(<Footer columns={COLUMNS} className="or-docs-footer" id="site-footer" />);
    const band = screen.getByRole('contentinfo');
    expect(band).toHaveClass('or-footer', 'or-docs-footer');
    expect(band).toHaveAttribute('id', 'site-footer');
  });
});
