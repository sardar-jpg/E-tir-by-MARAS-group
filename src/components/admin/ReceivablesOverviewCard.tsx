import { useState, useEffect } from "react";
import { Receipt, AlertCircle } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import type { ArOverview } from "../../lib/accountsReceivableOverview";

/**
 * Accounts-Receivable overview card (Admin Dashboard). Per-currency
 * invoiced / collected / outstanding / advance-credit from the REAL
 * customer invoices + payments, plus work queues (drafts to issue,
 * payments to allocate). Accounting-only; card-isolated failures.
 */
const L: Record<string, { en: string; tr: string; ar: string }> = {
  title: { en: "Receivables", tr: "Alacaklar", ar: "الذمم المدينة" },
  note: { en: "From issued invoices + customer payments (per currency).", tr: "Düzenlenen faturalar + müşteri ödemelerinden (para birimi bazında).", ar: "من الفواتير الصادرة ومدفوعات العملاء (حسب العملة)." },
  invoiced: { en: "Invoiced", tr: "Faturalanan", ar: "المفوتر" },
  collected: { en: "Collected", tr: "Tahsil edilen", ar: "المحصل" },
  outstanding: { en: "Outstanding", tr: "Bekleyen", ar: "المستحق" },
  credit: { en: "Advance credit", tr: "Avans kredi", ar: "رصيد مقدم" },
  drafts: { en: "Drafts to issue", tr: "Düzenlenecek taslaklar", ar: "مسودات للإصدار" },
  toAllocate: { en: "Payments to allocate", tr: "Dağıtılacak ödemeler", ar: "مدفوعات للتوزيع" },
  none: { en: "No receivables activity yet.", tr: "Henüz alacak hareketi yok.", ar: "لا توجد حركة ذمم بعد." },
  err: { en: "Receivables could not be loaded.", tr: "Alacaklar yüklenemedi.", ar: "تعذّر تحميل الذمم." },
};
const t = (k: string, lang: Language) => (L[k] ? L[k][lang] || L[k].en : k);
const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function ReceivablesOverviewCard({ lang }: { lang: Language }) {
  const [data, setData] = useState<ArOverview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/dashboard/receivables");
        if (!res.ok) { if (alive) setError(true); return; }
        const body = await res.json();
        if (alive) setData(body.receivables);
      } catch { if (alive) setError(true); }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400"><AlertCircle className="w-4 h-4" />{t("err", lang)}</div>
    </div>
  );
  if (!data) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
      <div>
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><Receipt className="w-4 h-4 text-orange-600" /><span>{t("title", lang)}</span></h3>
        <p className="text-[11px] text-slate-500 mt-0.5">{t("note", lang)}</p>
      </div>
      {data.currencies.length === 0 && <p className="text-[11px] text-slate-400 italic">{t("none", lang)}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {data.currencies.map((c) => (
          <div key={c.currency} className="rounded-lg border border-slate-200 p-2.5">
            <div className="text-xs font-black text-slate-800 mb-1">{c.currency}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span>{t("invoiced", lang)}: <strong className="text-slate-800">{money(c.totalInvoiced)}</strong></span>
              <span>{t("collected", lang)}: <strong className="text-slate-800">{money(c.totalCollected)}</strong></span>
              <span>{t("outstanding", lang)}: <strong className="text-amber-700">{money(c.totalOutstanding)}</strong></span>
              <span>{t("credit", lang)}: <strong className="text-emerald-700">{money(c.advanceCredit)}</strong></span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold">{t("drafts", lang)}: {data.draftInvoiceCount}</span>
        <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold">{t("toAllocate", lang)}: {data.paymentsAwaitingAllocationCount}</span>
      </div>
    </div>
  );
}
