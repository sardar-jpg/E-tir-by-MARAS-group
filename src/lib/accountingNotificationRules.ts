/**
 * accountingNotificationRules.ts — Accounting Phase 9. Pure, deterministic
 * derivation of accounting notifications + reminders from the authoritative
 * Phase 1–8 records. Nothing here mutates anything and nothing performs an
 * accounting action — notifications are informational + navigational only.
 *
 * Design: a single evaluator derives the CURRENT set of "desired" notifications
 * from live state (approvals waiting on the captured approver, reopen /
 * financial-reopen chains, overdue invoices, outstanding customer/vendor
 * balances, Financial-Close readiness/blockers, integrity warnings, and recent
 * completions). A deterministic deduplication key per condition lets the server
 * keep ONE active notification per condition (update, never duplicate) and
 * auto-resolve notifications whose condition has gone away. This derived model
 * naturally covers the event-driven cases without touching the Phase 1–8
 * mutation routes.
 *
 * Hard rules: currencies are never combined and there is no FX; Driver Agreed
 * Amount is never used; Official Profit is never recomputed from cash; only
 * issued invoices and active (non-reversed) payments count.
 */
import type {
  CostStatement, CostItem, CustomerInvoice, CustomerPayment, VendorPaymentTransaction, Currency,
  AccountingNotificationType, AccountingNotificationPriority, AccountingNotificationCategory,
  AccountingNotificationParams, AccountingNotification, AccountingNotificationSettings,
} from "../types";
import { summarizeInvoiceReceivable } from "./customerPayments";
import { summarizeVendorPayable } from "./vendorPayments";
import {
  resolveAccountingStatus, approverPositionForStatus, approverForPosition, resolveCycleApprovers,
  activeReopenCycle, type ReopenCycle,
} from "./costApprovalWorkflow";
import {
  resolveFinancialStatus, evaluateFinancialCloseReadiness, activeFinancialReopenCycle,
} from "./financialClosing";
import { orderRefOf, isCostApproved, vendorDisplayName, calculateReceivableAging, round2 } from "./accountingReports";

const EPS = 0.01;

// ── Settings ────────────────────────────────────────────────────────────────
export const DEFAULT_NOTIFICATION_SETTINGS: AccountingNotificationSettings = {
  overdueRemindersEnabled: true,
  customerBalanceRemindersEnabled: true,
  vendorBalanceRemindersEnabled: true,
  financialCloseReadinessEnabled: true,
  financialCloseBlockersEnabled: true,
  integrityWarningsEnabled: true,
  severeOverdueThresholdDays: 60,
  reminderRepeatIntervalDays: 7,
  externalDeliveryEnabled: false,
};
/** Merge stored settings over the safe defaults (missing settings ⇒ defaults). */
export function resolveNotificationSettings(stored: Partial<AccountingNotificationSettings> | null | undefined): AccountingNotificationSettings {
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...(stored || {}), externalDeliveryEnabled: false };
}

// ── Category + action-tab maps ──────────────────────────────────────────────
export const CATEGORY_FOR_TYPE: Record<AccountingNotificationType, AccountingNotificationCategory> = {
  cost_statement_approval_required: "my_approvals",
  cost_statement_approval_rejected: "my_approvals",
  cost_statement_fully_approved: "completed",
  cost_statement_reopen_approval_required: "my_approvals",
  cost_statement_reopen_rejected: "my_approvals",
  financial_reopen_approval_required: "my_approvals",
  financial_reopen_rejected: "my_approvals",
  financial_reopen_completed: "completed",
  customer_invoice_overdue: "customer_collections",
  customer_balance_outstanding: "customer_collections",
  vendor_balance_outstanding: "vendor_payments",
  order_ready_for_financial_close: "financial_closing",
  order_blocked_from_financial_close: "financial_closing",
  financial_close_completed: "completed",
  accounting_integrity_warning: "warnings",
};
/** The existing AdminPanel tab a notification deep-links to (no placeholder links). */
export const ACTION_TAB_FOR_TYPE: Record<AccountingNotificationType, string> = {
  cost_statement_approval_required: "costs",
  cost_statement_approval_rejected: "costs",
  cost_statement_fully_approved: "costs",
  cost_statement_reopen_approval_required: "costs",
  cost_statement_reopen_rejected: "costs",
  financial_reopen_approval_required: "costs",
  financial_reopen_rejected: "costs",
  financial_reopen_completed: "costs",
  customer_invoice_overdue: "acct_receivables",
  customer_balance_outstanding: "acct_receivables",
  vendor_balance_outstanding: "acct_payments",
  order_ready_for_financial_close: "costs",
  order_blocked_from_financial_close: "costs",
  financial_close_completed: "costs",
  accounting_integrity_warning: "acct_reports",
};

