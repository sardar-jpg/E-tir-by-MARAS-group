import { useEffect, useRef, useState } from "react";
import { CircleDollarSign, Receipt, Package, Scale, ChevronRight, AlertCircle } from "lucide-react";
import type { Language } from "../../../types";
import { apiFetch } from "../../../lib/api";
import type { ExecutiveFinanceOverview } from "../../../lib/executiveFinance";
import {
  snapshotCurrencyTabs,
  currencySnapshot,
  formatSnapshotAmount,
  SNAPSHOT_METRIC_ORDER,
  type SnapshotMetricKey,
} from "../../../lib/financialSnapshot";
import CurrencyTabs from "./CurrencyTabs";
import FinancialMetricRow from "./FinancialMetricRow";

type LoadState = "loading" | "ready" | "error" | "no_access";

const L: Record<string, Record<Language, string>> = {
  title: { en: "Financial Snapshot", tr: "Finansal Özet", ar: "لمحة مالية" },
  viewDetails: { en: "View details", tr: "Ayrıntılar", ar: "عرض التفاصيل" },
  receivables: { en: "Outstanding Receivables", tr: "Bekleyen Alacaklar", ar: "الذمم المدينة المستحقة" },
  vendorPayables: { en: "Vendor Payables", tr: "Tedarikçi Borçları", ar: "مستحقات الموردين" },
  openShipmentValue: { en: "Open Shipment Value", tr: "Açık Sevkiyat Değeri", ar: "قيمة الشحنات المفتوحة" },
  netExposure: { en: "Net Exposure", tr: "Net Pozisyon", ar: "صافي المكشوف" },
  noData: { en: "No records in this currency yet.", tr: "Bu para biriminde henüz kayıt yok.", ar: "لا توجد سجلات بهذه العملة بعد." },
  error: { en: "Financial snapshot could not be loaded.", tr: "Finansal özet yüklenemedi.", ar: "تعذّر تحميل اللمحة المالية." },
};
const tr = (k: string, lang: Language) => L[k]?.[lang] ?? L[k]?.en ?? k;

const ROW_META: Record<SnapshotMetricKey, { icon: typeof Receipt; iconClass: string }> = {
  receivables: { icon: CircleDollarSign, iconClass: "bg-emerald-50 text-emerald-600" },
  vendorPayables: { icon: Receipt, iconClass: "bg-amber-50 text-amber-600" },
  openShipmentValue: { icon: Package, iconClass: "bg-indigo-50 text-indigo-600" },
  netExposure: { icon: Scale, iconClass: "bg-blue-50 text-blue-600" },
};

/**
 * Financial Snapshot (Dashboard Overview) — ONE compact card, currency-
 * tabbed (USD / TRY / IQD by default, plus any extra currency that has
 * records). Every figure is REAL accounting data from
 * GET /api/admin/dashboard/financial (the same server-computed, per-
 * currency overview the Executive Financial page uses). Currencies are
 * never summed or converted; switching a tab reads a different bucket.
 *
 * Accounting access only: an operation admin's request 403s and the card
 * simply does not render (never a broken or empty accounting surface for a
 * role that isn't allowed to see money).
 */
export default function FinancialSnapshotCard({
  lang,
  onViewDetails,
}: {
  lang: Language;
  onViewDetails: () => void;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [overview, setOverview] = useState<ExecutiveFinanceOverview | null>(null);
  const [selected, setSelected] = useState<string>("USD"); // USD selected by default
  const idPrefix = useRef(`fin-snap-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/dashboard/financial");
        if (!alive) return;
        if (res.status === 403) { setState("no_access"); return; }
        if (!res.ok) { setState("error"); return; }
        const body = await res.json();
        if (!alive) return;
        setOverview(body.financial ?? null);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, []);

  if (state === "no_access") return null;

  const Header = (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-black tracking-tight text-slate-900">{tr("title", lang)}</h3>
      <button
        onClick={onViewDetails}
        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline"
      >
        {tr("viewDetails", lang)}
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
      </button>
    </div>
  );

  const cardClass = "flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

  if (state === "loading") {
    return (
      <section className={cardClass} aria-busy="true" aria-label={tr("title", lang)}>
        {Header}
        <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-100" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-4 flex-1 animate-pulse rounded bg-slate-100" />
              <div className="h-6 w-20 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className={cardClass} aria-label={tr("title", lang)}>
        {Header}
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-4 text-xs font-semibold text-slate-500">
          <AlertCircle className="h-4 w-4 text-slate-400" />
          {tr("error", lang)}
        </div>
      </section>
    );
  }

  const tabs = snapshotCurrencyTabs(overview);
  const active = tabs.includes(selected) ? selected : tabs[0];
  const snap = currencySnapshot(overview, active);

  return (
    <section className={cardClass} aria-label={tr("title", lang)}>
      {Header}
      <CurrencyTabs currencies={tabs} selected={active} onSelect={setSelected} idPrefix={idPrefix} lang={lang} />
      <div
        role="tabpanel"
        id={`${idPrefix}-panel`}
        aria-labelledby={`${idPrefix}-tab-${active}`}
        className="divide-y divide-slate-100"
      >
        {SNAPSHOT_METRIC_ORDER.map((key) => (
          <FinancialMetricRow
            key={key}
            icon={ROW_META[key].icon}
            iconClass={ROW_META[key].iconClass}
            label={tr(key, lang)}
            amount={formatSnapshotAmount(snap.metrics[key], lang)}
            currency={active}
          />
        ))}
      </div>
      {!snap.hasData && (
        <p className="text-[11px] font-medium text-slate-400">{tr("noData", lang)}</p>
      )}
    </section>
  );
}
