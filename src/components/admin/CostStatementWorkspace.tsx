import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Eye, MoreHorizontal, Save, Send, Plus, FileText, ScrollText,
  Receipt, Building2, CheckCircle2, Circle, AlertTriangle, Loader2, Lock, Download,
} from "lucide-react";
import type { Language, CostStatement, Shipment, Client, BankAccount, CustomerInvoice, CostItem } from "../../types";
import { apiFetch } from "../../lib/api";
import { openAccountingPdf } from "../../lib/openAccountingPdf";
import { deriveExpenseSummary, deriveCustomerSummary, resolveCustomerReceivedAmount, computeGrossProfit } from "../../lib/costStatementMath";
import VendorPayablesPanel from "./VendorPayablesPanel";
import CustomerInvoicePanel from "./CustomerInvoicePanel";
import CostApprovalWorkflowCard from "./CostApprovalWorkflowCard";
import MobileAccountingQuickActions from "./mobile/MobileAccountingQuickActions";

/**
 * CostStatementWorkspace — the full-screen accounting workspace that replaces
 * the old dual-column cost-statement MODAL. It renders inside the admin shell
 * (sidebar preserved, no darkened backdrop) and guides the employee through the
 * canonical workflow: Expenses → Vendor Payments → Customer Invoice → Customer
 * Payments → Review & Approve.
 *
 * IMPORTANT: this is a UI/UX restructuring only. Every total shown here is
 * DERIVED (costStatementMath) or comes from a server record — the browser is
 * never the financial source of truth, and no aggregate accounting field is
 * editable. All writes go through the existing panels/APIs unchanged.
 */
