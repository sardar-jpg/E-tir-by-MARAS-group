import { useState, useEffect, useCallback } from "react";
import { Building2 } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";

/**
 * Settings → Accounting Settings → Company Profile (Template Settings).
 * Super-Admin-only. Feeds document branding (invoices, receipts, customer
 * account statements, cost statement PDF). Desktop is the source of truth;
 * the server (PUT /api/admin/accounting/company-profile) re-validates
 * everything via the pure accountingTemplateSettings module.
 */
type Field = { key: string; en: string; ar: string; tr: string; wide?: boolean; area?: boolean };
const FIELDS: Field[] = [
  { key: "companyName", en: "Company name", ar: "اسم الشركة", tr: "Şirket adı" },
  { key: "companyNameEn", en: "Company name (English)", ar: "اسم الشركة (إنجليزي)", tr: "Şirket adı (İngilizce)" },
  { key: "companyNameAr", en: "Company name (Arabic)", ar: "اسم الشركة (عربي)", tr: "Şirket adı (Arapça)" },
  { key: "email", en: "Email", ar: "البريد الإلكتروني", tr: "E-posta" },
  { key: "phone", en: "Phone", ar: "الهاتف", tr: "Telefon" },
  { key: "website", en: "Website", ar: "الموقع الإلكتروني", tr: "Web sitesi" },
  { key: "registrationDetails", en: "Registration details", ar: "بيانات التسجيل", tr: "Kayıt bilgileri" },
  { key: "taxDetails", en: "Tax details", ar: "بيانات الضريبة", tr: "Vergi bilgileri" },
  { key: "address", en: "Address", ar: "العنوان", tr: "Adres", wide: true, area: true },
  { key: "logoUrl", en: "Logo URL", ar: "رابط الشعار", tr: "Logo URL" },
  { key: "stampUrl", en: "Stamp URL", ar: "رابط الختم", tr: "Kaşe URL" },
  { key: "signatureUrl", en: "Signature URL", ar: "رابط التوقيع", tr: "İmza URL" },
  { key: "footerText", en: "Footer text", ar: "نص التذييل", tr: "Alt bilgi metni", wide: true, area: true },
];
const T = {
  title: { en: "Company Profile", tr: "Şirket Profili", ar: "ملف الشركة" },
  intro: { en: "Branding used on customer invoices, receipts, account statements and the internal cost statement. Managed on Desktop only.", tr: "Müşteri faturaları, makbuzlar, hesap ekstreleri ve dahili maliyet tablosunda kullanılan marka bilgileri. Yalnızca masaüstünde yönetilir.", ar: "بيانات العلامة المستخدمة في فواتير العملاء والإيصالات وكشوف الحسابات وكشف التكلفة الداخلي. تُدار على سطح المكتب فقط." },
  save: { en: "Save Profile", tr: "Profili Kaydet", ar: "حفظ الملف" },
  saved: { en: "Company profile saved.", tr: "Şirket profili kaydedildi.", ar: "تم حفظ ملف الشركة." },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;
const label = (f: Field, lang: Language) => (lang === "ar" ? f.ar : lang === "tr" ? f.tr : f.en);

export default function CompanyProfileSettingsCard({ lang }: { lang: Language }) {
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/accounting/company-profile");
      if (res.ok) {
        const body = await res.json();
        const p = body.profile || {};
        const next: Record<string, string> = {};
        for (const f of FIELDS) next[f.key] = typeof p[f.key] === "string" ? p[f.key] : "";
        setProfile(next);
      }
    } catch { /* card-isolated */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const set = (k: string, v: string) => setProfile((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      const res = await apiFetch("/api/admin/accounting/company-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      if (res.ok) setStatus({ kind: "ok", msg: tr("saved", lang) });
      else { const b = await res.json().catch(() => ({})); setStatus({ kind: "error", msg: b.error || "Save failed." }); }
    } catch { setStatus({ kind: "error", msg: "Save failed." }); }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div>
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><Building2 className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
        <p className="text-[11px] text-slate-500 mt-0.5">{tr("intro", lang)}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? "md:col-span-2" : ""}>
            <label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-0.5">{label(f, lang)}</label>
            {f.area ? (
              <textarea value={profile[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} rows={2} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white resize-y" />
            ) : (
              <input value={profile[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={status.kind === "saving"} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer border-0">{tr("save", lang)}</button>
        {status.kind === "ok" && <span className="text-[11px] font-bold text-emerald-700">{status.msg}</span>}
        {status.kind === "error" && <span className="text-[11px] font-bold text-red-600">{status.msg}</span>}
      </div>
    </div>
  );
}
