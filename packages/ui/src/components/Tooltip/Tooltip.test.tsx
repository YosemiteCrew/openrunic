import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders the trigger with a closed bubble beside it', () => {
    render(
      <Tooltip label="Fasting glucose">
        <button type="button">2339-0</button>
      </Tooltip>
    );
    const bubble = screen.getByRole('tooltip');
    expect(bubble).toHaveTextContent('Fasting glucose');
    expect(bubble).toHaveClass('or-tooltip__bubble', 'or-tooltip__bubble--top');
    expect(bubble).not.toHaveClass('or-tooltip__bubble--open');
    expect(screen.getByRole('button', { name: '2339-0' })).toBeInTheDocument();
  });

  it('describes the trigger whether the bubble is drawn or not', () => {
    render(
      <Tooltip label="Fasting glucose">
        <button type="button">2339-0</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button', { name: '2339-0' });
    expect(trigger).toHaveAccessibleDescription('Fasting glucose');
    expect(trigger).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
  });

  it('keeps a description the trigger already had', () => {
    render(
      <Tooltip label="Fasting glucose">
        <button type="button" aria-describedby="range-hint">
          2339-0
        </button>
      </Tooltip>
    );
    const describedBy = screen.getByRole('button').getAttribute('aria-describedby');
    expect(describedBy).toContain('range-hint');
    expect(describedBy).toContain(screen.getByRole('tooltip').id);
  });

  it('opens on hover and closes again on leave', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Fasting glucose">
        <button type="button">2339-0</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button');

    await user.hover(trigger);
    expect(screen.getByRole('tooltip')).toHaveClass('or-tooltip__bubble--open');

    await user.unhover(trigger);
    expect(screen.getByRole('tooltip')).not.toHaveClass('or-tooltip__bubble--open');
  });

  it('opens on keyboard focus and closes on blur', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip label="Fasting glucose">
          <button type="button">2339-0</button>
        </Tooltip>
        <button type="button">Next</button>
      </>
    );

    await user.tab();
    expect(screen.getByRole('button', { name: '2339-0' })).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveClass('or-tooltip__bubble--open');

    await user.tab();
    expect(screen.getByRole('tooltip')).not.toHaveClass('or-tooltip__bubble--open');
  });

  it('closes on Escape without moving focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Fasting glucose">
        <button type="button">2339-0</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button');

    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveClass('or-tooltip__bubble--open');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('tooltip')).not.toHaveClass('or-tooltip__bubble--open');
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('tooltip')).not.toHaveClass('or-tooltip__bubble--open');
  });

  it.each([
    ['top', 'or-tooltip__bubble--top'],
    ['bottom', 'or-tooltip__bubble--bottom'],
    ['left', 'or-tooltip__bubble--left'],
    ['right', 'or-tooltip__bubble--right'],
  ] as const)('places the bubble on the %s side', (side, expected) => {
    render(
      <Tooltip label="Fasting glucose" side={side}>
        <button type="button">2339-0</button>
      </Tooltip>
    );
    expect(screen.getByRole('tooltip')).toHaveClass(expected);
  });

  it('still renders with a text trigger that cannot take the description', async () => {
    const user = userEvent.setup();
    const { container } = render(<Tooltip label="Fasting glucose">2339-0</Tooltip>);
    const wrapper = container.querySelector('.or-tooltip');

    expect(wrapper).toHaveTextContent('2339-0');
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await user.hover(wrapper as HTMLElement);
    expect(screen.getByRole('tooltip')).toHaveClass('or-tooltip__bubble--open');
  });

  it('renders without a trigger at all', () => {
    render(<Tooltip label="Fasting glucose" />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Fasting glucose');
  });

  it('calls the handlers the caller passed as well as its own', async () => {
    const user = userEvent.setup();
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <>
        <Tooltip
          label="Fasting glucose"
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        >
          <button type="button">2339-0</button>
        </Tooltip>
        <button type="button">Next</button>
      </>
    );
    const trigger = screen.getByRole('button', { name: '2339-0' });

    await user.hover(trigger);
    await user.unhover(trigger);
    await user.tab();
    await user.keyboard('{Escape}');
    await user.tab();

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('merges className and forwards native attributes', () => {
    const { container } = render(
      <Tooltip label="Fasting glucose" className="or-inline-help" id="glucose-code" tabIndex={0}>
        <span className="or-mono">2339-0</span>
      </Tooltip>
    );
    const wrapper = container.querySelector('.or-tooltip');
    expect(wrapper).toHaveClass('or-tooltip', 'or-inline-help');
    expect(wrapper).toHaveAttribute('id', 'glucose-code');
    expect(wrapper).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tooltip')).toHaveAttribute('id', 'glucose-code-tooltip');
  });
});
