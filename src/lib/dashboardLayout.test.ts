import { describe, it, expect } from "vitest";
import {
  DASHBOARD_SECTION_IDS,
  DEFAULT_DASHBOARD_LAYOUT,
  normalizeDashboardLayout,
  moveDashboardSection,
  reorderDashboardSection,
  toggleDashboardSection,
  visibleOrderedSections,
  type DashboardSectionId,
} from "./dashboardLayout";

describe("dashboard layout — per-user personalization, permission-safe", () => {
  it("normalizes junk: unknown ids drop, duplicates collapse, missing sections append in default order", () => {
    const layout = normalizeDashboardLayout({ order: ["financial", "hack_section", "financial", "operations"], hidden: ["nope", "analytics"] });
    expect(layout.order).toEqual(["financial", "operations", "executive_brief", "financial_alerts", "analytics"]);
    expect(layout.hidden).toEqual(["analytics"]);
    expect(normalizeDashboardLayout(undefined)).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });

  it("move up/down swaps neighbors and clamps at the edges", () => {
    const moved = moveDashboardSection(DEFAULT_DASHBOARD_LAYOUT, "operations", "up");
    expect(moved.order[0]).toBe("operations");
    expect(moveDashboardSection(moved, "operations", "up").order[0]).toBe("operations"); // clamped
  });

  it("drag & drop reorders by dropping before a target", () => {
    const layout = reorderDashboardSection(DEFAULT_DASHBOARD_LAYOUT, "analytics", "executive_brief");
    expect(layout.order[0]).toBe("analytics");
    expect(layout.order).toHaveLength(DASHBOARD_SECTION_IDS.length);
  });

  it("visibility toggles per section; rendering intersects with the role's PERMITTED set (personalization never widens access)", () => {
    const hiddenOps = toggleDashboardSection(DEFAULT_DASHBOARD_LAYOUT, "operations");
    expect(hiddenOps.hidden).toContain("operations");
    expect(toggleDashboardSection(hiddenOps, "operations").hidden).not.toContain("operations");
    // An operation admin's permitted set excludes financial sections —
    // even a saved layout listing them first can never render them.
    const operationPermitted = new Set<DashboardSectionId>(["executive_brief", "operations", "analytics"]);
    const sneaky = normalizeDashboardLayout({ order: ["financial", "financial_alerts", "executive_brief", "operations", "analytics"], hidden: [] });
    expect(visibleOrderedSections(sneaky, operationPermitted)).toEqual(["executive_brief", "operations", "analytics"]);
    // Hidden + permitted intersect too.
    expect(visibleOrderedSections(hiddenOps, operationPermitted)).toEqual(["executive_brief", "analytics"]);
  });
});
