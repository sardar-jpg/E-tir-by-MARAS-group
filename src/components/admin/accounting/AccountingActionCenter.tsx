import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, BellRing, CheckCircle2, Clock, AlertTriangle, Users, Coins, Lock, RefreshCw,
  Check, X, ExternalLink, Circle,
} from "lucide-react";
import type { Language, AccountingNotification, AccountingNotificationCategory, AccountingNotificationType, AccountingNotificationPriority } from "../../../types";
import { apiFetch } from "../../../lib/api";
import { PageHeader, KpiCard, Panel, EmptyState, money, CARD, btnGhost } from "./AccountingUI";

/**
 * Accounting Phase 9 — Action Center. A read-only, permission-scoped view of
 * the accounting notifications the current user is allowed to see, grouped into
 * sections with deep links to the correct workspace. Marking read/ack/dismiss
 * changes only the notification, never any accounting record.
 */
type Lang = Language;
const L = (l: { en: string; tr: string; ar: string }, lang: Lang) => l[lang] || l.en;

type Row = AccountingNotification & { read?: boolean };

const CATEGORY_META: Record<AccountingNotificationCategory, { label: { en: string; tr: string; ar: string }; Icon: typeof Users }> = {
  my_approvals: { label: { en: "My Approvals", tr: "Onaylarım", ar: "موافقاتي" }, Icon: CheckCircle2 },
  customer_collections: { label: { en: "Customer Collections", tr: "Müşteri Tahsilatları", ar: "تحصيلات العملاء" }, Icon: Users },
  vendor_payments: { label: { en: "Vendor Payments", tr: "Tedarikçi Ödemeleri", ar: "مدفوعات الموردين" }, Icon: Coins },
  financial_closing: { label: { en: "Financial Closing", tr: "Mali Kapanış", ar: "الإغلاق المالي" }, Icon: Lock },
  warnings: { label: { en: "Warnings", tr: "Uyarılar", ar: "تحذيرات" }, Icon: AlertTriangle },
  completed: { label: { en: "Recently Completed", tr: "Son Tamamlananlar", ar: "المكتملة مؤخراً" }, Icon: Clock },
};
const CATEGORY_ORDER: AccountingNotificationCategory[] = ["my_approvals", "customer_collections", "vendor_payments", "financial_closing", "warnings", "completed"];

