import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, TrendingUp, ArrowDownCircle, ArrowUpCircle, FileBarChart, AlertTriangle,
  Sparkles, ArrowRight, Wallet,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from "recharts";
import type { Language, Client, CostStatement } from "../../../types";
import type { CurrencyFinanceOverview, ExecutiveFinanceOverview } from "../../../lib/executiveFinance";
import { apiFetch } from "../../../lib/api";
import { monthlyRevenueProfit, expenseByCategory, recentStatements, totalExpenses } from "../../../lib/accountingDashboard";
import { useAccountingDataset } from "./useAccountingDataset";
import { PageHeader, KpiCard, Panel, StatusPill, money, EmptyState, btnGhost } from "./AccountingUI";

const T = {
  title: { en: "Accounting Dashboard", tr: "Muhasebe Panosu", ar: "لوحة المحاسبة" },
  subtitle: { en: "Executive financial overview — every figure comes directly from the accounting records, per currency.", tr: "Yönetici finansal genel bakış — her rakam doğrudan muhasebe kayıtlarından gelir.", ar: "نظرة مالية تنفيذية — كل رقم يأتي مباشرة من سجلات المحاسبة، حسب العملة." },
  revenue: { en: "Total Revenue", tr: "Toplam Gelir", ar: "إجمالي الإيرادات" },
  grossProfit: { en: "Gross Profit", tr: "Brüt Kâr", ar: "إجمالي الربح" },
  receivables: { en: "Receivables", tr: "Alacaklar", ar: "الذمم المدينة" },
  payables: { en: "Payables", tr: "Borçlar", ar: "الذمم الدائنة" },
  openStatements: { en: "Open Statements", tr: "Açık Tablolar", ar: "كشوف مفتوحة" },
  thisMonth: { en: "this month", tr: "bu ay", ar: "هذا الشهر" },
  overdue: { en: "overdue", tr: "gecikmiş", ar: "متأخرة" },
  vendorShare: { en: "vendor payables", tr: "tedarikçi borçları", ar: "مستحقات الموردين" },
  requiresAttention: { en: "Requires attention", tr: "Dikkat gerektirir", ar: "يتطلب انتباهاً" },
  allSettled: { en: "All settled", tr: "Hepsi kapandı", ar: "الكل مسوّى" },
  revVsProfit: { en: "Revenue vs Profit (Last 6 Months)", tr: "Gelir ve Kâr (Son 6 Ay)", ar: "الإيرادات مقابل الربح (آخر 6 أشهر)" },
  expenses: { en: "Expenses by Category", tr: "Kategoriye Göre Giderler", ar: "المصروفات حسب الفئة" },
  alerts: { en: "Financial Alerts", tr: "Finansal Uyarılar", ar: "تنبيهات مالية" },
  noAlerts: { en: "No open financial alerts.", tr: "Açık finansal uyarı yok.", ar: "لا توجد تنبيهات مالية مفتوحة." },
  recent: { en: "Recent Cost Statements", tr: "Son Maliyet Tabloları", ar: "أحدث بيانات التكلفة" },
  viewAll: { en: "View all", tr: "Tümünü gör", ar: "عرض الكل" },
  order: { en: "Order", tr: "Sipariş", ar: "الطلب" },
  customer: { en: "Customer", tr: "Müşteri", ar: "العميل" },
  cost: { en: "Cost", tr: "Maliyet", ar: "التكلفة" },
  status: { en: "Status", tr: "Durum", ar: "الحالة" },
  noStatements: { en: "No cost statements yet.", tr: "Henüz maliyet tablosu yok.", ar: "لا توجد بيانات تكلفة بعد." },
  aiTitle: { en: "MARAS AI Financial Assistant", tr: "MARAS AI Mali Asistanı", ar: "المساعد المالي الذكي MARAS" },
  aiBody: { en: "Daily summaries, risk detection, cash-flow forecasts and smart recommendations.", tr: "Günlük özetler, risk tespiti, nakit akışı tahminleri ve akıllı öneriler.", ar: "ملخصات يومية، كشف المخاطر، توقعات التدفق النقدي وتوصيات ذكية." },
  openAi: { en: "Open AI Assistant", tr: "AI Asistanını Aç", ar: "افتح المساعد" },
  loadError: { en: "Could not load the financial overview.", tr: "Finansal özet yüklenemedi.", ar: "تعذّر تحميل النظرة المالية." },
  soon: { en: "Coming soon", tr: "Yakında", ar: "قريباً" },
};
const tr = (k: keyof typeof T, lang: Language) => (T[k] as any)[lang] || (T[k] as any).en;

const DONUT = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9", "#64748b"];
const paymentKind = (s: string) => (s === "Paid" ? "paid" : s === "Partial" ? "partial" : "unpaid");

