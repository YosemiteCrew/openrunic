/** The success arm of {@link Result}. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** The failure arm of {@link Result}. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * A discriminated union for fallible operations. Narrow on the `ok` flag:
 *
 * ```ts
 * const result = parseThing(raw);
 * if (result.ok) use(result.value);
 * else report(result.error);
 * ```
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Wraps a value in the success arm of {@link Result}. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps an error in the failure arm of {@link Result}. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
