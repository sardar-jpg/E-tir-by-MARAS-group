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
import type { CostStatement, CustomerInvoice, Shipment } from "../types";
import { computeShipmentProfit, resolveCustomerReceivedAmount } from "./costStatementMath";
import { resolveAccountingStatus } from "./costApprovalWorkflow";

/**
 * Accounting Phase 1: revenue and profit are recognized from ISSUED customer
 * invoices only, never from the driver agreedAmount. Sum the issued/partially-
 * paid/paid invoice totals per shipmentNumber (mixed currencies on one shipment
 * → NaN → treated as unavailable, never converted).
 */
export interface IssuedInvoiceTotal { total: number; currency: string }
export function indexIssuedInvoiceTotals(invoices: CustomerInvoice[]): Map<string, IssuedInvoiceTotal> {
  const byShipment = new Map<string, IssuedInvoiceTotal>();
  for (const inv of invoices) {
    if (inv.status !== "issued" && inv.status !== "partially_paid" && inv.status !== "paid") continue;
    const amt = Number(inv.sellingAmount || 0);
    const prev = byShipment.get(inv.shipmentNumber);
    if (!prev) byShipment.set(inv.shipmentNumber, { total: amt, currency: inv.currency });
    else if (prev.currency === inv.currency) prev.total += amt;
    else prev.total = NaN;
  }
  return byShipment;
}

const TERMINAL = new Set(["Delivered", "Closed", "Completed"]);
/** A finished shipment with money still owed past this age is an overdue receivable. */
export const RECEIVABLE_OVERDUE_DAYS = 14;