// ── Desired notification (evaluator output) ─────────────────────────────────
export interface DesiredNotification {
  type: AccountingNotificationType;
  category: AccountingNotificationCategory;
  priority: AccountingNotificationPriority;
  recipientUserId?: string;
  permissionScope?: string;
  shipmentId?: string;
  orderRef?: string;
  invoiceId?: string;
  costLineId?: string;
  params: AccountingNotificationParams;
  actionTab?: string;
  deduplicationKey: string;
  /** Reflects volatile metadata (e.g. days overdue) so updates are detectable. */
  sourceVersion: string;
}

function desired(type: AccountingNotificationType, priority: AccountingNotificationPriority, dedupSuffix: string, params: AccountingNotificationParams, extra: Partial<DesiredNotification> = {}): DesiredNotification {
  return {
    type, category: CATEGORY_FOR_TYPE[type], priority, params,
    deduplicationKey: `${type}:${dedupSuffix}`, actionTab: ACTION_TAB_FOR_TYPE[type],
    sourceVersion: extra.sourceVersion ?? "1", ...extra,
  };
}

const DAY = 86_400_000;
const dayOf = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z").getTime();
  return Number.isFinite(d) ? d : null;
};
/** Whole days between an ISO timestamp and asOfDate (for recency windows). */
function daysSince(iso: string | undefined, asOfDate: string): number | null {
  const a = dayOf(iso); const b = dayOf(asOfDate);
  if (a == null || b == null) return null;
  return Math.floor((b - a) / DAY);
}

export interface EvaluateInput {
  asOfDate: string;
  statements: CostStatement[];
  invoices: CustomerInvoice[];
  customerPayments: CustomerPayment[];
  vendorPayments: VendorPaymentTransaction[];
  activeUserIds: string[];
  settings?: Partial<AccountingNotificationSettings> | null;
  /** Completions within this many days show under "Recently Completed". */
  recentWindowDays?: number;
}

const PENDING_STATUSES = new Set(["pending_operations_approval", "pending_accounts_approval", "pending_managing_director_approval"]);

/**
 * Derive the full set of desired accounting notifications from authoritative
 * state. Pure — no clock (asOfDate is injected), no I/O, no mutation.
 */
