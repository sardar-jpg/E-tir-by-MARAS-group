import { describe, it, expect } from "vitest";
import {
  detectMarasAiIntents,
  requiredDataForIntents,
  assessShipmentDelay,
  buildDelayedShipmentsAiContext,
  buildShipmentsOverviewAiContext,
  buildDriverPerformanceAiContext,
  buildMissingDocumentsAiContext,
  buildTodaysOperationsAiContext,
  buildAccountingAiContext,
  buildSystemContextBlocks,
  resolveMarasAiResponseSource,
  deriveMarasAiAttention,
  buildStructuredMarasAiResults,
  buildMonitoringAlertsResult,
  MARAS_AI_MAX_CARD_ITEMS,
  MARAS_AI_SOURCE_LABELS,
  MARAS_AI_QUICK_SUGGESTIONS,
  DELAYED_STALE_DAYS,
} from "./marasAiIntents";
import type { AppNotification, CostStatement, Driver, Shipment } from "../types";

const NOW = "2026-07-18T12:00:00Z";

const shipment = (over: Partial<Shipment>): Shipment =>
  ({
    id: "s1",
    shipmentNumber: "MAR-2026-1001",
    status: "In Transit",
    loadingCity: "Mersin",
    deliveryCity: "Erbil",
    companyName: "Client Ltd",
    assignedDriverId: "d1",
    assignedDriverName: "Murat",
    createdAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z",
    documents: [],
    // Secrets that must NEVER surface in any digest:
    shareToken: "SECRET-SHARE-TOKEN-XYZ",
    isLinkShared: true,
    ...over,
  }) as unknown as Shipment;

describe("detectMarasAiIntents — the request is inspected BEFORE any prompt is built", () => {
  it("recognizes each operational intent from natural phrasings", () => {
    expect(detectMarasAiIntents("Which shipments are delayed?")).toContain("delayed_shipments");
    expect(detectMarasAiIntents("Which drivers have the most delayed deliveries?")).toContain("driver_performance");
    expect(detectMarasAiIntents("Show missing shipment documents")).toContain("missing_documents");
    expect(detectMarasAiIntents("Summarize today's operations.")).toContain("todays_operations");
    expect(detectMarasAiIntents("Review monitoring alerts")).toContain("monitoring_alerts");
    expect(detectMarasAiIntents("Summarize unpaid cost statements")).toContain("accounting_summary");
    expect(detectMarasAiIntents("Review current operational risks")).toContain("operational_risks");
    expect(detectMarasAiIntents("Give me an overview of all current shipments")).toContain("shipments_overview");
  });

  it("a general-knowledge question detects no system intent (pure AI Analysis)", () => {
    expect(detectMarasAiIntents("What does CMR stand for in international transport law?")).not.toContain("delayed_shipments");
    expect(detectMarasAiIntents("Hello, how are you?")).toEqual([]);
  });

  it("maps intents to exactly the backend data they need", () => {
    expect(requiredDataForIntents(["delayed_shipments"])).toMatchObject({ shipments: true, drivers: false, costStatements: false, monitoring: false });
    expect(requiredDataForIntents(["driver_performance"])).toMatchObject({ drivers: true, shipments: true });
    expect(requiredDataForIntents(["monitoring_alerts"])).toMatchObject({ monitoring: true, shipments: false });
    expect(requiredDataForIntents(["accounting_summary"])).toMatchObject({ costStatements: true });
    expect(requiredDataForIntents([])).toEqual({ shipments: false, drivers: false, notifications: false, costStatements: false, monitoring: false });
  });
});

describe("delay heuristic", () => {
  it("flags an active shipment with no status change for the stale window", () => {
    const stale = shipment({ updatedAt: "2026-07-10T00:00:00Z" }); // 8 days
    const a = assessShipmentDelay(stale, NOW);
    expect(a.delayed).toBe(true);
    expect(a.reason).toContain("no status change");
    expect(a.daysSinceUpdate).toBeGreaterThanOrEqual(DELAYED_STALE_DAYS);
  });

  it("flags a passed ETA while still en route; never flags finished or pre-dispatch shipments", () => {
    expect(assessShipmentDelay(shipment({ eta: "2026-07-15T00:00:00Z", updatedAt: "2026-07-18T00:00:00Z" }), NOW).delayed).toBe(true);
    expect(assessShipmentDelay(shipment({ status: "Delivered", updatedAt: "2026-06-01T00:00:00Z" }), NOW).delayed).toBe(false);
    expect(assessShipmentDelay(shipment({ status: "New", updatedAt: "2026-06-01T00:00:00Z" }), NOW).delayed).toBe(false);
    expect(assessShipmentDelay(shipment({ updatedAt: "2026-07-17T00:00:00Z" }), NOW).delayed).toBe(false);
  });
});

