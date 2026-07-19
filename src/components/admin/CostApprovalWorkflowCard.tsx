import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, FileCheck2 } from "lucide-react";
import type { Language, CostStatement } from "../../types";
import { apiFetch } from "../../lib/api";
import {
  resolveAccountingStatus, resolveApprovalCycle, pendingStageForStatus, latestStageApprovals,
  APPROVAL_STAGES, type ApprovalStage, type ApprovalHistoryEntry, type CostApprovalWorkflowConfig,
} from "../../lib/costApprovalWorkflow";
import { deriveCostApprovalUiActions } from "../../lib/costApprovalUiActions";

/**
 * Per-statement workflow status + approval progress + actions (PR #6).
 * Read-only mirror of server state; every button calls a server route
 * that re-authorizes independently. Financial editing lock is enforced by
 * the server — this card only reflects it.
 */
const STAGE_LABELS: Record<ApprovalStage, string> = { operations_manager: "Operations Manager", accounts_manager: "Accounts Manager", managing_director: "Managing Director" };
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", pending_operations_approval: "Pending — Operations", pending_accounts_approval: "Pending — Accounts",
  pending_managing_director_approval: "Pending — Managing Director", rejected_for_correction: "Returned for correction",
  final_closed: "FINAL — Approved & Closed", reopen_requested: "Reopening requested", reopened: "Reopened (editing)",
};

interface Props {
  lang: Language;
  statement: CostStatement;
  actor: { sessionId: string; isSuperAdmin: boolean; canWriteCostStatements: boolean };
  onChanged: (next: CostStatement) => void;
}

export default function CostApprovalWorkflowCard({ lang, statement, actor, onChanged }: Props) {
  const [config, setConfig] = useState<CostApprovalWorkflowConfig>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/accounting/approval-workflow");
      if (res.ok) setConfig((await res.json()).config || {});
    } catch { /* card-isolated */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const status = resolveAccountingStatus(statement as any);
  const cycle = resolveApprovalCycle(statement as any);
  const pendingStage = pendingStageForStatus(status);
  const latest = latestStageApprovals(statement.approvalHistory as ApprovalHistoryEntry[] | undefined, cycle);
  const ui = deriveCostApprovalUiActions(statement as any, config, actor);

  const act = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const res = await apiFetch(`/api/cost-statements/${statement.shipmentId}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.statement) onChanged(data.statement);
      else setError(data.error || "Action failed.");
    } catch { setError("Action failed."); }
    finally { setBusy(false); }
  };

  const promptReason = (label: string): string | null => {
    const r = window.prompt(label);
    return r && r.trim() ? r.trim() : null;
  };

  const openFinalPdf = async () => {
    try {
      const res = await apiFetch(`/api/cost-statements/${statement.shipmentId}/final-pdf`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) window.open(data.url, "_blank", "noopener");
      else setError(data.error || "No final PDF available.");
    } catch { setError("Could not open final PDF."); }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-orange-600" /><span>Approval Workflow</span></h3>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${status === "final_closed" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : status === "rejected_for_correction" ? "bg-red-100 text-red-700 border-red-200" : pendingStage ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
          {STATUS_LABELS[status] || status}
        </span>
      </div>
      <p className="text-[10px] text-slate-400 font-semibold">Cycle {cycle}{statement.submittedAt ? ` · submitted ${new Date(statement.submittedAt).toLocaleString()}` : ""}{statement.finalizedAt ? ` · finalized ${new Date(statement.finalizedAt).toLocaleString()}` : ""}</p>

      {/* Three fixed stages */}
      <div className="space-y-1.5">
        {APPROVAL_STAGES.map((stage, i) => {
          const appr = latest[stage];
          const isPending = pendingStage === stage;
          return (
            <div key={stage} className="flex items-center gap-2 text-[11px]">
              <span className="w-4 font-black text-slate-400">{i + 1}</span>
              <span className="w-40 shrink-0 font-bold text-slate-700">{STAGE_LABELS[stage]}</span>
              {appr ? (
                <span className="text-emerald-700 font-bold">✓ {appr.actorName} · {new Date(appr.createdAt).toLocaleDateString()}</span>
              ) : isPending ? (
                <span className="text-amber-700 font-bold">Pending</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        {ui.canSubmit && (status === "draft" || status === "rejected_for_correction" || status === "reopened") && (
          <button disabled={busy} onClick={() => act("/submit")} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Submit for Approval</button>
        )}
        {ui.canApprove && (
          <button disabled={busy} onClick={() => act("/approve", { revision: statement.revision, comment: "" })} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Approve</button>
        )}
        {ui.canReject && (
          <button disabled={busy} onClick={() => { const r = promptReason("Reason for returning this statement for correction:"); if (r) void act("/reject", { reason: r }); }} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Reject for Correction</button>
        )}
        {ui.canRequestReopen && (
          <button disabled={busy} onClick={() => { const r = promptReason("Reason for requesting reopening:"); if (r) void act("/reopen-request", { reason: r }); }} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Request Reopening</button>
        )}
        {ui.canDecideReopen && (
          <>
            <button disabled={busy} onClick={() => act("/reopen-decision", { approve: true })} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Approve Reopening</button>
            <button disabled={busy} onClick={() => act("/reopen-decision", { approve: false })} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Reject Reopening</button>
          </>
        )}
        {ui.canViewFinalPdf && (
          <button onClick={openFinalPdf} className="px-3 py-1.5 bg-white border border-slate-300 hover:border-orange-400 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1"><FileCheck2 className="w-3.5 h-3.5" />View Final PDF</button>
        )}
      </div>
    </div>
  );
}
