import { useState, useEffect, useCallback } from "react";
import { ClipboardCheck } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import { APPROVAL_STAGES, type ApprovalStage } from "../../lib/costApprovalWorkflow";

/**
 * Settings → Accounting Settings → Cost Approval Workflow (PR #6).
 * Super-Admin-only selectors assigning the three fixed, ordered stages to
 * active internal admin accounts. The order is fixed; only the assignees
 * are configurable. Server (PUT /api/admin/accounting/approval-workflow)
 * re-validates everything — this card never trusts the client.
 */
const STAGE_LABELS: Record<ApprovalStage, { en: string; tr: string; ar: string }> = {
  operations_manager: { en: "Operations Manager", tr: "Operasyon Müdürü", ar: "مدير العمليات" },
  accounts_manager: { en: "Accounts Manager", tr: "Muhasebe Müdürü", ar: "مدير الحسابات" },
  managing_director: { en: "Managing Director", tr: "Genel Müdür", ar: "المدير العام" },
};
const T = {
  title: { en: "Cost Approval Workflow", tr: "Maliyet Onay İş Akışı", ar: "سير عمل اعتماد التكلفة" },
  intro: { en: "Assign the three fixed approval stages to active employees. All three are required before any cost statement can be submitted.", tr: "Üç sabit onay aşamasını aktif çalışanlara atayın. Bir maliyet tablosu gönderilmeden önce üçü de gereklidir.", ar: "عيّن مراحل الاعتماد الثابتة الثلاث لموظفين نشطين. جميعها مطلوبة قبل إرسال أي كشف تكلفة." },
  choose: { en: "Select an employee…", tr: "Bir çalışan seçin…", ar: "اختر موظفًا…" },
  save: { en: "Save Workflow", tr: "İş Akışını Kaydet", ar: "حفظ سير العمل" },
  saved: { en: "Workflow saved.", tr: "İş akışı kaydedildi.", ar: "تم حفظ سير العمل." },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;

interface AdminOption { id: string; name?: string; email?: string; adminType?: string }

export default function CostApprovalSettingsCard({ lang }: { lang: Language }) {
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [assign, setAssign] = useState<Record<ApprovalStage, string>>({ operations_manager: "", accounts_manager: "", managing_director: "" });
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const load = useCallback(async () => {
    try {
      const [adminsRes, cfgRes] = await Promise.all([apiFetch("/api/admins"), apiFetch("/api/admin/accounting/approval-workflow")]);
      if (adminsRes.ok) setAdmins(await adminsRes.json());
      if (cfgRes.ok) {
        const body = await cfgRes.json();
        const c = body.config || {};
        setAssign({ operations_manager: c.operations_manager || "", accounts_manager: c.accounts_manager || "", managing_director: c.managing_director || "" });
      }
    } catch { /* card-isolated */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const chosen = new Set(Object.values(assign).filter(Boolean));
  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      const res = await apiFetch("/api/admin/accounting/approval-workflow", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(assign) });
      if (res.ok) setStatus({ kind: "ok", msg: tr("saved", lang) });
      else { const b = await res.json().catch(() => ({})); setStatus({ kind: "error", msg: b.error || "Save failed." }); }
    } catch { setStatus({ kind: "error", msg: "Save failed." }); }
  };

  const optionLabel = (a: AdminOption) => a.name || a.email || a.id;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div>
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
        <p className="text-[11px] text-slate-500 mt-0.5">{tr("intro", lang)}</p>
      </div>
      {APPROVAL_STAGES.map((stage, i) => (
        <div key={stage} className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 w-5">{i + 1}.</span>
          <label className="text-xs font-bold text-slate-700 w-40 shrink-0">{STAGE_LABELS[stage][lang] || STAGE_LABELS[stage].en}</label>
          <select
            value={assign[stage]}
            onChange={(e) => setAssign((p) => ({ ...p, [stage]: e.target.value }))}
            className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer"
          >
            <option value="">{tr("choose", lang)}</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id} disabled={chosen.has(a.id) && assign[stage] !== a.id}>{optionLabel(a)}</option>
            ))}
          </select>
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={status.kind === "saving"} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer border-0">{tr("save", lang)}</button>
        {status.kind === "ok" && <span className="text-[11px] font-bold text-emerald-700">{status.msg}</span>}
        {status.kind === "error" && <span className="text-[11px] font-bold text-red-600">{status.msg}</span>}
      </div>
    </div>
  );
}
