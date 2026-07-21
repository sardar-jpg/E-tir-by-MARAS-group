import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, FileCheck2, Check, Clock, Circle, X, UserRound, Lock, RotateCcw } from "lucide-react";
import type { Language, CostStatement } from "../../types";
import { apiFetch } from "../../lib/api";
import {
  resolveAccountingStatus, resolveApprovalCycle, approverPositionForStatus, resolveCycleApprovers,
  stageLabelForPosition, latestStageApprovals, activeReopenCycle, ACTIVE_INVOICE_LOCK_MESSAGE,
  type ApprovalHistoryEntry, type CostApprovalWorkflowConfig, type ReopenCycle,
} from "../../lib/costApprovalWorkflow";
import { deriveCostApprovalUiActions } from "../../lib/costApprovalUiActions";

/**
 * Per-statement workflow status + approval progress + actions (PR #6, Phase 2).
 * Read-only mirror of server state; every button calls a server route that
 * re-authorizes independently. The approver chain is user-based and ordered:
 * this renders the cycle's CAPTURED approvers by position (Approver 1..N), not
 * fixed job titles. Financial editing lock is enforced by the server.
 */
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", rejected_for_correction: "Returned for correction",
  final_closed: "FINAL — Approved & Closed", reopen_requested: "Reopening requested", reopened: "Reopened (editing)",
  finalizing: "Finalizing…",
};

interface AdminOption { id: string; name?: string; email?: string }

interface Props {
  lang: Language;
  statement: CostStatement;
  actor: { sessionId: string; isSuperAdmin: boolean; canWriteCostStatements: boolean };
  /** Phase 3: whether a related customer invoice is active (issued/partially_paid/paid). */
  hasActiveInvoice?: boolean;
  onChanged: (next: CostStatement) => void;
}

