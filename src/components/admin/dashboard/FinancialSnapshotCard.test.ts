import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring tests for the Financial Snapshot card. The project has no DOM
 * test runtime (jsdom / Testing Library), so — exactly like the existing
 * accountingNotificationsWiring / unifiedNotificationsWiring suites — the
 * render-level guarantees (default currency, loading/error states, tab
 * keyboard access, the "View details" link) are asserted against the
 * component source. The number/currency behaviour itself is proven by the
 * pure financialSnapshot.test.ts + executiveFinance.test.ts suites.
 */
const HERE = __dirname;
const ROOT = join(HERE, "..", "..", "..", "..");
const CARD = readFileSync(join(HERE, "FinancialSnapshotCard.tsx"), "utf-8");
const TABS = readFileSync(join(HERE, "CurrencyTabs.tsx"), "utf-8");
const SECTION = readFileSync(join(ROOT, "src", "components", "admin", "sections", "AdminDashboardSection.tsx"), "utf-8");
const ADMIN = readFileSync(join(ROOT, "src", "components", "AdminPanel.tsx"), "utf-8");

describe("Financial Snapshot — one compact currency-tabbed card", () => {
  it("defaults the selected tab to USD", () => {
    expect(CARD).toContain('useState<string>("USD")');
  });

  it("reads REAL accounting data from the dashboard financial endpoint (no mock)", () => {
    expect(CARD).toContain('apiFetch("/api/admin/dashboard/financial")');
    expect(CARD).toContain("body.financial");
  });

  it("renders a loading skeleton state", () => {
    expect(CARD).toContain('state === "loading"');
    expect(CARD).toContain('aria-busy="true"');
    expect(CARD).toContain("animate-pulse");
  });

  it("renders an API error state and hides itself when access is denied (403)", () => {
    expect(CARD).toContain("res.status === 403");
    expect(CARD).toContain('setState("no_access")');
    expect(CARD).toContain('if (state === "no_access") return null;');
    expect(CARD).toContain("if (!res.ok) { setState(\"error\"); return; }");
    expect(CARD).toContain('state === "error"');
  });

  it("uses one tabpanel and never converts currencies (reads a single per-currency bucket)", () => {
    expect(CARD).toContain('role="tabpanel"');
    expect(CARD).toContain("currencySnapshot(overview, active)");
    expect(CARD).toContain("snapshotCurrencyTabs(overview)");
    // No FX / conversion CODE anywhere in the card (the doc comment may say
    // "never converted"; what must be absent is actual conversion logic).
    for (const bad of ["convertCurrency", "exchangeRate", "fxRate", "toUSD("]) {
      expect(CARD).not.toContain(bad);
    }
  });

  it("exposes a working 'View details' link", () => {
    expect(CARD).toContain("onClick={onViewDetails}");
    // Wired end-to-end: section → card, AdminPanel → Accounting Dashboard.
    expect(SECTION).toContain("<FinancialSnapshotCard lang={lang} onViewDetails={onOpenFinancialDetails} />");
    expect(ADMIN).toContain("onOpenFinancialDetails={() => setActiveTab('acct_dashboard')}");
  });
});

describe("CurrencyTabs — accessible, keyboard-navigable", () => {
  it("implements the ARIA tabs pattern", () => {
    expect(TABS).toContain('role="tablist"');
    expect(TABS).toContain('role="tab"');
    expect(TABS).toContain("aria-selected={isSelected}");
    expect(TABS).toContain("aria-controls={`${idPrefix}-panel`}");
    expect(TABS).toContain("tabIndex={isSelected ? 0 : -1}"); // roving tabindex
  });

  it("moves selection with Arrow / Home / End keys", () => {
    expect(TABS).toContain('"ArrowRight"');
    expect(TABS).toContain('"ArrowLeft"');
    expect(TABS).toContain('e.key === "Home"');
    expect(TABS).toContain('e.key === "End"');
  });
});

describe("Financial Snapshot is gated to accounting roles only", () => {
  it("only renders for viewers with financial access", () => {
    expect(SECTION).toContain("canViewFinancial && (");
    expect(ADMIN).toContain("canViewFinancial={canViewCostStatements(resolvedAdminType)}");
  });
});
