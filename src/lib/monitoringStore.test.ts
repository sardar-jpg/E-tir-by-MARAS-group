import { describe, it, expect } from "vitest";
import {
  recordMonitoringEvent,
  classifyRequestForMonitoring,
  deriveTechnicalAlerts,
  normalizeMonitoringPath,
  mergeMonitoringEvents,
  pruneExpiredMonitoringEvents,
  monitoringDocIdForKey,
  MONITORING_MAX_EVENTS,
  MONITORING_RETENTION_MS,
  SLOW_REQUEST_MS,
  type MonitoringEvent,
} from "./monitoringStore";

const candidate = (key: string, over: Partial<Omit<MonitoringEvent, "count" | "firstAt" | "lastAt">> = {}) => ({
  key,
  kind: "server_error" as const,
  severity: "high" as const,
  area: "GET /api/x",
  title: "Server error 500",
  detail: "boom",
  ...over,
});

describe("recordMonitoringEvent — grouping is the anti-spam rule", () => {
  it("identical keys collapse into one event with a rising count", () => {
    const store: MonitoringEvent[] = [];
    recordMonitoringEvent(store, candidate("k1"), "t1");
    recordMonitoringEvent(store, candidate("k1"), "t2");
    recordMonitoringEvent(store, candidate("k1"), "t3");
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ count: 3, firstAt: "t1", lastAt: "t3" });
  });

  it("a recurring problem takes the worst severity it has shown", () => {
    const store: MonitoringEvent[] = [];
    recordMonitoringEvent(store, candidate("k1", { severity: "medium" }), "t1");
    recordMonitoringEvent(store, candidate("k1", { severity: "critical" }), "t2");
    recordMonitoringEvent(store, candidate("k1", { severity: "low" }), "t3");
    expect(store[0].severity).toBe("critical");
  });

  it("the store is bounded — oldest groups drop past the cap", () => {
    const store: MonitoringEvent[] = [];
    for (let i = 0; i < MONITORING_MAX_EVENTS + 25; i++) {
      recordMonitoringEvent(store, candidate(`k${i}`), `t${i}`);
    }
    expect(store).toHaveLength(MONITORING_MAX_EVENTS);
    expect(store[0].key).toBe("k25");
  });
});

describe("classifyRequestForMonitoring", () => {
  it("5xx on an API route becomes a server_error (503 = db_failure, upload = upload_failure)", () => {
    expect(classifyRequestForMonitoring({ method: "GET", path: "/api/shipments", statusCode: 500, durationMs: 20 })?.kind).toBe("server_error");
    expect(classifyRequestForMonitoring({ method: "POST", path: "/api/upload", statusCode: 503, durationMs: 20 })?.kind).toBe("upload_failure");
    expect(classifyRequestForMonitoring({ method: "GET", path: "/api/drivers", statusCode: 503, durationMs: 20 })?.kind).toBe("db_failure");
  });

  it("slow requests are noteworthy; fast successes are not", () => {
    expect(classifyRequestForMonitoring({ method: "GET", path: "/api/shipments", statusCode: 200, durationMs: SLOW_REQUEST_MS + 1 })?.kind).toBe("slow_request");
    expect(classifyRequestForMonitoring({ method: "GET", path: "/api/shipments", statusCode: 200, durationMs: 90 })).toBeNull();
  });

  it("never observes non-API paths or the monitoring/AI endpoints themselves (no self-feeding loop)", () => {
    expect(classifyRequestForMonitoring({ method: "GET", path: "/assets/app.js", statusCode: 500, durationMs: 10 })).toBeNull();
    expect(classifyRequestForMonitoring({ method: "POST", path: "/api/admin/maras-ai/chat", statusCode: 502, durationMs: 10 })).toBeNull();
    expect(classifyRequestForMonitoring({ method: "POST", path: "/api/admin/monitoring/frontend-error", statusCode: 500, durationMs: 10 })).toBeNull();
  });

  it("groups the same route across different record ids", () => {
    const a = classifyRequestForMonitoring({ method: "GET", path: "/api/shipments/shipment-1001/chat", statusCode: 500, durationMs: 10 });
    const b = classifyRequestForMonitoring({ method: "GET", path: "/api/shipments/shipment-2044/chat", statusCode: 500, durationMs: 10 });
    expect(a?.key).toBe(b?.key);
    expect(normalizeMonitoringPath("/api/shipments/shipment-1001/chat")).toBe("/api/shipments/:id/chat");
  });
});