const TITLE: Record<AccountingNotificationType, { en: string; tr: string; ar: string }> = {
  cost_statement_approval_required: { en: "Cost Statement Approval Required", tr: "Maliyet Onayı Gerekli", ar: "مطلوب اعتماد كشف التكلفة" },
  cost_statement_approval_rejected: { en: "Cost Statement Rejected — Correction Needed", tr: "Maliyet Reddedildi", ar: "تم رفض كشف التكلفة" },
  cost_statement_fully_approved: { en: "Cost Statement Fully Approved", tr: "Maliyet Tamamen Onaylandı", ar: "تم اعتماد كشف التكلفة بالكامل" },
  cost_statement_reopen_approval_required: { en: "Cost Statement Reopen Approval Required", tr: "Yeniden Açma Onayı Gerekli", ar: "مطلوب اعتماد إعادة الفتح" },
  cost_statement_reopen_rejected: { en: "Cost Statement Reopen Rejected", tr: "Yeniden Açma Reddedildi", ar: "تم رفض إعادة الفتح" },
  financial_reopen_approval_required: { en: "Financial Reopen Approval Required", tr: "Mali Yeniden Açma Onayı Gerekli", ar: "مطلوب اعتماد إعادة الفتح المالي" },
  financial_reopen_rejected: { en: "Financial Reopen Rejected", tr: "Mali Yeniden Açma Reddedildi", ar: "تم رفض إعادة الفتح المالي" },
  financial_reopen_completed: { en: "Financial Reopen Completed", tr: "Mali Yeniden Açma Tamamlandı", ar: "اكتملت إعادة الفتح المالي" },
  customer_invoice_overdue: { en: "Customer Invoice Overdue", tr: "Müşteri Faturası Vadesi Geçti", ar: "فاتورة عميل متأخرة" },
  customer_balance_outstanding: { en: "Customer Balance Outstanding", tr: "Müşteri Bakiyesi Açık", ar: "رصيد عميل مستحق" },
  vendor_balance_outstanding: { en: "Vendor Balance Outstanding", tr: "Tedarikçi Bakiyesi Açık", ar: "رصيد مورد مستحق" },
  order_ready_for_financial_close: { en: "Order Ready for Financial Close", tr: "Sipariş Mali Kapanışa Hazır", ar: "الطلب جاهز للإغلاق المالي" },
  order_blocked_from_financial_close: { en: "Order Blocked from Financial Close", tr: "Sipariş Mali Kapanışa Engelli", ar: "الطلب محظور من الإغلاق المالي" },
  financial_close_completed: { en: "Financial Close Completed", tr: "Mali Kapanış Tamamlandı", ar: "اكتمل الإغلاق المالي" },
  accounting_integrity_warning: { en: "Accounting Integrity Warning", tr: "Muhasebe Bütünlük Uyarısı", ar: "تحذير سلامة المحاسبة" },
};
const PRIORITY_META: Record<AccountingNotificationPriority, { label: { en: string; tr: string; ar: string }; cls: string }> = {
  critical: { label: { en: "Critical", tr: "Kritik", ar: "حرج" }, cls: "bg-red-100 text-red-700 border-red-200" },
  high: { label: { en: "High", tr: "Yüksek", ar: "مرتفع" }, cls: "bg-amber-100 text-amber-700 border-amber-200" },
  normal: { label: { en: "Normal", tr: "Normal", ar: "عادي" }, cls: "bg-blue-50 text-blue-700 border-blue-200" },
  info: { label: { en: "Info", tr: "Bilgi", ar: "معلومة" }, cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

function describe(n: Row, lang: Lang): string {
  const p = n.params || {};
  const amt = p.amount != null && p.currency ? `${money(p.amount)} ${p.currency}` : "";
  switch (n.type) {
    case "customer_invoice_overdue": return L({ en: `${p.invoiceNumber || ""} · ${amt} outstanding · ${p.daysOverdue} days overdue`, tr: `${p.invoiceNumber || ""} · ${amt} açık · ${p.daysOverdue} gün gecikme`, ar: `${p.invoiceNumber || ""} · ${amt} مستحق · ${p.daysOverdue} يوم تأخير` }, lang);
    case "customer_balance_outstanding": return L({ en: `${p.invoiceNumber || ""} · ${amt} outstanding`, tr: `${p.invoiceNumber || ""} · ${amt} açık`, ar: `${p.invoiceNumber || ""} · ${amt} مستحق` }, lang);
    case "vendor_balance_outstanding": return L({ en: `${p.vendorName || ""} · ${p.description || ""} · ${amt} remaining`, tr: `${p.vendorName || ""} · ${amt} kalan`, ar: `${p.vendorName || ""} · ${amt} متبقٍ` }, lang);
    case "order_blocked_from_financial_close": return L({ en: `Blockers: ${(p.blockers || []).join(", ")}`, tr: `Engeller: ${(p.blockers || []).join(", ")}`, ar: `الموانع: ${(p.blockers || []).join(", ")}` }, lang);
    case "accounting_integrity_warning": return L({ en: `${(p.warningCode || "").replace(/_/g, " ")}`, tr: `${(p.warningCode || "").replace(/_/g, " ")}`, ar: `${(p.warningCode || "").replace(/_/g, " ")}` }, lang);
    default:
      if (p.reason) return L({ en: `Reason: ${p.reason}`, tr: `Sebep: ${p.reason}`, ar: `السبب: ${p.reason}` }, lang);
      if (p.approvalStep) return L({ en: `Approval step ${p.approvalStep}`, tr: `Onay adımı ${p.approvalStep}`, ar: `خطوة الاعتماد ${p.approvalStep}` }, lang);
      return "";
  }
}

const isDismissable = (t: AccountingNotificationType) =>
  t !== "cost_statement_approval_required" && t !== "cost_statement_reopen_approval_required" && t !== "financial_reopen_approval_required" && t !== "cost_statement_approval_rejected";

export default function AccountingActionCenter({ lang, onNavigate }: { lang: Lang; onNavigate: (tab: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<{ unread: number; high: number; critical: number; total: number; byCategory: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "unread" | "resolved" | "dismissed" | "all">("active");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [listRes, sumRes] = await Promise.all([
        apiFetch(`/api/accounting/notifications?status=${statusFilter}&pageSize=200`),
        apiFetch("/api/accounting/notifications/summary"),
      ]);
      if (listRes.ok) { const d = await listRes.json(); setRows(d.rows || []); }
      else setError((await listRes.json().catch(() => ({}))).error || "Failed to load notifications.");
      if (sumRes.ok) setSummary(await sumRes.json());
    } catch { setError("Failed to load notifications."); } finally { setLoading(false); }
  }, [statusFilter]);

  // Refresh (re-evaluate) on first mount so the center reflects live state.
  useEffect(() => {
    void (async () => {
      setRefreshing(true);
      try { await apiFetch("/api/accounting/notifications/evaluate", { method: "POST" }); } catch { /* non-fatal */ }
      await load(); setRefreshing(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (!loading) void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => { setRefreshing(true); try { await apiFetch("/api/accounting/notifications/evaluate", { method: "POST" }); } catch { /* */ } await load(); setRefreshing(false); };

  const act = async (n: Row, action: "read" | "acknowledge" | "dismiss") => {
    setBusyId(n.id);
    try {
      const res = await apiFetch(`/api/accounting/notifications/${n.id}/${action}`, { method: "POST" });
      if (res.ok) await load();
      else setError((await res.json().catch(() => ({}))).error || "Action failed.");
    } catch { setError("Action failed."); } finally { setBusyId(""); }
  };

  const grouped = useMemo(() => {
    const m = new Map<AccountingNotificationCategory, Row[]>();
    for (const n of rows) (m.get(n.category) || m.set(n.category, []).get(n.category)!).push(n);
    return m;
  }, [rows]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={L({ en: "Accounting Action Center", tr: "Muhasebe Eylem Merkezi", ar: "مركز إجراءات المحاسبة" }, lang)}
        subtitle={L({ en: "Accounting work that needs attention — approvals, collections, payments, closings and warnings. Informational only; every card links to the right screen.", tr: "Dikkat gerektiren muhasebe işleri. Yalnızca bilgilendirme.", ar: "أعمال المحاسبة التي تحتاج انتباهاً. للعرض فقط." }, lang)}
        actions={<button onClick={refresh} disabled={refreshing} className={btnGhost}>{refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{L({ en: "Refresh", tr: "Yenile", ar: "تحديث" }, lang)}</button>}
      />

      {/* Dashboard cards → filter the center */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button onClick={() => setStatusFilter("unread")} className="text-left cursor-pointer border-0 bg-transparent p-0"><KpiCard icon={BellRing} tone="blue" label={L({ en: "Unread", tr: "Okunmamış", ar: "غير مقروء" }, lang)} value={String(summary.unread)} /></button>
          <KpiCard icon={AlertTriangle} tone="red" label={L({ en: "Critical", tr: "Kritik", ar: "حرج" }, lang)} value={String(summary.critical)} />
          <KpiCard icon={Clock} tone="amber" label={L({ en: "High", tr: "Yüksek", ar: "مرتفع" }, lang)} value={String(summary.high)} />
          <KpiCard icon={CheckCircle2} tone="slate" label={L(CATEGORY_META.my_approvals.label, lang)} value={String(summary.byCategory.my_approvals || 0)} />
          <KpiCard icon={Users} tone="blue" label={L(CATEGORY_META.customer_collections.label, lang)} value={String(summary.byCategory.customer_collections || 0)} />
          <KpiCard icon={Coins} tone="slate" label={L(CATEGORY_META.vendor_payments.label, lang)} value={String(summary.byCategory.vendor_payments || 0)} />
        </div>
      )}

      <div className={`${CARD} p-1.5 flex gap-1 flex-wrap`}>
        {(["active", "unread", "resolved", "dismissed", "all"] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer border-0 ${statusFilter === s ? "bg-slate-900 text-white" : "bg-transparent text-slate-600 hover:bg-slate-100"}`}>
            {L({ active: { en: "Active", tr: "Aktif", ar: "نشط" }, unread: { en: "Unread", tr: "Okunmamış", ar: "غير مقروء" }, resolved: { en: "Resolved", tr: "Çözüldü", ar: "محلول" }, dismissed: { en: "Dismissed", tr: "Kapatıldı", ar: "مرفوض" }, all: { en: "All", tr: "Tümü", ar: "الكل" } }[s], lang)}
          </button>
        ))}
      </div>

      {error && <p className="text-[12px] font-semibold text-red-600">{error}</p>}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={L({ en: "You're all caught up", tr: "Her şey güncel", ar: "لا يوجد ما يحتاج انتباهاً" }, lang)} body={L({ en: "No accounting notifications match this filter.", tr: "Bu filtreye uygun bildirim yok.", ar: "لا إشعارات مطابقة." }, lang)} />
      ) : (
        CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => {
          const meta = CATEGORY_META[cat];
          return (
            <Panel key={cat} title={L(meta.label, lang)} subtitle={`${grouped.get(cat)!.length}`}>
              <div className="space-y-2">
                {grouped.get(cat)!.map((n) => (
                  <div key={n.id} className={`rounded-xl border p-3.5 flex items-start gap-3 ${n.read ? "border-slate-100 bg-white" : "border-blue-100 bg-blue-50/30"}`}>
                    <span className="pt-0.5 shrink-0">{n.read ? <Circle className="w-3.5 h-3.5 text-slate-300" /> : <Circle className="w-3.5 h-3.5 text-blue-500 fill-blue-500" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold text-slate-800">{L(TITLE[n.type], lang)}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${PRIORITY_META[n.priority].cls}`}>{L(PRIORITY_META[n.priority].label, lang)}</span>
                        {n.status === "resolved" && <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">{L({ en: "Resolved", tr: "Çözüldü", ar: "محلول" }, lang)}</span>}
                      </div>
                      <p className="text-[11.5px] text-slate-500 mt-0.5">{describe(n, lang)}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10.5px] text-slate-400 flex-wrap">
                        {n.orderRef && <span className="font-mono font-semibold text-slate-500">{n.orderRef}</span>}
                        {n.params.customerName && <span>· {n.params.customerName}</span>}
                        <span>· {new Date(n.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {n.actionTab && <button onClick={() => onNavigate(n.actionTab!)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer" title={L({ en: "Open", tr: "Aç", ar: "فتح" }, lang)}><ExternalLink className="w-3.5 h-3.5" /></button>}
                      {n.status !== "resolved" && !n.read && <button disabled={busyId === n.id} onClick={() => act(n, "read")} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer" title={L({ en: "Mark read", tr: "Okundu", ar: "مقروء" }, lang)}><Check className="w-3.5 h-3.5" /></button>}
                      {n.status !== "resolved" && n.status !== "acknowledged" && <button disabled={busyId === n.id} onClick={() => act(n, "acknowledge")} className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer text-[10.5px] font-bold">{L({ en: "Ack", tr: "Onayla", ar: "إقرار" }, lang)}</button>}
                      {n.status !== "resolved" && n.status !== "dismissed" && isDismissable(n.type) && <button disabled={busyId === n.id} onClick={() => act(n, "dismiss")} className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 cursor-pointer" title={L({ en: "Dismiss", tr: "Kapat", ar: "إخفاء" }, lang)}><X className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}
