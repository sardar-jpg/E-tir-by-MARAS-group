import { useState, useEffect, useCallback } from "react";
import { DollarSign, ShieldAlert } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import type { ExecutiveFinanceOverview, CurrencyFinanceOverview } from "../../lib/executiveFinance";
import type { AuditFinding, AuditPriorityAssessment } from "../../lib/auditEngine";

/**
 * Executive Financial Overview + Financial Alerts (PR #133).
 *
 * Every figure comes from the REAL accounting module via
 * GET /api/admin/dashboard/financial (server-computed with the canonical
 * Phase B math, per currency, super/accounts only) — MARAS AI is never
 * involved in any number here. Financial Alerts reuse the deterministic
 * PR #131 accounting findings verbatim (no new detection logic, no AI).
 * Both cards isolate their failures: an error renders inside the card
 * and the rest of the Dashboard is unaffected.
 */

const L: Record<string, { en: string; tr: string; ar: string }> = {
  financial: { en: "Financial Overview", tr: "Finansal Genel Bakış", ar: "نظرة مالية عامة" },
  sourceNote: { en: "All figures come directly from the accounting records (per currency — never mixed, never AI).", tr: "Tüm rakamlar doğrudan muhasebe kayıtlarından gelir (para birimi bazında — asla karıştırılmaz, asla yapay zekâ).", ar: "جميع الأرقام تأتي مباشرة من سجلات المحاسبة (حسب العملة — لا تُخلط أبدًا، وليست من الذكاء الاصطناعي)." },
  revenue: { en: "Revenue", tr: "Gelir", ar: "الإيرادات" },
  grossProfit: { en: "Gross Profit", tr: "Brüt Kâr", ar: "إجمالي الربح" },
  today: { en: "Today", tr: "Bugün", ar: "اليوم" },
  thisMonth: { en: "This Month", tr: "Bu Ay", ar: "هذا الشهر" },
  thisYear: { en: "This Year", tr: "Bu Yıl", ar: "هذه السنة" },
  receivables: { en: "Receivables", tr: "Alacaklar", ar: "الذمم المدينة" },
  outstanding: { en: "Outstanding", tr: "Bekleyen", ar: "غير محصلة" },
  overdue: { en: "Overdue", tr: "Gecikmiş", ar: "متأخرة" },
  openInvoices: { en: "Open statements", tr: "Açık ekstreler", ar: "كشوف مفتوحة" },
  payables: { en: "Payables", tr: "Borçlar", ar: "الذمم الدائنة" },
  driverPay: { en: "Driver payables", tr: "Sürücü borçları", ar: "مستحقات السائقين" },
  vendorPay: { en: "Vendor payables", tr: "Tedarikçi borçları", ar: "مستحقات الموردين" },
  totalPay: { en: "Total outstanding", tr: "Toplam bekleyen", ar: "إجمالي المستحق" },
  performance: { en: "Performance", tr: "Performans", ar: "الأداء" },
  avgProfit: { en: "Avg profit / shipment (year)", tr: "Sevkiyat başına ort. kâr (yıl)", ar: "متوسط الربح لكل شحنة (سنة)" },
  topShipment: { en: "Top profit shipment (month)", tr: "En kârlı sevkiyat (ay)", ar: "أعلى شحنة ربحًا (شهر)" },
  topCustomer: { en: "Top revenue customer (year)", tr: "En yüksek gelirli müşteri (yıl)", ar: "أعلى عميل إيرادًا (سنة)" },
  profitExcluded: { en: "shipment(s) excluded from profit (currency mismatch)", tr: "sevkiyat kâr hesabına katılmadı (para birimi uyumsuz)", ar: "شحنات مستبعدة من الربح (عدم تطابق العملة)" },
  noData: { en: "No accounting records yet.", tr: "Henüz muhasebe kaydı yok.", ar: "لا توجد سجلات محاسبية بعد." },
  loadError: { en: "Financial overview could not be loaded. The rest of the dashboard is unaffected.", tr: "Finansal genel bakış yüklenemedi. Panonun geri kalanı etkilenmez.", ar: "تعذر تحميل النظرة المالية. بقية اللوحة تعمل كالمعتاد." },
  alerts: { en: "Financial Alerts", tr: "Finansal Uyarılar", ar: "تنبيهات مالية" },
  alertsNote: { en: "Deterministic accounting findings from the audit system — no AI detection.", tr: "Denetim sisteminin deterministik muhasebe bulguları — yapay zekâ tespiti yok.", ar: "نتائج محاسبية حتمية من نظام التدقيق — بدون كشف بالذكاء الاصطناعي." },
  noAlerts: { en: "No open financial alerts.", tr: "Açık finansal uyarı yok.", ar: "لا توجد تنبيهات مالية مفتوحة." },
  openMonitoring: { en: "Open Monitoring", tr: "İzlemeyi Aç", ar: "فتح المراقبة" },
};
const t = (k: string, lang: Language) => (L[k] ? L[k][lang] || L[k].en : k);
const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 min-w-0">
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 truncate">{label}</p>
      <p className="text-sm font-black text-slate-800 truncate">{value}</p>
    </div>
  );
}

