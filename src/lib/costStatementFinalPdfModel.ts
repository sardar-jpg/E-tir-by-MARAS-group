/**
 * costStatementFinalPdfModel.ts — the PURE, deterministic model for the
 * final approved-and-closed cost statement PDF (PR #6). Built ONLY from an
 * authoritative stored statement snapshot + its approval records; the
 * renderer (costStatementFinalPdf.ts) draws exactly this model, so the
 * PDF can never reflect live mutable data.
 *
 * Reuses the canonical accounting math (costStatementMath.ts) — no new
 * formulas, no FX conversion, gross profit only when currencies match.
 */
import type { CostStatement } from "../types";
import {
  deriveExpenseSummary,
  deriveCustomerSummary,
  resolveCustomerReceivedAmount,
  computeGrossProfit,
} from "./costStatementMath";
import { latestStageApprovals, type ApprovalHistoryEntry, type ApprovalStage } from "./costApprovalWorkflow";

export interface FinalPdfApprovalLine {
  stage: ApprovalStage;
  label: string;
  name: string;
  approvedAt: string;
  status: string;
}

export interface FinalPdfModel {
  title: string;
  finalLabel: string;
  internalNotice: string;
  shipmentNumber: string;
  companyName: string;
  freightType: string;
  statementDate: string;
  currency: string;
  items: Array<{ description: string; supplierName: string; quantity: number; unitPrice: number; totalAmount: number; currency: string }>;
  totalCost: number;
  paidAmount: number;
  expenseRemaining: number;
  agreedAmount: number | null;
  agreedCurrency: string | null;
  customerReceived: number;
  customerReceivable: number;
  customerCredit: number;
  grossProfit: number | null;
  grossProfitNote: string;
  notes: string;
  approvals: FinalPdfApprovalLine[];
  finalStatementRevision: number;
  finalizedAt: string;
}

const STAGE_LABELS: Record<ApprovalStage, string> = {
  operations_manager: "Operations Manager",
  accounts_manager: "Accounts Manager",
  managing_director: "Managing Director",
};

export function buildFinalPdfModel(params: {
  statement: CostStatement;
  approvalHistory: ApprovalHistoryEntry[];
  cycleNumber: number;
  finalizedAt: string;
  finalStatementRevision: number;
}): FinalPdfModel {
  const s = params.statement;
  const expense = deriveExpenseSummary(s.totalCost || 0, s.paidAmount || 0);
  const received = resolveCustomerReceivedAmount(s);
  const agreed = typeof s.agreedAmount === "number" ? s.agreedAmount : null;
  const customer = agreed !== null ? deriveCustomerSummary(agreed, received) : null;

  // Gross profit only when the customer's agreed currency matches the
  // statement (expense) currency — never converted (costStatementMath).
  const grossProfit = computeGrossProfit(
    agreed ?? 0,
    (s.agreedCurrency as CostStatement["currency"]) || undefined,
    s.totalCost || 0,
    s.currency
  );
  const currenciesMatch = agreed !== null && s.agreedCurrency === s.currency;

  const latest = latestStageApprovals(params.approvalHistory, params.cycleNumber);
  const approvals: FinalPdfApprovalLine[] = (["operations_manager", "accounts_manager", "managing_director"] as ApprovalStage[]).map(
    (stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      name: latest[stage]?.actorName || "—",
      approvedAt: latest[stage]?.createdAt || "",
      status: latest[stage] ? "Approved" : "—",
    })
  );

  return {
    title: "MARAS INTERNATIONAL CARGO — COST STATEMENT",
    finalLabel: "FINAL — APPROVED AND CLOSED",
    internalNotice: "INTERNAL ACCOUNTING DOCUMENT — NOT FOR EXTERNAL DISTRIBUTION",
    shipmentNumber: s.shipmentNumber || "",
    companyName: s.companyName || "",
    freightType: s.shipmentType || "land",
    statementDate: s.date || "",
    currency: s.currency,
    items: (s.items || []).map((i) => ({
      description: i.description || i.costType || "",
      supplierName: i.supplierName || "",
      quantity: i.quantity || 0,
      unitPrice: i.unitPrice || 0,
      totalAmount: i.totalAmount || 0,
      currency: i.currency || s.currency,
    })),
    totalCost: s.totalCost || 0,
    paidAmount: s.paidAmount || 0,
    expenseRemaining: expense.remainingBalance,
    agreedAmount: agreed,
    agreedCurrency: s.agreedCurrency || null,
    customerReceived: received,
    customerReceivable: customer?.customerReceivable ?? 0,
    customerCredit: customer?.customerCredit ?? 0,
    grossProfit: currenciesMatch ? grossProfit : null,
    grossProfitNote: currenciesMatch ? "" : "Gross profit not shown — customer and expense currencies differ (never converted).",
    notes: s.notes || "",
    approvals,
    finalStatementRevision: params.finalStatementRevision,
    finalizedAt: params.finalizedAt,
  };
}
