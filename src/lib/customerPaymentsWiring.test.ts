import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring pins for Customer Payments + allocation routes. Internal-only,
 * server-authoritative allocation/summary, reversal-not-delete.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

describe("customer payment routes — permissions + lifecycle", () => {
  it("reads require accounting view; record/allocate/reverse require accounting write", () => {
    expect(SERVER).toContain('app.get("/api/customer-accounts/invoices", requireCanViewCostStatements');
    expect(SERVER).toContain('app.get("/api/customer-accounts/payments", requireCanViewCostStatements');
    expect(SERVER).toContain('app.post("/api/customer-accounts/payments", requireCanWriteCostStatements');
    expect(SERVER).toContain('app.post("/api/customer-accounts/payments/:paymentId/allocate", requireCanWriteCostStatements');
    expect(SERVER).toContain('app.post("/api/customer-accounts/payments/:paymentId/reverse", requireCanWriteCostStatements');
  });
  it("allocation + summary + guards come from the pure module", () => {
    expect(SERVER).toContain("autoAllocate(");
    expect(SERVER).toContain("validateAllocations({");
    expect(SERVER).toContain("summarizeCustomerAccount(");
    expect(SERVER).toContain("isDuplicatePayment(");
    expect(SERVER).toContain("canReversePayment(");
  });
  it("reversal marks status, never deletes (no delete route)", () => {
    expect(SERVER).toContain('status: "reversed"');
    expect(SERVER).not.toContain('app.delete("/api/customer-accounts/payments');
  });
  it("customerPayments has a memory-fallback entry (PR #44 lesson)", () => {
    expect(SERVER).toContain("customerPayments: CustomerPayment[];");
    expect(SERVER).toContain("customerPayments: [],");
  });
});
