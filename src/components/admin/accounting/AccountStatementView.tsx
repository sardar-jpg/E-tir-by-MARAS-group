import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, FileSpreadsheet, Printer, FileText, Search, RefreshCw, Users, Building2, X,
} from "lucide-react";
import type { Language } from "../../../types";
import { apiFetch } from "../../../lib/api";
import { statementToCsv, type StatementCsvRow } from "../../../lib/statementExport";
import {
  PageHeader, Panel, EmptyState, StatusPill, StatementSummaryHeader, Pagination,
  money, btnGhost, inputCls,
} from "./AccountingUI";

/** Normalized ledger shape shared by the customer (AR) and vendor (AP) statement APIs. */
type LedgerRow = StatementCsvRow;
interface AccountStatement {
  currency: string;
  from: string;
  to: string;
  openingBalance: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

interface Entity { id: string; name: string }

const ROWS_PER_PAGE = 12;

const L = {
  entity: { customer: { en: "Customer", tr: "Müşteri", ar: "العميل" }, vendor: { en: "Vendor", tr: "Tedarikçi", ar: "المورد" } },
  entityId: { customer: { en: "Customer ID", tr: "Müşteri No", ar: "رقم العميل" }, vendor: { en: "Vendor ID", tr: "Tedarikçi No", ar: "رقم المورد" } },
  pickEntity: { customer: { en: "Select a customer", tr: "Müşteri seçin", ar: "اختر عميلاً" }, vendor: { en: "Select a vendor", tr: "Tedarikçi seçin", ar: "اختر مورداً" } },
  currency: { en: "Currency", tr: "Para Birimi", ar: "العملة" },
  from: { en: "From", tr: "Başlangıç", ar: "من" },
  to: { en: "To", tr: "Bitiş", ar: "إلى" },
  refresh: { en: "Refresh", tr: "Yenile", ar: "تحديث" },
  currentBalance: { en: "Current Balance", tr: "Güncel Bakiye", ar: "الرصيد الحالي" },
  totalDebit: { en: "Total Debit", tr: "Toplam Borç", ar: "إجمالي المدين" },
  totalCredit: { en: "Total Credit", tr: "Toplam Alacak", ar: "إجمالي الدائن" },
  totalBills: { en: "Total Bills", tr: "Toplam Fatura", ar: "إجمالي الفواتير" },
  totalPayments: { en: "Total Payments", tr: "Toplam Ödeme", ar: "إجمالي المدفوعات" },
  closing: { en: "Closing Balance", tr: "Kapanış Bakiyesi", ar: "الرصيد الختامي" },
  date: { en: "Date", tr: "Tarih", ar: "التاريخ" },
  type: { en: "Type", tr: "Tür", ar: "النوع" },
  ref: { en: "Reference", tr: "Referans", ar: "المرجع" },
  desc: { en: "Description", tr: "Açıklama", ar: "الوصف" },
  debit: { en: "Debit", tr: "Borç", ar: "مدين" },
  credit: { en: "Credit", tr: "Alacak", ar: "دائن" },
  balance: { en: "Balance", tr: "Bakiye", ar: "الرصيد" },
  openingRow: { en: "Opening balance", tr: "Açılış bakiyesi", ar: "الرصيد الافتتاحي" },
  totals: { en: "Totals", tr: "Toplamlar", ar: "المجاميع" },
  ledger: { en: "Transactions", tr: "İşlemler", ar: "المعاملات" },
  searchRows: { en: "Search reference or description…", tr: "Referans veya açıklama ara…", ar: "ابحث في المرجع أو الوصف…" },
  noEntity: { en: "Choose an account to view its statement.", tr: "Ekstresini görmek için bir hesap seçin.", ar: "اختر حساباً لعرض كشفه." },
  noRows: { en: "No transactions in this period.", tr: "Bu dönemde işlem yok.", ar: "لا توجد معاملات في هذه الفترة." },
  noMatch: { en: "No transactions match your search.", tr: "Aramanızla eşleşen işlem yok.", ar: "لا توجد معاملات مطابقة لبحثك." },
  loadErr: { en: "Could not load the statement.", tr: "Ekstre yüklenemedi.", ar: "تعذّر تحميل الكشف." },
  print: { en: "Print", tr: "Yazdır", ar: "طباعة" },
  excel: { en: "Excel", tr: "Excel", ar: "إكسل" },
  owesUs: { en: "Receivable — owed to us", tr: "Alacak — bize borçlu", ar: "ذمة مدينة — مستحقة لنا" },
  weOwe: { en: "Payable — we owe", tr: "Borç — biz borçluyuz", ar: "ذمة دائنة — علينا" },
  showing: { en: "Showing", tr: "Gösterilen", ar: "عرض" },
  of: { en: "of", tr: "/", ar: "من" },
  page: { en: "Page", tr: "Sayfa", ar: "صفحة" },
};
const t = (o: { en: string; tr: string; ar: string }, lang: Language) => o[lang] || o.en;

const TYPE_KIND: Record<string, string> = { invoice: "issued", payment: "paid", bill: "partial" };

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/**
 * Reusable account-statement page for both Customer (AR) and Vendor (AP)
 * ledgers. Fetches the server-authoritative running-balance statement and
 * renders a premium summary header + a professional, searchable, paginated
 * ledger with CSV / Print / PDF export. `queryKey` selects the API contract
 * (company= vs vendor=); the math is entirely server-side — this view only
 * shapes, filters (client-side, never mutating data) and exports it.
 */
export default function AccountStatementView({
  mode, lang, title, subtitle, entities, endpoint, queryKey, pdfPath, initialEntity,
}: {
  mode: "customer" | "vendor";
  lang: Language;
  title: string;
  subtitle: string;
  entities: Entity[];
  endpoint: string;
  queryKey: "company" | "vendor";
  pdfPath?: (name: string, currency: string, lang: Language) => string;
  /** Pre-select this entity when arriving from another accounting page (link). */
  initialEntity?: string;
}) {
  const sorted = useMemo(() => [...entities].sort((a, b) => a.name.localeCompare(b.name)), [entities]);
  const [selected, setSelected] = useState<string>("");
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [currency, setCurrency] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [statement, setStatement] = useState<AccountStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowQuery, setRowQuery] = useState("");
  const [page, setPage] = useState(1);

