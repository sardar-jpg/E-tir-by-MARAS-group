import { useCallback, useEffect, useMemo, useState } from "react";
import type { Client, CostStatement, CostItem, CustomerInvoice, CustomerPayment, VendorPaymentTransaction } from "../../../types";
import { apiFetch } from "../../../lib/api";
import type { CustomerAccountInput } from "../../../lib/receivablesPayables";
import type { VendorBillInput } from "../../../lib/receivablesPayables";

/**
 * One shared fetch layer for the Phase-3 accounting overview pages
 * (Receivables & Payables, Monthly Report, AI Financial Assistant). It reads
 * ONLY existing endpoints — per-company invoices/payments and per-shipment
 * vendor-payments — and aggregates them client-side (no backend change). All
 * amounts stay exactly as the server returned them; this hook just gathers and
 * shapes them so each page can run its own tested pure calculations.
 */
export interface AccountingDataset {
  loading: boolean;
  error: string | null;
  customers: CustomerAccountInput[];
  invoices: CustomerInvoice[];
  customerPayments: CustomerPayment[];
  vendorPayments: VendorPaymentTransaction[];
  vendorBills: VendorBillInput[];
  reload: () => void;
}

export function useAccountingDataset(clients: Client[], costStatements: CostStatement[]): AccountingDataset {
  const [customers, setCustomers] = useState<CustomerAccountInput[]>([]);
  const [vendorPayments, setVendorPayments] = useState<VendorPaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const companies = useMemo(() => [...new Set(clients.map((c) => c.companyName).filter(Boolean))], [clients]);
  const shipmentIds = useMemo(() => [...new Set(costStatements.map((s) => s.shipmentId).filter(Boolean))], [costStatements]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [custAccounts, venByShipment] = await Promise.all([
        Promise.all(companies.map(async (co): Promise<CustomerAccountInput> => {
          try {
            const [invRes, payRes] = await Promise.all([
              apiFetch(`/api/customer-accounts/invoices?company=${encodeURIComponent(co)}`),
              apiFetch(`/api/customer-accounts/payments?company=${encodeURIComponent(co)}`),
            ]);
            const invBody = invRes.ok ? await invRes.json() : {};
            const payBody = payRes.ok ? await payRes.json() : {};
            return { customer: co, invoices: invBody.invoices || [], outstanding: invBody.outstanding || [], payments: payBody.payments || [] };
          } catch { return { customer: co, invoices: [], outstanding: [], payments: [] }; }
        })),
        Promise.all(shipmentIds.map(async (sid) => {
          try { const r = await apiFetch(`/api/cost-statements/${encodeURIComponent(sid)}/vendor-payments`); if (!r.ok) return []; return (await r.json()).payments || []; } catch { return []; }
        })),
      ]);
      setCustomers(custAccounts);
      setVendorPayments(venByShipment.flat() as VendorPaymentTransaction[]);
    } catch { setError("Could not load accounting data."); }
    finally { setLoading(false); }
  }, [companies, shipmentIds]);
  useEffect(() => { void load(); }, [load]);

  const invoices = useMemo(() => customers.flatMap((c) => c.invoices), [customers]);
  const customerPayments = useMemo(() => customers.flatMap((c) => c.payments), [customers]);

  // Assemble vendor bills (cost lines) with how much of each has been paid.
  const vendorBills = useMemo<VendorBillInput[]>(() => {
    const paidByItem = new Map<string, number>();
    for (const v of vendorPayments) if (v.status === "active") paidByItem.set(v.costItemId, (paidByItem.get(v.costItemId) || 0) + Number(v.amount || 0));
    const bills: VendorBillInput[] = [];
    for (const st of costStatements) {
      for (const it of ((st.items as CostItem[]) || [])) {
        const vendor = (it.supplierName || "").trim();
        if (!vendor) continue;
        bills.push({
          vendor, currency: it.currency, amount: Number(it.totalAmount || 0), paid: paidByItem.get(it.id) || 0,
          dueDate: (it as any).dueDate || undefined,
          docDate: ((it as any).dueDate || st.date || st.createdAt || "").slice(0, 10),
        });
      }
    }
    return bills;
  }, [costStatements, vendorPayments]);

  return { loading, error, customers, invoices, customerPayments, vendorPayments, vendorBills, reload: load };
}