export function evaluateAccountingNotifications(input: EvaluateInput): DesiredNotification[] {
  const settings = resolveNotificationSettings(input.settings);
  const activeUsers = new Set(input.activeUserIds);
  const recentWindow = input.recentWindowDays ?? 7;
  const out: DesiredNotification[] = [];

  const invoicesByShipment = new Map<string, CustomerInvoice[]>();
  for (const inv of input.invoices) (invoicesByShipment.get(inv.shipmentId) || invoicesByShipment.set(inv.shipmentId, []).get(inv.shipmentId)!).push(inv);
  const vendorPaymentsByShipment = new Map<string, VendorPaymentTransaction[]>();
  for (const vp of input.vendorPayments) (vendorPaymentsByShipment.get(vp.shipmentId) || vendorPaymentsByShipment.set(vp.shipmentId, []).get(vp.shipmentId)!).push(vp);

  for (const stmt of input.statements) {
    const status = resolveAccountingStatus(stmt as any);
    const financialStatus = resolveFinancialStatus(stmt as any);
    const orderRef = orderRefOf(stmt);
    const customerName = stmt.companyName || "";
    const baseParams: AccountingNotificationParams = { orderRef, customerName };

    // Missing customer identity (integrity).
    if (settings.integrityWarningsEnabled && !customerName.trim()) {
      out.push(desired("accounting_integrity_warning", "high", `${stmt.shipmentId}:missing_customer`, { ...baseParams, warningCode: "missing_customer" }, { permissionScope: "accountingAudit.view", shipmentId: stmt.shipmentId, orderRef }));
    }

    // 1) Main approval chain — notify only the current captured approver.
    if (PENDING_STATUSES.has(status)) {
      const position = approverPositionForStatus(status as any);
      const approvers = resolveCycleApprovers(stmt as any, null);
      const approverId = position != null ? approverForPosition(approvers, position) : undefined;
      const cycle = stmt.approvalCycle ?? 1;
      if (approverId && activeUsers.has(approverId)) {
        out.push(desired("cost_statement_approval_required", "high", `${stmt.shipmentId}:${cycle}:${position}`,
          { ...baseParams, submittedBy: stmt.submittedBy, approvalStep: (position ?? 0) + 1 },
          { recipientUserId: approverId, shipmentId: stmt.shipmentId, orderRef }));
      } else if (settings.integrityWarningsEnabled) {
        out.push(desired("accounting_integrity_warning", "critical", `${stmt.shipmentId}:invalid_approver:${position}`,
          { ...baseParams, warningCode: "invalid_approval_recipient", approvalStep: (position ?? 0) + 1 },
          { permissionScope: "accountingAudit.view", shipmentId: stmt.shipmentId, orderRef }));
      }
    }
    // Rejected for correction → notify submitter to fix + resubmit.
    if (status === "rejected_for_correction" && stmt.submittedBy) {
      out.push(desired("cost_statement_approval_rejected", "high", `${stmt.shipmentId}:${stmt.approvalCycle ?? 1}`,
        { ...baseParams, submittedBy: stmt.submittedBy }, { recipientUserId: stmt.submittedBy, shipmentId: stmt.shipmentId, orderRef }));
    }
    // Recently fully approved → informational to submitter.
    if (status === "final_closed" && stmt.submittedBy) {
      const age = daysSince(stmt.finalizedAt, input.asOfDate);
      if (age != null && age >= 0 && age <= recentWindow) {
        out.push(desired("cost_statement_fully_approved", "info", `${stmt.shipmentId}:${stmt.approvalCycle ?? 1}`,
          { ...baseParams }, { recipientUserId: stmt.submittedBy, shipmentId: stmt.shipmentId, orderRef }));
      }
    }

    // 2) Cost Statement Reopen chain (captured snapshot approvers).
    const reopen = activeReopenCycle(stmt as any) as ReopenCycle | null;
    if (reopen) {
      const approverId = approverForPosition(reopen.approverUserIds, reopen.currentPosition);
      if (approverId && activeUsers.has(approverId)) {
        out.push(desired("cost_statement_reopen_approval_required", "high", `${stmt.shipmentId}:${reopen.reopenCycleNumber}:${reopen.currentPosition}`,
          { ...baseParams, requestedBy: reopen.requestedBy, reason: reopen.reason, approvalStep: reopen.currentPosition + 1 },
          { recipientUserId: approverId, shipmentId: stmt.shipmentId, orderRef }));
      } else if (settings.integrityWarningsEnabled) {
        out.push(desired("accounting_integrity_warning", "critical", `${stmt.shipmentId}:invalid_reopen_approver:${reopen.currentPosition}`,
          { ...baseParams, warningCode: "invalid_approval_recipient" }, { permissionScope: "accountingAudit.view", shipmentId: stmt.shipmentId, orderRef }));
      }
    } else {
      const lastReopen = lastCycle(stmt.reopenCycles as ReopenCycle[] | undefined);
      if (lastReopen && lastReopen.status === "rejected" && withinWindow(lastReopen.decidedAt, input.asOfDate, recentWindow)) {
        out.push(desired("cost_statement_reopen_rejected", "normal", `${stmt.shipmentId}:${lastReopen.reopenCycleNumber}`,
          { ...baseParams, requestedBy: lastReopen.requestedBy }, { recipientUserId: lastReopen.requestedBy, shipmentId: stmt.shipmentId, orderRef }));
      }
    }

    // 3) Financial Reopen chain.
    const finReopen = activeFinancialReopenCycle(stmt as any);
    if (finReopen) {
      const approverId = approverForPosition(finReopen.approverUserIds, finReopen.currentPosition);
      if (approverId && activeUsers.has(approverId)) {
        out.push(desired("financial_reopen_approval_required", "high", `${stmt.shipmentId}:${finReopen.reopenCycleNumber}:${finReopen.currentPosition}`,
          { ...baseParams, requestedBy: finReopen.requestedBy, reason: finReopen.reason, approvalStep: finReopen.currentPosition + 1 },
          { recipientUserId: approverId, shipmentId: stmt.shipmentId, orderRef }));
      }
    } else {
      const lastFin = lastCycle(stmt.financialReopenCycles as ReopenCycle[] | undefined);
      if (lastFin && lastFin.status === "rejected" && withinWindow(lastFin.decidedAt, input.asOfDate, recentWindow)) {
        out.push(desired("financial_reopen_rejected", "normal", `${stmt.shipmentId}:${lastFin.reopenCycleNumber}`,
          { ...baseParams, requestedBy: lastFin.requestedBy }, { recipientUserId: lastFin.requestedBy, shipmentId: stmt.shipmentId, orderRef }));
      }
    }
    // Financial reopen completed (recent).
    if (financialStatus === "financial_reopened" && withinWindow(stmt.financialReopenedAt, input.asOfDate, recentWindow)) {
      out.push(desired("financial_reopen_completed", "info", `${stmt.shipmentId}:${stmt.financialReopenedAt || ""}`,
        { ...baseParams }, { permissionScope: "accounting.financialReopen", shipmentId: stmt.shipmentId, orderRef }));
    }
    // Financial close completed (recent).
    if (financialStatus === "financial_closed" && withinWindow(stmt.financialClosedAt, input.asOfDate, recentWindow)) {
      out.push(desired("financial_close_completed", "info", `${stmt.shipmentId}:${stmt.financialClosedAt || ""}`,
        { ...baseParams }, { permissionScope: "accounting.financialClose", shipmentId: stmt.shipmentId, orderRef }));
    }

    // 4) Vendor outstanding balances (approved cost lines only).
    if (settings.vendorBalanceRemindersEnabled && isCostApproved(stmt)) {
      const payments = vendorPaymentsByShipment.get(stmt.shipmentId) || [];
      for (const item of (stmt.items as CostItem[]) || []) {
        const s = summarizeVendorPayable(item, payments);
        const vendorName = vendorDisplayName(item);
        if (settings.integrityWarningsEnabled && !((item.supplierName || "").trim()) && !((item.vendorId || "").trim())) {
          out.push(desired("accounting_integrity_warning", "high", `${stmt.shipmentId}:missing_vendor:${item.id}`, { ...baseParams, warningCode: "missing_vendor", description: item.description }, { permissionScope: "accountingAudit.view", shipmentId: stmt.shipmentId, orderRef, costLineId: item.id }));
        }
        if (settings.integrityWarningsEnabled && s.status === "Overpaid") {
          out.push(desired("accounting_integrity_warning", "critical", `${stmt.shipmentId}:vendor_overpaid:${item.id}`, { ...baseParams, vendorName, warningCode: "vendor_overpaid", amount: s.totalPaid, currency: item.currency }, { permissionScope: "accountingAudit.view", shipmentId: stmt.shipmentId, orderRef, costLineId: item.id }));
        } else if (s.remaining > EPS) {
          const balanceState = s.totalPaid > 0 ? "partially_paid" : "unpaid";
          out.push(desired("vendor_balance_outstanding", "normal", `${stmt.shipmentId}:${item.id}:${balanceState}`,
            { ...baseParams, vendorName, description: item.description || item.costType, amount: s.remaining, currency: item.currency },
            { permissionScope: "vendorPayments.view", shipmentId: stmt.shipmentId, orderRef, costLineId: item.id, sourceVersion: String(s.remaining) }));
        }
      }
    }

    // 5) Financial Close readiness / blockers (only for final_closed, not-yet-closed orders).
    if (status === "final_closed" && financialStatus !== "financial_closed") {
      const readiness = computeReadiness(stmt, invoicesByShipment.get(stmt.shipmentId) || [], input.customerPayments, vendorPaymentsByShipment.get(stmt.shipmentId) || [], financialStatus);
      if (readiness.ok && settings.financialCloseReadinessEnabled) {
        out.push(desired("order_ready_for_financial_close", "normal", `${stmt.shipmentId}`, { ...baseParams }, { permissionScope: "accounting.financialClose", shipmentId: stmt.shipmentId, orderRef }));
      } else if (!readiness.ok && settings.financialCloseBlockersEnabled) {
        out.push(desired("order_blocked_from_financial_close", "high", `${stmt.shipmentId}`,
          { ...baseParams, blockers: readiness.blockers }, { permissionScope: "accounting.financialClose", shipmentId: stmt.shipmentId, orderRef, sourceVersion: readiness.blockers.join(",") }));
      }
    }
  }

  // 6) Customer invoices — overdue supersedes plain outstanding (per invoice).
  for (const inv of input.invoices) {
    if (!(inv.status === "issued" || inv.status === "partially_paid")) continue;
    const s = summarizeInvoiceReceivable(inv, input.customerPayments);
    const remaining = round2(s.remainingAmount);
    const orderRef = inv.shipmentNumber || inv.shipmentId;
    if (settings.integrityWarningsEnabled && remaining < -EPS) {
      out.push(desired("accounting_integrity_warning", "critical", `${inv.id}:invoice_overpaid`, { orderRef, customerName: inv.companyName, invoiceNumber: inv.invoiceNumber, warningCode: "invoice_overpaid", currency: inv.currency }, { permissionScope: "accountingAudit.view", shipmentId: inv.shipmentId, orderRef, invoiceId: inv.id }));
      continue;
    }
    if (remaining <= EPS) continue;
    const params: AccountingNotificationParams = { orderRef, customerName: inv.companyName, invoiceNumber: inv.invoiceNumber, amount: remaining, currency: inv.currency, dueDate: inv.dueDate };
    const aged = calculateReceivableAging({ dueDate: inv.dueDate, remainingAmount: remaining, asOfDate: input.asOfDate });
    const overdue = aged.bucket !== "current_not_due" && aged.bucket !== "due_date_unavailable";
    if (overdue && settings.overdueRemindersEnabled) {
      const priority: AccountingNotificationPriority = aged.daysOverdue > settings.severeOverdueThresholdDays ? "critical" : "high";
      out.push(desired("customer_invoice_overdue", priority, `${inv.id}:${aged.bucket}`,
        { ...params, daysOverdue: aged.daysOverdue, agingBucket: aged.bucket },
        { permissionScope: "customerPayments.view", shipmentId: inv.shipmentId, orderRef, invoiceId: inv.id, sourceVersion: String(aged.daysOverdue) }));
    } else if (!overdue && settings.customerBalanceRemindersEnabled) {
      const balanceState = inv.status === "partially_paid" ? "partially_paid" : "unpaid";
      out.push(desired("customer_balance_outstanding", "normal", `${inv.id}:${balanceState}`,
        { ...params }, { permissionScope: "customerPayments.view", shipmentId: inv.shipmentId, orderRef, invoiceId: inv.id, sourceVersion: String(remaining) }));
    }
  }

  return out;
}

