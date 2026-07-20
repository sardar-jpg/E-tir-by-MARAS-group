import { useMemo, useState } from "react";
import {
  ArrowDownCircle, ArrowUpCircle, AlertTriangle, Loader2, Search, X, ExternalLink, Users, Building2, RefreshCw,
} from "lucide-react";
import type { Language, Client, CostStatement } from "../../../types";
import {
  buildReceivableRows, buildPayableRows, summarizeAging, filterAgingRows,
  type ReceivableRow, type PayableRow, type AgingBuckets, type ArStatus, type AgingFilter,
} from "../../../lib/receivablesPayables";
import { useAccountingDataset } from "./useAccountingDataset";
import { PageHeader, Panel, KpiCard, EmptyState, money, btnGhost, inputCls } from "./AccountingUI";

const T = {
  title: { en: "Receivables & Payables", tr: "Alacaklar ve Borçlar", ar: "الذمم المدينة والدائنة" },
  subtitle: { en: "Management overview of what customers owe MARAS and what MARAS owes vendors — with aging. Currencies are never combined.", tr: "Müşteri alacakları ve tedarikçi borçlarının yaşlandırmalı yönetim özeti. Para birimleri birleştirilmez.", ar: "نظرة إدارية على مستحقات العملاء والتزامات الموردين مع التقادم. لا تُدمج العملات." },
  tabAr: { en: "Customer Receivables", tr: "Müşteri Alacakları", ar: "ذمم العملاء" },
  tabAp: { en: "Vendor Payables", tr: "Tedarikçi Borçları", ar: "ذمم الموردين" },
  totalRec: { en: "Total Receivables", tr: "Toplam Alacak", ar: "إجمالي المدينة" },
  overdueRec: { en: "Overdue Receivables", tr: "Gecikmiş Alacak", ar: "المدينة المتأخرة" },
  totalPay: { en: "Total Payables", tr: "Toplam Borç", ar: "إجمالي الدائنة" },
  overduePay: { en: "Overdue Payables", tr: "Gecikmiş Borç", ar: "الدائنة المتأخرة" },
  aging: { en: "Aging", tr: "Yaşlandırma", ar: "التقادم" },
  current: { en: "Current", tr: "Güncel", ar: "حالي" },
  d1: { en: "1–30 Days", tr: "1–30 Gün", ar: "1–30 يوم" },
  d2: { en: "31–60 Days", tr: "31–60 Gün", ar: "31–60 يوم" },
  d3: { en: "61–90 Days", tr: "61–90 Gün", ar: "61–90 يوم" },
  d4: { en: "90+ Days", tr: "90+ Gün", ar: "90+ يوم" },
  search: { en: "Search…", tr: "Ara…", ar: "بحث…" },
  allCur: { en: "All currencies", tr: "Tüm para birimleri", ar: "كل العملات" },
  allStatus: { en: "All statuses", tr: "Tüm durumlar", ar: "كل الحالات" },
  allDue: { en: "Due & overdue", tr: "Vadeli ve gecikmiş", ar: "مستحق ومتأخر" },
  onlyDue: { en: "Due only", tr: "Sadece vadeli", ar: "المستحق فقط" },
  onlyOverdue: { en: "Overdue only", tr: "Sadece gecikmiş", ar: "المتأخر فقط" },
  customer: { en: "Customer", tr: "Müşteri", ar: "العميل" },
  vendor: { en: "Vendor", tr: "Tedarikçi", ar: "المورد" },
  cur: { en: "Currency", tr: "Para Birimi", ar: "العملة" },
  invoiced: { en: "Invoiced", tr: "Faturalanan", ar: "المفوتر" },
  bills: { en: "Bills", tr: "Faturalar", ar: "الفواتير" },
  received: { en: "Received", tr: "Alınan", ar: "المقبوض" },
  paid: { en: "Paid", tr: "Ödenen", ar: "المدفوع" },
  outstanding: { en: "Outstanding", tr: "Bakiye", ar: "المستحق" },
  due: { en: "Due", tr: "Vadeli", ar: "مستحق" },
  overdue: { en: "Overdue", tr: "Gecikmiş", ar: "متأخر" },
  oldest: { en: "Oldest Unpaid", tr: "En Eski", ar: "الأقدم" },
  status: { en: "Status", tr: "Durum", ar: "الحالة" },
  open: { en: "Open statement", tr: "Ekstreyi aç", ar: "فتح الكشف" },
  noneAr: { en: "No customer receivables.", tr: "Müşteri alacağı yok.", ar: "لا ذمم عملاء." },
  noneAp: { en: "No vendor payables.", tr: "Tedarikçi borcu yok.", ar: "لا ذمم موردين." },
  noMatch: { en: "No rows match your filters.", tr: "Filtreyle eşleşen satır yok.", ar: "لا صفوف مطابقة." },
  refresh: { en: "Refresh", tr: "Yenile", ar: "تحديث" },
};
const t = (o: { en: string; tr: string; ar: string }, lang: Language) => o[lang] || o.en;

