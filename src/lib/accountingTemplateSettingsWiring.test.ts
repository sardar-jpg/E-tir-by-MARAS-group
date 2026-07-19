import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring/contract pins for the Template Settings routes (Company Profile +
 * Bank Accounts). Desktop is the source of truth: reads allowed to
 * accounting viewers, writes Super-Admin-only. Bank accounts are never hard
 * deleted. Memory-fallback collection must exist (PR #44 lesson).
 */
const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

describe("template settings route permissions (Desktop is the source of truth)", () => {
  it("company profile: view = accounting viewers, write = Super Admin", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/company-profile", requireCanViewCostStatements');
    expect(SERVER).toContain('app.put("/api/admin/accounting/company-profile", requireSuperAdmin');
  });
  it("bank accounts: read = accounting viewers, create/update = Super Admin", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/bank-accounts", requireCanViewCostStatements');
    expect(SERVER).toContain('app.post("/api/admin/accounting/bank-accounts", requireSuperAdmin');
    expect(SERVER).toContain('app.put("/api/admin/accounting/bank-accounts/:id", requireSuperAdmin');
  });
  it("default-bank suggestion is readable by accounting viewers (Desktop + Mobile invoice view)", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/default-bank-account", requireCanViewCostStatements');
  });
});

describe("template settings data integrity", () => {
  it("validates via the pure module and enforces one-default-per-currency", () => {
    expect(SERVER).toContain("validateCompanyProfile(");
    expect(SERVER).toContain("validateBankAccount(");
    // One-default-per-currency is now enforced atomically (item 7): the target
    // becomes the sole default and every other same-currency account is demoted
    // in one write; an inactive account can never be the default.
    expect(SERVER).toContain("decideSetDefaultBank(");
    expect(SERVER).toContain("enforceDefaultBankExclusivity(");
    expect(SERVER).toContain("inactive_default");
    expect(SERVER).toContain("resolveDefaultBankAccountForCurrency(");
  });
  it("bank accounts are retired via active:false, never hard-deleted (no DELETE route)", () => {
    expect(SERVER).not.toContain('app.delete("/api/admin/accounting/bank-accounts');
  });
  it("bankAccounts has a memory-fallback collection entry (PR #44 lesson)", () => {
    expect(SERVER).toContain("bankAccounts: BankAccount[];");
    expect(SERVER).toContain("bankAccounts: [],");
  });
});
