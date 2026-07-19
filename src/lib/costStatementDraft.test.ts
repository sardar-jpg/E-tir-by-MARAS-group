import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDraftCostStatement, type DraftShipmentSource } from "./costStatementDraft";
import { resolveAccountingStatus } from "./costApprovalWorkflow";
import { resolveStatementRevision } from "./costStatementMath";

const SHIP: DraftShipmentSource = {
  id: "shipment-1001",
  shipmentNumber: "MAR-2026-1001",
  companyName: "Acme Co",
  freightType: "land",
  agreedAmount: 5000,
  currency: "USD",
  truckNumber: "34-ABC-1234",
};
const NOW = "2026-07-19T10:30:00.000Z";

describe("draft cost statement builder (auto-created on shipment creation)", () => {
  it("links the shipment identity and MAR number, with the doc id = shipment id", () => {
    const d = buildDraftCostStatement(SHIP, NOW);
    expect(d.shipmentId).toBe("shipment-1001");
    expect(d.shipmentNumber).toBe("MAR-2026-1001");
    expect(d.companyName).toBe("Acme Co");
    expect(d.shipmentType).toBe("land");
    expect(d.truckNumber).toBe("34-ABC-1234");
  });

  it("is an empty, zeroed, editable draft — never final", () => {
    const d = buildDraftCostStatement(SHIP, NOW);
    expect(d.items).toEqual([]);
    expect(d.totalCost).toBe(0);
    expect(d.paidAmount).toBe(0);
    expect(d.remainingBalance).toBe(0);
    expect(d.paymentStatus).toBe("Unpaid");
    expect(d.customerReceivedAmount).toBe(0);
    expect(d.notes).toBe("");
    expect(resolveAccountingStatus(d as any)).toBe("draft");
    expect(d.approvalCycle).toBe(1);
    expect(d.approvalHistory).toEqual([]);
    expect(resolveStatementRevision(d)).toBe(1);
  });

  it("snapshots the customer contract (agreed amount + currency) from the shipment", () => {
    const d = buildDraftCostStatement(SHIP, NOW);
    expect(d.agreedAmount).toBe(5000);
    expect(d.agreedCurrency).toBe("USD");
    expect(d.currency).toBe("USD");
    expect(d.date).toBe("2026-07-19");
    expect(d.createdAt).toBe(NOW);
  });

  it("maps freight type and falls back to a valid cost currency", () => {
    expect(buildDraftCostStatement({ ...SHIP, freightType: "sea" }, NOW).shipmentType).toBe("sea");
    expect(buildDraftCostStatement({ ...SHIP, freightType: "air" }, NOW).shipmentType).toBe("air");
    expect(buildDraftCostStatement({ ...SHIP, freightType: undefined }, NOW).shipmentType).toBe("land");
    // An unexpected currency is coerced to USD so the statement stays valid;
    // agreedCurrency still records the shipment's own currency verbatim.
    const weird = buildDraftCostStatement({ ...SHIP, currency: "GBP" as any }, NOW);
    expect(weird.currency).toBe("USD");
    expect(weird.agreedCurrency).toBe("GBP");
  });

  it("tolerates a missing agreed amount / truck (contract-customer minimal create)", () => {
    const d = buildDraftCostStatement({ ...SHIP, agreedAmount: undefined as any, truckNumber: "" }, NOW);
    expect(d.agreedAmount).toBe(0);
    expect(d.truckNumber).toBe("");
  });
});

describe("shipment creation wires the draft cost statement (Core Business Rule)", () => {
  const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");
  const at = SERVER.indexOf("async function createShipmentRecord");
  const region = at >= 0 ? SERVER.slice(at, at + 10000) : "";

  it("createShipmentRecord builds + persists a draft under the shipment id, without duplicating an existing one", () => {
    expect(at, "createShipmentRecord must exist").toBeGreaterThan(-1);
    expect(region).toContain("buildDraftCostStatement(newShipment");
    expect(region).toContain('doc(db, "costStatements", id)');
    // No-duplicate guard: only create when one does not already exist.
    expect(region).toContain("existingStmt.exists()");
  });

  it("a draft-write failure never fails shipment creation (logged, not thrown)", () => {
    // The draft block is wrapped so the shipment (already written) is never
    // rolled back by an accounting hiccup; the lazy upsert is the fallback.
    const draftBlock = region.slice(region.indexOf("existingStmt"));
    expect(draftBlock).toContain("catch");
    expect(draftBlock).toContain("console.warn");
  });
});
