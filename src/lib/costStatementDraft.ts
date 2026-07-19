/**
 * costStatementDraft.ts — pure builder for the draft Cost Statement that
 * is auto-created and linked when a shipment is created (Core Business
 * Rule: shipment → shipment record + chat + accounting cost record).
 *
 * A draft is deliberately empty of cost lines and money (accountants fill
 * it in later); it exists so every shipment has a linked, MAR-numbered
 * internal cost record from creation, and it uses the SAME shape the edit
 * route (POST /api/cost-statements/:shipmentId) produces for a brand-new
 * statement so the two paths cannot drift. It is `accountingStatus:
 * "draft"` — never final — and carries only accounting-safe identity
 * snapshots copied from the authoritative shipment.
 */
import type { CostStatement, Shipment, Currency } from "../types";
import { deriveExpenseSummary } from "./costStatementMath";

/** Cost-statement currencies the accounting module accepts. */
const ALLOWED_COST_CURRENCIES = new Set<Currency>(["USD", "IQD", "TRY", "EUR"]);

/** The shipment fields the draft needs — a narrow slice, for testability. */
export type DraftShipmentSource = Pick<
  Shipment,
  "id" | "shipmentNumber" | "companyName" | "freightType" | "agreedAmount" | "currency" | "truckNumber"
>;

function resolveShipmentType(freightType: string | undefined): "land" | "sea" | "air" {
  return freightType === "sea" ? "sea" : freightType === "air" ? "air" : "land";
}

/**
 * Build the draft Cost Statement for a newly-created shipment. Pure: no
 * clock, no db — the caller passes `nowIso`. The draft's document id is the
 * shipment id (one statement per shipment; the create route enforces
 * no-duplicate), and every identity field comes from the shipment, never a
 * client body.
 */
export function buildDraftCostStatement(shipment: DraftShipmentSource, nowIso: string): CostStatement {
  const currency: Currency = ALLOWED_COST_CURRENCIES.has(shipment.currency) ? shipment.currency : "USD";
  const expense = deriveExpenseSummary(0, 0);
  return {
    shipmentId: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    companyName: shipment.companyName || "",
    shipmentType: resolveShipmentType(shipment.freightType),
    date: nowIso.split("T")[0],
    currency,
    totalCost: 0,
    paidAmount: 0,
    remainingBalance: expense.remainingBalance,
    paymentStatus: expense.paymentStatus,
    customerReceivedAmount: 0,
    revision: 1,
    notes: "",
    items: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    // Accounting-safe identity snapshots from the authoritative shipment.
    agreedAmount: typeof shipment.agreedAmount === "number" ? shipment.agreedAmount : 0,
    agreedCurrency: shipment.currency,
    truckNumber: shipment.truckNumber || "",
    // Cost Approval Workflow: a brand-new statement is always an editable draft.
    accountingStatus: "draft",
    approvalCycle: 1,
    approvalHistory: [],
  };
}
