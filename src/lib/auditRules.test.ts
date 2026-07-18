import { describe, it, expect } from "vitest";
import { AUDIT_RULES, ASSIGNED_NOT_ACCEPTED_DAYS, STALE_GPS_HOURS } from "./auditRules";
import { runAuditRules, type AuditContext } from "./auditEngine";
import type { CostStatement, Driver, Shipment } from "../types";

const NOW = "2026-07-18T12:00:00Z";

const healthyShipment = (over: Partial<Shipment> = {}): Shipment =>
  ({
    id: "s-ok",
    shipmentNumber: "MAR-2026-1001",
    status: "In Transit",
    freightType: "land",
    loadingCity: "Mersin",
    deliveryCity: "Erbil",
    companyName: "Client Ltd",
    assignedDriverId: "d1",
    assignedDriverName: "Murat",
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-17T22:00:00Z",
    documents: [{ id: "doc1", category: "cmr", name: "cmr.pdf" }],
    timeline: [],
    internalNotes: "priority",
    shareToken: "SECRET-SHARE-TOKEN-XYZ",
    ...over,
  }) as unknown as Shipment;

const healthyDriver = (over: Partial<Driver> = {}): Driver =>
  ({ id: "d1", name: "Murat", username: "murat", truckNumber: "33 A 1", phone: "1", activeShipmentsCount: 1, completedShipmentsCount: 5, lastUpdated: "2026-07-18T11:00:00Z", ...over }) as Driver;

const healthyStatement = (over: Partial<CostStatement> = {}): CostStatement =>
  ({
    shipmentId: "s-done",
    shipmentNumber: "MAR-2026-0900",
    companyName: "Client Ltd",
    shipmentType: "land",
    date: "2026-07-01",
    currency: "USD",
    totalCost: 100,
    paidAmount: 100,
    remainingBalance: 0,
    paymentStatus: "Paid",
    customerReceivedAmount: 500,
    agreedAmount: 500,
    notes: "",
    items: [{ id: "i1", costType: "fuel", description: "Fuel", quantity: 1, unitPrice: 100, totalAmount: 100, currency: "USD", supplierName: "Petrol Ofisi" }],
    createdAt: "t",
    updatedAt: "t",
    ...over,
  }) as CostStatement;

const ctx = (over: Partial<AuditContext> = {}): AuditContext => ({
  nowIso: NOW,
  shipments: [healthyShipment(), healthyShipment({ id: "s-done", shipmentNumber: "MAR-2026-0900", status: "Delivered", updatedAt: "2026-07-17T00:00:00Z" })],
  drivers: [healthyDriver()],
  clients: [],
  vendors: [],
  admins: [{ id: "a1", name: "Sardar", email: "sardar@maras.iq", adminType: "super" }],
  costStatements: [healthyStatement()],
  notifications: [],
  activityLogs: [],
  monitoringEvents: [],
  environment: { isProduction: true, memoryFallback: false, lastSuccessfulRunAt: NOW },
  ...over,
});

const idsOf = (context: AuditContext) => {
  const { detections, ruleResults } = runAuditRules(AUDIT_RULES, context);
  expect(ruleResults.every((r) => r.ok), `failed rules: ${ruleResults.filter((r) => !r.ok).map((r) => r.ruleId + ":" + r.error).join(", ")}`).toBe(true);
  return detections.map((d) => d.rule.id);
};

describe("audit rules — healthy system baseline", () => {
  it("a fully healthy snapshot produces ZERO findings across all rules", () => {
    expect(idsOf(ctx())).toEqual([]);
  });
});

