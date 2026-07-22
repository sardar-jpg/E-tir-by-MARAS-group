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
  // Transient, server-owned state between the Managing Director's approval
  // (committed atomically) and the final PDF being generated + stored +
  // the closure committed. Locks editing like a pending state; a crash
  // here leaves the statement recoverable (a retry resumes finalization
  // idempotently). See finalizationKeyFor / decideFinalization.
  | "finalizing"
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

/**
 * Cost-approval workflow configuration, stored in settings.
 *
 * Phase 2 (user-based approval chains): the business configuration is an
 * ORDERED list of 2–3 registered user ids in `approverUserIds` — Approver 1
 * and Approver 2 are required, Approver 3 is optional, and the array order is
 * the approval order. The legacy fixed-title fields (operations_manager /
 * accounts_manager / managing_director) remain OPTIONAL only so previously
 * saved configs keep resolving (resolveConfiguredApprovers maps them to an
 * ordered list); new saves write `approverUserIds`.
 */
export interface CostApprovalWorkflowConfig {
  /** Phase 2: ordered approver user ids (2 required, 3rd optional). */
  approverUserIds?: string[];
  /** @deprecated legacy fixed-title assignment (read-only compatibility). */
  operations_manager?: string;
  /** @deprecated legacy fixed-title assignment (read-only compatibility). */
  accounts_manager?: string;
  /** @deprecated legacy fixed-title assignment (read-only compatibility). */
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
  /**
   * Phase 2: the ordered approver user ids captured for the CURRENT approval
   * cycle at submit time. Once set, approve/reject read this snapshot — never
   * the live settings — so changing Accounting Settings can never alter an
   * in-progress cycle. Absent on legacy in-flight cycles (see
   * resolveCycleApprovers, which captures it once for those).
   */
  cycleApproverUserIds?: string[];
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
  /** Transient finalization reservation identity (see decideFinalization). */
  finalizationKey?: string;
  finalizingAt?: string;
  finalizingBy?: string;
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

// ── Idempotent finalization ──────────────────────────────────────────────
/**
 * Deterministic finalization identity: one Managing-Director closure is
 * uniquely identified by shipment + cycle + revision. Retrying the same
 * finalization (crash recovery, duplicate request) resolves to the SAME
 * key, so the commit step can dedupe and never append a version twice or
 * store two official PDFs for one approval.
 */
export function finalizationKeyFor(shipmentId: string, cycle: number, revision: number): string {
  return `${shipmentId}:${cycle}:${revision}`;
}

/** True when a final version for this cycle+revision already exists (dedupe guard). */
export function hasFinalVersionFor(versions: FinalPdfVersion[] | undefined, cycle: number, revision: number): boolean {
  return (versions || []).some((v) => v.cycleNumber === cycle && v.statementRevision === revision);
}

export type FinalizationBeginDecision =
  /** MD stage is validly pending — begin finalization (move to `finalizing`). */
  | { action: "begin"; cycle: number; revision: number; key: string }
  /** Already `finalizing` with the same key by the same approver — a retry; resume PDF+commit. */
  | { action: "resume"; cycle: number; revision: number; key: string }
  /** Already closed for this key — idempotent no-op. */
  | { action: "already_closed" }
  | { action: "reject"; code: string; error: string };

/**
 * Decide, from the CURRENT (transaction-fresh) statement, whether a
 * Managing-Director approval should begin finalization, resume a crashed
 * one, or is a no-op/rejection. `stmt` is the doc read inside the
 * transaction — never a value loaded earlier.
 */
export function decideFinalization(params: {
  status: AccountingStatus;
  config: CostApprovalWorkflowConfig;
  actorId: string;
  actingRevision: number;
  storedRevision: number;
  cycle: number;
  existingKey: string | undefined;
  shipmentId: string;
}): FinalizationBeginDecision {
  const key = finalizationKeyFor(params.shipmentId, params.cycle, params.storedRevision);
  if (params.status === "final_closed") return { action: "already_closed" };
  if (params.status === "finalizing") {
    // Only the assigned MD who owns this exact finalization may resume it.
    if (params.existingKey === key && assigneeForStage(params.config, "managing_director") === params.actorId) {
      return { action: "resume", cycle: params.cycle, revision: params.storedRevision, key };
    }
    return { action: "reject", code: "finalizing_in_progress", error: "This statement is being finalized. Please retry in a moment." };
  }
  // Otherwise it must be a valid, current MD-stage approval.
  const guard = canApproveStage({ status: params.status, config: params.config, actorId: params.actorId, actingRevision: params.actingRevision, storedRevision: params.storedRevision });
  if (!guard.ok) return { action: "reject", code: guard.code, error: guard.error };
  if (pendingStageForStatus(params.status) !== "managing_director") {
    return { action: "reject", code: "not_final_stage", error: "This statement is not at the Managing Director stage." };
  }
  return { action: "begin", cycle: params.cycle, revision: params.storedRevision, key };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — Configurable user-based approvers + per-cycle snapshot
//
// The approval chain is an ORDERED list of 2–3 registered user ids. There are
// no fixed job titles: an "approver position" is just an index into that list.
// The three internal pending statuses above are reused purely as POSITIONAL
// slots (position 0/1/2), so the finalization/PDF/edit-lock machinery and the
// stored AccountingStatus enum are unchanged — only who approves each position
// and when the chain completes are now driven by the captured list.
// ═══════════════════════════════════════════════════════════════════════════

export const MIN_APPROVERS = 2;
export const MAX_APPROVERS = 3;

/** Ordered pending statuses — index 0/1/2 is the approver position it awaits. */
const POSITION_PENDING_STATUSES: readonly AccountingStatus[] = [
  "pending_operations_approval",
  "pending_accounts_approval",
  "pending_managing_director_approval",
];

/** The pending AccountingStatus for a zero-based approver position (0/1/2). */
export function statusForApproverPosition(position: number): AccountingStatus {
  return POSITION_PENDING_STATUSES[position] ?? POSITION_PENDING_STATUSES[0];
}

/** The zero-based approver position a pending status awaits, or null if not pending. */
export function approverPositionForStatus(status: AccountingStatus): number | null {
  const i = POSITION_PENDING_STATUSES.indexOf(status);
  return i >= 0 ? i : null;
}

/** The positional history/stage label for a position (internal PDF/UI compatibility). */
export function stageLabelForPosition(position: number): ApprovalStage {
  return APPROVAL_STAGES[position] ?? APPROVAL_STAGES[0];
}

/** The approver user id captured for a position in a cycle's ordered snapshot. */
export function approverForPosition(cycleApprovers: string[], position: number): string | undefined {
  return cycleApprovers[position];
}

/**
 * The status after approving `position` of a `total`-approver chain: the next
 * position's pending status, or `final_closed` when the last position approved.
 */
export function nextStatusAfterPosition(position: number, total: number): AccountingStatus {
  return position >= total - 1 ? "final_closed" : statusForApproverPosition(position + 1);
}

/** The next approver position to notify, or null when the just-approved one was last. */
export function nextPositionToNotify(position: number, total: number): number | null {
  return position >= total - 1 ? null : position + 1;
}

// ── User-based configuration + validation ────────────────────────────────
/**
 * The ordered approver list a config resolves to. Phase 2 `approverUserIds`
 * is authoritative; a legacy config carrying only the three fixed-title fields
 * maps to [operations, accounts, managing] in order (compatibility read only).
 */
export function resolveConfiguredApprovers(config: CostApprovalWorkflowConfig | undefined | null): string[] {
  const list = config?.approverUserIds;
  if (Array.isArray(list) && list.length > 0) {
    return list.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  }
  return [config?.operations_manager, config?.accounts_manager, config?.managing_director]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
}

export interface ApproverListValidationInput {
  approverUserIds: unknown;
  /** ids of currently ACTIVE, selectable internal admin accounts. */
  activeAdminIds: string[];
}
export type ApproverListValidationResult =
  | { ok: true; approverUserIds: string[] }
  | { ok: false; error: string };

/**
 * Validate an ordered approver list: 2 or 3 distinct, currently-active users.
 * Approver 1 and Approver 2 are required; Approver 3 is optional. Used both
 * when SAVING settings and (via isApproverConfigUsable) before a submission.
 */
export function validateApproverList(input: ApproverListValidationInput): ApproverListValidationResult {
  const raw = Array.isArray(input.approverUserIds) ? input.approverUserIds : [];
  const ids = raw.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length > 0);
  if (ids.length < MIN_APPROVERS) {
    return { ok: false, error: "At least two approvers (Approver 1 and Approver 2) must be selected." };
  }
  if (ids.length > MAX_APPROVERS) {
    return { ok: false, error: "A maximum of three approvers can be configured." };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "The same user cannot be selected more than once." };
  }
  const active = new Set(input.activeAdminIds);
  for (let i = 0; i < ids.length; i++) {
    if (!active.has(ids[i])) {
      return { ok: false, error: `Approver ${i + 1} is not an active employee.` };
    }
  }
  return { ok: true, approverUserIds: ids };
}

