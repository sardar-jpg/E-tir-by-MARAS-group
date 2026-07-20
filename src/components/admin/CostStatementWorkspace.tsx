import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Eye, MoreHorizontal, Save, Send, Plus, FileText, ScrollText,
  Receipt, Building2, CheckCircle2, Circle, AlertTriangle, Loader2, Lock, Download,
  Package, MapPin, Boxes, Coins, Tag, Calendar, Flag, Printer, TrendingUp,
  Clock, ChevronDown,
} from "lucide-react";
import type { Language, CostStatement, Shipment, Client, BankAccount, CustomerInvoice, CostItem } from "../../types";
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
  more: { en: "Actions", ar: "إجراءات", tr: "İşlemler" },
  saveDraft: { en: "Save Draft", ar: "حفظ المسودة", tr: "Taslağı Kaydet" },
  submit: { en: "Submit for Approval", ar: "إرسال للاعتماد", tr: "Onaya Gönder" },
  expenses: { en: "Shipment Expenses", ar: "مصاريف الشحنة", tr: "Sevkiyat Masrafları" },
  expensesDesc: { en: "Add all logistics costs and expenses for this shipment.", ar: "أضف جميع تكاليف ومصاريف الخدمات اللوجستية لهذه الشحنة.", tr: "Bu sevkiyat için tüm lojistik maliyetleri ekleyin." },
  vendorPayments: { en: "Vendor Payments", ar: "مدفوعات الموردين", tr: "Tedarikçi Ödemeleri" },
  vendorPaymentsDesc: { en: "Record payments made to shipment vendors.", ar: "سجّل المدفوعات للموردين.", tr: "Tedarikçilere yapılan ödemeleri kaydedin." },
  payVendor: { en: "Pay Vendor", ar: "دفع للمورد", tr: "Tedarikçiye Öde" },
  summary: { en: "Accounting Summary", ar: "الملخص المحاسبي", tr: "Muhasebe Özeti" },
  summaryDesc: { en: "Server-authoritative figures. Currencies are never mixed.", ar: "أرقام معتمدة من الخادم. لا تُخلط العملات.", tr: "Sunucu onaylı rakamlar. Para birimleri karıştırılmaz." },
  invoice: { en: "Customer Invoice", ar: "فاتورة العميل", tr: "Müşteri Faturası" },
  customerPayments: { en: "Customer Payments", ar: "مدفوعات العميل", tr: "Müşteri Ödemeleri" },
  customerPaymentsDesc: { en: "Record payments received from your customer.", ar: "سجّل المدفوعات المستلمة من العميل.", tr: "Müşteriden alınan ödemeleri kaydedin." },
  documents: { en: "Documents", ar: "المستندات", tr: "Belgeler" },
  approval: { en: "Approval Workflow", ar: "سير الاعتماد", tr: "Onay Akışı" },
  approvalDesc: { en: "Review and approval sequence.", ar: "تسلسل المراجعة والاعتماد.", tr: "İnceleme ve onay dizisi." },
  agreedPrice: { en: "Agreed Selling Price", ar: "سعر البيع المتفق", tr: "Anlaşılan Satış Fiyatı" },
  totalExpenses: { en: "Total Expenses", ar: "إجمالي المصاريف", tr: "Toplam Masraf" },
  paidVendors: { en: "Paid to Vendors", ar: "المدفوع للموردين", tr: "Tedarikçilere Ödenen" },
  remainingVendors: { en: "Remaining Payable", ar: "المتبقي للموردين", tr: "Kalan Borç" },
  overpaid: { en: "Overpaid (Credit)", ar: "مدفوع بالزيادة (رصيد)", tr: "Fazla Ödenen (Kredi)" },
  receivedCustomer: { en: "Received from Customer", ar: "المستلم من العميل", tr: "Müşteriden Alınan" },
  remainingCustomer: { en: "Customer Balance", ar: "رصيد العميل", tr: "Müşteri Bakiyesi" },
  grossProfit: { en: "Gross Shipment Profit", ar: "إجمالي ربح الشحنة", tr: "Brüt Sevkiyat Kârı" },
  internal: { en: "Internal only", ar: "داخلي فقط", tr: "Yalnızca dahili" },
  overpaidWarn: { en: "Vendor overpayment credit exists — review the vendor payments before approval.", ar: "يوجد رصيد دفع زائد للمورد — راجع مدفوعات الموردين قبل الاعتماد.", tr: "Tedarikçi fazla ödeme kredisi var — onaydan önce inceleyin." },
  noExpenses: { en: "No shipment expenses have been added yet. Add the first expense before recording a vendor payment.", ar: "لم تتم إضافة أي مصاريف بعد. أضف أول مصروف قبل تسجيل دفعة للمورد.", tr: "Henüz masraf eklenmedi. Tedarikçi ödemesi kaydetmeden önce ilk masrafı ekleyin." },
  noVendorYet: { en: "Add at least one expense to enable vendor payments.", ar: "أضف مصروفًا واحدًا على الأقل لتفعيل مدفوعات الموردين.", tr: "Tedarikçi ödemelerini etkinleştirmek için en az bir masraf ekleyin." },
  noInvoice: { en: "No customer invoice has been created.", ar: "لم يتم إنشاء فاتورة عميل.", tr: "Müşteri faturası oluşturulmadı." },
  submitBlocked: { en: "Complete the highlighted accounting requirements before submitting for approval.", ar: "أكمل المتطلبات المحاسبية المميّزة قبل الإرسال للاعتماد.", tr: "Onaya göndermeden önce vurgulanan gereksinimleri tamamlayın." },
  checklist: { en: "Submission requirements", ar: "متطلبات الإرسال", tr: "Gönderim gereksinimleri" },
  addExpense: { en: "Add Expense", ar: "إضافة مصروف", tr: "Masraf Ekle" },
  notGenerated: { en: "Not Generated", ar: "غير مُنشأ", tr: "Oluşturulmadı" },
  generated: { en: "Generated", ar: "مُنشأ", tr: "Oluşturuldu" },
  available: { en: "Generated", ar: "مُنشأ", tr: "Oluşturuldu" },
  lastSaved: { en: "Last saved", ar: "آخر حفظ", tr: "Son kayıt" },
  progress: { en: "Accounting Progress", ar: "التقدم المحاسبي", tr: "Muhasebe İlerlemesi" },
  linkedCargo: { en: "Linked Cargo", ar: "الشحنة المرتبطة", tr: "Bağlı Kargo" },
  expenseAdded: { en: "Expense added successfully", ar: "تمت إضافة المصروف بنجاح", tr: "Masraf başarıyla eklendi" },
  paymentSaved: { en: "Payment recorded successfully", ar: "تم تسجيل الدفعة بنجاح", tr: "Ödeme başarıyla kaydedildi" },
  hShipment: { en: "Shipment", ar: "الشحنة", tr: "Sevkiyat" },
  hCustomer: { en: "Customer", ar: "العميل", tr: "Müşteri" },
  hRoute: { en: "Route", ar: "المسار", tr: "Güzergah" },
  hCargo: { en: "Cargo Type", ar: "نوع البضاعة", tr: "Kargo Türü" },
  hCurrency: { en: "Currency", ar: "العملة", tr: "Para Birimi" },
  hStatementDate: { en: "Statement Date", ar: "تاريخ الكشف", tr: "Tablo Tarihi" },
  hStatus: { en: "Status", ar: "الحالة", tr: "Durum" },
  clientId: { en: "Client ID", ar: "معرّف العميل", tr: "Müşteri No" },
  export: { en: "Export CSV", ar: "تصدير CSV", tr: "CSV Dışa Aktar" },
  refresh: { en: "Refresh", ar: "تحديث", tr: "Yenile" },
  print: { en: "Print", ar: "طباعة", tr: "Yazdır" },
};
const step = {
  s1: { en: "Expenses", ar: "المصاريف", tr: "Masraflar" },
  s2: { en: "Vendor Payments", ar: "مدفوعات الموردين", tr: "Tedarikçi Ödemeleri" },
  s3: { en: "Customer Invoice", ar: "فاتورة العميل", tr: "Müşteri Faturası" },
  s4: { en: "Customer Payments", ar: "مدفوعات العميل", tr: "Müşteri Ödemeleri" },
  s5: { en: "Review & Approve", ar: "المراجعة والاعتماد", tr: "İncele ve Onayla" },
  completed: { en: "Completed", ar: "مكتمل", tr: "Tamamlandı" },
  issued: { en: "Issued", ar: "صادرة", tr: "Düzenlendi" },
  inProgress: { en: "In Progress", ar: "قيد التنفيذ", tr: "Devam Ediyor" },
  pending: { en: "Pending", ar: "قيد الانتظار", tr: "Beklemede" },
  blocked: { en: "Blocked", ar: "محظور", tr: "Engellendi" },
  ready: { en: "Ready", ar: "جاهز", tr: "Hazır" },
  approved: { en: "Approved", ar: "معتمد", tr: "Onaylandı" },
};

