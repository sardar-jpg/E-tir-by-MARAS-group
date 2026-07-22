import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import {
  Loader2, PieChart, Scale, Wallet, TrendingUp, ArrowDownCircle, ArrowUpCircle,
  Coins, Lock, RefreshCw, CalendarDays, FileText, FileSpreadsheet,
} from "lucide-react";
import type { Language, Client, CostStatement } from "../../../types";
import { apiFetch } from "../../../lib/api";
import { PageHeader, Panel, KpiCard, EmptyState, money, CARD, btnGhost, inputCls, Pagination, StatusPill } from "./AccountingUI";
import MonthlyReportPage from "./MonthlyReportPage";

/**
 * Accounting Phase 7 — Financial Reports hub. A read-only reporting surface
 * over the authoritative Phase 1–6 records. Every figure is server-computed
 * (the pages here only present values); currencies are always shown separately
 * with their code and are NEVER combined. Nothing on this page mutates data —
 * Official Profit / Cash reports fall back to a permission notice when the
 * backend withholds them.
 */
type Lang = Language;
const t = (l: { en: string; tr: string; ar: string }, lang: Lang) => l[lang] || l.en;

const TABS = [
  { id: "overview", icon: PieChart, label: { en: "Financial Overview", tr: "Mali Genel Bakış", ar: "نظرة عامة مالية" } },
  { id: "receivables", icon: ArrowDownCircle, label: { en: "Receivables", tr: "Alacaklar", ar: "الذمم المدينة" } },
  { id: "payables", icon: ArrowUpCircle, label: { en: "Payables", tr: "Borçlar", ar: "الذمم الدائنة" } },
  { id: "profit", icon: TrendingUp, label: { en: "Profit", tr: "Kâr", ar: "الربح" } },
  { id: "customer-receipts", icon: Wallet, label: { en: "Customer Receipts", tr: "Müşteri Tahsilatları", ar: "مقبوضات العملاء" } },
  { id: "vendor-payments", icon: Coins, label: { en: "Vendor Payments", tr: "Tedarikçi Ödemeleri", ar: "مدفوعات الموردين" } },
  { id: "cash-movement", icon: Scale, label: { en: "Cash Movement", tr: "Nakit Hareketi", ar: "الحركة النقدية" } },
  { id: "financial-closing", icon: Lock, label: { en: "Financial Closing", tr: "Mali Kapanış", ar: "الإغلاق المالي" } },
  { id: "monthly", icon: CalendarDays, label: { en: "Monthly", tr: "Aylık", ar: "شهري" } },
] as const;
type TabId = (typeof TABS)[number]["id"];

const CUR = money;