  const selectedEntity = useMemo(() => sorted.find((e) => e.name === selected), [sorted, selected]);
  const EntityIcon = mode === "customer" ? Users : Building2;

  // Pre-select an entity when navigated here from another accounting page.
  useEffect(() => {
    if (initialEntity && sorted.some((e) => e.name === initialEntity) && initialEntity !== selected) {
      setSelected(initialEntity); setCurrency(""); setStatement(null); setCurrencies([]); setRowQuery("");
    }
  }, [initialEntity, sorted]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (name: string, cur: string, f: string, tt: string) => {
    if (!name) { setStatement(null); setCurrencies([]); return; }
    setLoading(true); setErr(null);
    try {
      const params = new URLSearchParams({ [queryKey]: name });
      if (cur) params.set("currency", cur);
      if (f) params.set("from", f);
      if (tt) params.set("to", tt);
      const res = await apiFetch(`${endpoint}?${params.toString()}`);
      if (!res.ok) { setErr(t(L.loadErr, lang)); setStatement(null); return; }
      const body = await res.json();
      const list: string[] = body.currencies || [];
      setCurrencies(list);
      if (!cur && list.length && !list.includes(currency)) setCurrency(list[0]);
      setStatement(body.statement || null);
    } catch { setErr(t(L.loadErr, lang)); setStatement(null); }
    finally { setLoading(false); }
  }, [endpoint, queryKey, lang, currency]);

  useEffect(() => { if (selected) void load(selected, currency, from, to); }, [selected, currency, from, to, load]);
  // Reset the client-side row view whenever the underlying dataset changes.
  useEffect(() => { setPage(1); }, [selected, currency, from, to, rowQuery]);

  const onPickEntity = (name: string) => { setSelected(name); setCurrency(""); setStatement(null); setCurrencies([]); setRowQuery(""); };

