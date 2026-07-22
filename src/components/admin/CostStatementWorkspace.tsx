import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Eye, MoreHorizontal, Save, Send, Plus, FileText, ScrollText,
  Receipt, Building2, CheckCircle2, Circle, AlertTriangle, Loader2, Lock, Download,
  Package, MapPin, Boxes, Coins, Tag, Calendar, Flag, Printer,
  Clock, ChevronDown, CreditCard,
} from "lucide-react";
import type { Language, CostStatement, Shipment, Client, BankAccount, CustomerInvoice, CostItem, Vendor } from "../../types";
import { openAccountingPdf } from "../../lib/openAccountingPdf";
import { deriveExpenseSummary, deriveCustomerSummary, resolveCustomerReceivedAmount, computeShipmentProfit } from "../../lib/costStatementMath";
import { resolveAccountingStatus, type AccountingStatus } from "../../lib/costApprovalWorkflow";
import VendorPayablesPanel from "./VendorPayablesPanel";
import CustomerInvoicePanel from "./CustomerInvoicePanel";
import CustomerAccountPanel from "./CustomerAccountPanel";
import CostApprovalWorkflowCard from "./CostApprovalWorkflowCard";
import FinancialClosingCard from "./FinancialClosingCard";
import OrderFinancialSummaryCard from "./OrderFinancialSummaryCard";
import ExpenseDrawer from "./ExpenseDrawer";

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
  backShort: { en: "Back", ar: "رجوع", tr: "Geri" },
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
  receivePayment: { en: "Receive Payment", ar: "استلام دفعة", tr: "Ödeme Al" },
  paymentReceived: { en: "Customer payment recorded", ar: "تم تسجيل دفعة العميل", tr: "Müşteri ödemesi kaydedildi" },
  documents: { en: "Documents", ar: "المستندات", tr: "Belgeler" },
  documentsDesc: { en: "Preview, download or print accounting documents on demand.", ar: "معاينة أو تنزيل أو طباعة المستندات المحاسبية عند الطلب.", tr: "Muhasebe belgelerini isteğe bağlı önizleyin, indirin veya yazdırın." },
  approval: { en: "Approval Workflow", ar: "سير الاعتماد", tr: "Onay Akışı" },
  approvalDesc: { en: "Operations Manager → Accounts Manager → Managing Director.", ar: "مدير العمليات ← مدير الحسابات ← المدير العام.", tr: "Operasyon Müdürü → Muhasebe Müdürü → Genel Müdür." },
  collapse: { en: "Collapse", ar: "طيّ", tr: "Daralt" },
  expand: { en: "Expand", ar: "توسيع", tr: "Genişlet" },
  agreedPrice: { en: "Driver Agreed Amount", ar: "المبلغ المتفق مع السائق", tr: "Sürücü Anlaşılan Tutar" },
  referenceOnly: { en: "Reference Only", ar: "للاطلاع فقط", tr: "Yalnızca Referans" },
  profitPendingInvoice: { en: "Profit Pending — No Issued Invoice", ar: "الربح معلّق — لا توجد فاتورة صادرة", tr: "Kâr Beklemede — Fatura Kesilmedi" },
  profitPendingApproval: { en: "Profit Pending — Cost Statement Not Approved", ar: "الربح معلّق — كشف التكاليف غير معتمد", tr: "Kâr Beklemede — Masraf Onaylanmadı" },
  totalExpenses: { en: "Total Expenses", ar: "إجمالي المصاريف", tr: "Toplam Masraf" },
  paidVendors: { en: "Paid to Vendors", ar: "المدفوع للموردين", tr: "Tedarikçilere Ödenen" },
  remainingVendors: { en: "Remaining Payable", ar: "المتبقي للموردين", tr: "Kalan Borç" },
  overpaid: { en: "Overpaid (Credit)", ar: "مدفوع بالزيادة (رصيد)", tr: "Fazla Ödenen (Kredi)" },
  receivedCustomer: { en: "Received from Customer", ar: "المستلم من العميل", tr: "Müşteriden Alınan" },
  remainingCustomer: { en: "Customer Balance", ar: "رصيد العميل", tr: "Müşteri Bakiyesi" },
  grossProfit: { en: "Gross Shipment Profit", ar: "إجمالي ربح الشحنة", tr: "Brüt Sevkiyat Kârı" },
  shipmentSummary: { en: "Shipment Summary", ar: "ملخص الشحنة", tr: "Sevkiyat Özeti" },
  shipmentSummaryDesc: { en: "Operational details for this shipment (read-only).", ar: "تفاصيل تشغيلية لهذه الشحنة (للعرض فقط).", tr: "Bu sevkiyata ait operasyonel bilgiler (salt okunur)." },
  ssRoute: { en: "Route", ar: "المسار", tr: "Güzergah" },
  ssOrigin: { en: "Origin", ar: "المنشأ", tr: "Çıkış" },
  ssDestination: { en: "Destination", ar: "الوجهة", tr: "Varış" },
  ssCargo: { en: "Cargo", ar: "الحمولة", tr: "Kargo" },
  ssWeight: { en: "Weight", ar: "الوزن", tr: "Ağırlık" },
  ssTruck: { en: "Truck / Plate", ar: "الشاحنة / اللوحة", tr: "Araç / Plaka" },
  ssType: { en: "Freight Type", ar: "نوع الشحن", tr: "Taşıma Türü" },
  internal: { en: "Internal only", ar: "داخلي فقط", tr: "Yalnızca dahili" },
  overpaidWarn: { en: "Vendor overpayment credit exists — review the vendor payments before approval.", ar: "يوجد رصيد دفع زائد للمورد — راجع مدفوعات الموردين قبل الاعتماد.", tr: "Tedarikçi fazla ödeme kredisi var — onaydan önce inceleyin." },
  noExpenses: { en: "No shipment expenses have been added yet. Click Add Expense to record the first cost.", ar: "لم تتم إضافة أي مصاريف بعد. اضغط إضافة مصروف لتسجيل أول تكلفة.", tr: "Henüz masraf eklenmedi. İlk maliyeti kaydetmek için Masraf Ekle'ye tıklayın." },
  noVendorYet: { en: "Add at least one expense to enable vendor payments.", ar: "أضف مصروفًا واحدًا على الأقل لتفعيل مدفوعات الموردين.", tr: "Tedarikçi ödemelerini etkinleştirmek için en az bir masraf ekleyin." },
  noInvoice: { en: "No customer invoice has been created yet.", ar: "لم يتم إنشاء فاتورة عميل بعد.", tr: "Henüz müşteri faturası oluşturulmadı." },
  invoiceFirst: { en: "A customer invoice must be created and issued before a payment can be received.", ar: "يجب إنشاء فاتورة عميل وإصدارها قبل استلام أي دفعة.", tr: "Ödeme alınmadan önce bir müşteri faturası oluşturulup düzenlenmelidir." },
  submitBlocked: { en: "Complete the highlighted accounting requirements before submitting for approval.", ar: "أكمل المتطلبات المحاسبية المميّزة قبل الإرسال للاعتماد.", tr: "Onaya göndermeden önce vurgulanan gereksinimleri tamamlayın." },
  checklist: { en: "Submission requirements", ar: "متطلبات الإرسال", tr: "Gönderim gereksinimleri" },
  addExpense: { en: "Add Expense", ar: "إضافة مصروف", tr: "Masraf Ekle" },
  notGenerated: { en: "Not Generated", ar: "غير مُنشأ", tr: "Oluşturulmadı" },
  generated: { en: "Generated", ar: "مُنشأ", tr: "Oluşturuldu" },
  docWaitInvoice: { en: "Waiting for invoice to be issued", ar: "بانتظار إصدار الفاتورة", tr: "Faturanın düzenlenmesi bekleniyor" },
  docWaitVendor: { en: "Waiting for vendor payment", ar: "بانتظار دفع المورد", tr: "Tedarikçi ödemesi bekleniyor" },
  docWaitReceipt: { en: "Waiting for customer payment", ar: "بانتظار دفع العميل", tr: "Müşteri ödemesi bekleniyor" },
  lastSaved: { en: "Last saved", ar: "آخر حفظ", tr: "Son kayıt" },
  progress: { en: "Accounting Progress", ar: "التقدم المحاسبي", tr: "Muhasebe İlerlemesi" },
  linkedCargo: { en: "Linked Cargo", ar: "الشحنة المرتبطة", tr: "Bağlı Kargo" },
  expenseAdded: { en: "Expense added successfully", ar: "تمت إضافة المصروف بنجاح", tr: "Masraf başarıyla eklendi" },
  paymentSaved: { en: "Payment recorded successfully", ar: "تم تسجيل الدفعة بنجاح", tr: "Ödeme başarıyla kaydedildi" },
  hShipment: { en: "Order Number", ar: "رقم الطلب", tr: "Sipariş Numarası" },
  hCustomer: { en: "Customer", ar: "العميل", tr: "Müşteri" },
  hRoute: { en: "Route", ar: "المسار", tr: "Güzergah" },
  hCargo: { en: "Cargo Type", ar: "نوع البضاعة", tr: "Kargo Türü" },
  hCurrency: { en: "Currency", ar: "العملة", tr: "Para Birimi" },
  hStatementDate: { en: "Statement Date", ar: "تاريخ الكشف", tr: "Tablo Tarihi" },
  hStatus: { en: "Statement Status", ar: "حالة الكشف", tr: "Tablo Durumu" },
  clientId: { en: "Client ID", ar: "معرّف العميل", tr: "Müşteri No" },
  export: { en: "Export CSV", ar: "تصدير CSV", tr: "CSV Dışa Aktar" },
  refresh: { en: "Refresh", ar: "تحديث", tr: "Yenile" },
  print: { en: "Print", ar: "طباعة", tr: "Yazdır" },
  download: { en: "Download", ar: "تنزيل", tr: "İndir" },
  vendorStatus: { en: "Vendor Payment Status", ar: "حالة دفع المورد", tr: "Tedarikçi Ödeme Durumu" },
  customerStatus: { en: "Customer Payment Status", ar: "حالة دفع العميل", tr: "Müşteri Ödeme Durumu" },
  invoiceAmount: { en: "Invoice Amount", ar: "قيمة الفاتورة", tr: "Fatura Tutarı" },
  remaining: { en: "Remaining", ar: "المتبقي", tr: "Kalan" },
  notAggregated: { en: "Different currencies — not aggregated.", ar: "عملات مختلفة — لا تُجمع.", tr: "Farklı para birimleri — toplanmaz." },
};
// Separate, non-overlapping status vocabularies (item 13).
const STATEMENT_STATUS: Record<string, { label: L3; tone: string }> = {
  draft: { label: { en: "Draft", ar: "مسودة", tr: "Taslak" }, tone: "slate" },
  submitted: { label: { en: "Submitted", ar: "مُرسل", tr: "Gönderildi" }, tone: "blue" },
  approved: { label: { en: "Approved", ar: "معتمد", tr: "Onaylandı" }, tone: "green" },
  rejected: { label: { en: "Rejected", ar: "مرفوض", tr: "Reddedildi" }, tone: "red" },
  reopen: { label: { en: "Reopen Requested", ar: "طلب إعادة فتح", tr: "Yeniden Açma İsteği" }, tone: "amber" },
};
const deriveStatementStatus = (s: AccountingStatus): { label: L3; tone: string } => {
  if (s === "final_closed") return STATEMENT_STATUS.approved;
  if (s === "rejected_for_correction") return STATEMENT_STATUS.rejected;
  if (s === "reopen_requested") return STATEMENT_STATUS.reopen;
  if (s === "draft" || s === "reopened") return STATEMENT_STATUS.draft;
  return STATEMENT_STATUS.submitted; // pending_* / finalizing
};
const PAY_STATUS: Record<string, { label: L3; tone: string }> = {
  Unpaid: { label: { en: "Unpaid", ar: "غير مدفوع", tr: "Ödenmedi" }, tone: "red" },
  Partial: { label: { en: "Partially Paid", ar: "مدفوع جزئياً", tr: "Kısmen Ödendi" }, tone: "amber" },
  Paid: { label: { en: "Paid", ar: "مدفوع", tr: "Ödendi" }, tone: "green" },
  Credit: { label: { en: "Advance Credit", ar: "رصيد مقدم", tr: "Avans Kredi" }, tone: "blue" },
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
  approved: { en: "Approved", ar: "معتمد", tr: "Onaylandı" },
  readySubmit: { en: "Ready to submit", ar: "جاهز للإرسال", tr: "Göndermeye hazır" },
  // Blocked reasons (item 8): always explain WHY, never just "Blocked".
  needExpense: { en: "Add an expense first", ar: "أضف مصروفًا أولاً", tr: "Önce bir masraf ekleyin" },
  needCustomer: { en: "Link a customer first", ar: "اربط العميل أولاً", tr: "Önce bir müşteri bağlayın" },
  needInvoice: { en: "Issue an invoice first", ar: "أصدر فاتورة أولاً", tr: "Önce bir fatura düzenleyin" },
  needRequirements: { en: "Complete the requirements", ar: "أكمل المتطلبات", tr: "Gereksinimleri tamamlayın" },
};

