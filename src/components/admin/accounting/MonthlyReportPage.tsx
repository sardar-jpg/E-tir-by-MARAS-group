import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  Loader2, FileText, FileSpreadsheet, Printer, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import type { Language, Client, CostStatement, Currency } from "../../../types";
import { useAccountingDataset } from "./useAccountingDataset";
import {
  computeMonthlyFigures, monthlyComparison, prevMonthKey, reportCurrencies,
  topCustomersByRevenue, topExpenseCategories, type MonthlyInput, type Delta,
} from "../../../lib/monthlyReport";
import { PageHeader, Panel, EmptyState, money, btnGhost, CARD } from "./AccountingUI";

const MONTHS: { en: string; tr: string; ar: string }[] = [
  { en: "January", tr: "Ocak", ar: "يناير" }, { en: "February", tr: "Şubat", ar: "فبراير" }, { en: "March", tr: "Mart", ar: "مارس" },
  { en: "April", tr: "Nisan", ar: "أبريل" }, { en: "May", tr: "Mayıs", ar: "مايو" }, { en: "June", tr: "Haziran", ar: "يونيو" },
  { en: "July", tr: "Temmuz", ar: "يوليو" }, { en: "August", tr: "Ağustos", ar: "أغسطس" }, { en: "September", tr: "Eylül", ar: "سبتمبر" },
  { en: "October", tr: "Ekim", ar: "أكتوبر" }, { en: "November", tr: "Kasım", ar: "نوفمبر" }, { en: "December", tr: "Aralık", ar: "ديسمبر" },
];
const T = {
  title: { en: "Monthly Financial Report", tr: "Aylık Mali Rapor", ar: "التقرير المالي الشهري" },
  subtitle: { en: "A clean, printable monthly summary with a previous-month comparison. One currency at a time.", tr: "Bir önceki ayla karşılaştırmalı, yazdırılabilir aylık özet. Tek para birimi.", ar: "ملخص شهري نظيف قابل للطباعة مع مقارنة بالشهر السابق. عملة واحدة." },
  month: { en: "Month", tr: "Ay", ar: "الشهر" },
  year: { en: "Year", tr: "Yıl", ar: "السنة" },
  currency: { en: "Currency", tr: "Para Birimi", ar: "العملة" },
  revenue: { en: "Total Revenue", tr: "Toplam Gelir", ar: "إجمالي الإيرادات" },
  expenses: { en: "Total Expenses", tr: "Toplam Gider", ar: "إجمالي المصروفات" },
  profit: { en: "Gross Profit", tr: "Brüt Kâr", ar: "إجمالي الربح" },
  received: { en: "Payments Received", tr: "Alınan Ödemeler", ar: "المدفوعات المقبوضة" },
  vendorPaid: { en: "Vendor Payments", tr: "Tedarikçi Ödemeleri", ar: "مدفوعات الموردين" },
  closingRec: { en: "Closing Receivables", tr: "Kapanış Alacakları", ar: "الذمم المدينة الختامية" },
  closingPay: { en: "Closing Payables", tr: "Kapanış Borçları", ar: "الذمم الدائنة الختامية" },
  totalOrders: { en: "Total Orders", tr: "Toplam Sipariş", ar: "إجمالي الطلبات" },
  completed: { en: "Completed Orders", tr: "Tamamlanan", ar: "الطلبات المكتملة" },
  openOrders: { en: "Open Orders", tr: "Açık Sipariş", ar: "الطلبات المفتوحة" },
  vsPrev: { en: "vs previous month", tr: "önceki aya göre", ar: "مقارنة بالشهر السابق" },
  comparison: { en: "Comparison with Previous Month", tr: "Önceki Ay ile Karşılaştırma", ar: "مقارنة بالشهر السابق" },
  revVsExp: { en: "Revenue vs Expenses", tr: "Gelir ve Gider", ar: "الإيرادات مقابل المصروفات" },
  topCustomers: { en: "Top 5 Customers by Revenue", tr: "Gelire Göre İlk 5 Müşteri", ar: "أفضل 5 عملاء بالإيرادات" },
  topExpenses: { en: "Top 5 Expense Categories", tr: "İlk 5 Gider Kategorisi", ar: "أفضل 5 فئات مصروفات" },
  thisMonth: { en: "This month", tr: "Bu ay", ar: "هذا الشهر" },
  lastMonth: { en: "Last month", tr: "Geçen ay", ar: "الشهر الماضي" },
  none: { en: "No accounting data for the selected month.", tr: "Seçilen ay için veri yok.", ar: "لا توجد بيانات للشهر المحدد." },
  generated: { en: "Generated", tr: "Oluşturuldu", ar: "أُنشئ في" },
  reportFor: { en: "Report for", tr: "Rapor dönemi", ar: "تقرير عن" },
};
const t = (o: { en: string; tr: string; ar: string }, lang: Language) => o[lang] || o.en;
const mm = (n: number) => String(n).padStart(2, "0");