type L3 = { en: string; ar: string; tr: string };
const pick = (l: L3, lang: Language) => l[lang] || l.en;
const T = {
  title: { en: "Shipment Cost Statement", ar: "كشف تكاليف الشحنة", tr: "Sevkiyat Maliyet Tablosu" },
  subtitle: { en: "Create and manage shipment expenses, vendor payments and customer invoicing", ar: "إنشاء وإدارة مصاريف الشحنة ومدفوعات الموردين وفوترة العملاء", tr: "Sevkiyat masraflarını, tedarikçi ödemelerini ve müşteri faturalarını yönetin" },
  back: { en: "Back to Cost Statements", ar: "العودة إلى كشوف التكاليف", tr: "Maliyet Tablolarına Dön" },
  preview: { en: "Preview Documents", ar: "معاينة المستندات", tr: "Belgeleri Önizle" },
  more: { en: "More Actions", ar: "إجراءات أخرى", tr: "Diğer İşlemler" },
  saveDraft: { en: "Save Draft", ar: "حفظ المسودة", tr: "Taslağı Kaydet" },
  submit: { en: "Submit for Approval", ar: "إرسال للاعتماد", tr: "Onaya Gönder" },
  expenses: { en: "Shipment Expenses", ar: "مصاريف الشحنة", tr: "Sevkiyat Masrafları" },
  expensesDesc: { en: "Add all logistics costs and expenses for this shipment.", ar: "أضف جميع تكاليف ومصاريف الخدمات اللوجستية لهذه الشحنة.", tr: "Bu sevkiyat için tüm lojistik maliyetleri ekleyin." },
  vendorPayments: { en: "Vendor Payments", ar: "مدفوعات الموردين", tr: "Tedarikçi Ödemeleri" },
  vendorPaymentsDesc: { en: "Record payments made to shipment vendors.", ar: "سجّل المدفوعات للموردين.", tr: "Tedarikçilere yapılan ödemeleri kaydedin." },
  summary: { en: "Accounting Summary", ar: "الملخص المحاسبي", tr: "Muhasebe Özeti" },
  invoice: { en: "Customer Invoice", ar: "فاتورة العميل", tr: "Müşteri Faturası" },
  customerPayments: { en: "Customer Payments", ar: "مدفوعات العميل", tr: "Müşteri Ödemeleri" },
  documents: { en: "Documents", ar: "المستندات", tr: "Belgeler" },
  approval: { en: "Approval Workflow", ar: "سير الاعتماد", tr: "Onay Akışı" },
  agreedPrice: { en: "Agreed Selling Price", ar: "سعر البيع المتفق", tr: "Anlaşılan Satış Fiyatı" },
  totalExpenses: { en: "Total Internal Expenses", ar: "إجمالي المصاريف الداخلية", tr: "Toplam İç Masraf" },
  paidVendors: { en: "Paid to Vendors", ar: "المدفوع للموردين", tr: "Tedarikçilere Ödenen" },
  remainingVendors: { en: "Remaining to Vendors", ar: "المتبقي للموردين", tr: "Tedarikçilere Kalan" },
  receivedCustomer: { en: "Received from Customer", ar: "المستلم من العميل", tr: "Müşteriden Alınan" },
  remainingCustomer: { en: "Remaining from Customer", ar: "المتبقي من العميل", tr: "Müşteriden Kalan" },
  grossProfit: { en: "Gross Shipment Profit", ar: "إجمالي ربح الشحنة", tr: "Brüt Sevkiyat Kârı" },
  overpaidWarn: { en: "Vendor overpayment credit exists — review the vendor payments before approval.", ar: "يوجد رصيد دفع زائد للمورد — راجع مدفوعات الموردين قبل الاعتماد.", tr: "Tedarikçi fazla ödeme kredisi var — onaydan önce inceleyin." },
  noExpenses: { en: "No shipment expenses have been added yet. Add the first expense before recording a vendor payment.", ar: "لم تتم إضافة أي مصاريف بعد. أضف أول مصروف قبل تسجيل دفعة للمورد.", tr: "Henüz masraf eklenmedi. Tedarikçi ödemesi kaydetmeden önce ilk masrafı ekleyin." },
  noVendorYet: { en: "Add at least one expense to enable vendor payments.", ar: "أضف مصروفًا واحدًا على الأقل لتفعيل مدفوعات الموردين.", tr: "Tedarikçi ödemelerini etkinleştirmek için en az bir masraf ekleyin." },
  noInvoice: { en: "No customer invoice has been created.", ar: "لم يتم إنشاء فاتورة عميل.", tr: "Müşteri faturası oluşturulmadı." },
  submitBlocked: { en: "Complete the highlighted accounting requirements before submitting for approval.", ar: "أكمل المتطلبات المحاسبية المميّزة قبل الإرسال للاعتماد.", tr: "Onaya göndermeden önce vurgulanan gereksinimleri tamamlayın." },
  checklist: { en: "Submission requirements", ar: "متطلبات الإرسال", tr: "Gönderim gereksinimleri" },
  addExpense: { en: "Add Expense", ar: "إضافة مصروف", tr: "Masraf Ekle" },
  notGenerated: { en: "Not generated", ar: "غير مُنشأ", tr: "Oluşturulmadı" },
  available: { en: "Available", ar: "متاح", tr: "Mevcut" },
  lastSaved: { en: "Last saved", ar: "آخر حفظ", tr: "Son kayıt" },
};
const step = {
  s1: { en: "Expenses", ar: "المصاريف", tr: "Masraflar" },
  s2: { en: "Vendor Payments", ar: "مدفوعات الموردين", tr: "Tedarikçi Ödemeleri" },
  s3: { en: "Customer Invoice", ar: "فاتورة العميل", tr: "Müşteri Faturası" },
  s4: { en: "Customer Payments", ar: "مدفوعات العميل", tr: "Müşteri Ödemeleri" },
  s5: { en: "Review & Approve", ar: "المراجعة والاعتماد", tr: "İncele ve Onayla" },
  d1: { en: "Add shipment expenses", ar: "أضف مصاريف الشحنة", tr: "Masraf ekleyin" },
  d2: { en: "Pay your vendors", ar: "ادفع للموردين", tr: "Tedarikçilere ödeyin" },
  d3: { en: "Create invoice for customer", ar: "أنشئ فاتورة للعميل", tr: "Müşteri faturası oluşturun" },
  d4: { en: "Record customer receipts", ar: "سجّل مقبوضات العميل", tr: "Müşteri tahsilatları" },
  d5: { en: "Review and submit", ar: "راجع وأرسل", tr: "İncele ve gönder" },
};

