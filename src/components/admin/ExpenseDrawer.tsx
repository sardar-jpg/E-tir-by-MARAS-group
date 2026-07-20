import { useState } from "react";
import { Loader2, X, Plus } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";

/**
 * ExpenseDrawer — a focused, on-demand expense entry drawer for the desktop
 * cost-statement workspace. It is CLOSED by default and only appears when the
 * user clicks "Add Expense".
 *
 * It reuses the EXISTING item-level endpoint (POST /api/cost-statements/:id/items)
 * with the same idempotencyKey + expectedRevision contract the rest of the app
 * uses — no new server behaviour, no duplicated accounting logic. On success it
 * clears its fields, closes, and lets the host show the success cue + refresh.
 */
const T = {
  title: { en: "Add Expense", ar: "إضافة مصروف", tr: "Masraf Ekle" },
  type: { en: "Expense type", ar: "نوع المصروف", tr: "Masraf türü" },
  desc: { en: "Description", ar: "الوصف", tr: "Açıklama" },
  vendor: { en: "Vendor / supplier", ar: "المورد", tr: "Tedarikçi" },
  reference: { en: "Invoice / reference", ar: "الفاتورة / المرجع", tr: "Fatura / referans" },
  amount: { en: "Amount", ar: "المبلغ", tr: "Tutar" },
  save: { en: "Save Expense", ar: "حفظ المصروف", tr: "Masrafı Kaydet" },
  cancel: { en: "Cancel", ar: "إلغاء", tr: "İptal" },
  invalidAmount: { en: "Enter a valid amount greater than zero.", ar: "أدخل مبلغًا صحيحًا أكبر من صفر.", tr: "Sıfırdan büyük geçerli bir tutar girin." },
  conflict: { en: "This statement changed since it loaded — it was refreshed. Please review and retry.", ar: "تغيّر الكشف منذ تحميله — تم تحديثه. راجع وأعد المحاولة.", tr: "Tablo yüklendiğinden beri değişti — yenilendi. Lütfen tekrar deneyin." },
  failed: { en: "Could not add the expense.", ar: "تعذّرت إضافة المصروف.", tr: "Masraf eklenemedi." },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;

interface Props {
  shipmentId: string;
  currency: string;
  sessionId: string;
  /** Revision loaded with the statement — sent as expectedRevision (optimistic lock). */
  expectedRevision: number;
  lang: Language;
  onClose: () => void;
  /** Fired after a successful save (fields already cleared); host refreshes + toasts. */
  onAdded: () => void;
}

export default function ExpenseDrawer({ shipmentId, currency, sessionId, expectedRevision, lang, onClose, onAdded }: Props) {
  const [form, setForm] = useState({ costType: "", description: "", supplierName: "", reference: "", amount: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => setForm({ costType: "", description: "", supplierName: "", reference: "", amount: "" });

  const save = async () => {
    const amt = Number(form.amount);
    if (!(amt > 0)) { setErr(tr("invalidAmount", lang)); return; }
    setBusy(true); setErr(null);
    try {
      const idempotencyKey = `csw-exp-${sessionId}-${shipmentId}-${Date.now()}`;
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: {
            costType: form.costType.trim() || "expense",
            description: form.description.trim() || "Expense",
            supplierName: form.supplierName.trim() || "",
            reference: form.reference.trim() || undefined,
            amount: amt, currency,
          },
          idempotencyKey, expectedRevision,
        }),
      });
      if (res.ok) { reset(); onAdded(); onClose(); return; }
      const b = await res.json().catch(() => ({}));
      if (b.code === "revision_conflict") setErr(tr("conflict", lang));
      else setErr(b.error || tr("failed", lang));
    } catch { setErr(tr("failed", lang)); } finally { setBusy(false); }
  };

  const field = "w-full text-[13px] border border-slate-300 rounded-lg px-3 py-2.5 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition";
  const lbl = "block text-[11px] font-black uppercase tracking-wide text-slate-500 mb-1";

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-black text-slate-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />{tr("title", lang)}</h3>
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 flex items-center justify-center cursor-pointer transition"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={lbl}>{tr("type", lang)}</label>
          <input className={field} value={form.costType} onChange={(e) => setForm({ ...form, costType: e.target.value })} placeholder="Freight, Customs…" />
        </div>
        <div>
          <label className={lbl}>{tr("vendor", lang)}</label>
          <input className={field} value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>{tr("desc", lang)}</label>
          <input className={field} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className={lbl}>{tr("reference", lang)}</label>
          <input className={field} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        </div>
        <div>
          <label className={lbl}>{tr("amount", lang)} ({currency})</label>
          <input className={field} type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
      </div>
      {err && <p className="text-[12px] font-bold text-red-600">{err}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[13px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-2 transition">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{tr("save", lang)}
        </button>
        <button onClick={onClose} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 text-[13px] font-bold rounded-lg cursor-pointer transition">{tr("cancel", lang)}</button>
      </div>
    </div>
  );
}
