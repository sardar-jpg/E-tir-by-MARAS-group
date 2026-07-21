/**
 * costApprovalUiActions.ts — pure derivation of which workflow actions a
 * given session may see for a cost statement in a given state (PR #6).
 * The UI uses this to show/hide buttons and lock financial fields, but it
 * is ONLY a convenience mirror — the server enforces every action
 * independently (costApprovalWorkflow.ts). Never the security boundary.
 */
import {
  resolveAccountingStatus, approverPositionForStatus, resolveCycleApprovers, isFinancialEditingAllowed,
  activeReopenCycle, hasPendingReopen, approverForPosition,
  type AccountingStatus, type CostApprovalState, type CostApprovalWorkflowConfig, type ReopenCycle,
} from "./costApprovalWorkflow";

export interface UiActorContext {
  sessionId: string;
  isSuperAdmin: boolean;
  canWriteCostStatements: boolean;
}

export interface CostApprovalUiActions {
  status: AccountingStatus;
  canEditFinancials: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canRequestReopen: boolean;
  canDecideReopen: boolean;
  canViewFinalPdf: boolean;
  isReadOnly: boolean;
  /** Phase 3: true when an active issued customer invoice financially locks the statement. */
  isLockedByInvoice: boolean;
}

export function deriveCostApprovalUiActions(
  state: (CostApprovalState & { reopenCycles?: ReopenCycle[] }) | undefined | null,
  config: CostApprovalWorkflowConfig | undefined | null,
  actor: UiActorContext,
  /** Phase 3: whether a related customer invoice is active (issued/partially_paid/paid). */
  hasActiveInvoice = false,
): CostApprovalUiActions {
  const status = resolveAccountingStatus(state);
  const cfg = config || {};
  // Phase 2: the pending approver is the captured cycle approver at the pending
  // position (legacy cycles with no snapshot fall back to the resolved config).
  const position = approverPositionForStatus(status);
  const cycleApprovers = resolveCycleApprovers(state, cfg);
  const isAssignedApprover = position !== null && position < cycleApprovers.length && cycleApprovers[position] === actor.sessionId;
  // Phase 3: editing is additionally locked while an active invoice exists.
  const editable = isFinancialEditingAllowed(status) && !hasActiveInvoice;
  const hasFinalPdf = !!state?.finalPdfUrl;

  // Phase 3: the reopen approval chain — only the captured approver at the
  // pending reopen position may decide (regardless of permission breadth).
  const reopenCycle = activeReopenCycle(state);
  const isReopenApprover = !!reopenCycle && approverForPosition(reopenCycle.approverUserIds, reopenCycle.currentPosition) === actor.sessionId;

  return {
    status,
    canEditFinancials: editable && actor.canWriteCostStatements,
    canSubmit: editable && actor.canWriteCostStatements,
    canApprove: isAssignedApprover,
    canReject: isAssignedApprover,
    // An accounting writer may request reopening of a closed statement — but
    // NOT while an active invoice locks it, and not if one is already pending.
    canRequestReopen: status === "final_closed" && actor.canWriteCostStatements && !hasActiveInvoice && !hasPendingReopen(state),
    // The reopen chain is decided by its captured approvers (user-based, not
    // Super-Admin-only). The server re-enforces the pending-approver match.
    canDecideReopen: status === "reopen_requested" && isReopenApprover,
    canViewFinalPdf: hasFinalPdf && actor.canWriteCostStatements,
    isReadOnly: !editable,
    isLockedByInvoice: hasActiveInvoice,
  };
}
