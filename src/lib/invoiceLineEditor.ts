/**
 * Pure, framework-free helpers for the customer-invoice LINE EDITOR (client-side
 * table state only). These never touch money math beyond deciding row identity /
 * ordering — line amounts and all invoice totals stay SERVER-authoritative
 * (computed in customerInvoiceLines.ts and recomputed on save). Keeping the row
 * operations pure makes the add / delete / duplicate UX unit-testable without a
 * DOM.
 */
export interface LineDraft {
  /** Client-only id (never a persisted server record id). */
  id: string;
  serviceType: string;
  customServiceType: string;
  description: string;
  quantity: string;
  unit: string;
  customUnit: string;
  unitPrice: string;
}

/** Fresh client-side line id — always `l-…`, never a server record id. */
export const makeLineId = (): string => `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const emptyLineDraft = (id: string = makeLineId()): LineDraft => ({
  id, serviceType: "", customServiceType: "", description: "", quantity: "1", unit: "", customUnit: "", unitPrice: "",
});

/** True when the row carries employee-entered content (used to gate delete confirmation). */
export const lineDraftHasData = (l: LineDraft): boolean => !!(
  l.serviceType || l.customServiceType.trim() || l.description.trim() ||
  l.unit || l.customUnit.trim() || l.unitPrice.trim() ||
  (l.quantity.trim() !== "" && l.quantity.trim() !== "1")
);

/** Append a new blank line. */
export const addLineDraft = (lines: LineDraft[], id: string = makeLineId()): LineDraft[] => [...lines, emptyLineDraft(id)];

/**
 * Duplicate a line: copy every content field (service type + custom, description,
 * quantity, unit + custom, unit price) but assign a BRAND-NEW client id, and
 * insert directly below the source. The amount is intentionally NOT carried — it
 * is recomputed from quantity × unit price by the preview/server, so a duplicate
 * always re-derives its own amount. No server record id is ever copied.
 */
export const duplicateLineDraft = (lines: LineDraft[], id: string, newId: string = makeLineId()): LineDraft[] => {
  const idx = lines.findIndex((l) => l.id === id);
  if (idx < 0) return lines;
  const copy: LineDraft = { ...lines[idx], id: newId };
  const out = lines.slice();
  out.splice(idx + 1, 0, copy);
  return out;
};

/**
 * Delete a line. Any line may be removed, but at least one editable row always
 * remains: deleting the final row replaces it with a fresh blank line.
 */
export const deleteLineDraft = (lines: LineDraft[], id: string, newId: string = makeLineId()): LineDraft[] => {
  const remaining = lines.filter((l) => l.id !== id);
  return remaining.length > 0 ? remaining : [emptyLineDraft(newId)];
};

/** Human row number (1-based) for a line id; 0 when not found. */
export const lineRowNumber = (lines: LineDraft[], id: string): number => lines.findIndex((l) => l.id === id) + 1;