/** True when a stored config resolves to a valid, all-active approver list. */
export function isApproverConfigUsable(config: CostApprovalWorkflowConfig | undefined | null, activeAdminIds: string[]): boolean {
  return validateApproverList({ approverUserIds: resolveConfiguredApprovers(config), activeAdminIds }).ok;
}

// ── Per-cycle snapshot ────────────────────────────────────────────────────
/** True when this cycle already carries a captured approver snapshot (≥2 ids). */
export function hasCycleApproverSnapshot(state: CostApprovalState | undefined | null): boolean {
  const snap = state?.cycleApproverUserIds;
  return Array.isArray(snap) && snap.filter((x) => typeof x === "string" && x.length > 0).length >= MIN_APPROVERS;
}

/**
 * The ordered approver list an ACTIVE cycle must use. Prefers the snapshot
 * captured at submit; for a legacy in-flight cycle with NO snapshot it falls
 * back to the resolved current config ONCE (the caller then persists that list
 * onto the cycle so later steps stop reading live settings). Never rereads
 * changed settings for a cycle that already has a snapshot.
 */
export function resolveCycleApprovers(
  state: CostApprovalState | undefined | null,
  fallbackConfig: CostApprovalWorkflowConfig | undefined | null
): string[] {
  if (hasCycleApproverSnapshot(state)) {
    return (state!.cycleApproverUserIds as string[]).filter((x) => typeof x === "string" && x.length > 0);
  }
  return resolveConfiguredApprovers(fallbackConfig);
}

