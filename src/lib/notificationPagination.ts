/**
 * notificationPagination.ts
 *
 * Phase 4 (Firestore scalability audit).
 *
 * Pure merge helpers paired with GET /api/notifications' new
 * `{ items, nextCursor, hasMore }` / `?since=` response shape — the
 * notifications equivalent of chatComposerState.ts's
 * mergeNewerChatMessages/prependOlderChatMessages, kept in their own file
 * since notifications and chat messages are unrelated domains sharing
 * only the same page shape, not a common component. A fresh session
 * login/tab open still just replaces state outright; these two only
 * cover appending a live-poll delta and prepending an older-history page,
 * both de-duplicated by id so a repeated/retried response is a safe
 * no-op rather than a duplicate row.
 */
export function mergeNewerNotifications<TNotification extends { id: string }>(
  existing: TNotification[],
  newer: TNotification[]
): TNotification[] {
  if (newer.length === 0) return existing;
  const existingIds = new Set(existing.map((n) => n.id));
  const toAdd = newer.filter((n) => !existingIds.has(n.id));
  if (toAdd.length === 0) return existing;
  return [...toAdd, ...existing];
}

export function appendOlderNotifications<TNotification extends { id: string }>(
  existing: TNotification[],
  older: TNotification[]
): TNotification[] {
  if (older.length === 0) return existing;
  const existingIds = new Set(existing.map((n) => n.id));
  const toAdd = older.filter((n) => !existingIds.has(n.id));
  if (toAdd.length === 0) return existing;
  return [...existing, ...toAdd];
}
