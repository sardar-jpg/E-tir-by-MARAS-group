import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText, Search, Loader2, Printer, Download, Building2, CalendarDays, Landmark, Hash, CheckCircle2, X,
} from "lucide-react";
import type { Language, Client, CustomerInvoice } from "../../../types";
import { apiFetch } from "../../../lib/api";
import { openAccountingPdf } from "../../../lib/openAccountingPdf";
import { summarizeInvoices, invoiceTotal } from "../../../lib/accountingRegisters";
import { PageHeader, Panel, KpiCard, StatusPill, EmptyState, money, btnGhost, CARD } from "./AccountingUI";

/**
 * Customer Invoices — Document-Centric Workspace. Reads issued/draft invoices
 * across all customers (aggregated client-side from the existing per-company
 * endpoint — no backend change) and renders the selected one as a real invoice
 * DOCUMENT (letterhead, bill-to, service lines, totals), not a ledger row.
 * Every figure is exactly what the server produced; this view only lays it out.
 */
const T = {
  title: { en: "Customer Invoices", tr: "Müşteri Faturaları", ar: "فواتير العملاء" },
  subtitle: { en: "Issue-ready invoice documents across every customer — search, preview, print or export as PDF.", tr: "Tüm müşteriler için fatura belgeleri — ara, önizle, yazdır veya PDF olarak dışa aktar.", ar: "مستندات فواتير جاهزة لكل العملاء — ابحث وعاين واطبع أو صدّر PDF." },
  kInvoiced: { en: "Total Invoiced", tr: "Toplam Faturalanan", ar: "إجمالي الفوترة" },
  kOutstanding: { en: "Outstanding", tr: "Açık", ar: "المستحق" },
  kPaid: { en: "Paid", tr: "Ödendi", ar: "مدفوعة" },
  kDrafts: { en: "Drafts", tr: "Taslaklar", ar: "مسودات" },
  invoices: { en: "invoices", tr: "fatura", ar: "فاتورة" },
  search: { en: "Search number or customer…", tr: "Numara veya müşteri ara…", ar: "ابحث بالرقم أو العميل…" },
  all: { en: "All", tr: "Tümü", ar: "الكل" },
  none: { en: "No invoices found.", tr: "Fatura bulunamadı.", ar: "لا توجد فواتير." },
  pickOne: { en: "Select an invoice to preview the document.", tr: "Belgeyi önizlemek için bir fatura seçin.", ar: "اختر فاتورة لمعاينة المستند." },
  loadErr: { en: "Could not load invoices.", tr: "Faturalar yüklenemedi.", ar: "تعذّر تحميل الفواتير." },
  billTo: { en: "Bill To", tr: "Fatura Adresi", ar: "فاتورة إلى" },
  invoiceNo: { en: "Invoice No.", tr: "Fatura No.", ar: "رقم الفاتورة" },
  order: { en: "MAR Order", tr: "MAR Sipariş", ar: "طلب MAR" },
  invoiceDate: { en: "Invoice Date", tr: "Fatura Tarihi", ar: "تاريخ الفاتورة" },
  dueDate: { en: "Due Date", tr: "Vade Tarihi", ar: "تاريخ الاستحقاق" },
  desc: { en: "Description", tr: "Açıklama", ar: "الوصف" },
  qty: { en: "Qty", tr: "Adet", ar: "الكمية" },
  unit: { en: "Unit Price", tr: "Birim Fiyat", ar: "سعر الوحدة" },
  amount: { en: "Amount", tr: "Tutar", ar: "المبلغ" },
  subtotal: { en: "Subtotal", tr: "Ara Toplam", ar: "المجموع الفرعي" },
  discount: { en: "Discount", tr: "İndirim", ar: "الخصم" },
  tax: { en: "Tax", tr: "Vergi", ar: "الضريبة" },
  charges: { en: "Additional Charges", tr: "Ek Ücretler", ar: "رسوم إضافية" },
  total: { en: "Total Due", tr: "Toplam", ar: "الإجمالي المستحق" },
  terms: { en: "Payment Terms", tr: "Ödeme Koşulları", ar: "شروط الدفع" },
  bank: { en: "Remittance", tr: "Havale Bilgisi", ar: "معلومات التحويل" },
  notes: { en: "Notes", tr: "Notlar", ar: "ملاحظات" },
  services: { en: "Freight & logistics services", tr: "Nakliye ve lojistik hizmetleri", ar: "خدمات الشحن واللوجستيات" },
};
const t = (o: { en: string; tr: string; ar: string }, lang: Language) => o[lang] || o.en;