// ── Cycle (snapshot) based decisions ──────────────────────────────────────
/**
 * Approve the currently-pending position using the CYCLE's captured approver
 * list. Rejects: not pending, position beyond the captured list, stale
 * revision, or an actor who is not the captured approver for that position.
 */
export function canApproveCyclePosition(params: {
  status: AccountingStatus;
  cycleApprovers: string[];
  actorId: string;
  actingRevision: number;
  storedRevision: number;
}): WorkflowDecision {
  const position = approverPositionForStatus(params.status);
  if (position === null || position >= params.cycleApprovers.length) {
    return { ok: false, code: "not_pending", error: "This statement is not awaiting approval." };
  }
  if (params.actingRevision !== params.storedRevision) {
    return { ok: false, code: "stale_revision", error: "This statement changed since it was loaded. Reload and try again." };
  }
  if (approverForPosition(params.cycleApprovers, position) !== params.actorId) {
    return { ok: false, code: "wrong_approver", error: "You are not the assigned approver for this stage." };
  }
  return { ok: true };
}

export function canRejectCyclePosition(params: {
  status: AccountingStatus;
  cycleApprovers: string[];
  actorId: string;
  reason: string;
}): WorkflowDecision {
  const position = approverPositionForStatus(params.status);
  if (position === null || position >= params.cycleApprovers.length) {
    return { ok: false, code: "not_pending", error: "This statement is not awaiting approval." };
  }
  if (approverForPosition(params.cycleApprovers, position) !== params.actorId) {
    return { ok: false, code: "wrong_approver", error: "You are not the assigned approver for this stage." };
  }
  if (!params.reason || !params.reason.trim()) {
    return { ok: false, code: "reason_required", error: "A rejection reason is required." };
  }
  return { ok: true };
}

/**
 * Cycle-aware finalization decision (mirrors decideFinalization, but the
 * finalizing position is the LAST approver in the captured list — position 1
 * for a two-approver chain, position 2 for a three-approver chain).
 */
