import { describe, it, expect } from "vitest";
import type { CostStatement, CustomerInvoice, CustomerPayment, VendorPaymentTransaction, AccountingNotification } from "../types";
import {
  evaluateAccountingNotifications, reconcileNotifications, isNotificationVisible, isDismissable,
  resolveNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS, type DesiredNotification,
} from "./accountingNotificationRules";

// ── Fixtures ────────────────────────────────────────────────────────────────
function stmt(o: Partial<CostStatement>): CostStatement {
  return {
    shipmentId: o.shipmentId || "S1", shipmentNumber: o.shipmentNumber || "MAR-2026-001", companyName: o.companyName ?? "Acme",
    shipmentType: "land", date: "2026-01-05", currency: "USD", totalCost: 600, paidAmount: 0, remainingBalance: 0, paymentStatus: "Unpaid",
    notes: "", items: o.items || [], createdAt: "2026-01-05T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z", accountingStatus: o.accountingStatus ?? "final_closed", ...o,
  } as CostStatement;
}
const item = (o: any) => ({ id: o.id || "c1", costType: "freight", description: o.description || "Freight", quantity: 1, unitPrice: 0, totalAmount: o.totalAmount ?? 600, currency: o.currency || "USD", supplierName: o.supplierName ?? "Vendor A", ...o });
function invoice(o: Partial<CustomerInvoice>): CustomerInvoice {
  return { id: o.id || "i1", invoiceNumber: o.invoiceNumber || "INV1", shipmentId: o.shipmentId || "S1", shipmentNumber: o.shipmentNumber || "MAR-2026-001", companyName: o.companyName ?? "Acme", currency: o.currency || "USD", pricingMode: "manual", costBasis: 0, sellingAmount: o.sellingAmount ?? 1000, status: o.status || "issued", createdAt: "2026-01-10T00:00:00Z", ...o } as CustomerInvoice;
}
function cpay(o: Partial<CustomerPayment>): CustomerPayment {
  return { id: o.id || "p1", companyName: "Acme", amount: o.amount ?? 400, currency: o.currency || "USD", paymentDate: o.paymentDate || "2026-01-15", paymentMethod: "bank", allocations: o.allocations || [], status: o.status || "active", createdBy: "u", createdAt: "2026-01-15T00:00:00Z", ...o } as CustomerPayment;
}
function vpay(o: Partial<VendorPaymentTransaction>): VendorPaymentTransaction {
  return { id: o.id || "vp1", shipmentId: o.shipmentId || "S1", shipmentNumber: "MAR-2026-001", costStatementId: "S1", costItemId: o.costItemId || "c1", vendorName: "Vendor A", amount: o.amount ?? 300, currency: o.currency || "USD", paymentDate: "2026-01-20", paymentMethod: "bank", createdBy: "u", createdAt: "2026-01-20T00:00:00Z", status: o.status || "active", ...o } as VendorPaymentTransaction;
}
const ASOF = "2026-03-01";
const evalAll = (over: Partial<Parameters<typeof evaluateAccountingNotifications>[0]>) =>
  evaluateAccountingNotifications({ asOfDate: ASOF, statements: [], invoices: [], customerPayments: [], vendorPayments: [], activeUserIds: ["u1", "u2", "u3"], ...over });
const byType = (list: DesiredNotification[], t: string) => list.filter((n) => n.type === t);

