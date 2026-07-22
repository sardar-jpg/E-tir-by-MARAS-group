/**
 * unifiedNotifications.ts — Accounting Phase 9.1. A pure PRESENTATION adapter
 * that normalizes the two internal notification shapes (the legacy
 * AppNotification store and the Accounting Phase 9 accountingNotifications
 * store) into ONE shared view-model so the single main notification center can
 * render both in one chronological list.
 *
 * It only reshapes for display: neither database model is changed, no records
 * are copied between stores, and one underlying notification maps to exactly
 * one unified item (source-qualified key prevents id collisions).
 */
import type {
  AppNotification, AccountingNotification, AccountingNotificationType, Language,
} from "../types";

export type UnifiedCategory = "operational" | "accounting" | "users" | "system" | "broadcast";
export type UnifiedIconKey = "truck" | "finance" | "user" | "warning" | "megaphone";
export type UnifiedSource = "legacy" | "accounting";

export interface UnifiedNotification {
  /** Source-qualified React key / mutation target — never the raw id alone. */
  key: string;
  id: string;
  source: UnifiedSource;
  category: UnifiedCategory;
  iconKey: UnifiedIconKey;
  title: string;
  message: string;
  createdAt: string;
  createdAtMs: number;
  isRead: boolean;
  priority?: string;
  /** Accounting deep-link tab (existing AdminPanel tab id), when available. */
  actionTab?: string;
  canDismiss: boolean;
  /** The untouched source record, for source-specific actions. */
  original: AppNotification | AccountingNotification;
}

/** The single category → icon mapping used everywhere in the unified center. */
export const CATEGORY_ICON: Record<UnifiedCategory, UnifiedIconKey> = {
  operational: "truck",
  accounting: "finance",
  users: "user",
  system: "warning",
  broadcast: "megaphone",
};

/** Map a legacy AppNotification.type onto a unified category. */
export function legacyCategory(type: AppNotification["type"]): UnifiedCategory {
  switch (type) {
    case "driver_registration": return "users";
    case "ai_alert": return "system";
    case "assignment": case "acceptance": case "rejection": case "status_update":
    case "chat": case "doc_upload": case "delivery": case "alliance_offer": case "alliance_update":
      return "operational";
    default: return "operational";
  }
}

/** Every accounting notification is the Accounting category (finance icon). */
export function accountingCategory(_type: AccountingNotificationType): UnifiedCategory {
  return "accounting";
}

const pick = (l: { en: string; tr: string; ar: string }, lang: Language) => l[lang] || l.en;

// Compact trilingual titles for accounting notifications (display only).
const ACCT_TITLE: Record<AccountingNotificationType, { en: string; tr: string; ar: string }> = {
  cost_statement_approval_required: { en: "Cost Statement Approval Required", tr: "Maliyet Onayı Gerekli", ar: "مطلوب اعتماد كشف التكلفة" },
  cost_statement_approval_rejected: { en: "Cost Statement Rejected", tr: "Maliyet Reddedildi", ar: "تم رفض كشف التكلفة" },
  cost_statement_fully_approved: { en: "Cost Statement Fully Approved", tr: "Maliyet Onaylandı", ar: "تم اعتماد كشف التكلفة" },
  cost_statement_reopen_approval_required: { en: "Reopen Approval Required", tr: "Yeniden Açma Onayı Gerekli", ar: "مطلوب اعتماد إعادة الفتح" },
  cost_statement_reopen_rejected: { en: "Reopen Rejected", tr: "Yeniden Açma Reddedildi", ar: "تم رفض إعادة الفتح" },
  financial_reopen_approval_required: { en: "Financial Reopen Approval Required", tr: "Mali Yeniden Açma Onayı Gerekli", ar: "مطلوب اعتماد إعادة الفتح المالي" },
  financial_reopen_rejected: { en: "Financial Reopen Rejected", tr: "Mali Yeniden Açma Reddedildi", ar: "تم رفض إعادة الفتح المالي" },
  financial_reopen_completed: { en: "Financial Reopen Completed", tr: "Mali Yeniden Açma Tamamlandı", ar: "اكتملت إعادة الفتح المالي" },
  customer_invoice_overdue: { en: "Customer Invoice Overdue", tr: "Müşteri Faturası Gecikti", ar: "فاتورة عميل متأخرة" },
  customer_balance_outstanding: { en: "Customer Balance Outstanding", tr: "Müşteri Bakiyesi Açık", ar: "رصيد عميل مستحق" },
  vendor_balance_outstanding: { en: "Vendor Balance Outstanding", tr: "Tedarikçi Bakiyesi Açık", ar: "رصيد مورد مستحق" },
  order_ready_for_financial_close: { en: "Order Ready for Financial Close", tr: "Mali Kapanışa Hazır", ar: "جاهز للإغلاق المالي" },
  order_blocked_from_financial_close: { en: "Order Blocked from Financial Close", tr: "Mali Kapanışa Engelli", ar: "محظور من الإغلاق المالي" },
  financial_close_completed: { en: "Financial Close Completed", tr: "Mali Kapanış Tamamlandı", ar: "اكتمل الإغلاق المالي" },
  accounting_integrity_warning: { en: "Accounting Integrity Warning", tr: "Muhasebe Bütünlük Uyarısı", ar: "تحذير سلامة المحاسبة" },
};

