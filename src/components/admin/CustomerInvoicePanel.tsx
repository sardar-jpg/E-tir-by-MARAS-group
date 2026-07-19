import { useState, useEffect, useCallback } from "react";
import { FileText, Plus, Send, Ban, Loader2, Printer } from "lucide-react";
import type { Language, BankAccount, CustomerInvoice, InvoicePricingMode, Currency } from "../../types";
import { apiFetch } from "../../lib/api";
import { INVOICE_PRICING_MODES } from "../../lib/customerInvoice";
import { openAccountingPdf } from "../../lib/openAccountingPdf";

/**
 * Customer Invoice panel — inside the Cost Statement detail (Desktop/Admin
 * Web, internal accounting). Create/edit a DRAFT invoice with a pricing
 * mode, issue it (immutable, snapshots the bank), or cancel an issued one.
 * The selling amount + gross profit are always recomputed server-side; this
 * panel only submits inputs. Cost/profit shown here are INTERNAL (this is
 * the admin view — the customer PDF/projection strips them).
 */
const MODE_LABEL: Record<InvoicePricingMode, { en: string; tr: string; ar: string }> = {
  contract: { en: "Contract price", tr: "Sözleşme fiyatı", ar: "سعر العقد" },
  fixed_profit: { en: "Cost + fixed profit", tr: "Maliyet + sabit kâr", ar: "التكلفة + ربح ثابت" },
  percentage_margin: { en: "Cost + margin %", tr: "Maliyet + marj %", ar: "التكلفة + هامش %" },
  per_truck: { en: "Per truck", tr: "Kamyon başına", ar: "لكل شاحنة" },
  per_container: { en: "Per container", tr: "Konteyner başına", ar: "لكل حاوية" },
  per_service: { en: "Per service", tr: "Hizmet başına", ar: "لكل خدمة" },
  manual: { en: "Manual price", tr: "Manuel fiyat", ar: "سعر يدوي" },
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
const STATUS_STYLE: Record<string, string> = { draft: "bg-slate-100 text-slate-600", issued: "bg-emerald-100 text-emerald-700", cancelled: "bg-red-100 text-red-700" };

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
  const [form, setForm] = useState<{ pricingMode: InvoicePricingMode; fixedProfit: string; marginPercent: string; unitPrice: string; unitQuantity: string; manualAmount: string; contractAmount: string; description: string; bankAccountId: string }>({
    pricingMode: "fixed_profit", fixedProfit: "", marginPercent: "", unitPrice: "", unitQuantity: "", manualAmount: "", contractAmount: "", description: "", bankAccountId: "",
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
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricingMode: form.pricingMode, fixedProfit: numOrU(form.fixedProfit), marginPercent: numOrU(form.marginPercent), unitPrice: numOrU(form.unitPrice), unitQuantity: numOrU(form.unitQuantity), manualAmount: numOrU(form.manualAmount), contractAmount: numOrU(form.contractAmount), description: form.description, bankAccountId: form.bankAccountId || undefined }),
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
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE[inv.status]}`}>{inv.status}</span>
            <span className="text-slate-500">{MODE_LABEL[inv.pricingMode]?.[lang] || inv.pricingMode}</span>
            <span className="text-slate-700">{tr("selling", lang)}: <strong>{money(inv.sellingAmount)} {inv.currency}</strong></span>
            {typeof inv.grossProfit === "number" && <span className="text-slate-400">{tr("profit", lang)}: {money(inv.grossProfit)}</span>}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => openAccountingPdf(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/pdf?lang=${lang}`)} className="text-[10px] font-bold text-slate-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Printer className="w-3 h-3" />PDF</button>
              {canWrite && inv.status === "draft" && <button onClick={() => issue(inv)} className="text-[10px] font-bold text-emerald-700 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Send className="w-3 h-3" />{tr("issue", lang)}</button>}
              {canWrite && inv.status === "issued" && <button onClick={() => cancelInvoice(inv)} className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Ban className="w-3 h-3" />{tr("cancelInv", lang)}</button>}
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
            {mode === "contract" && <NumInput label="Contract amount" v={form.contractAmount} onChange={(v) => setForm({ ...form, contractAmount: v })} />}
            {mode === "fixed_profit" && <NumInput label="Fixed profit" v={form.fixedProfit} onChange={(v) => setForm({ ...form, fixedProfit: v })} />}
            {mode === "percentage_margin" && <NumInput label="Margin %" v={form.marginPercent} onChange={(v) => setForm({ ...form, marginPercent: v })} />}
            {(mode === "per_truck" || mode === "per_container" || mode === "per_service") && <>
              <NumInput label="Unit price" v={form.unitPrice} onChange={(v) => setForm({ ...form, unitPrice: v })} />
              <NumInput label="Quantity" v={form.unitQuantity} onChange={(v) => setForm({ ...form, unitQuantity: v })} />
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
