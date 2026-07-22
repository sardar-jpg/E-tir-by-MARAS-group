import { useState, useEffect, useCallback } from "react";
import { ClipboardCheck, ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import { MIN_APPROVERS, MAX_APPROVERS, validateApproverList } from "../../lib/costApprovalWorkflow";

/**
 * Settings → Accounting Settings → Cost Approval Workflow (Phase 2).
 * A user-based, ORDERED approver chain: Approver 1 and Approver 2 are required,
 * Approver 3 is optional, and the row order is the approval order. Editing is
 * gated by the granular costs.manageApprovalWorkflow permission (server
 * re-validates via PUT /api/admin/accounting/approval-workflow) — never
 * hardcoded to Super Admin. This card never trusts the client.
 */
const T = {
  title: { en: "Cost Approval Workflow", tr: "Maliyet Onay İş Akışı", ar: "سير عمل اعتماد التكلفة" },
  intro: {
    en: "Select the approvers, in order. Approver 1 and Approver 2 are required; Approver 3 is optional. Approval runs in this order and completes after the last approver.",
    tr: "Onaycıları sırayla seçin. Onaycı 1 ve Onaycı 2 zorunludur; Onaycı 3 isteğe bağlıdır. Onay bu sırayla ilerler ve son onaycıdan sonra tamamlanır.",
    ar: "اختر المعتمدين بالترتيب. المعتمد 1 والمعتمد 2 مطلوبان؛ المعتمد 3 اختياري. يسير الاعتماد بهذا الترتيب ويكتمل بعد آخر معتمد.",
  },
  choose: { en: "Select a user…", tr: "Bir kullanıcı seçin…", ar: "اختر مستخدمًا…" },
  approver: { en: "Approver", tr: "Onaycı", ar: "المعتمد" },
  required: { en: "required", tr: "zorunlu", ar: "مطلوب" },
  optional: { en: "optional", tr: "isteğe bağlı", ar: "اختياري" },
  addThird: { en: "Add third approver", tr: "Üçüncü onaycı ekle", ar: "إضافة معتمد ثالث" },
  removeThird: { en: "Remove", tr: "Kaldır", ar: "إزالة" },
  save: { en: "Save Workflow", tr: "İş Akışını Kaydet", ar: "حفظ سير العمل" },
  saved: { en: "Workflow saved.", tr: "İş akışı kaydedildi.", ar: "تم حفظ سير العمل." },
  inactive: { en: "(inactive)", tr: "(pasif)", ar: "(غير نشط)" },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;

interface AdminOption { id: string; name?: string; email?: string; adminType?: string; active?: boolean }

export default function CostApprovalSettingsCard({ lang }: { lang: Language }) {
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  // Ordered approver ids; length is 2 or 3. Empty strings mean "not chosen yet".
  const [approvers, setApprovers] = useState<string[]>(["", ""]);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const load = useCallback(async () => {
    try {
      const [adminsRes, cfgRes] = await Promise.all([apiFetch("/api/admins"), apiFetch("/api/admin/accounting/approval-workflow")]);
      if (adminsRes.ok) setAdmins(await adminsRes.json());
      if (cfgRes.ok) {
        const body = await cfgRes.json();
        const list: string[] = Array.isArray(body.approverUserIds) ? body.approverUserIds : [];
        // Pad to at least the two required rows; keep an optional 3rd if present.
        const next = list.slice(0, MAX_APPROVERS);
        while (next.length < MIN_APPROVERS) next.push("");
        setApprovers(next);
      }
    } catch { /* card-isolated */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const activeIds = admins.filter((a) => a.active !== false).map((a) => a.id);
  const optionLabel = (a: AdminOption) => `${a.name || a.email || a.id}${a.active === false ? ` ${tr("inactive", lang)}` : ""}`;

  const setAt = (i: number, value: string) => setApprovers((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  const swap = (i: number, j: number) => setApprovers((prev) => {
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const addThird = () => setApprovers((prev) => (prev.length < MAX_APPROVERS ? [...prev, ""] : prev));
  const removeThird = () => setApprovers((prev) => prev.slice(0, MIN_APPROVERS));

  // Client-side mirror of the server rule (the server always re-validates).
  const validation = validateApproverList({ approverUserIds: approvers, activeAdminIds: activeIds });
  const canSave = validation.ok && status.kind !== "saving";

  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      const res = await apiFetch("/api/admin/accounting/approval-workflow", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverUserIds: approvers.filter(Boolean) }),
      });
      if (res.ok) setStatus({ kind: "ok", msg: tr("saved", lang) });
      else { const b = await res.json().catch(() => ({})); setStatus({ kind: "error", msg: b.error || "Save failed." }); }
    } catch { setStatus({ kind: "error", msg: "Save failed." }); }
  };

  const chosen = new Set(approvers.filter(Boolean));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div>
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
        <p className="text-[11px] text-slate-500 mt-0.5">{tr("intro", lang)}</p>
      </div>

      {approvers.map((val, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 w-5">{i + 1}.</span>
          <label className="text-xs font-bold text-slate-700 w-36 shrink-0">
            {tr("approver", lang)} {i + 1}
            <span className={`ml-1 text-[9px] font-black uppercase ${i < MIN_APPROVERS ? "text-orange-500" : "text-slate-400"}`}>
              {i < MIN_APPROVERS ? tr("required", lang) : tr("optional", lang)}
            </span>
          </label>
          <select
            value={val}
            onChange={(e) => setAt(i, e.target.value)}
            className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer"
          >
            <option value="">{tr("choose", lang)}</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id} disabled={chosen.has(a.id) && val !== a.id}>{optionLabel(a)}</option>
            ))}
          </select>
          {/* Reorder (simple position controls — drag-and-drop is not required). */}
          <div className="flex flex-col">
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-transparent border-0"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button type="button" aria-label="Move down" disabled={i === approvers.length - 1} onClick={() => swap(i, i + 1)} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer bg-transparent border-0"><ArrowDown className="w-3.5 h-3.5" /></button>
          </div>
          {i === MAX_APPROVERS - 1 && approvers.length === MAX_APPROVERS && (
            <button type="button" onClick={removeThird} className="p-1 text-red-500 hover:text-red-700 cursor-pointer bg-transparent border-0" aria-label={tr("removeThird", lang)}><X className="w-4 h-4" /></button>
          )}
        </div>
      ))}

      {approvers.length < MAX_APPROVERS && (
        <button type="button" onClick={addThird} className="flex items-center gap-1 text-[11px] font-bold text-orange-600 hover:text-orange-700 cursor-pointer bg-transparent border-0 pl-7">
          <Plus className="w-3.5 h-3.5" />{tr("addThird", lang)}
        </button>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={!canSave} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer border-0">{tr("save", lang)}</button>
        {!validation.ok && <span className="text-[11px] font-bold text-amber-600">{validation.error}</span>}
        {validation.ok && status.kind === "ok" && <span className="text-[11px] font-bold text-emerald-700">{status.msg}</span>}
        {validation.ok && status.kind === "error" && <span className="text-[11px] font-bold text-red-600">{status.msg}</span>}
      </div>
    </div>
  );
}