  const exportCsv = () => {
    if (!statement) return;
    const csv = statementToCsv({
      title: mode === "customer" ? "Customer Account Statement" : "Vendor Account Statement",
      entity: selected, currency: statement.currency, from: statement.from, to: statement.to,
      openingBalance: statement.openingBalance, rows: statement.rows,
      totalDebit: statement.totalDebit, totalCredit: statement.totalCredit, closingBalance: statement.closingBalance,
    });
    const safe = selected.replace(/[^\w\-]+/g, "_");
    downloadCsv(`${mode}-statement-${safe}-${statement.currency}.csv`, csv);
  };

  // Client-side row filter (presentation only — server totals are untouched).
  const filteredRows = useMemo(() => {
    if (!statement) return [];
    const q = rowQuery.trim().toLowerCase();
    if (!q) return statement.rows;
    return statement.rows.filter((r) => `${r.ref} ${r.description} ${r.type}`.toLowerCase().includes(q));
  }, [statement, rowQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);
  const showOpeningRow = !rowQuery.trim() && safePage === 1;

  const balanceHint = mode === "customer" ? L.owesUs : L.weOwe;

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={statement && statement.rows.length > 0 ? (
          <>
            <button onClick={exportCsv} className={btnGhost}><FileSpreadsheet className="w-4 h-4 text-emerald-600" />{t(L.excel, lang)}</button>
            <button onClick={() => window.print()} className={btnGhost}><Printer className="w-4 h-4 text-slate-500" />{t(L.print, lang)}</button>
            {pdfPath && currency && (
              <button onClick={() => window.open(pdfPath(selected, currency, lang), "_blank", "noopener")} className={btnGhost}><FileText className="w-4 h-4 text-red-500" />PDF</button>
            )}
          </>
        ) : undefined}
      />

      {/* Filters */}
      <Panel bodyClassName="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 mb-1.5">{t(L.entity[mode], lang)}</label>
            <select value={selected} onChange={(e) => onPickEntity(e.target.value)} className={inputCls}>
              <option value="">{t(L.pickEntity[mode], lang)}</option>
              {sorted.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 mb-1.5">{t(L.currency, lang)}</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!currencies.length} className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`}>
              {!currencies.length && <option value="">—</option>}
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 mb-1.5">{t(L.from, lang)}</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 mb-1.5">{t(L.to, lang)}</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
          <button onClick={() => selected && load(selected, currency, from, to)} className={`${btnGhost} justify-center h-[38px]`} disabled={!selected}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}<span className="hidden sm:inline">{t(L.refresh, lang)}</span>
          </button>
        </div>
      </Panel>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] font-semibold text-red-700">{err}</div>}