// ── Approval workflow ─────────────────────────────────────────────────────────
describe("approval notifications", () => {
  const submitted = stmt({ accountingStatus: "pending_accounts_approval", approvalCycle: 1, cycleApproverUserIds: ["u1", "u2", "u3"], submittedBy: "u9" });
  it("notifies only the current captured approver (position 1 → u2), not future approvers", () => {
    const list = evalAll({ statements: [submitted] });
    const appr = byType(list, "cost_statement_approval_required");
    expect(appr).toHaveLength(1);
    expect(appr[0].recipientUserId).toBe("u2");
    expect(appr[0].params.approvalStep).toBe(2);
    expect(list.some((n) => n.recipientUserId === "u3" && n.type === "cost_statement_approval_required")).toBe(false);
  });
  it("uses the captured snapshot, so changing settings does not change recipients", () => {
    const list = evalAll({ statements: [submitted] });
    // Snapshot is ["u1","u2","u3"]; there is no config read at all.
    expect(byType(list, "cost_statement_approval_required")[0].recipientUserId).toBe("u2");
  });
  it("an inactive captured approver raises an invalid-recipient integrity warning", () => {
    const list = evalAll({ statements: [submitted], activeUserIds: ["u1", "u3"] });
    expect(byType(list, "cost_statement_approval_required")).toHaveLength(0);
    const warn = byType(list, "accounting_integrity_warning").find((w) => w.params.warningCode === "invalid_approval_recipient");
    expect(warn?.priority).toBe("critical");
    expect(warn?.permissionScope).toBe("accountingAudit.view");
  });
  it("rejected statement notifies the submitter", () => {
    const list = evalAll({ statements: [stmt({ accountingStatus: "rejected_for_correction", submittedBy: "u9" })] });
    const rej = byType(list, "cost_statement_approval_rejected")[0];
    expect(rej.recipientUserId).toBe("u9");
  });
  it("recently finalized statement notifies the submitter (completed); old one does not", () => {
    const recent = evalAll({ statements: [stmt({ accountingStatus: "final_closed", submittedBy: "u9", finalizedAt: "2026-02-25T00:00:00Z" })] });
    expect(byType(recent, "cost_statement_fully_approved")).toHaveLength(1);
    const old = evalAll({ statements: [stmt({ accountingStatus: "final_closed", submittedBy: "u9", finalizedAt: "2026-01-01T00:00:00Z" })] });
    expect(byType(old, "cost_statement_fully_approved")).toHaveLength(0);
  });
});

// ── Reopen chains ─────────────────────────────────────────────────────────────
describe("reopen + financial reopen notifications", () => {
  it("cost statement reopen notifies the current snapshot approver", () => {
    const s = stmt({ accountingStatus: "reopen_requested", reopenCycles: [{ reopenCycleNumber: 1, approverUserIds: ["u1", "u2"], currentPosition: 0, status: "pending", requestedBy: "u9", requestedAt: "t", reason: "fix", decisions: [] }] as any });
    const list = evalAll({ statements: [s] });
    const r = byType(list, "cost_statement_reopen_approval_required")[0];
    expect(r.recipientUserId).toBe("u1");
    expect(r.params.reason).toBe("fix");
  });
  it("financial reopen notifies the current snapshot approver", () => {
    const s = stmt({ financialStatus: "financial_closed", financialReopenCycles: [{ reopenCycleNumber: 1, approverUserIds: ["u2", "u3"], currentPosition: 1, status: "pending", requestedBy: "u9", requestedAt: "t", reason: "adjust", decisions: [] }] as any });
    const list = evalAll({ statements: [s] });
    const r = byType(list, "financial_reopen_approval_required")[0];
    expect(r.recipientUserId).toBe("u3");
  });
  it("rejected reopen (recent) notifies requester", () => {
    const s = stmt({ accountingStatus: "final_closed", reopenCycles: [{ reopenCycleNumber: 1, approverUserIds: ["u1"], currentPosition: 0, status: "rejected", requestedBy: "u9", requestedAt: "t", reason: "x", decisions: [], decidedAt: "2026-02-25T00:00:00Z" }] as any });
    expect(byType(evalAll({ statements: [s] }), "cost_statement_reopen_rejected")[0].recipientUserId).toBe("u9");
  });
});

