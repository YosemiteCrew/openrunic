import type { ChangeEvent, HTMLAttributes } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH } from '../../lib/lucide';
import { useFieldId } from '../../lib/useFieldId';

/** The mirror draws the error icon at 13px, the same size Input gives it. */
const MESSAGE_ICON_SIZE = 13;

export interface TextareaProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  /** Field label. Always give one, or an `aria-label` in its place. */
  label?: string;
  /** Quiet helper text under the field. */
  hint?: string;
  /** Error message; replaces the hint and turns the field danger-red with an icon. */
  error?: string;
  /** Starting height in lines. Auto-grow treats it as the floor, never the ceiling. */
  rows?: number;
  /** Character ceiling. Setting it also renders the live counter under the field. */
  maxLength?: number;
  /** Grow with the content instead of scrolling; the manual resize handle is dropped. */
  autoGrow?: boolean;
  /** Render the value in Spline Sans Mono - FHIR IDs, codes, readouts. */
  mono?: boolean;
  /** Placeholder text. It is a hint of format, not a replacement for the label. */
  placeholder?: string;
  /** Controlled value. Pair it with `onChange`; the counter follows it. */
  value?: string;
  /** Uncontrolled starting value; pass this instead of `value` when there is no state. */
  defaultValue?: string;
  /** Dims the field to 0.42 and stops every event. */
  disabled?: boolean;
  /** Shows the value at full strength but refuses edits. */
  readOnly?: boolean;
  /** Marks the field required for the form and for assistive technology. */
  required?: boolean;
  /** Submitted field name. */
  name?: string;
  /** Fires on every keystroke the field accepts. */
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}

/**
 * Multi-line text field, and Input's sibling: the same white fill on bone, the same label,
 * hint and error vocabulary, plus a character counter and an optional auto-grow.
 *
 * The counter is wired into `aria-describedby` beside the hint or the error, so the limit is
 * part of the field's description rather than an announcement on every keystroke. It follows
 * a `value` the caller owns and an uncontrolled `defaultValue` alike.
 *
 * `className` and `style` dress the field wrapper; every other attribute lands on the
 * `<textarea>` itself, which is where `aria-label` or `data-*` belong.
 */
export function Textarea({
  label,
  hint,
  error,
  rows = 3,
  maxLength,
  autoGrow = false,
  mono = false,
  placeholder,
  value,
  defaultValue,
  disabled = false,
  readOnly,
  required,
  name,
  onChange,
  className,
  style,
  id,
  ...rest
}: TextareaProps) {
  const fieldId = useFieldId(id);
  const messageId = `${fieldId}-message`;
  const counterId = `${fieldId}-counter`;
  const message = error ?? hint;
  const showCounter = maxLength !== undefined;
  const controlRef = useRef<HTMLTextAreaElement>(null);

  /* The typed length, which doubles as the auto-grow trigger: an uncontrolled field
     re-renders on nothing else. A `value` the caller owns always wins over it. */
  const [typedCount, setTypedCount] = useState(defaultValue?.length ?? 0);
  const count = value?.length ?? typedCount;
  const atLimit = maxLength !== undefined && count >= maxLength;

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setTypedCount(event.target.value.length);
    onChange?.(event);
  };

  /* Height is written straight onto the element rather than held in state: it is a
     measurement of the DOM, and a layout effect lands it before the browser paints, so the
     field never flashes at the wrong height. */
  useLayoutEffect(() => {
    const control = controlRef.current;
    if (!autoGrow || !control) return;
    /* Reset first: a shrinking value has to be measured against its natural height, not
       against the taller one left behind by the previous keystroke. */
    control.style.height = 'auto';
    /* jsdom does no layout, so scrollHeight is 0 there. Leaving the height unset in that
       case keeps `rows` in charge instead of collapsing the field to nothing. */
    control.style.height = control.scrollHeight > 0 ? `${control.scrollHeight}px` : '';
    /* Handing the height back on the way out is what lets `autoGrow` be turned off again:
       without it the last measured height would stick as an inline override. */
    return () => {
      control.style.height = '';
    };
  }, [autoGrow, count, value]);

  const describedBy = cx(message && messageId, showCounter && counterId) || undefined;

  return (
    <div
      className={cx(
        'or-textarea',
        error && 'or-textarea--error',
        disabled && 'or-textarea--disabled',
        autoGrow && 'or-textarea--grow',
        className
      )}
      style={style}
    >
      {label ? (
        <label className="or-textarea__label" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <span className="or-textarea__shell">
        <textarea
          ref={controlRef}
          id={fieldId}
          className={cx('or-textarea__control', mono && 'or-textarea__control--mono')}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          defaultValue={defaultValue}
          name={name}
          required={required}
          readOnly={readOnly}
          disabled={disabled}
          onChange={handleChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      </span>
      {message || showCounter ? (
        <div className="or-textarea__footer">
          {message ? (
            <p className="or-textarea__message" id={messageId}>
              {error ? (
                <CircleAlert
                  className="or-textarea__message-icon"
                  size={MESSAGE_ICON_SIZE}
                  strokeWidth={ICON_STROKE_WIDTH}
                  aria-hidden="true"
                />
              ) : null}
              {message}
            </p>
          ) : null}
          {showCounter ? (
            <p
              className={cx('or-textarea__counter', atLimit && 'or-textarea__counter--near')}
              id={counterId}
            >
              {count} / {maxLength}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