function CurrencyBlock({ b, lang }: { b: CurrencyFinanceOverview; lang: Language }) {
  return (
    <div className="space-y-2 min-w-0">
      <h3 className="text-xs font-black text-slate-900">{b.currency}</h3>
      <div className="grid grid-cols-3 gap-1.5">
        <Cell label={`${t("revenue", lang)} · ${t("today", lang)}`} value={money(b.revenue.today)} />
        <Cell label={`${t("revenue", lang)} · ${t("thisMonth", lang)}`} value={money(b.revenue.thisMonth)} />
        <Cell label={`${t("revenue", lang)} · ${t("thisYear", lang)}`} value={money(b.revenue.thisYear)} />
        <Cell label={`${t("grossProfit", lang)} · ${t("today", lang)}`} value={money(b.grossProfit.today)} />
        <Cell label={`${t("grossProfit", lang)} · ${t("thisMonth", lang)}`} value={money(b.grossProfit.thisMonth)} />
        <Cell label={`${t("grossProfit", lang)} · ${t("thisYear", lang)}`} value={money(b.grossProfit.thisYear)} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Cell label={`${t("receivables", lang)} · ${t("outstanding", lang)}`} value={money(b.outstandingReceivables)} />
        <Cell label={`${t("receivables", lang)} · ${t("overdue", lang)}`} value={money(b.overdueReceivables)} />
        <Cell label={t("openInvoices", lang)} value={String(b.outstandingReceivableCount)} />
        <Cell label={t("driverPay", lang)} value={money(b.driverPayables)} />
        <Cell label={t("vendorPay", lang)} value={money(b.vendorPayables)} />
        <Cell label={`${t("payables", lang)} · ${t("totalPay", lang)}`} value={money(b.outstandingPayables)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
        <Cell label={t("avgProfit", lang)} value={b.averageProfitPerShipment === null ? "—" : money(b.averageProfitPerShipment)} />
        <Cell label={t("topShipment", lang)} value={b.highestProfitShipmentThisMonth ? `${b.highestProfitShipmentThisMonth.shipmentNumber} (${money(b.highestProfitShipmentThisMonth.profit)})` : "—"} />
        <Cell label={t("topCustomer", lang)} value={b.highestRevenueCustomer ? `${b.highestRevenueCustomer.companyName} (${money(b.highestRevenueCustomer.revenue)})` : "—"} />
      </div>
      {b.profitExcludedCount > 0 && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 font-semibold">
          {b.profitExcludedCount} {t("profitExcluded", lang)}
        </p>
      )}
    </div>
  );
}

export default function ExecutiveFinancialSection({ lang }: { lang: Language }) {
  const [data, setData] = useState<ExecutiveFinanceOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/dashboard/financial");
        if (!res.ok) { if (!cancelled) setError(t("loadError", lang)); return; }
        const body = await res.json();
        if (!cancelled) setData(body.financial || null);
      } catch {
        if (!cancelled) setError(t("loadError", lang));
      }
    })();
    return () => { cancelled = true; };
  }, [lang]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 min-w-0">
      <div>
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
          <DollarSign className="w-4 h-4 text-emerald-600" />
          <span>{t("financial", lang)}</span>
        </h2>
        <p className="text-[10px] text-slate-400 font-medium">{t("sourceNote", lang)}</p>
      </div>
      {error && <p className="text-[11px] font-semibold text-slate-500">{error}</p>}
      {!error && data && data.currencies.length === 0 && (
        <p className="text-[11px] font-semibold text-slate-400">{t("noData", lang)}</p>
      )}
      {!error && data && data.currencies.map((b) => <CurrencyBlock key={b.currency} b={b} lang={lang} />)}
      {!error && !data && <p className="text-xs text-slate-400 animate-pulse">…</p>}
    </div>
  );
}

const ALERT_BADGE: Record<string, string> = {
  critical_now: "bg-red-100 text-red-700 border-red-200",
  high_today: "bg-orange-100 text-orange-700 border-orange-200",
  medium_soon: "bg-amber-100 text-amber-700 border-amber-200",
  low_monitor: "bg-sky-100 text-sky-700 border-sky-200",
};

/** Financial Alerts: the deterministic accounting-category audit findings, verbatim. */
export function FinancialAlertsCard({ lang, onOpenMonitoring }: { lang: Language; onOpenMonitoring: () => void }) {
  const [alerts, setAlerts] = useState<(AuditFinding & { priority?: AuditPriorityAssessment })[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/audit/findings?category=accounting&status=open");
      if (!res.ok) { setError(t("loadError", lang)); return; }
      const body = await res.json();
      setAlerts(Array.isArray(body.findings) ? body.findings.slice(0, 8) : []);
    } catch {
      setError(t("loadError", lang));
    }
  }, [lang]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-orange-500" />
            <span>{t("alerts", lang)}</span>
          </h2>
          <p className="text-[10px] text-slate-400 font-medium">{t("alertsNote", lang)}</p>
        </div>
        <button
          onClick={onOpenMonitoring}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-orange-300 text-[11px] font-bold text-slate-700 cursor-pointer shrink-0"
        >
          {t("openMonitoring", lang)}
        </button>
      </div>
      {error && <p className="text-[11px] font-semibold text-slate-500">{error}</p>}
      {!error && alerts.length === 0 && (
        <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1.5">{t("noAlerts", lang)}</p>
      )}
      {alerts.map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 bg-slate-50 flex-wrap">
          <span className="text-[11px] font-bold text-slate-800 min-w-0 truncate">{f.title} · {f.recordRef}</span>
          {f.priority && (
            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-black shrink-0 ${ALERT_BADGE[f.priority.priority] || ""}`}>
              {f.priority.emoji} {f.priority.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