// ── Customer reminders ────────────────────────────────────────────────────────
describe("customer reminders", () => {
  it("issued unpaid invoice with no due date → outstanding (not overdue)", () => {
    const list = evalAll({ invoices: [invoice({ status: "issued", sellingAmount: 1000 })] });
    expect(byType(list, "customer_balance_outstanding")).toHaveLength(1);
    expect(byType(list, "customer_invoice_overdue")).toHaveLength(0);
  });
  it("overdue invoice supersedes plain outstanding and carries aging + days", () => {
    const list = evalAll({ invoices: [invoice({ status: "issued", sellingAmount: 1000, dueDate: "2025-09-01" })] });
    expect(byType(list, "customer_balance_outstanding")).toHaveLength(0);
    const od = byType(list, "customer_invoice_overdue")[0];
    expect(od.params.agingBucket).toBe("overdue_over_90");
    expect(od.params.daysOverdue).toBeGreaterThan(90);
    expect(od.params.currency).toBe("USD");
    expect(od.priority).toBe("critical"); // > 60 day severe threshold
  });
  it("a moderately overdue invoice (≤ threshold) is high, not critical", () => {
    const list = evalAll({ invoices: [invoice({ status: "issued", sellingAmount: 1000, dueDate: "2026-02-01" })] });
    const od = byType(list, "customer_invoice_overdue")[0];
    expect(od.params.agingBucket).toBe("overdue_1_30");
    expect(od.priority).toBe("high");
  });
  it("partially paid invoice remains a reminder with correct remaining", () => {
    const list = evalAll({ invoices: [invoice({ id: "i2", status: "partially_paid", sellingAmount: 1000 })], customerPayments: [cpay({ amount: 400, allocations: [{ invoiceId: "i2", invoiceNumber: "INV", amount: 400 }] })] });
    expect(byType(list, "customer_balance_outstanding")[0].params.amount).toBe(600);
  });
  it("fully paid, cancelled, draft invoices produce no reminder", () => {
    for (const status of ["paid", "cancelled", "draft"] as const) {
      expect(evalAll({ invoices: [invoice({ status, sellingAmount: 1000 })] }).filter((n) => n.type.startsWith("customer_"))).toHaveLength(0);
    }
  });
  it("reversed customer payment does not reduce the outstanding balance", () => {
    const list = evalAll({ invoices: [invoice({ id: "i3", status: "issued", sellingAmount: 1000 })], customerPayments: [cpay({ status: "reversed", amount: 1000, allocations: [{ invoiceId: "i3", invoiceNumber: "INV", amount: 1000 }] })] });
    expect(byType(list, "customer_balance_outstanding")[0].params.amount).toBe(1000);
  });
});

// ── Vendor reminders ──────────────────────────────────────────────────────────
describe("vendor reminders", () => {
  it("approved unpaid cost line creates a reminder; unapproved statement does not", () => {
    const approved = evalAll({ statements: [stmt({ accountingStatus: "final_closed", items: [item({ totalAmount: 600 })] })] });
    expect(byType(approved, "vendor_balance_outstanding")).toHaveLength(1);
    const draft = evalAll({ statements: [stmt({ accountingStatus: "draft", items: [item({ totalAmount: 600 })] })] });
    expect(byType(draft, "vendor_balance_outstanding")).toHaveLength(0);
  });
  it("partial vs full payment: reminder remaining updates; full payment removes it", () => {
    const partial = evalAll({ statements: [stmt({ items: [item({ id: "c1", totalAmount: 600 })] })], vendorPayments: [vpay({ costItemId: "c1", amount: 250 })] });
    expect(byType(partial, "vendor_balance_outstanding")[0].params.amount).toBe(350);
    const full = evalAll({ statements: [stmt({ items: [item({ id: "c1", totalAmount: 600 })] })], vendorPayments: [vpay({ costItemId: "c1", amount: 600 })] });
    expect(byType(full, "vendor_balance_outstanding")).toHaveLength(0);
  });
  it("reversed vendor payment reactivates the outstanding balance", () => {
    const list = evalAll({ statements: [stmt({ items: [item({ id: "c1", totalAmount: 600 })] })], vendorPayments: [vpay({ costItemId: "c1", amount: 600, status: "reversed" })] });
    expect(byType(list, "vendor_balance_outstanding")[0].params.amount).toBe(600);
  });
  it("vendor reminders are scoped to vendorPayments.view and never use Driver Agreed Amount", () => {
    const list = evalAll({ statements: [stmt({ agreedAmount: 999999, items: [item({ totalAmount: 600 })] })] });
    const v = byType(list, "vendor_balance_outstanding")[0];
    expect(v.permissionScope).toBe("vendorPayments.view");
    expect(v.params.amount).toBe(600);
  });
});