function csvDownload(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function MonthlyReportPage({ lang, clients, costStatements }: { lang: Language; clients: Client[]; costStatements: CostStatement[] }) {
  const ds = useAccountingDataset(clients, costStatements);
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [ccy, setCcy] = useState<string>("");

  const currencies = useMemo(() => reportCurrencies(ds.invoices, costStatements), [ds.invoices, costStatements]);
  const cur = (ccy || currencies.find((c) => c === "USD") || currencies[0] || "USD") as Currency;
  const monthKey = `${year}-${mm(month)}`;

  const input: MonthlyInput = useMemo(() => ({
    invoices: ds.invoices, customerPayments: ds.customerPayments, vendorPayments: ds.vendorPayments, costStatements,
  }), [ds.invoices, ds.customerPayments, ds.vendorPayments, costStatements]);

  const figures = useMemo(() => computeMonthlyFigures(input, cur, monthKey), [input, cur, monthKey]);
  const prev = useMemo(() => computeMonthlyFigures(input, cur, prevMonthKey(monthKey)), [input, cur, monthKey]);
  const cmp = useMemo(() => monthlyComparison(figures, prev), [figures, prev]);
  const topCust = useMemo(() => topCustomersByRevenue(ds.invoices, cur, monthKey), [ds.invoices, cur, monthKey]);
  const topExp = useMemo(() => topExpenseCategories(costStatements, cur, monthKey), [costStatements, cur, monthKey]);

  const monthLabel = `${t(MONTHS[month - 1], lang)} ${year}`;
  const chartData = [
    { name: t(T.lastMonth, lang), Revenue: prev.totalRevenue, Expenses: prev.totalExpenses },
    { name: t(T.thisMonth, lang), Revenue: figures.totalRevenue, Expenses: figures.totalExpenses },
  ];

  const exportCsv = () => {
    csvDownload(`monthly-report-${monthKey}-${cur}.csv`, [
      ["MARAS Group — Monthly Financial Report"],
      [t(T.reportFor, lang), monthLabel], [t(T.currency, lang), cur], [t(T.generated, lang), new Date().toISOString().slice(0, 10)],
      [],
      ["Figure", "This Month", "Last Month"],
      [t(T.revenue, lang), figures.totalRevenue, prev.totalRevenue],
      [t(T.expenses, lang), figures.totalExpenses, prev.totalExpenses],
      [t(T.profit, lang), figures.grossProfit, prev.grossProfit],
      [t(T.received, lang), figures.customerReceived, prev.customerReceived],
      [t(T.vendorPaid, lang), figures.vendorPaid, prev.vendorPaid],
      [t(T.closingRec, lang), figures.closingReceivables, ""],
      [t(T.closingPay, lang), figures.closingPayables, ""],
      [t(T.totalOrders, lang), figures.totalOrders, ""],
      [t(T.completed, lang), figures.completedOrders, ""],
      [t(T.openOrders, lang), figures.openOrders, ""],
      [],
      [t(T.topCustomers, lang)], ...topCust.map((r) => [r.name, r.amount]),
      [],
      [t(T.topExpenses, lang)], ...topExp.map((r) => [r.name, r.amount]),
    ]);
  };

  const exportPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const L = 16; let y = 18;
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, 210, 26, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("MARAS Group", L, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("Monthly Financial Report", L, 21);
    doc.setTextColor(30, 41, 59); y = 36;
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text(`${monthLabel}  ·  ${cur}`, L, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(120, 130, 145);
    doc.text(`${t(T.generated, lang)}: ${new Date().toISOString().slice(0, 10)}`, 210 - L, y, { align: "right" });
    doc.setTextColor(30, 41, 59); y += 8;
    const row = (label: string, val: string, strong = false) => {
      doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setFontSize(strong ? 10 : 9.5);
      doc.text(label, L, y); doc.text(val, 210 - L, y, { align: "right" }); y += strong ? 7.5 : 6.5;
    };
    const line = () => { doc.setDrawColor(226, 232, 240); doc.line(L, y - 3, 210 - L, y - 3); };
    row(t(T.revenue, lang), `${money(figures.totalRevenue)} ${cur}`, true);
    row(t(T.expenses, lang), `${money(figures.totalExpenses)} ${cur}`);
    row(t(T.profit, lang), `${money(figures.grossProfit)} ${cur}`, true); line();
    row(t(T.received, lang), `${money(figures.customerReceived)} ${cur}`);
    row(t(T.vendorPaid, lang), `${money(figures.vendorPaid)} ${cur}`); line();
    row(t(T.closingRec, lang), `${money(figures.closingReceivables)} ${cur}`);
    row(t(T.closingPay, lang), `${money(figures.closingPayables)} ${cur}`); line();
    row(t(T.totalOrders, lang), String(figures.totalOrders));
    row(t(T.completed, lang), String(figures.completedOrders));
    row(t(T.openOrders, lang), String(figures.openOrders));
    y += 4; doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(t(T.comparison, lang), L, y); y += 6.5;
    const pct = (d: Delta) => (d.pct === null ? "—" : `${d.pct > 0 ? "+" : ""}${d.pct}%`);
    row(t(T.revenue, lang), `${cmp.revenue.amount >= 0 ? "+" : ""}${money(cmp.revenue.amount)} ${cur}  (${pct(cmp.revenue)})`);
    row(t(T.expenses, lang), `${cmp.expenses.amount >= 0 ? "+" : ""}${money(cmp.expenses.amount)} ${cur}  (${pct(cmp.expenses)})`);
    row(t(T.profit, lang), `${cmp.profit.amount >= 0 ? "+" : ""}${money(cmp.profit.amount)} ${cur}  (${pct(cmp.profit)})`);
    y += 4; doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(t(T.topCustomers, lang), L, y); y += 6.5;
    topCust.forEach((r) => row(r.name, `${money(r.amount)} ${cur}`));
    if (!topCust.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.text("—", L, y); y += 6.5; }
    y += 4; doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(t(T.topExpenses, lang), L, y); y += 6.5;
    topExp.forEach((r) => row(r.name, `${money(r.amount)} ${cur}`));
    if (!topExp.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.text("—", L, y); }
    doc.save(`monthly-report-${monthKey}-${cur}.pdf`);
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getUTCFullYear() - 3 + i);
  const hasData = figures.totalRevenue || figures.totalExpenses || figures.totalOrders || figures.customerReceived || figures.vendorPaid;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(T.title, lang)}
        subtitle={t(T.subtitle, lang)}
        actions={
          <>
            <button onClick={exportCsv} className={btnGhost}><FileSpreadsheet className="w-4 h-4 text-emerald-600" />Excel</button>
            <button onClick={() => window.print()} className={btnGhost}><Printer className="w-4 h-4 text-slate-500" />{t({ en: "Print", tr: "Yazdır", ar: "طباعة" }, lang)}</button>
            <button onClick={exportPdf} className={btnGhost}><FileText className="w-4 h-4 text-red-500" />PDF</button>
          </>
        }
      />

      {/* Filters */}
      <Panel bodyClassName="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
          <Field label={t(T.month, lang)}>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={selectCls}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{t(m, lang)}</option>)}
            </select>
          </Field>
          <Field label={t(T.year, lang)}>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label={t(T.currency, lang)}>
            <select value={cur} onChange={(e) => setCcy(e.target.value)} className={selectCls}>
              {(currencies.length ? currencies : [cur]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      </Panel>

      {ds.loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !hasData ? (
        <EmptyState icon={FileText} title={t(T.none, lang)} body={monthLabel} />
      ) : (
        <div className="space-y-5">
          {/* Report identity strip */}
          <div className={`${CARD} px-5 py-4 flex items-center justify-between gap-4 flex-wrap`}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">{t(T.reportFor, lang)}</p>
              <p className="text-[18px] font-bold text-slate-900 tracking-tight">{monthLabel} · {cur}</p>
            </div>
            <p className="text-[11.5px] text-slate-400">{t(T.generated, lang)}: <span className="font-semibold text-slate-500 tabular-nums">{new Date().toISOString().slice(0, 10)}</span></p>
          </div>

          {/* Main summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Metric label={t(T.revenue, lang)} value={money(figures.totalRevenue)} unit={cur} tone="blue" strong />
            <Metric label={t(T.expenses, lang)} value={money(figures.totalExpenses)} unit={cur} tone="amber" strong />
            <Metric label={t(T.profit, lang)} value={money(figures.grossProfit)} unit={cur} tone={figures.grossProfit < 0 ? "red" : "emerald"} strong />
            <Metric label={t(T.received, lang)} value={money(figures.customerReceived)} unit={cur} tone="emerald" />
            <Metric label={t(T.vendorPaid, lang)} value={money(figures.vendorPaid)} unit={cur} tone="amber" />
            <Metric label={t(T.closingRec, lang)} value={money(figures.closingReceivables)} unit={cur} tone="slate" />
            <Metric label={t(T.closingPay, lang)} value={money(figures.closingPayables)} unit={cur} tone="slate" />
            <Metric label={t(T.totalOrders, lang)} value={String(figures.totalOrders)} tone="slate" />
            <Metric label={t(T.completed, lang)} value={String(figures.completedOrders)} tone="emerald" />
            <Metric label={t(T.openOrders, lang)} value={String(figures.openOrders)} tone="blue" />
          </div>

          {/* Comparison + chart */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Panel title={t(T.comparison, lang)}>
              <div className="space-y-2.5">
                <DeltaRow label={t(T.revenue, lang)} d={cmp.revenue} cur={cur} goodUp />
                <DeltaRow label={t(T.expenses, lang)} d={cmp.expenses} cur={cur} goodUp={false} />
                <DeltaRow label={t(T.profit, lang)} d={cmp.profit} cur={cur} goodUp />
              </div>
            </Panel>
            <Panel title={`${t(T.revVsExp, lang)} · ${cur}`}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)} />
                    <Tooltip formatter={(v: any) => `${money(Number(v))} ${cur}`} contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid #e2e8f0" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={46} />
                    <Bar dataKey="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={46} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          {/* Top lists */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <RankPanel title={t(T.topCustomers, lang)} rows={topCust} cur={cur} tone="blue" />
            <RankPanel title={t(T.topExpenses, lang)} rows={topExp} cur={cur} tone="amber" />
          </div>
        </div>
      )}
    </div>
  );
}

