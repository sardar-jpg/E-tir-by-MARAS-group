import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MOBILE = readFileSync(join(ROOT, "src", "components", "admin", "mobile", "MobileAccountingQuickActions.tsx"), "utf-8");
const PANEL_HOST = readFileSync(join(ROOT, "src", "components", "AdminPanel.tsx"), "utf-8");
// The desktop cost-statement workspace uses a dedicated ExpenseDrawer for
// on-demand expense entry (reusing the SAME item-level endpoint); the mobile
// quick-actions panel stays mobile-only (lg:hidden).
const WORKSPACE = readFileSync(join(ROOT, "src", "components", "admin", "CostStatementWorkspace.tsx"), "utf-8");
const EXPENSE_DRAWER = readFileSync(join(ROOT, "src", "components", "admin", "ExpenseDrawer.tsx"), "utf-8");

describe("mobile accounting quick actions — lightweight, reuses backend", () => {
  it("is mobile-only (lg:hidden) and reuses the SAME accounting APIs", () => {
    expect(MOBILE).toContain("lg:hidden");
    expect(MOBILE).toContain("/api/cost-statements/${shipmentId}");
    expect(MOBILE).toContain("/submit");
    expect(MOBILE).toContain("/approve");
    expect(MOBILE).toContain("/reject");
    expect(MOBILE).toContain("/vendor-payments");
  });
  it("quick expense uses the item-level endpoint with idempotency + revision, never the full array (item 12)", () => {
    expect(MOBILE).toContain("/items");
    expect(MOBILE).toContain("idempotencyKey");
    expect(MOBILE).toContain("expectedRevision");
    expect(MOBILE).toContain("revision_conflict");
    // The old full-array PUT/POST of costItems is gone.
    expect(MOBILE).not.toContain("items: items2");
  });
  it("does NOT duplicate heavy/desktop-only capabilities", () => {
    // No bank-account management, template editing, allocation, or reversals on mobile.
    expect(MOBILE).not.toContain("bank-accounts");
    expect(MOBILE).not.toContain("/templates/");
    expect(MOBILE).not.toContain("/allocate");
    expect(MOBILE).not.toContain("/reverse");
    expect(MOBILE).not.toContain("company-profile");
  });
  it("the full desktop accounting list stays desktop-only (hidden lg:block)", () => {
    expect(PANEL_HOST).toContain("hidden lg:block");
  });
  it("the desktop workspace enters expenses via ExpenseDrawer, reusing the same item endpoint", () => {
    // The dense mobile quick-actions block is NOT embedded on desktop anymore;
    // a focused ExpenseDrawer handles on-demand expense entry.
    expect(WORKSPACE).toContain("<ExpenseDrawer");
    expect(WORKSPACE).not.toContain("<MobileAccountingQuickActions");
    // The drawer reuses the SAME item-level endpoint + idempotency/revision
    // contract — no duplicated accounting logic, no new server behaviour.
    expect(EXPENSE_DRAWER).toContain("/api/cost-statements/${shipmentId}/items");
    expect(EXPENSE_DRAWER).toContain("idempotencyKey");
    expect(EXPENSE_DRAWER).toContain("expectedRevision");
    // The mobile quick-actions panel still exists and stays mobile-only.
    expect(MOBILE).toContain("lg:hidden");
  });
});
