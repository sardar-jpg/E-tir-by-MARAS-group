import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ACTIONS } from "./accountingAudit";
import {
  ACCOUNTING_PERMISSION_KEYS, LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS, SENSITIVE_ACCOUNTING_PERMISSIONS,
  resolveEffectivePermissions,
} from "./accountingPermissions";

const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const idx = (needle: string) => { const i = SERVER.indexOf(needle); if (i < 0) throw new Error(`not found: ${needle}`); return i; };
const region = (needle: string, length: number) => SERVER.slice(idx(needle), idx(needle) + length);

describe("Phase 9 notification permissions", () => {
  it("registers view + configure keys; view is in the legacy default, configure is sensitive", () => {
    expect(ACCOUNTING_PERMISSION_KEYS).toContain("accounting.notifications.view");
    expect(ACCOUNTING_PERMISSION_KEYS).toContain("accounting.notifications.configure");
    expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).toContain("accounting.notifications.view");
    expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).not.toContain("accounting.notifications.configure");
    expect(SENSITIVE_ACCOUNTING_PERMISSIONS).toContain("accounting.notifications.configure");
  });
  it("a non-super accounts user can open the action center; configure needs an explicit grant", () => {
    const acc = resolveEffectivePermissions({ role: "admin", adminType: "accounts" });
    expect(acc.has("accounting.notifications.view")).toBe(true);
    expect(acc.has("accounting.notifications.configure")).toBe(false);
    const op = resolveEffectivePermissions({ role: "admin", adminType: "operation" });
    expect(op.has("accounting.notifications.view")).toBe(false);
  });
});

describe("Phase 9 routes are permissioned and mutate notifications only", () => {
  it("list/summary/evaluate/read/ack/dismiss require accounting.notifications.view", () => {
    expect(SERVER).toContain('app.get("/api/accounting/notifications", requirePermission("accounting.notifications.view")');
    expect(SERVER).toContain('app.get("/api/accounting/notifications/summary", requirePermission("accounting.notifications.view")');
    expect(SERVER).toContain('app.post("/api/accounting/notifications/evaluate", requirePermission("accounting.notifications.view")');
    expect(SERVER).toContain('app.post("/api/accounting/notifications/:id/read", requirePermission("accounting.notifications.view")');
    expect(SERVER).toContain('app.post("/api/accounting/notifications/:id/acknowledge", requirePermission("accounting.notifications.view")');
    expect(SERVER).toContain('app.post("/api/accounting/notifications/:id/dismiss", requirePermission("accounting.notifications.view")');
  });
  it("settings GET needs view; PUT needs the sensitive configure permission", () => {
    expect(SERVER).toContain('app.get("/api/accounting/notifications/settings", requirePermission("accounting.notifications.view")');
    expect(SERVER).toContain('app.put("/api/accounting/notifications/settings", requirePermission("accounting.notifications.configure")');
  });
  it("visibility check requires the recipient OR the per-notification scope permission (view never bypasses scope)", () => {
    expect(SERVER).toContain("AcctNotify.isNotificationVisible(n");
    const LOAD = region("async function loadVisibleNotifOr404", 700);
    expect(LOAD).toContain("acctNotifVisibleTo(n, req.session, perms)");
    expect(LOAD).toContain('res.status(404)'); // not-visible → 404 (no id enumeration)
  });
  it("state routes write ONLY the notification doc + an audit event — no accounting mutation", () => {
    const BLOCK = region("Accounting Phase 9 — Notifications & Action Center", 12000);
    expect(BLOCK).not.toContain("mutateCostStatementAtomic");
    expect(BLOCK).not.toContain("runAccountingTransaction");
    expect(BLOCK).toContain('setDoc(doc(db, "accountingNotifications"');
    expect(BLOCK).toContain("AUDIT_ACTIONS.notificationRead");
    expect(BLOCK).toContain("AUDIT_ACTIONS.notificationDismissed");
  });
  it("dismiss refuses action-required approvals (409 not_dismissable)", () => {
    const DISMISS = region('app.post("/api/accounting/notifications/:id/dismiss"', 900);
    expect(DISMISS).toContain("AcctNotify.isDismissable(n.type)");
    expect(DISMISS).toContain('code: "not_dismissable"');
  });
  it("settings PUT permanently forces external delivery OFF (in-app only)", () => {
    const PUT = region('app.put("/api/accounting/notifications/settings"', 2400);
    expect(PUT).toContain("externalDeliveryEnabled: false");
    expect(PUT).toContain("AUDIT_ACTIONS.notificationSettingsUpdated");
  });
  it("evaluation derives from the shared reporting dataset + the pure evaluator (no DB scan per page load)", () => {
    const RECON = region("async function reconcileAcctNotifications", 1600);
    expect(RECON).toContain("loadReportingDataset()");
    expect(RECON).toContain("AcctNotify.evaluateAccountingNotifications(");
    expect(RECON).toContain("AcctNotify.reconcileNotifications(");
  });
  it("audit action strings are the canonical Phase 9 lifecycle actions", () => {
    expect(AUDIT_ACTIONS.notificationRead).toBe("accounting.notification_read");
    expect(AUDIT_ACTIONS.notificationAcknowledged).toBe("accounting.notification_acknowledged");
    expect(AUDIT_ACTIONS.notificationDismissed).toBe("accounting.notification_dismissed");
    expect(AUDIT_ACTIONS.notificationSettingsUpdated).toBe("accounting.notification_settings_updated");
  });
  it("no external delivery channel is wired (in-app only)", () => {
    const BLOCK = region("Accounting Phase 9 — Notifications & Action Center", 12000);
    for (const bad of ["sendEmail", "nodemailer", "twilio", "sendSms", "whatsapp", "fcm.send", "pushNotification"]) {
      expect(BLOCK.toLowerCase()).not.toContain(bad.toLowerCase());
    }
  });
});
