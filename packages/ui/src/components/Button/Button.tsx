import type { ComponentType, HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { ButtonVariant, IconSlug, Size } from '../../types';

const ICON_SIZE: Record<Size, number> = { sm: 15, md: 18, lg: 18 };

/**
 * Exactly what Button hands to the component named by `as`. It is the anchor's own prop
 * set, so a router's Link accepts all of it and `as={Link}` type-checks without this
 * library ever importing that router.
 */
export interface ButtonLinkProps {
  className: string;
  href: string;
  target?: string;
  rel?: string;
  /* React's own Booleanish, written out rather than imported: this interface is the
     contract a consumer's Link is measured against, so it should be readable on its own,
     and a caller passing aria-disabled="true" through must still type-check. */
  'aria-disabled'?: boolean | 'true' | 'false';
  tabIndex?: number;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  children?: ReactNode;
}

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
  /**
   * Renders this component in place of the plain `<a>`, keeping every class, variant and
   * state. Pass a router's Link here so in-app navigation stays a client transition
   * instead of a full page load. Honoured only alongside `href`.
   *
   * @example
   * <Button href="/records" as={Link}>Records</Button>
   */
  as?: ComponentType<ButtonLinkProps>;
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
 *
 * Inside a routed app, pass the router's Link as `as` so navigation stays a client
 * transition; the library never imports a router itself, so it stays framework-agnostic.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  fullWidth = false,
  href,
  as: LinkComponent,
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

    const linkProps: ButtonLinkProps = {
      className: classes,
      href,
      target,
      rel,
      'aria-disabled': disabled || undefined,
      tabIndex: disabled ? -1 : undefined,
      onClick: handleClick,
      children: content,
    };

    // The consumer's Link renders the anchor itself, so every class, variant and state
    // above still applies; only the element doing the navigating changes.
    if (LinkComponent) {
      return <LinkComponent {...linkProps} {...rest} />;
    }

    return <a {...linkProps} {...rest} />;
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
