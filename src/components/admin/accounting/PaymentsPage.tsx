import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, Wallet, Scale, Loader2, Search, X, Layers, RotateCcw,
} from "lucide-react";
import type { Language, Client, CostStatement, CustomerPayment, VendorPaymentTransaction } from "../../../types";
import { apiFetch } from "../../../lib/api";
import { buildCashRegister, summarizeCash, type CashEntry } from "../../../lib/accountingRegisters";
import { PageHeader, Panel, KpiCard, StatusPill, EmptyState, Pagination, money } from "./AccountingUI";

/**
 * Payments — Cash Management & Reconciliation. Aggregates customer receipts
 * (inflow) and vendor payments (outflow) from the existing per-company /
 * per-shipment endpoints (no backend change) into one directional cash
 * register with per-currency inflow / outflow / net and reconciliation cues
 * (how many invoices a receipt covers, which MAR order a vendor payment
 * settles). Every figure is server-authoritative; this view only tallies.
 */
const ROWS = 12;

const T = {
  title: { en: "Payments", tr: "Ödemeler", ar: "المدفوعات" },
  subtitle: { en: "Cash management & reconciliation — customer receipts and vendor payments in one directional register, per currency.", tr: "Nakit yönetimi ve mutabakat — müşteri tahsilatları ve tedarikçi ödemeleri tek kayıtta.", ar: "إدارة النقد والتسوية — مقبوضات العملاء ومدفوعات الموردين في سجل واحد حسب العملة." },
  received: { en: "Total Received", tr: "Toplam Tahsilat", ar: "إجمالي المقبوضات" },
  paid: { en: "Total Paid", tr: "Toplam Ödeme", ar: "إجمالي المدفوعات" },
  net: { en: "Net Cash Flow", tr: "Net Nakit Akışı", ar: "صافي التدفق النقدي" },
  txns: { en: "Transactions", tr: "İşlemler", ar: "المعاملات" },
  inflow: { en: "Money in", tr: "Giriş", ar: "داخل" },
  outflow: { en: "Money out", tr: "Çıkış", ar: "خارج" },
  all: { en: "All", tr: "Tümü", ar: "الكل" },
  register: { en: "Cash Register", tr: "Nakit Kaydı", ar: "سجل النقد" },
  search: { en: "Search party or reference…", tr: "Taraf veya referans ara…", ar: "ابحث بالطرف أو المرجع…" },
  date: { en: "Date", tr: "Tarih", ar: "التاريخ" },
  flow: { en: "Flow", tr: "Yön", ar: "الاتجاه" },
  party: { en: "Party", tr: "Taraf", ar: "الطرف" },
  reconcile: { en: "Reconciliation", tr: "Mutabakat", ar: "التسوية" },
  method: { en: "Method", tr: "Yöntem", ar: "الطريقة" },
  ref: { en: "Reference", tr: "Referans", ar: "المرجع" },
  amount: { en: "Amount", tr: "Tutar", ar: "المبلغ" },
  status: { en: "Status", tr: "Durum", ar: "الحالة" },
  received1: { en: "Received", tr: "Tahsilat", ar: "مقبوض" },
  paid1: { en: "Paid", tr: "Ödeme", ar: "مدفوع" },
  active: { en: "Active", tr: "Aktif", ar: "نشط" },
  reversed: { en: "Reversed", tr: "İptal", ar: "معكوس" },
  none: { en: "No payments recorded yet.", tr: "Henüz ödeme kaydı yok.", ar: "لا توجد مدفوعات بعد." },
  noMatch: { en: "No payments match your filters.", tr: "Filtrelerle eşleşen ödeme yok.", ar: "لا توجد مدفوعات مطابقة." },
  loadErr: { en: "Could not load payments.", tr: "Ödemeler yüklenemedi.", ar: "تعذّر تحميل المدفوعات." },
  allocated: { en: "invoices", tr: "fatura", ar: "فاتورة" },
  advance: { en: "Advance credit", tr: "Avans kredi", ar: "رصيد مقدم" },
  showing: { en: "Showing", tr: "Gösterilen", ar: "عرض" },
  of: { en: "of", tr: "/", ar: "من" },
  page: { en: "Page", tr: "Sayfa", ar: "صفحة" },
};
const t = (o: { en: string; tr: string; ar: string }, lang: Language) => o[lang] || o.en;