      {!selected ? (
        <EmptyState icon={Search} title={t(L.noEntity, lang)} />
      ) : loading && !statement ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : statement ? (
        <>
          {/* Premium summary header: identity + current balance + figures */}
          <StatementSummaryHeader
            icon={EntityIcon}
            name={selected}
            idLabel={t(L.entityId[mode], lang)}
            idValue={selectedEntity?.id || "—"}
            headline={{ label: t(L.currentBalance, lang), value: money(statement.closingBalance), unit: statement.currency, hint: t(balanceHint, lang) }}
            cells={[
              { label: mode === "customer" ? t(L.totalDebit, lang) : t(L.totalBills, lang), value: money(statement.totalDebit), unit: statement.currency, tone: "neutral" },
              { label: mode === "customer" ? t(L.totalCredit, lang) : t(L.totalPayments, lang), value: money(statement.totalCredit), unit: statement.currency, tone: "credit" },
              { label: t(L.closing, lang), value: money(statement.closingBalance), unit: statement.currency, tone: "strong" },
            ]}
          />

          {/* Ledger */}
          <Panel
            title={t(L.ledger, lang)}
            subtitle={`${selected} · ${statement.currency}`}
            bodyClassName="p-0"
            action={statement.rows.length > 0 ? (
              <div className="relative w-56 max-w-[52vw]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  value={rowQuery}
                  onChange={(e) => setRowQuery(e.target.value)}
                  placeholder={t(L.searchRows, lang)}
                  className="w-full text-[12px] border border-slate-200 rounded-lg pl-8 pr-7 py-1.5 bg-white text-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition placeholder:text-slate-400"
                />
                {rowQuery && (
                  <button onClick={() => setRowQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer bg-transparent border-0 p-0"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ) : undefined}
          >
            {statement.rows.length === 0 ? (
              <div className="p-5"><EmptyState icon={FileText} title={t(L.noRows, lang)} /></div>
            ) : filteredRows.length === 0 ? (
              <div className="p-5"><EmptyState icon={Search} title={t(L.noMatch, lang)} /></div>
            ) : (
              <>
                <div className="overflow-auto max-h-[560px]">
                  <table className="w-full text-[12.5px] min-w-[760px] border-separate border-spacing-0">
                    <thead>
                      <tr className="text-left text-slate-500">
                        {[L.date, L.type, L.ref, L.desc].map((h, i) => (
                          <th key={i} className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200 first:pl-5">{t(h, lang)}</th>
                        ))}
                        {[L.debit, L.credit, L.balance].map((h, i) => (
                          <th key={i} className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur py-2.5 px-4 text-[10px] font-semibold uppercase tracking-[0.05em] text-right border-b border-slate-200 last:pr-5">{t(h, lang)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {showOpeningRow && (
                        <tr className="text-slate-500">
                          <td className="py-3 px-4 pl-5 border-b border-slate-100" colSpan={6}><span className="font-semibold text-slate-500 italic">{t(L.openingRow, lang)}</span></td>
                          <td className="py-3 px-4 pr-5 text-right font-mono font-semibold tabular-nums border-b border-slate-100 text-slate-600">{money(statement.openingBalance)}</td>
                        </tr>
                      )}
                      {pageRows.map((r, i) => (
                        <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                          <td className="py-3 px-4 pl-5 text-slate-500 whitespace-nowrap border-b border-slate-50 tabular-nums">{r.date}</td>
                          <td className="py-3 px-4 border-b border-slate-50"><StatusPill label={r.type} kind={TYPE_KIND[r.type] || "draft"} /></td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-800 whitespace-nowrap border-b border-slate-50">{r.ref}</td>
                          <td className="py-3 px-4 text-slate-600 max-w-[300px] truncate border-b border-slate-50">{r.description}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 border-b border-slate-50">{r.debit ? money(r.debit) : <span className="text-slate-300">—</span>}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-600 border-b border-slate-50">{r.credit ? money(r.credit) : <span className="text-slate-300">—</span>}</td>
                          <td className="py-3 px-4 pr-5 text-right font-mono font-semibold tabular-nums text-slate-900 border-b border-slate-50">{money(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-bold text-slate-800 sticky bottom-0">
                        <td className="py-3 px-4 pl-5 border-t-2 border-slate-200 text-[11px] uppercase tracking-[0.05em]" colSpan={4}>{t(L.totals, lang)}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums border-t-2 border-slate-200">{money(statement.totalDebit)}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums border-t-2 border-slate-200 text-emerald-700">{money(statement.totalCredit)}</td>
                        <td className="py-3 px-4 pr-5 text-right font-mono tabular-nums border-t-2 border-slate-200">{money(statement.closingBalance)} <span className="text-[10px] text-slate-400">{statement.currency}</span></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <Pagination
                  page={safePage}
                  pageCount={pageCount}
                  total={filteredRows.length}
                  from={(safePage - 1) * ROWS_PER_PAGE + 1}
                  to={Math.min(safePage * ROWS_PER_PAGE, filteredRows.length)}
                  labels={{ showing: t(L.showing, lang), of: t(L.of, lang), page: t(L.page, lang) }}
                  onPrev={() => setPage((p) => Math.max(1, p - 1))}
                  onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
                />
              </>
            )}
          </Panel>
        </>
      ) : (
        <EmptyState icon={FileText} title={t(L.noRows, lang)} />
      )}
    </div>
  );
}
