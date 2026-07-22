import { useState, useEffect, useCallback } from "react";
import { BarChart3, FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import type { Language, CostStatement } from "../../types";
import { apiFetch } from "../../lib/api";

/**
 * Accounting Phase 7 — read-only Order Financial Summary. Shows, per currency,
 * the customer side (invoiced / received / remaining), the vendor side
 * (approved / paid / remaining), the Official Profit and the Operational Cash
 * Movement for this one Order. Every figure is server-computed; this card never
 * edits anything. Official Profit is invoice − approved cost and is independent
 * of payment timing (stated explicitly on the card).
 */
interface CurFigures {
  customerInvoiced: number; customerReceived: number; customerRemaining: number;
  vendorApproved: number; vendorPaid: number; vendorRemaining: number;
  officialProfit: number | null; profitStatus: string; netCashMovement: number;
}
interface Summary {
  orderRef: string; financialStatus: string; currencies: Record<string, CurFigures>;
}
const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const L = (l: { en: string; tr: string; ar: string }, lang: Language) => l[lang] || l.en;

export default function OrderFinancialSummaryCard({ lang, statement }: { lang: Language; statement: CostStatement }) {
  const [data, setData] = useState<Summary | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [res, permRes] = await Promise.all([
        apiFetch(`/api/accounting/reports/orders/${statement.shipmentId}/financial-summary`),
        apiFetch("/api/accounting/my-permissions"),
      ]);
      if (res.ok) setData(await res.json());
      if (permRes.ok) { const d = await permRes.json(); setCanExport(Array.isArray(d.permissions) && d.permissions.includes("reports.export")); }
    } catch { /* card-isolated */ }
  }, [statement.shipmentId]);
  useEffect(() => { void load(); }, [load]);

  const exportSummary = async (format: "pdf" | "csv") => {
    if (busy) return;
    setBusy(format); setError("");
    try {
      const res = await apiFetch(`/api/accounting/reports/orders/${statement.shipmentId}/financial-summary/export?format=${format}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Export failed."); return; }
      const blob = await res.blob();
      const m = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = m ? m[1] : `order-summary.${format}`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setError("Export failed."); } finally { setBusy(null); }
  };

  if (!data) return null;
  const currencies = Object.keys(data.currencies).sort();
  if (currencies.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[14px] font-black text-slate-900 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-blue-600" /><span>{L({ en: "Order Financial Summary", tr: "Sipariş Mali Özeti", ar: "الملخص المالي للطلب" }, lang)}</span></h3>
        {canExport && (
          <div className="flex items-center gap-1.5">
            <button disabled={!!busy} onClick={() => exportSummary("pdf")} className="px-2.5 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50">{busy === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}PDF</button>
            <button disabled={!!busy} onClick={() => exportSummary("csv")} className="px-2.5 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50">{busy === "csv" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}CSV</button>
          </div>
        )}
      </div>
      {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
      {currencies.map((c) => {
        const f = data.currencies[c];
        return (
          <div key={c} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 space-y-2.5">
            <div className="text-[12px] font-bold text-slate-700">{c}</div>
            <div className="grid grid-cols-3 gap-2.5">
              <Fig label={L({ en: "Invoiced", tr: "Fatura", ar: "المفوتر" }, lang)} value={money(f.customerInvoiced)} unit={c} />
              <Fig label={L({ en: "Received", tr: "Tahsil", ar: "المقبوض" }, lang)} value={money(f.customerReceived)} unit={c} tone="credit" />
              <Fig label={L({ en: "Remaining", tr: "Kalan", ar: "المتبقي" }, lang)} value={money(f.customerRemaining)} unit={c} tone="warn" />
              <Fig label={L({ en: "Approved Cost", tr: "Onaylı Maliyet", ar: "التكلفة المعتمدة" }, lang)} value={money(f.vendorApproved)} unit={c} />
              <Fig label={L({ en: "Paid", tr: "Ödenen", ar: "المدفوع" }, lang)} value={money(f.vendorPaid)} unit={c} />
              <Fig label={L({ en: "Payable", tr: "Borç", ar: "المستحق" }, lang)} value={money(f.vendorRemaining)} unit={c} tone="warn" />
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-slate-200/70">
              <Fig label={L({ en: "Official Profit", tr: "Resmî Kâr", ar: "الربح الرسمي" }, lang)} value={f.officialProfit == null ? "—" : money(f.officialProfit)} unit={f.officialProfit == null ? "" : c} tone={f.officialProfit != null && f.officialProfit >= 0 ? "credit" : "debit"} big />
              <Fig label={L({ en: "Cash Movement", tr: "Nakit Hareketi", ar: "الحركة النقدية" }, lang)} value={money(f.netCashMovement)} unit={c} tone={f.netCashMovement >= 0 ? "credit" : "debit"} big />
            </div>
            {f.officialProfit == null && <p className="text-[10.5px] text-amber-600 font-semibold">{profitNote(f.profitStatus, lang)}</p>}
          </div>
        );
      })}
      <p className="text-[10.5px] text-slate-400 leading-relaxed">{L({ en: "Official Profit is calculated from issued customer invoices minus approved vendor costs. Payment timing does not change Official Profit.", tr: "Resmî Kâr, düzenlenmiş müşteri faturalarından onaylı tedarikçi maliyetleri çıkarılarak hesaplanır. Ödeme zamanlaması Resmî Kârı değiştirmez.", ar: "يُحسب الربح الرسمي من فواتير العملاء الصادرة مطروحاً منها تكاليف الموردين المعتمدة. توقيت الدفع لا يغيّر الربح الرسمي." }, lang)}</p>
    </div>
  );
}

function profitNote(status: string, lang: Language): string {
  const map: Record<string, { en: string; tr: string; ar: string }> = {
    pending_cost_approval: { en: "Profit pending — cost statement not yet approved.", tr: "Kâr beklemede — maliyet onaylanmadı.", ar: "الربح معلّق — لم تُعتمد التكلفة بعد." },
    no_active_invoice: { en: "Profit pending — no active issued invoice.", tr: "Kâr beklemede — aktif fatura yok.", ar: "الربح معلّق — لا فاتورة صادرة نشطة." },
    currency_mismatch: { en: "Profit unavailable — invoice and cost currencies differ (no FX).", tr: "Kâr yok — para birimleri farklı.", ar: "الربح غير متاح — عملات مختلفة." },
    data_unavailable: { en: "Profit unavailable.", tr: "Kâr yok.", ar: "الربح غير متاح." },
  };
  return L(map[status] || map.data_unavailable, lang);
}

function Fig({ label, value, unit, tone, big }: { label: string; value: string; unit: string; tone?: "credit" | "debit" | "warn"; big?: boolean }) {
  const color = tone === "credit" ? "text-emerald-700" : tone === "debit" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.04em] text-slate-400 truncate">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={`${big ? "text-[16px]" : "text-[13px]"} font-bold tabular-nums ${color}`}>{value}</span>
        {unit && <span className="text-[9.5px] font-semibold text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