describe("shipment analysis digests — real data in, whitelist out", () => {
  const fleet = [
    shipment({ id: "s1", shipmentNumber: "MAR-2026-1001", updatedAt: "2026-07-08T00:00:00Z" }), // stale -> delayed
    shipment({ id: "s2", shipmentNumber: "MAR-2026-1002", updatedAt: "2026-07-17T20:00:00Z" }), // fresh
    shipment({ id: "s3", shipmentNumber: "MAR-2026-1003", status: "Delivered" }),
  ];

  it("the delayed digest names the delayed shipment with its reason — the AI never has to ask for data", () => {
    const ctx = buildDelayedShipmentsAiContext(fleet, NOW);
    expect(ctx).toContain("MAR-2026-1001");
    expect(ctx).toContain("no status change");
    expect(ctx).not.toContain("MAR-2026-1002");
  });

  it("says plainly when nothing is delayed", () => {
    expect(buildDelayedShipmentsAiContext([fleet[1]], NOW)).toContain("none of the 1 shipments");
  });

  it("overview digest counts statuses and lists active shipments", () => {
    const ctx = buildShipmentsOverviewAiContext(fleet);
    expect(ctx).toContain("3 total");
    expect(ctx).toContain("In Transit: 2");
    expect(ctx).toContain("Delivered: 1");
    expect(ctx).not.toContain("MAR-2026-1003"); // terminal shipments aren't in the active list
  });

  it("driver performance aggregates active/delayed/completed per driver from real records", () => {
    const drivers = [
      { id: "d1", name: "Murat", truckNumber: "33 ABC 123", completedShipmentsCount: 12 } as Driver,
      { id: "d2", name: "Ali", truckNumber: "34 XYZ 987", completedShipmentsCount: 3 } as Driver,
    ];
    const ctx = buildDriverPerformanceAiContext(drivers, fleet, NOW);
    expect(ctx).toContain("Murat");
    expect(ctx).toContain("active 2, delayed 1, completed 12");
    expect(ctx).toContain("Ali");
  });

  it("missing-documents digest flags active shipments with no documents on file", () => {
    const withDocs = shipment({ id: "s4", shipmentNumber: "MAR-2026-1004", documents: [{ id: "d", category: "cmr", name: "cmr.pdf" }] as Shipment["documents"] });
    const ctx = buildMissingDocumentsAiContext([fleet[0], withDocs]);
    expect(ctx).toContain("MAR-2026-1001 (In Transit): NO documents on file");
    expect(ctx).toContain("1 document(s): cmr");
  });

  it("today's operations digest partitions created/updated today and counts notifications", () => {
    const today = shipment({ id: "s5", shipmentNumber: "MAR-2026-1005", createdAt: "2026-07-18T08:00:00Z", updatedAt: "2026-07-18T08:00:00Z" });
    const notifs = [
      { id: "n1", type: "status_update", timestamp: "2026-07-18T09:00:00Z" } as AppNotification,
      { id: "n2", type: "status_update", timestamp: "2026-07-17T09:00:00Z" } as AppNotification,
    ];
    const ctx = buildTodaysOperationsAiContext([today, fleet[0]], notifs, NOW);
    expect(ctx).toContain("created today (1)");
    expect(ctx).toContain("MAR-2026-1005");
    expect(ctx).toContain("status_update: 1");
  });

  it("accounting digest totals by currency and lists open statements", () => {
    const statements = [
      { shipmentId: "s1", shipmentNumber: "MAR-2026-1001", currency: "USD", totalCost: 4000, paidAmount: 1000, remainingBalance: 3000, paymentStatus: "Partial", customerReceivedAmount: 2500 } as CostStatement,
      { shipmentId: "s2", shipmentNumber: "MAR-2026-1002", currency: "USD", totalCost: 1000, paidAmount: 1000, remainingBalance: 0, paymentStatus: "Paid" } as CostStatement,
    ];
    const ctx = buildAccountingAiContext(statements);
    expect(ctx).toContain("USD (2 statements): total cost 5000, expenses paid 2000, remaining 3000, received from customers 2500");
    expect(ctx).toContain("Partial: 1");
    expect(ctx).toContain("MAR-2026-1001: total 4000 USD");
    expect(ctx).not.toContain("MAR-2026-1002: total"); // fully paid — not an open statement
  });

  it("NO digest ever contains share tokens or credential material", () => {
    const blocks = buildSystemContextBlocks(
      ["delayed_shipments", "shipments_overview", "missing_documents", "todays_operations", "operational_risks"],
      { shipments: fleet, notifications: [] },
      NOW
    );
    for (const b of blocks) {
      expect(b).not.toContain("SECRET-SHARE-TOKEN-XYZ");
      expect(b.toLowerCase()).not.toContain("sharetoken");
    }
  });

  it("dispatch builds one block per intent (deduplicated) and leaves monitoring to the server's super gate", () => {
    const blocks = buildSystemContextBlocks(["delayed_shipments", "operational_risks", "monitoring_alerts"], { shipments: fleet }, NOW);
    // operational_risks re-uses the delayed digest — kept once — plus the
    // missing-documents digest; monitoring adds nothing here.
    expect(blocks.filter((b) => b.includes("delayed shipments"))).toHaveLength(1);
    expect(blocks.some((b) => b.includes("documents on file"))).toBe(true);
    expect(blocks.some((b) => b.toLowerCase().includes("monitoring"))).toBe(false);
  });
});

