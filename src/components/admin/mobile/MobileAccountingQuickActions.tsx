import { useState, useEffect, useCallback } from "react";
import { Wallet, Plus, Send, Check, X, Loader2, Landmark } from "lucide-react";
import type { Language, CostStatement, CostItem } from "../../../types";
import { apiFetch } from "../../../lib/api";
import { resolveAccountingStatus, pendingStageForStatus } from "../../../lib/costApprovalWorkflow";
import { summarizeVendorPayable } from "../../../lib/vendorPayments";

/**
 * Mobile-only lightweight accounting quick actions (Phase 12). NOT the full
 * accounting system — a compact assistant for fast field actions, reusing
 * the SAME backend records/APIs + permission rules as Desktop. No bank/
 * template management, no advanced reports, no complex allocation, no
 * historical corrections, no full tables. Desktop remains the source of
 * truth; anything done here appears immediately on Desktop.
 */
const T = {
  title: { en: "Accounting — Quick Actions", tr: "Muhasebe — Hızlı İşlemler", ar: "المحاسبة — إجراءات سريعة" },
  cost: { en: "Cost", tr: "Maliyet", ar: "التكلفة" },
  paid: { en: "Paid", tr: "Ödenen", ar: "المدفوع" },
  outstanding: { en: "Vendor outstanding", tr: "Tedarikçi bakiye", ar: "مستحقات الموردين" },
  status: { en: "Status", tr: "Durum", ar: "الحالة" },
  quickExpense: { en: "Quick expense", tr: "Hızlı gider", ar: "مصروف سريع" },
  vendorPay: { en: "Urgent vendor payment", tr: "Acil tedarikçi ödemesi", ar: "دفعة مورد عاجلة" },
  submit: { en: "Submit for approval", tr: "Onaya gönder", ar: "إرسال للاعتماد" },
  approve: { en: "Approve", tr: "Onayla", ar: "اعتماد" },
  reject: { en: "Reject", tr: "Reddet", ar: "رفض" },
  desc: { en: "Description", tr: "Açıklama", ar: "الوصف" },
  supplier: { en: "Supplier", tr: "Tedarikçi", ar: "المورد" },
  amount: { en: "Amount", tr: "Tutar", ar: "المبلغ" },
  proof: { en: "Proof URL", tr: "Kanıt URL", ar: "رابط الإثبات" },
  save: { en: "Save", tr: "Kaydet", ar: "حفظ" },
  cancel: { en: "Cancel", tr: "İptal", ar: "إلغاء" },
  line: { en: "Cost line", tr: "Maliyet satırı", ar: "بند التكلفة" },
  noStmt: { en: "No cost statement yet.", tr: "Henüz maliyet tablosu yok.", ar: "لا يوجد كشف تكلفة بعد." },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;
const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function MobileAccountingQuickActions({ shipmentId, canWrite, sessionId, lang }: {
  shipmentId: string; canWrite: boolean; sessionId: string; lang: Language;
}) {
  const [stmt, setStmt] = useState<CostStatement | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<null | "expense" | "vendor">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exp, setExp] = useState({ description: "", supplierName: "", amount: "" });
  const [vp, setVp] = useState({ costItemId: "", amount: "", proof: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await apiFetch(`/api/cost-statements/${shipmentId}`);
      if (sRes.ok) setStmt(await sRes.json()); else setStmt(null);
      const pRes = await apiFetch(`/api/cost-statements/${shipmentId}/vendor-payments`);
      if (pRes.ok) setPayments((await pRes.json()).payments || []);
    } catch { /* card-isolated */ } finally { setLoading(false); }
  }, [shipmentId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="lg:hidden flex items-center gap-2 text-xs text-slate-400 p-3"><Loader2 className="w-4 h-4 animate-spin" />…</div>;
  if (!stmt) return <div className="lg:hidden text-[11px] text-slate-400 italic p-3">{tr("noStmt", lang)}</div>;

  const items = (stmt.items as CostItem[]) || [];
  const status = resolveAccountingStatus(stmt as any);
  const vendorOutstanding = items.reduce((s, it) => s + Math.max(0, summarizeVendorPayable(it, payments as any).remaining), 0);
  const isPendingMine = !!pendingStageForStatus(status); // approve/reject offered; server enforces assigned-approver
  const editable = status === "draft" || status === "rejected_for_correction" || status === "reopened";

  const post = async (path: string, body?: any) => {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "{}" });
      if (res.ok) { setSheet(null); await load(); return true; }
      const b = await res.json().catch(() => ({})); setErr(b.error || "Action failed."); return false;
    } catch { setErr("Action failed."); return false; } finally { setBusy(false); }
  };

  const addExpense = async () => {
    const amt = Number(exp.amount);
    if (!(amt > 0)) { setErr("Enter a valid amount."); return; }
    // Reuse the cost-statement write route: append one line to the current items.
    const newItem = { costType: "expense", description: exp.description || "Expense", quantity: 1, unitPrice: amt, currency: stmt.currency, supplierName: exp.supplierName || "" };
    const items2 = [...items.map((i) => ({ ...i })), newItem];
    const ok = await post(`/api/cost-statements/${shipmentId}`, { currency: stmt.currency, paidAmount: stmt.paidAmount || 0, customerReceivedAmount: stmt.customerReceivedAmount || 0, notes: stmt.notes || "", revision: stmt.revision || 1, items: items2 });
    if (ok) setExp({ description: "", supplierName: "", amount: "" });
  };
  const addVendorPayment = async () => {
    const amt = Number(vp.amount);
    if (!vp.costItemId || !(amt > 0)) { setErr("Pick a cost line and amount."); return; }
    const it = items.find((i) => i.id === vp.costItemId);
    const ok = await post(`/api/cost-statements/${shipmentId}/vendor-payments`, { costItemId: vp.costItemId, amount: amt, currency: it?.currency || stmt.currency, paymentMethod: "urgent", attachmentUrl: vp.proof || undefined });
    if (ok) setVp({ costItemId: "", amount: "", proof: "" });
  };
  const reject = async () => { const reason = window.prompt(tr("reject", lang) + ":"); if (reason && reason.trim()) await post(`/api/cost-statements/${shipmentId}/reject`, { reason, revision: stmt.revision || 1 }); };

  const inp = "w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 bg-white";
  return (
    <div className="lg:hidden bg-white rounded-xl border border-slate-200 shadow-sm p-3 space-y-3">
      <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><Wallet className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>

      {/* Compact financial summary */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-400 font-bold uppercase text-[9px]">{tr("cost", lang)}</p><p className="font-black text-slate-800">{money(stmt.totalCost || 0)} {stmt.currency}</p></div>
        <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-400 font-bold uppercase text-[9px]">{tr("paid", lang)}</p><p className="font-black text-slate-800">{money(stmt.paidAmount || 0)}</p></div>
        <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-400 font-bold uppercase text-[9px]">{tr("outstanding", lang)}</p><p className="font-black text-amber-700">{money(vendorOutstanding)} {stmt.currency}</p></div>
        <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-400 font-bold uppercase text-[9px]">{tr("status", lang)}</p><p className="font-black text-slate-800 truncate">{status}</p></div>
      </div>

      {err && <p className="text-[11px] font-bold text-red-600">{err}</p>}

      {/* Quick-action buttons (server enforces the real permission) */}
      {canWrite && (
        <div className="flex flex-wrap gap-1.5">
          {editable && <button onClick={() => { setSheet(sheet === "expense" ? null : "expense"); setErr(null); }} className="px-2.5 py-2 bg-slate-900 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1 min-h-[40px]"><Plus className="w-3.5 h-3.5" />{tr("quickExpense", lang)}</button>}
          <button onClick={() => { setSheet(sheet === "vendor" ? null : "vendor"); setErr(null); }} className="px-2.5 py-2 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1 min-h-[40px]"><Landmark className="w-3.5 h-3.5" />{tr("vendorPay", lang)}</button>
          {editable && <button onClick={() => post(`/api/cost-statements/${shipmentId}/submit`)} disabled={busy} className="px-2.5 py-2 bg-emerald-600 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1 min-h-[40px]"><Send className="w-3.5 h-3.5" />{tr("submit", lang)}</button>}
          {isPendingMine && <button onClick={() => post(`/api/cost-statements/${shipmentId}/approve`, { revision: stmt.revision || 1 })} disabled={busy} className="px-2.5 py-2 bg-emerald-600 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1 min-h-[40px]"><Check className="w-3.5 h-3.5" />{tr("approve", lang)}</button>}
          {isPendingMine && <button onClick={reject} disabled={busy} className="px-2.5 py-2 bg-white border border-red-200 text-red-600 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1 min-h-[40px]"><X className="w-3.5 h-3.5" />{tr("reject", lang)}</button>}
        </div>
      )}

      {sheet === "expense" && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
          <input className={inp} placeholder={tr("desc", lang)} value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} />
          <input className={inp} placeholder={tr("supplier", lang)} value={exp.supplierName} onChange={(e) => setExp({ ...exp, supplierName: e.target.value })} />
          <input className={inp} type="number" inputMode="decimal" placeholder={`${tr("amount", lang)} (${stmt.currency})`} value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} />
          <div className="flex gap-2"><button onClick={addExpense} disabled={busy} className="flex-1 px-3 py-2 bg-slate-900 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 min-h-[40px]">{tr("save", lang)}</button><button onClick={() => setSheet(null)} className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer min-h-[40px]">{tr("cancel", lang)}</button></div>
        </div>
      )}
      {sheet === "vendor" && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
          <select className={inp} value={vp.costItemId} onChange={(e) => setVp({ ...vp, costItemId: e.target.value })}>
            <option value="">{tr("line", lang)}…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.supplierName || i.description || i.costType} · {money(i.totalAmount)} {i.currency}</option>)}
          </select>
          <input className={inp} type="number" inputMode="decimal" placeholder={tr("amount", lang)} value={vp.amount} onChange={(e) => setVp({ ...vp, amount: e.target.value })} />
          <input className={inp} placeholder={tr("proof", lang)} value={vp.proof} onChange={(e) => setVp({ ...vp, proof: e.target.value })} />
          <div className="flex gap-2"><button onClick={addVendorPayment} disabled={busy} className="flex-1 px-3 py-2 bg-slate-900 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 min-h-[40px]">{tr("save", lang)}</button><button onClick={() => setSheet(null)} className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer min-h-[40px]">{tr("cancel", lang)}</button></div>
        </div>
      )}
    </div>
  );
}
