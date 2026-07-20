import { describe, it, expect } from "vitest";
import {
  ACCOUNTING_PAGES, ACCOUNTING_TAB_IDS, ACCOUNTING_LIVE_TAB_IDS,
  isAccountingTab, isLiveAccountingTab, accountingPage, accountingLabel,
} from "./accountingNav";

describe("accountingNav registry", () => {
  it("lists the nine accounting pages in the reference order, dashboard first", () => {
    expect(ACCOUNTING_PAGES.map((p) => p.id)).toEqual([
      "acct_dashboard", "costs", "acct_customer_statements", "acct_vendor_statements",
      "acct_invoices", "acct_payments", "acct_receivables", "acct_reports", "acct_ai",
    ]);
  });
  it("marks the four delivered pages live and the rest as roadmap", () => {
    expect(ACCOUNTING_LIVE_TAB_IDS).toEqual(["acct_dashboard", "costs", "acct_customer_statements", "acct_vendor_statements"]);
    expect(isLiveAccountingTab("acct_dashboard")).toBe(true);
    expect(isLiveAccountingTab("acct_reports")).toBe(false);
  });
  it("every page carries en/tr/ar labels + an icon", () => {
    for (const p of ACCOUNTING_PAGES) {
      expect(p.label.en.length).toBeGreaterThan(0);
      expect(typeof p.label.tr).toBe("string");
      expect(typeof p.label.ar).toBe("string");
      expect(p.icon.length).toBeGreaterThan(0);
    }
  });
  it("Cost Statements reuses the existing `costs` tab id (no duplicate page)", () => {
    expect(ACCOUNTING_TAB_IDS).toContain("costs");
    expect(accountingPage("costs")?.live).toBe(true);
  });
  it("helpers resolve membership + labels", () => {
    expect(isAccountingTab("acct_customer_statements")).toBe(true);
    expect(isAccountingTab("shipments")).toBe(false);
    expect(accountingLabel("acct_dashboard", "en")).toBe("Accounting Dashboard");
    expect(accountingLabel("acct_dashboard", "ar")).toBe("لوحة المحاسبة");
  });
});