/** Open = still being processed (not yet in a terminal status). */
export function isOpenShipmentStatus(status: string | undefined | null): boolean {
  return !TERMINAL.has(status || "");
}

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
  /**
   * Agreed value of all currently open (non-terminal) shipments in this
   * currency. NOT recognized revenue — it is the business value being
   * processed right now.
   */
  openShipmentsValue: number;
  openShipmentsCount: number;
  /**
   * Net Exposure for THIS currency only = outstandingReceivables −
   * outstandingPayables (driver + vendor). It is the company's net
   * financial position in the currency: positive = more is owed TO MARAS
   * than MARAS owes out; negative = MARAS owes more than it is owed.
   *
   * Currency discipline (identical to every other figure here): both
   * operands already live in the SAME currency bucket, so this is never a
   * cross-currency subtraction and is never converted. Open Shipments
   * Value is deliberately NOT part of it — that is agreed pipeline value,
   * not a recognized receivable or payable.
   */
  netExposure: number;
  averageProfitPerShipment: number | null;
  highestProfitShipmentThisMonth: { shipmentNumber: string; profit: number } | null;
  /**
   * Best customer of the CURRENT MONTH, ranked deterministically by gross
   * profit first, revenue as tie-breaker, company name as final tie-breaker
   * — never by revenue alone.
   */
  topCustomerThisMonth: { companyName: string; shipmentCount: number; revenue: number; grossProfit: number } | null;
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
  invoices: CustomerInvoice[],
  nowIso: string
): ExecutiveFinanceOverview {
  const shipmentById = new Map(shipments.map((s) => [s.id, s]));
  // Revenue/receivables/profit are sourced from issued invoices, never agreedAmount.
  const issuedByShipment = indexIssuedInvoiceTotals(invoices);
  const perCurrency = new Map<string, CurrencyFinanceOverview>();
  const monthProfits = new Map<string, { shipmentNumber: string; profit: number }>();
  // currency -> company -> this-month figures (for Top Customer This Month)
  const customerMonth = new Map<string, Map<string, { shipmentCount: number; revenue: number; grossProfit: number }>>();
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
        openShipmentsValue: 0,
        openShipmentsCount: 0,
        netExposure: 0,
        averageProfitPerShipment: null,
        highestProfitShipmentThisMonth: null,
        topCustomerThisMonth: null,
      };
      perCurrency.set(currency, b);
    }
    return b;
  };

  const overdueCutoff = new Date(new Date(nowIso).getTime() - RECEIVABLE_OVERDUE_DAYS * 86_400_000).toISOString();

  const monthCustomer = (currency: string, company: string) => {
    let byCompany = customerMonth.get(currency);
    if (!byCompany) { byCompany = new Map(); customerMonth.set(currency, byCompany); }
    let entry = byCompany.get(company);
    if (!entry) { entry = { shipmentCount: 0, revenue: 0, grossProfit: 0 }; byCompany.set(company, entry); }
    return entry;
  };

  // Open Shipments Value: the agreed value of everything still in flight,
  // straight off the shipment records — never recognized as revenue here.
  for (const s of shipments) {
    if (!isOpenShipmentStatus(s.status) || !s.currency) continue;
    const ob = bucket(s.currency);
    ob.openShipmentsValue += s.agreedAmount || 0;
    ob.openShipmentsCount += 1;
  }

  for (const st of statements) {
    const shipment = shipmentById.get(st.shipmentId);
    const received = resolveCustomerReceivedAmount(st);
    // Revenue currency = the issued invoice's currency (agreedAmount is never
    // revenue). A shipment with no issued invoice recognizes no revenue.
    const issued = issuedByShipment.get(st.shipmentNumber);
    const invoiceTotal = issued && Number.isFinite(issued.total) ? issued.total : null;
    const invoiceCurrency = issued ? issued.currency : undefined;

    // Receivables live in the INVOICE currency: only an issued invoice can be
    // outstanding, and the balance is invoice − received (never agreedAmount).
    if (invoiceCurrency && invoiceTotal !== null && invoiceTotal > 0) {
      const outstanding = invoiceTotal - received;
      if (outstanding > 0.009) {
        const rb = bucket(invoiceCurrency);
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

    // Revenue & profit recognize on delivery only, and only from an issued
    // invoice (no issued invoice → no revenue and no profit; never fabricated).
    if (!shipment || !TERMINAL.has(shipment.status || "")) continue;
    deliveredWithStatementCount += 1;
    const deliveredAt = shipment.updatedAt || shipment.createdAt || "";
    if (invoiceCurrency && invoiceTotal !== null && invoiceTotal > 0) {
      const rb = bucket(invoiceCurrency);
      if (inPeriod(deliveredAt, nowIso, "today")) rb.revenue.today += invoiceTotal;
      if (inPeriod(deliveredAt, nowIso, "month")) {
        rb.revenue.thisMonth += invoiceTotal;
        const entry = monthCustomer(invoiceCurrency, st.companyName || "?");
        entry.shipmentCount += 1;
        entry.revenue += invoiceTotal;
      }
      if (inPeriod(deliveredAt, nowIso, "year")) rb.revenue.thisYear += invoiceTotal;
    }
    // Profit = issued invoice − APPROVED cost (same currency only). Pending or
    // currency-mismatched shipments are excluded, never guessed.
    const approved = resolveAccountingStatus(st as any) === "final_closed";
    const profitResult = computeShipmentProfit({
      issuedInvoiceTotal: invoiceTotal,
      invoiceCurrency: invoiceCurrency as CostStatement["currency"] | undefined,
      costsApproved: approved,
      approvedCostTotal: st.totalCost || 0,
      costCurrency: st.currency,
    });
    if (profitResult.status !== "available" || profitResult.profit === null) {
      // Only count a currency-mismatch exclusion (matches prior behavior); a
      // pending shipment simply contributes nothing.
      if (profitResult.status === "unavailable_currency" && invoiceCurrency) bucket(invoiceCurrency).profitExcludedCount += 1;
      continue;
    }
    const profit = profitResult.profit;
    const pb = bucket(st.currency);
    if (inPeriod(deliveredAt, nowIso, "today")) pb.grossProfit.today += profit;
    if (inPeriod(deliveredAt, nowIso, "month")) {
      pb.grossProfit.thisMonth += profit;
      const best = monthProfits.get(st.currency);
      if (!best || profit > best.profit) monthProfits.set(st.currency, { shipmentNumber: st.shipmentNumber || st.shipmentId, profit });
      // profit !== null guarantees revenue and cost currencies match, so
      // this lands in the same bucket as the customer's revenue above.
      monthCustomer(st.currency, st.companyName || "?").grossProfit += profit;
    }
    if (inPeriod(deliveredAt, nowIso, "year")) {
      pb.grossProfit.thisYear += profit;
      yearProfitCounts.set(st.currency, (yearProfitCounts.get(st.currency) || 0) + 1);
    }
  }

  for (const [currency, b] of perCurrency) {
    const n = yearProfitCounts.get(currency) || 0;
    b.averageProfitPerShipment = n > 0 ? b.grossProfit.thisYear / n : null;
    // Net Exposure in this currency only (receivables owed to us − payables
    // we owe). Same-currency subtraction, never mixed or converted.
    b.netExposure = b.outstandingReceivables - b.outstandingPayables;
    b.highestProfitShipmentThisMonth = monthProfits.get(currency) || null;
    const byCompany = customerMonth.get(currency);
    if (byCompany && byCompany.size) {
      // Deterministic ranking: gross profit first, revenue as tie-breaker,
      // company name as the final tie-breaker. Never revenue alone.
      const [companyName, top] = [...byCompany.entries()].sort(
        (a, z) => z[1].grossProfit - a[1].grossProfit || z[1].revenue - a[1].revenue || a[0].localeCompare(z[0])
      )[0];
      b.topCustomerThisMonth = { companyName, ...top };
    }
  }

  return {
    currencies: [...perCurrency.values()].sort((a, b) => b.revenue.thisYear - a.revenue.thisYear || a.currency.localeCompare(b.currency)),
    statementCount: statements.length,
    deliveredWithStatementCount,
  };
}