const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type StepState = "completed" | "active" | "pending" | "blocked";

interface Props {
  statement: CostStatement;
  shipments: Shipment[];
  clients: Client[];
  bankAccounts: BankAccount[];
  /** Existing master-data vendor list (from /api/vendors) for the expense selector. */
  vendors: Vendor[];
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
  statement, shipments, clients, bankAccounts, vendors, lang, canWrite, actor,
  onBack, onRefresh, onExportCsv, onSaveDraft, onSubmitForApproval, onOpenCustomer, isSaving, lastSavedLabel,
}: Props) {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);       // closed by default (item 3)
  const [showReceivePayment, setShowReceivePayment] = useState(false);
  // Bumped after a customer AR write so the invoice panel remounts and reloads
  // its status; the statement itself is refreshed via onRefresh().
  const [arRefreshToken, setArRefreshToken] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  // Approval chain can get long; on mobile it is collapsible (expanded by default).
  const [approvalOpen, setApprovalOpen] = useState(true);

  const shipment = useMemo(() => shipments.find((s) => s.id === statement.shipmentId), [shipments, statement.shipmentId]);
  // The statement carries only companyName; the immutable clientId is resolved
  // from the registered customer whose companyName matches (never guessed).
  const resolvedClientId = useMemo(() => {
    const match = clients.find((c) => c.companyName === statement.companyName);
    return match?.id || null;
  }, [statement.companyName, clients]);

  const items: CostItem[] = statement.items || [];
  // Accounting Phase 1: agreedAmount is the DRIVER's agreed amount — a passive
  // REFERENCE only. It is never used for profit, the customer price, or the
  // customer balance/status below.
  const agreedAmount = (shipment?.agreedAmount ?? statement.agreedAmount) || 0;
  const agreedCurrency = statement.agreedCurrency || statement.currency;
  const totalCost = Number(statement.totalCost || 0);
  const paidAmount = Number(statement.paidAmount || 0);
  const expense = deriveExpenseSummary(totalCost, paidAmount);

  const hasExpenses = items.length > 0;
  const issuedInvoice = invoices.find((i) => i.status === "issued" || i.status === "partially_paid" || i.status === "paid");
  const hasIssuedInvoice = !!issuedInvoice;
  const hasValidCustomer = !!resolvedClientId;
  const hasOverpaidVendor = expense.expenseCredit > 0;

  // Three SEPARATE status vocabularies (item 13).
  const acctStatus = resolveAccountingStatus(statement as any);
  const costsApproved = acctStatus === "final_closed";
  // Phase 6 — a financially closed shipment is fully read-only for accounting.
  const financiallyClosed = statement.financialStatus === "financial_closed";

  // Customer balance/status is derived from the ISSUED INVOICE, not agreedAmount.
  const issuedInvoiceTotal = issuedInvoice ? Number(issuedInvoice.sellingAmount || 0) : null;
  const customerCurrency = issuedInvoice?.currency || statement.currency;
  const customer = deriveCustomerSummary(issuedInvoiceTotal ?? 0, resolveCustomerReceivedAmount(statement));

  // Canonical shipment profit = issued customer invoice − approved cost.
  // Pending until an invoice is issued AND the cost statement is approved.
  const profit = computeShipmentProfit({
    issuedInvoiceTotal,
    invoiceCurrency: issuedInvoice?.currency,
    costsApproved,
    approvedCostTotal: totalCost,
    costCurrency: statement.currency,
  });
  const statementStatus = deriveStatementStatus(acctStatus);
  const vendorStatus = PAY_STATUS[expense.paymentStatus] || PAY_STATUS.Unpaid;
  const custStatus = PAY_STATUS[customer.customerStatus] || PAY_STATUS.Unpaid;

  // Submission checklist (human-readable; shown BEFORE the click, not after).
  const checklist = [
    { ok: hasValidCustomer, label: { en: "Customer account is linked", ar: "حساب العميل مرتبط", tr: "Müşteri hesabı bağlı" } },
    { ok: !!statement.date, label: { en: "Statement date is set", ar: "تاريخ الكشف محدد", tr: "Tablo tarihi ayarlı" } },
    { ok: !!statement.currency, label: { en: "Primary currency is set", ar: "العملة الأساسية محددة", tr: "Ana para birimi ayarlı" } },
    { ok: hasExpenses, label: { en: "At least one expense exists", ar: "يوجد مصروف واحد على الأقل", tr: "En az bir masraf var" } },
    { ok: !hasOverpaidVendor, label: { en: "No unresolved vendor overpayment", ar: "لا يوجد دفع زائد للمورد", tr: "Çözülmemiş fazla ödeme yok" } },
  ];
  const canSubmit = canWrite && checklist.every((c) => c.ok);

  // Linear workflow completion — a step is "done" once it has meaningful
  // activity (matches how an operator reads progress), never hidden data.
  const done = [
    hasExpenses,                       // 1 expenses
    hasExpenses && paidAmount > 0,     // 2 at least one vendor payment
    hasIssuedInvoice,                  // 3 invoice issued
    hasIssuedInvoice && customer.customerStatus === "Paid", // 4 fully received
    acctStatus === "final_closed",     // 5 approval
  ];
  const firstIncomplete = done.findIndex((d) => !d);
  const blockedPrereq = (i: number): boolean =>
    (i === 1 && !hasExpenses) || (i === 2 && !hasValidCustomer) || (i === 3 && !hasIssuedInvoice) || (i === 4 && !canSubmit && acctStatus !== "final_closed");
  const stateOf = (i: number): StepState => {
    if (done[i]) return "completed";
    if (blockedPrereq(i)) return "blocked";
    if (i === firstIncomplete) return "active";
    return "pending";
  };
  const stepSub = (i: number, st: StepState): L3 => {
    if (st === "blocked") return i === 1 ? step.needExpense : i === 2 ? step.needCustomer : i === 3 ? step.needInvoice : step.needRequirements;
    if (st === "completed") return i === 2 ? step.issued : i === 4 ? step.approved : step.completed;
    if (st === "active") return i === 4 ? step.readySubmit : step.inProgress;
    return step.pending;
  };
  const steps = [
    { key: "expenses", title: step.s1 },
    { key: "vendor", title: step.s2 },
    { key: "invoice", title: step.s3 },
    { key: "payments", title: step.s4 },
    { key: "review", title: step.s5 },
  ].map((s, i) => { const st = stateOf(i); return { ...s, i, state: st, sub: stepSub(i, st) }; });

  // Progress = share of steps reached (completed or currently active).
  const reached = steps.filter((s) => s.state === "completed" || s.state === "active").length;
  const progressPct = Math.round((reached / steps.length) * 100);

  const scrollTo = useCallback((key: string) => {
    setScrollTarget(key);
    document.getElementById(`csw-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  useEffect(() => { if (scrollTarget) { const t = setTimeout(() => setScrollTarget(null), 800); return () => clearTimeout(t); } }, [scrollTarget]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); } }, [toast]);

  // On-demand document preview (server-rendered snapshots; permission-gated on the server).
  const previewDoc = (path: string) => { void openAccountingPdf(path); };
  const onExpenseAdded = () => { setToast(pick(T.expenseAdded, lang)); onRefresh(); };
  // Reuses the existing customer AR flow (CustomerAccountPanel → the same
  // /api/customer-accounts/payments endpoints, auto-allocation, receipts,
  // reversals). After any AR write we refresh the statement and remount the
  // invoice panel so its status re-derives.
  const onCustomerPaymentChanged = () => {
    setToast(pick(T.paymentReceived, lang));
    setArRefreshToken((t) => t + 1);
    onRefresh();
  };

  const btnPrimary = "px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[13px] font-bold rounded-lg cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5 transition-all shadow-sm shadow-orange-500/20";
  const btnGhost = "px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-[13px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all shadow-sm";

  return (
    // Mobile: no page-level horizontal overflow (overflow-x-hidden is a guard AFTER
    // the width fixes below), and bottom padding clears BOTH the sticky action bar
    // and the mobile bottom navigation (+ iOS safe area). Desktop keeps pb-24.
    <div className="w-full min-h-full bg-slate-100/70 overflow-x-hidden pb-[calc(8.5rem+env(safe-area-inset-bottom))] lg:pb-24">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-8 pt-3 pb-4 sm:pt-6 sm:pb-7 space-y-3.5 sm:space-y-6">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onBack} className="text-[12px] font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1.5 bg-transparent border-0 cursor-pointer p-0 transition-colors min-w-0">
            <ArrowLeft className="w-4 h-4 shrink-0" /><span className="truncate"><span className="sm:hidden">{pick(T.backShort, lang)}</span><span className="hidden sm:inline">{pick(T.back, lang)}</span></span>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {/* Standalone Preview Documents is DESKTOP-only; on mobile + tablet it lives
                exclusively inside the More / Actions menu to keep the top bar minimal. */}
            <button onClick={() => scrollTo("documents")} className={`${btnGhost} hidden lg:flex`}><Eye className="w-4 h-4" />{pick(T.preview, lang)}</button>
            <div className="relative">
              <button onClick={() => setShowMore((v) => !v)} className={btnGhost}><MoreHorizontal className="w-4 h-4" />{pick(T.more, lang)}<ChevronDown className="w-3.5 h-3.5 opacity-60" /></button>
              {showMore && (
                <>
                  <div className="fixed inset-x-0 top-0 bottom-0 z-10" onClick={() => setShowMore(false)} />
                  <div className="absolute right-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1.5">
                    <button onClick={() => { scrollTo("documents"); setShowMore(false); }} className="w-full text-left px-4 py-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Eye className="w-4 h-4 text-slate-400" />{pick(T.preview, lang)}</button>
                    {onExportCsv && <button onClick={() => { onExportCsv(); setShowMore(false); }} className="w-full text-left px-4 py-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Download className="w-4 h-4 text-slate-400" />{pick(T.export, lang)}</button>}
                    <button onClick={() => { window.print(); setShowMore(false); }} className="w-full text-left px-4 py-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Printer className="w-4 h-4 text-slate-400" />{pick(T.print, lang)}</button>
                    <div className="my-1 border-t border-slate-100" />
                    <button onClick={() => { onRefresh(); setShowMore(false); }} className="w-full text-left px-4 py-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 bg-transparent border-0 cursor-pointer flex items-center gap-2"><Loader2 className="w-4 h-4 text-slate-400" />{pick(T.refresh, lang)}</button>
                  </div>
                </>
              )}
            </div>
            {/* Save Draft + Submit for Approval live in ONE place only — the sticky
                action bar at the bottom — so the primary actions are never duplicated. */}
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-[19px] sm:text-[28px] leading-tight sm:leading-none font-black text-slate-900 tracking-tight">{pick(T.title, lang)}</h1>
          {/* Title badge = Statement Status ONLY (item 13). */}
          <StatusPill label={pick(statementStatus.label, lang)} tone={statementStatus.tone} large />
        </div>
        <p className="text-[12.5px] sm:text-[13.5px] text-slate-500 -mt-2 sm:-mt-3.5">{pick(T.subtitle, lang)}</p>

        {/* Premium shipment info cards — 2 (tablet) / 4 (desktop) / 6 (wide) (item 2). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6 gap-3.5">
          <InfoCard icon={<Package className="w-5 h-5" />} tone="slate" label={pick(T.hShipment, lang)} value={statement.shipmentNumber} mono />
          <InfoCard icon={<Building2 className="w-5 h-5" />} tone="blue" label={pick(T.hCustomer, lang)} value={statement.companyName} sub={resolvedClientId ? `${pick(T.clientId, lang)}: ${resolvedClientId}` : undefined} />
          <InfoCard icon={<MapPin className="w-5 h-5" />} tone="violet" label={pick(T.hRoute, lang)} value={shipment ? `${shipment.loadingCountry || "?"} → ${shipment.deliveryCountry || "?"}` : "—"} sub={(statement.shipmentType || "").toString().toLowerCase() === "land" ? "Cross-Border TIR" : undefined} />
          <InfoCard icon={<Boxes className="w-5 h-5" />} tone="amber" label={pick(T.hCargo, lang)} value={`${(statement.shipmentType || "").toString().toUpperCase()} FREIGHT`} sub={shipment?.cargoDescription || undefined} />
          <InfoCard icon={<Coins className="w-5 h-5" />} tone="teal" label={pick(T.hCurrency, lang)} value={statement.currency} mono />
          <InfoCard icon={<Tag className="w-5 h-5" />} tone="slate" label={pick(T.agreedPrice, lang)} value={`${money(agreedAmount)}`} sub={`${agreedCurrency} · ${pick(T.referenceOnly, lang)}`} />
          <InfoCard icon={<Calendar className="w-5 h-5" />} tone="slate" label={pick(T.hStatementDate, lang)} value={statement.date || "—"} mono />
          <InfoCard icon={<Flag className="w-5 h-5" />} tone={statementStatus.tone as any} label={pick(T.hStatus, lang)} value={pick(statementStatus.label, lang)} strong />
        </div>
      </div>

      {/* ─── Workflow steps + progress ──────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-6 flex flex-col xl:flex-row xl:items-center gap-6">
          <div className="flex items-start gap-1 md:gap-2 overflow-x-auto flex-1 min-w-0">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-start shrink-0">
                <button onClick={() => scrollTo(s.key)} className="flex items-start gap-3 bg-transparent border-0 cursor-pointer py-1 px-1 text-left group">
                  <StepCircle index={i + 1} state={s.state} />
                  <span className="hidden md:block max-w-[150px]">
                    <span className="block text-[13px] font-black leading-tight text-slate-800 group-hover:text-slate-950">{pick(s.title, lang)}</span>
                    <StepStatusLabel state={s.state} label={pick(s.sub, lang)} />
                  </span>
                </button>
                {i < steps.length - 1 && <span className="text-slate-300 mx-1 md:mx-2.5 shrink-0 text-base mt-2.5">→</span>}
              </div>
            ))}
          </div>
          {/* Accounting progress */}
          <div className="xl:w-80 shrink-0 xl:border-l xl:border-slate-100 xl:pl-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-black uppercase tracking-wide text-slate-500">{pick(T.progress, lang)}</span>
              <span className="text-2xl font-black text-orange-600 leading-none">{progressPct}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-700 ease-out" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Body — full-width VERTICAL sections, stacked top-to-bottom on every
           breakpoint (desktop / tablet / mobile). No two-column layout. (item 4) ── */}
      <div className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto space-y-6">
          {/* 0. Shipment Summary — operational context for the financials (read only) */}
          <section id="csw-shipment" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 scroll-mt-24">
            <SectionHead title={pick(T.shipmentSummary, lang)} desc={pick(T.shipmentSummaryDesc, lang)} />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-4 mt-4">
              <ShipmentFact label={pick(T.ssOrigin, lang)} value={shipment ? [shipment.loadingCity, shipment.loadingCountry].filter(Boolean).join(", ") || "—" : "—"} />
              <ShipmentFact label={pick(T.ssDestination, lang)} value={shipment ? [shipment.deliveryCity, shipment.deliveryCountry].filter(Boolean).join(", ") || "—" : "—"} />
              <ShipmentFact label={pick(T.ssType, lang)} value={`${(statement.shipmentType || "").toString().toUpperCase() || "—"}`} />
              <ShipmentFact label={pick(T.ssTruck, lang)} value={(shipment?.truckNumber || statement.truckNumber || "—") as string} mono />
              <ShipmentFact label={pick(T.ssCargo, lang)} value={shipment?.cargoDescription || "—"} className="sm:col-span-2" />
              <ShipmentFact label={pick(T.ssWeight, lang)} value={shipment?.cargoWeight ? `${money(Number(shipment.cargoWeight))} kg` : "—"} />
              <ShipmentFact label={pick(T.hStatementDate, lang)} value={statement.date || "—"} mono />
            </div>
          </section>

          {/* 1. Order Accounting Summary — server-authoritative KPIs (read only) */}
          <section id="csw-summary" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 scroll-mt-24">
            <SectionHead num={1} title={pick(T.summary, lang)} desc={pick(T.summaryDesc, lang)} />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
              <BigKpi label={`${pick(T.agreedPrice, lang)} · ${pick(T.referenceOnly, lang)}`} value={money(agreedAmount)} unit={agreedCurrency} tone="blue" />
              <BigKpi label={pick(T.totalExpenses, lang)} value={money(totalCost)} unit={statement.currency} tone="navy" />
              <BigKpi label={pick(T.paidVendors, lang)} value={money(paidAmount)} unit={statement.currency} tone="green" />
              <BigKpi label={pick(T.remainingVendors, lang)} value={money(expense.expenseRemaining)} unit={statement.currency} tone="orange" />
              <BigKpi label={pick(T.receivedCustomer, lang)} value={money(customer.customerReceivedAmount)} unit={customerCurrency} tone="green" />
              <BigKpi label={pick(T.remainingCustomer, lang)} value={money(customer.customerReceivable)} unit={customerCurrency} tone="orange" />
            </div>
            {/* Shipment profit = issued invoice − approved cost. Internal only;
                never shown to the customer, and never derived from agreedAmount. */}
            <div className="mt-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3.5 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-black uppercase tracking-wide text-emerald-700">{pick(T.grossProfit, lang)}</div>
                <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-400 flex items-center gap-1 mt-0.5"><Lock className="w-2.5 h-2.5" />{pick(T.internal, lang)}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black font-mono text-emerald-700 leading-none">{profit.status === "available" ? money(profit.profit as number) : "—"}</div>
                <div className="text-[10px] font-bold text-emerald-500 mt-1">{profit.status === "available" ? profit.currency : ""}</div>
              </div>
            </div>
            {profit.status === "pending_no_invoice" && <p className="text-[11px] text-slate-500 mt-2">{pick(T.profitPendingInvoice, lang)}</p>}
            {profit.status === "pending_not_approved" && <p className="text-[11px] text-slate-500 mt-2">{pick(T.profitPendingApproval, lang)}</p>}
            {profit.status === "unavailable_currency" && <p className="text-[11px] text-slate-400 mt-2">{pick(T.notAggregated, lang)}</p>}
          </section>

          {/* 2. Costs / Expenses */}
          <SectionCard id="csw-expenses" num={2} title={pick(T.expenses, lang)} desc={pick(T.expensesDesc, lang)}
            action={canWrite ? (
              <button onClick={() => setShowAddExpense(true)} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-2 transition-all shadow-sm shadow-blue-600/20">
                <Plus className="w-4 h-4" />{pick(T.addExpense, lang)}
              </button>
            ) : undefined}>
            {/* Add-expense drawer — CLOSED by default; reuses the existing item API. */}
            {canWrite && showAddExpense && (
              <ExpenseDrawer shipmentId={statement.shipmentId} currency={statement.currency} sessionId={actor.sessionId}
                vendors={vendors} expectedRevision={(statement as any).revision || 1} lang={lang}
                onClose={() => setShowAddExpense(false)} onAdded={onExpenseAdded} />
            )}
            {!hasExpenses ? (
              <EmptyHint>{pick(T.noExpenses, lang)}</EmptyHint>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-[13px] border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-slate-400">
                      {["#", "Expense Type", "Description", "Vendor", "Due Date", "Amount", "Currency", "Attachment"].map((h, k) => (
                        <th key={k} className={`py-3 px-3 text-[11px] font-black uppercase tracking-wide border-b border-slate-100 ${h === "Amount" ? "text-right" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-4 px-3 text-slate-400 border-b border-slate-50">{idx + 1}</td>
                        <td className="py-4 px-3 font-bold text-slate-800 border-b border-slate-50">{it.costType || "—"}</td>
                        <td className="py-4 px-3 text-slate-600 border-b border-slate-50">{it.description || "—"}</td>
                        <td className="py-4 px-3 text-slate-600 border-b border-slate-50">{it.supplierName || "—"}</td>
                        <td className="py-4 px-3 font-mono text-slate-500 border-b border-slate-50">{(it as any).dueDate || "—"}</td>
                        <td className="py-4 px-3 text-right font-mono font-black text-slate-900 border-b border-slate-50">{money(Number(it.totalAmount || 0))}</td>
                        <td className="py-4 px-3 font-mono text-slate-500 border-b border-slate-50">{it.currency}</td>
                        <td className="py-4 px-3 border-b border-slate-50">{(it as any).attachmentUrl ? <a href={(it as any).attachmentUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">view</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              <p className="text-[12px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{pick(T.overpaidWarn, lang)}</p>
            )}
          </SectionCard>

          {/* 3. Vendor Payments */}
          <SectionCard id="csw-vendor" num={3} title={pick(T.vendorPayments, lang)} desc={pick(T.vendorPaymentsDesc, lang)}
            badge={hasExpenses ? <StatusPill label={pick(vendorStatus.label, lang)} tone={vendorStatus.tone} /> : undefined}>
            {!hasExpenses ? (
              <EmptyHint>{pick(T.noVendorYet, lang)}</EmptyHint>
            ) : (
              <VendorPayablesPanel shipmentId={statement.shipmentId} items={items} bankAccounts={bankAccounts} canWrite={canWrite && !financiallyClosed} lang={lang} recordingEnabled={costsApproved && !financiallyClosed} />
            )}
          </SectionCard>

          {/* 4. Customer Invoice */}
          <section id="csw-invoice" className="scroll-mt-24">
            <SectionHead num={4} title={pick(T.invoice, lang)} />
            <div className="mt-3">
              <CustomerInvoicePanel
                key={`inv-${arRefreshToken}`}
                shipmentId={statement.shipmentId}
                currency={agreedCurrency as any}
                bankAccounts={bankAccounts}
                canWrite={canWrite}
                lang={lang}
                clientId={resolvedClientId || undefined}
                companyName={statement.companyName}
                customerHasPayments={customer.customerReceivedAmount > 0}
                onInvoicesChange={setInvoices}
                onLinkCustomer={onOpenCustomer ? () => onOpenCustomer(resolvedClientId) : undefined}
                onReceivePayment={() => { setShowReceivePayment(true); document.getElementById("csw-payments")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                onViewPayments={() => { document.getElementById("csw-payments")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              />
            </div>
          </section>

          {/* 5. Customer Payments (status derived; no manual received field).
              Receive Payment reuses the existing AR flow (CustomerAccountPanel
              → the same /api/customer-accounts/payments endpoints). */}
          <SectionCard id="csw-payments" num={5} title={pick(T.customerPayments, lang)} desc={pick(T.customerPaymentsDesc, lang)}
            badge={hasIssuedInvoice ? <StatusPill label={pick(custStatus.label, lang)} tone={custStatus.tone} /> : undefined}
            action={canWrite ? (
              <button onClick={() => setShowReceivePayment((v) => !v)} disabled={!hasIssuedInvoice}
                title={!hasIssuedInvoice ? pick(T.invoiceFirst, lang) : undefined}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[13px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-2 transition-all shadow-sm shadow-blue-600/20">
                <CreditCard className="w-4 h-4" />{pick(T.receivePayment, lang)}
              </button>
            ) : undefined}>
            {!hasIssuedInvoice ? (
              <EmptyHint>{pick(T.invoiceFirst, lang)}</EmptyHint>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <BigKpi label={pick(T.invoiceAmount, lang)} value={money(issuedInvoice!.sellingAmount)} unit={issuedInvoice!.currency} tone="navy" />
                <BigKpi label={pick(T.receivedCustomer, lang)} value={money(customer.customerReceivedAmount)} unit={customerCurrency} tone="green" />
                <BigKpi label={pick(T.remaining, lang)} value={money(customer.customerReceivable)} unit={customerCurrency} tone="orange" />
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 flex flex-col justify-center">
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{pick(T.customerStatus, lang)}</div>
                  <div className="mt-1.5"><StatusPill label={pick(custStatus.label, lang)} tone={custStatus.tone} /></div>
                </div>
              </div>
            )}
            {canWrite && hasIssuedInvoice && showReceivePayment && (
              <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                <CustomerAccountPanel companyName={statement.companyName} bankAccounts={bankAccounts} canWrite={canWrite} lang={lang} onChanged={onCustomerPaymentChanged} />
              </div>
            )}
          </SectionCard>

          {/* Documents — supporting section (opened ON DEMAND; no permanent PDF pane) */}
          <SectionCard id="csw-documents" title={pick(T.documents, lang)} desc={pick(T.documentsDesc, lang)}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <DocCard icon={<ScrollText className="w-7 h-7" />} tone="slate" name="Cost Statement" ready onPreview={() => previewDoc(`/api/cost-statements/${statement.shipmentId}/pdf?lang=${lang}`)} lang={lang} />
              <DocCard icon={<FileText className="w-7 h-7" />} tone="blue" name="Customer Invoice" ready={hasIssuedInvoice} pendingReason={pick(T.docWaitInvoice, lang)} onPreview={hasIssuedInvoice ? () => previewDoc(`/api/cost-statements/${statement.shipmentId}/invoices/${issuedInvoice!.id}/pdf?lang=${lang}`) : undefined} lang={lang} />
              <DocCard icon={<FileText className="w-7 h-7" />} tone="emerald" name="Client Statement" ready onPreview={() => previewDoc(`/api/customer-accounts/statement/pdf?company=${encodeURIComponent(statement.companyName)}&currency=${agreedCurrency}&lang=${lang}`)} lang={lang} />
              <DocCard icon={<Building2 className="w-7 h-7" />} tone="red" name="Vendor Voucher" ready={false} pendingReason={pick(T.docWaitVendor, lang)} lang={lang} />
              <DocCard icon={<Receipt className="w-7 h-7" />} tone="teal" name="Payment Receipt" ready={false} pendingReason={pick(T.docWaitReceipt, lang)} lang={lang} />
            </div>
          </SectionCard>

          {/* 6. Approval */}
          <section id="csw-review">
            <SectionHead num={6} title={pick(T.approval, lang)} desc={pick(T.approvalDesc, lang)}
              action={
                /* Mobile-only collapse toggle so long approval chains stay manageable
                   (expanded by default). Desktop always shows the full card. */
                <button onClick={() => setApprovalOpen((v) => !v)} aria-expanded={approvalOpen}
                  className="lg:hidden inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer border-0 shrink-0">
                  {approvalOpen ? pick(T.collapse, lang) : pick(T.expand, lang)}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${approvalOpen ? "rotate-180" : ""}`} />
                </button>
              } />
            {!canSubmit && (
              <div className="mt-3 bg-white rounded-2xl border border-amber-200 p-5 space-y-2.5">
                <p className="text-[12px] font-black text-amber-800 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{pick(T.checklist, lang)}</p>
                {checklist.map((c, i) => (
                  <div key={i} className={`flex items-center gap-2 text-[12.5px] font-semibold ${c.ok ? "text-emerald-700" : "text-slate-500"}`}>
                    {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4 text-slate-300" />}
                    {pick(c.label as L3, lang)}
                  </div>
                ))}
              </div>
            )}
            <div className={`mt-3 space-y-3 ${approvalOpen ? "block" : "hidden"} lg:block`}>
              <CostApprovalWorkflowCard lang={lang} statement={statement} actor={actor} hasActiveInvoice={hasIssuedInvoice} onChanged={onRefresh} />
              {/* Phase 6 — Financial Closing (final accounting completion). */}
              <FinancialClosingCard lang={lang} statement={statement} actor={actor} onChanged={onRefresh} />
              {/* Phase 7 — read-only per-currency Order Financial Summary. */}
              <OrderFinancialSummaryCard lang={lang} statement={statement} />
            </div>
          </section>
      </div>

      {/* ─── Sticky action bar ──────────────────────────────────────────────
          Mobile: sits ABOVE the fixed bottom navigation (offset by the nav's
          height + iOS safe area), so the primary actions are never hidden. The
          two primary buttons stretch to fill the width and always fit the
          viewport. Desktop: unchanged — pinned to bottom-0 beside the sidebar,
          with the Linked Cargo + Last saved context. */}
      <div className="fixed inset-x-0 z-30 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-auto lg:right-0 lg:w-[calc(100%-var(--admin-sidebar,0px))] bg-white border-t border-slate-200 px-4 md:px-8 py-3 sm:py-3.5 flex items-center justify-between gap-3 print:hidden">
        <div className="hidden lg:flex text-[12px] text-slate-500 items-center gap-1.5 min-w-0">
          <Package className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="font-bold text-slate-600 shrink-0">{pick(T.linkedCargo, lang)}:</span>
          <span className="truncate">{statement.companyName}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full lg:w-auto">
          {lastSavedLabel && <span className="hidden sm:flex items-center gap-1 text-[12px] text-slate-400"><CheckCircle2 className="w-4 h-4 text-emerald-500" />{pick(T.lastSaved, lang)}: {lastSavedLabel}</span>}
          {canWrite && onSaveDraft && (
            <button onClick={() => onSaveDraft()} disabled={isSaving} className="flex-1 lg:flex-none justify-center px-4 py-2.5 bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 text-[13px] font-bold rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-all">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{pick(T.saveDraft, lang)}
            </button>
          )}
          {/* Submit for Approval — the SECOND and last location. */}
          {canWrite && (
            <button onClick={() => (onSubmitForApproval ? onSubmitForApproval() : scrollTo("review"))} disabled={!canSubmit} title={!canSubmit ? pick(T.submitBlocked, lang) : undefined} className={`${btnPrimary} flex-1 lg:flex-none justify-center`}>
              <Send className="w-4 h-4" />{pick(T.submit, lang)}
            </button>
          )}
        </div>
      </div>

      {/* Success toast (subtle) */}
      {toast && (
        <div className="fixed right-4 sm:right-6 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] lg:bottom-24 z-50 bg-slate-900 text-white text-[13px] font-bold px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 print:hidden">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />{toast}
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
  green: { bg: "bg-emerald-100", fg: "text-emerald-600" },
};
const PILL: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  green: "bg-emerald-100 text-emerald-700 border-emerald-200",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  red: "bg-red-100 text-red-700 border-red-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
};

function StatusPill({ label, tone, large }: { label: string; tone: string; large?: boolean }) {
  return <span className={`inline-block rounded-md font-black uppercase tracking-wide border ${PILL[tone] || PILL.slate} ${large ? "px-3.5 py-1.5 text-[12px]" : "px-2.5 py-1 text-[11px]"}`}>{label}</span>;
}

function InfoCard({ icon, tone, label, value, sub, mono, strong }: { icon: React.ReactNode; tone: keyof typeof TONE; label: string; value: string; sub?: string; mono?: boolean; strong?: boolean }) {
  const t = TONE[tone] || TONE.slate;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-9 h-9 rounded-xl ${t.bg} ${t.fg} flex items-center justify-center shrink-0`}>{icon}</span>
        <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div className={`text-[15px] leading-snug break-words ${mono ? "font-mono" : ""} ${strong ? "font-black text-slate-900" : "font-bold text-slate-800"}`} title={value}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5 break-words" title={sub}>{sub}</div>}
    </div>
  );
}

const STEP_CIRCLE: Record<StepState, string> = {
  completed: "bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-500/30",
  active: "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30",
  pending: "bg-white text-slate-400 border-slate-200",
  blocked: "bg-orange-100 text-orange-600 border-orange-300",
};
function StepCircle({ index, state }: { index: number; state: StepState }) {
  return (
    <span className={`w-11 h-11 rounded-full border-2 flex items-center justify-center text-[15px] font-black shrink-0 transition-all ${STEP_CIRCLE[state]}`}>
      {state === "completed" ? <CheckCircle2 className="w-6 h-6" /> : state === "blocked" ? <Lock className="w-4 h-4" /> : index}
    </span>
  );
}
function StepStatusLabel({ state, label }: { state: StepState; label: string }) {
  const cls = state === "completed" ? "text-emerald-600" : state === "active" ? "text-blue-600" : state === "blocked" ? "text-orange-600" : "text-slate-400";
  const Icon = state === "completed" ? CheckCircle2 : state === "active" ? Clock : state === "blocked" ? Lock : Circle;
  return <span className={`flex items-center gap-1 text-[11px] font-bold mt-1 leading-tight ${cls}`}><Icon className="w-3 h-3 shrink-0 mt-px" />{label}</span>;
}

function ShipmentFact({ label, value, mono, className = "" }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[10.5px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-[13px] font-semibold text-slate-800 ${mono ? "font-mono" : ""} break-words`}>{value}</p>
    </div>
  );
}
function SectionHead({ num, title, desc, action, badge }: { num?: number; title: string; desc?: string; action?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {num != null && <span className="w-7 h-7 rounded-lg bg-slate-900 text-white text-[13px] font-black flex items-center justify-center shrink-0 mt-0.5">{num}</span>}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-black text-slate-900 uppercase tracking-wide leading-none">{title}</h2>
            {badge}
          </div>
          {desc && <p className="text-[12px] text-slate-500 mt-1.5">{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
function SectionCard({ id, num, title, desc, action, badge, children }: { id: string; num?: number; title: string; desc?: string; action?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5 scroll-mt-24">
      <SectionHead num={num} title={title} desc={desc} action={action} badge={badge} />
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-5 py-5 text-center">{children}</p>;
}

const KPI_TONE: Record<string, string> = {
  navy: "text-slate-900", green: "text-emerald-600", orange: "text-orange-500", red: "text-red-600", blue: "text-blue-600", slate: "text-slate-500",
};
function KpiStrip({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 rounded-2xl border border-slate-200 bg-slate-50/50 divide-y md:divide-y-0 md:divide-x divide-slate-200 overflow-hidden">{children}</div>;
}
function KpiCell({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: keyof typeof KPI_TONE }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`text-2xl font-black font-mono ${KPI_TONE[tone]}`}>{value}</span>
        <span className="text-[11px] font-bold text-slate-400">{unit}</span>
      </div>
    </div>
  );
}
function BigKpi({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: keyof typeof KPI_TONE }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5">
      <div className="text-[10.5px] font-black uppercase tracking-wide text-slate-400 leading-tight" title={label}>{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`text-[19px] font-black font-mono ${KPI_TONE[tone]}`}>{value}</span>
        <span className="text-[10px] font-bold text-slate-400">{unit}</span>
      </div>
    </div>
  );
}

function DocCard({ icon, tone, name, ready, onPreview, lang, pendingReason }: { icon: React.ReactNode; tone: keyof typeof TONE; name: string; ready: boolean; onPreview?: () => void; lang: Language; pendingReason?: string }) {
  const t = TONE[tone] || TONE.slate;
  return (
    <div className={`rounded-2xl border p-4 flex items-center gap-3.5 transition-all ${ready ? "border-emerald-200 bg-emerald-50/30 hover:border-emerald-300 hover:shadow-sm" : "border-slate-100 bg-slate-50/50"}`}>
      <span className={`w-14 h-14 rounded-2xl ${ready ? `${t.bg} ${t.fg}` : "bg-slate-100 text-slate-300"} flex items-center justify-center shrink-0`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-black leading-tight ${ready ? "text-slate-800" : "text-slate-400"}`}>{name}</div>
        {/* Helpful status: a concrete reason when not generated, not a bare label. */}
        {!ready && pendingReason
          ? <span className="inline-flex items-center gap-1 mt-1 text-[9.5px] font-bold text-amber-600"><Clock className="w-3 h-3" />{pendingReason}</span>
          : <span className={`inline-flex items-center gap-1 mt-1 text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded ${ready ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"}`}>{ready && <CheckCircle2 className="w-2.5 h-2.5" />}{ready ? pick(T.generated, lang) : pick(T.notGenerated, lang)}</span>}
        {ready && onPreview && (
          <div className="flex items-center gap-1.5 mt-2">
            <button onClick={onPreview} title={pick(T.preview, lang)} className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border-0 transition-colors"><Eye className="w-4 h-4" /></button>
            <button onClick={onPreview} title={pick(T.download, lang)} className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border-0 transition-colors"><Download className="w-4 h-4" /></button>
            <button onClick={() => window.print()} title={pick(T.print, lang)} className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border-0 transition-colors"><Printer className="w-4 h-4" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
