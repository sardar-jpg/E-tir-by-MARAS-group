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
import type { CostStatement, CompanyProfile, Language } from "../types";
import {
  deriveExpenseSummary,
  deriveCustomerSummary,
  resolveCustomerReceivedAmount,
  computeShipmentProfit,
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
  /** Driver Agreed Amount — REFERENCE ONLY. Never a customer price or profit input. */
  agreedAmount: number | null;
  agreedCurrency: string | null;
  /** Currency of the customer-facing figures below (the issued invoice currency). */
  invoiceCurrency: string | null;
  customerReceived: number;
  customerReceivable: number;
  customerCredit: number;
  grossProfit: number | null;
  grossProfitNote: string;
  notes: string;
  approvals: FinalPdfApprovalLine[];
  finalStatementRevision: number;
  finalizedAt: string;
  // Phase 10 branding (optional; snapshot from the Company Profile at
  // finalization so the internal cost statement carries the same header/
  // footer/signature/stamp as other documents). Direction supports RTL.
  brandName?: string;
  brandLogoUrl?: string;
  brandFooterText?: string;
  brandSignatureUrl?: string;
  brandStampUrl?: string;
  direction?: "ltr" | "rtl";
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
  company?: CompanyProfile | null;
  language?: Language;
  /** Issued customer invoice total for this shipment (null = none issued). */
  issuedInvoiceTotal?: number | null;
  /** Currency of the issued invoice (for the customer-facing figures + profit). */
  issuedInvoiceCurrency?: string | null;
}): FinalPdfModel {
  const s = params.statement;
  const expense = deriveExpenseSummary(s.totalCost || 0, s.paidAmount || 0);
  const received = resolveCustomerReceivedAmount(s);
  // Driver Agreed Amount — reference only; never a customer price or profit input.
  const driverAgreed = typeof s.agreedAmount === "number" ? s.agreedAmount : null;

  // Accounting Phase 1: customer figures and profit come from the ISSUED
  // customer invoice, never agreedAmount. The final PDF is produced at closure,
  // so the cost statement is approved; profit is pending only when no invoice
  // has been issued (or invoice/cost currencies differ — never converted).
  const invoiceTotal = typeof params.issuedInvoiceTotal === "number" && Number.isFinite(params.issuedInvoiceTotal)
    ? params.issuedInvoiceTotal : null;
  const invoiceCurrency = params.issuedInvoiceCurrency || null;
  const customer = invoiceTotal !== null ? deriveCustomerSummary(invoiceTotal, received) : null;

  const profitResult = computeShipmentProfit({
    issuedInvoiceTotal: invoiceTotal,
    invoiceCurrency: (invoiceCurrency || undefined) as CostStatement["currency"] | undefined,
    costsApproved: true,
    approvedCostTotal: s.totalCost || 0,
    costCurrency: s.currency,
  });
  const grossProfit = profitResult.status === "available" ? profitResult.profit : null;
  const grossProfitNote =
    profitResult.status === "pending_no_invoice"
      ? "Profit Pending — No Issued Customer Invoice"
      : profitResult.status === "unavailable_currency"
        ? "Profit unavailable — the issued invoice and expense currencies differ (never converted)."
        : "";

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
    agreedAmount: driverAgreed,
    agreedCurrency: s.agreedCurrency || null,
    invoiceCurrency,
    customerReceived: received,
    customerReceivable: customer?.customerReceivable ?? 0,
    customerCredit: customer?.customerCredit ?? 0,
    grossProfit,
    grossProfitNote,
    notes: s.notes || "",
    approvals,
    finalStatementRevision: params.finalStatementRevision,
    finalizedAt: params.finalizedAt,
    brandName: params.company?.companyName || params.company?.companyNameEn || undefined,
    brandLogoUrl: params.company?.logoUrl,
    brandFooterText: params.company?.footerText,
    brandSignatureUrl: params.company?.signatureUrl,
    brandStampUrl: params.company?.stampUrl,
    direction: params.language === "ar" ? "rtl" : "ltr",
  };
}