export default function FinancialReportsPage({ lang, clients, costStatements }: { lang: Lang; clients: Client[]; costStatements: CostStatement[] }) {
  const [tab, setTab] = useState<TabId>("overview");
  const [canExport, setCanExport] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/api/accounting/my-permissions");
        if (res.ok) { const d = await res.json(); setCanExport(Array.isArray(d.permissions) && d.permissions.includes("reports.export")); }
      } catch { /* default: no export controls */ }
    })();
  }, []);
  return (
    <div className="space-y-5">
      <PageHeader
        title={t({ en: "Financial Reports", tr: "Mali Raporlar", ar: "التقارير المالية" }, lang)}
        subtitle={t({ en: "Read-only reports derived from live accounting records. All totals are grouped by currency — never combined, never converted.", tr: "Canlı muhasebe kayıtlarından türetilen salt-okunur raporlar. Tüm toplamlar para birimine göre gruplanır.", ar: "تقارير للقراءة فقط مشتقة من سجلات المحاسبة الحية. كل الإجماليات مجمّعة حسب العملة." }, lang)}
      />
      <div className={`${CARD} p-1.5 flex gap-1 flex-wrap`}>
        {TABS.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold cursor-pointer border-0 transition-all ${tab === x.id ? "bg-slate-900 text-white" : "bg-transparent text-slate-600 hover:bg-slate-100"}`}>
            <x.icon className="w-4 h-4" />{t(x.label, lang)}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab lang={lang} />}
      {tab === "receivables" && <ListReport lang={lang} tabId="receivables" canExport={canExport} />}
      {tab === "payables" && <ListReport lang={lang} tabId="payables" canExport={canExport} />}
      {tab === "profit" && <ListReport lang={lang} tabId="profit" canExport={canExport} />}
      {tab === "customer-receipts" && <ListReport lang={lang} tabId="customer-receipts" canExport={canExport} />}
      {tab === "vendor-payments" && <ListReport lang={lang} tabId="vendor-payments" canExport={canExport} />}
      {tab === "cash-movement" && <CashMovementTab lang={lang} canExport={canExport} />}
      {tab === "financial-closing" && <ListReport lang={lang} tabId="financial-closing" canExport={canExport} />}
      {tab === "monthly" && <MonthlyReportPage lang={lang} clients={clients} costStatements={costStatements} />}
    </div>
  );
}

// ── Financial Overview ───────────────────────────────────────────────────────
interface CurTotals { currency: string; [k: string]: number | string }
interface Overview {
  receivables: Array<{ currency: string; invoiced: number; received: number; outstanding: number; overdue: number }>;
  payables: Array<{ currency: string; approved: number; paid: number; remaining: number }>;
  customerReceipts: Array<{ currency: string; active: number }>;
  vendorPayments: Array<{ currency: string; active: number }>;
  profit: Array<{ currency: string; officialProfit: number }> | null;
  cashMovement: Array<{ currency: string; netCashMovement: number }> | null;
  counts: { financiallyClosedOrders: number; financiallyOpenOrders: number; overdueInvoices: number; ordersWithUnresolvedBalance: number };
  note: string;
}

function OverviewTab({ lang }: { lang: Lang }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiFetch("/api/accounting/reports/overview");
      if (res.ok) setData(await res.json());
      else setError((await res.json().catch(() => ({}))).error || "Failed to load overview.");
    } catch { setError("Failed to load overview."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState msg={error} onRetry={load} />;
  if (!data) return null;

  const currencies = [...new Set([
    ...data.receivables.map((r) => r.currency), ...data.payables.map((r) => r.currency),
    ...data.customerReceipts.map((r) => r.currency), ...data.vendorPayments.map((r) => r.currency),
    ...(data.profit || []).map((r) => r.currency), ...(data.cashMovement || []).map((r) => r.currency),
  ])].sort();
  const find = <T extends CurTotals>(arr: T[] | null | undefined, c: string) => (arr || []).find((x) => x.currency === c);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={Lock} tone="emerald" label={t({ en: "Closed Orders", tr: "Kapalı", ar: "طلبات مغلقة" }, lang)} value={String(data.counts.financiallyClosedOrders)} />
        <KpiCard icon={Wallet} tone="blue" label={t({ en: "Open Orders", tr: "Açık", ar: "طلبات مفتوحة" }, lang)} value={String(data.counts.financiallyOpenOrders)} />
        <KpiCard icon={ArrowDownCircle} tone="amber" label={t({ en: "Overdue Invoices", tr: "Vadesi Geçen", ar: "فواتير متأخرة" }, lang)} value={String(data.counts.overdueInvoices)} />
        <KpiCard icon={Scale} tone="red" label={t({ en: "Unresolved Balances", tr: "Bakiye Var", ar: "أرصدة غير مسددة" }, lang)} value={String(data.counts.ordersWithUnresolvedBalance)} />
      </div>
      {currencies.length === 0 && <EmptyState icon={PieChart} title={t({ en: "No financial activity yet", tr: "Henüz kayıt yok", ar: "لا نشاط مالي بعد" }, lang)} />}
      {currencies.map((c) => {
        const rec = find(data.receivables, c), pay = find(data.payables, c);
        const prof = find(data.profit, c), cash = find(data.cashMovement, c);
        return (
          <Panel key={c} title={`${c}`} subtitle={t({ en: "All figures in this currency only", tr: "Sadece bu para birimi", ar: "كل الأرقام بهذه العملة فقط" }, lang)}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Metric label={t({ en: "Receivable (Outstanding)", tr: "Alacak", ar: "الذمم المدينة" }, lang)} value={CUR(Number(rec?.outstanding || 0))} unit={c} tone="amber" />
              <Metric label={t({ en: "Payable (Remaining)", tr: "Borç", ar: "الذمم الدائنة" }, lang)} value={CUR(Number(pay?.remaining || 0))} unit={c} tone="red" />
              <Metric label={t({ en: "Official Profit", tr: "Resmî Kâr", ar: "الربح الرسمي" }, lang)} value={data.profit ? CUR(Number(prof?.officialProfit || 0)) : "—"} unit={data.profit ? c : ""} tone="emerald" locked={!data.profit} />
              <Metric label={t({ en: "Customer Receipts", tr: "Tahsilat", ar: "المقبوضات" }, lang)} value={CUR(Number(find(data.customerReceipts, c)?.active || 0))} unit={c} tone="blue" />
              <Metric label={t({ en: "Vendor Payments", tr: "Ödemeler", ar: "المدفوعات" }, lang)} value={CUR(Number(find(data.vendorPayments, c)?.active || 0))} unit={c} tone="slate" />
              <Metric label={t({ en: "Net Cash Movement", tr: "Net Nakit", ar: "صافي النقد" }, lang)} value={data.cashMovement ? CUR(Number(cash?.netCashMovement || 0)) : "—"} unit={data.cashMovement ? c : ""} tone="blue" locked={!data.cashMovement} />
            </div>
          </Panel>
        );
      })}
      <p className="text-[11.5px] text-slate-400 px-1">{data.note}</p>
    </div>
  );
}

function Metric({ label, value, unit, tone, locked }: { label: string; value: string; unit: string; tone: string; locked?: boolean }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "blue" ? "text-blue-600" : "text-slate-700";
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 flex items-center gap-1">{locked && <Lock className="w-3 h-3" />}{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`text-[19px] font-bold tabular-nums tracking-[-0.01em] ${color}`}>{value}</span>
        {unit && <span className="text-[11px] font-semibold text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

// ── Cash Movement (standalone per-currency, not a list) ──────────────────────
function CashMovementTab({ lang, canExport }: { lang: Lang; canExport: boolean }) {
  const [data, setData] = useState<{ note: string; currencies: Array<{ currency: string; customerReceipts: number; vendorPayments: number; netCashMovement: number }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const q = new URLSearchParams(); if (from) q.set("dateFrom", from); if (to) q.set("dateTo", to);
      const res = await apiFetch(`/api/accounting/reports/cash-movement?${q.toString()}`);
      if (res.ok) setData(await res.json());
      else setError((await res.json().catch(() => ({}))).error || "You may not have permission to view cash reports.");
    } catch { setError("Failed to load cash movement."); } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className={`${CARD} p-3 flex items-end gap-3 flex-wrap`}>
        <DateField label={t({ en: "From", tr: "Başlangıç", ar: "من" }, lang)} value={from} onChange={setFrom} />
        <DateField label={t({ en: "To", tr: "Bitiş", ar: "إلى" }, lang)} value={to} onChange={setTo} />
        <div className="flex-1" />
        {canExport && <ExportButtons lang={lang} path="/api/accounting/reports/cash-movement/export" query={() => { const q = new URLSearchParams(); if (from) q.set("dateFrom", from); if (to) q.set("dateTo", to); return q; }} onError={setError} />}
      </div>
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] font-semibold text-amber-700">
        {t({ en: "This is a cash movement report and is NOT the Official Profit calculation.", tr: "Bu bir nakit hareket raporudur, Resmî Kâr hesabı DEĞİLDİR.", ar: "هذا تقرير حركة نقدية وليس حساب الربح الرسمي." }, lang)}
      </div>
      {loading ? <Loading /> : error ? <ErrorState msg={error} onRetry={load} /> : !data || data.currencies.length === 0 ? (
        <EmptyState icon={Scale} title={t({ en: "No cash movement in range", tr: "Kayıt yok", ar: "لا حركة نقدية" }, lang)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.currencies.map((c) => (
            <Panel key={c.currency} title={c.currency}>
              <div className="grid grid-cols-3 gap-3">
                <Metric label={t({ en: "Receipts", tr: "Tahsilat", ar: "المقبوضات" }, lang)} value={CUR(c.customerReceipts)} unit={c.currency} tone="blue" />
                <Metric label={t({ en: "Payments", tr: "Ödemeler", ar: "المدفوعات" }, lang)} value={CUR(c.vendorPayments)} unit={c.currency} tone="slate" />
                <Metric label={t({ en: "Net", tr: "Net", ar: "الصافي" }, lang)} value={CUR(c.netCashMovement)} unit={c.currency} tone={c.netCashMovement >= 0 ? "emerald" : "red"} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Generic list report ──────────────────────────────────────────────────────
interface ColumnDef { key: string; label: { en: string; tr: string; ar: string }; kind?: "money" | "text" | "status" }
const REPORT_COLUMNS: Record<string, { columns: ColumnDef[]; searchLabel: { en: string; tr: string; ar: string }; searchParam: string }> = {
  receivables: {
    searchParam: "customer", searchLabel: { en: "Customer", tr: "Müşteri", ar: "العميل" },
    columns: [
      { key: "invoiceNumber", label: { en: "Invoice", tr: "Fatura", ar: "الفاتورة" } },
      { key: "orderRef", label: { en: "Order", tr: "Sipariş", ar: "الطلب" } },
      { key: "customer", label: { en: "Customer", tr: "Müşteri", ar: "العميل" } },
      { key: "invoiceAmount", label: { en: "Amount", tr: "Tutar", ar: "المبلغ" }, kind: "money" },
      { key: "remainingAmount", label: { en: "Remaining", tr: "Kalan", ar: "المتبقي" }, kind: "money" },
      { key: "currency", label: { en: "Cur.", tr: "PB", ar: "العملة" } },
      { key: "agingBucket", label: { en: "Aging", tr: "Yaşlandırma", ar: "التقادم" }, kind: "status" },
      { key: "financialStatus", label: { en: "Financial", tr: "Mali", ar: "المالي" }, kind: "status" },
    ],
  },
  payables: {
    searchParam: "vendor", searchLabel: { en: "Vendor", tr: "Tedarikçi", ar: "المورد" },
    columns: [
      { key: "vendor", label: { en: "Vendor", tr: "Tedarikçi", ar: "المورد" } },
      { key: "orderRef", label: { en: "Order", tr: "Sipariş", ar: "الطلب" } },
      { key: "description", label: { en: "Description", tr: "Açıklama", ar: "الوصف" } },
      { key: "approvedAmount", label: { en: "Approved", tr: "Onaylı", ar: "المعتمد" }, kind: "money" },
      { key: "remainingAmount", label: { en: "Remaining", tr: "Kalan", ar: "المتبقي" }, kind: "money" },
      { key: "currency", label: { en: "Cur.", tr: "PB", ar: "العملة" } },
      { key: "paymentStatus", label: { en: "Status", tr: "Durum", ar: "الحالة" }, kind: "status" },
    ],
  },
  profit: {
    searchParam: "customer", searchLabel: { en: "Customer", tr: "Müşteri", ar: "العميل" },
    columns: [
      { key: "orderRef", label: { en: "Order", tr: "Sipariş", ar: "الطلب" } },
      { key: "customer", label: { en: "Customer", tr: "Müşteri", ar: "العميل" } },
      { key: "issuedInvoiceTotal", label: { en: "Invoiced", tr: "Fatura", ar: "المفوتر" }, kind: "money" },
      { key: "approvedVendorCost", label: { en: "Approved Cost", tr: "Maliyet", ar: "التكلفة" }, kind: "money" },
      { key: "officialProfit", label: { en: "Profit", tr: "Kâr", ar: "الربح" }, kind: "money" },
      { key: "currency", label: { en: "Cur.", tr: "PB", ar: "العملة" } },
      { key: "profitStatus", label: { en: "Profit Status", tr: "Kâr Durumu", ar: "حالة الربح" }, kind: "status" },
    ],
  },
  "customer-receipts": {
    searchParam: "customer", searchLabel: { en: "Customer", tr: "Müşteri", ar: "العميل" },
    columns: [
      { key: "paymentDate", label: { en: "Date", tr: "Tarih", ar: "التاريخ" } },
      { key: "customer", label: { en: "Customer", tr: "Müşteri", ar: "العميل" } },
      { key: "amount", label: { en: "Amount", tr: "Tutar", ar: "المبلغ" }, kind: "money" },
      { key: "currency", label: { en: "Cur.", tr: "PB", ar: "العملة" } },
      { key: "paymentMethod", label: { en: "Method", tr: "Yöntem", ar: "الطريقة" } },
      { key: "status", label: { en: "Status", tr: "Durum", ar: "الحالة" }, kind: "status" },
    ],
  },
  "vendor-payments": {
    searchParam: "vendor", searchLabel: { en: "Vendor", tr: "Tedarikçi", ar: "المورد" },
    columns: [
      { key: "paymentDate", label: { en: "Date", tr: "Tarih", ar: "التاريخ" } },
      { key: "vendor", label: { en: "Vendor", tr: "Tedarikçi", ar: "المورد" } },
      { key: "orderRef", label: { en: "Order", tr: "Sipariş", ar: "الطلب" } },
      { key: "amount", label: { en: "Amount", tr: "Tutar", ar: "المبلغ" }, kind: "money" },
      { key: "currency", label: { en: "Cur.", tr: "PB", ar: "العملة" } },
      { key: "status", label: { en: "Status", tr: "Durum", ar: "الحالة" }, kind: "status" },
    ],
  },
  "financial-closing": {
    searchParam: "customer", searchLabel: { en: "Customer", tr: "Müşteri", ar: "العميل" },
    columns: [
      { key: "orderRef", label: { en: "Order", tr: "Sipariş", ar: "الطلب" } },
      { key: "customer", label: { en: "Customer", tr: "Müşteri", ar: "العميل" } },
      { key: "financialStatus", label: { en: "Financial Status", tr: "Mali Durum", ar: "الحالة المالية" }, kind: "status" },
      { key: "costStatementStatus", label: { en: "Cost Status", tr: "Maliyet", ar: "حالة التكلفة" }, kind: "status" },
      { key: "closedAt", label: { en: "Closed", tr: "Kapanış", ar: "أُغلق" } },
      { key: "reopenCycleCount", label: { en: "Reopens", tr: "Yeniden", ar: "إعادة" } },
    ],
  },
};

function ListReport({ lang, tabId, canExport }: { lang: Lang; tabId: string; canExport: boolean }) {
  const cfg = REPORT_COLUMNS[tabId];
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [paging, setPaging] = useState({ page: 1, pageSize: 50, totalItems: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [search, setSearch] = useState(""); const [page, setPage] = useState(1);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set("dateFrom", from); if (to) q.set("dateTo", to);
    if (search) q.set(cfg.searchParam, search);
    q.set("page", String(page)); q.set("pageSize", "50");
    return q;
  }, [from, to, search, page, cfg.searchParam]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`/api/accounting/reports/${tabId}?${query.toString()}`);
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows || []); setTotals(d.totals || null);
        setPaging({ page: d.page, pageSize: d.pageSize, totalItems: d.totalItems, totalPages: d.totalPages });
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || (res.status === 403 ? "You do not have permission to view this report." : "Failed to load report."));
        setRows([]);
      }
    } catch { setError("Failed to load report."); } finally { setLoading(false); }
  }, [tabId, query]);
  useEffect(() => { void load(); }, [load]);

  const exportQuery = () => { const q = new URLSearchParams(query); q.delete("page"); q.delete("pageSize"); return q; };

  return (
    <div className="space-y-4">
      <div className={`${CARD} p-3 flex items-end gap-3 flex-wrap`}>
        <DateField label={t({ en: "From", tr: "Başlangıç", ar: "من" }, lang)} value={from} onChange={(v) => { setPage(1); setFrom(v); }} />
        <DateField label={t({ en: "To", tr: "Bitiş", ar: "إلى" }, lang)} value={to} onChange={(v) => { setPage(1); setTo(v); }} />
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{t(cfg.searchLabel, lang)}</label>
          <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className={inputCls} placeholder="…" />
        </div>
        <button onClick={load} className={btnGhost} title="Refresh"><RefreshCw className="w-4 h-4" /></button>
        {canExport && <ExportButtons lang={lang} path={`/api/accounting/reports/${tabId}/export`} query={exportQuery} onError={setError} />}
      </div>

      {/* Per-currency totals */}
      {Array.isArray(totals) && totals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {totals.map((tt: any) => <CurrencyTotalCard key={tt.currency} tabId={tabId} totals={tt} lang={lang} />)}
        </div>
      )}

      {loading ? <Loading /> : error ? <ErrorState msg={error} onRetry={load} /> : rows.length === 0 ? (
        <EmptyState icon={PieChart} title={t({ en: "No records match", tr: "Kayıt yok", ar: "لا سجلات مطابقة" }, lang)} />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                {cfg.columns.map((c) => <th key={c.key} className="text-left font-semibold text-slate-500 px-3 py-2.5 whitespace-nowrap">{t(c.label, lang)}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/40">
                    {cfg.columns.map((c) => (
                      <td key={c.key} className="px-3 py-2.5 whitespace-nowrap">{renderCell(r, c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={paging.page} pageCount={paging.totalPages} total={paging.totalItems}
            from={(paging.page - 1) * paging.pageSize + 1} to={Math.min(paging.page * paging.pageSize, paging.totalItems)}
            labels={{ showing: t({ en: "Showing", tr: "Gösterilen", ar: "عرض" }, lang), of: t({ en: "of", tr: "/", ar: "من" }, lang), page: t({ en: "Page", tr: "Sayfa", ar: "صفحة" }, lang) }}
            onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(paging.totalPages, p + 1))} />
        </div>
      )}
    </div>
  );
}

function renderCell(r: any, c: ColumnDef): ReactNode {
  const v = r[c.key];
  if (v == null || v === "") return <span className="text-slate-300">—</span>;
  if (c.kind === "money") return <span className="tabular-nums font-semibold text-slate-800">{money(Number(v))}</span>;
  if (c.kind === "status") return <StatusPill label={String(v).replace(/_/g, " ")} kind={String(v).includes("paid") || v === "available" || v === "financial_closed" ? "paid" : String(v).includes("partial") ? "partial" : String(v).includes("overdue") || v === "unpaid" ? "unpaid" : "draft"} />;
  return <span className="text-slate-700">{String(v)}</span>;
}

function CurrencyTotalCard({ tabId, totals, lang }: { tabId: string; totals: any; lang: Lang }) {
  const rows: Array<[string, number]> = tabId === "receivables"
    ? [["Invoiced", totals.invoiced], ["Received", totals.received], ["Outstanding", totals.outstanding], ["Overdue", totals.overdue]]
    : tabId === "payables" ? [["Approved", totals.approved], ["Paid", totals.paid], ["Remaining", totals.remaining]]
    : tabId === "profit" ? [["Invoiced", totals.issuedInvoiceTotal], ["Approved Cost", totals.approvedVendorCost], ["Official Profit", totals.officialProfit]]
    : tabId === "customer-receipts" || tabId === "vendor-payments" ? [["Active", totals.active], ["Reversed", totals.reversed]]
    : [];
  if (rows.length === 0) return null;
  return (
    <div className={`${CARD} p-4`}>
      <p className="text-[12px] font-bold text-slate-800 mb-2">{totals.currency}</p>
      <div className="space-y-1">
        {rows.map(([k, val]) => (
          <div key={k} className="flex justify-between text-[12px]"><span className="text-slate-500">{k}</span><span className="tabular-nums font-semibold text-slate-800">{money(Number(val || 0))} {totals.currency}</span></div>
        ))}
      </div>
    </div>
  );
}

// ── Small shared bits ────────────────────────────────────────────────────────
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} w-auto`} />
    </div>
  );
}
/**
 * Export controls (PDF + CSV) — hit the read-only Phase 8 export routes with
 * the current report filters (never just the visible page). Buttons disable
 * while exporting; a controlled error surfaces on failure (403/413/etc.).
 */
