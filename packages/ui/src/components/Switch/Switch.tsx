import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';

export interface SwitchProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  label?: ReactNode;
  /** Quiet helper text under the label. */
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  /** Fired on every flip. The setting applies immediately; there is nothing to submit. */
  onChange?: () => void;
}

/**
 * Immediate-effect setting toggle, not a form field awaiting submit.
 *
 * A `<button role="switch">` rather than a checkbox, because the change is the action: it
 * takes effect on the flip. The label is a plain span tied to the button through
 * `aria-labelledby`, since an HTML `<label>` can only name a form control, never a button.
 *
 * `className` and `style` dress the row; every other attribute lands on the button.
 */
export function Switch({
  label,
  hint,
  checked = false,
  disabled = false,
  onChange,
  className,
  style,
  id,
  ...rest
}: SwitchProps) {
  const fieldId = useFieldId(id);
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cx('or-switch', disabled && 'or-switch--disabled', className)} style={style}>
      <span className="or-switch__text">
        {label ? (
          <span className="or-switch__label" id={labelId}>
            {label}
          </span>
        ) : null}
        {hint ? (
          <span className="or-switch__hint" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
      <button
        id={fieldId}
        type="button"
        role="switch"
        className="or-switch__control"
        aria-checked={checked}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={onChange}
        {...rest}
      >
        <span className="or-switch__thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
