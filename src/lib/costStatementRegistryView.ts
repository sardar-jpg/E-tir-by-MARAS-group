/**
 * costStatementRegistryView.ts
 *
 * PR #60: the Costs / Cost Statements tab (AdminPanel.tsx) built its
 * registry list by filtering the `shipments` client array and joining each
 * row against `costStatements` — but GET /api/shipments 403s for accounts
 * admins (canViewShipmentRegistry, adminAccess.ts, PR #58), so `shipments`
 * stays `[]` for that role and the registry silently rendered empty
 * ("No matched shipments found") even though `costStatements` (which
 * accounts admins can fetch — canViewCostStatements) was fully populated.
 * The fix is not to widen /api/shipments access — it's to build the
 * registry from CostStatement first, which now carries its own
 * accounting-safe shipment snapshot (agreedAmount, truckNumber — see
 * CostStatement in ../types) copied at create/update time, and only use a
 * live `shipments` join as a fallback/enrichment for roles that actually
 * have that array populated (super/operation).
 */
import type { Currency, CostStatement, Shipment } from "../types";

export interface CostStatementRow {
  shipmentId: string;
  shipmentNumber: string;
  companyName: string;
  freightType: 'land' | 'sea' | 'air';
  agreedAmount: number;
  currency: Currency;
  truckNumber: string;
  cargoDescription: string;
  /** null when this row is a shipment with no cost statement yet (only ever true when `shipments` is populated). */
  statement: CostStatement | null;
}

/**
 * Accounting-safe display fields for one cost statement, preferring the
 * statement's own snapshot and falling back to the joined Shipment only for
 * whatever the snapshot doesn't carry (cargoDescription — display-only,
 * never used for search/filter). Works with `shipment` undefined, which is
 * always the case for accounts admins (empty `shipments` array).
 */
export function resolveCostStatementDisplay(
  statement: CostStatement,
  shipment: Shipment | undefined
): Omit<CostStatementRow, 'statement'> {
  return {
    shipmentId: statement.shipmentId,
    shipmentNumber: statement.shipmentNumber || shipment?.shipmentNumber || '',
    companyName: statement.companyName || shipment?.companyName || '',
    freightType: statement.shipmentType || shipment?.freightType || 'land',
    agreedAmount: statement.agreedAmount ?? shipment?.agreedAmount ?? 0,
    currency: statement.currency || shipment?.currency || 'USD',
    truckNumber: statement.truckNumber || shipment?.truckNumber || '',
    cargoDescription: shipment?.cargoDescription || '',
  };
}

/**
 * Builds the Costs tab registry: one row per cost statement (works for any
 * role that can call GET /api/cost-statements, including accounts admins
 * with `shipments === []`), plus — only when `shipments` is populated
 * (super/operation) — one row per shipment that doesn't have a cost
 * statement yet, so those roles can still start a new statement from the
 * registry. Accounts admins never see these extra rows today because they
 * can't create/update cost statements yet (POST requires full admin — see
 * docs/FOLLOW_UP_ROADMAP.md) and `shipments` is always `[]` for them, so
 * there's nothing to add.
 */
export function buildCostStatementRows(
  costStatements: CostStatement[],
  shipments: Shipment[]
): CostStatementRow[] {
  const shipmentById = new Map(shipments.map(s => [s.id, s]));
  const shipmentIdsWithStatement = new Set<string>();

  const rows: CostStatementRow[] = costStatements.map(statement => {
    shipmentIdsWithStatement.add(statement.shipmentId);
    return {
      ...resolveCostStatementDisplay(statement, shipmentById.get(statement.shipmentId)),
      statement,
    };
  });

  shipments.forEach(sh => {
    if (shipmentIdsWithStatement.has(sh.id)) return;
    rows.push({
      shipmentId: sh.id,
      shipmentNumber: sh.shipmentNumber,
      companyName: sh.companyName,
      freightType: sh.freightType || 'land',
      agreedAmount: sh.agreedAmount,
      currency: sh.currency,
      truckNumber: sh.truckNumber,
      cargoDescription: sh.cargoDescription,
      statement: null,
    });
  });

  return rows;
}

export type CostStatementPaymentFilter = 'All' | 'Unpaid' | 'Partial' | 'Paid';
export type CostStatementTypeFilter = 'All' | 'land' | 'sea' | 'air';