export function ExportButtons({ lang, path, query, onError }: { lang: Lang; path: string; query: () => URLSearchParams; onError: (m: string) => void }) {
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const run = async (format: "pdf" | "csv") => {
    if (busy) return;
    setBusy(format); onError("");
    try {
      const q = query(); q.set("format", format);
      const res = await apiFetch(`${path}?${q.toString()}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        onError(d.error || (res.status === 403 ? "You do not have permission to export." : res.status === 413 ? "Report too large — narrow the filters." : "Export failed."));
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      const name = m ? m[1] : `report-${new Date().toISOString().slice(0, 10)}.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { onError("Export failed."); } finally { setBusy(null); }
  };
  return (
    <div className="flex items-center gap-2">
      <button disabled={!!busy} onClick={() => run("pdf")} className={btnGhost} title={t({ en: "Export PDF", tr: "PDF Dışa Aktar", ar: "تصدير PDF" }, lang)}>
        {busy === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}PDF
      </button>
      <button disabled={!!busy} onClick={() => run("csv")} className={btnGhost} title={t({ en: "Export CSV", tr: "CSV Dışa Aktar", ar: "تصدير CSV" }, lang)}>
        {busy === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}CSV
      </button>
    </div>
  );
}

function Loading() { return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>; }
function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-center">
      <p className="text-[13px] font-semibold text-red-700">{msg}</p>
      <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 text-[12px] font-semibold rounded-lg cursor-pointer"><RefreshCw className="w-3.5 h-3.5" />Retry</button>
    </div>
  );
}