describe("persistence: restart survival via mergeMonitoringEvents", () => {
  const stored = (key: string, over: Partial<MonitoringEvent> = {}): MonitoringEvent => ({
    ...candidate(key),
    count: 1,
    firstAt: "2026-07-01T00:00:00Z",
    lastAt: "2026-07-01T00:00:00Z",
    ...over,
  });

  it("hydrating persisted groups into a fresh (post-restart) store keeps the history", () => {
    const live: MonitoringEvent[] = [];
    mergeMonitoringEvents(live, [stored("k1", { count: 7 }), stored("k2", { count: 2, severity: "critical" })]);
    expect(live).toHaveLength(2);
    expect(live.find((e) => e.key === "k1")?.count).toBe(7);
    expect(live.find((e) => e.key === "k2")?.severity).toBe("critical");
  });

  it("a group recorded before hydration completes combines with its persisted history", () => {
    const live: MonitoringEvent[] = [];
    // The observer recorded two occurrences right after boot…
    recordMonitoringEvent(live, candidate("k1", { severity: "medium", detail: "new boom" }), "2026-07-10T00:00:00Z");
    recordMonitoringEvent(live, candidate("k1", { severity: "medium", detail: "new boom" }), "2026-07-10T01:00:00Z");
    // …then hydration merges the pre-restart history for the same key.
    mergeMonitoringEvents(live, [stored("k1", { count: 5, severity: "critical", detail: "old boom" })]);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      count: 7,
      firstAt: "2026-07-01T00:00:00Z", // earliest occurrence wins
      lastAt: "2026-07-10T01:00:00Z",  // latest occurrence wins
      severity: "critical",            // worst severity wins
      detail: "new boom",              // detail follows the newest occurrence
    });
  });

  it("merge re-caps the store at MONITORING_MAX_EVENTS", () => {
    const live: MonitoringEvent[] = [];
    const persisted = Array.from({ length: MONITORING_MAX_EVENTS + 10 }, (_, i) => stored(`k${i}`, { lastAt: `t${String(i).padStart(4, "0")}` }));
    mergeMonitoringEvents(live, persisted);
    expect(live).toHaveLength(MONITORING_MAX_EVENTS);
  });
});

describe("retention: pruneExpiredMonitoringEvents (30 days)", () => {
  it("removes groups whose last occurrence is past the retention window and returns them for doc deletion", () => {
    const now = "2026-07-18T00:00:00Z";
    const fresh: MonitoringEvent = { ...candidate("fresh"), count: 1, firstAt: "2026-07-17T00:00:00Z", lastAt: "2026-07-17T00:00:00Z" };
    const stale: MonitoringEvent = { ...candidate("stale"), count: 4, firstAt: "2026-05-01T00:00:00Z", lastAt: "2026-05-02T00:00:00Z" };
    const store = [stale, fresh];
    const removed = pruneExpiredMonitoringEvents(store, now);
    expect(removed.map((e) => e.key)).toEqual(["stale"]);
    expect(store.map((e) => e.key)).toEqual(["fresh"]);
    // An event exactly inside the window stays.
    const edge: MonitoringEvent = { ...candidate("edge"), count: 1, firstAt: "x", lastAt: new Date(new Date(now).getTime() - MONITORING_RETENTION_MS + 60_000).toISOString() };
    const store2 = [edge];
    expect(pruneExpiredMonitoringEvents(store2, now)).toHaveLength(0);
    expect(store2).toHaveLength(1);
  });
});

describe("monitoringDocIdForKey — Firestore-safe, deterministic", () => {
  it("is stable, readable, and never contains path separators or pipes", () => {
    const key = "server_error|GET /api/shipments/:id/chat|500";
    const id = monitoringDocIdForKey(key);
    expect(id).toBe(monitoringDocIdForKey(key));
    expect(id).not.toMatch(/[/|\s]/);
    expect(id).toContain("server_error");
  });

  it("keys that sanitize identically still get distinct ids (hash suffix)", () => {
    expect(monitoringDocIdForKey("a|b")).not.toBe(monitoringDocIdForKey("a/b"));
  });
});

describe("deriveTechnicalAlerts — the Super Admin view", () => {
  it("carries title, severity, time, area, explanation, count, and a suggested action — worst first", () => {
    const store: MonitoringEvent[] = [];
    recordMonitoringEvent(store, candidate("slow", { kind: "slow_request", severity: "medium", title: "Slow API request" }), "t1");
    recordMonitoringEvent(store, candidate("boom", { severity: "critical" }), "t2");
    recordMonitoringEvent(store, candidate("boom", { severity: "critical" }), "t3");
    const alerts = deriveTechnicalAlerts(store);
    expect(alerts[0]).toMatchObject({ severity: "critical", count: 2, time: "t3", area: "GET /api/x" });
    expect(alerts[0].explanation).toContain("Occurred 2 times");
    expect(alerts[0].suggestedAction.length).toBeGreaterThan(10);
    expect(alerts[1].severity).toBe("medium");
  });
});
