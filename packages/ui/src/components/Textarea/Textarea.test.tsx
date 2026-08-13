import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from './Textarea';

/* jsdom does no layout, so every element reports scrollHeight 0. Standing a height in on
   the prototype is what makes the auto-grow assertion mean anything. */
function stubScrollHeight(px: number): () => void {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => px,
  });
  return () => {
    Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight');
  };
}

/** Minimal controlled host: the counter has to follow the value the parent owns. */
function ControlledNote() {
  const [note, setNote] = useState('');
  return (
    <Textarea
      label="Visit note"
      maxLength={40}
      value={note}
      onChange={(event) => setNote(event.target.value)}
    />
  );
}

describe('Textarea', () => {
  it('renders a labelled multi-line field wired to its own label', () => {
    render(<Textarea label="Visit note" placeholder="What happened, and what happens next." />);
    const field = screen.getByRole('textbox', { name: 'Visit note' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('placeholder', 'What happened, and what happens next.');
    expect(field).toHaveClass('or-textarea__control');
    expect(screen.getByText('Visit note')).toHaveAttribute('for', field.id);
  });

  it('renders without a label when none is given', () => {
    const { container } = render(<Textarea aria-label="Visit note" />);
    expect(container.querySelector('.or-textarea__label')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Visit note' })).toBeInTheDocument();
  });

  it('describes the field with its hint', () => {
    render(<Textarea label="Visit note" hint="Seen by Dr. Amara Okafor." />);
    const field = screen.getByRole('textbox', { name: 'Visit note' });
    expect(field).toHaveAccessibleDescription('Seen by Dr. Amara Okafor.');
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('replaces the hint with the error, marks the field invalid and shows an icon', () => {
    const { container } = render(
      <Textarea
        label="Visit note"
        hint="Seen by Dr. Amara Okafor."
        error="Add a reason for the visit before saving."
      />
    );
    const field = screen.getByRole('textbox', { name: 'Visit note' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Add a reason for the visit before saving.');
    expect(screen.queryByText('Seen by Dr. Amara Okafor.')).not.toBeInTheDocument();
    expect(container.querySelector('.or-textarea')).toHaveClass('or-textarea--error');
    expect(container.querySelector('.or-textarea__message-icon')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('renders the message without an icon when it is only a hint', () => {
    const { container } = render(<Textarea label="Visit note" hint="Seen 12 Aug 2026." />);
    expect(container.querySelector('.or-textarea__message-icon')).toBeNull();
  });

  it('renders no message node when there is neither hint nor error', () => {
    const { container } = render(<Textarea label="Visit note" />);
    expect(container.querySelector('.or-textarea__footer')).toBeNull();
    expect(container.querySelector('.or-textarea__message')).toBeNull();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });

  it('starts at three rows and honours a caller row count', () => {
    const { rerender } = render(<Textarea label="Visit note" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '3');
    rerender(<Textarea label="Visit note" rows={8} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '8');
  });

  it('counts characters only once a limit is set', () => {
    const { container, rerender } = render(<Textarea label="Visit note" />);
    expect(container.querySelector('.or-textarea__counter')).toBeNull();
    rerender(<Textarea label="Visit note" maxLength={240} />);
    const counter = container.querySelector('.or-textarea__counter');
    expect(counter).toHaveTextContent('0 / 240');
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '240');
    // Announcing on every keystroke would talk over the typing it is describing.
    expect(counter).not.toHaveAttribute('aria-live');
  });

  it('counts up from an uncontrolled starting value as the user types', async () => {
    const { container } = render(
      <Textarea label="Visit note" maxLength={40} defaultValue="Chest" />
    );
    const counter = container.querySelector('.or-textarea__counter');
    expect(counter).toHaveTextContent('5 / 40');

    await userEvent.type(screen.getByRole('textbox'), ' pain');
    expect(counter).toHaveTextContent('10 / 40');
  });

  it('counts up from the value the parent owns', async () => {
    const { container } = render(<ControlledNote />);
    const counter = container.querySelector('.or-textarea__counter');
    expect(counter).toHaveTextContent('0 / 40');

    await userEvent.type(screen.getByRole('textbox'), 'Chest pain');
    expect(counter).toHaveTextContent('10 / 40');
    expect(screen.getByRole('textbox')).toHaveValue('Chest pain');
  });

  it('marks the counter when the limit is reached', async () => {
    const { container } = render(<Textarea label="Reason" maxLength={4} />);
    const counter = container.querySelector('.or-textarea__counter');
    expect(counter).not.toHaveClass('or-textarea__counter--near');

    await userEvent.type(screen.getByRole('textbox'), 'Pain');
    expect(counter).toHaveTextContent('4 / 4');
    expect(counter).toHaveClass('or-textarea__counter--near');
  });

  it('adds the counter to the field description alongside the hint', () => {
    render(<Textarea id="note" label="Visit note" hint="Synthetic record." maxLength={240} />);
    const field = screen.getByRole('textbox', { name: 'Visit note' });
    expect(field).toHaveAttribute('aria-describedby', 'note-message note-counter');
    expect(field).toHaveAccessibleDescription(/^Synthetic record\.\s+0 \/ 240$/);
  });

  it('grows to fit its content when autoGrow is set', () => {
    const restore = stubScrollHeight(96);
    try {
      const { container } = render(
        <Textarea label="Visit note" autoGrow defaultValue="Chest pain, sitting, right arm." />
      );
      expect(container.querySelector('.or-textarea')).toHaveClass('or-textarea--grow');
      expect(screen.getByRole('textbox')).toHaveStyle({ height: '96px' });
    } finally {
      restore();
    }
  });

  it('keeps the rows height when the layout reports no content height', () => {
    render(<Textarea label="Visit note" autoGrow rows={4} />);
    const field = screen.getByRole('textbox');
    expect(field).toHaveAttribute('rows', '4');
    expect(field.style.height).toBe('');
  });

  it('leaves the height alone, then clears it, when auto-grow is off', () => {
    const restore = stubScrollHeight(96);
    try {
      const { container, rerender } = render(<Textarea label="Visit note" />);
      const field = screen.getByRole('textbox');
      expect(field.style.height).toBe('');
      expect(container.querySelector('.or-textarea')).not.toHaveClass('or-textarea--grow');

      rerender(<Textarea label="Visit note" autoGrow />);
      expect(field.style.height).toBe('96px');

      rerender(<Textarea label="Visit note" />);
      expect(field.style.height).toBe('');
    } finally {
      restore();
    }
  });

  it('switches the value to mono only when asked', () => {
    const { rerender } = render(<Textarea label="Resource" />);
    expect(screen.getByRole('textbox')).not.toHaveClass('or-textarea__control--mono');
    rerender(<Textarea label="Resource" mono />);
    expect(screen.getByRole('textbox')).toHaveClass('or-textarea__control--mono');
  });

  it('honours name, required and an uncontrolled value', () => {
    render(<Textarea label="Visit note" name="note" required defaultValue="Glucose 7.4 mmol/L." />);
    const field = screen.getByRole('textbox', { name: 'Visit note' });
    expect(field).toHaveAttribute('name', 'note');
    expect(field).toBeRequired();
    expect(field).toHaveValue('Glucose 7.4 mmol/L.');
  });

  it('disables the field and blocks typing', async () => {
    const onChange = vi.fn();
    const { container } = render(<Textarea label="Visit note" disabled onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Visit note' });
    expect(field).toBeDisabled();
    expect(container.querySelector('.or-textarea')).toHaveClass('or-textarea--disabled');

    await userEvent.type(field, 'Chest pain');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a readOnly value at full strength and refuses edits', async () => {
    const onChange = vi.fn();
    render(
      <Textarea
        label="Medical record number"
        readOnly
        mono
        defaultValue="OR-100482"
        onChange={onChange}
      />
    );
    const field = screen.getByRole('textbox', { name: 'Medical record number' });
    expect(field).toHaveAttribute('readonly');
    expect(field).not.toBeDisabled();

    await userEvent.type(field, 'OR-999999');
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue('OR-100482');
  });

  it('takes focus from the keyboard and reports every keystroke', async () => {
    const onChange = vi.fn();
    render(<Textarea label="Visit note" value="" onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Visit note' });

    await userEvent.tab();
    expect(field).toHaveFocus();

    await userEvent.keyboard('Pain');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(<Textarea label="Visit note" className="or-visit-note" />);
    expect(container.querySelector('.or-textarea')).toHaveClass('or-textarea', 'or-visit-note');
  });

  it('uses a caller-supplied id for the label association', () => {
    render(<Textarea id="visit-note" label="Visit note" hint="Seen 12 Aug 2026." />);
    const field = screen.getByRole('textbox', { name: 'Visit note' });
    expect(field).toHaveAttribute('id', 'visit-note');
    expect(field).toHaveAttribute('aria-describedby', 'visit-note-message');
  });
});
