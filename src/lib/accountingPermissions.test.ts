import { describe, it, expect } from "vitest";
import {
  ACCOUNTING_PERMISSION_KEYS,
  ACCOUNTING_PERMISSION_GROUPS,
  LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS,
  SENSITIVE_ACCOUNTING_PERMISSIONS,
  resolveEffectivePermissions,
  hasPermission,
  sanitizeAccountingPermissions,
  diffPermissions,
  isKnownAccountingPermission,
} from "./accountingPermissions";

const superAdmin = { role: "admin", adminType: "super" };
const accounts = (over: Record<string, unknown> = {}) => ({ role: "admin", adminType: "accounts", ...over });
const operation = { role: "admin", adminType: "operation" };

describe("registry integrity", () => {
  it("every grouped permission is a canonical key, and all keys are grouped exactly once", () => {
    const grouped = ACCOUNTING_PERMISSION_GROUPS.flatMap((g) => g.permissions.map((x) => x.key));
    expect(new Set(grouped).size).toBe(grouped.length); // no dupes
    expect([...grouped].sort()).toEqual([...ACCOUNTING_PERMISSION_KEYS].sort());
    for (const k of grouped) expect(isKnownAccountingPermission(k)).toBe(true);
  });
  it("legacy defaults never include any sensitive permission", () => {
    for (const s of SENSITIVE_ACCOUNTING_PERMISSIONS) expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).not.toContain(s);
  });
  it("every group label is trilingual", () => {
    for (const g of ACCOUNTING_PERMISSION_GROUPS) {
      expect(g.label.en && g.label.ar && g.label.tr).toBeTruthy();
      for (const perm of g.permissions) expect(perm.label.en && perm.label.ar && perm.label.tr).toBeTruthy();
    }
  });
});

describe("resolveEffectivePermissions — mandatory tests 1-7", () => {
  it("1. Super Admin can perform every accounting action", () => {
    const eff = resolveEffectivePermissions(superAdmin);
    for (const k of ACCOUNTING_PERMISSION_KEYS) expect(eff.has(k)).toBe(true);
  });
  it("2. accounts role without explicit permissions gets safe legacy defaults", () => {
    const eff = resolveEffectivePermissions(accounts());
    expect(eff.has("invoices.issue")).toBe(true);
    expect(eff.has("invoices.cancel")).toBe(false); // sensitive, excluded
    expect(eff.has("accountingRepair.execute")).toBe(false);
    expect([...eff].sort()).toEqual([...LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS].sort());
  });
  it("3. explicit permissions override legacy defaults (even a smaller set)", () => {
    const eff = resolveEffectivePermissions(accounts({ permissions: ["invoices.view"] }));
    expect([...eff]).toEqual(["invoices.view"]);
    expect(eff.has("invoices.create")).toBe(false); // legacy default NOT applied
  });
  it("4. operation employee has no accounting access by default", () => {
    expect(resolveEffectivePermissions(operation).size).toBe(0);
  });
  it("5. disabled employee has no permissions (even accounts/super)", () => {
    expect(resolveEffectivePermissions(accounts({ active: false })).size).toBe(0);
    expect(resolveEffectivePermissions({ role: "admin", adminType: "super", active: false }).size).toBe(0);
  });
  it("6. missing/garbage permission data denies safely", () => {
    expect(resolveEffectivePermissions(null).size).toBe(0);
    expect(resolveEffectivePermissions({ role: "driver" } as any).size).toBe(0);
    expect(resolveEffectivePermissions(accounts({ permissions: "not-an-array" })).size).toBe(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS.length);
    // an explicit EMPTY array means "explicitly none", authoritative:
    expect(resolveEffectivePermissions(accounts({ permissions: [] })).size).toBe(0);
  });
  it("7. unknown permission values never grant access", () => {
    const eff = resolveEffectivePermissions(accounts({ permissions: ["invoices.issue", "totally.madeup", 42] }));
    expect([...eff]).toEqual(["invoices.issue"]);
  });
});

describe("hasPermission — granular gates (tests 8-15)", () => {
  it("8/9. invoices.view without issue cannot issue; with issue can", () => {
    expect(hasPermission(accounts({ permissions: ["invoices.view"] }), "invoices.issue")).toBe(false);
    expect(hasPermission(accounts({ permissions: ["invoices.view", "invoices.issue"] }), "invoices.issue")).toBe(true);
  });
  it("10. vendorPayments.create without reverse can create but not reverse", () => {
    const u = accounts({ permissions: ["vendorPayments.create"] });
    expect(hasPermission(u, "vendorPayments.create")).toBe(true);
    expect(hasPermission(u, "vendorPayments.reverse")).toBe(false);
  });
  it("11. customerPayments.create without allocate cannot allocate", () => {
    expect(hasPermission(accounts({ permissions: ["customerPayments.create"] }), "customerPayments.allocate")).toBe(false);
  });
  it("12. bankAccounts.view without manage cannot manage", () => {
    expect(hasPermission(accounts({ permissions: ["bankAccounts.view"] }), "bankAccounts.manage")).toBe(false);
  });
  it("13. only an authorized user can publish/restore templates", () => {
    expect(hasPermission(accounts({ permissions: ["accountingTemplates.view"] }), "accountingTemplates.publish")).toBe(false);
    expect(hasPermission(accounts({ permissions: ["accountingTemplates.publish"] }), "accountingTemplates.publish")).toBe(true);
    expect(hasPermission(superAdmin, "accountingTemplates.restore")).toBe(true);
  });
  it("14/15. repair.view cannot execute; repair.execute can", () => {
    expect(hasPermission(accounts({ permissions: ["accountingRepair.view"] }), "accountingRepair.execute")).toBe(false);
    expect(hasPermission(accounts({ permissions: ["accountingRepair.execute"] }), "accountingRepair.execute")).toBe(true);
  });
});

describe("sanitize + diff (for storage + audit)", () => {
  it("sanitize keeps known keys, drops unknown + dupes", () => {
    expect(sanitizeAccountingPermissions(["costs.view", "costs.view", "x.y", 5]).sort()).toEqual(["costs.view"]);
    expect(sanitizeAccountingPermissions("nope")).toEqual([]);
  });
  it("diff reports added + removed", () => {
    const d = diffPermissions(["costs.view", "invoices.view"], ["invoices.view", "invoices.issue"]);
    expect(d.added).toEqual(["invoices.issue"]);
    expect(d.removed).toEqual(["costs.view"]);
  });
});
