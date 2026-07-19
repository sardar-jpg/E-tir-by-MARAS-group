import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring/contract pins for the Vendor Payables routes. Internal-only
 * (accounting view/write), server-authoritative amounts via the pure
 * module, reversal-not-delete, memory-fallback collection present.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

describe("vendor payables routes — permissions + internal-only", () => {
  it("list/summary reads require accounting view; recording + reversal require accounting write", () => {
    expect(SERVER).toContain('app.get("/api/cost-statements/:shipmentId/vendor-payments", requireCanViewCostStatements');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/vendor-payments", requireCanWriteCostStatements');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/vendor-payments/:paymentId/reverse", requireCanWriteCostStatements');
  });
  it("vendor payments never leak into customer/driver/public share views", () => {
    const SHARE = readFileSync(join(ROOT, "src", "lib", "publicShareView.ts"), "utf-8");
    expect(SHARE).not.toContain("vendorPayment");
    expect(SHARE).not.toContain("vendorPayables");
  });
});

describe("vendor payables — server-authoritative + data integrity", () => {
  it("amounts/currency/overpay/duplicate come from the pure module", () => {
    expect(SERVER).toContain("validateVendorPayment({");
    expect(SERVER).toContain("summarizeVendorPayable(");
    expect(SERVER).toContain("isDuplicateVendorPayment(");
    expect(SERVER).toContain("canReverseVendorPayment(");
  });
  it("reversal marks status and never deletes (no delete route)", () => {
    expect(SERVER).toContain('status: "reversed"');
    expect(SERVER).not.toContain('app.delete("/api/cost-statements/:shipmentId/vendor-payments');
  });
  it("bankAccounts + vendorPayments have memory-fallback entries (PR #44 lesson)", () => {
    expect(SERVER).toContain("vendorPayments: VendorPaymentTransaction[];");
    expect(SERVER).toContain("vendorPayments: [],");
  });
});