const STATUS_KIND: Record<string, string> = { draft: "draft", issued: "issued", partially_paid: "partial", paid: "paid", cancelled: "unpaid" };
const STATUS_LABEL: Record<string, { en: string; tr: string; ar: string }> = {
  draft: { en: "Draft", tr: "Taslak", ar: "مسودة" },
  issued: { en: "Issued", tr: "Düzenlendi", ar: "صادرة" },
  partially_paid: { en: "Partial", tr: "Kısmi", ar: "جزئي" },
  paid: { en: "Paid", tr: "Ödendi", ar: "مدفوعة" },
  cancelled: { en: "Cancelled", tr: "İptal", ar: "ملغاة" },
};
const FILTERS = ["all", "draft", "issued", "partially_paid", "paid"] as const;

export default function CustomerInvoicesPage({ lang, clients }: { lang: Language; clients: Client[] }) {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string>("");
  const [ccy, setCcy] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const companies = [...new Set(clients.map((c) => c.companyName).filter(Boolean))];
      const results = await Promise.all(companies.map(async (co) => {
        try {
          const res = await apiFetch(`/api/customer-accounts/invoices?company=${encodeURIComponent(co)}`);
          if (!res.ok) return [] as CustomerInvoice[];
          const body = await res.json();
          return (body.invoices || []) as CustomerInvoice[];
        } catch { return [] as CustomerInvoice[]; }
      }));
      const all = results.flat().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setInvoices(all);
    } catch { setErr(t(T.loadErr, lang)); }
    finally { setLoading(false); }
  }, [clients, lang]);
  useEffect(() => { void load(); }, [load]);

  const summaries = useMemo(() => summarizeInvoices(invoices), [invoices]);
  const active = useMemo(() => summaries.find((s) => s.currency === ccy) || summaries.find((s) => s.currency === "USD") || summaries[0], [summaries, ccy]);
  const cur = active?.currency;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (!q) return true;
      return `${i.invoiceNumber} ${i.companyName} ${i.shipmentNumber}`.toLowerCase().includes(q);
    });
  }, [invoices, query, statusFilter]);

  const selected = useMemo(() => invoices.find((i) => i.id === selectedId) || filtered[0], [invoices, selectedId, filtered]);

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

      {/* KPI strip (active currency) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={FileText} tone="blue" label={t(T.kInvoiced, lang)} value={money(active?.invoiced || 0)} unit={cur} sub={`${active?.count || 0} ${t(T.invoices, lang)}`} subTone="muted" />
        <KpiCard icon={Hash} tone="amber" label={t(T.kOutstanding, lang)} value={String(active?.outstandingCount || 0)} sub={cur} subTone="warn" />
        <KpiCard icon={CheckCircle2} tone="emerald" label={t(T.kPaid, lang)} value={String(active?.byStatus.paid || 0)} sub={cur} subTone="up" />
        <KpiCard icon={FileText} tone="slate" label={t(T.kDrafts, lang)} value={String(active?.byStatus.draft || 0)} sub={cur} subTone="muted" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-5 items-start">
          {/* ── Invoice list ── */}
          <Panel bodyClassName="p-0" className="overflow-hidden">
            <div className="p-3 border-b border-slate-100 space-y-2.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(T.search, lang)} className="w-full text-[12.5px] border border-slate-200 rounded-lg pl-8 pr-7 py-2 bg-white text-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition placeholder:text-slate-400" />
                {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer bg-transparent border-0 p-0"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((f) => (
                  <button key={f} onClick={() => setStatusFilter(f)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer border transition-all ${statusFilter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"}`}>
                    {f === "all" ? t(T.all, lang) : t(STATUS_LABEL[f], lang)}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[620px] overflow-y-auto divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <div className="p-5"><EmptyState icon={FileText} title={t(T.none, lang)} /></div>
              ) : filtered.map((inv) => {
                const on = selected?.id === inv.id;
                return (
                  <button key={inv.id} onClick={() => setSelectedId(inv.id)} className={`w-full text-left px-4 py-3 cursor-pointer border-0 transition-colors ${on ? "bg-blue-50/70" : "bg-white hover:bg-slate-50/70"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-[12.5px] text-slate-800 truncate">{inv.invoiceNumber}</span>
                      <StatusPill label={t(STATUS_LABEL[inv.status] || STATUS_LABEL.draft, lang)} kind={STATUS_KIND[inv.status] || "draft"} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-slate-500 truncate">{inv.companyName}</span>
                      <span className="text-[12.5px] font-bold text-slate-800 tabular-nums shrink-0">{money(invoiceTotal(inv))} <span className="text-[10px] text-slate-400">{inv.currency}</span></span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>

          {/* ── Invoice document ── */}
          {selected ? (
            <InvoiceDocument key={selected.id} lang={lang} inv={selected} />
          ) : (
            <EmptyState icon={FileText} title={t(T.pickOne, lang)} />
          )}
        </div>
      )}
    </div>
  );
}

/** A professional, print-friendly invoice document rendered from server data. */
function InvoiceDocument({ lang, inv }: { lang: Language; inv: CustomerInvoice }) {
  const [busy, setBusy] = useState(false);
  const brand = inv.companySnapshot?.companyName || "MARAS Group";
  const lines = inv.invoiceLines && inv.invoiceLines.length
    ? inv.invoiceLines
    : [{ id: "l", serviceType: t(T.services, lang), description: inv.description || "", quantity: 1, unitPrice: invoiceTotal(inv), amount: invoiceTotal(inv) }];
  const subtotal = Number.isFinite(inv.subtotal as number) ? Number(inv.subtotal) : lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const total = invoiceTotal(inv);
  const openPdf = async () => { setBusy(true); await openAccountingPdf(`/api/cost-statements/${inv.shipmentId}/invoices/${inv.id}/pdf?lang=${lang}`); setBusy(false); };

  return (
    <div className={`${CARD} overflow-hidden`}>
      {/* Document toolbar */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2">
          <StatusPill label={t(STATUS_LABEL[inv.status] || STATUS_LABEL.draft, lang)} kind={STATUS_KIND[inv.status] || "draft"} />
          <span className="text-[12px] text-slate-400 font-mono">{inv.invoiceNumber}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className={btnGhost}><Printer className="w-4 h-4 text-slate-500" />{t({ en: "Print", tr: "Yazdır", ar: "طباعة" }, lang)}</button>
          <button onClick={openPdf} disabled={busy} className={btnGhost}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-red-500" />}PDF</button>
        </div>
      </div>

      {/* The paper */}
      <div className="p-6 sm:p-9 max-w-[820px] mx-auto">
        {/* Letterhead */}
        <div className="flex items-start justify-between gap-6 pb-6 border-b-2 border-slate-900">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0"><Landmark className="w-5 h-5" /></span>
              <span className="text-[19px] font-black text-slate-900 tracking-tight truncate">{brand}</span>
            </div>
            {inv.companySnapshot?.address && <p className="text-[11.5px] text-slate-500 mt-2 max-w-xs leading-relaxed">{inv.companySnapshot.address}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[24px] font-black text-slate-900 tracking-[-0.02em] leading-none uppercase">Invoice</p>
            <p className="text-[12px] font-mono text-slate-500 mt-1.5">{inv.invoiceNumber}</p>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mt-6">
          <Meta icon={Building2} label={t(T.billTo, lang)} value={inv.companyName} strong />
          <Meta icon={Hash} label={t(T.order, lang)} value={inv.shipmentNumber} mono />
          <Meta icon={CalendarDays} label={t(T.invoiceDate, lang)} value={inv.invoiceDate || (inv.issuedAt || inv.createdAt || "").slice(0, 10) || "—"} />
          <Meta icon={CalendarDays} label={t(T.dueDate, lang)} value={inv.dueDate || "—"} />
        </div>

        {/* Line items */}
        <div className="mt-7 overflow-x-auto">
          <table className="w-full text-[12.5px] border-separate border-spacing-0 min-w-[520px]">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left py-2.5 px-3 pl-0 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200">{t(T.desc, lang)}</th>
                <th className="text-right py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200 w-16">{t(T.qty, lang)}</th>
                <th className="text-right py-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200">{t(T.unit, lang)}</th>
                <th className="text-right py-2.5 px-3 pr-0 text-[10px] font-semibold uppercase tracking-[0.05em] border-b border-slate-200">{t(T.amount, lang)}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id || i}>
                  <td className="py-3 px-3 pl-0 border-b border-slate-50 align-top">
                    <div className="font-semibold text-slate-800">{l.customServiceType || l.serviceType || "—"}</div>
                    {l.description && <div className="text-[11.5px] text-slate-400 mt-0.5">{l.description}</div>}
                  </td>
                  <td className="py-3 px-3 text-right border-b border-slate-50 tabular-nums text-slate-600">{l.quantity}</td>
                  <td className="py-3 px-3 text-right border-b border-slate-50 tabular-nums text-slate-600">{money(Number(l.unitPrice || 0))}</td>
                  <td className="py-3 px-3 pr-0 text-right border-b border-slate-50 tabular-nums font-semibold text-slate-800">{money(Number(l.amount || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mt-5 flex justify-end">
          <div className="w-full sm:w-72 space-y-1.5">
            <TotalRow label={t(T.subtotal, lang)} value={money(subtotal)} cur={inv.currency} />
            {!!inv.discountAmount && <TotalRow label={t(T.discount, lang)} value={`−${money(inv.discountAmount)}`} cur={inv.currency} />}
            {!!inv.taxAmount && <TotalRow label={t(T.tax, lang)} value={money(inv.taxAmount)} cur={inv.currency} />}
            {!!inv.additionalCharges && <TotalRow label={t(T.charges, lang)} value={money(inv.additionalCharges)} cur={inv.currency} />}
            <div className="flex items-center justify-between pt-2.5 mt-1 border-t-2 border-slate-900">
              <span className="text-[13px] font-black uppercase tracking-wide text-slate-900">{t(T.total, lang)}</span>
              <span className="text-[19px] font-black tabular-nums text-slate-900">{money(total)} <span className="text-[12px] text-slate-400">{inv.currency}</span></span>
            </div>
          </div>
        </div>

        {/* Footer: terms + bank + notes */}
        {(inv.paymentTerms || inv.bankAccountSnapshot || inv.customerNotes || inv.notes) && (
          <div className="mt-8 pt-5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {inv.paymentTerms && <FooterBlock label={t(T.terms, lang)} value={inv.paymentTerms} />}
            {inv.bankAccountSnapshot && <FooterBlock label={t(T.bank, lang)} value={typeof inv.bankAccountSnapshot === "string" ? inv.bankAccountSnapshot : [inv.bankAccountSnapshot.bankName, inv.bankAccountSnapshot.accountNumber].filter(Boolean).join(" · ")} />}
            {(inv.customerNotes || inv.notes) && <FooterBlock label={t(T.notes, lang)} value={(inv.customerNotes || inv.notes)!} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ icon: Icon, label, value, strong, mono }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-slate-400"><Icon className="w-3.5 h-3.5" /><span className="text-[10px] font-semibold uppercase tracking-[0.05em]">{label}</span></div>
      <p className={`mt-1 text-[13px] ${strong ? "font-bold text-slate-900" : "text-slate-700"} ${mono ? "font-mono" : ""} truncate`}>{value}</p>
    </div>
  );
}
function TotalRow({ label, value, cur }: { label: string; value: string; cur: string }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className="tabular-nums text-slate-700 font-semibold">{value} <span className="text-[10px] text-slate-400">{cur}</span></span>
    </div>
  );
}
function FooterBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400">{label}</p>
      <p className="mt-1 text-[12px] text-slate-600 leading-relaxed">{value}</p>
    </div>
  );
}
