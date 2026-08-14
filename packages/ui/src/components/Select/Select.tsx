import type { ChangeEvent, HTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH } from '../../lib/lucide';
import { useFieldId } from '../../lib/useFieldId';

/** The mirror draws the chevron at 17px, inset 12px from the right edge. */
const CHEVRON_SIZE = 17;

/** A choice whose stored value differs from the words on screen. */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  label?: string;
  /** Quiet helper text under the field. */
  hint?: string;
  /** Plain strings, or {value,label} pairs. */
  options?: Array<string | SelectOption>;
  value?: string;
  disabled?: boolean;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  /** Submitted field name. */
  name?: string;
  required?: boolean;
  /** Uncontrolled starting value; pass this instead of `value` when there is no state. */
  defaultValue?: string;
}

/**
 * Native select in brand chrome. Single choice from a known list; the platform menu is kept
 * because it is the one control every phone, screen reader and keyboard already agrees on.
 *
 * `className` and `style` dress the field wrapper; every other attribute lands on the
 * `<select>` itself.
 */
export function Select({
  label,
  hint,
  options = [],
  value,
  disabled = false,
  onChange,
  name,
  required,
  defaultValue,
  className,
  style,
  id,
  ...rest
}: SelectProps) {
  const fieldId = useFieldId(id);
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cx('or-select', disabled && 'or-select--disabled', className)} style={style}>
      {label ? (
        <label className="or-select__label" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <span className="or-select__shell">
        <select
          id={fieldId}
          className="or-select__control"
          value={value}
          defaultValue={defaultValue}
          name={name}
          required={required}
          disabled={disabled}
          onChange={onChange}
          aria-describedby={hint ? hintId : undefined}
          {...rest}
        >
          {options.map((option) =>
            typeof option === 'string' ? (
              <option key={option} value={option}>
                {option}
              </option>
            ) : (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            )
          )}
        </select>
        <ChevronDown
          className="or-select__chevron"
          size={CHEVRON_SIZE}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      </span>
      {hint ? (
        <p className="or-select__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