const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type StepState = "incomplete" | "ready" | "active" | "completed" | "blocked";

const STEP_STYLE: Record<StepState, { ring: string; text: string; badge: string }> = {
  completed: { ring: "bg-emerald-500 text-white border-emerald-500", text: "text-emerald-700", badge: "" },
  active: { ring: "bg-orange-500 text-white border-orange-500", text: "text-orange-700", badge: "" },
  ready: { ring: "bg-white text-blue-600 border-blue-300", text: "text-blue-700", badge: "" },
  incomplete: { ring: "bg-white text-slate-400 border-slate-300", text: "text-slate-500", badge: "" },
  blocked: { ring: "bg-slate-100 text-slate-400 border-slate-200", text: "text-slate-400", badge: "" },
};

interface Props {
  statement: CostStatement;
  shipments: Shipment[];
  clients: Client[];
  bankAccounts: BankAccount[];
  lang: Language;
  canWrite: boolean;
  actor: { sessionId: string; isSuperAdmin: boolean; canWriteCostStatements: boolean };
  onBack: () => void;
  onRefresh: () => void;
  onExportCsv?: () => void;
  onSaveDraft?: () => void;
  onSubmitForApproval?: () => void;
  onOpenCustomer?: (clientId: string | null) => void;
  isSaving?: boolean;
  lastSavedLabel?: string;
}

