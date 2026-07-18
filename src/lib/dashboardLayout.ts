/**
 * dashboardLayout.ts — per-admin Executive Dashboard personalization
 * (PR #133): section visibility + order, saved per user (never shared).
 * Pure: normalization/reordering here, persistence in server.ts
 * ("adminDashboardLayouts", one doc per admin id).
 *
 * Personalization NEVER widens access: rendering intersects the saved
 * layout with the viewer's permitted sections, so a stored id a role
 * cannot see simply never renders (visibleOrderedSections).
 */

export const DASHBOARD_SECTION_IDS = [
  "executive_brief",
  "operations",
  "financial",
  "financial_alerts",
  "analytics",
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export interface DashboardLayout {
  order: DashboardSectionId[];
  hidden: DashboardSectionId[];
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  order: [...DASHBOARD_SECTION_IDS],
  hidden: [],
};

/** Sanitizes anything stored/submitted: unknown ids drop, duplicates collapse, missing ids append in default order. */
export function normalizeDashboardLayout(raw: unknown): DashboardLayout {
  const input = (raw || {}) as { order?: unknown; hidden?: unknown };
  const known = new Set<string>(DASHBOARD_SECTION_IDS);
  const order: DashboardSectionId[] = [];
  for (const id of Array.isArray(input.order) ? input.order : []) {
    if (typeof id === "string" && known.has(id) && !order.includes(id as DashboardSectionId)) {
      order.push(id as DashboardSectionId);
    }
  }
  for (const id of DASHBOARD_SECTION_IDS) if (!order.includes(id)) order.push(id);
  const hidden: DashboardSectionId[] = [];
  for (const id of Array.isArray(input.hidden) ? input.hidden : []) {
    if (typeof id === "string" && known.has(id) && !hidden.includes(id as DashboardSectionId)) {
      hidden.push(id as DashboardSectionId);
    }
  }
  return { order, hidden };
}

export function moveDashboardSection(layout: DashboardLayout, id: DashboardSectionId, direction: "up" | "down"): DashboardLayout {
  const order = [...layout.order];
  const index = order.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= order.length) return layout;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...layout, order };
}

/** Drag & drop: places `dragged` at `before`'s position. */
export function reorderDashboardSection(layout: DashboardLayout, dragged: DashboardSectionId, before: DashboardSectionId): DashboardLayout {
  if (dragged === before) return layout;
  const order = layout.order.filter((id) => id !== dragged);
  const at = order.indexOf(before);
  if (at < 0) return layout;
  order.splice(at, 0, dragged);
  return { ...layout, order };
}

export function toggleDashboardSection(layout: DashboardLayout, id: DashboardSectionId): DashboardLayout {
  return layout.hidden.includes(id)
    ? { ...layout, hidden: layout.hidden.filter((h) => h !== id) }
    : { ...layout, hidden: [...layout.hidden, id] };
}

/** The render order: saved order ∩ role-permitted ∩ not hidden. */
export function visibleOrderedSections(layout: DashboardLayout, permitted: ReadonlySet<DashboardSectionId>): DashboardSectionId[] {
  return layout.order.filter((id) => permitted.has(id) && !layout.hidden.includes(id));
}
