import type { ChangeEvent, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';

export interface RadioProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  label?: ReactNode;
  /** Quiet helper text under the label. */
  hint?: string;
  checked?: boolean;
  /** Radios sharing a name form one group; the browser then handles arrow-key roving. */
  name?: string;
  disabled?: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Submitted value when this choice is the selected one. */
  value?: string;
  /** Uncontrolled starting state; pass this instead of `checked` when there is no state. */
  defaultChecked?: boolean;
}

/**
 * One choice from a small set, two to five options; group them by sharing a `name`.
 *
 * The real `<input type="radio">` stays in the accessibility tree, so arrow-key roving,
 * group semantics and form submission all come from the platform. The painted ring beside
 * it is `aria-hidden` decoration.
 *
 * `className` and `style` dress the row; every other attribute lands on the input.
 */
export function Radio({
  label,
  hint,
  checked,
  name,
  disabled = false,
  onChange,
  value,
  defaultChecked,
  className,
  style,
  id,
  ...rest
}: RadioProps) {
  const fieldId = useFieldId(id);
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cx('or-radio', disabled && 'or-radio--disabled', className)} style={style}>
      <input
        id={fieldId}
        type="radio"
        className="or-radio__input"
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        name={name}
        value={value}
        onChange={onChange}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      <span className="or-radio__box" aria-hidden="true">
        <span className="or-radio__dot" />
      </span>
      {label ? (
        <label className="or-radio__label" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      {hint ? (
        <p className="or-radio__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
