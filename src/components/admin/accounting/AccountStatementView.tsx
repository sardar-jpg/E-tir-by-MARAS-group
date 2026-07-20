import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, FileSpreadsheet, Printer, FileText, Search, ArrowDownCircle, ArrowUpCircle, Scale, RefreshCw,
} from "lucide-react";
import type { Language } from "../../../types";
import { apiFetch } from "../../../lib/api";
import { statementToCsv, type StatementCsvRow } from "../../../lib/statementExport";
import { PageHeader, Panel, EmptyState, StatusPill, money, btnGhost, inputCls } from "./AccountingUI";

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

const L = {
  entity: { customer: { en: "Customer", tr: "Müşteri", ar: "العميل" }, vendor: { en: "Vendor", tr: "Tedarikçi", ar: "المورد" } },
  pickEntity: { customer: { en: "Select a customer", tr: "Müşteri seçin", ar: "اختر عميلاً" }, vendor: { en: "Select a vendor", tr: "Tedarikçi seçin", ar: "اختر مورداً" } },
  currency: { en: "Currency", tr: "Para Birimi", ar: "العملة" },
  from: { en: "From", tr: "Başlangıç", ar: "من" },
  to: { en: "To", tr: "Bitiş", ar: "إلى" },
  refresh: { en: "Refresh", tr: "Yenile", ar: "تحديث" },
  opening: { en: "Opening Balance", tr: "Açılış Bakiyesi", ar: "الرصيد الافتتاحي" },
  totalDebit: { en: "Total Debit", tr: "Toplam Borç", ar: "إجمالي المدين" },
  totalCredit: { en: "Total Credit", tr: "Toplam Alacak", ar: "إجمالي الدائن" },
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
  noEntity: { en: "Choose an account to view its statement.", tr: "Ekstresini görmek için bir hesap seçin.", ar: "اختر حساباً لعرض كشفه." },
  noRows: { en: "No transactions in this period.", tr: "Bu dönemde işlem yok.", ar: "لا توجد معاملات في هذه الفترة." },
  loadErr: { en: "Could not load the statement.", tr: "Ekstre yüklenemedi.", ar: "تعذّر تحميل الكشف." },
  print: { en: "Print", tr: "Yazdır", ar: "طباعة" },
  excel: { en: "Excel", tr: "Excel", ar: "إكسل" },
  owesUs: { en: "receivable (owed to us)", tr: "alacak (bize borçlu)", ar: "ذمة مدينة (مستحقة لنا)" },
  weOwe: { en: "payable (we owe)", tr: "borç (biz borçluyuz)", ar: "ذمة دائنة (علينا)" },
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
 * renders it with currency + date filters, summary cards, and CSV/Print/PDF
 * export. `queryKey` selects the API contract (company= vs vendor=); the math
 * is entirely server-side, this view only shapes and exports it.
 */
export default function AccountStatementView({
  mode, lang, title, subtitle, entities, endpoint, queryKey, pdfPath,
}: {
  mode: "customer" | "vendor";
  lang: Language;
  title: string;
  subtitle: string;
  entities: Entity[];
  endpoint: string;
  queryKey: "company" | "vendor";
  pdfPath?: (name: string, currency: string, lang: Language) => string;
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

  const onPickEntity = (name: string) => { setSelected(name); setCurrency(""); setStatement(null); setCurrencies([]); };

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
            <label className="block text-[11px] font-black uppercase tracking-wide text-slate-400 mb-1">{t(L.entity[mode], lang)}</label>
            <select value={selected} onChange={(e) => onPickEntity(e.target.value)} className={inputCls}>
              <option value="">{t(L.pickEntity[mode], lang)}</option>
              {sorted.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wide text-slate-400 mb-1">{t(L.currency, lang)}</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!currencies.length} className={inputCls}>
              {!currencies.length && <option value="">—</option>}
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wide text-slate-400 mb-1">{t(L.from, lang)}</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wide text-slate-400 mb-1">{t(L.to, lang)}</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
          <button onClick={() => selected && load(selected, currency, from, to)} className={`${btnGhost} justify-center h-[38px]`} disabled={!selected}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}<span className="hidden sm:inline">{t(L.refresh, lang)}</span>
          </button>
        </div>
      </Panel>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red-700">{err}</div>}

      {!selected ? (
        <EmptyState icon={Search} title={t(L.noEntity, lang)} />
      ) : loading && !statement ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : statement ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard icon={Scale} tone="slate" label={t(L.opening, lang)} value={`${money(statement.openingBalance)}`} unit={statement.currency} />
            <SummaryCard icon={ArrowDownCircle} tone="blue" label={t(L.totalDebit, lang)} value={`${money(statement.totalDebit)}`} unit={statement.currency} />
            <SummaryCard icon={ArrowUpCircle} tone="emerald" label={t(L.totalCredit, lang)} value={`${money(statement.totalCredit)}`} unit={statement.currency} />
            <SummaryCard icon={Scale} tone="amber" label={t(L.closing, lang)} value={`${money(statement.closingBalance)}`} unit={statement.currency} hint={t(balanceHint, lang)} />
          </div>

          {/* Ledger */}
          <Panel title={`${selected} · ${statement.currency}`} bodyClassName="p-0">
            {statement.rows.length === 0 ? (
              <div className="p-5"><EmptyState icon={FileText} title={t(L.noRows, lang)} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] min-w-[720px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-100 bg-slate-50/60">
                      <th className="py-2.5 px-4 text-[10px] font-black uppercase tracking-wide">{t(L.date, lang)}</th>
                      <th className="py-2.5 px-3 text-[10px] font-black uppercase tracking-wide">{t(L.type, lang)}</th>
                      <th className="py-2.5 px-3 text-[10px] font-black uppercase tracking-wide">{t(L.ref, lang)}</th>
                      <th className="py-2.5 px-3 text-[10px] font-black uppercase tracking-wide">{t(L.desc, lang)}</th>
                      <th className="py-2.5 px-3 text-[10px] font-black uppercase tracking-wide text-right">{t(L.debit, lang)}</th>
                      <th className="py-2.5 px-3 text-[10px] font-black uppercase tracking-wide text-right">{t(L.credit, lang)}</th>
                      <th className="py-2.5 px-4 text-[10px] font-black uppercase tracking-wide text-right">{t(L.balance, lang)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50 text-slate-500 bg-white">
                      <td className="py-2.5 px-4" colSpan={6}><span className="font-bold text-slate-600">{t(L.openingRow, lang)}</span></td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums">{money(statement.openingBalance)}</td>
                    </tr>
                    {statement.rows.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">{r.date}</td>
                        <td className="py-2.5 px-3"><StatusPill label={r.type} kind={TYPE_KIND[r.type] || "draft"} /></td>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">{r.ref}</td>
                        <td className="py-2.5 px-3 text-slate-600 max-w-[280px] truncate">{r.description}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">{r.debit ? money(r.debit) : ""}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">{r.credit ? money(r.credit) : ""}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums text-slate-900">{money(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-black text-slate-800">
                      <td className="py-3 px-4" colSpan={4}>{t(L.totals, lang)}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">{money(statement.totalDebit)}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">{money(statement.totalCredit)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{money(statement.closingBalance)} {statement.currency}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : (
        <EmptyState icon={FileText} title={t(L.noRows, lang)} />
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, tone, label, value, unit, hint }: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "slate" | "blue" | "emerald" | "amber";
  label: string; value: string; unit?: string; hint?: string;
}) {
  const ring = tone === "blue" ? "bg-blue-50 text-blue-600" : tone === "emerald" ? "bg-emerald-50 text-emerald-600" : tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-600";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-lg ${ring} flex items-center justify-center shrink-0`}><Icon className="w-4 h-4" /></span>
        <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-400 leading-tight">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1">
        <span className="text-[20px] font-black text-slate-900 tabular-nums leading-none">{value}</span>
        {unit && <span className="text-[11px] font-bold text-slate-400">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-[10.5px] font-semibold text-slate-400">{hint}</div>}
    </div>
  );
}