const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type StepState = "completed" | "active" | "pending" | "blocked";

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
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  // Linear workflow completion — a step is "done" once it has meaningful
  // activity (matches how an operator reads progress), never hidden data.
  const done = [
    hasExpenses,                       // 1 expenses
    hasExpenses && paidAmount > 0,     // 2 at least one vendor payment
    hasIssuedInvoice,                  // 3 invoice issued
    hasIssuedInvoice && customer.customerStatus === "Paid", // 4 fully received
    false,                             // 5 approval (server-owned; stays pending here)
  ];
  const firstIncomplete = done.findIndex((d) => !d);
  const blockedPrereq = (i: number): boolean => (i === 1 && !hasExpenses) || (i === 2 && !hasValidCustomer) || (i === 3 && !hasIssuedInvoice);
  const stateOf = (i: number): StepState => {
    if (done[i]) return "completed";
    if (i === firstIncomplete) return blockedPrereq(i) ? "blocked" : "active";
    return blockedPrereq(i) ? "blocked" : "pending";
  };
  const stepLabel = (i: number, st: StepState): L3 => {
    if (st === "completed") return i === 2 ? step.issued : i === 4 ? step.approved : step.completed;
    if (st === "active") return i === 2 && !hasIssuedInvoice ? step.inProgress : i === 4 ? step.ready : step.inProgress;
    if (st === "blocked") return step.blocked;
    return step.pending;
  };
  const steps = [
    { key: "expenses", title: step.s1 },
    { key: "vendor", title: step.s2 },
    { key: "invoice", title: step.s3 },
    { key: "payments", title: step.s4 },
    { key: "review", title: step.s5 },
  ].map((s, i) => { const st = stateOf(i); return { ...s, i, state: st, statusLabel: stepLabel(i, st) }; });

  // Progress = share of steps reached (completed or currently active).
  const reached = steps.filter((s) => s.state === "completed" || s.state === "active").length;
  const progressPct = Math.round((reached / steps.length) * 100);

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
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); } }, [toast]);

  const statusBadge = (statement.paymentStatus || (statement as any).status || "DRAFT").toString();

  // On-demand document preview (server-rendered snapshots; permission-gated on the server).
  const previewDoc = (path: string) => { void openAccountingPdf(path); };
  const notifyChanged = (kind: "expense" | "vendor" | "submit") => {
    setToast(kind === "expense" ? pick(T.expenseAdded, lang) : pick(T.paymentSaved, lang));
    onRefresh();
  };

  return (
    <div className="w-full min-h-full bg-slate-50/70 pb-20">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-8 pt-5 pb-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onBack} className="text-[11px] font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1.5 bg-transparent border-0 cursor-pointer p-0 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />{pick(T.back, lang)}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => scrollTo("documents")} className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all shadow-sm">
              <Eye className="w-3.5 h-3.5" />{pick(T.preview, lang)}
            </button>
            <div className="relative">
              <button onClick={() => setShowMore((v) => !v)} className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all shadow-sm">
                <MoreHorizontal className="w-3.5 h-3.5" />{pick(T.more, lang)}<ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {showMore && (
                <>
                  <div className="fixed inset-x-0 top-0 bottom-0 z-10" onClick={() => setShowMore(false)} />
                  <div className="absolute right-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1.5">
                    <button onClick={() => { scrollTo("documents"); setShowMore(false); }} className="w-full text-left px-3.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Eye className="w-3.5 h-3.5 text-slate-400" />{pick(T.preview, lang)}</button>
                    {onExportCsv && <button onClick={() => { onExportCsv(); setShowMore(false); }} className="w-full text-left px-3.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Download className="w-3.5 h-3.5 text-slate-400" />{pick(T.export, lang)}</button>}
                    <button onClick={() => { window.print(); setShowMore(false); }} className="w-full text-left px-3.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Printer className="w-3.5 h-3.5 text-slate-400" />{pick(T.print, lang)}</button>
                    <div className="my-1 border-t border-slate-100" />
                    <button onClick={() => { onRefresh(); setShowMore(false); }} className="w-full text-left px-3.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 text-slate-400" />{pick(T.refresh, lang)}</button>
                  </div>
                </>
              )}
            </div>
            {canWrite && onSaveDraft && (
              <button onClick={() => { onSaveDraft(); }} disabled={isSaving} className="px-3.5 py-2 bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 text-[11px] font-bold rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-all shadow-sm">
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{pick(T.saveDraft, lang)}
              </button>
            )}
            {canWrite && (
              <button onClick={() => (onSubmitForApproval ? onSubmitForApproval() : scrollTo("review"))} disabled={!canSubmit} title={!canSubmit ? pick(T.submitBlocked, lang) : undefined} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[11px] font-bold rounded-lg cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5 transition-all shadow-sm shadow-orange-500/20">
                <Send className="w-3.5 h-3.5" />{pick(T.submit, lang)}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{pick(T.title, lang)}</h1>
          <StatusBadge value={statusBadge} />
        </div>
        <p className="text-[12.5px] text-slate-500 -mt-3">{pick(T.subtitle, lang)}</p>

        {/* Premium shipment info cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <InfoCard icon={<Package className="w-4 h-4" />} tone="slate" label={pick(T.hShipment, lang)} value={statement.shipmentNumber} mono />
          <InfoCard icon={<Building2 className="w-4 h-4" />} tone="blue" label={pick(T.hCustomer, lang)} value={statement.companyName} sub={resolvedClientId ? `${pick(T.clientId, lang)}: ${resolvedClientId}` : undefined} />
          <InfoCard icon={<MapPin className="w-4 h-4" />} tone="violet" label={pick(T.hRoute, lang)} value={shipment ? `${shipment.loadingCountry || "?"} → ${shipment.deliveryCountry || "?"}` : "—"} sub={(statement.shipmentType || "").toString().toLowerCase() === "land" ? "Cross-Border TIR" : undefined} />
          <InfoCard icon={<Boxes className="w-4 h-4" />} tone="amber" label={pick(T.hCargo, lang)} value={`${(statement.shipmentType || "").toString().toUpperCase()} FREIGHT`} sub={shipment?.cargoDescription || undefined} />
          <InfoCard icon={<Coins className="w-4 h-4" />} tone="teal" label={pick(T.hCurrency, lang)} value={statement.currency} mono />
          <InfoCard icon={<Tag className="w-4 h-4" />} tone="emerald" label={pick(T.agreedPrice, lang)} value={`${money(agreedAmount)}`} sub={agreedCurrency} strong />
          <InfoCard icon={<Calendar className="w-4 h-4" />} tone="slate" label={pick(T.hStatementDate, lang)} value={statement.date || "—"} mono />
          <InfoCard icon={<Flag className="w-4 h-4" />} tone="orange" label={pick(T.hStatus, lang)} value={statusBadge.toUpperCase()} strong />
        </div>
      </div>

      {/* ─── Workflow steps + progress ──────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-5 flex flex-col xl:flex-row xl:items-center gap-5">
          <div className="flex items-center gap-1 md:gap-2 overflow-x-auto flex-1 min-w-0">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center shrink-0">
                <button onClick={() => scrollTo(s.key)} className="flex items-center gap-2.5 bg-transparent border-0 cursor-pointer py-1 px-1 text-left group">
                  <StepCircle index={i + 1} state={s.state} />
                  <span className="hidden md:block">
                    <span className="block text-[12px] font-black leading-tight text-slate-800 group-hover:text-slate-950">{pick(s.title, lang)}</span>
                    <StepStatusLabel state={s.state} label={pick(s.statusLabel, lang)} />
                  </span>
                </button>
                {i < steps.length - 1 && <span className="text-slate-300 mx-1 md:mx-2.5 shrink-0 text-sm">→</span>}
              </div>
            ))}
          </div>
          {/* Accounting progress */}
          <div className="xl:w-72 shrink-0 xl:border-l xl:border-slate-100 xl:pl-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">{pick(T.progress, lang)}</span>
              <span className="text-lg font-black text-orange-600 leading-none">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-700 ease-out" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Body — two columns on desktop, single on tablet/smaller ─────── */}
      <div className="px-4 md:px-8 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* 1. Expenses */}
          <SectionCard id="csw-expenses" num={1} title={pick(T.expenses, lang)} desc={pick(T.expensesDesc, lang)}
            action={canWrite ? (
              <button onClick={() => setShowAddExpense((v) => !v)} className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1.5 transition-all shadow-sm shadow-blue-600/20">
                <Plus className="w-3.5 h-3.5" />{pick(T.addExpense, lang)}
              </button>
            ) : undefined}>
            {!hasExpenses ? (
              <EmptyHint>{pick(T.noExpenses, lang)}</EmptyHint>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-[12px] border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-slate-400">
                      {["#", "Expense Type", "Description", "Vendor", "Invoice / Reference", "Due Date", "Amount", "Currency", "Attachment"].map((h, k) => (
                        <th key={k} className={`py-2.5 px-2 text-[10px] font-black uppercase tracking-wide border-b border-slate-100 ${h === "Amount" ? "text-right" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-2 text-slate-400 border-b border-slate-50">{idx + 1}</td>
                        <td className="py-3 px-2 font-bold text-slate-800 border-b border-slate-50">{it.costType || "—"}</td>
                        <td className="py-3 px-2 text-slate-600 border-b border-slate-50">{it.description || "—"}</td>
                        <td className="py-3 px-2 text-slate-600 border-b border-slate-50">{it.supplierName || "—"}</td>
                        <td className="py-3 px-2 font-mono text-slate-500 border-b border-slate-50">{(it as any).invoiceReference || (it as any).reference || "—"}</td>
                        <td className="py-3 px-2 font-mono text-slate-500 border-b border-slate-50">{(it as any).dueDate || "—"}</td>
                        <td className="py-3 px-2 text-right font-mono font-black text-slate-900 border-b border-slate-50">{money(Number(it.totalAmount || 0))}</td>
                        <td className="py-3 px-2 font-mono text-slate-500 border-b border-slate-50">{it.currency}</td>
                        <td className="py-3 px-2 border-b border-slate-50">{(it as any).attachmentUrl ? <a href={(it as any).attachmentUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">view</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Add-expense drawer — reuses the existing item API (server-authoritative). */}
            {canWrite && showAddExpense && (
              <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <MobileAccountingQuickActions shipmentId={statement.shipmentId} canWrite={canWrite} sessionId={actor.sessionId} lang={lang} embedded onChanged={notifyChanged} />
              </div>
            )}
            {/* Derived totals — READ ONLY (never manually editable). */}
            <KpiStrip>
              <KpiCell label={pick(T.totalExpenses, lang)} value={`${money(totalCost)}`} unit={statement.currency} tone="navy" />
              <KpiCell label={pick(T.paidVendors, lang)} value={`${money(paidAmount)}`} unit={statement.currency} tone="green" />
              <KpiCell label={pick(T.remainingVendors, lang)} value={`${money(expense.expenseRemaining)}`} unit={statement.currency} tone="orange" />
              <KpiCell label={pick(T.overpaid, lang)} value={`${money(expense.expenseCredit)}`} unit={statement.currency} tone={hasOverpaidVendor ? "red" : "slate"} />
            </KpiStrip>
            {hasOverpaidVendor && (
              <p className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{pick(T.overpaidWarn, lang)}</p>
            )}
          </SectionCard>

          {/* 2. Vendor Payments */}
          <SectionCard id="csw-vendor" num={2} title={pick(T.vendorPayments, lang)} desc={pick(T.vendorPaymentsDesc, lang)}>
            {!hasExpenses ? (
              <EmptyHint>{pick(T.noVendorYet, lang)}</EmptyHint>
            ) : (
              <VendorPayablesPanel shipmentId={statement.shipmentId} items={items} bankAccounts={bankAccounts} canWrite={canWrite} lang={lang} />
            )}
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Accounting summary — premium KPI grid (server-authoritative). */}
          <section id="csw-summary" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3.5">
              <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center"><TrendingUp className="w-4 h-4" /></div>
              <div>
                <h2 className="text-[13px] font-black text-slate-900 leading-none">{pick(T.summary, lang)}</h2>
                <p className="text-[10px] text-slate-400 mt-1">{pick(T.summaryDesc, lang)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <MiniKpi label={pick(T.agreedPrice, lang)} value={money(agreedAmount)} unit={agreedCurrency} tone="blue" />
              <MiniKpi label={pick(T.totalExpenses, lang)} value={money(totalCost)} unit={statement.currency} tone="navy" />
              <MiniKpi label={pick(T.paidVendors, lang)} value={money(paidAmount)} unit={statement.currency} tone="green" />
              <MiniKpi label={pick(T.remainingVendors, lang)} value={money(expense.expenseRemaining)} unit={statement.currency} tone="orange" />
              <MiniKpi label={pick(T.receivedCustomer, lang)} value={money(customer.customerReceivedAmount)} unit={agreedCurrency} tone="green" />
              <MiniKpi label={pick(T.remainingCustomer, lang)} value={money(customer.customerReceivable)} unit={agreedCurrency} tone="orange" />
            </div>
            {/* Gross profit — internal only; never shown to the customer. */}
            <div className="mt-2.5 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-3.5 py-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-emerald-700">{pick(T.grossProfit, lang)}</div>
                <div className="text-[8px] font-bold uppercase tracking-wide text-emerald-400 flex items-center gap-1"><Lock className="w-2.5 h-2.5" />{pick(T.internal, lang)}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black font-mono text-emerald-700 leading-none">{grossProfit === null ? "—" : money(grossProfit)}</div>
                <div className="text-[9px] font-bold text-emerald-500 mt-0.5">{grossProfit === null ? "" : agreedCurrency}</div>
              </div>
            </div>
            {grossProfit === null && <p className="text-[10px] text-slate-400 mt-1.5">Different currencies — not aggregated.</p>}
          </section>

          {/* 3. Customer Invoice */}
          <section id="csw-invoice">
            <SectionHead num={3} title={pick(T.invoice, lang)} />
            <div className="mt-2">
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
            </div>
          </section>

          {/* 4. Customer Payments (status derived; no manual received field) */}
          <SectionCard id="csw-payments" num={4} title={pick(T.customerPayments, lang)} desc={pick(T.customerPaymentsDesc, lang)}>
            {!hasIssuedInvoice ? (
              <EmptyHint>{pick(T.noInvoice, lang)}</EmptyHint>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <MiniKpi label="Invoice Amount" value={money(issuedInvoice!.sellingAmount)} unit={issuedInvoice!.currency} tone="navy" />
                <MiniKpi label={pick(T.receivedCustomer, lang)} value={money(customer.customerReceivedAmount)} unit={agreedCurrency} tone="green" />
                <MiniKpi label="Remaining" value={money(customer.customerReceivable)} unit={agreedCurrency} tone="orange" />
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 flex flex-col justify-center">
                  <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Status</div>
                  <div className="mt-1"><InvoiceStatusBadge status={issuedInvoice!.status} /></div>
                </div>
              </div>
            )}
          </SectionCard>

          {/* 5. Documents — compact cards, opened ON DEMAND (no permanent PDF pane) */}
          <SectionCard id="csw-documents" num={5} title={pick(T.documents, lang)}>
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
              <DocCard icon={<ScrollText className="w-5 h-5" />} tone="slate" name="Cost Statement" ready onPreview={() => previewDoc(`/api/cost-statements/${statement.shipmentId}/pdf?lang=${lang}`)} lang={lang} />
              <DocCard icon={<FileText className="w-5 h-5" />} tone="blue" name="Customer Invoice" ready={hasIssuedInvoice} onPreview={hasIssuedInvoice ? () => previewDoc(`/api/cost-statements/${statement.shipmentId}/invoices/${issuedInvoice!.id}/pdf?lang=${lang}`) : undefined} lang={lang} />
              <DocCard icon={<FileText className="w-5 h-5" />} tone="emerald" name="Client Statement" ready onPreview={() => previewDoc(`/api/customer-accounts/statement/pdf?company=${encodeURIComponent(statement.companyName)}&currency=${agreedCurrency}&lang=${lang}`)} lang={lang} />
              <DocCard icon={<Building2 className="w-5 h-5" />} tone="red" name="Vendor Voucher" ready={false} lang={lang} />
              <DocCard icon={<Receipt className="w-5 h-5" />} tone="teal" name="Payment Receipt" ready={false} lang={lang} />
            </div>
          </SectionCard>

          {/* 6. Approval */}
          <section id="csw-review">
            <SectionHead num={6} title={pick(T.approval, lang)} desc={pick(T.approvalDesc, lang)} />
            {!canSubmit && (
              <div className="mt-2 bg-white rounded-2xl border border-amber-200 p-4 space-y-2">
                <p className="text-[11px] font-black text-amber-800 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{pick(T.checklist, lang)}</p>
                {checklist.map((c, i) => (
                  <div key={i} className={`flex items-center gap-2 text-[11.5px] font-semibold ${c.ok ? "text-emerald-700" : "text-slate-500"}`}>
                    {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4 text-slate-300" />}
                    {pick(c.label as L3, lang)}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2">
              <CostApprovalWorkflowCard lang={lang} statement={statement} actor={actor} onChanged={onRefresh} />
            </div>
          </section>
        </div>
      </div>

      {/* ─── Sticky footer ──────────────────────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 lg:left-auto lg:right-0 lg:w-[calc(100%-var(--admin-sidebar,0px))] bg-white border-t border-slate-200 px-4 md:px-8 py-3 flex items-center justify-between gap-3 z-30 print:hidden">
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 min-w-0">
          <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-bold text-slate-600 shrink-0">{pick(T.linkedCargo, lang)}:</span>
          <span className="truncate">{statement.companyName}</span>
        </div>
        <div className="flex items-center gap-3">
          {lastSavedLabel && <span className="hidden sm:flex items-center gap-1 text-[11px] text-slate-400"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{pick(T.lastSaved, lang)}: {lastSavedLabel}</span>}
          {canWrite && onSaveDraft && (
            <button onClick={() => onSaveDraft()} disabled={isSaving} className="px-3.5 py-2 bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 text-[11px] font-bold rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-all">
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{pick(T.saveDraft, lang)}
            </button>
          )}
          {canWrite && (
            <button onClick={() => (onSubmitForApproval ? onSubmitForApproval() : scrollTo("review"))} disabled={!canSubmit} title={!canSubmit ? pick(T.submitBlocked, lang) : undefined} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[11px] font-bold rounded-lg cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5 transition-all shadow-sm shadow-orange-500/20">
              <Send className="w-3.5 h-3.5" />{pick(T.submit, lang)}
            </button>
          )}
        </div>
      </div>

      {/* Success toast (subtle) */}
      {toast && (
        <div className="fixed bottom-20 right-6 z-40 bg-slate-900 text-white text-[12px] font-bold px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 print:hidden">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />{toast}
        </div>
      )}
    </div>
  );
}

/* ── Presentational helpers ───────────────────────────────────────────── */

const TONE: Record<string, { bg: string; fg: string }> = {
  slate: { bg: "bg-slate-100", fg: "text-slate-600" },
  blue: { bg: "bg-blue-100", fg: "text-blue-600" },
  violet: { bg: "bg-violet-100", fg: "text-violet-600" },
  amber: { bg: "bg-amber-100", fg: "text-amber-600" },
  teal: { bg: "bg-teal-100", fg: "text-teal-600" },
  emerald: { bg: "bg-emerald-100", fg: "text-emerald-600" },
  orange: { bg: "bg-orange-100", fg: "text-orange-600" },
  red: { bg: "bg-red-100", fg: "text-red-600" },
};

function InfoCard({ icon, tone, label, value, sub, mono, strong }: { icon: React.ReactNode; tone: keyof typeof TONE; label: string; value: string; sub?: string; mono?: boolean; strong?: boolean }) {
  const t = TONE[tone] || TONE.slate;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-7 h-7 rounded-lg ${t.bg} ${t.fg} flex items-center justify-center shrink-0`}>{icon}</span>
        <span className="text-[9.5px] font-black uppercase tracking-wide text-slate-400 truncate">{label}</span>
      </div>
      <div className={`text-[13px] leading-tight truncate ${mono ? "font-mono" : ""} ${strong ? "font-black text-slate-900" : "font-bold text-slate-800"}`} title={value}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const cls = v.includes("approved") || v.includes("paid") ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : v.includes("reject") || v.includes("overdue") ? "bg-red-100 text-red-700 border-red-200"
    : v.includes("submit") || v.includes("progress") || v.includes("review") ? "bg-blue-100 text-blue-700 border-blue-200"
    : "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`px-3 py-1 rounded-md text-[11px] font-black uppercase tracking-wide border ${cls}`}>{value}</span>;
}

const STEP_CIRCLE: Record<StepState, string> = {
  completed: "bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-500/30",
  active: "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30",
  pending: "bg-white text-slate-400 border-slate-200",
  blocked: "bg-orange-100 text-orange-600 border-orange-300",
};
function StepCircle({ index, state }: { index: number; state: StepState }) {
  return (
    <span className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-[13px] font-black shrink-0 transition-all ${STEP_CIRCLE[state]}`}>
      {state === "completed" ? <CheckCircle2 className="w-5 h-5" /> : state === "blocked" ? <Lock className="w-3.5 h-3.5" /> : index}
    </span>
  );
}
function StepStatusLabel({ state, label }: { state: StepState; label: string }) {
  const cls = state === "completed" ? "text-emerald-600" : state === "active" ? "text-blue-600" : state === "blocked" ? "text-orange-600" : "text-slate-400";
  const Icon = state === "completed" ? CheckCircle2 : state === "active" ? Clock : state === "blocked" ? Lock : Circle;
  return <span className={`flex items-center gap-1 text-[10px] font-bold mt-0.5 ${cls}`}><Icon className="w-2.5 h-2.5" />{label}</span>;
}

function SectionHead({ num, title, desc, action }: { num: number; title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">{num}</span>
        <div>
          <h2 className="text-[13.5px] font-black text-slate-900 uppercase tracking-wide leading-none">{title}</h2>
          {desc && <p className="text-[11px] text-slate-500 mt-1">{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
function SectionCard({ id, num, title, desc, action, children }: { id: string; num: number; title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4 scroll-mt-24">
      <SectionHead num={num} title={title} desc={desc} action={action} />
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-4 text-center">{children}</p>;
}

const KPI_TONE: Record<string, string> = {
  navy: "text-slate-900", green: "text-emerald-600", orange: "text-orange-500", red: "text-red-600", blue: "text-blue-600", slate: "text-slate-500",
};
function KpiStrip({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 rounded-2xl border border-slate-200 bg-slate-50/50 divide-y md:divide-y-0 md:divide-x divide-slate-200 overflow-hidden">{children}</div>;
}
function KpiCell({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: keyof typeof KPI_TONE }) {
  return (
    <div className="px-4 py-3.5">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-xl font-black font-mono ${KPI_TONE[tone]}`}>{value}</span>
        <span className="text-[10px] font-bold text-slate-400">{unit}</span>
      </div>
    </div>
  );
}
function MiniKpi({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: keyof typeof KPI_TONE }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 truncate" title={label}>{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-[15px] font-black font-mono ${KPI_TONE[tone]}`}>{value}</span>
        <span className="text-[9px] font-bold text-slate-400">{unit}</span>
      </div>
    </div>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const cls = status === "paid" ? "bg-emerald-100 text-emerald-700" : status === "partially_paid" ? "bg-amber-100 text-amber-700" : status === "issued" ? "bg-blue-100 text-blue-700" : status === "cancelled" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600";
  return <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-wide ${cls}`}>{status.replace("_", " ")}</span>;
}

function DocCard({ icon, tone, name, ready, onPreview, lang }: { icon: React.ReactNode; tone: keyof typeof TONE; name: string; ready: boolean; onPreview?: () => void; lang: Language }) {
  const t = TONE[tone] || TONE.slate;
  return (
    <div className={`rounded-xl border p-3 flex flex-col items-center text-center gap-2 transition-all ${ready ? "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm" : "border-slate-100 bg-slate-50/50"}`}>
      <span className={`w-10 h-10 rounded-xl ${ready ? `${t.bg} ${t.fg}` : "bg-slate-100 text-slate-300"} flex items-center justify-center`}>{icon}</span>
      <div className={`text-[10.5px] font-black leading-tight ${ready ? "text-slate-800" : "text-slate-400"}`}>{name}</div>
      <span className={`text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded ${ready ? "bg-emerald-100 text-emerald-600" : "bg-slate-200 text-slate-400"}`}>{ready ? pick(T.generated, lang) : pick(T.notGenerated, lang)}</span>
      {ready && onPreview && (
        <div className="flex items-center gap-1 pt-0.5">
          <button onClick={onPreview} title={pick(T.preview, lang)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border-0 transition-colors"><Eye className="w-3.5 h-3.5" /></button>
          <button onClick={onPreview} title="Download" className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border-0 transition-colors"><Download className="w-3.5 h-3.5" /></button>
          <button onClick={() => window.print()} title={pick(T.print, lang)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border-0 transition-colors"><Printer className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  );
}