describe("response source indicator — honest, never faked", () => {
  it("derives the three sources from what actually happened", () => {
    expect(resolveMarasAiResponseSource({ usedSystemData: true, usedAiModel: true })).toBe("system_data_ai_analysis");
    expect(resolveMarasAiResponseSource({ usedSystemData: false, usedAiModel: true })).toBe("ai_analysis");
    expect(resolveMarasAiResponseSource({ usedSystemData: true, usedAiModel: false })).toBe("system_data");
  });

  it("labels read exactly as specified", () => {
    expect(MARAS_AI_SOURCE_LABELS.system_data).toBe("System Data");
    expect(MARAS_AI_SOURCE_LABELS.ai_analysis).toBe("AI Analysis");
    expect(MARAS_AI_SOURCE_LABELS.system_data_ai_analysis).toBe("System Data + AI Analysis");
  });
});

describe("structured results (PR #130) — typed cards from system data, never parsed from Markdown", () => {
  const fleet2 = [
    shipment({ id: "s1", shipmentNumber: "MAR-2026-1001", updatedAt: "2026-07-08T00:00:00Z", documents: [{ id: "d1", category: "cmr", name: "cmr.pdf" }] as Shipment["documents"] }), // stale -> delayed, has docs
    shipment({ id: "s2", shipmentNumber: "MAR-2026-1002", updatedAt: "2026-07-17T20:00:00Z", documents: [] }), // fresh, no docs
    shipment({ id: "s3", shipmentNumber: "MAR-2026-1003", status: "Delivered" }),
  ];

  it("delayed_shipments builds shipment cards with id, number, status, route, driver, customer, reason, severity", () => {
    const [r] = buildStructuredMarasAiResults(["delayed_shipments"], { shipments: fleet2 }, NOW);
    expect(r.responseType).toBe("delayed_shipments");
    if (r.responseType !== "delayed_shipments") return;
    expect(r.totalCount).toBe(1);
    expect(r.shipments[0]).toMatchObject({
      id: "s1",
      shipmentNumber: "MAR-2026-1001",
      status: "In Transit",
      originCity: "Mersin",
      destinationCity: "Erbil",
      driverName: "Murat",
      companyName: "Client Ltd",
      severity: "critical",
    });
    expect(r.shipments[0].reason).toContain("no status change");
  });

  it("multiple intents -> multiple card sets; overview marks delayed rows as warnings", () => {
    const results = buildStructuredMarasAiResults(["delayed_shipments", "shipments_overview", "missing_documents"], { shipments: fleet2 }, NOW);
    expect(results.map((r) => r.responseType)).toEqual(["delayed_shipments", "shipments_overview", "missing_documents"]);
    const overview = results[1];
    if (overview.responseType === "shipments_overview") {
      expect(overview.totalCount).toBe(2); // terminal shipment excluded
      const delayedRow = overview.shipments.find((s) => s.id === "s1");
      expect(delayedRow?.severity).toBe("warning");
      expect(overview.shipments.find((s) => s.id === "s2")?.severity).toBe("info");
    }
    const missing = results[2];
    if (missing.responseType === "missing_documents") {
      expect(missing.shipments.map((s) => s.id)).toEqual(["s2"]);
      expect(missing.shipments[0].reason).toBe("No documents on file");
    }
  });

  it("driver_performance builds per-driver rows from real records", () => {
    const drivers = [{ id: "d1", name: "Murat", truckNumber: "33 ABC 123", completedShipmentsCount: 12 } as Driver];
    const [r] = buildStructuredMarasAiResults(["driver_performance"], { shipments: fleet2, drivers }, NOW);
    if (r.responseType === "driver_performance") {
      expect(r.drivers[0]).toMatchObject({ driverName: "Murat", truckNumber: "33 ABC 123", activeCount: 2, delayedCount: 1, completedCount: 12 });
    } else {
      throw new Error("expected driver_performance");
    }
  });

  it("caps card items and reports the real total", () => {
    const many = Array.from({ length: 30 }, (_, i) => shipment({ id: `s${i}`, shipmentNumber: `MAR-${i}`, updatedAt: "2026-07-01T00:00:00Z" }));
    const [r] = buildStructuredMarasAiResults(["delayed_shipments"], { shipments: many }, NOW);
    if (r.responseType === "delayed_shipments") {
      expect(r.shipments).toHaveLength(MARAS_AI_MAX_CARD_ITEMS);
      expect(r.totalCount).toBe(30);
    }
  });

  it("cards never contain secrets and monitoring is left to the server's super gate", () => {
    const results = buildStructuredMarasAiResults(["delayed_shipments", "monitoring_alerts"], { shipments: fleet2 }, NOW);
    expect(JSON.stringify(results)).not.toContain("SECRET-SHARE-TOKEN-XYZ");
    expect(results.some((r) => r.responseType === "monitoring_alerts")).toBe(false);
    const alerts = buildMonitoringAlertsResult([
      { title: "Slow API request", severity: "medium", area: "GET /api/x", count: 4, time: "t", explanation: "e", suggestedAction: "Profile it." },
    ]);
    expect(alerts).toMatchObject({ responseType: "monitoring_alerts", totalCount: 1 });
    if (alerts.responseType === "monitoring_alerts") {
      expect(alerts.alerts[0]).toMatchObject({ title: "Slow API request", severity: "medium", count: 4, suggestedAction: "Profile it." });
    }
  });
});

