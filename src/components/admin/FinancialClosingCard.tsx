import { useState, useEffect, useCallback } from "react";
import { Lock, LockOpen, ShieldCheck, Check, Clock, Circle, X, RotateCcw, History } from "lucide-react";
import type { Language, CostStatement } from "../../types";
import { apiFetch } from "../../lib/api";
import type { ReopenCycle } from "../../lib/costApprovalWorkflow";
import { canDecideReopenPosition, approverForPosition } from "../../lib/costApprovalWorkflow";

/**
 * Accounting Phase 6 — Financial Closing card. Shows the shipment's official
 * Financial Status (Open / Closed / Reopened), the close-readiness reason,
 * and the buttons: Financial Close, Request Financial Reopen, and the reopen
 * approval chain (decided by its captured approvers). All figures + actions
 * are server-authoritative; every button hits a re-authorizing route.
 */
interface FinancialStatusResponse {
  financialStatus: "financial_open" | "financial_closed" | "financial_reopened";
  canClose: boolean;
  closeBlockedReason: { code: string; error: string } | null;
  financialClosedAt?: string;
  financialClosedBy?: string;
  financialCloseReason?: string;
  financialReopenedAt?: string;
  financialReopenedBy?: string;
  financialReopenCycles: ReopenCycle[];
}

interface AdminOption { id: string; name?: string; email?: string }

const STATUS_META: Record<string, { label: string; cls: string; Icon: typeof Lock }> = {
  financial_open: { label: "Financial Open", cls: "bg-slate-100 text-slate-600 border-slate-200", Icon: LockOpen },
  financial_closed: { label: "Financial Closed", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: Lock },
  financial_reopened: { label: "Financial Reopened", cls: "bg-amber-100 text-amber-700 border-amber-200", Icon: LockOpen },
};