describe("operations rules", () => {
  it("OPS-001 stale status / OPS-002 ETA passed reuse the shared delay heuristic", () => {
    expect(idsOf(ctx({ shipments: [healthyShipment({ updatedAt: "2026-07-10T00:00:00Z" })] }))).toContain("OPS-001");
    expect(idsOf(ctx({ shipments: [healthyShipment({ eta: "2026-07-15T00:00:00Z" })] }))).toContain("OPS-002");
  });

  it("OPS-003 driverless active land shipment; OPS-004/005 stuck Assigned/Accepted", () => {
    expect(idsOf(ctx({ shipments: [healthyShipment({ assignedDriverId: "" })] }))).toContain("OPS-003");
    const stuckSince = new Date(new Date(NOW).getTime() - (ASSIGNED_NOT_ACCEPTED_DAYS + 1) * 86400000).toISOString();
    expect(idsOf(ctx({ shipments: [healthyShipment({ status: "Assigned", updatedAt: stuckSince })] }))).toContain("OPS-004");
    expect(idsOf(ctx({ shipments: [healthyShipment({ status: "Accepted", updatedAt: stuckSince })] }))).toContain("OPS-005");
  });

  it("OPS-006 status outside freight-mode sequence (sea status on a land shipment)", () => {
    expect(idsOf(ctx({ shipments: [healthyShipment({ status: "Loaded on Vessel" })] }))).toContain("OPS-006");
  });

  it("OPS-007/008 delivered-document rules; OPS-009 incomplete multi-assignment; OPS-010 stale GPS", () => {
    const delivered = healthyShipment({ id: "s-done", status: "Delivered", documents: [] });
    expect(idsOf(ctx({ shipments: [delivered], costStatements: [healthyStatement()] }))).toContain("OPS-007");
    const noPod = healthyShipment({ id: "s-done", status: "Delivered", documents: [{ id: "x", category: "invoice", name: "inv.pdf" }] as unknown as Shipment["documents"] });
    expect(idsOf(ctx({ shipments: [noPod], costStatements: [healthyStatement()] }))).toContain("OPS-008");
    expect(idsOf(ctx({ shipments: [healthyShipment({ additionalDrivers: [{ driverId: "", driverName: "X", truckNumber: "" }] })] }))).toContain("OPS-009");
    const staleGps = new Date(new Date(NOW).getTime() - (STALE_GPS_HOURS + 1) * 3600000).toISOString();
    expect(idsOf(ctx({ drivers: [healthyDriver({ lastUpdated: staleGps })] }))).toContain("OPS-010");
  });
});

describe("accounting rules", () => {
  it("ACC-001 finished shipment without statement; ACC-002 empty statement", () => {
    expect(idsOf(ctx({ costStatements: [] }))).toContain("ACC-001");
    expect(idsOf(ctx({ costStatements: [healthyStatement({ items: [], totalCost: 0, paidAmount: 0, remainingBalance: 0, paymentStatus: "Unpaid" })] })).filter((id) => id.startsWith("ACC"))).toContain("ACC-002");
  });

  it("ACC-003/004/005 item-level checks", () => {
    const bad = healthyStatement({
      items: [
        { id: "i1", costType: "fuel", description: "", quantity: 1, unitPrice: 50, totalAmount: 50, currency: "XXX" as CostStatement["currency"], supplierName: "" },
        { id: "i2", costType: "toll", description: "Toll", quantity: 1, unitPrice: 25, totalAmount: 25, currency: "USD", supplierName: "Roads" },
        { id: "i3", costType: "toll", description: "toll", quantity: 1, unitPrice: 25, totalAmount: 25, currency: "USD", supplierName: "Roads" },
      ],
      totalCost: 100,
    });
    const ids = idsOf(ctx({ costStatements: [bad] }));
    expect(ids).toContain("ACC-003");
    expect(ids).toContain("ACC-004");
    expect(ids).toContain("ACC-005");
  });

  it("ACC-006 revenue missing; ACC-007 totals mismatch; ACC-008 balance mismatch; ACC-009 status contradiction", () => {
    expect(idsOf(ctx({ costStatements: [healthyStatement({ customerReceivedAmount: 0 })] }))).toContain("ACC-006");
    expect(idsOf(ctx({ costStatements: [healthyStatement({ totalCost: 999 })] }))).toContain("ACC-007");
    expect(idsOf(ctx({ costStatements: [healthyStatement({ remainingBalance: 42 })] }))).toContain("ACC-008");
    expect(idsOf(ctx({ costStatements: [healthyStatement({ paymentStatus: "Paid", paidAmount: 10, remainingBalance: 90 })] }))).toContain("ACC-009");
  });

  it("ACC-010 orphaned statement; ACC-011 accounting not closed weeks after delivery", () => {
    expect(idsOf(ctx({ costStatements: [healthyStatement({ shipmentId: "ghost" })] }))).toContain("ACC-010");
    const oldDelivery = healthyShipment({ id: "s-done", status: "Delivered", updatedAt: "2026-06-01T00:00:00Z", documents: [{ id: "d", category: "pod", name: "pod.pdf" }] as unknown as Shipment["documents"] });
    expect(idsOf(ctx({ shipments: [oldDelivery], costStatements: [healthyStatement({ paymentStatus: "Partial", paidAmount: 40, remainingBalance: 60 })] }))).toContain("ACC-011");
  });

  it("every accounting rule is scoped to accounting — never visible to operations", () => {
    for (const r of AUDIT_RULES.filter((r) => r.category === "accounting")) expect(r.scope).toBe("accounting");
  });
});

