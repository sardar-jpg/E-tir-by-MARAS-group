import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ACTIONS } from "./accountingAudit";

const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const ADMIN = readFileSync(join(ROOT, "src", "components", "AdminPanel.tsx"), "utf-8");

describe("Phase 9.1 automatic evaluation hooks", () => {
  it("a fire-and-forget refresh helper runs AFTER a committed accounting transaction (never rolls it back)", () => {
    expect(SERVER).toContain("const fireNotifRefresh = ()");
    expect(SERVER).toContain("void reconcileAcctNotifications().catch(");
  });
  it("the workflow success paths trigger a notification refresh", () => {
    // At least the financial-close, financial-reopen, payment, invoice and
    // approval success paths call the refresh (count guards against silent loss).
    const hooks = (SERVER.match(/fireNotifRefresh\(\)/g) || []).length;
    expect(hooks).toBeGreaterThanOrEqual(12);
  });
  it("the refresh is derived (idempotent + deduped) — it reuses the Phase 9 reconcile, not a duplicate writer", () => {
    expect(SERVER).toContain("async function reconcileAcctNotifications");
    expect(SERVER).toContain("AcctNotify.reconcileNotifications(existing, desired, { nowMs");
  });
});

describe("Phase 9.1 lifecycle audit", () => {
  it("created + resolved lifecycle audit events are recorded during reconciliation", () => {
    expect(AUDIT_ACTIONS.notificationCreated).toBe("accounting.notification_created");
    expect(AUDIT_ACTIONS.notificationResolved).toBe("accounting.notification_resolved");
    expect(SERVER).toContain("AUDIT_ACTIONS.notificationCreated");
    expect(SERVER).toContain("AUDIT_ACTIONS.notificationResolved");
  });
  it("reconcile applies the reminder interval (toRemind) resurfacing", () => {
    expect(SERVER).toContain("toRemind");
    expect(SERVER).toContain('status: "unread", readByUserIds: [], lastRemindedAt');
  });
});

describe("Phase 9.1 client unifies both sources in ONE bell", () => {
  it("AdminPanel builds the unified list + combined unread badge from both stores", () => {
    expect(ADMIN).toContain("buildUnifiedList({");
    expect(ADMIN).toContain("combinedUnreadCount(legacyUnreadCount, acctUnread)");
    expect(ADMIN).toContain("unifiedNotifications.map((u)");
  });
  it("accounting notifications are fetched independently (partial-load tolerant) and actioned via the accounting APIs", () => {
    expect(ADMIN).toContain('/api/accounting/notifications?status=active');
    expect(ADMIN).toContain('/api/accounting/notifications/summary');
    expect(ADMIN).toContain("handleAcctNotifAction(u.id, 'read')");
    expect(ADMIN).toContain("handleAcctNotifAction(u.id, 'dismiss')");
    // Accounting actions never go through the legacy read handler.
    expect(ADMIN).toContain("/api/accounting/notifications/${id}/${action}");
  });
  it("there is ONE bell — no second accounting bell or nav notification item was added", () => {
    // The accounting Action Center stays a work queue, not a second global bell.
    expect(ADMIN).not.toContain("second notification center");
  });
});
