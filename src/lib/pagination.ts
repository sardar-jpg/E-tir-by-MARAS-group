/**
 * pagination.ts
 *
 * Phase 4 (Firestore scalability audit).
 *
 * Generic, pure cursor-pagination primitives shared by the chat-messages
 * and notifications endpoints (server.ts). Two responsibilities live
 * here, both deliberately free of any collection-specific knowledge:
 *
 *  1. Cursor encode/decode — an opaque string round-tripping a
 *     `{ ts, id }` pair (the last item's ordering timestamp and document
 *     id). `id` is always part of the cursor, never just the timestamp,
 *     because timestamps are not unique (two messages sent in the same
 *     millisecond) — without a tiebreaker, `startAfter(ts)` alone could
 *     skip or repeat a row landing exactly on the cursor. Every ordering
 *     in this file is therefore `(timestamp DESC, id DESC)`, and the real
 *     Firestore queries built in server.ts use the matching
 *     `.orderBy("timestamp", "desc").orderBy(FieldPath.documentId(), "desc")`
 *     so the memory-fallback engine below and a live Firestore query
 *     agree on tie order by construction, not by coincidence.
 *
 *  2. `paginateDescending` — the memory-fallback query engine: given a
 *     full in-memory array (already scoped to the right collection by
 *     the caller) plus the same ordering/limit/cursor semantics a real
 *     Firestore query would use, returns exactly the page a Firestore
 *     `.orderBy(...).limit(...).startAfter(...)` query would. This is
 *     the "helper level parity" contract between real Firestore mode and
 *     memory-fallback mode — server.ts's real-Firestore query builder and
 *     this function are given the *same* constraints and are expected to
 *     produce the same result shape; this function's own correctness is
 *     unit-tested directly (ordering, cursoring, duplicate timestamps,
 *     malformed cursors) so that parity has one real, tested foundation
 *     instead of two independently-hand-written implementations that can
 *     drift apart.
 *
 * Deliberately NOT here: which collection, which fields, or which
 * business/permission rule decides what belongs on a page — see
 * chatVisibility.ts (chat channel/role scoping) and notificationAccess.ts
 * (notification recipient scoping) for that. This file only knows about
 * "an array of things with a timestamp and an id."
 */

export const DEFAULT_PAGE_SIZE = 50;

export interface PageCursor {
  ts: string;
  id: string;
}

/**
 * Opaque cursor string. Not cryptographically signed — a cursor only ever
 * encodes a position in an already-authorized query (the shipmentId/
 * channel/recipient scoping is re-verified server-side on every request
 * from the session, never trusted from the cursor), so there is nothing
 * sensitive to protect here; the encoding exists only so a client can
 * treat "resume after this point" as a single string instead of
 * reconstructing `{ts, id}` itself.
 */
export function encodePageCursor(cursor: PageCursor): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

/**
 * Safe decode: any malformed, missing, tampered-with, or unexpected-shape
 * cursor returns `null` (never throws) so a bad cursor degrades to "start
 * from the top" rather than 500ing the request. Callers must treat `null`
 * as "no cursor" — never as an error to reject with 400 by itself, since
 * a stale/garbage cursor from an old client build is expected to happen
 * in the wild and should just silently reset paging, not break the page.
 */
export function decodePageCursor(raw: unknown): PageCursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as any).ts === "string" &&
    (parsed as any).ts.length > 0 &&
    typeof (parsed as any).id === "string" &&
    (parsed as any).id.length > 0
  ) {
    return { ts: (parsed as any).ts, id: (parsed as any).id };
  }
  return null;
}

export type CursorParamResult = { ok: true; cursor: PageCursor | null } | { ok: false };

/**
 * PR #99 review fix: routes previously called decodePageCursor directly
 * on a query param and treated *any* failure (including a genuinely
 * malformed/tampered value, not just an absent one) the same as "no
 * cursor — start from the top." That's the wrong behavior for a
 * supplied-but-invalid cursor: silently resetting to page one instead of
 * telling the caller their request was bad can look like data went
 * missing (a "Load older" click that quietly jumps back to the newest
 * page instead of erroring). This distinguishes the two cases so a route
 * can 400 on a malformed *supplied* value while still treating a
 * missing/undefined param as perfectly valid (no cursor at all).
 */
export function parseCursorParam(raw: unknown): CursorParamResult {
  if (raw === undefined || raw === null) return { ok: true, cursor: null };
  if (typeof raw !== "string" || raw.length === 0) return { ok: false };
  const decoded = decodePageCursor(raw);
  if (decoded === null) return { ok: false };
  return { ok: true, cursor: decoded };
}

