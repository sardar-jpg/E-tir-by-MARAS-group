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

/**
 * fix/apple-driver-account-deletion review follow-up: `Driver.firebaseUid`
 * is a cryptographically-verified internal identifier (see
 * hasVerifiedFirebaseUid / DELETE /api/drivers/:id in server.ts) with no
 * legitimate reason to appear in any response — not to the admin roster,
 * not to a co-driver on a shared shipment, not even back to the driver it
 * belongs to. Every route that returns a Driver-shaped object must strip
 * it, same as password.
 */
export function stripFirebaseUid<T extends { firebaseUid?: unknown }>(record: T): Omit<T, "firebaseUid"> {
  const { firebaseUid, ...rest } = record;
  return rest;
}
