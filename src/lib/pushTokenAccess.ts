/**
 * pushTokenAccess.ts
 *
 * BUG-18: the push-token delete/unregister route used to delete whatever
 * pushTokens/<token> doc matched the URL with no ownership check - any
 * authenticated session (driver, client, or admin) could unregister ANY
 * other user's device just by knowing/guessing their token string. Every
 * token doc already records who registered it (userId/role, set at
 * registration in server.ts's POST /api/push-tokens), so deletion is now
 * gated on the caller's session matching that record.
 *
 * Factored out so the ownership rule is unit-testable independent of the
 * Express route (which just does: not found -> 404, canDeletePushToken()
 * false -> 403, else delete).
 */

export interface PushTokenOwnerSession {
  id: string;
  role: string;
}

export interface PushTokenRecord {
  userId?: string;
  role?: string;
}

/**
 * True only if the session both registered this token (matching userId)
 * and still holds the same role it was registered under. There is no
 * admin-override route, so an admin session gets no special treatment
 * here - it must match the record just like any other role.
 */
export function canDeletePushToken(session: PushTokenOwnerSession, record: PushTokenRecord): boolean {
  return record.userId === session.id && record.role === session.role;
}

export interface PushTokenRecordWithId extends PushTokenRecord {
  id: string;
}

/**
 * fix/apple-driver-account-deletion: selects exactly the push-token doc ids
 * belonging to one account (same ownership rule as canDeletePushToken,
 * just applied across every token that account ever registered instead of
 * the one token a caller happens to still hold) — used by
 * DELETE /api/drivers/:id to clean up orphaned tokens as part of account
 * deletion, without broadening who can delete a token or touching any
 * other account's tokens.
 */
export function selectPushTokensForAccountDeletion(
  tokens: PushTokenRecordWithId[],
  account: PushTokenOwnerSession
): string[] {
  return tokens.filter(t => canDeletePushToken(account, t)).map(t => t.id);
}
