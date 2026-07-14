/**
 * chatUnreadAccess.ts
 *
 * feature/admin-mobile-ui correction pass
 *
 * Pure, testable per-admin chat unread logic — the previous behavior
 * relied on ChatMessage.status ('sent'/'seen'), a single global flag: any
 * admin opening a channel marked it "seen" for every admin, and
 * internal_staff messages (always sender: 'admin') were excluded from
 * "unread" entirely regardless of who sent them, so one admin's message
 * to another never produced a badge at all. This file is the single
 * source of truth for the real behavior — imported by both server.ts
 * (GET /api/chat/unread, POST /api/shipments/:id/chat/seen) and
 * src/components/admin/ChatCenter.tsx (badge caps) — so there is exactly
 * one place deciding "is this unread for this admin," not two that can
 * drift apart.
 *
 * `status` (ChatMessage) is untouched by any of this — it remains the
 * single global driver/client-facing "was my message seen by the admin
 * side" read receipt, a genuinely different concern from an individual
 * admin's own unread badge.
 */

export interface UnreadCandidateMessage {
  sender: "admin" | "driver" | "client";
  senderId?: string;
  readByAdminIds?: string[];
}

/**
 * Whether `message` was sent by someone other than the admin
 * `viewerAdminId` — i.e. whether it's even possible for it to be unread
 * for that admin. Driver/client messages always qualify (an admin is
 * never the driver/client). An admin-sent message only qualifies if it
 * carries a senderId that differs from viewerAdminId — a legacy
 * admin-sent message with no senderId at all is treated as NOT from
 * another admin (conservative: never retroactively surfaces old
 * internal_staff messages as unread for everyone once this shipped).
 */
export function isMessageFromOtherAdmin(message: UnreadCandidateMessage, viewerAdminId: string): boolean {
  if (message.sender !== "admin") return true;
  return Boolean(message.senderId) && message.senderId !== viewerAdminId;
}

/**
 * Whether `message` should count toward `viewerAdminId`'s unread badge:
 * from someone else, AND not already in this admin's own read list.
 */
export function isMessageUnreadForAdmin(message: UnreadCandidateMessage, viewerAdminId: string): boolean {
  if (!isMessageFromOtherAdmin(message, viewerAdminId)) return false;
  const readBy = message.readByAdminIds || [];
  return !readBy.includes(viewerAdminId);
}

/**
 * Appends `adminId` to `readByAdminIds` without duplicating it. Pure —
 * returns a new array (or the same reference when already present, so
 * callers can skip a write when nothing changed).
 */
export function appendAdminReader(readByAdminIds: string[] | undefined, adminId: string): string[] {
  const existing = readByAdminIds || [];
  if (existing.includes(adminId)) return existing;
  return [...existing, adminId];
}

/**
 * Badge display rule (WhatsApp/Google-Chat-style): hidden at 0, exact
 * for 1-99, capped at "99+" beyond that. Returns null when nothing
 * should render — callers should render no badge at all in that case,
 * not a "0".
 */
export function formatUnreadBadge(count: number): string | null {
  if (count <= 0) return null;
  if (count > 99) return "99+";
  return String(count);
}

/**
 * Phase 4 follow-up (chat seen/unread scalability audit) — the exact
 * filter+sort GET /api/chat/unread applies to whatever candidate messages
 * it fetched (server.ts, via fetchAllMatchingDescending — a scoped,
 * paginated walk, never a full-collection scan). Pulled out so this is
 * unit-testable independent of how the candidates were fetched: feeding it
 * the same candidate set regardless of whether it came from one big page
 * or many small chunked pages must always produce the identical result
 * (memory-fallback parity, and parity between a single Firestore read and
 * a chunked one).
 */
export function selectUnreadMessagesForAdmin<T extends UnreadCandidateMessage & { timestamp: string }>(
  messages: T[],
  viewerAdminId: string
): T[] {
  return messages
    .filter((m) => isMessageUnreadForAdmin(m, viewerAdminId))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
