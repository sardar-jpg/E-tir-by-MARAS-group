/**
 * monitoringStore.ts — simple internal application-monitoring foundation
 * (PR #128, MARAS AI + Super Admin monitoring).
 *
 * Deliberately NOT an external monitoring platform and NOT a new
 * database: events live in one bounded in-process array owned by
 * server.ts (operational telemetry, not business data — it resets on
 * restart by design, exactly like a process log). Repeated identical
 * problems GROUP into one event whose count grows, so a crash-looping
 * endpoint produces one rising counter, not ten thousand rows — the
 * anti-spam rule the Super Admin alert view depends on.
 *
 * Everything here is pure (store passed in, timestamps passed in) so
 * grouping, capping, classification, and alert derivation are directly
 * unit-tested. Only server.ts calls these with real data.
 */

export type MonitoringSeverity = "low" | "medium" | "high" | "critical";

export type MonitoringEventKind =
  | "server_error"        // any 5xx response
  | "slow_request"        // unusually slow API request
  | "upload_failure"      // document/file upload failed
  | "notification_failure"
  | "gps_failure"
  | "db_failure"          // database operation failure (503 SERVICE_UNAVAILABLE family)
  | "frontend_error"      // reported by the Admin frontend
  | "maras_ai_failure";   // the AI provider call itself failed