function lastCycle(cycles: ReopenCycle[] | undefined): ReopenCycle | null {
  if (!Array.isArray(cycles) || cycles.length === 0) return null;
  return cycles[cycles.length - 1];
}
function withinWindow(iso: string | undefined, asOfDate: string, windowDays: number): boolean {
  const age = daysSince(iso, asOfDate);
  return age != null && age >= 0 && age <= windowDays;
}

/** Financial-close readiness + a human blocker list, reusing the Phase 6 evaluator. */
export function computeReadiness(
  stmt: CostStatement, invoices: CustomerInvoice[], customerPayments: CustomerPayment[],
  vendorPayments: VendorPaymentTransaction[], financialStatus: string,
): { ok: boolean; blockers: string[] } {
  const items = (stmt.items as CostItem[]) || [];
  const vendorRemaining = items.map((it) => summarizeVendorPayable(it, vendorPayments).remaining);
  const issued = invoices.filter((i) => i.status === "issued" || i.status === "partially_paid" || i.status === "paid");
  const invoiceRemaining = issued.map((inv) => summarizeInvoiceReceivable(inv, customerPayments).remainingAmount);
  const hasDraftInvoice = invoices.some((i) => i.status === "draft");
  const hasPendingReopenActive = activeReopenCycle(stmt as any) !== null;
  const hasPendingFinReopen = activeFinancialReopenCycle(stmt as any) !== null;
  const decision = evaluateFinancialCloseReadiness({
    accountingStatus: resolveAccountingStatus(stmt as any), financialStatus: financialStatus as any,
    vendorRemaining, invoiceRemaining, hasDraftInvoice, hasPendingReopen: hasPendingReopenActive, hasPendingFinancialReopen: hasPendingFinReopen,
  });
  if (decision.ok) return { ok: true, blockers: [] };
  const blockers: string[] = [];
  if (vendorRemaining.some((r) => r > EPS)) blockers.push("vendor_balance");
  if (invoiceRemaining.some((r) => r > EPS)) blockers.push("customer_balance");
  if (hasDraftInvoice) blockers.push("draft_invoice");
  if (hasPendingReopenActive) blockers.push("active_reopen");
  if (hasPendingFinReopen) blockers.push("active_financial_reopen");
  if (blockers.length === 0) blockers.push((decision as any).code || "not_ready");
  return { ok: false, blockers };
}

