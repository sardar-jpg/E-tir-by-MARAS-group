import { describe, it, expect } from "vitest";
import {
  recordMonitoringEvent,
  classifyRequestForMonitoring,
  deriveTechnicalAlerts,
  normalizeMonitoringPath,
  MONITORING_MAX_EVENTS,
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
