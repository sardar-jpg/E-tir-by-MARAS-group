import { useState } from "react";
import { ShieldCheck, ChevronDown, Loader2, Check } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import { ACCOUNTING_PERMISSION_GROUPS } from "../../lib/accountingPermissions";

/**
 * Accounting Permissions editor (PR #140 review increment 4). Rendered ONLY
 * inside Settings → Team (Super-Admin only). This is the single place employee
 * accounting permissions are managed — accounting/operational screens never
 * contain permission controls, they only read the saved permissions. Labels
 * are trilingual and come from the central registry; raw permission keys are
 * never shown to the user. The server re-enforces Super-Admin + escalation
 * rules on save, so the UI is a convenience, never the authorization source.
 */
const T = {
  title: { en: "Accounting Permissions", ar: "صلاحيات المحاسبة", tr: "Muhasebe İzinleri" },
  legacy: { en: "Using default accounts permissions (not yet customized).", ar: "يستخدم الصلاحيات الافتراضية للمحاسبة (لم تُخصص بعد).", tr: "Varsayılan muhasebe izinleri kullanılıyor (henüz özelleştirilmedi)." },
  save: { en: "Save permissions", ar: "حفظ الصلاحيات", tr: "İzinleri kaydet" },
  saving: { en: "Saving…", ar: "جارٍ الحفظ…", tr: "Kaydediliyor…" },
  saved: { en: "Permissions saved.", ar: "تم حفظ الصلاحيات.", tr: "İzinler kaydedildi." },
  selectAll: { en: "All", ar: "الكل", tr: "Tümü" },
  clear: { en: "None", ar: "لا شيء", tr: "Hiçbiri" },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;
const groupLabel = (g: (typeof ACCOUNTING_PERMISSION_GROUPS)[number], lang: Language) => g.label[lang] || g.label.en;

export default function EmployeePermissionsEditor({ employeeId, lang }: { employeeId: string; lang: Language }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usesLegacy, setUsesLegacy] = useState(false);
  const [status, setStatus] = useState<null | "saving" | "saved" | string>(null);

  const allKeys = ACCOUNTING_PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

  const load = async () => {
    setLoading(true); setStatus(null);
    try {
      const res = await apiFetch(`/api/admins/${employeeId}/permissions`);
      if (res.ok) { const d = await res.json(); setSelected(new Set(d.effective || [])); setUsesLegacy(!!d.usesLegacyDefault); }
      else { const d = await res.json().catch(() => ({})); setStatus(d.error || "Could not load permissions."); }
    } catch { setStatus("Could not load permissions."); } finally { setLoading(false); }
  };
  const toggleOpen = () => { const n = !open; setOpen(n); if (n) void load(); };
  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const save = async () => {
    setStatus("saving");
    try {
      const res = await apiFetch(`/api/admins/${employeeId}/permissions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permissions: [...selected] }) });
      if (res.ok) { setStatus("saved"); setUsesLegacy(false); }
      else { const d = await res.json().catch(() => ({})); setStatus(d.error || "Could not save permissions."); }
    } catch { setStatus("Could not save permissions."); }
  };

  return (
    <div className="border-t border-slate-100 mt-3 pt-3">
      <button onClick={toggleOpen} className="w-full flex items-center justify-between text-[11px] font-bold text-slate-600 hover:text-slate-900 cursor-pointer bg-transparent border-0 p-0">
        <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-orange-500" />{tr("title", lang)}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-400 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />…</div>
          ) : (
            <>
              {usesLegacy && <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">{tr("legacy", lang)}</p>}
              <div className="flex gap-2 text-[10px]">
                <button onClick={() => setSelected(new Set(allKeys))} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 border-0 cursor-pointer text-slate-600 font-bold">{tr("selectAll", lang)}</button>
                <button onClick={() => setSelected(new Set())} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 border-0 cursor-pointer text-slate-600 font-bold">{tr("clear", lang)}</button>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {ACCOUNTING_PERMISSION_GROUPS.map((g) => (
                  <div key={g.id} className="rounded-lg bg-slate-50/70 border border-slate-100 p-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mb-1">{groupLabel(g, lang)}</p>
                    <div className="grid grid-cols-1 gap-0.5">
                      {g.permissions.map((perm) => (
                        <label key={perm.key} className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer py-0.5">
                          <input type="checkbox" checked={selected.has(perm.key)} onChange={() => toggle(perm.key)} className="w-3.5 h-3.5 accent-orange-500 cursor-pointer" />
                          <span>{perm.label[lang] || perm.label.en}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={save} disabled={status === "saving"} className="px-3 py-1.5 bg-slate-900 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1 disabled:opacity-60">
                  {status === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {status === "saving" ? tr("saving", lang) : tr("save", lang)}
                </button>
                {status === "saved" && <span className="text-[11px] font-bold text-emerald-600">{tr("saved", lang)}</span>}
                {status && status !== "saving" && status !== "saved" && <span className="text-[11px] font-bold text-red-600">{status}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