export default function AccountingDashboard({ lang, clients, costStatements, onNavigate }: {
  lang: Language;
  clients: Client[];
  costStatements: CostStatement[];
  onNavigate?: (tabId: string) => void;
}) {
  // Accounting Phase 1: the monthly revenue/profit trend is invoice-based.
  const ds = useAccountingDataset(clients, costStatements);
  const [overview, setOverview] = useState<ExecutiveFinanceOverview | null>(null);
  const [alerts, setAlerts] = useState<{ title: string; detail?: string; tone: "red" | "amber" }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ccy, setCcy] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/dashboard/financial");
        if (!res.ok) { if (!cancelled) setError(tr("loadError", lang)); return; }
        const body = await res.json();
        if (!cancelled) setOverview(body.financial || null);
      } catch { if (!cancelled) setError(tr("loadError", lang)); }
    })();
    (async () => {
      try {
        const res = await apiFetch("/api/admin/audit/findings?category=accounting&status=open");
        if (!res.ok) return;
        const body = await res.json();
        const findings = (body.findings || body || []) as any[];
        if (!cancelled) setAlerts(findings.slice(0, 4).map((f) => ({
          title: f.title || f.summary || f.message || "Finding",
          detail: f.detail || f.description || undefined,
          tone: (f.severity === "high" || f.priority?.level === "high") ? "red" : "amber",
        })));
      } catch { /* alerts are best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [lang]);

  const currencies = overview?.currencies || [];
  const active: CurrencyFinanceOverview | undefined = useMemo(
    () => currencies.find((c) => c.currency === ccy) || currencies.find((c) => c.currency === "USD") || currencies[0],
    [currencies, ccy],
  );
  const cur = (active?.currency || "USD") as any;

  const series = useMemo(() => monthlyRevenueProfit(costStatements, ds.invoices, cur, new Date().toISOString(), 6), [costStatements, ds.invoices, cur]);
  const slices = useMemo(() => expenseByCategory(costStatements, cur), [costStatements, cur]);
  const donutTotal = useMemo(() => totalExpenses(costStatements, cur), [costStatements, cur]);
  const recent = useMemo(() => recentStatements(costStatements, 6), [costStatements]);

  // Real, deterministic alerts derived from the authoritative overview + statements.
  const derivedAlerts = useMemo(() => {
    const out: { title: string; detail?: string; tone: "red" | "amber" }[] = [...alerts];
    if (active) {
      if (active.overdueReceivables > 0.009) out.push({ title: `${money(active.overdueReceivables)} ${cur} ${tr("overdue", lang)}`, detail: tr("receivables", lang), tone: "red" });
      if (active.profitExcludedCount > 0) out.push({ title: `${active.profitExcludedCount} delivered · profit currency unresolved`, tone: "amber" });
    }
    const unpaid = costStatements.filter((s) => s.paymentStatus !== "Paid").length;
    if (unpaid > 0) out.push({ title: `${unpaid} cost statements with unpaid vendor costs`, tone: "amber" });
    return out.slice(0, 5);
  }, [alerts, active, costStatements, cur, lang]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr("title", lang)}
        subtitle={tr("subtitle", lang)}
        actions={currencies.length > 1 ? (
          <select value={active?.currency || ""} onChange={(e) => setCcy(e.target.value)} className="text-[12.5px] font-semibold text-slate-700 border border-slate-200 rounded-lg pl-3 pr-8 py-2 bg-white cursor-pointer hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition">
            {currencies.map((c) => <option key={c.currency} value={c.currency}>{c.currency}</option>)}
          </select>
        ) : undefined}
      />

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red-700">{error}</div>}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard icon={DollarSign} tone="blue" label={tr("revenue", lang)} value={money(active?.revenue.thisMonth || 0)} unit={cur} sub={`${money(active?.revenue.thisYear || 0)} ${cur} YTD`} subTone="muted" />
        <KpiCard icon={TrendingUp} tone="emerald" label={tr("grossProfit", lang)} value={money(active?.grossProfit.thisMonth || 0)} unit={cur} sub={`${money(active?.grossProfit.thisYear || 0)} ${cur} YTD`} subTone="up" />
        <KpiCard icon={ArrowDownCircle} tone="slate" label={tr("receivables", lang)} value={money(active?.outstandingReceivables || 0)} unit={cur} sub={active && active.overdueReceivables > 0 ? `${money(active.overdueReceivables)} ${tr("overdue", lang)}` : undefined} subTone="warn" />
        <KpiCard icon={ArrowUpCircle} tone="amber" label={tr("payables", lang)} value={money(active?.outstandingPayables || 0)} unit={cur} sub={active ? `${money(active.vendorPayables)} ${tr("vendorShare", lang)}` : undefined} subTone="muted" />
        <KpiCard icon={FileBarChart} tone="slate" label={tr("openStatements", lang)} value={String(overview?.statementCount ?? 0)} sub={derivedAlerts.length ? tr("requiresAttention", lang) : tr("allSettled", lang)} subTone={derivedAlerts.length ? "warn" : "up"} />
      </div>

      {/* Charts + alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Panel title={tr("revVsProfit", lang)} className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
                  <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity={0.25} /><stop offset="100%" stopColor="#16a34a" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)} />
                <Tooltip formatter={(v: any) => `${money(Number(v))} ${cur}`} contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid #e2e8f0" }} />
                <Area type="monotone" dataKey="revenue" name={tr("revenue", lang)} stroke="#2563eb" strokeWidth={2.5} fill="url(#rev)" />
                <Area type="monotone" dataKey="profit" name={tr("grossProfit", lang)} stroke="#16a34a" strokeWidth={2.5} fill="url(#prof)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[11.5px] font-bold">
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-blue-600" />{tr("revenue", lang)}</span>
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />{tr("grossProfit", lang)}</span>
          </div>
        </Panel>

        <Panel title={tr("expenses", lang)}>
          {slices.length === 0 ? (
            <EmptyState icon={Wallet} title={tr("noStatements", lang)} />
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative w-[132px] h-[132px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={slices} dataKey="amount" nameKey="category" innerRadius={44} outerRadius={64} paddingAngle={2} strokeWidth={0}>
                      {slices.map((_, i) => <Cell key={i} fill={DONUT[i % DONUT.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => `${money(Number(v))} ${cur}`} contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid #e2e8f0" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[13px] font-black text-slate-900 tabular-nums leading-none">{money(donutTotal, { decimals: 0 })}</span>
                  <span className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">{cur}</span>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {slices.map((s, i) => (
                  <div key={s.category} className="flex items-center gap-2 text-[11.5px]">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT[i % DONUT.length] }} />
                    <span className="font-semibold text-slate-600 truncate flex-1">{s.category}</span>
                    <span className="font-black text-slate-400 tabular-nums">{s.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Alerts + recent */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Panel title={tr("alerts", lang)}>
          {derivedAlerts.length === 0 ? (
            <p className="text-[12.5px] text-slate-400">{tr("noAlerts", lang)}</p>
          ) : (
            <div className="space-y-2">
              {derivedAlerts.map((a, i) => (
                <div key={i} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${a.tone === "red" ? "border-red-100 bg-red-50/50" : "border-amber-100 bg-amber-50/50"}`}>
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${a.tone === "red" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}><AlertTriangle className="w-3.5 h-3.5" /></span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-slate-800 leading-snug">{a.title}</p>
                    {a.detail && <p className="text-[11px] text-slate-400 mt-0.5">{a.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={tr("recent", lang)} className="xl:col-span-2" bodyClassName="p-0"
          action={<button onClick={() => onNavigate?.("costs")} className="text-[12px] font-bold text-blue-600 hover:text-blue-700 bg-transparent border-0 cursor-pointer inline-flex items-center gap-1">{tr("viewAll", lang)}<ArrowRight className="w-3.5 h-3.5" /></button>}>
          {recent.length === 0 ? (
            <div className="p-5"><EmptyState icon={FileBarChart} title={tr("noStatements", lang)} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] min-w-[520px]">
                <thead>
                  <tr className="text-left text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-5 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200">{tr("order", lang)}</th>
                    <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200">{tr("customer", lang)}</th>
                    <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.05em] text-right border-b border-slate-200">{tr("cost", lang)}</th>
                    <th className="py-2.5 px-5 text-[10px] font-semibold uppercase tracking-[0.05em] text-right border-b border-slate-200">{tr("status", lang)}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.shipmentId} className="border-b border-slate-50 hover:bg-blue-50/40 transition-colors">
                      <td className="py-3 px-5 font-mono font-semibold text-slate-800">{s.shipmentNumber}</td>
                      <td className="py-3 px-3 text-slate-600 truncate max-w-[180px]">{s.companyName || "—"}</td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-800 tabular-nums">{money(s.totalCost || 0)} <span className="text-[10px] text-slate-400">{s.currency}</span></td>
                      <td className="py-3 px-5 text-right"><StatusPill label={s.paymentStatus} kind={paymentKind(s.paymentStatus)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* MARAS AI strip */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 p-5 flex items-center justify-between gap-4 flex-wrap shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
        <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-blue-500/10 blur-2xl pointer-events-none" />
        <div className="flex items-center gap-3.5 min-w-0 relative">
          <span className="w-11 h-11 rounded-xl bg-white/10 ring-1 ring-white/15 text-white flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-white tracking-[-0.01em]">{tr("aiTitle", lang)}</p>
            <p className="text-[12px] text-slate-300 mt-0.5 max-w-xl leading-relaxed">{tr("aiBody", lang)}</p>
          </div>
        </div>
        <button onClick={() => onNavigate?.("acct_ai")} className={`${btnGhost} !bg-white/10 !border-white/15 !text-white hover:!bg-white/20 relative`}>
          <Sparkles className="w-4 h-4" />{tr("openAi", lang)}
        </button>
      </div>
    </div>
  );
}
