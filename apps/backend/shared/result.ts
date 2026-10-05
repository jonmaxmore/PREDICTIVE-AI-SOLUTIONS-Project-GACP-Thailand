/**
 * Result<T, E> Type
 * Functional error handling pattern to avoid throwing exceptions
 *
 * Usage:
 *   - Use `ok(value)` for success cases
 *   - Use `err(error)` for failure cases
 *   - Use `isOk()` and `isErr()` for type-safe checking
 *
 * Benefits:
 *   - Explicit error handling in function signatures
 *   - Type-safe error propagation
 *   - Easier testing (no try-catch needed)
 *   - Clear separation of happy path vs error path
 */

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };

export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Create a success Result
 */
export const ok = <T, E = never>(value: T): Result<T, E> => ({
  ok: true,
  value,
});

/**
 * Create a failure Result
 */
export const err = <T = never, E = Error>(error: E): Result<T, E> => ({
  ok: false,
  error,
});

/**
 * Type guard: check if Result is Ok
 */
export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok === true;

/**
 * Type guard: check if Result is Err
 */
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => r.ok === false;

/**
 * Extract value from Ok Result (throws if Err)
 * Use only when you're certain the Result is Ok
 */
export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (isOk(r)) {
    return r.value;
  }
  throw new Error('Cannot unwrap Err Result');
};

/**
 * Extract value from Ok Result with default fallback
 */
export const unwrapOr = <T, E>(r: Result<T, E>, defaultValue: T): T => {
  return isOk(r) ? r.value : defaultValue;
};

/**
 * Map Result value (only if Ok)
 */
export const map = <T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> => {
  return isOk(r) ? ok(fn(r.value)) : r;
};

/**
 * Map Result error (only if Err)
 */
export const mapErr = <T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> => {
  return isErr(r) ? err(fn(r.error)) : r;
};