// ── Reconciliation (dedup + resolution) ─────────────────────────────────────
export interface ReconcileResult {
  toCreate: DesiredNotification[];
  toUpdate: Array<{ existing: AccountingNotification; desired: DesiredNotification }>;
  toResolve: AccountingNotification[];
}
/**
 * Diff the desired set against the currently NON-resolved stored notifications
 * by deduplication key: unmatched desired → create; matched → update metadata
 * (never revert a dismissed one to unread); stored-but-no-longer-desired →
 * resolve. Deterministic and pure; the server persists the result.
 */
export function reconcileNotifications(existingActive: AccountingNotification[], desired: DesiredNotification[]): ReconcileResult {
  const existingByKey = new Map<string, AccountingNotification>();
  for (const n of existingActive) if (n.status !== "resolved") existingByKey.set(n.deduplicationKey, n);
  const desiredByKey = new Map<string, DesiredNotification>();
  for (const d of desired) if (!desiredByKey.has(d.deduplicationKey)) desiredByKey.set(d.deduplicationKey, d);

  const toCreate: DesiredNotification[] = [];
  const toUpdate: Array<{ existing: AccountingNotification; desired: DesiredNotification }> = [];
  for (const [key, d] of desiredByKey) {
    const ex = existingByKey.get(key);
    if (!ex) toCreate.push(d);
    else if (ex.sourceVersion !== d.sourceVersion || JSON.stringify(ex.params) !== JSON.stringify(d.params) || ex.priority !== d.priority) toUpdate.push({ existing: ex, desired: d });
  }
  const toResolve: AccountingNotification[] = [];
  for (const [key, ex] of existingByKey) if (!desiredByKey.has(key)) toResolve.push(ex);
  return { toCreate, toUpdate, toResolve };
}

// ── Visibility + dismissal rules ────────────────────────────────────────────
/** A notification is visible to a user who is its recipient OR holds its scope permission. */
export function isNotificationVisible(notif: Pick<AccountingNotification, "recipientUserId" | "permissionScope">, userId: string, hasPermission: (key: string) => boolean): boolean {
  if (notif.recipientUserId && notif.recipientUserId === userId) return true;
  if (notif.permissionScope && hasPermission(notif.permissionScope)) return true;
  return false;
}
/** Approval-type notifications are action items and can never be permanently dismissed. */
export function isDismissable(type: AccountingNotificationType): boolean {
  return type !== "cost_statement_approval_required"
    && type !== "cost_statement_reopen_approval_required"
    && type !== "financial_reopen_approval_required"
    && type !== "cost_statement_approval_rejected";
}

/** Priority ordering for sorting (critical first). */
export const PRIORITY_RANK: Record<AccountingNotificationPriority, number> = { critical: 0, high: 1, normal: 2, info: 3 };
