import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring/contract pins for Customer Invoice routes. Internal-only,
 * server-authoritative pricing, issued-immutable (cancel not delete),
 * private cost/profit never in customer/public views.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

describe("customer invoice routes — permissions + lifecycle", () => {
  it("reads require accounting view; create/edit/issue/cancel require accounting write", () => {
    expect(SERVER).toContain('app.get("/api/cost-statements/:shipmentId/invoices", requirePermission("invoices.view")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/invoices", requirePermission("invoices.create")');
    expect(SERVER).toContain('app.put("/api/cost-statements/:shipmentId/invoices/:invoiceId", requirePermission("invoices.editDraft")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/invoices/:invoiceId/issue", requirePermission("invoices.issue")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/invoices/:invoiceId/cancel", requirePermission("invoices.cancel")');
  });
  it("selling amount + markup + profit are computed server-side via the pure module (never trusted from body)", () => {
    expect(SERVER).toContain("computeInvoicePricing(");
    expect(SERVER).toContain("computeInvoiceGrossProfit(");
    expect(SERVER).toContain("canIssueInvoice(");
    expect(SERVER).toContain("canCancelInvoice(");
    expect(SERVER).toContain("buildInvoiceNumber(");
    // Legacy percentage_margin field is rejected, never mapped.
    expect(SERVER).toContain("legacy_field_rejected");
  });
  it("issued invoices are immutable — cancel path, no delete route", () => {
    expect(SERVER).toContain("isInvoiceEditable(existing.status)");
    expect(SERVER).not.toContain('app.delete("/api/cost-statements/:shipmentId/invoices');
  });
  it("customerInvoices has a memory-fallback entry (PR #44 lesson)", () => {
    expect(SERVER).toContain("customerInvoices: CustomerInvoice[];");
    expect(SERVER).toContain("customerInvoices: [],");
  });
  it("invoice cost/profit never reach the public share view", () => {
    const SHARE = readFileSync(join(ROOT, "src", "lib", "publicShareView.ts"), "utf-8");
    expect(SHARE).not.toContain("costBasis");
    expect(SHARE).not.toContain("grossProfit");
    expect(SHARE).not.toContain("customerInvoice");
  });
});
