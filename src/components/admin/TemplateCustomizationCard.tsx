import { useState, useEffect, useCallback } from "react";
import { LayoutTemplate, Eye, Save, History, Loader2 } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import {
  TEMPLATE_DOC_TYPES, SAFE_FONTS, PRESETS, LOGO_POSITIONS, LOGO_SIZES,
  type TemplateConfig, type TemplateDocType,
} from "../../lib/accountingTemplateConfig";

/**
 * Settings → Accounting → Document Templates (Phase 11). CONTROLLED
 * customization only: bounded presets, safe fonts, clamped sizes, toggles,
 * short text fields — no free-form designer. Super-Admin only. Preview
 * before saving; publish bumps the version; prior versions can be restored.
 */
const DOC_LABEL: Record<TemplateDocType, string> = {
  invoice: "Customer Invoice", receipt: "Payment Receipt", statement: "Account Statement",
  voucher: "Vendor Voucher", cost_statement: "Cost Statement",
};
const T = {
  title: { en: "Document Templates", tr: "Belge Şablonları", ar: "قوالب المستندات" },
  intro: { en: "Controlled, print-safe customization per document type. Preview before publishing; changes never affect already-issued documents.", tr: "Belge türü başına kontrollü, baskıya uygun özelleştirme. Yayınlamadan önce önizleyin; değişiklikler düzenlenmiş belgeleri etkilemez.", ar: "تخصيص محكوم وآمن للطباعة لكل نوع مستند. عاين قبل النشر؛ التغييرات لا تؤثر على المستندات الصادرة." },
  preview: { en: "Preview", tr: "Önizle", ar: "معاينة" },
  publish: { en: "Publish", tr: "Yayınla", ar: "نشر" },
  published: { en: "Published.", tr: "Yayınlandı.", ar: "تم النشر." },
  versions: { en: "Version history", tr: "Sürüm geçmişi", ar: "سجل الإصدارات" },
  restore: { en: "Restore", tr: "Geri yükle", ar: "استعادة" },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;

export default function TemplateCustomizationCard({ lang }: { lang: Language }) {
  const [docType, setDocType] = useState<TemplateDocType>("invoice");
  const [cfg, setCfg] = useState<TemplateConfig | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });
  const [versions, setVersions] = useState<TemplateConfig[]>([]);
  const [showVersions, setShowVersions] = useState(false);

  const load = useCallback(async (dt: TemplateDocType) => {
    try { const res = await apiFetch(`/api/admin/accounting/templates/${dt}`); if (res.ok) setCfg((await res.json()).config); } catch { /* card-isolated */ }
  }, []);
  useEffect(() => { void load(docType); setShowVersions(false); }, [docType, load]);

  const set = <K extends keyof TemplateConfig>(k: K, v: TemplateConfig[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  const preview = async () => {
    if (!cfg) return;
    try {
      const res = await apiFetch(`/api/admin/accounting/templates/${docType}/preview?lang=${cfg.defaultLanguage}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      if (res.ok) { const blob = await res.blob(); const url = URL.createObjectURL(blob); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    } catch { /* card-isolated */ }
  };
  const publish = async () => {
    if (!cfg) return;
    setStatus({ kind: "saving" });
    try {
      const res = await apiFetch(`/api/admin/accounting/templates/${docType}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      if (res.ok) { setCfg((await res.json()).config); setStatus({ kind: "ok", msg: tr("published", lang) }); }
      else { const b = await res.json().catch(() => ({})); setStatus({ kind: "error", msg: b.error || "Save failed." }); }
    } catch { setStatus({ kind: "error", msg: "Save failed." }); }
  };
  const loadVersions = async () => {
    setShowVersions((v) => !v);
    try { const res = await apiFetch(`/api/admin/accounting/templates/${docType}/versions`); if (res.ok) setVersions((await res.json()).versions || []); } catch { /* ignore */ }
  };
  const restore = async (v: number) => {
    try { const res = await apiFetch(`/api/admin/accounting/templates/${docType}/restore/${v}`, { method: "POST" }); if (res.ok) { setCfg((await res.json()).config); setShowVersions(false); } } catch { /* ignore */ }
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-0.5">{label}</label>{children}</div>
  );
  const Toggle = ({ k, label }: { k: keyof TemplateConfig; label: string }) => (
    <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
      <input type="checkbox" checked={!!cfg?.[k]} onChange={(e) => set(k, e.target.checked as any)} />{label}
    </label>
  );
  const sel = "w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer";
  const inp = "w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white";

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div>
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><LayoutTemplate className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
        <p className="text-[11px] text-slate-500 mt-0.5">{tr("intro", lang)}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {TEMPLATE_DOC_TYPES.map((dt) => (
          <button key={dt} onClick={() => setDocType(dt)} className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer border ${docType === dt ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}>{DOC_LABEL[dt]}</button>
        ))}
      </div>
      {!cfg ? <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />…</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <Field label="Preset"><select className={sel} value={cfg.presetId} onChange={(e) => set("presetId", e.target.value as any)}>{PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
            <Field label="Font"><select className={sel} value={cfg.fontFamily} onChange={(e) => set("fontFamily", e.target.value as any)}>{SAFE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field>
            <Field label="Language"><select className={sel} value={cfg.defaultLanguage} onChange={(e) => set("defaultLanguage", e.target.value as any)}><option value="en">EN (LTR)</option><option value="ar">AR (RTL)</option><option value="tr">TR</option></select></Field>
            <Field label="Heading size"><input type="number" min={12} max={20} className={inp} value={cfg.headingSize} onChange={(e) => set("headingSize", Number(e.target.value) as any)} /></Field>
            <Field label="Body size"><input type="number" min={7} max={12} className={inp} value={cfg.bodySize} onChange={(e) => set("bodySize", Number(e.target.value) as any)} /></Field>
            <Field label="Logo position"><select className={sel} value={cfg.logoPosition} onChange={(e) => set("logoPosition", e.target.value as any)}>{LOGO_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
            <Field label="Logo size"><select className={sel} value={cfg.logoSize} onChange={(e) => set("logoSize", e.target.value as any)}>{LOGO_SIZES.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <Toggle k="showBank" label="Bank block" /><Toggle k="showSignature" label="Signature" /><Toggle k="showStamp" label="Stamp" /><Toggle k="showPageNumbers" label="Page numbers" /><Toggle k="showNotes" label="Notes" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Field label="Header text"><input className={inp} value={cfg.headerText || ""} onChange={(e) => set("headerText", e.target.value as any)} /></Field>
            <Field label="Footer text"><input className={inp} value={cfg.footerText || ""} onChange={(e) => set("footerText", e.target.value as any)} /></Field>
            <Field label="Payment terms"><input className={inp} value={cfg.paymentTerms || ""} onChange={(e) => set("paymentTerms", e.target.value as any)} /></Field>
            <Field label="Standard notes"><input className={inp} value={cfg.standardNotes || ""} onChange={(e) => set("standardNotes", e.target.value as any)} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={preview} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{tr("preview", lang)}</button>
            <button onClick={publish} disabled={status.kind === "saving"} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1"><Save className="w-3.5 h-3.5" />{tr("publish", lang)}{typeof cfg.version === "number" ? ` (v${cfg.version})` : ""}</button>
            <button onClick={loadVersions} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1"><History className="w-3.5 h-3.5" />{tr("versions", lang)}</button>
            {status.kind === "ok" && <span className="text-[11px] font-bold text-emerald-700">{status.msg}</span>}
            {status.kind === "error" && <span className="text-[11px] font-bold text-red-600">{status.msg}</span>}
          </div>
          {showVersions && (
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {versions.length === 0 && <p className="text-[11px] text-slate-400 italic p-2">No prior versions.</p>}
              {versions.map((v) => (
                <div key={v.version} className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
                  <span className="font-bold text-slate-700">v{v.version}</span>
                  <span className="text-slate-400">{v.presetId} · {v.fontFamily}</span>
                  <button onClick={() => restore(v.version!)} className="ml-auto text-[10px] font-bold text-orange-600 hover:underline cursor-pointer bg-transparent border-0 p-0">{tr("restore", lang)}</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
