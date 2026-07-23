import { useEffect, useRef, useState } from "react";
import { CircleDollarSign, Receipt, Package, Scale, TrendingUp, AlertTriangle, ChevronRight } from "lucide-react";
import type { Language } from "../../../types";
import { apiFetch } from "../../../lib/api";
import type { ExecutiveFinanceOverview } from "../../../lib/executiveFinance";
import {
  snapshotCurrencyTabs,
  currencySnapshot,
  formatSnapshotAmount,
  netPositionKind,
  netPositionDisplayAmount,
  type NetPositionKind,
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
  fundingGap: { en: "Funding Gap", tr: "Finansman Açığı", ar: "المبلغ المطلوب تغطيته" },
  netSurplus: { en: "Net Surplus", tr: "Net Fazla", ar: "صافي الفائض" },
  balanced: { en: "Balanced", tr: "Dengeli", ar: "متوازن" },
  netTooltip: {
    en: "Compares outstanding customer receivables with vendor payables for the selected currency.",
    tr: "Seçili para birimi için müşteri alacakları ile tedarikçi borçlarını karşılaştırır.",
    ar: "مقارنة المبالغ المستحقة من العملاء مع المبالغ المستحقة للموردين للعملة المحددة.",
  },
  noData: { en: "No records in this currency yet.", tr: "Bu para biriminde henüz kayıt yok.", ar: "لا توجد سجلات بهذه العملة بعد." },
  error: { en: "Financial snapshot could not be loaded.", tr: "Finansal özet yüklenemedi.", ar: "تعذّر تحميل اللمحة المالية." },
};
const tr = (k: string, lang: Language) => L[k]?.[lang] ?? L[k]?.en ?? k;

// The three fixed base rows (the fourth is the derived net-position row).
const BASE_ROWS = [
  { key: "receivables" as const, icon: CircleDollarSign, iconClass: "bg-emerald-50 text-emerald-600" },
  { key: "vendorPayables" as const, icon: Receipt, iconClass: "bg-amber-50 text-amber-600" },
  { key: "openShipmentValue" as const, icon: Package, iconClass: "bg-indigo-50 text-indigo-600" },
];

// Net-position row presentation, by outcome. The value shown is always a
// POSITIVE amount; the outcome (and colour) conveys gap vs surplus.
const NET_META: Record<NetPositionKind, { labelKey: string; icon: typeof Scale; iconClass: string; valueClass: string }> = {
  funding_gap: { labelKey: "fundingGap", icon: AlertTriangle, iconClass: "bg-rose-50 text-rose-600", valueClass: "text-rose-600" },
  net_surplus: { labelKey: "netSurplus", icon: TrendingUp, iconClass: "bg-emerald-50 text-emerald-600", valueClass: "text-emerald-600" },
  balanced: { labelKey: "balanced", icon: Scale, iconClass: "bg-slate-100 text-slate-500", valueClass: "text-slate-600" },
};

/**
 * Financial Snapshot (Dashboard Overview) — ONE compact card, currency-
 * tabbed. It shows EXACTLY three tabs: USD / TRY / IQD (USD selected by
 * default, IQD always present even at zero, EUR and any other currency are
 * never added here). Every figure is REAL accounting data from
 * GET /api/admin/dashboard/financial. Currencies are never summed or
 * converted; switching a tab reads a different per-currency bucket.
 *
 * The fourth row is derived per currency from the signed net position
 * (receivables − vendor payables): a red "Funding Gap" when MARAS owes more
 * than it is owed (shown as the positive amount to cover), a green "Net
 * Surplus" when it is owed more, or a neutral "Balanced" at parity.
 *
 * Accounting access only: an operation admin's request 403s and the card
 * simply does not render.
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
          <AlertTriangle className="h-4 w-4 text-slate-400" />
          {tr("error", lang)}
        </div>
      </section>
    );
  }

  const tabs = snapshotCurrencyTabs(); // exactly USD / TRY / IQD
  const active = tabs.includes(selected as (typeof tabs)[number]) ? selected : tabs[0];
  const snap = currencySnapshot(overview, active);

  const netKind = netPositionKind(snap.metrics.netPosition);
  const netMeta = NET_META[netKind];

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
        {BASE_ROWS.map((row) => (
          <FinancialMetricRow
            key={row.key}
            icon={row.icon}
            iconClass={row.iconClass}
            label={tr(row.key, lang)}
            amount={formatSnapshotAmount(snap.metrics[row.key], lang)}
            currency={active}
          />
        ))}
        {/* Fourth row: Funding Gap / Net Surplus / Balanced (always a positive amount). */}
        <FinancialMetricRow
          icon={netMeta.icon}
          iconClass={netMeta.iconClass}
          label={tr(netMeta.labelKey, lang)}
          amount={formatSnapshotAmount(netPositionDisplayAmount(snap.metrics.netPosition), lang)}
          currency={active}
          valueClass={netMeta.valueClass}
          tooltip={tr("netTooltip", lang)}
        />
      </div>
      {!snap.hasData && (
        <p className="text-[11px] font-medium text-slate-400">{tr("noData", lang)}</p>
      )}
    </section>
  );
}
