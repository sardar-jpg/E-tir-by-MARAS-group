/**
 * costStatementItem.ts — pure builder + append logic for the item-level cost
 * statement API (PR #140 review increment 3, items 9–11).
 *
 * The mobile quick-expense flow must add ONE item at a time — never PUT the
 * whole costItems array (which would clobber concurrent additions). The server
 * appends the built item inside a single-document transaction with optimistic
 * revision protection + idempotency; this module holds the pure validation +
 * append/replay decision. Urgency is a priority, never a payment method
 * (item 12) — a "urgent" method is normalized to priority, never stored.
 * Pure: no clock, db, or session.
 */
import type { CostItem, Currency } from "../types";
import { resolveRequestedPriority } from "./expensePriority";

export interface NewCostItemInput {
  costType?: string;
  description?: string;
  amount?: unknown;
  currency?: string;
  supplierName?: string;
  paymentMethod?: unknown;
  priority?: unknown;
  isUrgent?: unknown;
  dueDate?: string;
  attachmentUrl?: string;
}

export type CostItemBuildResult =
  | { ok: true; item: CostItem }
  | { ok: false; code: string; error: string };

const CURRENCIES = ["USD", "IQD", "TRY", "EUR"];
const round2 = (n: number): number => Math.round(((Number.isFinite(n) ? n : 0) + Number.EPSILON) * 100) / 100;

/**
 * Validate + build a single cost item from mobile input. The `amount` becomes
 * the line total (quantity 1). Urgency is normalized to `priority` (a
 * paymentMethod of "urgent" is treated as urgent priority, never stored as a
 * method). Returns a structured error on invalid input.
 */
export function buildCostItemFromInput(input: NewCostItemInput, id: string): CostItemBuildResult {
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) return { ok: false, code: "missing_description", error: "A description is required." };
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) ? round2(input.amount) : NaN;
  if (!(amount > 0)) return { ok: false, code: "invalid_amount", error: "Amount must be a positive number." };
  const currency = input.currency as Currency;
  if (!CURRENCIES.includes(currency)) return { ok: false, code: "invalid_currency", error: "Currency must be one of USD, IQD, TRY, EUR." };
  const urgent = resolveRequestedPriority(input as any) === "urgent" || String(input.paymentMethod ?? "").toLowerCase() === "urgent";
  return {
    ok: true,
    item: {
      id,
      costType: typeof input.costType === "string" && input.costType.trim() ? input.costType.trim().slice(0, 60) : "other",
      description: description.slice(0, 500),
      quantity: 1,
      unitPrice: amount,
      totalAmount: amount,
      currency,
      supplierName: typeof input.supplierName === "string" ? input.supplierName.trim().slice(0, 120) : "",
      documentUrl: typeof input.attachmentUrl === "string" ? input.attachmentUrl : undefined,
      dueDate: typeof input.dueDate === "string" ? input.dueDate : undefined,
      priority: urgent ? "urgent" : "normal",
    },
  };
}

export type ItemAppendDecision =
  | { kind: "replay"; item: CostItem }
  | { kind: "conflict"; code: string; error: string }
  | { kind: "append" };

/**
 * Decide how to apply an item add against the current items + revision:
 * - a matching idempotencyKey already present → replay (no change)
 * - an expectedRevision that doesn't match the stored one → revision_conflict
 * - otherwise → append.
 */
export function decideItemAppend(params: {
  items: CostItem[];
  storedRevision: number;
  expectedRevision?: number;
  scopedIdempotencyKey?: string;
}): ItemAppendDecision {
  if (params.scopedIdempotencyKey) {
    const prior = params.items.find((i) => i.idempotencyKey === params.scopedIdempotencyKey);
    if (prior) return { kind: "replay", item: prior };
  }
  if (typeof params.expectedRevision === "number" && params.expectedRevision !== params.storedRevision) {
    return { kind: "conflict", code: "revision_conflict", error: "The cost statement changed since you loaded it. Reload and try again." };
  }
  return { kind: "append" };
}
