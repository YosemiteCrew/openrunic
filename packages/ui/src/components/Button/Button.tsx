import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { ButtonVariant, IconSlug, Size } from '../../types';

const ICON_SIZE: Record<Size, number> = { sm: 15, md: 18, lg: 18 };

export interface ButtonProps extends HTMLAttributes<HTMLElement> {
  /**
   * primary = terracotta-deep fill; secondary = espresso outline; ghost = cream wash on
   * hover; inverse = bone fill on espresso bands; danger = warm red, destructive only.
   */
  variant?: ButtonVariant;
  size?: Size;
  /** Lucide icon slug rendered before the label. */
  iconLeft?: IconSlug;
  /** Lucide icon slug rendered after the label. */
  iconRight?: IconSlug;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Renders an anchor instead of a button. */
  href?: string;
  /** Anchor target, honoured only alongside `href`. */
  target?: string;
  /** Anchor rel, honoured only alongside `href`. */
  rel?: string;
  /** Ignored when `href` is set. Defaults to 'button' so a button never submits by surprise. */
  type?: 'button' | 'submit' | 'reset';
  name?: string;
  value?: string;
  form?: string;
  children?: ReactNode;
}

/**
 * The action control. One `primary` per view; `danger` plus an explicit confirmation for
 * destructive work, never terracotta. Renders an `<a>` when `href` is set and a `<button>`
 * otherwise, so the element always matches what the control actually does.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  fullWidth = false,
  href,
  target,
  rel,
  type = 'button',
  name,
  value,
  form,
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const classes = cx(
    'or-btn',
    `or-btn--${variant}`,
    `or-btn--${size}`,
    fullWidth && 'or-btn--full',
    className
  );
  const iconSize = ICON_SIZE[size];
  const LeftIcon = iconLeft ? resolveLucideIcon(iconLeft) : undefined;
  const RightIcon = iconRight ? resolveLucideIcon(iconRight) : undefined;

  const content = (
    <>
      {LeftIcon ? (
        <LeftIcon
          className="or-btn__icon"
          size={iconSize}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      ) : null}
      {children}
      {RightIcon ? (
        <RightIcon
          className="or-btn__icon"
          size={iconSize}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  if (href !== undefined) {
    // A disabled link keeps its href (and so its link role) but leaves the tab order and
    // swallows the click, which is the closest an anchor gets to :disabled.
    const handleClick = (event: MouseEvent<HTMLElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };

    return (
      <a
        className={classes}
        href={href}
        target={target}
        rel={rel}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={handleClick}
        {...rest}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={classes}
      type={type}
      disabled={disabled}
      name={name}
      value={value}
      form={form}
      onClick={onClick}
      {...rest}
    >
      {content}
    </button>
  );
}