/**
 * Search/filter over registry rows — same query semantics as the previous
 * inline `filteredShipmentsCosts` (shipment number / company name / truck
 * plate / supplier line items, payment status, freight segment), just
 * reading from the row's resolved fields instead of a live shipment.
 */
export function filterCostStatementRows(
  rows: CostStatementRow[],
  query: string,
  statusFilter: CostStatementPaymentFilter,
  typeFilter: CostStatementTypeFilter
): CostStatementRow[] {
  const q = query.toLowerCase().trim();
  return rows.filter(row => {
    if (q) {
      const supplierMatch = row.statement?.items?.some(item =>
        item.supplierName?.toLowerCase().includes(q) ||
        item.costType?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q)
      );
      const numMatch = row.shipmentNumber?.toLowerCase().includes(q);
      const clientMatch = row.companyName?.toLowerCase().includes(q);
      const truckMatch = row.truckNumber?.toLowerCase().includes(q);
      if (!numMatch && !clientMatch && !truckMatch && !supplierMatch) return false;
    }

    if (statusFilter !== 'All') {
      const status = row.statement?.paymentStatus || 'Unpaid';
      if (status !== statusFilter) return false;
    }

    if (typeFilter !== 'All' && row.freightType !== typeFilter) return false;

    return true;
  });
}

export interface CostStatementShipmentContext {
  agreedAmount: number;
  freightType: 'land' | 'sea' | 'air';
  truckNumber: string;
  /** Route/cargo fields aren't part of the CostStatement snapshot (not needed for search/filter/export math) — undefined whenever `shipments` doesn't have this shipment, i.e. always for accounts admins. Callers already render a generic fallback ("Origin"/"N/A"/etc.) when absent. */
  loadingCity?: string;
  deliveryCity?: string;
  cargoDescription?: string;
}

/**
 * Accounting-safe shipment context for the statement editor's on-screen
 * preview (renderStatementHeader/PartyInfo/BodyTable/TotalsSection,
 * AdminPanel.tsx) and PDF/CSV exports (costStatementExportView.ts), both of
 * which need `agreedAmount`/`truckNumber` to render invoice/client/vendor
 * statement modes. Previously all of these read live `shipments.find(...)`
 * directly, which is `undefined` for accounts admins (empty `shipments`
 * array) and silently zeroed the displayed/exported amount and blanked the
 * truck plate. Reads the statement's own snapshot first, falling back to
 * the joined Shipment when present (super/operation, or a statement
 * created before the snapshot fields existed).
 */
export function resolveStatementShipmentContext(
  statement: CostStatement,
  shipments: Shipment[]
): CostStatementShipmentContext {
  const shipment = shipments.find(s => s.id === statement.shipmentId);
  return {
    agreedAmount: statement.agreedAmount ?? shipment?.agreedAmount ?? 0,
    freightType: statement.shipmentType || shipment?.freightType || 'land',
    truckNumber: statement.truckNumber || shipment?.truckNumber || '',
    loadingCity: shipment?.loadingCity,
    deliveryCity: shipment?.deliveryCity,
    cargoDescription: shipment?.cargoDescription,
  };
}

/**
 * Accounting Phase A — Single Shipment Reference Hardening: MAR-YYYY-####
 * `shipmentNumber` is the one business reference every financial record
 * (cost statements today; invoices/payments/receipts/credit-debit notes in
 * later phases) must carry — so it has to come from the authoritative
 * shipment record whenever one exists, exactly like the existing
 * `agreedAmount`/`truckNumber` snapshot pattern in
 * resolveStatementShipmentContext above. Dependency audit finding: POST
 * /api/cost-statements/:shipmentId (server.ts) previously took
 * `shipmentNumber` straight from the request body with no such check —
 * unlike `agreedAmount`/`truckNumber` two lines below it in that same
 * object literal — so a caller could silently store (and, via
 * `finalStatement.shipmentNumber`, even have reflected into the
 * activity-log entry for that very change) a `shipmentNumber` that didn't
 * match the real shipment. The client-supplied value is only ever a
 * fallback for the one case where no shipment record exists at all
 * (matches the same tolerance `agreedAmount`/`truckNumber` already have).
 */
export function resolveCostStatementShipmentNumber(
  shipment: Pick<Shipment, "shipmentNumber"> | undefined,
  clientSuppliedShipmentNumber: string | undefined
): string {
  return shipment?.shipmentNumber || clientSuppliedShipmentNumber || "";
}
