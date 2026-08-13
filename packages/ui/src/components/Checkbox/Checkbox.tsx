import type { ChangeEvent, HTMLAttributes, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH } from '../../lib/lucide';
import { useFieldId } from '../../lib/useFieldId';

/** The mirror draws the tick at 13px inside an 18px box. */
const CHECK_SIZE = 13;

export interface CheckboxProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  label?: ReactNode;
  /** Quiet helper text under the label. */
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Submitted field name; share it across a set of related boxes. */
  name?: string;
  /** Submitted value when the box is ticked. */
  value?: string;
  /** Uncontrolled starting state; pass this instead of `checked` when there is no state. */
  defaultChecked?: boolean;
}

/**
 * Multi-select control, and the shape consent rows take. Controlled: pass `checked` and
 * `onChange`.
 *
 * The real `<input type="checkbox">` stays in the accessibility tree and keeps every native
 * keyboard behaviour; it is visually hidden and the painted box beside it is `aria-hidden`,
 * so the tick is a picture of the checkbox rather than a replacement for it.
 *
 * `className` and `style` dress the row; every other attribute lands on the input.
 */
export function Checkbox({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
  name,
  value,
  defaultChecked,
  className,
  style,
  id,
  ...rest
}: CheckboxProps) {
  const fieldId = useFieldId(id);
  const hintId = `${fieldId}-hint`;

  return (
    <div
      className={cx('or-checkbox', disabled && 'or-checkbox--disabled', className)}
      style={style}
    >
      <input
        id={fieldId}
        type="checkbox"
        className="or-checkbox__input"
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        name={name}
        value={value}
        onChange={onChange}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      <span className="or-checkbox__box" aria-hidden="true">
        <Check className="or-checkbox__check" size={CHECK_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
      </span>
      {label ? (
        <label className="or-checkbox__label" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      {hint ? (
        <p className="or-checkbox__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