export default function CostApprovalWorkflowCard({ lang, statement, actor, hasActiveInvoice = false, onChanged }: Props) {
  const [config, setConfig] = useState<CostApprovalWorkflowConfig>({});
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [cfgRes, adminsRes] = await Promise.all([
        apiFetch("/api/admin/accounting/approval-workflow"),
        apiFetch("/api/admins"),
      ]);
      if (cfgRes.ok) setConfig((await cfgRes.json()).config || {});
      if (adminsRes.ok) setAdmins(await adminsRes.json());
    } catch { /* card-isolated */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const status = resolveAccountingStatus(statement as any);
  const cycle = resolveApprovalCycle(statement as any);
  const pendingPosition = approverPositionForStatus(status);
  const latest = latestStageApprovals(statement.approvalHistory as ApprovalHistoryEntry[] | undefined, cycle);
  const ui = deriveCostApprovalUiActions(statement as any, config, actor, hasActiveInvoice);
  const rejected = status === "rejected_for_correction";
  // Phase 3: the active (pending) reopen approval cycle, if any.
  const reopenCycle: ReopenCycle | null = activeReopenCycle(statement as any);

  // The approver chain shown = this cycle's captured snapshot (legacy in-flight
  // cycles fall back to the resolved current config). Names come from /api/admins.
  const approvers = resolveCycleApprovers(statement as any, config);
  const nameFor = (id: string | undefined) => {
    if (!id) return "—";
    const a = admins.find((x) => x.id === id);
    return a?.name || a?.email || id;
  };
  const statusLabel = STATUS_LABELS[status]
    || (pendingPosition !== null ? `Pending — Approver ${pendingPosition + 1}` : status);

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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[14px] font-black text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-orange-600" /><span>Approval Workflow</span></h3>
        <span className={`px-3 py-1 rounded-md text-[11px] font-black border ${status === "final_closed" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : rejected ? "bg-red-100 text-red-700 border-red-200" : pendingPosition !== null ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
          {statusLabel}
        </span>
      </div>
      <p className="text-[11px] text-slate-400 font-semibold">Cycle {cycle}{statement.submittedAt ? ` · submitted ${new Date(statement.submittedAt).toLocaleString()}` : ""}{statement.finalizedAt ? ` · finalized ${new Date(statement.finalizedAt).toLocaleString()}` : ""}</p>

      {/* Phase 3 — Active Invoice Lock banner. */}
      {hasActiveInvoice && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11.5px] font-semibold text-amber-800 leading-snug">{ACTIVE_INVOICE_LOCK_MESSAGE}</p>
        </div>
      )}

      {/* Phase 3 — Reopen approval chain (user-based, per-cycle snapshot). */}
      {reopenCycle && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-slate-500" />
            <span className="text-[12px] font-black text-slate-700">Reopen Request — Approval {reopenCycle.status === "approved" ? "Complete" : reopenCycle.status === "rejected" ? "Rejected" : "In Progress"}</span>
          </div>
          {reopenCycle.reason && <p className="text-[11px] text-slate-500 italic">Reason: “{reopenCycle.reason}”</p>}
          <div className="relative pl-1">
            {reopenCycle.approverUserIds.map((approverId, i) => {
              const decided = reopenCycle.decisions.find((d) => d.position === i);
              const isPending = reopenCycle.status === "pending" && reopenCycle.currentPosition === i;
              const rState: "approved" | "current" | "rejected" | "pending" =
                decided?.action === "approved" ? "approved" : decided?.action === "rejected" ? "rejected" : isPending ? "current" : "pending";
              const ring = rState === "approved" ? "bg-emerald-500 border-emerald-500 text-white" : rState === "current" ? "bg-blue-600 border-blue-600 text-white" : rState === "rejected" ? "bg-red-500 border-red-500 text-white" : "bg-white border-slate-300 text-slate-400";
              const Icon = rState === "approved" ? Check : rState === "current" ? Clock : rState === "rejected" ? X : Circle;
              return (
                <div key={i} className="flex gap-3 pb-2.5 last:pb-0 items-start">
                  <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${ring}`}><Icon className="w-3.5 h-3.5" /></span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-bold text-slate-700">Approver {i + 1}</span>
                      <span className="text-[11px] text-slate-500 truncate">{decided?.actorName || nameFor(approverId)}</span>
                    </div>
                    {decided && <div className="text-[10.5px] text-slate-400">{decided.action === "approved" ? "Approved" : "Rejected"} · {new Date(decided.createdAt).toLocaleString()}</div>}
                    {decided?.comment && <div className="text-[11px] text-slate-600 italic mt-0.5">“{decided.comment}”</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ordered approver chain — enterprise vertical timeline (user-based) */}
      <div className="relative pl-2">
        {approvers.map((approverId, i) => {
          const appr = latest[stageLabelForPosition(i)];
          const isPending = pendingPosition === i;
          const stageRejected = rejected && isPending;
          const state: "approved" | "current" | "rejected" | "pending" = appr ? "approved" : stageRejected ? "rejected" : isPending ? "current" : "pending";
          const ring = state === "approved" ? "bg-emerald-500 border-emerald-500 text-white" : state === "current" ? "bg-blue-600 border-blue-600 text-white" : state === "rejected" ? "bg-red-500 border-red-500 text-white" : "bg-white border-slate-300 text-slate-400";
          const line = state === "approved" ? "bg-emerald-300" : "bg-slate-200";
          const StageIcon = state === "approved" ? Check : state === "current" ? Clock : state === "rejected" ? X : Circle;
          return (
            <div key={i} className="flex gap-3.5 pb-4 last:pb-0 relative">
              {i < approvers.length - 1 && <span className={`absolute left-[19px] top-10 bottom-0 w-0.5 ${line}`} />}
              <span className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 z-10 ${ring}`}><StageIcon className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-black text-slate-800">Approver {i + 1}</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wide ${state === "approved" ? "bg-emerald-100 text-emerald-700" : state === "current" ? "bg-blue-100 text-blue-700" : state === "rejected" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-400"}`}>
                    {state === "approved" ? "Approved" : state === "current" ? "Current" : state === "rejected" ? "Returned" : "Pending"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-slate-500 mt-1">
                  <UserRound className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <span className="font-semibold text-slate-600 truncate">{appr?.actorName || nameFor(approverId)}</span>
                  {appr?.actorRole && <span className="text-slate-400">· {appr.actorRole}</span>}
                </div>
                {appr && <div className="text-[11px] text-slate-400 mt-0.5">{new Date(appr.createdAt).toLocaleString()}</div>}
                {appr?.comment && <div className="text-[11.5px] text-slate-600 mt-1 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 italic">“{appr.comment}”</div>}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="text-[12px] font-semibold text-red-600">{error}</p>}

      {/* Stage actions (Approve / Reject / Reopen / View Final PDF).
          Submit for Approval intentionally lives ONLY in the workspace top +
          sticky action bars, never inside this timeline. */}
      <div className="flex flex-wrap gap-2 pt-1">
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
            <button disabled={busy} onClick={() => { const note = window.prompt("Optional note for rejecting this reopening:") || ""; void act("/reopen-decision", { approve: false, note: note.trim() }); }} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Reject Reopening</button>
          </>
        )}
        {ui.canViewFinalPdf && (
          <button onClick={openFinalPdf} className="px-3 py-1.5 bg-white border border-slate-300 hover:border-orange-400 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1"><FileCheck2 className="w-3.5 h-3.5" />View Final PDF</button>
        )}
      </div>
    </div>
  );
}
