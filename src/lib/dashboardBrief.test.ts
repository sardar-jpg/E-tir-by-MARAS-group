import { describe, it, expect } from "vitest";
import {
  buildDashboardAttentionKpis,
  buildDeterministicBrief,
  buildBriefAiDigest,
  briefScopeKeyFor,
} from "./dashboardBrief";
import type { Shipment } from "../types";
import type { AuditPrioritySummary } from "./auditEngine";

const NOW = "2026-07-18T12:00:00Z";

const shipment = (over: Partial<Shipment>): Shipment =>
  ({
    id: "s1",
    shipmentNumber: "MAR-2026-1001",
    status: "In Transit",
    freightType: "land",
    assignedDriverId: "d1",
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-17T22:00:00Z",
    documents: [{ id: "d", category: "cmr", name: "c.pdf" }],
    shareToken: "SECRET-SHARE-TOKEN-XYZ",
    ...over,
  }) as unknown as Shipment;

const noPriorities: AuditPrioritySummary = { critical_now: 0, high_today: 0, medium_soon: 0, low_monitor: 0 };

describe("buildDashboardAttentionKpis — authoritative derived counts, shared heuristics", () => {
  it("counts delayed (shared heuristic), missing docs, unassigned land, in transit, delivered today", () => {
    const kpis = buildDashboardAttentionKpis(
      [
        shipment({ id: "a" }), // healthy in transit
        shipment({ id: "b", updatedAt: "2026-07-10T00:00:00Z" }), // stale -> delayed
        shipment({ id: "c", documents: [] }), // dispatched, no docs
        shipment({ id: "d", assignedDriverId: "" }), // land, no driver
        shipment({ id: "e", status: "Delivered", updatedAt: "2026-07-18T09:00:00Z" }), // delivered today
        shipment({ id: "f", status: "Delivered", updatedAt: "2026-07-01T00:00:00Z" }), // delivered earlier
        shipment({ id: "g", status: "New", documents: [], assignedDriverId: "" }), // pre-dispatch: never counted
      ],
      NOW
    );
    expect(kpis).toEqual({ delayedShipments: 1, missingDocuments: 1, unassignedShipments: 1, inTransit: 4, deliveredToday: 1 });
  });
});

describe("buildDeterministicBrief — worst first, scope-redacted, never invented", () => {
  const kpis = { delayedShipments: 2, missingDocuments: 1, unassignedShipments: 0, inTransit: 5, deliveredToday: 3 };

  it("orders priorities worst-first and mirrors them into recommended actions", () => {
    const brief = buildDeterministicBrief({
      kpis,
      prioritySummary: { critical_now: 1, high_today: 2, medium_soon: 0, low_monitor: 4 },
      accountingOpenCount: 3,
      securityTechnicalOpenCount: 1,
    });
    expect(brief.status).toBe("action_needed");
    expect(brief.priorities.map((p) => p.kind)).toEqual([
      "critical_findings",
      "high_findings",
      "delayed_shipments",
      "missing_documents",
      "security_technical_open",
      "accounting_open",
    ]);
    expect(brief.recommendedActions).toEqual(brief.priorities.map((p) => p.kind));
    // Zero-count concerns never appear (unassigned = 0).
    expect(brief.priorities.some((p) => p.kind === "unassigned_shipments")).toBe(false);
  });

  it("restricted categories passed as null NEVER appear (operation admin view)", () => {
    const brief = buildDeterministicBrief({ kpis, prioritySummary: noPriorities, accountingOpenCount: null, securityTechnicalOpenCount: null });
    for (const p of brief.priorities) {
      expect(["accounting_open", "security_technical_open"]).not.toContain(p.kind);
    }
    expect(brief.status).toBe("attention");
  });

  it("a clean system is honestly all_clear with zero priorities", () => {
    const brief = buildDeterministicBrief({
      kpis: { delayedShipments: 0, missingDocuments: 0, unassignedShipments: 0, inTransit: 2, deliveredToday: 1 },
      prioritySummary: noPriorities,
      accountingOpenCount: 0,
      securityTechnicalOpenCount: 0,
    });
    expect(brief).toMatchObject({ status: "all_clear", priorities: [], recommendedActions: [] });
  });
});

describe("AI digest — the complete, minimal payload", () => {
  it("contains only the deterministic counts and the never-invent instruction", () => {
    const brief = buildDeterministicBrief({
      kpis: { delayedShipments: 2, missingDocuments: 0, unassignedShipments: 0, inTransit: 5, deliveredToday: 3 },
      prioritySummary: { critical_now: 1, high_today: 0, medium_soon: 0, low_monitor: 0 },
      accountingOpenCount: null,
      securityTechnicalOpenCount: null,
    });
    const digest = buildBriefAiDigest(brief);
    expect(digest).toContain("never invent findings");
    expect(digest).toContain("delayed=2");
    expect(digest).toContain("critical=1");
    expect(digest).not.toContain("SECRET");
    expect(digest.length).toBeLessThan(900); // minimum-necessary: a digest, never a dataset
  });
});

describe("briefScopeKeyFor — one cache per role scope", () => {
  it("maps the three admin tiers and rejects everything else", () => {
    expect(briefScopeKeyFor("super")).toBe("super");
    expect(briefScopeKeyFor("operation")).toBe("operation");
    expect(briefScopeKeyFor("accounts")).toBe("accounts");
    expect(briefScopeKeyFor("driver")).toBeNull();
    expect(briefScopeKeyFor("")).toBeNull();
  });
});
