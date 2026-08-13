import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';
import { DescriptionList } from './DescriptionList';
import type { DescriptionListItem } from './DescriptionList';

const items: DescriptionListItem[] = [
  { term: 'Name', value: 'Testina Patientsson' },
  { term: 'Medical record number', value: 'OR-100482', mono: true },
  { term: 'Date of birth', value: '04 Mar 1988' },
  { term: 'Latest glucose', value: '7.4 mmol/L', numeric: true },
];

describe('DescriptionList', () => {
  it('renders every pair as a term and a value inside one wrapper', () => {
    const { container } = render(<DescriptionList items={items} />);
    const list = container.querySelector('dl');
    expect(list).toHaveClass('or-description-list');

    const pairs = container.querySelectorAll('.or-description-list__pair');
    expect(pairs).toHaveLength(4);
    for (const pair of pairs) {
      expect(pair.tagName).toBe('DIV');
      expect(pair.children[0]?.tagName).toBe('DT');
      expect(pair.children[1]?.tagName).toBe('DD');
    }

    expect(screen.getByText('Medical record number')).toHaveClass('or-description-list__term');
    expect(screen.getByText('OR-100482')).toHaveClass('or-description-list__value');
  });

  it('renders a node value such as a status badge', () => {
    render(
      <DescriptionList
        items={[{ term: 'Latest glucose', value: <Badge tone="danger">Above range</Badge> }]}
      />
    );
    const badge = screen.getByText('Above range');
    expect(badge).toHaveClass('or-badge', 'or-badge--danger');
    expect(badge.closest('dd')).toHaveClass('or-description-list__value');
  });

  it('sets identifier values in mono and leaves the term alone', () => {
    render(<DescriptionList items={items} />);
    expect(screen.getByText('OR-100482')).toHaveClass('or-description-list__value--mono');
    expect(screen.getByText('Medical record number')).not.toHaveClass(
      'or-description-list__value--mono'
    );
  });

  it('gives a measurement tabular figures and leaves plain values alone', () => {
    render(<DescriptionList items={items} />);
    expect(screen.getByText('7.4 mmol/L')).toHaveClass('or-description-list__value--numeric');
    const plain = screen.getByText('Testina Patientsson');
    expect(plain).not.toHaveClass('or-description-list__value--numeric');
    expect(plain).not.toHaveClass('or-description-list__value--mono');
  });

  it('names the list with its caption', () => {
    const { container } = render(<DescriptionList caption="Patient header" items={items} />);
    const caption = screen.getByText('Patient header');
    expect(caption).toHaveClass('or-description-list__caption');
    expect(container.querySelector('dl')).toHaveAttribute('aria-labelledby', caption.id);
    expect(caption.id).not.toBe('');
  });

  it('leaves the list unnamed when there is no caption', () => {
    const { container } = render(<DescriptionList items={items} />);
    expect(container.querySelector('.or-description-list__caption')).toBeNull();
    expect(container.querySelector('dl')).not.toHaveAttribute('aria-labelledby');
  });

  it('keeps two lists on one page from sharing a caption id', () => {
    const { container } = render(
      <>
        <DescriptionList caption="Patient header" items={items} />
        <DescriptionList caption="Document metadata" items={items} />
      </>
    );
    const [first, second] = Array.from(container.querySelectorAll('dl'));
    expect(first?.getAttribute('aria-labelledby')).not.toBe(
      second?.getAttribute('aria-labelledby')
    );
  });

  it('renders repeated terms without colliding on their keys', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <DescriptionList
        items={[
          { term: 'Identifier', value: 'OR-100482', mono: true },
          { term: 'Identifier', value: 'Patient/9c1f4a02', mono: true },
          { term: 'Identifier', value: 'Observation/8867-4', mono: true },
        ]}
      />
    );

    expect(screen.getAllByText('Identifier')).toHaveLength(3);
    expect(screen.getByText('Patient/9c1f4a02')).toBeInTheDocument();
    // A duplicate React key is reported here and nowhere else.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('renders an empty list for an empty items array and for none at all', () => {
    const { container, rerender } = render(<DescriptionList items={[]} />);
    expect(container.querySelector('dl')).toBeEmptyDOMElement();

    rerender(<DescriptionList />);
    expect(container.querySelector('dl')).toBeEmptyDOMElement();
    expect(container.querySelectorAll('.or-description-list__pair')).toHaveLength(0);
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(<DescriptionList className="or-record__header" items={items} />);
    expect(container.querySelector('dl')).toHaveClass('or-description-list', 'or-record__header');
  });

  it('honours a caller-supplied id and builds the caption id from it', () => {
    const { container } = render(
      <DescriptionList caption="Patient header" id="patient-header" items={items} />
    );
    expect(container.querySelector('dl')).toHaveAttribute('id', 'patient-header');
    expect(screen.getByText('Patient header')).toHaveAttribute('id', 'patient-header-caption');
  });

  it('forwards native attributes to the list itself', () => {
    render(<DescriptionList data-testid="header" items={items} lang="en-GB" />);
    const list = screen.getByTestId('header');
    expect(list.tagName).toBe('DL');
    expect(list).toHaveAttribute('lang', 'en-GB');
  });
});