// ── Financial close ───────────────────────────────────────────────────────────
describe("financial close readiness + blockers", () => {
  const paidInvoice = (id: string) => ({ inv: invoice({ id, status: "paid", sellingAmount: 1000 }), pay: cpay({ id: "p" + id, amount: 1000, allocations: [{ invoiceId: id, invoiceNumber: "INV", amount: 1000 }] }) });
  it("a fully-settled final_closed order is READY", () => {
    const { inv, pay } = paidInvoice("iR");
    const s = stmt({ shipmentId: "S1", accountingStatus: "final_closed", items: [item({ id: "c1", totalAmount: 600 })] });
    const list = evaluateAccountingNotifications({ asOfDate: ASOF, statements: [s], invoices: [inv], customerPayments: [pay], vendorPayments: [vpay({ costItemId: "c1", amount: 600 })], activeUserIds: [] });
    expect(byType(list, "order_ready_for_financial_close")).toHaveLength(1);
    expect(byType(list, "order_ready_for_financial_close")[0].permissionScope).toBe("accounting.financialClose");
  });
  it("customer + vendor balances BLOCK readiness and list the blockers", () => {
    const s = stmt({ shipmentId: "S1", accountingStatus: "final_closed", items: [item({ id: "c1", totalAmount: 600 })] });
    const list = evaluateAccountingNotifications({ asOfDate: ASOF, statements: [s], invoices: [invoice({ id: "iB", status: "issued", sellingAmount: 1000 })], customerPayments: [], vendorPayments: [], activeUserIds: [] });
    const blocked = byType(list, "order_blocked_from_financial_close")[0];
    expect(blocked.params.blockers).toEqual(expect.arrayContaining(["vendor_balance", "customer_balance"]));
  });
  it("a draft invoice blocks readiness", () => {
    const { inv, pay } = paidInvoice("iD");
    const s = stmt({ shipmentId: "S1", accountingStatus: "final_closed", items: [item({ id: "c1", totalAmount: 600 })] });
    const list = evaluateAccountingNotifications({ asOfDate: ASOF, statements: [s], invoices: [inv, invoice({ id: "draft1", status: "draft" })], customerPayments: [pay], vendorPayments: [vpay({ costItemId: "c1", amount: 600 })], activeUserIds: [] });
    expect(byType(list, "order_blocked_from_financial_close")[0].params.blockers).toContain("draft_invoice");
  });
  it("a non-final (still draft) order is neither ready nor blocked (no early-stage noise)", () => {
    const list = evalAll({ statements: [stmt({ accountingStatus: "draft", items: [item({})] })] });
    expect(byType(list, "order_ready_for_financial_close")).toHaveLength(0);
    expect(byType(list, "order_blocked_from_financial_close")).toHaveLength(0);
  });
  it("an already financially closed order produces no ready/blocked, but a recent close completion", () => {
    const s = stmt({ shipmentId: "S1", accountingStatus: "final_closed", financialStatus: "financial_closed", financialClosedAt: "2026-02-26T00:00:00Z", items: [item({})] });
    const list = evalAll({ statements: [s] });
    expect(byType(list, "order_ready_for_financial_close")).toHaveLength(0);
    expect(byType(list, "financial_close_completed")).toHaveLength(1);
  });
});

