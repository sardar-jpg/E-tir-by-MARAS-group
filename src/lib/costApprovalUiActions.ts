/**
 * costApprovalUiActions.ts — pure derivation of which workflow actions a
 * given session may see for a cost statement in a given state (PR #6).
 * The UI uses this to show/hide buttons and lock financial fields, but it
 * is ONLY a convenience mirror — the server enforces every action
 * independently (costApprovalWorkflow.ts). Never the security boundary.
 */
import {
  resolveAccountingStatus, approverPositionForStatus, resolveCycleApprovers, isFinancialEditingAllowed,
  type AccountingStatus, type CostApprovalState, type CostApprovalWorkflowConfig,
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
}

export function deriveCostApprovalUiActions(
  state: CostApprovalState | undefined | null,
  config: CostApprovalWorkflowConfig | undefined | null,
  actor: UiActorContext
): CostApprovalUiActions {
  const status = resolveAccountingStatus(state);
  const cfg = config || {};
  // Phase 2: the pending approver is the captured cycle approver at the pending
  // position (legacy cycles with no snapshot fall back to the resolved config).
  const position = approverPositionForStatus(status);
  const cycleApprovers = resolveCycleApprovers(state, cfg);
  const isAssignedApprover = position !== null && position < cycleApprovers.length && cycleApprovers[position] === actor.sessionId;
  const editable = isFinancialEditingAllowed(status);
  const hasFinalPdf = !!state?.finalPdfUrl;

  return {
    status,
    canEditFinancials: editable && actor.canWriteCostStatements,
    canSubmit: editable && actor.canWriteCostStatements,
    canApprove: isAssignedApprover,
    canReject: isAssignedApprover,
    // Any accounting writer may request reopening of a closed statement.
    canRequestReopen: status === "final_closed" && actor.canWriteCostStatements,
    // Only a Super Admin decides a reopening request — and never their own
    // (the server enforces the self-decision block; the UI hides it when
    // the viewer is the requester).
    canDecideReopen: status === "reopen_requested" && actor.isSuperAdmin && state?.reopenRequestedBy !== actor.sessionId,
    canViewFinalPdf: hasFinalPdf && actor.canWriteCostStatements,
    isReadOnly: !editable,
  };
}