const STATUS: Record<ArStatus, { label: { en: string; tr: string; ar: string }; cls: string }> = {
  current: { label: { en: "Current", tr: "Güncel", ar: "حالي" }, cls: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  due_soon: { label: { en: "Due Soon", tr: "Vadesi Yakın", ar: "يستحق قريباً" }, cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  overdue: { label: { en: "Overdue", tr: "Gecikmiş", ar: "متأخر" }, cls: "bg-red-50 text-red-700 ring-red-600/20" },
  partially_paid: { label: { en: "Partial", tr: "Kısmi", ar: "جزئي" }, cls: "bg-violet-50 text-violet-700 ring-violet-600/20" },
  paid: { label: { en: "Paid", tr: "Ödendi", ar: "مدفوع" }, cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
};
const ALL_STATUSES: ArStatus[] = ["current", "due_soon", "overdue", "partially_paid", "paid"];

function StatusChip({ s, lang }: { s: ArStatus; lang: Language }) {
  const d = STATUS[s];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wide ring-1 ring-inset ${d.cls}`}>{t(d.label, lang)}</span>;
}

export default function ReceivablesPayablesPage({ lang, clients, costStatements, onNavigate }: {
  lang: Language; clients: Client[]; costStatements: CostStatement[]; onNavigate?: (tab: string, ref?: string) => void;
}) {
  const ds = useAccountingDataset(clients, costStatements);
  const nowIso = new Date().toISOString();
  const [tab, setTab] = useState<"ar" | "ap">("ar");
  const [ccy, setCcy] = useState<string>("");
  const [query, setQuery] = useState("");
  const [statusF, setStatusF] = useState<string>("");
  const [dueF, setDueF] = useState<"all" | "due" | "overdue">("all");

  const arRows = useMemo(() => buildReceivableRows(ds.customers, nowIso), [ds.customers]); // eslint-disable-line react-hooks/exhaustive-deps
  const apRows = useMemo(() => buildPayableRows(ds.vendorBills, nowIso), [ds.vendorBills]); // eslint-disable-line react-hooks/exhaustive-deps

  const arSummary = useMemo(() => summarizeAging(arRows), [arRows]);
  const apSummary = useMemo(() => summarizeAging(apRows), [apRows]);
  const currencies = useMemo(() => [...new Set([...arSummary.map((s) => s.currency), ...apSummary.map((s) => s.currency)])].sort(), [arSummary, apSummary]);
  const activeCur = ccy || currencies.find((c) => c === "USD") || currencies[0] || "";

  const arSum = arSummary.find((s) => s.currency === activeCur);
  const apSum = apSummary.find((s) => s.currency === activeCur);
  const activeAging: AgingBuckets | undefined = (tab === "ar" ? arSum : apSum)?.aging;

  const filter: AgingFilter = { query, currency: ccy, status: statusF, due: dueF };
  const arFiltered = useMemo(() => filterAgingRows(arRows, filter), [arRows, query, ccy, statusF, dueF]); // eslint-disable-line react-hooks/exhaustive-deps
  const apFiltered = useMemo(() => filterAgingRows(apRows, filter), [apRows, query, ccy, statusF, dueF]); // eslint-disable-line react-hooks/exhaustive-deps

  const TabButton = ({ id, icon: Icon, label }: { id: "ar" | "ap"; icon: React.ComponentType<{ className?: string }>; label: string }) => (
    <button onClick={() => setTab(id)} className={`inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold rounded-lg cursor-pointer border transition-all ${tab === id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>
      <Icon className="w-4 h-4" />{label}
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(T.title, lang)}
        subtitle={t(T.subtitle, lang)}
        actions={
          <div className="flex items-center gap-2">
            {currencies.length > 1 && (
              <select value={ccy} onChange={(e) => setCcy(e.target.value)} className="text-[12.5px] font-semibold text-slate-700 border border-slate-200 rounded-lg pl-3 pr-8 py-2 bg-white cursor-pointer hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition">
                <option value="">{t(T.allCur, lang)}</option>
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button onClick={ds.reload} className={btnGhost}><RefreshCw className="w-4 h-4" /><span className="hidden sm:inline">{t(T.refresh, lang)}</span></button>
          </div>
        }
      />

      {/* Summary cards (active currency) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={ArrowDownCircle} tone="blue" label={t(T.totalRec, lang)} value={money(arSum?.totalOutstanding || 0)} unit={activeCur} subTone="muted" />
        <KpiCard icon={AlertTriangle} tone={arSum && arSum.totalOverdue > 0 ? "red" : "slate"} label={t(T.overdueRec, lang)} value={money(arSum?.totalOverdue || 0)} unit={activeCur} subTone={arSum && arSum.totalOverdue > 0 ? "down" : "muted"} />
        <KpiCard icon={ArrowUpCircle} tone="amber" label={t(T.totalPay, lang)} value={money(apSum?.totalOutstanding || 0)} unit={activeCur} subTone="muted" />
        <KpiCard icon={AlertTriangle} tone={apSum && apSum.totalOverdue > 0 ? "red" : "slate"} label={t(T.overduePay, lang)} value={money(apSum?.totalOverdue || 0)} unit={activeCur} subTone={apSum && apSum.totalOverdue > 0 ? "down" : "muted"} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <TabButton id="ar" icon={Users} label={t(T.tabAr, lang)} />
        <TabButton id="ap" icon={Building2} label={t(T.tabAp, lang)} />
      </div>

      {/* Aging strip */}
      {activeAging && (
        <Panel title={`${t(T.aging, lang)} · ${activeCur}`} bodyClassName="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {([["current", T.current, "text-slate-700"], ["d1_30", T.d1, "text-amber-600"], ["d31_60", T.d2, "text-amber-700"], ["d61_90", T.d3, "text-red-600"], ["d90plus", T.d4, "text-red-700"]] as const).map(([k, lbl, cls]) => (
              <div key={k} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t(lbl, lang)}</p>
                <p className={`mt-1 text-[15px] font-bold tabular-nums ${cls}`}>{money(activeAging[k])}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Filters */}
      <Panel bodyClassName="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(T.search, lang)} className={`${inputCls} pl-8 pr-7`} />
            {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer bg-transparent border-0 p-0"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${inputCls} w-auto`}>
            <option value="">{t(T.allStatus, lang)}</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{t(STATUS[s].label, lang)}</option>)}
          </select>
          <select value={dueF} onChange={(e) => setDueF(e.target.value as any)} className={`${inputCls} w-auto`}>
            <option value="all">{t(T.allDue, lang)}</option>
            <option value="due">{t(T.onlyDue, lang)}</option>
            <option value="overdue">{t(T.onlyOverdue, lang)}</option>
          </select>
        </div>
      </Panel>

      {/* Table */}
      {ds.loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : tab === "ar" ? (
        <RowTable
          lang={lang} kind="ar"
          rows={arFiltered} allEmpty={arRows.length === 0}
          onOpen={(name) => onNavigate?.("acct_customer_statements", name)}
        />
      ) : (
        <RowTable
          lang={lang} kind="ap"
          rows={apFiltered} allEmpty={apRows.length === 0}
          onOpen={(name) => onNavigate?.("acct_vendor_statements", name)}
        />
      )}
    </div>
  );
}

function RowTable({ lang, kind, rows, allEmpty, onOpen }: {
  lang: Language; kind: "ar" | "ap"; rows: (ReceivableRow | PayableRow)[]; allEmpty: boolean; onOpen: (name: string) => void;
}) {
  if (allEmpty) return <EmptyState icon={kind === "ar" ? Users : Building2} title={t(kind === "ar" ? T.noneAr : T.noneAp, lang)} />;
  if (rows.length === 0) return <EmptyState icon={Search} title={t(T.noMatch, lang)} />;
  const nameCol = kind === "ar" ? t(T.customer, lang) : t(T.vendor, lang);
  const totalCol = kind === "ar" ? t(T.invoiced, lang) : t(T.bills, lang);
  const settledCol = kind === "ar" ? t(T.received, lang) : t(T.paid, lang);
  return (
    <Panel bodyClassName="p-0">
      <div className="overflow-auto max-h-[600px]">
        <table className="w-full text-[12.5px] min-w-[920px] border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-slate-500">
              {[nameCol, t(T.cur, lang)].map((h, i) => <th key={i} className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200 first:pl-5">{h}</th>)}
              {[totalCol, settledCol, t(T.outstanding, lang), t(T.due, lang), t(T.overdue, lang)].map((h, i) => <th key={i} className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.05em] text-right border-b border-slate-200">{h}</th>)}
              {[t(T.oldest, lang), t(T.status, lang), ""].map((h, i) => <th key={i} className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200 last:pr-5">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const name = "customer" in r ? r.customer : r.vendor;
              const total = "totalInvoiced" in r ? r.totalInvoiced : r.totalBills;
              const settled = "totalReceived" in r ? r.totalReceived : r.totalPaid;
              return (
                <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 pl-5 font-semibold text-slate-800 border-b border-slate-50 max-w-[220px] truncate">{name}</td>
                  <td className="py-3 px-4 border-b border-slate-50"><span className="font-mono text-[11.5px] text-slate-500">{r.currency}</span></td>
                  <td className="py-3 px-4 text-right border-b border-slate-50 tabular-nums text-slate-600">{money(total)}</td>
                  <td className="py-3 px-4 text-right border-b border-slate-50 tabular-nums text-emerald-600">{money(settled)}</td>
                  <td className="py-3 px-4 text-right border-b border-slate-50 tabular-nums font-bold text-slate-900">{money(r.outstanding)}</td>
                  <td className="py-3 px-4 text-right border-b border-slate-50 tabular-nums text-slate-600">{r.dueAmount ? money(r.dueAmount) : <span className="text-slate-300">—</span>}</td>
                  <td className={`py-3 px-4 text-right border-b border-slate-50 tabular-nums font-semibold ${r.overdueAmount > 0 ? "text-red-600" : "text-slate-300"}`}>{r.overdueAmount ? money(r.overdueAmount) : "—"}</td>
                  <td className="py-3 px-4 border-b border-slate-50 whitespace-nowrap text-slate-500 tabular-nums">{r.oldestUnpaidDate || "—"}</td>
                  <td className="py-3 px-4 border-b border-slate-50"><StatusChip s={r.status} lang={lang} /></td>
                  <td className="py-3 px-4 pr-5 border-b border-slate-50 text-right">
                    <button onClick={() => onOpen(name)} title={t(T.open, lang)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-0 p-0"><ExternalLink className="w-3.5 h-3.5" /><span className="hidden lg:inline">{t(T.open, lang)}</span></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
