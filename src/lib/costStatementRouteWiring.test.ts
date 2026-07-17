import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Accounting Phase B — server-boundary contract pins for
 * POST /api/cost-statements/:shipmentId. The CALCULATION behavior is
 * covered by real unit tests (costStatementMath.test.ts,
 * costStatementExportView.test.ts); these pins guarantee the route
 * actually delegates to those tested helpers and keeps its identity,
 * permission, and concurrency wiring — the architectural invariants a
 * refactor must not silently drop.
 */
const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

function region(needle: string, length: number): string {
  const start = SERVER.indexOf(needle);
  expect(start, `needle not found: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(start, start + length);
}

describe("cost-statement write route — Phase B wiring", () => {
  const ROUTE = region('app.post("/api/cost-statements/:shipmentId"', 9000);

  it("keeps the super/accounts-only write gate (PR #61) and the unconditional shipment existence check (PR #106)", () => {
    expect(ROUTE).toContain("requireCanWriteCostStatements");
    expect(ROUTE).toContain('res.status(404).json({ error: "Shipment not found" })');
    expect(ROUTE).not.toContain("useMemoryFallback ?");
  });

  it("every submitted number passes through the tested validator; totals are never taken from the client", () => {
    expect(ROUTE).toContain("validateCostStatementInput(data)");
    expect(ROUTE).toContain("deriveExpenseSummary(input.totalCost, input.paidAmount)");
    expect(ROUTE).toContain("totalCost: input.totalCost");
    // The route never reads client-computed money fields directly.
    expect(ROUTE).not.toContain("data.totalCost");
    expect(ROUTE).not.toContain("data.remainingBalance");
    expect(ROUTE).not.toContain("data.paymentStatus");
    expect(ROUTE).not.toContain("Number(data.paidAmount) || 0");
  });

  it("identity and snapshots come ONLY from the authoritative shipment — including companyName", () => {
    expect(ROUTE).toContain("shipmentNumber: shipment.shipmentNumber");
    expect(ROUTE).toContain('companyName: shipment.companyName || ""');
    expect(ROUTE).toContain("agreedAmount: shipment.agreedAmount");
    expect(ROUTE).toContain("agreedCurrency: shipment.currency");
    expect(ROUTE).toContain("truckNumber: shipment.truckNumber");
    expect(ROUTE).not.toContain("data.shipmentNumber");
    expect(ROUTE).not.toContain("data.companyName");
    expect(ROUTE).not.toContain("data.agreedAmount");
    // shipmentType is derived from the shipment's freight type, not trusted.
    expect(ROUTE).toContain('shipment.freightType === "sea"');
    expect(ROUTE).not.toContain("data.shipmentType");
  });

  it("optimistic concurrency: one decision rule in both persistence modes, 409 on a stale revision", () => {
    expect(ROUTE).toContain("decideStatementRevision(stored, data.revision)");
    expect(ROUTE).toContain("runTransaction");
    expect(ROUTE).toContain("applyCostStatementRevisionedWriteMemory(");
    expect(ROUTE).toContain("CostStatementRevisionConflictError");
    expect(ROUTE).toContain("res.status(409)");
    // The 409 body carries the machine-readable code defined once in the
    // shared math module (the route re-emits err.code, never a copy).
    expect(ROUTE).toContain("code: err.code");
    const MATH = readFileSync(join(__dirname, "costStatementMath.ts"), "utf-8");
    expect(MATH).toContain('readonly code = "COST_STATEMENT_REVISION_CONFLICT"');
  });

  it("the activity log line carries no financial amounts", () => {
    const logRegion = ROUTE.slice(ROUTE.indexOf("logData"));
    expect(logRegion).not.toMatch(/totalCost|paidAmount|customerReceived|agreedAmount/);
  });
});

describe("read routes keep the PR #58 permission boundary", () => {
  it("GET list and GET by shipment both require canViewCostStatements (super/accounts only)", () => {
    expect(region('app.get("/api/cost-statements", ', 200)).toContain("requireCanViewCostStatements");
    expect(region('app.get("/api/cost-statements/:shipmentId"', 200)).toContain("requireCanViewCostStatements");
  });
});

describe("no second numbering system", () => {
  it("accounting documents display the MAR reference plainly — no derived MARAS-/INV-/CLI-/VND- reference prefixes remain", () => {
    const PANEL = readFileSync(join(__dirname, "..", "components", "AdminPanel.tsx"), "utf-8");
    expect(PANEL).not.toContain("INV-MARAS-");
    expect(PANEL).not.toContain("`Statement Ref: CLI-");
    expect(PANEL).not.toContain("`Statement Ref: VND-");
    expect(PANEL).not.toMatch(/Reference: MARAS-\$\{/);
    // The one business reference remains the shipment's own MAR number.
    expect(PANEL).toContain("— ${selectedStatement.shipmentNumber}`");
  });
});