export default function FinancialClosingCard({ lang: _lang, statement, actor, onChanged }: {
  lang: Language;
  statement: CostStatement;
  actor: { sessionId: string; isSuperAdmin: boolean; canWriteCostStatements: boolean };
  onChanged: (next: CostStatement) => void;
}) {
  const [data, setData] = useState<FinancialStatusResponse | null>(null);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const [statusRes, adminsRes] = await Promise.all([
        apiFetch(`/api/cost-statements/${statement.shipmentId}/financial-status`),
        apiFetch("/api/admins"),
      ]);
      if (statusRes.ok) setData(await statusRes.json());
      if (adminsRes.ok) setAdmins(await adminsRes.json());
    } catch { /* card-isolated */ }
  }, [statement.shipmentId]);
  useEffect(() => { void load(); }, [load]);

  const nameFor = (id: string | undefined) => {
    if (!id) return "—";
    const a = admins.find((x) => x.id === id);
    return a?.name || a?.email || id;
  };

  const act = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const res = await apiFetch(`/api/cost-statements/${statement.shipmentId}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.statement) { onChanged(d.statement); await load(); }
      else setError(d.error || "Action failed.");
    } catch { setError("Action failed."); } finally { setBusy(false); }
  };

  const promptReason = (label: string): string | null => {
    const r = window.prompt(label);
    return r && r.trim() ? r.trim() : null;
  };

  if (!data) return null;
  const meta = STATUS_META[data.financialStatus] || STATUS_META.financial_open;
  const activeCycle = (data.financialReopenCycles || []).slice().reverse().find((c) => c.status === "pending") || null;
  const canDecide = !!activeCycle && canDecideReopenPosition({ cycle: activeCycle, actorId: actor.sessionId }).ok;
  const isReopenApprover = !!activeCycle && approverForPosition(activeCycle.approverUserIds, activeCycle.currentPosition) === actor.sessionId;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3.5 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[14px] font-black text-slate-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-orange-600" /><span>Financial Closing</span></h3>
        <span className={`px-3 py-1 rounded-md text-[11px] font-black border flex items-center gap-1.5 ${meta.cls}`}><meta.Icon className="w-3.5 h-3.5" />{meta.label}</span>
      </div>

      {/* Metadata */}
      {data.financialClosedAt && (
        <p className="text-[11px] text-slate-500 font-semibold">Closed {new Date(data.financialClosedAt).toLocaleString()} by {nameFor(data.financialClosedBy)}{data.financialCloseReason ? ` · “${data.financialCloseReason}”` : ""}</p>
      )}
      {data.financialReopenedAt && (
        <p className="text-[11px] text-amber-600 font-semibold">Reopened {new Date(data.financialReopenedAt).toLocaleString()} by {nameFor(data.financialReopenedBy)}</p>
      )}

      {/* Close readiness (only meaningful while not closed) */}
      {data.financialStatus !== "financial_closed" && data.closeBlockedReason && (
        <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{data.closeBlockedReason.error}</p>
      )}
      {data.financialStatus === "financial_closed" && !activeCycle && (
        <p className="text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />All accounting editing is frozen. Request a Financial Reopen to make changes.</p>
      )}

      {/* Financial Reopen approval chain */}
      {activeCycle && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="flex items-center gap-2"><RotateCcw className="w-4 h-4 text-slate-500" /><span className="text-[12px] font-black text-slate-700">Financial Reopen — In Progress</span></div>
          {activeCycle.reason && <p className="text-[11px] text-slate-500 italic">Reason: “{activeCycle.reason}”</p>}
          {activeCycle.approverUserIds.map((approverId, i) => {
            const decided = activeCycle.decisions.find((d) => d.position === i);
            const pending = activeCycle.currentPosition === i;
            const state: "approved" | "current" | "pending" = decided?.action === "approved" ? "approved" : pending ? "current" : "pending";
            const ring = state === "approved" ? "bg-emerald-500 border-emerald-500 text-white" : state === "current" ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-300 text-slate-400";
            const Icon = state === "approved" ? Check : state === "current" ? Clock : Circle;
            return (
              <div key={i} className="flex gap-2.5 items-start">
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${ring}`}><Icon className="w-3 h-3" /></span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <span className="text-[12px] font-bold text-slate-700">Approver {i + 1}</span>
                  <span className="text-[11px] text-slate-500 ml-2">{decided?.actorName || nameFor(approverId)}</span>
                  {decided && <div className="text-[10.5px] text-slate-400">{decided.action === "approved" ? "Approved" : "Rejected"} · {new Date(decided.createdAt).toLocaleString()}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-[12px] font-semibold text-red-600">{error}</p>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {actor.canWriteCostStatements && data.financialStatus !== "financial_closed" && (
          <button disabled={busy || !data.canClose} title={data.closeBlockedReason?.error} onClick={() => { const r = window.prompt("Optional reason for financial closing:") || ""; void act("/financial-close", { reason: r.trim() }); }} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />Financial Close</button>
        )}
        {actor.canWriteCostStatements && data.financialStatus === "financial_closed" && !activeCycle && (
          <button disabled={busy} onClick={() => { const r = promptReason("Reason for requesting Financial Reopen:"); if (r) void act("/financial-reopen-request", { reason: r }); }} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1.5"><LockOpen className="w-3.5 h-3.5" />Request Financial Reopen</button>
        )}
        {canDecide && isReopenApprover && (
          <>
            <button disabled={busy} onClick={() => act("/financial-reopen-decision", { approve: true })} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Approve Financial Reopen</button>
            <button disabled={busy} onClick={() => { const note = window.prompt("Optional note for rejecting:") || ""; void act("/financial-reopen-decision", { approve: false, note: note.trim() }); }} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">Reject</button>
          </>
        )}
        {(data.financialReopenCycles || []).length > 0 && (
          <button onClick={() => setShowHistory((s) => !s)} className="px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><History className="w-3.5 h-3.5" />History</button>
        )}
      </div>

      {/* History of past financial-reopen cycles */}
      {showHistory && (data.financialReopenCycles || []).length > 0 && (
        <div className="space-y-1.5 pt-1">
          {(data.financialReopenCycles || []).map((c) => (
            <div key={c.reopenCycleNumber} className="text-[11px] text-slate-500 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5">
              <span className="font-bold text-slate-700">Reopen #{c.reopenCycleNumber}</span> · {c.status === "approved" ? "Approved" : c.status === "rejected" ? "Rejected" : "Pending"}
              {c.reason ? ` · “${c.reason}”` : ""}
              {c.decisions.length > 0 && <span className="block mt-0.5">{c.decisions.map((d) => `${d.action === "approved" ? "✓" : "✗"} ${nameFor(d.approverUserId)}`).join("  ·  ")}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