describe("data-integrity rules", () => {
  it("INT-001 duplicate order numbers; INT-002 non-canonical; INT-003 missing driver; INT-004 unknown status; INT-005 impossible timestamps", () => {
    const dupA = healthyShipment({ id: "a" });
    const dupB = healthyShipment({ id: "b" });
    expect(idsOf(ctx({ shipments: [dupA, dupB] }))).toContain("INT-001");
    expect(idsOf(ctx({ shipments: [healthyShipment({ shipmentNumber: "ORDER-7" })] }))).toContain("INT-002");
    expect(idsOf(ctx({ shipments: [healthyShipment({ assignedDriverId: "ghost" })] }))).toContain("INT-003");
    expect(idsOf(ctx({ shipments: [healthyShipment({ status: "Teleporting" as Shipment["status"] })] }))).toContain("INT-004");
    expect(idsOf(ctx({ shipments: [healthyShipment({ createdAt: "2026-07-17T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" })] }))).toContain("INT-005");
  });
});

describe("security rules — Super Admin scope only", () => {
  it("SEC-001 missing role; SEC-002 duplicate email; SEC-004 credential pattern (value NEVER included)", () => {
    expect(idsOf(ctx({ admins: [{ id: "x" }] }))).toContain("SEC-001");
    expect(idsOf(ctx({ admins: [
      { id: "x", email: "same@maras.iq", adminType: "operation" },
      { id: "y", email: "SAME@maras.iq", adminType: "operation" },
      { id: "a1", email: "sardar@maras.iq", adminType: "super" },
    ] }))).toContain("SEC-002");
    const leaky = ctx({ shipments: [healthyShipment({ internalNotes: "key is sk-abcdefghij1234567890XYZ do not share" })] });
    const { detections } = runAuditRules(AUDIT_RULES, leaky);
    const sec = detections.filter((d) => d.rule.id === "SEC-004");
    expect(sec).toHaveLength(1);
    expect(sec[0].detection.evidence).not.toContain("sk-abcdefghij"); // redacted by construction
  });

  it("all security rules are super-scope", () => {
    for (const r of AUDIT_RULES.filter((r) => r.category === "security")) expect(r.scope).toBe("super");
  });
});

describe("technical rules", () => {
  it("TEC-001 mirrors monitoring groups; TEC-002 flags production memory fallback as critical; TEC-003 stale audits", () => {
    const events = [{ key: "k", kind: "server_error" as const, severity: "critical" as const, area: "GET /api/x", title: "Server error 500", detail: "boom", count: 9, firstAt: "t", lastAt: "t" }];
    const { detections } = runAuditRules(AUDIT_RULES, ctx({ monitoringEvents: events }));
    const tec = detections.find((d) => d.rule.id === "TEC-001");
    expect(tec?.detection.severity).toBe("critical");
    const mem = runAuditRules(AUDIT_RULES, ctx({ environment: { isProduction: true, memoryFallback: true, lastSuccessfulRunAt: NOW } }));
    expect(mem.detections.map((d) => d.rule.id)).toContain("TEC-002");
    const stale = runAuditRules(AUDIT_RULES, ctx({ environment: { isProduction: true, memoryFallback: false, lastSuccessfulRunAt: "2026-07-10T00:00:00Z" } }));
    expect(stale.detections.map((d) => d.rule.id)).toContain("TEC-003");
  });
});

describe("registry hygiene", () => {
  it("rule ids are unique and every rule carries the full typed metadata", () => {
    const ids = AUDIT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of AUDIT_RULES) {
      expect(r.title.length).toBeGreaterThan(3);
      expect(r.recommendedAction.length).toBeGreaterThan(10);
      expect(["operations", "accounting", "data_integrity", "security", "technical"]).toContain(r.category);
      expect(["super", "operations", "accounting"]).toContain(r.scope);
    }
  });

  it("no rule's evidence ever contains the share token (secrets are never read)", () => {
    const broken = ctx({
      shipments: [
        healthyShipment({ updatedAt: "2026-07-01T00:00:00Z", documents: [], assignedDriverId: "ghost", shipmentNumber: "BAD-1" }),
        healthyShipment({ id: "s2", shipmentNumber: "BAD-1", status: "Teleporting" as Shipment["status"] }),
      ],
      costStatements: [healthyStatement({ shipmentId: "ghost", totalCost: 999, remainingBalance: 5, paymentStatus: "Paid" })],
    });
    const { detections } = runAuditRules(AUDIT_RULES, broken);
    expect(detections.length).toBeGreaterThan(5);
    for (const d of detections) {
      expect(d.detection.evidence).not.toContain("SECRET-SHARE-TOKEN-XYZ");
      expect(d.detection.evidence.toLowerCase()).not.toContain("sharetoken");
    }
  });
});
