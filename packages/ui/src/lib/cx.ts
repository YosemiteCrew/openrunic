/** Anything a conditional class expression can evaluate to. */
export type ClassValue = string | false | null | undefined;

/**
 * Join class names, dropping every falsy value. The whole of the library's
 * conditional-class logic goes through here.
 *
 * @example
 * cx('or-btn', `or-btn--${variant}`, fullWidth && 'or-btn--full', className)
 */
export function cx(...values: ClassValue[]): string {
  let out = '';
  for (const value of values) {
    if (!value) continue;
    out = out ? `${out} ${value}` : value;
  }
  return out;
}
