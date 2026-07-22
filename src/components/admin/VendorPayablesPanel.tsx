import { useState, useEffect, useCallback, useMemo } from "react";
import { Wallet, Plus, RotateCcw, Paperclip, Loader2, Printer } from "lucide-react";
import type { Language, CostItem, BankAccount, VendorPaymentTransaction } from "../../types";
import { apiFetch } from "../../lib/api";
import { summarizeVendorPayable, matchesPayableFilter, type VendorPayableSummary } from "../../lib/vendorPayments";
import { openAccountingPdf } from "../../lib/openAccountingPdf";

/**
 * Vendor Payables panel — lives inside the existing Cost Statement detail
 * (Desktop/Admin Web, internal accounting only). Shows each cost line's
 * vendor cost / paid / remaining / status, its payment history, and lets an
 * accounting writer record partial payments or reverse one (with a reason).
 * All figures are server-authoritative; this panel re-fetches after each
 * mutation. Never rendered for customers/drivers/public.
 */
const T = {
  title: { en: "Vendor Payables", tr: "Tedarikçi Ödemeleri", ar: "مستحقات الموردين" },
  cost: { en: "Cost", tr: "Maliyet", ar: "التكلفة" },
  paid: { en: "Paid", tr: "Ödenen", ar: "المدفوع" },
  remaining: { en: "Remaining", tr: "Kalan", ar: "المتبقي" },
  addPayment: { en: "Pay Vendor", tr: "Tedarikçiye Öde", ar: "دفع للمورد" },
  amount: { en: "Amount", tr: "Tutar", ar: "المبلغ" },
  date: { en: "Date", tr: "Tarih", ar: "التاريخ" },
  method: { en: "Method", tr: "Yöntem", ar: "الطريقة" },
  reference: { en: "Reference", tr: "Referans", ar: "المرجع" },
  bank: { en: "Paying account", tr: "Ödeyen hesap", ar: "حساب الدفع" },
  proof: { en: "Proof URL", tr: "Kanıt URL", ar: "رابط الإثبات" },
  save: { en: "Save payment", tr: "Ödemeyi kaydet", ar: "حفظ الدفعة" },
  cancel: { en: "Cancel", tr: "İptal", ar: "إلغاء" },
  history: { en: "Payment history", tr: "Ödeme geçmişi", ar: "سجل الدفعات" },
  none: { en: "No payments yet.", tr: "Henüz ödeme yok.", ar: "لا توجد دفعات بعد." },
  reverse: { en: "Reverse", tr: "Geri al", ar: "عكس" },
  reversed: { en: "Reversed", tr: "Geri alındı", ar: "معكوس" },
  reverseReason: { en: "Reason for reversal:", tr: "Geri alma nedeni:", ar: "سبب العكس:" },
  viewProof: { en: "Proof", tr: "Kanıt", ar: "إثبات" },
  note: { en: "Note (optional)", tr: "Not (isteğe bağlı)", ar: "ملاحظة (اختياري)" },
  notApproved: {
    en: "Vendor payments can be recorded only after the Cost Statement is approved and closed.",
    tr: "Tedarikçi ödemeleri yalnızca Maliyet Tablosu onaylanıp kapatıldıktan sonra kaydedilebilir.",
    ar: "لا يمكن تسجيل مدفوعات الموردين إلا بعد اعتماد كشف التكلفة وإغلاقه.",
  },
  filterAll: { en: "All", tr: "Tümü", ar: "الكل" },
  filterUnpaid: { en: "Unpaid", tr: "Ödenmemiş", ar: "غير مدفوع" },
  filterPartial: { en: "Partial", tr: "Kısmi", ar: "جزئي" },
  filterPaid: { en: "Paid", tr: "Ödenmiş", ar: "مدفوع" },
  filterOverdue: { en: "Overdue", tr: "Gecikmiş", ar: "متأخر" },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;
const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const STATUS_STYLE: Record<string, string> = {
  Unpaid: "bg-slate-100 text-slate-600",
  "Partially Paid": "bg-amber-100 text-amber-700",
  Paid: "bg-emerald-100 text-emerald-700",
  Overpaid: "bg-red-100 text-red-700",
};

type Filter = "all" | "unpaid" | "partial" | "paid" | "overdue";

export default function VendorPayablesPanel({ shipmentId, items, bankAccounts, canWrite, lang, recordingEnabled = true }: {
  shipmentId: string;
  items: CostItem[];
  bankAccounts: BankAccount[];
  canWrite: boolean;
  lang: Language;
  /**
   * Accounting Phase 4: recording is possible only while the Cost Statement is
   * approved and closed (final_closed). When false, the Pay Vendor action is
   * hidden and the clear reason is shown instead. History stays visible.
   * The server enforces the same rule independently.
   */
  recordingEnabled?: boolean;
}) {
  const [payments, setPayments] = useState<VendorPaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState({ amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "wire", reference: "", bankAccountId: "", attachmentUrl: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/vendor-payments`);
      if (res.ok) setPayments((await res.json()).payments || []);
    } catch { /* panel-isolated */ } finally { setLoading(false); }
  }, [shipmentId]);
  useEffect(() => { void load(); }, [load]);

  const nowIso = new Date().toISOString();
  const summaries = useMemo(() => new Map<string, VendorPayableSummary>(items.map((it) => [it.id, summarizeVendorPayable(it, payments)])), [items, payments]);
  const visibleItems = items.filter((it) => matchesPayableFilter(summaries.get(it.id)!, filter, it.dueDate, nowIso));

  const submit = async (item: CostItem) => {
    setErr(null); setBusy(true);
    try {
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/vendor-payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costItemId: item.id, amount: Number(draft.amount), currency: item.currency, paymentDate: draft.paymentDate, paymentMethod: draft.paymentMethod, reference: draft.reference || undefined, bankAccountId: draft.bankAccountId || undefined, attachmentUrl: draft.attachmentUrl || undefined, internalNotes: draft.note || undefined }),
      });
      if (res.ok) { setAddingFor(null); setDraft({ amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "wire", reference: "", bankAccountId: "", attachmentUrl: "", note: "" }); await load(); }
      else { const b = await res.json().catch(() => ({})); setErr(b.error || "Save failed."); }
    } catch { setErr("Save failed."); } finally { setBusy(false); }
  };
  const reverse = async (p: VendorPaymentTransaction) => {
    const reason = window.prompt(tr("reverseReason", lang));
    if (!reason || !reason.trim()) return;
    try {
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/vendor-payments/${p.id}/reverse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      if (res.ok) await load();
    } catch { /* panel-isolated */ }
  };

  const banksFor = (cur: string) => bankAccounts.filter((b) => b.active && b.currency === cur);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><Wallet className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "unpaid", "partial", "paid", "overdue"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer border ${filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}>
              {tr(("filter" + f.charAt(0).toUpperCase() + f.slice(1)) as keyof typeof T, lang)}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />…</div>}
      {!loading && visibleItems.length === 0 && <p className="text-[11px] text-slate-400 italic">{tr("none", lang)}</p>}
      {/* Phase 4: the clear reason recording is unavailable (history stays visible). */}
      {!recordingEnabled && canWrite && (
        <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{tr("notApproved", lang)}</p>
      )}

      <div className="space-y-2">
        {visibleItems.map((item) => {
          const s = summaries.get(item.id)!;
          const itemPayments = payments.filter((p) => p.costItemId === item.id);
          return (
            <div key={item.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-black text-slate-800 text-xs">{item.supplierName || item.costType || item.description || "—"}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE[s.status] || "bg-slate-100 text-slate-600"}`}>{s.status}</span>
                <span className="text-[11px] text-slate-500">{tr("cost", lang)}: <strong>{money(s.costAmount)} {item.currency}</strong></span>
                <span className="text-[11px] text-slate-500">{tr("paid", lang)}: <strong>{money(s.totalPaid)}</strong></span>
                <span className="text-[11px] text-slate-500">{tr("remaining", lang)}: <strong>{money(s.remaining)}</strong></span>
                {canWrite && recordingEnabled && s.remaining > 0 && addingFor !== item.id && (
                  <button onClick={() => { setAddingFor(item.id); setErr(null); }} className="ml-auto px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold rounded-md cursor-pointer border-0 flex items-center gap-1"><Plus className="w-3 h-3" />{tr("addPayment", lang)}</button>
                )}
              </div>

              {itemPayments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {itemPayments.map((p) => (
                    <div key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] rounded px-2 py-1 ${p.status === "reversed" ? "bg-slate-50 text-slate-400 line-through" : "bg-slate-50 text-slate-600"}`}>
                      <span className="font-mono font-bold">{money(p.amount)} {p.currency}</span>
                      <span>{p.paymentDate}</span>
                      {p.paymentMethod && <span>· {p.paymentMethod}</span>}
                      {p.reference && <span>· {p.reference}</span>}
                      {p.bankAccountSnapshot && <span>· {p.bankAccountSnapshot}</span>}
                      {p.internalNotes && <span className="italic">· {p.internalNotes}</span>}
                      {p.attachmentUrl && <a href={p.attachmentUrl} target="_blank" rel="noreferrer" className="text-orange-600 no-underline flex items-center gap-0.5"><Paperclip className="w-3 h-3" />{tr("viewProof", lang)}</a>}
                      <span className="ml-auto flex items-center gap-2">
                        <button onClick={() => openAccountingPdf(`/api/cost-statements/${shipmentId}/vendor-payments/${p.id}/voucher?lang=${lang}`)} className="text-[10px] font-bold text-slate-500 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Printer className="w-3 h-3" />Voucher</button>
                        {p.status === "reversed" ? (
                          <span className="text-[10px] font-bold">{tr("reversed", lang)}{p.reversalReason ? ` — ${p.reversalReason}` : ""}</span>
                        ) : canWrite ? (
                          <button onClick={() => reverse(p)} className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><RotateCcw className="w-3 h-3" />{tr("reverse", lang)}</button>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {addingFor === item.id && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 space-y-2">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <input type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder={`${tr("amount", lang)} (${item.currency})`} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                    <input type="date" value={draft.paymentDate} onChange={(e) => setDraft({ ...draft, paymentDate: e.target.value })} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                    <input value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })} placeholder={tr("method", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                    <input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder={tr("reference", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                    <select value={draft.bankAccountId} onChange={(e) => setDraft({ ...draft, bankAccountId: e.target.value })} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer">
                      <option value="">{tr("bank", lang)}…</option>
                      {banksFor(item.currency).map((b) => <option key={b.id} value={b.id}>{b.bankName} ({b.currency})</option>)}
                    </select>
                    <input value={draft.attachmentUrl} onChange={(e) => setDraft({ ...draft, attachmentUrl: e.target.value })} placeholder={tr("proof", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                    <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder={tr("note", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white col-span-2 md:col-span-3" />
                  </div>
                  {err && <p className="text-[11px] font-bold text-red-600">{err}</p>}
                  <div className="flex items-center gap-2">
                    <button onClick={() => submit(item)} disabled={busy} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">{tr("save", lang)}</button>
                    <button onClick={() => { setAddingFor(null); setErr(null); }} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer">{tr("cancel", lang)}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