export default function CostStatementWorkspace({
  statement, shipments, clients, bankAccounts, lang, canWrite, actor,
  onBack, onRefresh, onExportCsv, onSaveDraft, onSubmitForApproval, onOpenCustomer, isSaving, lastSavedLabel,
}: Props) {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const shipment = useMemo(() => shipments.find((s) => s.id === statement.shipmentId), [shipments, statement.shipmentId]);
  // The statement carries only companyName; the immutable clientId is resolved
  // from the registered customer whose companyName matches (never guessed).
  const resolvedClientId = useMemo(() => {
    const match = clients.find((c) => c.companyName === statement.companyName);
    return match?.id || null;
  }, [statement.companyName, clients]);

  const items: CostItem[] = statement.items || [];
  const agreedAmount = (shipment?.agreedAmount ?? statement.agreedAmount) || 0;
  const agreedCurrency = statement.agreedCurrency || statement.currency;
  const totalCost = Number(statement.totalCost || 0);
  const paidAmount = Number(statement.paidAmount || 0);
  const expense = deriveExpenseSummary(totalCost, paidAmount);
  const customer = deriveCustomerSummary(agreedAmount, resolveCustomerReceivedAmount(statement));
  const grossProfit = computeGrossProfit(agreedAmount, agreedCurrency, totalCost, statement.currency);

  const hasExpenses = items.length > 0;
  const issuedInvoice = invoices.find((i) => i.status === "issued" || i.status === "partially_paid" || i.status === "paid");
  const hasIssuedInvoice = !!issuedInvoice;
  const hasValidCustomer = !!resolvedClientId;
  const hasOverpaidVendor = expense.expenseCredit > 0;

  // Derived step states — a workflow indicator, never hidden data.
  const steps: Array<{ key: string; title: L3; desc: L3; state: StepState; hint?: string }> = [
    { key: "expenses", title: step.s1, desc: step.d1, state: hasExpenses ? "completed" : "active" },
    { key: "vendor", title: step.s2, desc: step.d2, state: !hasExpenses ? "blocked" : expense.paymentStatus === "Paid" ? "completed" : "ready", hint: !hasExpenses ? pick(T.noVendorYet, lang) : undefined },
    { key: "invoice", title: step.s3, desc: step.d3, state: !(hasValidCustomer && agreedAmount > 0) ? "blocked" : hasIssuedInvoice ? "completed" : "ready", hint: !hasValidCustomer ? pick(T.noInvoice, lang) : undefined },
    { key: "payments", title: step.s4, desc: step.d4, state: !hasIssuedInvoice ? "blocked" : customer.customerStatus === "Paid" ? "completed" : "ready" },
    { key: "review", title: step.s5, desc: step.d5, state: (hasExpenses && hasValidCustomer && !hasOverpaidVendor) ? "ready" : "blocked" },
  ];

  // Submission checklist (human-readable; shown BEFORE the click, not after).
  const checklist = [
    { ok: hasValidCustomer, label: { en: "Customer account is linked", ar: "حساب العميل مرتبط", tr: "Müşteri hesabı bağlı" } },
    { ok: !!statement.date, label: { en: "Statement date is set", ar: "تاريخ الكشف محدد", tr: "Tablo tarihi ayarlı" } },
    { ok: !!statement.currency, label: { en: "Primary currency is set", ar: "العملة الأساسية محددة", tr: "Ana para birimi ayarlı" } },
    { ok: hasExpenses, label: { en: "At least one expense exists", ar: "يوجد مصروف واحد على الأقل", tr: "En az bir masraf var" } },
    { ok: !hasOverpaidVendor, label: { en: "No unresolved vendor overpayment", ar: "لا يوجد دفع زائد للمورد", tr: "Çözülmemiş fazla ödeme yok" } },
  ];
  const canSubmit = canWrite && checklist.every((c) => c.ok);

  const scrollTo = useCallback((key: string) => {
    setScrollTarget(key);
    document.getElementById(`csw-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  useEffect(() => { if (scrollTarget) { const t = setTimeout(() => setScrollTarget(null), 800); return () => clearTimeout(t); } }, [scrollTarget]);

  const statusBadge = (statement.paymentStatus || (statement as any).status || "DRAFT").toString();

  // On-demand document preview (server-rendered snapshots; permission-gated on the server).
  const previewDoc = (path: string) => { void openAccountingPdf(path); };

  return (
    <div className="w-full min-h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onBack} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 bg-transparent border-0 cursor-pointer p-0"><ArrowLeft className="w-3.5 h-3.5" />{pick(T.back, lang)}</button>
          <div className="flex items-center gap-2">
            <button onClick={() => scrollTo("documents")} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" />{pick(T.preview, lang)}</button>
            <div className="relative">
              <button onClick={() => setShowMore((v) => !v)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><MoreHorizontal className="w-3.5 h-3.5" />{pick(T.more, lang)}</button>
              {showMore && (
                <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                  {onExportCsv && <button onClick={() => { onExportCsv(); setShowMore(false); }} className="w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Download className="w-3.5 h-3.5" />Export CSV</button>}
                  <button onClick={() => { onRefresh(); setShowMore(false); }} className="w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer">Refresh</button>
                </div>
              )}
            </div>
            {canWrite && onSaveDraft && <button onClick={onSaveDraft} disabled={isSaving} className="px-3 py-1.5 bg-white border border-blue-200 text-blue-700 text-[11px] font-bold rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5">{isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{pick(T.saveDraft, lang)}</button>}
            {canWrite && (
              <button onClick={() => (onSubmitForApproval ? onSubmitForApproval() : scrollTo("review"))} disabled={!canSubmit} title={!canSubmit ? pick(T.submitBlocked, lang) : undefined} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[11px] font-bold rounded-lg cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5"><Send className="w-3.5 h-3.5" />{pick(T.submit, lang)}</button>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-slate-900">{pick(T.title, lang)}</h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-600 tracking-wide">{statusBadge}</span>
          </div>
          <p className="text-[12px] text-slate-500 mt-0.5">{pick(T.subtitle, lang)}</p>
        </div>
        {/* Shipment header grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-2 text-[11px]">
          <HeaderCell label="Shipment" value={statement.shipmentNumber} mono />
          <HeaderCell label="Customer" value={statement.companyName} />
          <HeaderCell label="Client ID" value={resolvedClientId || "—"} mono />
          <HeaderCell label="Route" value={shipment ? `${shipment.loadingCountry || "?"} → ${shipment.deliveryCountry || "?"}` : "—"} />
          <HeaderCell label="Modality" value={`${(statement.shipmentType || "").toString().toUpperCase()} FREIGHT`} />
          <HeaderCell label="Currency" value={statement.currency} mono />
          <HeaderCell label="Agreed Price" value={`${money(agreedAmount)} ${agreedCurrency}`} strong />
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {steps.map((s, i) => {
            const st = STEP_STYLE[s.state];
            return (
              <div key={s.key} className="flex items-center">
                <button onClick={() => scrollTo(s.key)} className="flex items-center gap-2 bg-transparent border-0 cursor-pointer p-1 text-left" title={s.hint}>
                  <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-black shrink-0 ${st.ring}`}>
                    {s.state === "completed" ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.state === "blocked" ? <Lock className="w-3 h-3" /> : i + 1}
                  </span>
                  <span className="hidden md:block">
                    <span className={`block text-[11px] font-black leading-none ${st.text}`}>{pick(s.title, lang)}</span>
                    <span className="block text-[9px] text-slate-400 mt-0.5">{s.hint || pick(s.desc, lang)}</span>
                  </span>
                </button>
                {i < steps.length - 1 && <span className="text-slate-300 mx-1 shrink-0">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Body — two columns on desktop, single on tablet/smaller */}
      <div className="px-4 md:px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Expenses */}
          <section id="csw-expenses" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">{pick(T.expenses, lang)}</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{pick(T.expensesDesc, lang)}</p>
            </div>
            {!hasExpenses ? (
              <p className="text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">{pick(T.noExpenses, lang)}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-100">
                      <th className="py-1.5 pr-2">#</th><th className="py-1.5 pr-2">Expense Type</th><th className="py-1.5 pr-2">Description</th>
                      <th className="py-1.5 pr-2">Vendor</th><th className="py-1.5 pr-2">Invoice / Ref</th><th className="py-1.5 pr-2">Due</th>
                      <th className="py-1.5 pr-2 text-right">Amount</th><th className="py-1.5 pr-2">Currency</th><th className="py-1.5 pr-2">Attachment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id} className="border-b border-slate-50">
                        <td className="py-1.5 pr-2 text-slate-400">{idx + 1}</td>
                        <td className="py-1.5 pr-2 font-semibold text-slate-700">{it.costType || "—"}</td>
                        <td className="py-1.5 pr-2 text-slate-600">{it.description || "—"}</td>
                        <td className="py-1.5 pr-2 text-slate-600">{it.supplierName || "—"}</td>
                        <td className="py-1.5 pr-2 font-mono text-slate-500">{(it as any).invoiceReference || (it as any).reference || "—"}</td>
                        <td className="py-1.5 pr-2 font-mono text-slate-500">{(it as any).dueDate || "—"}</td>
                        <td className="py-1.5 pr-2 text-right font-mono font-bold text-slate-800">{money(Number(it.totalAmount || 0))}</td>
                        <td className="py-1.5 pr-2 font-mono text-slate-500">{it.currency}</td>
                        <td className="py-1.5 pr-2">{(it as any).attachmentUrl ? <a href={(it as any).attachmentUrl} target="_blank" rel="noreferrer" className="text-orange-600 underline">view</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Add Expense — reuses the existing item API (server-authoritative). */}
            {canWrite && (
              <div>
                <MobileAccountingQuickActions shipmentId={statement.shipmentId} canWrite={canWrite} sessionId={actor.sessionId} lang={lang} embedded />
              </div>
            )}
            {/* Derived totals — READ ONLY (never manually editable). */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
              <Stat label="Total Expenses" value={`${money(totalCost)} ${statement.currency}`} tone="neutral" />
              <Stat label={pick(T.paidVendors, lang)} value={`${money(paidAmount)} ${statement.currency}`} tone="green" />
              <Stat label={pick(T.remainingVendors, lang)} value={`${money(expense.expenseRemaining)} ${statement.currency}`} tone="orange" />
              <Stat label="Overpaid (Credit)" value={`${money(expense.expenseCredit)} ${statement.currency}`} tone={hasOverpaidVendor ? "red" : "neutral"} />
            </div>
            {hasOverpaidVendor && (
              <p className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{pick(T.overpaidWarn, lang)}</p>
            )}
          </section>

          {/* Vendor Payments */}
          <section id="csw-vendor" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">{pick(T.vendorPayments, lang)}</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{pick(T.vendorPaymentsDesc, lang)}</p>
            </div>
            {!hasExpenses ? (
              <p className="text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">{pick(T.noVendorYet, lang)}</p>
            ) : (
              <VendorPayablesPanel shipmentId={statement.shipmentId} items={items} bankAccounts={bankAccounts} canWrite={canWrite} lang={lang} />
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Accounting summary */}
          <section id="csw-summary" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-sm font-black text-slate-900 mb-2">{pick(T.summary, lang)}</h2>
            <div className="space-y-1.5 text-[12px]">
              <SumRow label={pick(T.agreedPrice, lang)} value={`${money(agreedAmount)} ${agreedCurrency}`} />
              <SumRow label={pick(T.totalExpenses, lang)} value={`${money(totalCost)} ${statement.currency}`} />
              <SumRow label={pick(T.paidVendors, lang)} value={`${money(paidAmount)} ${statement.currency}`} tone="green" />
              <SumRow label={pick(T.remainingVendors, lang)} value={`${money(expense.expenseRemaining)} ${statement.currency}`} tone="orange" />
              <div className="border-t border-dashed border-slate-200 my-1" />
              <SumRow label={pick(T.receivedCustomer, lang)} value={`${money(customer.customerReceivedAmount)} ${agreedCurrency}`} tone="green" />
              <SumRow label={pick(T.remainingCustomer, lang)} value={`${money(customer.customerReceivable)} ${agreedCurrency}`} tone="orange" />
              <div className="border-t border-slate-200 my-1" />
              <SumRow label={pick(T.grossProfit, lang)} value={grossProfit === null ? "—" : `${money(grossProfit)} ${agreedCurrency}`} tone="profit" strong />
              {grossProfit === null && <p className="text-[10px] text-slate-400">Different currencies — not aggregated.</p>}
            </div>
          </section>

          {/* Customer Invoice */}
          <section id="csw-invoice" className="space-y-2">
            <h2 className="text-sm font-black text-slate-900 px-1">{pick(T.invoice, lang)}</h2>
            <CustomerInvoicePanel
              shipmentId={statement.shipmentId}
              currency={agreedCurrency as any}
              bankAccounts={bankAccounts}
              canWrite={canWrite}
              lang={lang}
              clientId={resolvedClientId || undefined}
              onInvoicesChange={setInvoices}
              onLinkCustomer={onOpenCustomer ? () => onOpenCustomer(resolvedClientId) : undefined}
            />
          </section>

          {/* Customer Payments (status derived from records; no manual received field) */}
          <section id="csw-payments" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
            <h2 className="text-sm font-black text-slate-900">{pick(T.customerPayments, lang)}</h2>
            {!hasIssuedInvoice ? (
              <p className="text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">{pick(T.noInvoice, lang)}</p>
            ) : (
              <div className="space-y-1.5 text-[12px]">
                <SumRow label="Invoice Amount" value={`${money(issuedInvoice!.sellingAmount)} ${issuedInvoice!.currency}`} />
                <SumRow label="Received" value={`${money(customer.customerReceivedAmount)} ${agreedCurrency}`} tone="green" />
                <SumRow label="Remaining" value={`${money(customer.customerReceivable)} ${agreedCurrency}`} tone="orange" />
                <SumRow label="Invoice Status" value={issuedInvoice!.status.replace("_", " ")} />
              </div>
            )}
          </section>

          {/* Documents — compact cards, opened ON DEMAND (no permanent PDF pane) */}
          <section id="csw-documents" className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
            <h2 className="text-sm font-black text-slate-900">{pick(T.documents, lang)}</h2>
            <div className="grid grid-cols-2 gap-2">
              <DocCard icon={<ScrollText className="w-4 h-4 text-slate-500" />} name="Cost Statement" ready onPreview={() => previewDoc(`/api/cost-statements/${statement.shipmentId}/pdf?lang=${lang}`)} lang={lang} />
              <DocCard icon={<FileText className="w-4 h-4 text-blue-500" />} name="Customer Invoice" ready={hasIssuedInvoice} onPreview={hasIssuedInvoice ? () => previewDoc(`/api/cost-statements/${statement.shipmentId}/invoices/${issuedInvoice!.id}/pdf?lang=${lang}`) : undefined} lang={lang} />
              <DocCard icon={<FileText className="w-4 h-4 text-emerald-500" />} name="Customer Statement" ready onPreview={() => previewDoc(`/api/customer-accounts/statement/pdf?company=${encodeURIComponent(statement.companyName)}&currency=${agreedCurrency}&lang=${lang}`)} lang={lang} />
              <DocCard icon={<Building2 className="w-4 h-4 text-red-500" />} name="Vendor Voucher" ready={false} lang={lang} />
              <DocCard icon={<Receipt className="w-4 h-4 text-teal-500" />} name="Payment Receipt" ready={false} lang={lang} />
            </div>
          </section>

          {/* Approval */}
          <section id="csw-review" className="space-y-2">
            <h2 className="text-sm font-black text-slate-900 px-1">{pick(T.approval, lang)}</h2>
            {!canSubmit && (
              <div className="bg-white rounded-xl border border-amber-200 p-3 space-y-1.5">
                <p className="text-[11px] font-black text-amber-800">{pick(T.checklist, lang)}</p>
                {checklist.map((c, i) => (
                  <div key={i} className={`flex items-center gap-1.5 text-[11px] ${c.ok ? "text-emerald-700" : "text-slate-500"}`}>
                    {c.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Circle className="w-3.5 h-3.5 text-slate-300" />}
                    {pick(c.label as L3, lang)}
                  </div>
                ))}
              </div>
            )}
            <CostApprovalWorkflowCard lang={lang} statement={statement} actor={actor} onChanged={onRefresh} />
          </section>
        </div>
      </div>

      {lastSavedLabel && (
        <div className="px-4 md:px-6 py-2 text-[10px] text-slate-400 text-right">{pick(T.lastSaved, lang)}: {lastSavedLabel}</div>
      )}
    </div>
  );
}

function HeaderCell({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div>
      <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-slate-800 ${mono ? "font-mono" : ""} ${strong ? "font-black text-emerald-700" : "font-semibold"}`}>{value}</div>
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone: "neutral" | "green" | "orange" | "red" }) {
  const c = tone === "green" ? "text-emerald-600" : tone === "orange" ? "text-orange-600" : tone === "red" ? "text-red-600" : "text-slate-800";
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
      <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-[13px] font-black font-mono mt-0.5 ${c}`}>{value}</div>
    </div>
  );
}
function SumRow({ label, value, tone, strong }: { label: string; value: string; tone?: "green" | "orange" | "profit"; strong?: boolean }) {
  const c = tone === "green" ? "text-emerald-600" : tone === "orange" ? "text-orange-600" : tone === "profit" ? "text-emerald-700" : "text-slate-800";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono ${strong ? "font-black" : "font-bold"} ${c}`}>{value}</span>
    </div>
  );
}
function DocCard({ icon, name, ready, onPreview, lang }: { icon: React.ReactNode; name: string; ready: boolean; onPreview?: () => void; lang: Language }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 flex flex-col items-center text-center gap-1">
      {icon}
      <div className="text-[10px] font-bold text-slate-700 leading-tight">{name}</div>
      <div className={`text-[8px] font-black uppercase ${ready ? "text-emerald-600" : "text-slate-400"}`}>{ready ? pick(T.available, lang) : pick(T.notGenerated, lang)}</div>
      {ready && onPreview && <button onClick={onPreview} className="mt-0.5 text-[9px] font-bold text-orange-600 hover:underline bg-transparent border-0 cursor-pointer p-0 flex items-center gap-0.5"><Eye className="w-3 h-3" />{pick(T.preview, lang)}</button>}
    </div>
  );
}
