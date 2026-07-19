import { useState, useEffect, useCallback } from "react";
import { FileText, Plus, Send, Ban, Loader2, Printer } from "lucide-react";
import type { Language, BankAccount, CustomerInvoice, CustomerInvoiceStatus, InvoicePricingMode, InvoiceMarkupType, Currency } from "../../types";
import { apiFetch } from "../../lib/api";
import { INVOICE_PRICING_MODES } from "../../lib/customerInvoice";
import { openAccountingPdf } from "../../lib/openAccountingPdf";

/**
 * Customer Invoice panel — inside the Cost Statement detail (Desktop/Admin
 * Web, internal accounting). Create/edit a DRAFT invoice (manual price or
 * cost-plus markup), issue it (immutable, snapshots the bank), or cancel an
 * issued one. The selling amount + markup + gross profit are always recomputed
 * server-side; this panel only submits inputs. partially_paid / paid are
 * server-derived and shown read-only. Cost/profit shown here are INTERNAL
 * (admin view — the customer PDF/projection strips them).
 */
const MODE_LABEL: Record<InvoicePricingMode, { en: string; tr: string; ar: string }> = {
  manual: { en: "Manual price", tr: "Manuel fiyat", ar: "سعر يدوي" },
  cost_plus: { en: "Cost + markup", tr: "Maliyet + kâr payı", ar: "التكلفة + هامش" },
};
const MARKUP_LABEL: Record<InvoiceMarkupType, { en: string; tr: string; ar: string }> = {
  percentage: { en: "Percentage %", tr: "Yüzde %", ar: "نسبة مئوية %" },
  fixed: { en: "Fixed amount", tr: "Sabit tutar", ar: "مبلغ ثابت" },
};
const STATUS_LABEL: Record<CustomerInvoiceStatus, { en: string; tr: string; ar: string }> = {
  draft: { en: "Draft", tr: "Taslak", ar: "مسودة" },
  issued: { en: "Issued", tr: "Düzenlendi", ar: "صادرة" },
  partially_paid: { en: "Partially paid", tr: "Kısmen ödendi", ar: "مدفوعة جزئياً" },
  paid: { en: "Paid", tr: "Ödendi", ar: "مدفوعة" },
  cancelled: { en: "Cancelled", tr: "İptal edildi", ar: "ملغاة" },
};
const T = {
  title: { en: "Customer Invoices", tr: "Müşteri Faturaları", ar: "فواتير العملاء" },
  intro: { en: "Selling price + profit are computed server-side; cost and profit stay internal (never on the customer document).", tr: "Satış fiyatı + kâr sunucuda hesaplanır; maliyet ve kâr dahilidir (müşteri belgesinde asla yer almaz).", ar: "يُحتسب سعر البيع والربح على الخادم؛ تبقى التكلفة والربح داخلية (لا تظهر في مستند العميل)." },
  create: { en: "New invoice", tr: "Yeni fatura", ar: "فاتورة جديدة" },
  none: { en: "No invoices yet.", tr: "Henüz fatura yok.", ar: "لا توجد فواتير بعد." },
  mode: { en: "Pricing", tr: "Fiyatlandırma", ar: "التسعير" },
  selling: { en: "Selling", tr: "Satış", ar: "البيع" },
  profit: { en: "Profit (internal)", tr: "Kâr (dahili)", ar: "الربح (داخلي)" },
  save: { en: "Save draft", tr: "Taslağı kaydet", ar: "حفظ المسودة" },
  cancel: { en: "Cancel", tr: "İptal", ar: "إلغاء" },
  issue: { en: "Issue", tr: "Düzenle", ar: "إصدار" },
  cancelInv: { en: "Cancel invoice", tr: "Faturayı iptal et", ar: "إلغاء الفاتورة" },
  bank: { en: "Bank account", tr: "Banka hesabı", ar: "الحساب المصرفي" },
  desc: { en: "Description (customer)", tr: "Açıklama (müşteri)", ar: "الوصف (العميل)" },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;
const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const STATUS_STYLE: Record<CustomerInvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  issued: "bg-emerald-100 text-emerald-700",
  partially_paid: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function CustomerInvoicePanel({ shipmentId, currency, bankAccounts, canWrite, lang }: {
  shipmentId: string;
  currency: Currency;
  bankAccounts: BankAccount[];
  canWrite: boolean;
  lang: Language;
}) {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ pricingMode: InvoicePricingMode; markupType: InvoiceMarkupType; markupValue: string; manualAmount: string; description: string; bankAccountId: string }>({
    pricingMode: "manual", markupType: "percentage", markupValue: "", manualAmount: "", description: "", bankAccountId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices`); if (res.ok) setInvoices((await res.json()).invoices || []); }
    catch { /* panel-isolated */ } finally { setLoading(false); }
  }, [shipmentId]);
  useEffect(() => { void load(); }, [load]);

  const numOrU = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const createDraft = async () => {
    setErr(null); setBusy(true);
    try {
      const payload = form.pricingMode === "cost_plus"
        ? { pricingMode: "cost_plus", markupType: form.markupType, markupValue: numOrU(form.markupValue), description: form.description, bankAccountId: form.bankAccountId || undefined }
        : { pricingMode: "manual", manualAmount: numOrU(form.manualAmount), description: form.description, bankAccountId: form.bankAccountId || undefined };
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) { setCreating(false); await load(); }
      else { const b = await res.json().catch(() => ({})); setErr(b.error || "Save failed."); }
    } catch { setErr("Save failed."); } finally { setBusy(false); }
  };
  const issue = async (inv: CustomerInvoice) => {
    const bankId = inv.bankAccountId || (bankAccounts.find((b) => b.active && b.currency === inv.currency && b.isDefaultForCurrency)?.id) || "";
    try { const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankAccountId: bankId || undefined }) });
      if (res.ok) await load(); else { const b = await res.json().catch(() => ({})); window.alert(b.error || "Issue failed."); } }
    catch { /* panel-isolated */ }
  };
  const cancelInvoice = async (inv: CustomerInvoice) => {
    const reason = window.prompt(tr("cancelInv", lang) + ":");
    if (!reason || !reason.trim()) return;
    try { const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); if (res.ok) await load(); }
    catch { /* panel-isolated */ }
  };

  const mode = form.pricingMode;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><FileText className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{tr("intro", lang)}</p>
        </div>
        {canWrite && !creating && <button onClick={() => { setCreating(true); setErr(null); }} className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />{tr("create", lang)}</button>}
      </div>

      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />…</div>}
      {!loading && invoices.length === 0 && !creating && <p className="text-[11px] text-slate-400 italic">{tr("none", lang)}</p>}

      <div className="space-y-1.5">
        {invoices.map((inv) => (
          <div key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-xs">
            <span className="font-black text-slate-800 font-mono">{inv.invoiceNumber}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE[inv.status]}`}>{STATUS_LABEL[inv.status]?.[lang] || inv.status}</span>
            <span className="text-slate-500">{MODE_LABEL[inv.pricingMode]?.[lang] || inv.pricingMode}</span>
            <span className="text-slate-700">{tr("selling", lang)}: <strong>{money(inv.sellingAmount)} {inv.currency}</strong></span>
            {typeof inv.grossProfit === "number" && <span className="text-slate-400">{tr("profit", lang)}: {money(inv.grossProfit)}</span>}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => openAccountingPdf(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/pdf?lang=${lang}`)} className="text-[10px] font-bold text-slate-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Printer className="w-3 h-3" />PDF</button>
              {canWrite && inv.status === "draft" && <button onClick={() => issue(inv)} className="text-[10px] font-bold text-emerald-700 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Send className="w-3 h-3" />{tr("issue", lang)}</button>}
              {canWrite && (inv.status === "issued" || inv.status === "partially_paid" || inv.status === "paid") && <button onClick={() => cancelInvoice(inv)} className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Ban className="w-3 h-3" />{tr("cancelInv", lang)}</button>}
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-0.5">{tr("mode", lang)}</label>
              <select value={form.pricingMode} onChange={(e) => setForm({ ...form, pricingMode: e.target.value as InvoicePricingMode })} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer">
                {INVOICE_PRICING_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m][lang] || MODE_LABEL[m].en}</option>)}
              </select>
            </div>
            {mode === "cost_plus" && <>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-0.5">{MARKUP_LABEL[form.markupType][lang] || MARKUP_LABEL[form.markupType].en}</label>
                <select value={form.markupType} onChange={(e) => setForm({ ...form, markupType: e.target.value as InvoiceMarkupType })} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer">
                  {(["percentage", "fixed"] as InvoiceMarkupType[]).map((t) => <option key={t} value={t}>{MARKUP_LABEL[t][lang] || MARKUP_LABEL[t].en}</option>)}
                </select>
              </div>
              <NumInput label={form.markupType === "percentage" ? "%" : currency} v={form.markupValue} onChange={(v) => setForm({ ...form, markupValue: v })} />
            </>}
            {mode === "manual" && <NumInput label={`Selling price (${currency})`} v={form.manualAmount} onChange={(v) => setForm({ ...form, manualAmount: v })} />}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-0.5">{tr("desc", lang)}</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-0.5">{tr("bank", lang)}</label>
              <select value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer">
                <option value="">—</option>
                {bankAccounts.filter((b) => b.active && b.currency === currency).map((b) => <option key={b.id} value={b.id}>{b.bankName} ({b.currency})</option>)}
              </select>
            </div>
          </div>
          {err && <p className="text-[11px] font-bold text-red-600">{err}</p>}
          <div className="flex items-center gap-2">
            <button onClick={createDraft} disabled={busy} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">{tr("save", lang)}</button>
            <button onClick={() => { setCreating(false); setErr(null); }} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer">{tr("cancel", lang)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NumInput({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-0.5">{label}</label>
      <input type="number" step="0.01" value={v} onChange={(e) => onChange(e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
    </div>
  );
}
