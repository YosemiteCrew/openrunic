import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useFieldId } from './useFieldId';

function Field({ id }: { id?: string }) {
  const fieldId = useFieldId(id);
  return (
    <>
      <label htmlFor={fieldId}>Medical record number</label>
      <input id={fieldId} defaultValue="OR-100482" />
    </>
  );
}

describe('useFieldId', () => {
  it('generates an id that ties the label to the control', () => {
    render(<Field />);
    const input = screen.getByLabelText('Medical record number');
    expect(input.id).toBeTruthy();
  });

  it('uses the caller-supplied id verbatim', () => {
    render(<Field id="mrn" />);
    expect(screen.getByLabelText('Medical record number')).toHaveAttribute('id', 'mrn');
  });

  it('gives each instance its own generated id', () => {
    render(
      <>
        <Field />
        <Field />
      </>
    );
    const [first, second] = screen.getAllByLabelText('Medical record number');
    expect(first?.id).not.toBe(second?.id);
  });
});