const selectCls = "w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition cursor-pointer";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 mb-1.5">{label}</label>{children}</div>;
}
const TONE: Record<string, string> = { blue: "text-blue-600", amber: "text-amber-600", emerald: "text-emerald-600", red: "text-red-600", slate: "text-slate-800" };
function Metric({ label, value, unit, tone, strong }: { label: string; value: string; unit?: string; tone: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border ${strong ? "border-slate-200" : "border-slate-100"} bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 leading-tight">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`${strong ? "text-[20px]" : "text-[17px]"} font-bold tabular-nums tracking-[-0.01em] ${TONE[tone]}`}>{value}</span>
        {unit && <span className="text-[10.5px] font-semibold text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
function DeltaRow({ label, d, cur, goodUp }: { label: string; d: Delta; cur: string; goodUp: boolean }) {
  const up = d.amount > 0.005, down = d.amount < -0.005;
  const good = (up && goodUp) || (down && !goodUp);
  const cls = up || down ? (good ? "text-emerald-600" : "text-red-600") : "text-slate-400";
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-3.5 py-2.5">
      <div>
        <p className="text-[12px] font-semibold text-slate-700">{label}</p>
        <p className="text-[11px] text-slate-400 tabular-nums">{money(d.previous)} → {money(d.current)} {cur}</p>
      </div>
      <div className={`text-right ${cls}`}>
        <p className="text-[13.5px] font-bold tabular-nums flex items-center gap-1 justify-end"><Icon className="w-3.5 h-3.5" />{d.amount >= 0 ? "+" : ""}{money(d.amount)}</p>
        <p className="text-[11px] font-semibold tabular-nums">{d.pct === null ? "—" : `${d.pct > 0 ? "+" : ""}${d.pct}%`}</p>
      </div>
    </div>
  );
}
function RankPanel({ title, rows, cur, tone }: { title: string; rows: { name: string; amount: number }[]; cur: string; tone: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Panel title={title}>
      {rows.length === 0 ? <p className="text-[12.5px] text-slate-400">—</p> : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={i}>
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="font-semibold text-slate-700 truncate">{i + 1}. {r.name}</span>
                <span className="tabular-nums font-bold text-slate-800 shrink-0">{money(r.amount)} <span className="text-[10px] text-slate-400">{cur}</span></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${tone === "blue" ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${Math.round((r.amount / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
