import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MOBILE = readFileSync(join(ROOT, "src", "components", "admin", "mobile", "MobileAccountingQuickActions.tsx"), "utf-8");
const PANEL_HOST = readFileSync(join(ROOT, "src", "components", "AdminPanel.tsx"), "utf-8");
// The quick-actions panel now also embeds inside the full-screen cost-statement
// workspace (with `embedded` to show it at every breakpoint); the mobile-only
// hosting still exists via the same component's default lg:hidden behaviour.
const WORKSPACE = readFileSync(join(ROOT, "src", "components", "admin", "CostStatementWorkspace.tsx"), "utf-8");

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
  it("the quick-actions panel is mounted by the full-screen cost-statement workspace", () => {
    expect(WORKSPACE).toContain("<MobileAccountingQuickActions");
    // Inside the workspace it renders at every breakpoint (embedded), so
    // desktop users get an Add Expense affordance too.
    expect(WORKSPACE).toContain("embedded");
    // The default (non-embedded) mount remains mobile-only.
    expect(MOBILE).toContain("lg:hidden");
  });
});