export function decideCycleFinalization(params: {
  status: AccountingStatus;
  cycleApprovers: string[];
  actorId: string;
  actingRevision: number;
  storedRevision: number;
  cycle: number;
  existingKey: string | undefined;
  shipmentId: string;
}): FinalizationBeginDecision {
  const key = finalizationKeyFor(params.shipmentId, params.cycle, params.storedRevision);
  const lastPosition = params.cycleApprovers.length - 1;
  if (params.status === "final_closed") return { action: "already_closed" };
  if (params.status === "finalizing") {
    // Only the captured last approver who owns this exact finalization may resume it.
    if (params.existingKey === key && approverForPosition(params.cycleApprovers, lastPosition) === params.actorId) {
      return { action: "resume", cycle: params.cycle, revision: params.storedRevision, key };
    }
    return { action: "reject", code: "finalizing_in_progress", error: "This statement is being finalized. Please retry in a moment." };
  }
  const guard = canApproveCyclePosition({
    status: params.status, cycleApprovers: params.cycleApprovers, actorId: params.actorId,
    actingRevision: params.actingRevision, storedRevision: params.storedRevision,
  });
  if (!guard.ok) return { action: "reject", code: guard.code, error: guard.error };
  if (approverPositionForStatus(params.status) !== lastPosition) {
    return { action: "reject", code: "not_final_stage", error: "This statement is not at the final approval stage." };
  }
  return { action: "begin", cycle: params.cycle, revision: params.storedRevision, key };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — Issued-Invoice Lock + Reopen Approval Chain
//
// A finalized Cost Statement is corrected only through a controlled sequence:
//   active invoice → LOCKED → cancel invoice → request reopen (reason) →
//   sequential reopen approval chain (same user-based Phase 2 approvers,
//   captured per reopen cycle) → editing enabled → resubmit → normal chain.
// The reopen chain reuses the ordered-approver model but stores its own
// per-cycle snapshot so settings changes never touch an active reopen cycle.
// ═══════════════════════════════════════════════════════════════════════════

/** Shown when a financial edit / reopen request is blocked by an active invoice. */
export const ACTIVE_INVOICE_LOCK_MESSAGE =
  "This Cost Statement is locked because an active issued customer invoice exists. Cancel the invoice before requesting to reopen the Cost Statement.";

/** Phase 4: shown when a reopen request is blocked by active vendor payments. */
export const ACTIVE_VENDOR_PAYMENT_LOCK_MESSAGE =
  "This Cost Statement cannot be reopened because active Vendor Payments exist. Cancel the Vendor Payments before requesting to reopen the Cost Statement.";

export interface ReopenDecisionEntry {
  /** Zero-based position in this reopen cycle's approver list. */
  position: number;
  approverUserId: string;
  action: "approved" | "rejected";
  actorId: string;
  actorName: string;
  comment: string;
  createdAt: string;
}

export interface ReopenCycle {
  reopenCycleNumber: number;
  /** Ordered approver user ids captured at request time (2 or 3). */
  approverUserIds: string[];
  /** Zero-based pending approver position. */
  currentPosition: number;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
  reason: string;
  decisions: ReopenDecisionEntry[];
  decidedAt?: string;
}

/** The active (pending) reopen cycle, or null. The last pending cycle wins. */
export function activeReopenCycle(state: (CostApprovalState & { reopenCycles?: ReopenCycle[] }) | undefined | null): ReopenCycle | null {
  const cycles = state?.reopenCycles;
  if (!Array.isArray(cycles)) return null;
  for (let i = cycles.length - 1; i >= 0; i--) {
    if (cycles[i]?.status === "pending") return cycles[i];
  }
  return null;
}

/** True when a reopen request is already pending for this statement. */
export function hasPendingReopen(state: (CostApprovalState & { reopenCycles?: ReopenCycle[] }) | undefined | null): boolean {
  if (activeReopenCycle(state) !== null) return true;
  // Legacy in-flight reopen (status reopen_requested, no reopenCycles snapshot).
  return resolveAccountingStatus(state) === "reopen_requested";
}

/**
 * Phase 3/4 eligibility to REQUEST a reopen. A reopen may be requested only when:
 *   - no related customer invoice is active (issued/partially_paid/paid),
 *   - no active vendor payment exists (Phase 4 — approved cost amounts must
 *     never change beneath recorded payments; cancel the payments first),
 *   - no reopen request is already pending,
 *   - the statement is finalized (final_closed) — an already editable/draft
 *     statement is not eligible,
 *   - a non-empty reason is given.
 * Both financial locks are independent; neither weakens the other.
 */
export function canRequestReopenChain(params: {
  status: AccountingStatus;
  hasActiveInvoice: boolean;
  hasPendingReopen: boolean;
  reason: string;
  /** Phase 4: whether any active (non-reversed) vendor payment exists. */
  hasActiveVendorPayment?: boolean;
}): WorkflowDecision {
  if (params.hasActiveInvoice) return { ok: false, code: "active_invoice_lock", error: ACTIVE_INVOICE_LOCK_MESSAGE };
  if (params.hasActiveVendorPayment) return { ok: false, code: "active_vendor_payment_lock", error: ACTIVE_VENDOR_PAYMENT_LOCK_MESSAGE };
  if (params.hasPendingReopen) return { ok: false, code: "reopen_already_pending", error: "A reopening request is already pending for this statement." };
  if (params.status !== "final_closed") return { ok: false, code: "not_closed", error: "Only a finalized statement can be reopened." };
  if (!params.reason || !params.reason.trim()) return { ok: false, code: "reason_required", error: "A reopening reason is required." };
  return { ok: true };
}

/** Build a fresh reopen cycle from a validated ordered approver list. */
export function buildReopenCycle(params: {
  approverUserIds: string[];
  requestedBy: string;
  requestedAt: string;
  reason: string;
  reopenCycleNumber: number;
}): ReopenCycle {
  return {
    reopenCycleNumber: params.reopenCycleNumber,
    approverUserIds: [...params.approverUserIds],
    currentPosition: 0,
    status: "pending",
    requestedBy: params.requestedBy,
    requestedAt: params.requestedAt,
    reason: params.reason,
    decisions: [],
  };
}

/** Only the captured approver at the pending position may decide (regardless of permission). */
export function canDecideReopenPosition(params: { cycle: ReopenCycle | null | undefined; actorId: string }): WorkflowDecision {
  const cycle = params.cycle;
  if (!cycle || cycle.status !== "pending") return { ok: false, code: "not_reopen_requested", error: "There is no pending reopening request." };
  if (approverForPosition(cycle.approverUserIds, cycle.currentPosition) !== params.actorId) {
    return { ok: false, code: "wrong_approver", error: "You are not the assigned approver for this reopening stage." };
  }
  return { ok: true };
}

/**
 * Apply an approval to the pending position. Returns the updated cycle and
 * whether the chain is now fully approved (the last captured approver signed).
 */
export function applyReopenApproval(cycle: ReopenCycle, actor: WorkflowActor, comment: string, now: string): { cycle: ReopenCycle; finalized: boolean } {
  const position = cycle.currentPosition;
  const entry: ReopenDecisionEntry = {
    position, approverUserId: cycle.approverUserIds[position], action: "approved",
    actorId: actor.id, actorName: actor.name, comment: comment || "", createdAt: now,
  };
  const finalized = position >= cycle.approverUserIds.length - 1;
  return {
    cycle: {
      ...cycle,
      decisions: [...cycle.decisions, entry],
      currentPosition: finalized ? position : position + 1,
      status: finalized ? "approved" : "pending",
      ...(finalized ? { decidedAt: now } : {}),
    },
    finalized,
  };
}

/** Apply a rejection to the pending position — the cycle ends rejected (history preserved). */
export function applyReopenRejection(cycle: ReopenCycle, actor: WorkflowActor, comment: string, now: string): ReopenCycle {
  const position = cycle.currentPosition;
  const entry: ReopenDecisionEntry = {
    position, approverUserId: cycle.approverUserIds[position], action: "rejected",
    actorId: actor.id, actorName: actor.name, comment: comment || "", createdAt: now,
  };
  return { ...cycle, decisions: [...cycle.decisions, entry], status: "rejected", decidedAt: now };
}

/** The next reopen approver position to notify, or null when the just-approved one was last. */
export function nextReopenPositionToNotify(cycle: ReopenCycle): number | null {
  return cycle.currentPosition >= cycle.approverUserIds.length - 1 ? null : cycle.currentPosition + 1;
}
