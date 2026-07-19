import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MOBILE = readFileSync(join(ROOT, "src", "components", "admin", "mobile", "MobileAccountingQuickActions.tsx"), "utf-8");
const PANEL_HOST = readFileSync(join(ROOT, "src", "components", "AdminPanel.tsx"), "utf-8");

describe("mobile accounting quick actions — lightweight, reuses backend", () => {
  it("is mobile-only (lg:hidden) and reuses the SAME accounting APIs", () => {
    expect(MOBILE).toContain("lg:hidden");
    expect(MOBILE).toContain("/api/cost-statements/${shipmentId}");
    expect(MOBILE).toContain("/submit");
    expect(MOBILE).toContain("/approve");
    expect(MOBILE).toContain("/reject");
    expect(MOBILE).toContain("/vendor-payments");
  });
  it("does NOT duplicate heavy/desktop-only capabilities", () => {
    // No bank-account management, template editing, allocation, or reversals on mobile.
    expect(MOBILE).not.toContain("bank-accounts");
    expect(MOBILE).not.toContain("/templates/");
    expect(MOBILE).not.toContain("/allocate");
    expect(MOBILE).not.toContain("/reverse");
    expect(MOBILE).not.toContain("company-profile");
  });
  it("the full desktop accounting panels are hidden on mobile (hidden lg:block)", () => {
    expect(PANEL_HOST).toContain("hidden lg:block");
    expect(PANEL_HOST).toContain("<MobileAccountingQuickActions");
  });
});
