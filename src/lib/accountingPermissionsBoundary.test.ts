import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Single-source-of-truth boundary (PR #140 review increment 4, item 12).
 *
 * The former broad accounting aliases in adminAccess.ts (all mapped to one
 * adminType role check) were removed. Every accounting route is now gated by a
 * SPECIFIC granular permission via requirePermission("<key>"), resolved from
 * src/lib/accountingPermissions.ts. These wiring assertions pin that mapping so
 * a route can never quietly fall back to a broad accounting-write gate.
 */
const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");
const ADMIN_ACCESS = readFileSync(join(__dirname, "adminAccess.ts"), "utf-8");

/** The middleware token in `app.<method>("<route>", <token>` for an exact route. */
function gate(method: string, route: string): string {
  const re = new RegExp(`app\\.${method}\\("${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*(requirePermission\\("[^"]+"\\)|require[A-Za-z]+)`);
  const m = SERVER.match(re);
  return m ? m[1] : "(not found)";
}

describe("the broad accounting aliases are gone (one source of truth)", () => {
  it("adminAccess.ts no longer defines competing accounting authorization", () => {
    expect(ADMIN_ACCESS).not.toContain("export const canManageAccounting");
    expect(ADMIN_ACCESS).not.toContain("export const canRecordVendorPayment");
    expect(ADMIN_ACCESS).not.toContain("export const canManageBankAccounts");
    expect(ADMIN_ACCESS).not.toContain("export const canManageTemplates");
  });
});

describe("every accounting route is gated by its specific granular permission", () => {
  const cases: Array<[string, string, string]> = [
    ["post", "/api/cost-statements/:shipmentId/vendor-payments", 'requirePermission("vendorPayments.create")'],
    ["post", "/api/cost-statements/:shipmentId/vendor-payments/:paymentId/reverse", 'requirePermission("vendorPayments.reverse")'],
    ["post", "/api/cost-statements/:shipmentId/invoices", 'requirePermission("invoices.create")'],
    ["post", "/api/cost-statements/:shipmentId/invoices/:invoiceId/issue", 'requirePermission("invoices.issue")'],
    ["post", "/api/cost-statements/:shipmentId/invoices/:invoiceId/cancel", 'requirePermission("invoices.cancel")'],
    ["post", "/api/customer-accounts/payments", 'requirePermission("customerPayments.create")'],
    ["post", "/api/customer-accounts/payments/:paymentId/allocate", 'requirePermission("customerPayments.allocate")'],
    ["post", "/api/customer-accounts/payments/:paymentId/reverse", 'requirePermission("customerPayments.reverse")'],
    ["post", "/api/customer-accounts/payments/:paymentId/receipt", 'requirePermission("receipts.create")'],
    ["post", "/api/cost-statements/:shipmentId/items", 'requirePermission("costs.create")'],
    ["get", "/api/cost-statements/:shipmentId/vendor-payments", 'requirePermission("vendorPayments.view")'],
    ["get", "/api/customer-accounts/payments", 'requirePermission("customerPayments.view")'],
    ["get", "/api/customer-accounts/statement", 'requirePermission("customerStatements.view")'],
    ["put", "/api/admin/accounting/company-profile", 'requirePermission("accountingCompanyProfile.manage")'],
    ["post", "/api/admin/accounting/company-profile/restore/:version", 'requirePermission("accountingCompanyProfile.restore")'],
    ["post", "/api/admin/accounting/bank-accounts", 'requirePermission("bankAccounts.manage")'],
    ["put", "/api/admin/accounting/templates/:docType", 'requirePermission("accountingTemplates.publish")'],
    ["post", "/api/admin/accounting/templates/:docType/restore/:version", 'requirePermission("accountingTemplates.restore")'],
    ["post", "/api/admin/accounting/repair-ledgers", 'requirePermission("accountingRepair.view")'],
    ["post", "/api/admin/accounting/repair-cost-statements", 'requirePermission("accountingRepair.execute")'],
  ];
  for (const [method, route, expected] of cases) {
    it(`${method.toUpperCase()} ${route} → ${expected}`, () => {
      expect(gate(method, route)).toBe(expected);
    });
  }
  it("no accounting route still uses the old broad write/view gate", () => {
    // The coarse cost-statement gates remain only on the base cost-statement
    // list/detail read + the workflow-config PUT stays super-only; no vendor/
    // invoice/payment/receipt/template/bank route uses them.
    expect(gate("post", "/api/cost-statements/:shipmentId/vendor-payments")).not.toContain("CostStatements");
    expect(gate("post", "/api/customer-accounts/payments")).not.toContain("CostStatements");
  });
  it("repair execute is additionally gated inside the handler", () => {
    expect(SERVER).toContain('requiredPermission: "accountingRepair.execute"');
  });
});
