import type { ChangeEvent, HTMLAttributes } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import { useFieldId } from '../../lib/useFieldId';
import type { IconSlug } from '../../types';

/** The mirror draws the leading icon at 17px and the error icon at 13px. */
const ICON_SIZE = 17;
const MESSAGE_ICON_SIZE = 13;

export interface InputProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  label?: string;
  /** Quiet helper text under the field. */
  hint?: string;
  /** Error message; replaces the hint and turns the field danger-red with an icon. */
  error?: string;
  /** Lucide icon slug shown inside the field. */
  iconLeft?: IconSlug;
  /** Trailing unit or affix, e.g. 'mmHg'. */
  suffix?: string;
  /** Render the value in Spline Sans Mono - FHIR IDs, codes, readouts. */
  mono?: boolean;
  placeholder?: string;
  value?: string;
  type?: string;
  disabled?: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Submitted field name. */
  name?: string;
  required?: boolean;
  readOnly?: boolean;
  /** Uncontrolled starting value; pass this instead of `value` when there is no state. */
  defaultValue?: string;
  autoComplete?: string;
}

/**
 * Single-line text field. White fill on bone - white is reserved for input fields and data
 * tables. Always labelled; an error states the fact, then the next action.
 *
 * The label is a real `<label for>` beside the control rather than a wrapper, and the hint or
 * error is wired through `aria-describedby`, so the message is announced as a description
 * instead of being swallowed into the field's accessible name.
 *
 * `className` and `style` dress the field wrapper; every other attribute lands on the
 * `<input>` itself, which is where `aria-label`, `maxLength` or `data-*` belong.
 */
export function Input({
  label,
  hint,
  error,
  iconLeft,
  suffix,
  mono = false,
  placeholder,
  value,
  type = 'text',
  disabled = false,
  onChange,
  name,
  required,
  readOnly,
  defaultValue,
  autoComplete,
  className,
  style,
  id,
  ...rest
}: InputProps) {
  const fieldId = useFieldId(id);
  const messageId = `${fieldId}-message`;
  const message = error ?? hint;
  const LeftIcon = iconLeft ? resolveLucideIcon(iconLeft) : undefined;

  return (
    <div
      className={cx(
        'or-input',
        error && 'or-input--error',
        disabled && 'or-input--disabled',
        className
      )}
      style={style}
    >
      {label ? (
        <label className="or-input__label" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <span className="or-input__shell">
        {LeftIcon ? (
          <LeftIcon
            className="or-input__icon"
            size={ICON_SIZE}
            strokeWidth={ICON_STROKE_WIDTH}
            aria-hidden="true"
          />
        ) : null}
        <input
          id={fieldId}
          className={cx('or-input__control', mono && 'or-input__control--mono')}
          type={type}
          placeholder={placeholder}
          value={value}
          defaultValue={defaultValue}
          name={name}
          required={required}
          readOnly={readOnly}
          autoComplete={autoComplete}
          disabled={disabled}
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          {...rest}
        />
        {suffix ? <span className="or-input__suffix">{suffix}</span> : null}
      </span>
      {message ? (
        <p className="or-input__message" id={messageId}>
          {error ? (
            <CircleAlert
              className="or-input__message-icon"
              size={MESSAGE_ICON_SIZE}
              strokeWidth={ICON_STROKE_WIDTH}
              aria-hidden="true"
            />
          ) : null}
          {message}
        </p>
      ) : null}
    </div>
  );
}