/**
 * Deterministic (timestamp DESC, id DESC) comparator. Equal timestamps
 * (two messages/notifications created in the same millisecond, or legacy
 * rows sharing a coarser timestamp) are broken by id so the ordering is
 * total and stable across repeated calls — required for cursor pagination
 * to never skip or repeat a row.
 */
function compareDescending(a: { ts: string; id: string }, b: { ts: string; id: string }): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

export interface PaginateDescendingResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Phase 2A follow-up (Firestore scalability audit, shipments/orders —
 * blocking-issue fix). A real Firestore `.orderBy(field)` query silently
 * EXCLUDES any document that doesn't have `field` set at all — this is
 * documented Firestore behavior, not a bug in this app's queries. Every
 * caller of paginateDescending/paginateAscendingSince below must see the
 * SAME exclusion in memory-fallback mode, or memory-fallback stops being
 * a faithful stand-in for real Firestore the moment a legacy record is
 * missing its ordering field (e.g. a pre-migration Shipment missing
 * createdAt/updatedAt — see docs/FOLLOW_UP_ROADMAP.md's shipments-
 * pagination entry and scripts/backfill-shipment-timestamps.ts for the
 * migration this documents). `getTs` returning `""`/`undefined`/`null`
 * is treated as "field absent," matching Firestore's own semantics
 * (Firestore has no field type that would produce a falsy-but-present
 * timestamp any of this app's real records use).
 */
function hasOrderableTimestamp<T>(item: T, getTs: (item: T) => string): boolean {
  return !!getTs(item);
}

/**
 * The memory-fallback pagination engine. `items` should already be scoped
 * to the right collection/role/channel by the caller (this function does
 * no filtering) — it only sorts, cursors, and limits, exactly mirroring
 * what `.orderBy("timestamp","desc").orderBy(docId,"desc").limit(n).startAfter(cursor)`
 * would do against real Firestore, INCLUDING excluding any item missing
 * its ordering field entirely (see hasOrderableTimestamp above).
 */
export function paginateDescending<T>(
  items: T[],
  getTs: (item: T) => string,
  getId: (item: T) => string,
  options: { cursor?: PageCursor | null; limit?: number } = {}
): PaginateDescendingResult<T> {
  const limit = options.limit && options.limit > 0 ? options.limit : DEFAULT_PAGE_SIZE;
  const cursor = options.cursor ?? null;

  const sorted = items
    .filter((item) => hasOrderableTimestamp(item, getTs))
    .sort((a, b) => compareDescending({ ts: getTs(a), id: getId(a) }, { ts: getTs(b), id: getId(b) }));

  // Looking for the first row *older* than the cursor (i.e. sorting
  // strictly *after* it in this descending order) — compareDescending
  // returns > 0 exactly when its first argument is older than its second.
  const startIndex = cursor
    ? sorted.findIndex((item) => compareDescending({ ts: getTs(item), id: getId(item) }, cursor) > 0)
    : 0;
  // findIndex returns -1 when every row is at-or-before the cursor (i.e.
  // there is nothing left "after" it) — that means an empty page, not
  // "start from the top" (which the `0` default above already handles for
  // the no-cursor case).
  const remaining = startIndex === -1 ? [] : sorted.slice(startIndex);

  const page = remaining.slice(0, limit);
  const hasMore = remaining.length > limit;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodePageCursor({ ts: getTs(last), id: getId(last) }) : null;

  return { items: page, nextCursor, hasMore };
}

export interface PaginateAscendingResult<T> {
  items: T[];
  hasMore: boolean;
}

/**
 * The "since" / catch-up engine used by live polling: everything strictly
 * *after* `cursor` in ascending (oldest-first) order, i.e. the inverse
 * direction of `paginateDescending`. Used to fetch only newly-arrived rows
 * instead of re-fetching a whole page on every poll tick. Unlike
 * `paginateDescending`, `limit` here is a safety cap (a burst of activity
 * between two 3-second polls should still never return an unbounded
 * result), not a page-size contract — `hasMore` tells the caller a
 * (rare) burst exceeded the cap so it can poll again immediately rather
 * than wait a full interval. Excludes any item missing its ordering
 * field entirely, same as paginateDescending — see hasOrderableTimestamp
 * above.
 */
export function paginateAscendingSince<T>(
  items: T[],
  getTs: (item: T) => string,
  getId: (item: T) => string,
  cursor: PageCursor | null,
  limit: number = DEFAULT_PAGE_SIZE
): PaginateAscendingResult<T> {
  const sorted = items
    .filter((item) => hasOrderableTimestamp(item, getTs))
    .sort((a, b) => -compareDescending({ ts: getTs(a), id: getId(a) }, { ts: getTs(b), id: getId(b) }));
  const filtered = cursor
    ? sorted.filter((item) => compareDescending({ ts: getTs(item), id: getId(item) }, cursor) < 0)
    : sorted;
  return {
    items: filtered.slice(0, limit),
    hasMore: filtered.length > limit,
  };
}

/**
 * The equality/`in`/`array-contains` filter shape server.ts's
 * real-Firestore query builder and the memory-fallback engine below both
 * consume — one small vocabulary is enough for every scope this app needs
 * (shipmentId, channel, recipientUserId, and — PR #99 review —
 * assignedDriverId/additionalDriverIds/companyName for the shipment-
 * ownership lookup), deliberately not a general Firestore query-builder
 * DSL. `array-contains` matches a document whose `field` is an array
 * containing `value` — used for Shipment.additionalDriverIds (a flat
 * array of driver ids; see src/lib/driverVisibility.ts's
 * deriveAdditionalDriverIds for why that field exists at all).
 */
export interface PageFilter {
  field: string;
  op: "==" | "in" | "array-contains";
  value: any;
}

/** True for a filter that can never match anything (an empty `in` list) — Firestore itself throws on `where(field, "in", [])`, so both the real and memory-fallback paths check this before ever running a query. */
export function hasUnsatisfiableFilter(filters: PageFilter[]): boolean {
  return filters.some((f) => f.op === "in" && Array.isArray(f.value) && f.value.length === 0);
}

/**
 * The memory-fallback filter engine — mirrors exactly what a chain of
 * Firestore `.where(field, "==", value)` / `.where(field, "in", values)` /
 * `.where(field, "array-contains", value)` clauses would match. This is
 * the piece that guarantees "no cross-shipment leakage" / "no
 * cross-channel leakage": a message or notification is only ever included
 * if it satisfies every filter, the same all-AND semantics a chained
 * Firestore query has.
 */
export function applyMemoryFilters<T extends Record<string, any>>(items: T[], filters: PageFilter[]): T[] {
  return items.filter((item) =>
    filters.every((f) => {
      if (f.op === "==") return item[f.field] === f.value;
      if (f.op === "in") return Array.isArray(f.value) && f.value.includes(item[f.field]);
      if (f.op === "array-contains") return Array.isArray(item[f.field]) && item[f.field].includes(f.value);
      return true;
    })
  );
}

export interface FilledPageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * PR #99 review fix: excludeUserId / chat-channel-visibility / admin-
 * preference filtering happens on an already-fetched page in server.ts
 * (too fine-grained per-notification a rule to express as a Firestore
 * `where`), so a raw page can filter down to fewer than `limit` eligible
 * items even when more exist. server.ts's fetchFilledNotificationsPage
 * loops, re-fetching + re-filtering additional bounded pages and
 * concatenating into `collected`, until it has enough or genuinely runs
 * out — this is the final, pure "did we overshoot, or truly reach the
 * end" decision that loop reduces to on each iteration and at the end,
 * pulled out so it's unit-testable without mocking Firestore/the
 * memory store.
 *
 * - `collected.length > limit` means at least one round fetched more
 *   filtered-eligible rows than needed to fill the page — trim to
 *   exactly `limit` and recompute the cursor from the last KEPT row
 *   (not the last fetched one), so the next "load older" request resumes
 *   correctly from the trimmed boundary rather than skipping the
 *   trimmed-off rows.
 * - Otherwise, the page holds every eligible row collected so far, and
 *   `hasMore`/`nextCursor` are whatever the raw underlying query last
 *   reported — `rawHasMore: false` means the source itself is exhausted,
 *   which must always win regardless of how much filtering removed.
 */
export function finalizeFilledDescendingPage<T>(
  collected: T[],
  limit: number,
  rawHasMore: boolean,
  rawNextCursor: string | null,
  getTs: (item: T) => string,
  getId: (item: T) => string
): FilledPageResult<T> {
  if (collected.length > limit) {
    const trimmed = collected.slice(0, limit);
    const last = trimmed[trimmed.length - 1];
    return { items: trimmed, nextCursor: encodePageCursor({ ts: getTs(last), id: getId(last) }), hasMore: true };
  }
  return { items: collected, nextCursor: rawHasMore ? rawNextCursor : null, hasMore: rawHasMore };
}

export interface FilledSinceResult<T> {
  items: T[];
  hasMore: boolean;
}

/** The since-mode (ascending catch-up) equivalent of finalizeFilledDescendingPage — simpler, since since-mode has no cursor to hand back (the caller keeps its own newest-seen position client-side). */
export function finalizeFilledSincePage<T>(collected: T[], limit: number, rawHasMore: boolean): FilledSinceResult<T> {
  if (collected.length > limit) {
    return { items: collected.slice(0, limit), hasMore: true };
  }
  return { items: collected, hasMore: rawHasMore };
}