export interface MonitoringEvent {
  /** Grouping key — identical keys collapse into one event with a rising count. */
  key: string;
  kind: MonitoringEventKind;
  severity: MonitoringSeverity;
  /** Affected area, e.g. "POST /api/upload" or "Admin frontend". */
  area: string;
  title: string;
  detail: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

export const MONITORING_MAX_EVENTS = 400;

/**
 * PR #128 refinement — persistent monitoring. Event groups are persisted
 * through the project's EXISTING persistence layer (the same Firestore /
 * memory-fallback wrappers every other collection uses — no new database),
 * one document per group key in the "monitoringEvents" collection, so
 * monitoring history survives a server restart. Anything older than this
 * retention window is pruned on hydration and on each flush.
 */
export const MONITORING_RETENTION_DAYS = 30;
export const MONITORING_RETENTION_MS = MONITORING_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Deterministic, Firestore-safe document id for a group key. Keys contain
 * characters a document id can't ("/", "|", spaces), so the id is the
 * sanitized key (readable in the console) plus an FNV-1a hash suffix that
 * keeps two keys that sanitize identically from colliding.
 */
export function monitoringDocIdForKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const readable = key.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return `${readable || "event"}-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Merges event groups loaded from persistent storage into the live
 * in-process store (start-up hydration). Same key = same problem, so the
 * two groups combine: counts add, firstAt takes the earliest, lastAt the
 * latest, severity the worst, and detail follows whichever occurrence is
 * newer. Result is re-capped to MONITORING_MAX_EVENTS (oldest-first drop,
 * matching recordMonitoringEvent).
 */
export function mergeMonitoringEvents(store: MonitoringEvent[], persisted: MonitoringEvent[]): void {
  for (const p of persisted) {
    const existing = store.find((e) => e.key === p.key);
    if (!existing) {
      store.push({ ...p });
      continue;
    }
    existing.count += p.count;
    if (p.firstAt < existing.firstAt) existing.firstAt = p.firstAt;
    if (p.lastAt > existing.lastAt) {
      existing.lastAt = p.lastAt;
      existing.detail = p.detail;
    }
    if (severityRank(p.severity) > severityRank(existing.severity)) existing.severity = p.severity;
  }
  store.sort((a, b) => (a.lastAt < b.lastAt ? -1 : 1));
  while (store.length > MONITORING_MAX_EVENTS) store.shift();
}

/**
 * Retention: removes (in place) every group whose last occurrence is
 * older than the retention window, returning the removed groups so the
 * caller can delete their persisted documents too.
 */
export function pruneExpiredMonitoringEvents(store: MonitoringEvent[], nowIso: string): MonitoringEvent[] {
  const cutoff = new Date(new Date(nowIso).getTime() - MONITORING_RETENTION_MS).toISOString();
  const removed: MonitoringEvent[] = [];
  for (let i = store.length - 1; i >= 0; i--) {
    if (store[i].lastAt < cutoff) removed.push(...store.splice(i, 1));
  }
  return removed;
}

/** New occurrence of `candidate`: group onto an existing event with the same key, else append (dropping the oldest past the cap). */
export function recordMonitoringEvent(
  store: MonitoringEvent[],
  candidate: Omit<MonitoringEvent, "count" | "firstAt" | "lastAt">,
  nowIso: string
): void {
  const existing = store.find((e) => e.key === candidate.key);
  if (existing) {
    existing.count += 1;
    existing.lastAt = nowIso;
    // A recurring problem is at least as bad as its worst occurrence.
    if (severityRank(candidate.severity) > severityRank(existing.severity)) existing.severity = candidate.severity;
    existing.detail = candidate.detail;
    return;
  }
  store.push({ ...candidate, count: 1, firstAt: nowIso, lastAt: nowIso });
  while (store.length > MONITORING_MAX_EVENTS) store.shift();
}

export function severityRank(s: MonitoringSeverity): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ── Request classification (the response-observer middleware) ────────

export const SLOW_REQUEST_MS = 3_000;

/**
 * Turns one finished HTTP request into a monitoring event candidate, or
 * null when it isn't noteworthy. Only /api/ routes are observed; the
 * monitoring/AI endpoints themselves are excluded so a failing monitor
 * can never feed itself into an alert loop.
 */
export function classifyRequestForMonitoring(input: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}): Omit<MonitoringEvent, "count" | "firstAt" | "lastAt"> | null {
  const { method, path, statusCode, durationMs } = input;
  if (!path.startsWith("/api/")) return null;
  if (path.startsWith("/api/admin/maras-ai") || path.startsWith("/api/admin/monitoring")) return null;
  const area = `${method} ${normalizeMonitoringPath(path)}`;

  if (statusCode >= 500) {
    const isUpload = path.startsWith("/api/upload");
    const isDbUnavailable = statusCode === 503;
    const kind: MonitoringEventKind = isUpload ? "upload_failure" : isDbUnavailable ? "db_failure" : "server_error";
    return {
      key: `${kind}|${area}|${statusCode}`,
      kind,
      severity: isUpload || isDbUnavailable ? "high" : "critical",
      area,
      title: isUpload
        ? "Document upload failing"
        : isDbUnavailable
          ? "Database/storage temporarily unavailable"
          : `Server error ${statusCode}`,
      detail: `${area} answered ${statusCode}.`,
    };
  }

  if (durationMs >= SLOW_REQUEST_MS) {
    return {
      key: `slow_request|${area}`,
      kind: "slow_request",
      severity: "medium",
      area,
      title: "Slow API request",
      detail: `${area} took ${Math.round(durationMs)}ms (threshold ${SLOW_REQUEST_MS}ms).`,
    };
  }
  return null;
}

/** Collapses ids so the same route groups: /api/shipments/shipment-1001/chat -> /api/shipments/:id/chat */
export function normalizeMonitoringPath(path: string): string {
  return path
    .split("?")[0]
    .split("/")
    .map((seg) => (/^(?:[\w-]*\d[\w-]*|[0-9a-f]{16,})$/i.test(seg) && seg.length > 3 ? ":id" : seg))
    .join("/");
}

// ── Super Admin technical alerts ─────────────────────────────────────

export interface TechnicalAlert {
  title: string;
  severity: MonitoringSeverity;
  time: string;
  area: string;
  explanation: string;
  count: number;
  suggestedAction: string;
}

const SUGGESTED_ACTIONS: Record<MonitoringEventKind, string> = {
  server_error: "Check the server logs for this endpoint and reproduce the failing request; a repeated 500 usually means a code defect or bad data record.",
  slow_request: "Profile this endpoint's queries; consider pagination or an index if it reads a growing collection.",
  upload_failure: "Verify Firebase Storage credentials/quota and connectivity; uploads refuse to store files when Storage is unreachable.",
  notification_failure: "Check the push/notification provider credentials and delivery logs.",
  gps_failure: "Check driver-app GPS permissions and the location update endpoint's recent responses.",
  db_failure: "Check Firestore availability and Application Default Credentials; the server answers 503 rather than silently using volatile memory.",
  frontend_error: "Reproduce in the browser console on the reported page; a repeated frontend crash usually pinpoints one component.",
  maras_ai_failure: "Verify OPENAI_API_KEY validity, model name, and provider status; MARAS AI stays cleanly unavailable meanwhile.",
};

/**
 * The Super-Admin-only alert list: every recorded event group, worst and
 * most recent first. Normal admins never receive these — the route
 * serving this is super-gated in server.ts (and pinned by tests).
 */
export function deriveTechnicalAlerts(events: MonitoringEvent[]): TechnicalAlert[] {
  return [...events]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.lastAt < b.lastAt ? 1 : -1))
    .map((e) => ({
      title: e.title,
      severity: e.severity,
      time: e.lastAt,
      area: e.area,
      explanation: e.count > 1 ? `${e.detail} Occurred ${e.count} times since ${e.firstAt}.` : e.detail,
      count: e.count,
      suggestedAction: SUGGESTED_ACTIONS[e.kind],
    }));
}
