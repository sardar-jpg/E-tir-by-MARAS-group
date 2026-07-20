import { useState, useMemo, useRef, useEffect } from "react";
import { Loader2, X, Plus, Search, ChevronDown, Check, AlertCircle, Building2 } from "lucide-react";
import type { Language, Vendor } from "../../types";
import { apiFetch } from "../../lib/api";
import { EXPENSE_TYPES, EXPENSE_TYPE_OTHER, isOtherExpenseType, type L3 } from "../../lib/expenseTypes";

/**
 * ExpenseDrawer — a focused, on-demand expense entry drawer for the desktop
 * cost-statement workspace. CLOSED by default; opens only on "Add Expense".
 *
 * Data-entry safety (this change): free-text Vendor and Expense Type were
 * replaced with controlled selectors backed by EXISTING master data —
 * the Vendors module (`vendors` prop, loaded from /api/vendors) and the shared
 * EXPENSE_TYPES constant. Only the "Other" expense type permits free text.
 *
 * It reuses the EXISTING item-level endpoint (POST /api/cost-statements/:id/items)
 * with the same idempotencyKey + expectedRevision contract — no new server
 * behaviour, no duplicated accounting logic. The persisted vendor reference is
 * the vendor's canonical companyName in the existing `supplierName` field (the
 * field vendor-payables already matches on); arbitrary vendor text cannot be
 * submitted. On success it clears its fields, closes, and lets the host show
 * the success cue + refresh.
 */
const T = {
  title: { en: "Add Expense", ar: "إضافة مصروف", tr: "Masraf Ekle" },
  type: { en: "Expense Type", ar: "نوع المصروف", tr: "Masraf Türü" },
  typePlaceholder: { en: "Select an expense type…", ar: "اختر نوع المصروف…", tr: "Masraf türü seçin…" },
  specify: { en: "Specify Expense Type", ar: "حدّد نوع المصروف", tr: "Masraf Türünü Belirtin" },
  specifyPlaceholder: { en: "Enter the custom expense type", ar: "أدخل نوع المصروف المخصص", tr: "Özel masraf türünü girin" },
  vendor: { en: "Vendor / Supplier", ar: "المورد", tr: "Tedarikçi" },
  vendorSearch: { en: "Search vendors by name, code, category or phone…", ar: "ابحث عن المورد بالاسم أو الرمز أو الفئة أو الهاتف…", tr: "Tedarikçiyi ada, koda, kategoriye veya telefona göre arayın…" },
  vendorNone: { en: "Vendor not found. Add the vendor from the Vendors section first.", ar: "المورد غير موجود. أضف المورد من قسم الموردين أولاً.", tr: "Tedarikçi bulunamadı. Önce Tedarikçiler bölümünden ekleyin." },
  desc: { en: "Description", ar: "الوصف", tr: "Açıklama" },
  descPlaceholder: { en: "Add expense details or notes", ar: "أضف تفاصيل أو ملاحظات المصروف", tr: "Masraf ayrıntıları veya notlar ekleyin" },
  reference: { en: "Invoice / Reference Number", ar: "رقم الفاتورة / المرجع", tr: "Fatura / Referans Numarası" },
  amount: { en: "Amount", ar: "المبلغ", tr: "Tutar" },
  optional: { en: "Optional", ar: "اختياري", tr: "İsteğe bağlı" },
  save: { en: "Save Expense", ar: "حفظ المصروف", tr: "Masrafı Kaydet" },
  cancel: { en: "Cancel", ar: "إلغاء", tr: "İptal" },
  errType: { en: "Select an expense type.", ar: "اختر نوع المصروف.", tr: "Bir masraf türü seçin." },
  errSpecify: { en: "Specify the custom expense type.", ar: "حدّد نوع المصروف المخصص.", tr: "Özel masraf türünü belirtin." },
  errVendor: { en: "Select a vendor from the list.", ar: "اختر موردًا من القائمة.", tr: "Listeden bir tedarikçi seçin." },
  errAmount: { en: "Enter an amount greater than zero.", ar: "أدخل مبلغًا أكبر من صفر.", tr: "Sıfırdan büyük bir tutar girin." },
  conflict: { en: "This statement changed since it loaded — it was refreshed. Please review and retry.", ar: "تغيّر الكشف منذ تحميله — تم تحديثه. راجع وأعد المحاولة.", tr: "Tablo yüklendiğinden beri değişti — yenilendi. Lütfen tekrar deneyin." },
  failed: { en: "Could not add the expense.", ar: "تعذّرت إضافة المصروف.", tr: "Masraf eklenemedi." },
};
const tr = (k: keyof typeof T, lang: Language) => (T[k] as L3)[lang] || (T[k] as L3).en;