describe("attention badge — system data only, never the AI provider", () => {
  const healthy = shipment({ id: "h", updatedAt: "2026-07-18T08:00:00Z", documents: [{ id: "d", category: "cmr", name: "cmr.pdf" }] as Shipment["documents"] });

  it("delayed shipments raise attention using the SAME shared delay heuristic", () => {
    const a = deriveMarasAiAttention({ shipments: [healthy, shipment({ id: "late", updatedAt: "2026-07-08T00:00:00Z", documents: [{ id: "d" }] as Shipment["documents"] })], nowIso: NOW });
    expect(a).toMatchObject({ needsAttention: true, delayedCount: 1, missingDocumentsCount: 0, criticalAlertCount: 0 });
  });

  it("a dispatched shipment with zero documents raises attention; pre-dispatch and finished ones never do", () => {
    const noDocs = shipment({ id: "nd", updatedAt: "2026-07-18T08:00:00Z", documents: [] });
    const brandNew = shipment({ id: "new", status: "New", documents: [] });
    const done = shipment({ id: "done", status: "Delivered", documents: [], updatedAt: "2026-01-01T00:00:00Z" });
    const a = deriveMarasAiAttention({ shipments: [noDocs, brandNew, done], nowIso: NOW });
    expect(a.missingDocumentsCount).toBe(1);
    expect(a.delayedCount).toBe(0);
  });

  it("high/critical monitoring alerts count; low/medium do not", () => {
    const a = deriveMarasAiAttention({ shipments: [], monitoringAlertSeverities: ["medium", "high", "critical", "low"], nowIso: NOW });
    expect(a).toMatchObject({ needsAttention: true, criticalAlertCount: 2 });
  });

  it("nothing actionable -> no badge, and the signature changes only when the actionable set changes", () => {
    const calm = deriveMarasAiAttention({ shipments: [healthy], nowIso: NOW });
    expect(calm.needsAttention).toBe(false);
    const one = deriveMarasAiAttention({ shipments: [healthy, shipment({ id: "late", updatedAt: "2026-07-08T00:00:00Z", documents: [{ id: "d" }] as Shipment["documents"] })], nowIso: NOW });
    expect(one.signature).not.toBe(calm.signature);
    // Same actionable set twice -> same signature (dismissal stays effective).
    const again = deriveMarasAiAttention({ shipments: [healthy, shipment({ id: "late", updatedAt: "2026-07-08T00:00:00Z", documents: [{ id: "d" }] as Shipment["documents"] })], nowIso: NOW });
    expect(again.signature).toBe(one.signature);
  });
});

describe("quick suggestions", () => {
  it("offers the specified operational starters, each with a prompt the intent detector understands", () => {
    const labels = MARAS_AI_QUICK_SUGGESTIONS.map((s) => s.label);
    expect(labels).toContain("Show delayed shipments");
    expect(labels).toContain("Summarize today's operations");
    expect(labels).toContain("Review monitoring alerts");
    expect(labels).toContain("Check missing documents");
    expect(labels).toContain("Review operational risks");
    expect(labels).toContain("Summarize dashboard");
    expect(labels).toContain("Review driver performance");
    // Every suggestion's prompt triggers at least one system-data intent —
    // a suggestion that produced a data-less prompt would be a fake.
    for (const s of MARAS_AI_QUICK_SUGGESTIONS) {
      expect(detectMarasAiIntents(s.prompt).length, `suggestion ${s.id} must map to an intent`).toBeGreaterThan(0);
    }
  });
});
