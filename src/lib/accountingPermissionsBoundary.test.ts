import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canManageAccounting, canRecordVendorPayment, canIssueInvoice, canAllocatePayment,
  canCreateReceipt, canViewCustomerStatement, canManageBankAccounts, canManageTemplates,
  canRestoreTemplateVersion, canManageApprovalWorkflow, canDecideReopening,
} from "./adminAccess";

/**
 * The full accounting suite's permission boundary in ONE place. The named
 * capabilities map onto the existing adminType model, and every sensitive
 * server route must enforce the matching gate — accounting writes for
 * super+accounts, template/bank/structural settings for super only. This
 * guards against a route accidentally widening access.
 */
describe("named accounting capabilities (atop adminType)", () => {
  it("accounting writers = super + accounts; not operation/driver/undefined", () => {
    for (const cap of [canManageAccounting, canRecordVendorPayment, canIssueInvoice, canAllocatePayment, canCreateReceipt, canViewCustomerStatement]) {
      expect(cap("super")).toBe(true);
      expect(cap("accounts")).toBe(true);
      expect(cap("operation")).toBe(false);
      expect(cap(undefined)).toBe(false);
    }
  });
  it("template / bank / structural settings = super only", () => {
    for (const cap of [canManageBankAccounts, canManageTemplates, canRestoreTemplateVersion, canManageApprovalWorkflow, canDecideReopening]) {
      expect(cap("super")).toBe(true);
      expect(cap("accounts")).toBe(false);
      expect(cap("operation")).toBe(false);
    }
  });
});

describe("server route gates match the capability model (no accidental widening)", () => {
  const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");
  const WRITE = "requireCanWriteCostStatements";
  const VIEW = "requireCanViewCostStatements";
  const SUPER = "requireSuperAdmin";

  const gate = (method: string, route: string) => {
    const re = new RegExp(`app\\.${method}\\("${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*([A-Za-z]+)`);
    const m = SERVER.match(re);
    return m ? m[1] : "(not found)";
  };

  it("accounting-write routes (POST) are gated to writers (super+accounts)", () => {
    for (const r of [
      "/api/cost-statements/:shipmentId/vendor-payments",
      "/api/cost-statements/:shipmentId/vendor-payments/:paymentId/reverse",
      "/api/cost-statements/:shipmentId/invoices",
      "/api/cost-statements/:shipmentId/invoices/:invoiceId/issue",
      "/api/cost-statements/:shipmentId/invoices/:invoiceId/cancel",
      "/api/customer-accounts/payments",
      "/api/customer-accounts/payments/:paymentId/allocate",
      "/api/customer-accounts/payments/:paymentId/reverse",
      "/api/customer-accounts/payments/:paymentId/receipt",
    ]) {
      expect(gate("post", r), `${r} POST must require accounting write`).toBe(WRITE);
    }
  });
  it("template / bank / restore settings are Super-Admin only", () => {
    expect(gate("get", "/api/admin/accounting/company-profile")).toBe(VIEW); // the GET
    expect(SERVER).toContain(`app.put("/api/admin/accounting/company-profile", ${SUPER}`);
    expect(SERVER).toContain(`app.post("/api/admin/accounting/bank-accounts", ${SUPER}`);
    expect(SERVER).toContain(`app.put("/api/admin/accounting/bank-accounts/:id", ${SUPER}`);
    expect(SERVER).toContain(`app.post("/api/admin/accounting/company-profile/restore/:version", ${SUPER}`);
    expect(SERVER).toContain(`app.put("/api/admin/accounting/approval-workflow", ${SUPER}`);
  });
  it("read-only account views (GET) require accounting view", () => {
    for (const r of [
      "/api/cost-statements/:shipmentId/vendor-payments",
      "/api/customer-accounts/invoices",
      "/api/customer-accounts/payments",
      "/api/customer-accounts/statement",
    ]) {
      expect(gate("get", r), `${r} GET must require accounting view`).toBe(VIEW);
    }
  });
});