export default function PaymentsPage({ lang, clients, costStatements }: { lang: Language; clients: Client[]; costStatements: CostStatement[] }) {
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ccy, setCcy] = useState<string>("");
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const companies = [...new Set(clients.map((c) => c.companyName).filter(Boolean))];
      const shipmentIds = [...new Set(costStatements.map((s) => s.shipmentId).filter(Boolean))];
      const [custResults, venResults] = await Promise.all([
        Promise.all(companies.map(async (co) => {
          try { const r = await apiFetch(`/api/customer-accounts/payments?company=${encodeURIComponent(co)}`); if (!r.ok) return []; return (await r.json()).payments || []; } catch { return []; }
        })),
        Promise.all(shipmentIds.map(async (sid) => {
          try { const r = await apiFetch(`/api/cost-statements/${encodeURIComponent(sid)}/vendor-payments`); if (!r.ok) return []; return (await r.json()).payments || []; } catch { return []; }
        })),
      ]);
      const customer = custResults.flat() as CustomerPayment[];
      const vendor = venResults.flat() as VendorPaymentTransaction[];
      setEntries(buildCashRegister(customer, vendor));
    } catch { setErr(t(T.loadErr, lang)); }
    finally { setLoading(false); }
  }, [clients, costStatements, lang]);
  useEffect(() => { void load(); }, [load]);

  const summaries = useMemo(() => summarizeCash(entries), [entries]);
  const active = useMemo(() => summaries.find((s) => s.currency === ccy) || summaries.find((s) => s.currency === "USD") || summaries[0], [summaries, ccy]);
  const cur = active?.currency;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (cur && e.currency !== cur) return false;
      if (dir !== "all" && e.direction !== dir) return false;
      if (!q) return true;
      return `${e.party} ${e.reference} ${e.orderRef || ""} ${e.method}`.toLowerCase().includes(q);
    });
  }, [entries, cur, dir, query]);

  useEffect(() => { setPage(1); }, [cur, dir, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / ROWS));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * ROWS, safePage * ROWS);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(T.title, lang)}
        subtitle={t(T.subtitle, lang)}
        actions={summaries.length > 1 ? (
          <select value={active?.currency || ""} onChange={(e) => setCcy(e.target.value)} className="text-[12.5px] font-semibold text-slate-700 border border-slate-200 rounded-lg pl-3 pr-8 py-2 bg-white cursor-pointer hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition">
            {summaries.map((s) => <option key={s.currency} value={s.currency}>{s.currency}</option>)}
          </select>
        ) : undefined}
      />

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] font-semibold text-red-700">{err}</div>}

      {/* Cash KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={ArrowDownLeft} tone="emerald" label={t(T.received, lang)} value={money(active?.inflow || 0)} unit={cur} sub={t(T.inflow, lang)} subTone="up" />
        <KpiCard icon={ArrowUpRight} tone="amber" label={t(T.paid, lang)} value={money(active?.outflow || 0)} unit={cur} sub={t(T.outflow, lang)} subTone="warn" />
        <KpiCard icon={Scale} tone={active && active.net < 0 ? "red" : "blue"} label={t(T.net, lang)} value={money(active?.net || 0)} unit={cur} sub={active && active.net < 0 ? t(T.outflow, lang) : t(T.inflow, lang)} subTone={active && active.net < 0 ? "down" : "up"} />
        <KpiCard icon={Wallet} tone="slate" label={t(T.txns, lang)} value={String(active?.count || 0)} sub={cur} subTone="muted" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <Panel
          title={t(T.register, lang)}
          bodyClassName="p-0"
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                {(["all", "in", "out"] as const).map((d) => (
                  <button key={d} onClick={() => setDir(d)} className={`px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer border-0 transition-colors ${dir === d ? (d === "in" ? "bg-emerald-600 text-white" : d === "out" ? "bg-amber-600 text-white" : "bg-slate-900 text-white") : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                    {d === "all" ? t(T.all, lang) : d === "in" ? t(T.received1, lang) : t(T.paid1, lang)}
                  </button>
                ))}
              </div>
              <div className="relative w-52 max-w-[46vw]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(T.search, lang)} className="w-full text-[12px] border border-slate-200 rounded-lg pl-8 pr-7 py-1.5 bg-white text-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition placeholder:text-slate-400" />
                {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer bg-transparent border-0 p-0"><X className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          }
        >
          {entries.length === 0 ? (
            <div className="p-5"><EmptyState icon={Wallet} title={t(T.none, lang)} /></div>
          ) : filtered.length === 0 ? (
            <div className="p-5"><EmptyState icon={Search} title={t(T.noMatch, lang)} /></div>
          ) : (
            <>
              <div className="overflow-auto max-h-[560px]">
                <table className="w-full text-[12.5px] min-w-[820px] border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-slate-500">
                      {[T.date, T.flow, T.party, T.reconcile, T.method, T.ref].map((h, i) => (
                        <th key={i} className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200 first:pl-5">{t(h, lang)}</th>
                      ))}
                      {[T.amount, T.status].map((h, i) => (
                        <th key={i} className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.05em] text-right border-b border-slate-200 last:pr-5">{t(h, lang)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((e) => {
                      const isIn = e.direction === "in";
                      const reversed = e.status === "reversed";
                      return (
                        <tr key={e.id} className={`hover:bg-slate-50/70 transition-colors ${reversed ? "opacity-55" : ""}`}>
                          <td className="py-3 px-4 pl-5 text-slate-500 whitespace-nowrap border-b border-slate-50 tabular-nums">{e.date}</td>
                          <td className="py-3 px-4 border-b border-slate-50">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-semibold ${isIn ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                              {isIn ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                              {isIn ? t(T.received1, lang) : t(T.paid1, lang)}
                            </span>
                          </td>
                          <td className="py-3 px-4 border-b border-slate-50 text-slate-700 font-medium max-w-[220px] truncate">{e.party}</td>
                          <td className="py-3 px-4 border-b border-slate-50">
                            {isIn ? (
                              e.allocationsCount > 0
                                ? <span className="inline-flex items-center gap-1 text-[11.5px] text-slate-500"><Layers className="w-3.5 h-3.5 text-blue-500" />{e.allocationsCount} {t(T.allocated, lang)}</span>
                                : <span className="text-[11.5px] font-semibold text-blue-600">{t(T.advance, lang)}</span>
                            ) : (
                              <span className="font-mono text-[11.5px] text-slate-500">{e.orderRef || "—"}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 border-b border-slate-50 text-slate-500 capitalize">{e.method}</td>
                          <td className="py-3 px-4 border-b border-slate-50 font-mono text-[11.5px] text-slate-500 max-w-[140px] truncate">{e.reference || "—"}</td>
                          <td className={`py-3 px-4 text-right border-b border-slate-50 font-mono font-bold tabular-nums whitespace-nowrap ${reversed ? "text-slate-400 line-through" : isIn ? "text-emerald-600" : "text-amber-600"}`}>
                            {isIn ? "+" : "−"}{money(e.amount)} <span className="text-[10px] text-slate-400 no-underline">{e.currency}</span>
                          </td>
                          <td className="py-3 px-4 pr-5 text-right border-b border-slate-50">
                            {reversed
                              ? <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-400"><RotateCcw className="w-3 h-3" />{t(T.reversed, lang)}</span>
                              : <StatusPill label={t(T.active, lang)} kind="approved" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={safePage} pageCount={pageCount} total={filtered.length}
                from={(safePage - 1) * ROWS + 1} to={Math.min(safePage * ROWS, filtered.length)}
                labels={{ showing: t(T.showing, lang), of: t(T.of, lang), page: t(T.page, lang) }}
                onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
              />
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
