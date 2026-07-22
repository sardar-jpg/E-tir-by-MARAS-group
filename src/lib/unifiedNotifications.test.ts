import { describe, it, expect } from "vitest";
import type { AppNotification, AccountingNotification } from "../types";
import {
  buildUnifiedList, combinedUnreadCount, legacyCategory, accountingCategory, CATEGORY_ICON,
  isAccountingDismissable, accountingTitle,
} from "./unifiedNotifications";

const legacy = (o: Partial<AppNotification>): AppNotification => ({
  id: o.id || "L1", shipmentId: o.shipmentId || "S1", shipmentNumber: "MAR-2026-001",
  titleEn: o.titleEn || "Shipment update", titleTr: "Guncelleme", titleAr: "تحديث",
  messageEn: o.messageEn || "msg", messageTr: "m", messageAr: "م",
  type: o.type || "status_update", timestamp: o.timestamp || "2026-03-01T10:00:00Z", read: false,
  readByUserIds: o.readByUserIds || [], ...o,
} as AppNotification);
const acct = (o: Partial<AccountingNotification> & { read?: boolean }): AccountingNotification & { read?: boolean } => ({
  id: o.id || "A1", type: o.type || "vendor_balance_outstanding", category: "vendor_payments", priority: o.priority || "normal",
  params: o.params || { orderRef: "MAR-2026-001", amount: 350, currency: "USD" }, status: o.status || "unread",
  deduplicationKey: o.deduplicationKey || "k", createdAt: o.createdAt || "2026-03-02T09:00:00Z", actionTab: o.actionTab || "acct_payments",
  read: o.read, ...o,
} as AccountingNotification & { read?: boolean });

describe("category → icon mapping", () => {
  it("maps the five categories to their required icons", () => {
    expect(CATEGORY_ICON.operational).toBe("truck");
    expect(CATEGORY_ICON.accounting).toBe("finance");
    expect(CATEGORY_ICON.users).toBe("user");
    expect(CATEGORY_ICON.system).toBe("warning");
    expect(CATEGORY_ICON.broadcast).toBe("megaphone");
  });
  it("legacy types map to operational/users/system", () => {
    expect(legacyCategory("status_update")).toBe("operational");
    expect(legacyCategory("chat")).toBe("operational");
    expect(legacyCategory("alliance_offer")).toBe("operational");
    expect(legacyCategory("driver_registration")).toBe("users");
    expect(legacyCategory("ai_alert")).toBe("system");
  });
  it("every accounting type (incl. integrity warning) is the accounting category + finance icon", () => {
    expect(accountingCategory("accounting_integrity_warning")).toBe("accounting");
    const warn = buildUnifiedList({ legacy: [], accounting: [acct({ type: "accounting_integrity_warning", priority: "critical" })], lang: "en", isLegacyRead: () => false })[0];
    expect(warn.category).toBe("accounting");
    expect(warn.iconKey).toBe("finance");
    expect(warn.priority).toBe("critical"); // warning priority styling preserved
  });
});

describe("unified list", () => {
  it("merges both sources newest-first with source-qualified keys (no collisions)", () => {
    const list = buildUnifiedList({
      legacy: [legacy({ id: "X", timestamp: "2026-03-01T10:00:00Z" })],
      accounting: [acct({ id: "X", createdAt: "2026-03-03T10:00:00Z" })], // same raw id!
      lang: "en", isLegacyRead: () => false,
    });
    expect(list.map((u) => u.key)).toEqual(["accounting:X", "legacy:X"]); // newest (accounting) first, keys distinct
    expect(new Set(list.map((u) => u.key)).size).toBe(2);
  });
  it("one displayed item per underlying notification (no duplicates)", () => {
    const list = buildUnifiedList({ legacy: [legacy({ id: "L1" }), legacy({ id: "L2" })], accounting: [acct({ id: "A1" })], lang: "en", isLegacyRead: () => false });
    expect(list).toHaveLength(3);
  });
  it("resolved/dismissed accounting notifications never appear in the live feed", () => {
    const list = buildUnifiedList({ legacy: [], accounting: [acct({ id: "r", status: "resolved" }), acct({ id: "d", status: "dismissed" }), acct({ id: "ok", status: "unread" })], lang: "en", isLegacyRead: () => false });
    expect(list.map((u) => u.id)).toEqual(["ok"]);
  });
  it("localizes accounting titles + legacy titles per language", () => {
    const en = buildUnifiedList({ legacy: [legacy({})], accounting: [acct({ type: "customer_invoice_overdue" })], lang: "en", isLegacyRead: () => false });
    expect(en.find((u) => u.source === "accounting")!.title).toBe(accountingTitle("customer_invoice_overdue", "en"));
    const ar = buildUnifiedList({ legacy: [legacy({})], accounting: [], lang: "ar", isLegacyRead: () => false });
    expect(ar[0].title).toBe("تحديث");
  });
  it("legacy read state comes from the injected resolver; accounting from the read flag", () => {
    const list = buildUnifiedList({ legacy: [legacy({ id: "L" })], accounting: [acct({ id: "A", read: true })], lang: "en", isLegacyRead: (n) => n.id === "L" });
    expect(list.find((u) => u.source === "legacy")!.isRead).toBe(true);
    expect(list.find((u) => u.source === "accounting")!.isRead).toBe(true);
  });
});

describe("combined unread + dismissability", () => {
  it("combines both unread counts and never goes negative", () => {
    expect(combinedUnreadCount(3, 2)).toBe(5);
    expect(combinedUnreadCount(-1, 0)).toBe(0);
  });
  it("approval action items are not dismissable; reminders are", () => {
    expect(isAccountingDismissable("cost_statement_approval_required")).toBe(false);
    expect(isAccountingDismissable("financial_reopen_approval_required")).toBe(false);
    expect(isAccountingDismissable("customer_invoice_overdue")).toBe(true);
    const list = buildUnifiedList({ legacy: [], accounting: [acct({ type: "cost_statement_approval_required" })], lang: "en", isLegacyRead: () => false });
    expect(list[0].canDismiss).toBe(false);
  });
});
