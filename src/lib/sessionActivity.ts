/**
 * sessionActivity.ts — Performance Phase 3.
 *
 * Storage-only "the user is active" touch. App.tsx's activity listeners
 * (throttled to once per 30s) used to stamp lastActive in BOTH localStorage
 * and React state — but the only consumers of lastActive are the passive
 * 24h-inactivity checker and the boot/fast-path validators, all of which
 * read the STORED session, never React state. The setSession call therefore
 * bought nothing except a root-App re-render (plus activity-listener
 * teardown/resubscribe) every 30 seconds of activity.
 *
 * This helper performs only the storage write. It updates lastActive and
 * nothing else — role, token, email, driver/client/admin fields all pass
 * through byte-identical — and it NEVER throws: missing values, corrupt
 * JSON, and storage read/write failures (private-mode quota, etc.) all
 * resolve to a { ok: false } result so a background activity tick can never
 * take down the app. The 24-hour inactivity policy itself lives in the
 * caller (unchanged); this helper only refreshes the timestamp it reads.
 */

/** Minimal storage contract (localStorage-compatible; injectable in tests). */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SESSION_STORAGE_KEY = "etir_session";

export type TouchSessionActivityResult =
  | { ok: true; lastActive: number }
  | { ok: false; reason: "missing" | "corrupt" | "read_error" | "write_error" };

/**
 * Stamp lastActive = now() on the stored session, in storage only.
 * Returns the written timestamp on success; a typed no-throw failure
 * otherwise. Never mutates any other field of the stored session.
 */
export function touchStoredSessionActivity(
  storage: StringStorage,
  now: () => number = Date.now
): TouchSessionActivityResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return { ok: false, reason: "read_error" };
  }
  if (raw === null || raw === "") return { ok: false, reason: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "corrupt" };
  }

  const lastActive = now();
  const updated = { ...(parsed as Record<string, unknown>), lastActive };
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    return { ok: false, reason: "write_error" };
  }
  return { ok: true, lastActive };
}
