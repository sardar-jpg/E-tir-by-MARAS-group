/**
 * executiveFinance.ts — the Executive Dashboard's Financial Overview
 * (PR #133). Pure derivations over the REAL accounting module's records
 * (cost statements + shipments), reusing Accounting Phase B's canonical
 * math (computeGrossProfit — which REFUSES to mix currencies — and
 * resolveCustomerReceivedAmount). MARAS AI is never involved: no figure
 * here can come from anywhere but the accounting data.
 *
 * Currency discipline: every monetary figure is reported PER CURRENCY.
 * Nothing is ever summed across currencies, and a statement whose
 * revenue/cost currencies disagree contributes null profit (exactly as
 * computeGrossProfit decides) — surfaced honestly in profitExcluded.
 *
 * Honest time attribution: revenue/profit are recognized on the
 * shipment's DELIVERY (its terminal-status updatedAt). Statements whose
 * shipment isn't finished yet appear only in receivables/payables.
 */
import type { CostStatement, Shipment } from "../types";
import { computeGrossProfit, resolveCustomerReceivedAmount } from "./costStatementMath";

const TERMINAL = new Set(["Delivered", "Closed", "Completed"]);
/** A finished shipment with money still owed past this age is an overdue receivable. */
export const RECEIVABLE_OVERDUE_DAYS = 14;

export interface FinancePeriodFigures {
  today: number;
  thisMonth: number;
  thisYear: number;
}

export interface CurrencyFinanceOverview {
  currency: string;
  revenue: FinancePeriodFigures;
  grossProfit: FinancePeriodFigures;
  /** Delivered shipments whose profit could not be computed (currency mismatch / missing snapshot) — never silently zeroed. */
  profitExcludedCount: number;
  outstandingReceivables: number;
  overdueReceivables: number;
  outstandingReceivableCount: number;
  outstandingPayables: number;
  /** Payables split by cost item type: "driver"-typed items vs everything else (vendors). */
  driverPayables: number;
  vendorPayables: number;
  averageProfitPerShipment: number | null;
  highestProfitShipmentThisMonth: { shipmentNumber: string; profit: number } | null;
  highestRevenueCustomer: { companyName: string; revenue: number } | null;
}

export interface ExecutiveFinanceOverview {
  currencies: CurrencyFinanceOverview[];
  statementCount: number;
  deliveredWithStatementCount: number;
}

function inPeriod(iso: string, nowIso: string, period: "today" | "month" | "year"): boolean {
  if (!iso) return false;
  const len = period === "today" ? 10 : period === "month" ? 7 : 4;
  return iso.slice(0, len) === nowIso.slice(0, len);
}

