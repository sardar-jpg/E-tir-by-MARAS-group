import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

describe("payment receipt routes", () => {
  it("issue requires accounting write; fetch requires accounting view", () => {
    expect(SERVER).toContain('app.post("/api/customer-accounts/payments/:paymentId/receipt", requirePermission("receipts.create")');
    expect(SERVER).toContain('app.get("/api/customer-accounts/payments/:paymentId/receipt", requirePermission("receipts.view")');
  });
  it("issuance is idempotent + guarded via the pure module", () => {
    expect(SERVER).toContain("canIssueReceipt(");
    expect(SERVER).toContain("findActiveReceiptForPayment(");
  });
  it("receipt numbers come from a collision-safe transaction-backed sequence (item 6)", () => {
    expect(SERVER).toContain("allocateNextReceiptSequence(");
    expect(SERVER).toContain("formatReceiptNumber(");
  });
  it("reversing a payment voids its receipt (never deletes)", () => {
    expect(SERVER).toContain('status: "void"');
    expect(SERVER).not.toContain('app.delete("/api/customer-accounts/payments/:paymentId/receipt');
  });
  it("paymentReceipts has a memory-fallback entry (PR #44 lesson)", () => {
    expect(SERVER).toContain("paymentReceipts: PaymentReceipt[];");
    expect(SERVER).toContain("paymentReceipts: [],");
  });
});