interface Props {
  shipmentId: string;
  currency: string;
  sessionId: string;
  /** Existing master-data vendor list (from /api/vendors) — never a new store. */
  vendors: Vendor[];
  /** Revision loaded with the statement — sent as expectedRevision (optimistic lock). */
  expectedRevision: number;
  lang: Language;
  onClose: () => void;
  /** Fired after a successful save (fields already cleared); host refreshes + toasts. */
  onAdded: () => void;
}

export default function ExpenseDrawer({ shipmentId, currency, sessionId, vendors, expectedRevision, lang, onClose, onAdded }: Props) {
  const [expenseType, setExpenseType] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);
  const [customType, setCustomType] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorOpen, setVendorOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const vendorRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);

  const isOther = isOtherExpenseType(expenseType);
  const selectedVendor = useMemo(() => vendors.find((v) => v.id === vendorId) || null, [vendors, vendorId]);
  const selectedTypeLabel = useMemo(() => {
    const t = EXPENSE_TYPES.find((o) => o.value === expenseType);
    return t ? (t.label[lang] || t.label.en) : "";
  }, [expenseType, lang]);

  // Close the dropdowns on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (vendorRef.current && !vendorRef.current.contains(e.target as Node)) setVendorOpen(false);
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filteredVendors = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    const list = [...vendors].sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""));
    if (!q) return list;
    return list.filter((v) =>
      (v.companyName || "").toLowerCase().includes(q) ||
      (v.id || "").toLowerCase().includes(q) ||
      (v.serviceType || "").toLowerCase().includes(q) ||
      (v.phone || "").toLowerCase().includes(q));
  }, [vendors, vendorQuery]);

  // Switching away from "Other" clears any previously typed custom value.
  const chooseType = (v: string) => { setExpenseType(v); if (!isOtherExpenseType(v)) setCustomType(""); };

  const resolvedType = isOther ? customType.trim() : expenseType;
  const amountNum = Number(amount);
  const valid =
    !!expenseType &&
    (!isOther || customType.trim().length > 0) &&
    !!selectedVendor &&
    amountNum > 0;

  const reset = () => {
    setExpenseType(""); setCustomType(""); setVendorId(""); setVendorQuery("");
    setDescription(""); setReference(""); setAmount(""); setTouched(false);
  };

  const save = async () => {
    setTouched(true);
    if (!valid || !selectedVendor) return;
    setBusy(true); setErr(null);
    try {
      const idempotencyKey = `csw-exp-${sessionId}-${shipmentId}-${Date.now()}`;
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: {
            // Controlled expense category (or the trimmed custom "Other" value).
            costType: resolvedType,
            description: description.trim() || resolvedType,
            // Canonical vendor NAME from the master list — never free text.
            supplierName: selectedVendor.companyName,
            reference: reference.trim() || undefined,
            amount: amountNum, currency,
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
  const showErr = (cond: boolean) => touched && cond;

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-black text-slate-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />{tr("title", lang)}</h3>
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 flex items-center justify-center cursor-pointer transition"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Expense Type — controlled dropdown from the shared source of truth (item 2) */}
        <div ref={typeRef}>
          <label className={lbl}>{tr("type", lang)}</label>
          <div className="relative">
            <button type="button" onClick={() => setTypeOpen((o) => !o)} className={`${field} flex items-center justify-between text-left cursor-pointer ${showErr(!expenseType) ? "border-red-300" : ""}`}>
              <span className={expenseType ? "font-bold text-slate-800 truncate" : "text-slate-400"}>{expenseType ? selectedTypeLabel : tr("typePlaceholder", lang)}</span>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
            {typeOpen && (
              <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                <div className="max-h-60 overflow-y-auto py-1">
                  {EXPENSE_TYPES.map((t) => (
                    <button key={t.value} type="button" onClick={() => { chooseType(t.value); setTypeOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 cursor-pointer border-0 bg-transparent flex items-center justify-between gap-2 text-[13px] font-semibold text-slate-700">
                      {t.label[lang] || t.label.en}
                      {t.value === expenseType && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {showErr(!expenseType) && <InlineErr>{tr("errType", lang)}</InlineErr>}
        </div>

        {/* Specify Expense Type — only when Other (item 3) */}
        {isOther ? (
          <div>
            <label className={lbl}>{tr("specify", lang)}</label>
            <input className={`${field} ${showErr(customType.trim().length === 0) ? "border-red-300" : ""}`} value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder={tr("specifyPlaceholder", lang)} maxLength={60} />
            {showErr(customType.trim().length === 0) && <InlineErr>{tr("errSpecify", lang)}</InlineErr>}
          </div>
        ) : <div className="hidden md:block" />}

        {/* Vendor / Supplier — searchable combobox from the Vendors module (item 1) */}
        <div className="md:col-span-2" ref={vendorRef}>
          <label className={lbl}>{tr("vendor", lang)}</label>
          <div className="relative">
            <button type="button" onClick={() => setVendorOpen((o) => !o)} className={`${field} flex items-center justify-between text-left cursor-pointer ${showErr(!selectedVendor) ? "border-red-300" : ""}`}>
              {selectedVendor ? (
                <span className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="font-bold text-slate-800 truncate">{selectedVendor.companyName}</span>
                  {selectedVendor.serviceType && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">{selectedVendor.serviceType}</span>}
                </span>
              ) : <span className="text-slate-400">{tr("vendorSearch", lang)}</span>}
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
            {vendorOpen && (
              <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input autoFocus value={vendorQuery} onChange={(e) => setVendorQuery(e.target.value)} placeholder={tr("vendorSearch", lang)} className="w-full text-[13px] outline-none bg-transparent" />
                </div>
                <div className="max-h-60 overflow-y-auto py-1">
                  {filteredVendors.length === 0 ? (
                    <div className="px-3 py-4 text-[12px] text-slate-500 flex items-start gap-2"><AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />{tr("vendorNone", lang)}</div>
                  ) : filteredVendors.map((v) => (
                    <button key={v.id} type="button" onClick={() => { setVendorId(v.id); setVendorOpen(false); setVendorQuery(""); }}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-0 bg-transparent flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-bold text-slate-800 truncate">{v.companyName}</span>
                        <span className="block text-[10.5px] text-slate-400 truncate">
                          {v.id && <span className="font-mono">{v.id}</span>}
                          {v.serviceType && <span> · {v.serviceType}</span>}
                          {v.phone && <span> · {v.phone}</span>}
                        </span>
                      </span>
                      {v.id === vendorId && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {showErr(!selectedVendor) && <InlineErr>{tr("errVendor", lang)}</InlineErr>}
          {vendors.length === 0 && <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{tr("vendorNone", lang)}</p>}
        </div>

        {/* Description — free text, optional (item 4) */}
        <div className="md:col-span-2">
          <label className={lbl}>{tr("desc", lang)} <span className="text-slate-300 font-semibold normal-case">· {tr("optional", lang)}</span></label>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={tr("descPlaceholder", lang)} />
        </div>

        {/* Invoice / Reference — free text, optional (item 5) */}
        <div>
          <label className={lbl}>{tr("reference", lang)} <span className="text-slate-300 font-semibold normal-case">· {tr("optional", lang)}</span></label>
          <input className={field} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>

        {/* Amount */}
        <div>
          <label className={lbl}>{tr("amount", lang)} ({currency})</label>
          <input className={`${field} ${showErr(!(amountNum > 0)) ? "border-red-300" : ""}`} type="number" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {showErr(!(amountNum > 0)) && <InlineErr>{tr("errAmount", lang)}</InlineErr>}
        </div>
      </div>

      {err && <p className="text-[12px] font-bold text-red-600">{err}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || !valid} title={!valid ? tr("errType", lang) : undefined}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[13px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-2 transition">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{tr("save", lang)}
        </button>
        <button onClick={onClose} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 text-[13px] font-bold rounded-lg cursor-pointer transition">{tr("cancel", lang)}</button>
      </div>
    </div>
  );
}

function InlineErr({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold text-red-600 mt-1 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{children}</p>;
}
