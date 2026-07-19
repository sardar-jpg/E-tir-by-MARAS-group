/**
 * costApprovalWorkflow.ts — pure decision logic for the staged cost
 * approval workflow, final closure, and controlled reopening
 * (feature/cost-approval-final-pdf, PR #6).
 *
 * The server (server.ts) and the memory fallback BOTH drive every state
 * change through these pure functions, so Firestore mode and memory mode
 * can never diverge. Nothing here reads the clock, Firestore, or the
 * session — callers pass in the authenticated actor and `now`, and every
 * function returns a decision (never throws for an expected rejection).
 *
 * Separation of concerns (do not conflate):
 *   - paymentStatus  = expense-side money state (Unpaid/Partial/Paid) —
 *     existing, unchanged, lives on CostStatement.
 *   - accountingStatus = this workflow/approval state — new, server-owned.
 */

export type AccountingStatus =
  | "draft"
  | "pending_operations_approval"
  | "pending_accounts_approval"
  | "pending_managing_director_approval"
  | "rejected_for_correction"
  | "final_closed"
  | "reopen_requested"
  | "reopened";

/** The three fixed, ordered approval stages. Order is not configurable. */
export const APPROVAL_STAGES = ["operations_manager", "accounts_manager", "managing_director"] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export type ApprovalAction =
  | "submitted"
  | "approved"
  | "rejected"
  | "reopen_requested"
  | "reopen_approved"
  | "reopen_rejected"
  | "closed";

export interface ApprovalHistoryEntry {
  id: string;
  cycleNumber: number;
  stage: ApprovalStage | "reopen" | "system";
  action: ApprovalAction;
  actorId: string;
  actorName: string;
  actorRole: string;
  statementRevision: number;
  comment: string;
  createdAt: string;
}

