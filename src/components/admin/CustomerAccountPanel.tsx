import { useState, useEffect, useCallback } from "react";
import { Landmark, Plus, RotateCcw, ReceiptText, Loader2, Wallet, Printer } from "lucide-react";
import type { Language, BankAccount, Currency, CustomerInvoice, CustomerPayment } from "../../types";
import { apiFetch } from "../../lib/api";
import type { InvoiceOutstanding, CurrencyAccountSummary } from "../../lib/customerPayments";
import type { CustomerAccountStatement } from "../../lib/customerAccountStatement";
import { openAccountingPdf } from "../../lib/openAccountingPdf";

/**
 * Customer Account (AR) panel — Desktop/Admin Web, internal accounting.
 * For one customer company: account summary (per currency), outstanding
 * invoices, payments (record with auto/manual allocation, reverse, generate
 * receipt), and the customer account statement (currency + date range).
 * All figures are server-authoritative. Never shown to customers/drivers.
 */
const T = {
  title: { en: "Customer Account", tr: "Müşteri Hesabı", ar: "حساب العميل" },
  invoiced: { en: "Invoiced", tr: "Faturalanan", ar: "المفوتر" },
  paid: { en: "Paid", tr: "Ödenen", ar: "المدفوع" },
  outstanding: { en: "Outstanding", tr: "Bekleyen", ar: "المستحق" },
  credit: { en: "Advance credit", tr: "Avans kredi", ar: "رصيد مقدم" },
  outstandingInvoices: { en: "Outstanding invoices", tr: "Bekleyen faturalar", ar: "الفواتير المستحقة" },
  payments: { en: "Payments", tr: "Ödemeler", ar: "المدفوعات" },
  record: { en: "Record payment", tr: "Ödeme kaydet", ar: "تسجيل دفعة" },
  amount: { en: "Amount", tr: "Tutar", ar: "المبلغ" },
  autoAlloc: { en: "Auto-allocate (oldest first)", tr: "Otomatik dağıt (en eski)", ar: "توزيع تلقائي (الأقدم أولاً)" },
  save: { en: "Save", tr: "Kaydet", ar: "حفظ" },
  cancel: { en: "Cancel", tr: "İptal", ar: "إلغاء" },
  reverse: { en: "Reverse", tr: "Geri al", ar: "عكس" },
  receipt: { en: "Receipt", tr: "Makbuz", ar: "إيصال" },
  statement: { en: "Account statement", tr: "Hesap ekstresi", ar: "كشف الحساب" },
  opening: { en: "Opening", tr: "Açılış", ar: "افتتاحي" },
  closing: { en: "Closing", tr: "Kapanış", ar: "ختامي" },
  none: { en: "No activity yet.", tr: "Henüz hareket yok.", ar: "لا توجد حركة بعد." },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;
const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const CURRENCIES: Currency[] = ["USD", "IQD", "TRY", "EUR"];

export default function CustomerAccountPanel({ companyName, bankAccounts, canWrite, lang, onChanged }: {
  companyName: string;
  bankAccounts: BankAccount[];
  canWrite: boolean;
  lang: Language;
  // Fired after a successful payment / reversal / receipt so a host can refresh
  // its derived views. Presentation only — the AR write itself is unchanged.
  onChanged?: () => void;
}) {
  const [summary, setSummary] = useState<CurrencyAccountSummary[]>([]);
  const [outstanding, setOutstanding] = useState<InvoiceOutstanding[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ amount: "", currency: "USD" as Currency, paymentMethod: "wire", reference: "", bankAccountId: "" });
  const [stmtCurrency, setStmtCurrency] = useState<Currency | "">("");
  const [statement, setStatement] = useState<CustomerAccountStatement | null>(null);

  const q = encodeURIComponent(companyName);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, payRes] = await Promise.all([
        apiFetch(`/api/customer-accounts/invoices?company=${q}`),
        apiFetch(`/api/customer-accounts/payments?company=${q}`),
      ]);
      if (invRes.ok) setOutstanding((await invRes.json()).outstanding || []);
      if (payRes.ok) { const b = await payRes.json(); setPayments(b.payments || []); setSummary(b.summary || []); }
    } catch { /* panel-isolated */ } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  const loadStatement = useCallback(async (cur: Currency) => {
    try { const res = await apiFetch(`/api/customer-accounts/statement?company=${q}&currency=${cur}`); if (res.ok) setStatement((await res.json()).statement); }
    catch { /* panel-isolated */ }
  }, [q]);
  useEffect(() => { if (stmtCurrency) void loadStatement(stmtCurrency); }, [stmtCurrency, loadStatement]);
  useEffect(() => { if (!stmtCurrency && summary[0]) setStmtCurrency(summary[0].currency); }, [summary, stmtCurrency]);

  const recordPayment = async () => {
    setErr(null);
    try {
      const res = await apiFetch(`/api/customer-accounts/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: companyName, amount: Number(draft.amount), currency: draft.currency, paymentMethod: draft.paymentMethod, reference: draft.reference || undefined, bankAccountId: draft.bankAccountId || undefined, allocationMode: "auto" }),
      });
      if (res.ok) { setRecording(false); setDraft({ amount: "", currency: "USD", paymentMethod: "wire", reference: "", bankAccountId: "" }); await load(); if (stmtCurrency) await loadStatement(stmtCurrency); onChanged?.(); }
      else { const b = await res.json().catch(() => ({})); setErr(b.error || "Save failed."); }
    } catch { setErr("Save failed."); }
  };
  const reverse = async (p: CustomerPayment) => {
    const reason = window.prompt(tr("reverse", lang) + ":");
    if (!reason || !reason.trim()) return;
    try { const res = await apiFetch(`/api/customer-accounts/payments/${p.id}/reverse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); if (res.ok) { await load(); if (stmtCurrency) await loadStatement(stmtCurrency); onChanged?.(); } }
    catch { /* panel-isolated */ }
  };
  const genReceipt = async (p: CustomerPayment) => {
    try { const res = await apiFetch(`/api/customer-accounts/payments/${p.id}/receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) { const b = await res.json(); window.alert(`${tr("receipt", lang)}: ${b.receipt.receiptNumber}`); onChanged?.(); } }
    catch { /* panel-isolated */ }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4 mt-3">
      <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><Landmark className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)} — {companyName}</span></h3>
      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />…</div>}

      {/* Per-currency summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {summary.map((s) => (
          <div key={s.currency} className="rounded-lg border border-slate-200 p-2.5 text-xs">
            <div className="font-black text-slate-800 mb-1">{s.currency}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
              <span>{tr("invoiced", lang)}: <strong className="text-slate-800">{money(s.invoicedTotal)}</strong></span>
              <span>{tr("paid", lang)}: <strong className="text-slate-800">{money(s.paidTotal)}</strong></span>
              <span>{tr("outstanding", lang)}: <strong className="text-slate-800">{money(s.outstandingTotal)}</strong></span>
              <span>{tr("credit", lang)}: <strong className="text-emerald-700">{money(s.unallocatedCredit)}</strong></span>
            </div>
          </div>
        ))}
        {!loading && summary.length === 0 && <p className="text-[11px] text-slate-400 italic">{tr("none", lang)}</p>}
      </div>

      {/* Outstanding invoices */}
      {outstanding.some((o) => o.outstanding > 0) && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">{tr("outstandingInvoices", lang)}</p>
          <div className="space-y-1">
            {outstanding.filter((o) => o.outstanding > 0).map((o) => (
              <div key={o.invoiceId} className="flex items-center gap-3 text-[11px] text-slate-600">
                <span className="font-mono font-bold text-slate-800">{o.invoiceNumber}</span>
                <span>{money(o.amount)} {o.currency}</span>
                <span className="text-slate-400">paid {money(o.paid)}</span>
                <span className="ml-auto font-bold text-amber-700">{money(o.outstanding)} {o.currency}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payments */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 flex items-center gap-1"><Wallet className="w-3 h-3" />{tr("payments", lang)}</p>
          {canWrite && !recording && <button onClick={() => { setRecording(true); setErr(null); }} className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold rounded-md cursor-pointer border-0 flex items-center gap-1"><Plus className="w-3 h-3" />{tr("record", lang)}</button>}
        </div>
        <div className="space-y-1">
          {payments.map((p) => (
            <div key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] rounded px-2 py-1 ${p.status === "reversed" ? "bg-slate-50 text-slate-400 line-through" : "bg-slate-50 text-slate-600"}`}>
              <span className="font-mono font-bold">{money(p.amount)} {p.currency}</span>
              <span>{p.paymentDate}</span>
              {p.reference && <span>· {p.reference}</span>}
              <span className="text-slate-400">· {(p.allocations || []).length} alloc</span>
              {p.status === "active" && canWrite && (
                <span className="ml-auto flex items-center gap-2">
                  <button onClick={() => genReceipt(p)} className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><ReceiptText className="w-3 h-3" />{tr("receipt", lang)}</button>
                  <button onClick={() => reverse(p)} className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><RotateCcw className="w-3 h-3" />{tr("reverse", lang)}</button>
                </span>
              )}
            </div>
          ))}
        </div>
        {recording && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input type="number" step="0.01" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder={tr("amount", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
              <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value as Currency })} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer">{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <input value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })} placeholder="method" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
              <input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="reference" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            </div>
            <p className="text-[10px] text-slate-400">{tr("autoAlloc", lang)}</p>
            {err && <p className="text-[11px] font-bold text-red-600">{err}</p>}
            <div className="flex items-center gap-2">
              <button onClick={recordPayment} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">{tr("save", lang)}</button>
              <button onClick={() => { setRecording(false); setErr(null); }} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer">{tr("cancel", lang)}</button>
            </div>
          </div>
        )}
      </div>

      {/* Account statement */}
      {summary.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{tr("statement", lang)}</p>
            <select value={stmtCurrency} onChange={(e) => setStmtCurrency(e.target.value as Currency)} className="text-[11px] border border-slate-200 rounded-md px-1.5 py-0.5 bg-white cursor-pointer">
              {summary.map((s) => <option key={s.currency} value={s.currency}>{s.currency}</option>)}
            </select>
            {stmtCurrency && (
              <button onClick={() => openAccountingPdf(`/api/customer-accounts/statement/pdf?company=${q}&currency=${stmtCurrency}&lang=${lang}`)} className="text-[10px] font-bold text-slate-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Printer className="w-3 h-3" />PDF</button>
            )}
          </div>
          {statement && (
            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="bg-slate-50 text-slate-400 text-[10px] uppercase"><th className="text-left px-2 py-1">Date</th><th className="text-left px-2 py-1">Ref</th><th className="text-right px-2 py-1">Debit</th><th className="text-right px-2 py-1">Credit</th><th className="text-right px-2 py-1">Balance</th></tr></thead>
                <tbody>
                  <tr className="text-slate-500"><td className="px-2 py-1" colSpan={4}>{tr("opening", lang)}</td><td className="px-2 py-1 text-right font-bold">{money(statement.openingBalance)}</td></tr>
                  {statement.rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100"><td className="px-2 py-1">{r.date}</td><td className="px-2 py-1 font-mono">{r.ref}</td><td className="px-2 py-1 text-right">{r.debit ? money(r.debit) : ""}</td><td className="px-2 py-1 text-right">{r.credit ? money(r.credit) : ""}</td><td className="px-2 py-1 text-right font-bold">{money(r.balance)}</td></tr>
                  ))}
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-black text-slate-800"><td className="px-2 py-1" colSpan={4}>{tr("closing", lang)} ({statement.currency})</td><td className="px-2 py-1 text-right">{money(statement.closingBalance)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
