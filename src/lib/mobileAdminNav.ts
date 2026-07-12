/**
 * mobileAdminNav.ts
 *
 * feature/admin-mobile-ui
 *
 * Pure decision logic for the mobile Admin bottom navigation and "More"
 * menu — extracted so it's unit-testable independent of React/DOM, and so
 * there is exactly one place deciding "what goes where," reused by
 * MobileBottomNav and MobileMoreMenu. Never invents access: every
 * function here only ever selects from the `tabs` array the caller
 * passes in, which is always AdminPanel's own `filteredAdminTabs` (or a
 * superset built the same way) — already role-filtered by
 * src/lib/adminAccess.ts. Nothing in this file adds a permission check
 * of its own, and nothing here can make a tab visible that
 * filteredAdminTabs didn't already include.
 */

export interface MobileNavTab {
  id: string;
}

/**
 * The bottom nav's 4 "primary" slots, in priority order. Most admin
 * roles (super, operation) have all four of these in their
 * filteredAdminTabs. Accounts admins do not — their role matrix
 * (AdminPanel.tsx's filteredAdminTabs) excludes dashboard, shipments,
 * tracking_map, AND chat_center entirely (pre-existing behavior, not
 * introduced here), leaving 0 of the 4 "ideal" primary tabs available.
 */
export const PRIMARY_TAB_PRIORITY = ["dashboard", "shipments", "tracking_map", "chat_center"];

/**
 * Resolves the exact 4 tab ids to show in the bottom nav's primary
 * slots. Fills with PRIMARY_TAB_PRIORITY ids the role actually has
 * access to (preserving that priority order); if fewer than 4 are
 * available (e.g. an Accounts admin, who has none), fills the remaining
 * slots from whatever else the role CAN see (in filteredAdminTabs'
 * existing order) — so the bar is never left with dead/empty slots, but
 * it also never shows an id that wasn't already in `tabs`.
 */
export function resolvePrimaryMobileTabs(tabs: MobileNavTab[]): string[] {
  const availableIds = new Set(tabs.map((t) => t.id));
  const primary = PRIMARY_TAB_PRIORITY.filter((id) => availableIds.has(id));
  if (primary.length >= 4) return primary.slice(0, 4);
  const fillers = tabs.map((t) => t.id).filter((id) => !primary.includes(id));
  return [...primary, ...fillers].slice(0, 4);
}

/**
 * The "More" menu's contents: every tab the role can see that ISN'T
 * already one of the 4 primary bottom-nav slots. `extraIds` (e.g.
 * "team", hidden from filteredAdminTabs' top-level nav but still a real
 * tab the role may be allowed) can be appended — the caller is
 * responsible for only passing an id here if the role is actually
 * allowed to see it (see AdminPanel's own `isSuper` check for 'team').
 */
export function resolveMoreMenuTabIds(
  tabs: MobileNavTab[],
  primaryTabIds: string[],
  extraIds: string[] = []
): string[] {
  const primarySet = new Set(primaryTabIds);
  const fromTabs = tabs.map((t) => t.id).filter((id) => !primarySet.has(id));
  const deduped = [...fromTabs];
  for (const id of extraIds) {
    if (!deduped.includes(id) && !primarySet.has(id)) deduped.push(id);
  }
  return deduped;
}

/**
 * Whether the bottom nav's "More" button should render as active — true
 * whenever the current tab is reachable ONLY through More (i.e. it's not
 * one of the 4 primary slots), regardless of whether the More sheet
 * itself is currently open. This is what makes the active-tab indicator
 * correct even after navigating to, say, Settings via More and the sheet
 * has since closed.
 */
export function isMoreTabActive(activeTab: string, primaryTabIds: string[]): boolean {
  return !primaryTabIds.includes(activeTab);
}