export function buildExecutiveFinanceOverview(
  statements: CostStatement[],
  shipments: Shipment[],
  nowIso: string
): ExecutiveFinanceOverview {
  const shipmentById = new Map(shipments.map((s) => [s.id, s]));
  const perCurrency = new Map<string, CurrencyFinanceOverview>();
  const monthProfits = new Map<string, { shipmentNumber: string; profit: number }>();
  const customerRevenue = new Map<string, Map<string, number>>(); // currency -> company -> revenue
  const yearProfitCounts = new Map<string, number>();
  let deliveredWithStatementCount = 0;

  const bucket = (currency: string): CurrencyFinanceOverview => {
    let b = perCurrency.get(currency);
    if (!b) {
      b = {
        currency,
        revenue: { today: 0, thisMonth: 0, thisYear: 0 },
        grossProfit: { today: 0, thisMonth: 0, thisYear: 0 },
        profitExcludedCount: 0,
        outstandingReceivables: 0,
        overdueReceivables: 0,
        outstandingReceivableCount: 0,
        outstandingPayables: 0,
        driverPayables: 0,
        vendorPayables: 0,
        averageProfitPerShipment: null,
        highestProfitShipmentThisMonth: null,
        highestRevenueCustomer: null,
      };
      perCurrency.set(currency, b);
    }
    return b;
  };

  const overdueCutoff = new Date(new Date(nowIso).getTime() - RECEIVABLE_OVERDUE_DAYS * 86_400_000).toISOString();

  for (const st of statements) {
    const shipment = shipmentById.get(st.shipmentId);
    const agreedCurrency = st.agreedCurrency || (shipment ? shipment.currency : undefined);
    const agreed = st.agreedAmount ?? shipment?.agreedAmount ?? 0;
    const received = resolveCustomerReceivedAmount(st);

    // Receivables live in the REVENUE currency.
    if (agreedCurrency && agreed > 0) {
      const outstanding = agreed - received;
      if (outstanding > 0.009) {
        const rb = bucket(agreedCurrency);
        rb.outstandingReceivables += outstanding;
        rb.outstandingReceivableCount += 1;
        const finishedAt = shipment && TERMINAL.has(shipment.status || "") ? shipment.updatedAt || "" : "";
        if (finishedAt && finishedAt < overdueCutoff) rb.overdueReceivables += outstanding;
      }
    }

    // Payables live in the EXPENSE currency (statement currency), split
    // by the cost item's own type: driver items vs vendor/other items.
    if (st.currency) {
      const pb = bucket(st.currency);
      const unpaid = (st.totalCost || 0) - (st.paidAmount || 0);
      if (unpaid > 0.009) {
        pb.outstandingPayables += unpaid;
        const items = st.items || [];
        const totalItems = items.reduce((acc, i) => acc + (i.totalAmount || 0), 0);
        const driverShare = totalItems > 0
          ? items.filter((i) => `${i.costType || ""}`.toLowerCase().includes("driver")).reduce((acc, i) => acc + (i.totalAmount || 0), 0) / totalItems
          : 0;
        pb.driverPayables += unpaid * driverShare;
        pb.vendorPayables += unpaid * (1 - driverShare);
      }
    }

    // Revenue & profit recognize on delivery only.
    if (!shipment || !TERMINAL.has(shipment.status || "")) continue;
    deliveredWithStatementCount += 1;
    const deliveredAt = shipment.updatedAt || shipment.createdAt || "";
    if (agreedCurrency && agreed > 0) {
      const rb = bucket(agreedCurrency);
      if (inPeriod(deliveredAt, nowIso, "today")) rb.revenue.today += agreed;
      if (inPeriod(deliveredAt, nowIso, "month")) rb.revenue.thisMonth += agreed;
      if (inPeriod(deliveredAt, nowIso, "year")) rb.revenue.thisYear += agreed;
      if (inPeriod(deliveredAt, nowIso, "year")) {
        const byCompany = customerRevenue.get(agreedCurrency) || new Map<string, number>();
        byCompany.set(st.companyName || "?", (byCompany.get(st.companyName || "?") || 0) + agreed);
        customerRevenue.set(agreedCurrency, byCompany);
      }
    }
    const profit = computeGrossProfit(agreed, agreedCurrency as CostStatement["currency"], st.totalCost || 0, st.currency);
    if (profit === null) {
      if (agreedCurrency) bucket(agreedCurrency).profitExcludedCount += 1;
      continue;
    }
    const pb = bucket(st.currency);
    if (inPeriod(deliveredAt, nowIso, "today")) pb.grossProfit.today += profit;
    if (inPeriod(deliveredAt, nowIso, "month")) {
      pb.grossProfit.thisMonth += profit;
      const best = monthProfits.get(st.currency);
      if (!best || profit > best.profit) monthProfits.set(st.currency, { shipmentNumber: st.shipmentNumber || st.shipmentId, profit });
    }
    if (inPeriod(deliveredAt, nowIso, "year")) {
      pb.grossProfit.thisYear += profit;
      yearProfitCounts.set(st.currency, (yearProfitCounts.get(st.currency) || 0) + 1);
    }
  }

  for (const [currency, b] of perCurrency) {
    const n = yearProfitCounts.get(currency) || 0;
    b.averageProfitPerShipment = n > 0 ? b.grossProfit.thisYear / n : null;
    b.highestProfitShipmentThisMonth = monthProfits.get(currency) || null;
    const byCompany = customerRevenue.get(currency);
    if (byCompany && byCompany.size) {
      const top = [...byCompany.entries()].sort((a, z) => z[1] - a[1])[0];
      b.highestRevenueCustomer = { companyName: top[0], revenue: top[1] };
    }
  }

  return {
    currencies: [...perCurrency.values()].sort((a, b) => b.revenue.thisYear - a.revenue.thisYear || a.currency.localeCompare(b.currency)),
    statementCount: statements.length,
    deliveredWithStatementCount,
  };
}
