/**
 * sanitize.ts
 *
 * BUG-07: /api/verify-session's client branch returned the raw Firestore
 * client record — including the password hash — while every other
 * login/session path already stripped it via an inline destructure. A
 * shared helper makes that redaction enforced at every call site instead
 * of relying on each one remembering to do it by hand.
 */
export function stripPassword<T extends { password?: unknown }>(record: T): Omit<T, "password"> {
  const { password, ...rest } = record;
  return rest;
}
