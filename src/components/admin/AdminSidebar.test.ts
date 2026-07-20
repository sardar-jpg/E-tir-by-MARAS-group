import { describe, it, expect } from "vitest";
import { findUngroupedTabIds } from "./AdminSidebar";

// BUG-24: AdminSidebar groups its tabs off a hand-maintained id list (GROUPS)
// that has to stay in sync with AdminPanel's rawTabs. This pins the current
// full set of admin tab ids — if a future tab is added to rawTabs without a
// matching GROUPS entry, this test fails instead of the tab just silently
// disappearing from the desktop sidebar.
const ALL_ADMIN_TAB_IDS = [
  "dashboard",
  "shipments",
  "tracking_map",
  "drivers",
  "chat_center",
  "clients",
  "vendors",
  // Accounting module group (costs + acct_* pages).
  "acct_dashboard",
  "costs",
  "acct_customer_statements",
  "acct_vendor_statements",
  "acct_invoices",
  "acct_payments",
  "acct_receivables",
  "acct_reports",
  "acct_ai",
  "reports",
  "gmail",
  "audit",
  "team",
  "my_account",
  "settings",
];

describe("findUngroupedTabIds", () => {
  it("finds every current admin tab id in some sidebar group", () => {
    expect(findUngroupedTabIds(ALL_ADMIN_TAB_IDS)).toEqual([]);
  });

  it("flags an id that isn't in any group", () => {
    expect(findUngroupedTabIds(["dashboard", "some_new_tab"])).toEqual(["some_new_tab"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(findUngroupedTabIds([])).toEqual([]);
  });
});
