import { useState, useEffect, useCallback } from "react";
import { Landmark, Plus, Star, Power } from "lucide-react";
import type { Language, BankAccount, Currency } from "../../types";
import { apiFetch } from "../../lib/api";

/**
 * Settings → Accounting Settings → Bank Accounts (Template Settings).
 * Super-Admin-only, Desktop only. Multiple accounts, each with a currency;
 * one active default per currency is auto-suggested on documents. Accounts
 * are retired via "Deactivate" (active:false) — never hard-deleted, so
 * historical documents keep their snapshot. The server re-validates and
 * enforces the one-default-per-currency rule.
 */
const CURRENCIES: Currency[] = ["USD", "IQD", "TRY", "EUR"];
const T = {
  title: { en: "Bank Accounts", tr: "Banka Hesapları", ar: "الحسابات المصرفية" },
  intro: { en: "Bank details suggested on customer documents by currency. The issuer can override the choice per document.", tr: "Müşteri belgelerinde para birimine göre önerilen banka bilgileri. Düzenleyen kişi belge başına seçimi değiştirebilir.", ar: "بيانات البنك المقترحة على مستندات العملاء حسب العملة. يمكن لمُصدر المستند تغيير الاختيار لكل مستند." },
  add: { en: "Add Account", tr: "Hesap Ekle", ar: "إضافة حساب" },
  none: { en: "No bank accounts yet.", tr: "Henüz banka hesabı yok.", ar: "لا توجد حسابات مصرفية بعد." },
  bankName: { en: "Bank name", tr: "Banka adı", ar: "اسم البنك" },
  holder: { en: "Account holder", tr: "Hesap sahibi", ar: "صاحب الحساب" },
  number: { en: "Account number", tr: "Hesap numarası", ar: "رقم الحساب" },
  default: { en: "Set default", tr: "Varsayılan yap", ar: "تعيين افتراضي" },
  isDefault: { en: "Default", tr: "Varsayılan", ar: "افتراضي" },
  deactivate: { en: "Deactivate", tr: "Devre dışı", ar: "إلغاء التفعيل" },
  activate: { en: "Activate", tr: "Etkinleştir", ar: "تفعيل" },
  inactive: { en: "Inactive", tr: "Pasif", ar: "غير نشط" },
  save: { en: "Save", tr: "Kaydet", ar: "حفظ" },
  cancel: { en: "Cancel", tr: "İptal", ar: "إلغاء" },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;

type Draft = { bankName: string; accountHolderName: string; accountNumber: string; iban: string; swift: string; currency: Currency; branch: string; country: string; isDefaultForCurrency: boolean };
const EMPTY: Draft = { bankName: "", accountHolderName: "", accountNumber: "", iban: "", swift: "", currency: "USD", branch: "", country: "", isDefaultForCurrency: false };

export default function BankAccountsSettingsCard({ lang }: { lang: Language }) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/accounting/bank-accounts");
      if (res.ok) setAccounts((await res.json()).accounts || []);
    } catch { /* card-isolated */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/accounting/bank-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (res.ok) { setAdding(false); setDraft(EMPTY); await load(); }
      else { const b = await res.json().catch(() => ({})); setErr(b.error || "Save failed."); }
    } catch { setErr("Save failed."); }
  };
  const patch = async (a: BankAccount, body: Partial<BankAccount>) => {
    try {
      const res = await apiFetch(`/api/admin/accounting/bank-accounts/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, ...body }) });
      if (res.ok) await load();
    } catch { /* card-isolated */ }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><Landmark className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{tr("intro", lang)}</p>
        </div>
        {!adding && (
          <button onClick={() => { setAdding(true); setErr(null); }} className="shrink-0 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />{tr("add", lang)}</button>
        )}
      </div>

      {accounts.length === 0 && !adding && <p className="text-[11px] text-slate-400 italic">{tr("none", lang)}</p>}

      <div className="space-y-1.5">
        {accounts.map((a) => (
          <div key={a.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${a.active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-70"}`}>
            <span className="font-black text-slate-800">{a.bankName}</span>
            <span className="font-mono text-slate-500">{a.accountNumber}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold text-[10px]">{a.currency}</span>
            {a.isDefaultForCurrency && a.active && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-bold text-[10px] flex items-center gap-0.5"><Star className="w-3 h-3" />{tr("isDefault", lang)}</span>}
            {!a.active && <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 font-bold text-[10px]">{tr("inactive", lang)}</span>}
            <div className="ml-auto flex items-center gap-2">
              {a.active && !a.isDefaultForCurrency && <button onClick={() => patch(a, { isDefaultForCurrency: true })} className="text-[10px] font-bold text-orange-600 hover:underline cursor-pointer bg-transparent border-0 p-0">{tr("default", lang)}</button>}
              <button onClick={() => patch(a, { active: !a.active })} className="text-[10px] font-bold text-slate-500 hover:underline cursor-pointer bg-transparent border-0 p-0 flex items-center gap-0.5"><Power className="w-3 h-3" />{a.active ? tr("deactivate", lang) : tr("activate", lang)}</button>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/60">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input value={draft.bankName} onChange={(e) => setDraft({ ...draft, bankName: e.target.value })} placeholder={tr("bankName", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            <input value={draft.accountHolderName} onChange={(e) => setDraft({ ...draft, accountHolderName: e.target.value })} placeholder={tr("holder", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            <input value={draft.accountNumber} onChange={(e) => setDraft({ ...draft, accountNumber: e.target.value })} placeholder={tr("number", lang)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value as Currency })} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={draft.iban} onChange={(e) => setDraft({ ...draft, iban: e.target.value })} placeholder="IBAN" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            <input value={draft.swift} onChange={(e) => setDraft({ ...draft, swift: e.target.value })} placeholder="SWIFT" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            <input value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} placeholder="Branch" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            <input value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder="Country" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={draft.isDefaultForCurrency} onChange={(e) => setDraft({ ...draft, isDefaultForCurrency: e.target.checked })} />
            {tr("default", lang)} ({draft.currency})
          </label>
          {err && <p className="text-[11px] font-bold text-red-600">{err}</p>}
          <div className="flex items-center gap-2">
            <button onClick={create} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">{tr("save", lang)}</button>
            <button onClick={() => { setAdding(false); setDraft(EMPTY); setErr(null); }} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer">{tr("cancel", lang)}</button>
          </div>
        </div>
      )}
    </div>
  );
}
