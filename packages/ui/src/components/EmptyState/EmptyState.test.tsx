import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('states the fact as a heading and the next action as prose', () => {
    const { container } = render(
      <EmptyState
        title="No records yet"
        message="Connect a clinic or upload a document and it will appear here."
      />
    );
    expect(container.firstElementChild).toHaveClass('or-empty-state');
    expect(screen.getByRole('heading', { level: 3, name: 'No records yet' })).toHaveClass('or-h3');
    expect(
      screen.getByText('Connect a clinic or upload a document and it will appear here.')
    ).toHaveClass('or-body', 'or-empty-state__message');
  });

  it('omits the message when there is nothing more to say', () => {
    const { container } = render(<EmptyState title="No one has access to your records" />);
    expect(container.querySelector('.or-empty-state__message')).toBeNull();
  });

  it('falls back to the brand glyph, masked from the default path and hidden from AT', () => {
    const { container } = render(<EmptyState title="No records yet" />);
    const glyph = container.querySelector('.or-empty-state__glyph');
    expect(glyph).toBeInTheDocument();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph?.getAttribute('style')).toContain("url('assets/logo/glyph.svg')");
  });

  it('serves the glyph from a caller-supplied base path', () => {
    const { container } = render(<EmptyState title="No records yet" glyphBasePath="/brand" />);
    const glyph = container.querySelector('.or-empty-state__glyph');
    expect(glyph?.getAttribute('style')).toContain("url('/brand/glyph.svg')");
  });

  it('renders a Lucide icon instead of the glyph when a slug is given', () => {
    const { container } = render(<EmptyState icon="file-text" title="No documents" />);
    const icon = container.querySelector('.or-empty-state__icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.or-empty-state__glyph')).toBeNull();
  });

  it('degrades an unknown icon slug to the glyph rather than crashing', () => {
    const { container } = render(<EmptyState icon="not-a-real-icon" title="No documents" />);
    expect(container.querySelector('.or-empty-state__icon')).toBeNull();
    expect(container.querySelector('.or-empty-state__glyph')).toBeInTheDocument();
  });

  it('renders a single action below the copy', () => {
    render(
      <EmptyState title="No records yet" action={<button type="button">Connect a clinic</button>} />
    );
    const action = screen.getByRole('button', { name: 'Connect a clinic' });
    expect(action.closest('.or-empty-state__action')).toBeInTheDocument();
  });

  it('omits the action wrapper when there is no action', () => {
    const { container } = render(<EmptyState title="No records yet" />);
    expect(container.querySelector('.or-empty-state__action')).toBeNull();
  });

  it('merges className and forwards native attributes', () => {
    render(
      <EmptyState
        className="or-records-empty"
        data-testid="records-empty"
        id="records-empty"
        title="No records yet"
      />
    );
    const panel = screen.getByTestId('records-empty');
    expect(panel).toHaveClass('or-empty-state', 'or-records-empty');
    expect(panel).toHaveAttribute('id', 'records-empty');
  });
});