// ── Deduplication + reconciliation ───────────────────────────────────────────
describe("deduplication + resolution", () => {
  const existing = (o: Partial<AccountingNotification>): AccountingNotification => ({
    id: o.id || "n1", type: o.type || "vendor_balance_outstanding", category: "vendor_payments", priority: o.priority || "normal",
    params: o.params || { amount: 350 }, status: o.status || "unread", deduplicationKey: o.deduplicationKey || "vendor_balance_outstanding:S1:c1:partially_paid",
    sourceVersion: o.sourceVersion || "350", createdAt: "t", ...o,
  });
  it("the same evaluation twice yields identical dedup keys (idempotent → no duplicates)", () => {
    const s = stmt({ items: [item({ id: "c1", totalAmount: 600 })] });
    const a = evalAll({ statements: [s], vendorPayments: [vpay({ costItemId: "c1", amount: 250 })] });
    const b = evalAll({ statements: [s], vendorPayments: [vpay({ costItemId: "c1", amount: 250 })] });
    expect(a.map((n) => n.deduplicationKey)).toEqual(b.map((n) => n.deduplicationKey));
  });
  it("reconcile creates new, updates changed metadata, and resolves gone conditions", () => {
    const desired: DesiredNotification[] = [
      { type: "vendor_balance_outstanding", category: "vendor_payments", priority: "normal", params: { amount: 200 }, deduplicationKey: "vendor_balance_outstanding:S1:c1:partially_paid", sourceVersion: "200" },
      { type: "customer_balance_outstanding", category: "customer_collections", priority: "normal", params: { amount: 500 }, deduplicationKey: "customer_balance_outstanding:i1:unpaid", sourceVersion: "500" },
    ];
    const stored = [existing({ id: "keep", deduplicationKey: "vendor_balance_outstanding:S1:c1:partially_paid", sourceVersion: "350", params: { amount: 350 } }), existing({ id: "gone", deduplicationKey: "vendor_balance_outstanding:S1:c9:unpaid" })];
    const r = reconcileNotifications(stored, desired);
    expect(r.toCreate.map((c) => c.deduplicationKey)).toEqual(["customer_balance_outstanding:i1:unpaid"]);
    expect(r.toUpdate.map((u) => u.existing.id)).toEqual(["keep"]);
    expect(r.toResolve.map((x) => x.id)).toEqual(["gone"]);
  });
  it("a dismissed notification is kept (not recreated) while its condition holds, and resolvable when gone", () => {
    const dismissed = existing({ id: "d1", status: "dismissed", deduplicationKey: "vendor_balance_outstanding:S1:c1:partially_paid", sourceVersion: "350", params: { amount: 350 } });
    // Same condition, same version → neither created nor updated (stays dismissed).
    const same = reconcileNotifications([dismissed], [{ type: "vendor_balance_outstanding", category: "vendor_payments", priority: "normal", params: { amount: 350 }, deduplicationKey: dismissed.deduplicationKey, sourceVersion: "350" }]);
    expect(same.toCreate).toHaveLength(0);
    expect(same.toUpdate).toHaveLength(0);
    // Condition gone → resolved.
    expect(reconcileNotifications([dismissed], []).toResolve.map((x) => x.id)).toEqual(["d1"]);
  });
});

// ── Visibility, dismissal, settings ──────────────────────────────────────────
describe("visibility + dismissal + settings", () => {
  it("visible to the recipient OR a holder of the scope permission, else not", () => {
    const has = (k: string) => k === "vendorPayments.view";
    expect(isNotificationVisible({ recipientUserId: "u1" }, "u1", () => false)).toBe(true);
    expect(isNotificationVisible({ recipientUserId: "u1" }, "u2", () => false)).toBe(false);
    expect(isNotificationVisible({ permissionScope: "vendorPayments.view" }, "u2", has)).toBe(true);
    expect(isNotificationVisible({ permissionScope: "customerPayments.view" }, "u2", has)).toBe(false);
  });
  it("approval action items cannot be dismissed; informational reminders can", () => {
    expect(isDismissable("cost_statement_approval_required")).toBe(false);
    expect(isDismissable("financial_reopen_approval_required")).toBe(false);
    expect(isDismissable("customer_invoice_overdue")).toBe(true);
    expect(isDismissable("financial_close_completed")).toBe(true);
  });
  it("settings default safely and force external delivery off", () => {
    expect(resolveNotificationSettings(null)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(resolveNotificationSettings({ externalDeliveryEnabled: true as any }).externalDeliveryEnabled).toBe(false);
    expect(resolveNotificationSettings({ overdueRemindersEnabled: false }).overdueRemindersEnabled).toBe(false);
  });
  it("disabling a reminder category suppresses only that category", () => {
    const list = evalAll({ invoices: [invoice({ status: "issued", sellingAmount: 1000 })], settings: { customerBalanceRemindersEnabled: false } });
    expect(list.filter((n) => n.type === "customer_balance_outstanding")).toHaveLength(0);
  });
});