/** Per-admin-id assignment of the three stages, stored in settings. */
export interface CostApprovalWorkflowConfig {
  operations_manager?: string;
  accounts_manager?: string;
  managing_director?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface FinalPdfVersion {
  cycleNumber: number;
  statementRevision: number;
  pdfUrl: string;
  storagePath: string;
  fileName: string;
  generatedAt: string;
  generatedBy: string;
  closedAt: string;
  approvalsSnapshot: ApprovalHistoryEntry[];
}

/** The accounting-workflow fields layered onto a CostStatement. */
export interface CostApprovalState {
  accountingStatus?: AccountingStatus;
  approvalCycle?: number;
  approvalHistory?: ApprovalHistoryEntry[];
  submittedAt?: string;
  submittedBy?: string;
  submittedRevision?: number;
  finalizedAt?: string;
  finalizedBy?: string;
  finalPdfUrl?: string;
  finalPdfStoragePath?: string;
  finalPdfFileName?: string;
  finalPdfGeneratedAt?: string;
  finalPdfGeneratedBy?: string;
  finalPdfStatementRevision?: number;
  finalVersions?: FinalPdfVersion[];
  reopenRequestedBy?: string;
  reopenRequestedAt?: string;
  reopenReason?: string;
}

export interface WorkflowActor {
  id: string;
  name: string;
  /** adminType or a stage label; recorded verbatim in history. */
  role: string;
}

// ── Legacy compatibility ────────────────────────────────────────────────
/**
 * A statement with no accountingStatus predates this feature. It is
 * treated as `draft` — NEVER silently final. paymentStatus semantics are
 * untouched.
 */
export function resolveAccountingStatus(state: CostApprovalState | undefined | null): AccountingStatus {
  return state?.accountingStatus || "draft";
}

export function resolveApprovalCycle(state: CostApprovalState | undefined | null): number {
  const c = state?.approvalCycle;
  return typeof c === "number" && c >= 1 ? c : 1;
}

// ── Settings validation ──────────────────────────────────────────────────
export interface WorkflowConfigValidationInput {
  operations_manager?: unknown;
  accounts_manager?: unknown;
  /** ids of currently ACTIVE, selectable internal admin accounts. */
  activeAdminIds: string[];
  managing_director?: unknown;
}

export type WorkflowConfigValidationResult =
  | { ok: true; config: { operations_manager: string; accounts_manager: string; managing_director: string } }
  | { ok: false; error: string };

/**
 * All three stages must be assigned, each to a distinct, currently-active
 * admin. Used both when SAVING settings and (via isWorkflowConfigUsable)
 * before allowing a submission.
 */
export function validateWorkflowConfig(input: WorkflowConfigValidationInput): WorkflowConfigValidationResult {
  const ops = typeof input.operations_manager === "string" ? input.operations_manager.trim() : "";
  const acc = typeof input.accounts_manager === "string" ? input.accounts_manager.trim() : "";
  const md = typeof input.managing_director === "string" ? input.managing_director.trim() : "";
  if (!ops || !acc || !md) {
    return { ok: false, error: "All three approval stages must be assigned." };
  }
  const active = new Set(input.activeAdminIds);
  for (const [label, id] of [["Operations Manager", ops], ["Accounts Manager", acc], ["Managing Director", md]] as const) {
    if (!active.has(id)) {
      return { ok: false, error: `The ${label} assignment is not an active employee.` };
    }
  }
  if (new Set([ops, acc, md]).size !== 3) {
    return { ok: false, error: "The same person cannot hold more than one approval stage." };
  }
  return { ok: true, config: { operations_manager: ops, accounts_manager: acc, managing_director: md } };
}

/** True when a stored config is complete AND all three assignees are still active. */
export function isWorkflowConfigUsable(config: CostApprovalWorkflowConfig | undefined | null, activeAdminIds: string[]): boolean {
  return validateWorkflowConfig({
    operations_manager: config?.operations_manager,
    accounts_manager: config?.accounts_manager,
    managing_director: config?.managing_director,
    activeAdminIds,
  }).ok;
}

// ── Stage / status helpers ───────────────────────────────────────────────
const PENDING_STATUS_FOR_STAGE: Record<ApprovalStage, AccountingStatus> = {
  operations_manager: "pending_operations_approval",
  accounts_manager: "pending_accounts_approval",
  managing_director: "pending_managing_director_approval",
};

/** Which stage a pending status is waiting on, or null if not pending. */
export function pendingStageForStatus(status: AccountingStatus): ApprovalStage | null {
  if (status === "pending_operations_approval") return "operations_manager";
  if (status === "pending_accounts_approval") return "accounts_manager";
  if (status === "pending_managing_director_approval") return "managing_director";
  return null;
}

/** The assigned admin id for a stage, from the stored config. */
export function assigneeForStage(config: CostApprovalWorkflowConfig, stage: ApprovalStage): string | undefined {
  return config[stage];
}

/** Editing financial fields is allowed only in draft/rejected/reopened. */
export function isFinancialEditingAllowed(status: AccountingStatus): boolean {
  return status === "draft" || status === "rejected_for_correction" || status === "reopened";
}

/** A closed statement is immutable (no edit, delete, resubmit, or re-close). */
export function isImmutable(status: AccountingStatus): boolean {
  return status === "final_closed";
}

// ── Decision functions ───────────────────────────────────────────────────
export type WorkflowDecision =
  | { ok: true }
  | { ok: false; code: string; error: string };

/** Submit-for-approval preconditions (config usability checked separately by the caller). */
export function canSubmitForApproval(status: AccountingStatus): WorkflowDecision {
  if (isFinancialEditingAllowed(status)) return { ok: true };
  if (status === "final_closed") return { ok: false, code: "already_closed", error: "A finalized statement cannot be resubmitted." };
  return { ok: false, code: "already_pending", error: "This statement is already in the approval workflow." };
}

/**
 * Approve a stage. Rejects: wrong stage, wrong approver, stale revision,
 * not-currently-pending. `actorId` is the authenticated session id;
 * `submittedRevision` is what the approver is acting on (the current
 * statement revision as read by the server).
 */
export function canApproveStage(params: {
  status: AccountingStatus;
  config: CostApprovalWorkflowConfig;
  actorId: string;
  actingRevision: number;
  storedRevision: number;
}): WorkflowDecision {
  const stage = pendingStageForStatus(params.status);
  if (!stage) return { ok: false, code: "not_pending", error: "This statement is not awaiting approval." };
  if (params.actingRevision !== params.storedRevision) {
    return { ok: false, code: "stale_revision", error: "This statement changed since it was loaded. Reload and try again." };
  }
  if (assigneeForStage(params.config, stage) !== params.actorId) {
    return { ok: false, code: "wrong_approver", error: "You are not the assigned approver for this stage." };
  }
  return { ok: true };
}

/** The status a stage moves to after approval (last stage → final_closed handled by caller). */
export function nextStatusAfterApproval(stage: ApprovalStage): AccountingStatus {
  if (stage === "operations_manager") return PENDING_STATUS_FOR_STAGE.accounts_manager;
  if (stage === "accounts_manager") return PENDING_STATUS_FOR_STAGE.managing_director;
  return "final_closed";
}

/** The next stage to notify after an approval, or null when finalizing. */
export function nextStageAfterApproval(stage: ApprovalStage): ApprovalStage | null {
  if (stage === "operations_manager") return "accounts_manager";
  if (stage === "accounts_manager") return "managing_director";
  return null;
}

export function canRejectStage(params: {
  status: AccountingStatus;
  config: CostApprovalWorkflowConfig;
  actorId: string;
  reason: string;
}): WorkflowDecision {
  const stage = pendingStageForStatus(params.status);
  if (!stage) return { ok: false, code: "not_pending", error: "This statement is not awaiting approval." };
  if (assigneeForStage(params.config, stage) !== params.actorId) {
    return { ok: false, code: "wrong_approver", error: "You are not the assigned approver for this stage." };
  }
  if (!params.reason || !params.reason.trim()) {
    return { ok: false, code: "reason_required", error: "A rejection reason is required." };
  }
  return { ok: true };
}

export function canRequestReopen(status: AccountingStatus, reason: string): WorkflowDecision {
  if (status !== "final_closed") return { ok: false, code: "not_closed", error: "Only a finalized statement can be reopened." };
  if (!reason || !reason.trim()) return { ok: false, code: "reason_required", error: "A reopening reason is required." };
  return { ok: true };
}

/**
 * Decide a reopening request. `deciderId` must NOT equal the requester —
 * the requester can never approve their own request (separation of duty).
 */
export function canDecideReopen(params: {
  status: AccountingStatus;
  requesterId: string | undefined;
  deciderId: string;
}): WorkflowDecision {
  if (params.status !== "reopen_requested") return { ok: false, code: "not_reopen_requested", error: "There is no pending reopening request." };
  if (params.requesterId && params.requesterId === params.deciderId) {
    return { ok: false, code: "self_decision", error: "You cannot decide your own reopening request." };
  }
  return { ok: true };
}

// ── History construction (append-only) ───────────────────────────────────
export function appendHistory(
  existing: ApprovalHistoryEntry[] | undefined,
  entry: Omit<ApprovalHistoryEntry, "id" | "createdAt">,
  now: string,
  idSuffix: string
): ApprovalHistoryEntry[] {
  const record: ApprovalHistoryEntry = {
    ...entry,
    id: `appr-${Date.parse(now) || 0}-${idSuffix}`,
    createdAt: now,
    comment: entry.comment || "",
  };
  return [...(existing || []), record];
}

/** Snapshot of the current cycle's approvals, for embedding in a FinalPdfVersion. */
export function approvalsForCycle(history: ApprovalHistoryEntry[] | undefined, cycleNumber: number): ApprovalHistoryEntry[] {
  return (history || []).filter((h) => h.cycleNumber === cycleNumber);
}

/** The most recent approval entry per stage within a cycle (for PDF/UI display). */
export function latestStageApprovals(
  history: ApprovalHistoryEntry[] | undefined,
  cycleNumber: number
): Record<ApprovalStage, ApprovalHistoryEntry | null> {
  const result: Record<ApprovalStage, ApprovalHistoryEntry | null> = {
    operations_manager: null,
    accounts_manager: null,
    managing_director: null,
  };
  for (const h of history || []) {
    if (h.cycleNumber !== cycleNumber || h.action !== "approved") continue;
    if (h.stage === "operations_manager" || h.stage === "accounts_manager" || h.stage === "managing_director") {
      result[h.stage] = h;
    }
  }
  return result;
}

/** Sanitize a shipment number into a safe filename fragment. */
export function buildFinalPdfFileName(shipmentNumber: string, revision: number): string {
  const safe = (shipmentNumber || "unknown").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
  return `Cost-Statement_${safe}_Final_Rev-${revision}.pdf`;
}