/** Localized accounting title. */
export function accountingTitle(type: AccountingNotificationType, lang: Language): string {
  return pick(ACCT_TITLE[type] || ACCT_TITLE.accounting_integrity_warning, lang);
}
/** A short, localized one-line summary from the notification params (no full records). */
export function accountingSummary(n: AccountingNotification, lang: Language): string {
  const p = n.params || {};
  const amt = p.amount != null && p.currency ? `${p.amount} ${p.currency}` : "";
  const bits: string[] = [];
  if (p.orderRef) bits.push(p.orderRef);
  if (p.customerName) bits.push(p.customerName);
  else if (p.vendorName) bits.push(p.vendorName);
  if (p.invoiceNumber) bits.push(p.invoiceNumber);
  if (amt) bits.push(lang === "ar" ? `${amt} مستحق` : lang === "tr" ? `${amt} açık` : `${amt} outstanding`);
  if (p.daysOverdue != null) bits.push(lang === "ar" ? `${p.daysOverdue} يوم تأخير` : lang === "tr" ? `${p.daysOverdue} gün gecikme` : `${p.daysOverdue} days overdue`);
  if (p.blockers?.length) bits.push((lang === "ar" ? "الموانع: " : lang === "tr" ? "Engeller: " : "Blockers: ") + p.blockers.join(", "));
  if (p.warningCode) bits.push(p.warningCode.replace(/_/g, " "));
  return bits.join(" · ");
}

const toMs = (iso: string | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

export interface BuildUnifiedInput {
  legacy: AppNotification[];
  accounting: Array<AccountingNotification & { read?: boolean }>;
  lang: Language;
  /** Per-user read resolution for legacy notifications. */
  isLegacyRead: (n: AppNotification) => boolean;
}

/**
 * Merge both sources into ONE newest-first list. Legacy titles come from the
 * record's own trilingual fields; accounting titles/summaries are localized
 * from the type + params. Keys are source-qualified so overlapping ids never
 * collide, and each underlying notification appears exactly once.
 */
export function buildUnifiedList(input: BuildUnifiedInput): UnifiedNotification[] {
  const out: UnifiedNotification[] = [];
  for (const n of input.legacy) {
    const category = legacyCategory(n.type);
    out.push({
      key: `legacy:${n.id}`, id: n.id, source: "legacy", category, iconKey: CATEGORY_ICON[category],
      title: pick({ en: n.titleEn, tr: n.titleTr, ar: n.titleAr }, input.lang),
      message: pick({ en: n.messageEn, tr: n.messageTr, ar: n.messageAr }, input.lang),
      createdAt: n.timestamp, createdAtMs: toMs(n.timestamp), isRead: input.isLegacyRead(n),
      canDismiss: true, original: n,
    });
  }
  for (const n of input.accounting) {
    if (n.status === "resolved" || n.status === "dismissed") continue; // never shown in the live feed
    out.push({
      key: `accounting:${n.id}`, id: n.id, source: "accounting", category: "accounting", iconKey: "finance",
      title: accountingTitle(n.type, input.lang), message: accountingSummary(n, input.lang),
      createdAt: n.createdAt, createdAtMs: toMs(n.createdAt), isRead: n.read === true, priority: n.priority,
      actionTab: n.actionTab, canDismiss: isAccountingDismissable(n.type), original: n,
    });
  }
  out.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return out;
}

/** Approval action-items are never dismissable (mirrors the Phase 9 rule). */
export function isAccountingDismissable(type: AccountingNotificationType): boolean {
  return type !== "cost_statement_approval_required"
    && type !== "cost_statement_reopen_approval_required"
    && type !== "financial_reopen_approval_required"
    && type !== "cost_statement_approval_rejected";
}

/** Combined unread badge = legacy unread + accounting unread (both already visible-scoped). */
export function combinedUnreadCount(legacyUnread: number, accountingUnread: number): number {
  return Math.max(0, legacyUnread) + Math.max(0, accountingUnread);
}
