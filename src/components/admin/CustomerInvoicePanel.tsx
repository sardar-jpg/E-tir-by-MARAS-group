import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus, Send, Ban, Loader2, Eye, Download, Printer, X, ChevronDown, Check, Search, AlertTriangle, CheckCircle2, Trash2, Copy, CreditCard, History, Receipt } from "lucide-react";
import type { Language, BankAccount, CustomerInvoice, CustomerInvoiceStatus, Currency } from "../../types";
import { apiFetch } from "../../lib/api";
import { openAccountingPdf } from "../../lib/openAccountingPdf";
import {
  INVOICE_SERVICE_TYPES, PAYMENT_TERMS, PRICE_DIFFERENCE_REASONS,
  isOtherServiceType, isCustomPaymentTerm, paymentTermDays, type CatalogOption, type L3,
} from "../../lib/invoiceLineCatalog";
import { computeLineAmount, computeInvoiceTotals } from "../../lib/customerInvoiceLines";
import {
  emptyLineDraft, addLineDraft, duplicateLineDraft, deleteLineDraft, lineDraftHasData, type LineDraft,
} from "../../lib/invoiceLineEditor";

/**
 * Customer Invoice panel — build a real customer-facing logistics invoice with
 * multiple service LINES in a professional ERP-style entry table. The employee
 * never picks a pricing method: the total is derived from the lines. Every line
 * amount + all totals are recomputed SERVER-side on save (the browser preview is
 * never trusted). Internal cost and profit never appear on the customer invoice
 * or its PDF.
 */
const STATUS_LABEL: Record<CustomerInvoiceStatus, L3> = {
  draft: { en: "Draft", tr: "Taslak", ar: "مسودة" },
  issued: { en: "Issued", tr: "Düzenlendi", ar: "صادرة" },
  partially_paid: { en: "Partially paid", tr: "Kısmen ödendi", ar: "مدفوعة جزئياً" },
  paid: { en: "Paid", tr: "Ödendi", ar: "مدفوعة" },
  cancelled: { en: "Cancelled", tr: "İptal edildi", ar: "ملغاة" },
};
const T = {
  title: { en: "Customer Invoices", tr: "Müşteri Faturaları", ar: "فواتير العملاء" },
  intro: { en: "Build a customer invoice from service lines. The total comes from the lines; internal cost and profit never appear on the customer document.", tr: "Hizmet satırlarından müşteri faturası oluşturun. Toplam satırlardan gelir; iç maliyet ve kâr müşteri belgesinde görünmez.", ar: "أنشئ فاتورة العميل من بنود الخدمة. يأتي الإجمالي من البنود؛ لا تظهر التكلفة والربح الداخليان على مستند العميل." },
  create: { en: "New invoice", tr: "Yeni fatura", ar: "فاتورة جديدة" },
  none: { en: "No invoices yet.", tr: "Henüz fatura yok.", ar: "لا توجد فواتير بعد." },
  noCustomer: { en: "This shipment is not linked to a valid customer account. Link or create the customer before creating an invoice.", tr: "Bu sevkiyat geçerli bir müşteri hesabına bağlı değil. Fatura oluşturmadan önce müşteriyi bağlayın veya oluşturun.", ar: "هذه الشحنة غير مرتبطة بحساب عميل صالح. اربط العميل أو أنشئه قبل إنشاء الفاتورة." },
  linkCustomer: { en: "Link Customer", tr: "Müşteriyi Bağla", ar: "ربط العميل" },
  customer: { en: "Customer", tr: "Müşteri", ar: "العميل" },
  status: { en: "Status", tr: "Durum", ar: "الحالة" },
  invoiceNo: { en: "Invoice Number", tr: "Fatura No", ar: "رقم الفاتورة" },
  invoiceNoAuto: { en: "Generated on save", tr: "Kaydetmede oluşturulur", ar: "يُنشأ عند الحفظ" },
  invoiceDate: { en: "Invoice Date", tr: "Fatura Tarihi", ar: "تاريخ الفاتورة" },
  dueDate: { en: "Due Date", tr: "Vade Tarihi", ar: "تاريخ الاستحقاق" },
  paymentTerms: { en: "Payment Terms", tr: "Ödeme Koşulları", ar: "شروط الدفع" },
  customTerm: { en: "Custom term label", tr: "Özel koşul etiketi", ar: "وصف الشرط المخصص" },
  currency: { en: "Currency", tr: "Para Birimi", ar: "العملة" },
  bank: { en: "Bank Account", tr: "Banka Hesabı", ar: "الحساب المصرفي" },
  bankPick: { en: "Select a bank account…", tr: "Banka hesabı seçin…", ar: "اختر حسابًا مصرفيًا…" },
  customerNotes: { en: "Customer Notes", tr: "Müşteri Notları", ar: "ملاحظات العميل" },
  customerNotesPlaceholder: { en: "Optional — shown to the customer", tr: "İsteğe bağlı — müşteriye gösterilir", ar: "اختياري — يظهر للعميل" },
  lines: { en: "Invoice Lines", tr: "Fatura Satırları", ar: "بنود الفاتورة" },
  linesCount: { en: "Invoice Lines", tr: "Fatura Satırı", ar: "عدد البنود" },
  addLine: { en: "Add Invoice Line", tr: "Fatura Satırı Ekle", ar: "إضافة بند" },
  rowNo: { en: "#", tr: "#", ar: "#" },
  serviceType: { en: "Service Type", tr: "Hizmet Türü", ar: "نوع الخدمة" },
  specifyService: { en: "Specify Service Type", tr: "Hizmet Türünü Belirtin", ar: "حدّد نوع الخدمة" },
  description: { en: "Description", tr: "Açıklama", ar: "الوصف" },
  descriptionPlaceholder: { en: "Optional line detail", tr: "İsteğe bağlı satır ayrıntısı", ar: "تفاصيل اختيارية للبند" },
  quantity: { en: "Quantity", tr: "Miktar", ar: "الكمية" },
  unit: { en: "Unit", tr: "Birim", ar: "الوحدة" },
  specifyUnit: { en: "Specify Unit", tr: "Birimi Belirtin", ar: "حدّد الوحدة" },
  unitPrice: { en: "Unit Price", tr: "Birim Fiyat", ar: "سعر الوحدة" },
  amount: { en: "Amount", tr: "Tutar", ar: "المبلغ" },
  actions: { en: "Actions", tr: "İşlemler", ar: "إجراءات" },
  duplicate: { en: "Duplicate line", tr: "Satırı çoğalt", ar: "تكرار البند" },
  deleteLine: { en: "Delete line", tr: "Satırı sil", ar: "حذف البند" },
  confirmDelete: { en: "Delete this line?", tr: "Bu satır silinsin mi?", ar: "حذف هذا البند؟" },
  confirm: { en: "Delete", tr: "Sil", ar: "حذف" },
  keep: { en: "Keep", tr: "Vazgeç", ar: "إبقاء" },
  noLinesTitle: { en: "No invoice lines yet.", tr: "Henüz fatura satırı yok.", ar: "لا توجد بنود بعد." },
  noLinesBody: { en: "Add the first service line to create the customer invoice.", tr: "Müşteri faturasını oluşturmak için ilk hizmet satırını ekleyin.", ar: "أضف أول بند خدمة لإنشاء فاتورة العميل." },
  subtotal: { en: "Subtotal", tr: "Ara Toplam", ar: "المجموع الفرعي" },
  discount: { en: "Discount", tr: "İndirim", ar: "الخصم" },
  tax: { en: "Tax", tr: "Vergi", ar: "الضريبة" },
  additional: { en: "Additional Charges", tr: "Ek Ücretler", ar: "رسوم إضافية" },
  grandTotal: { en: "Grand Total", tr: "Genel Toplam", ar: "الإجمالي الكلي" },
  totalPayable: { en: "Total Payable", tr: "Ödenecek Tutar", ar: "الإجمالي المستحق" },
  agreedPrice: { en: "Agreed Shipment Selling Price", tr: "Anlaşılan Satış Fiyatı", ar: "سعر البيع المتفق" },
  readOnly: { en: "Read only", tr: "Salt okunur", ar: "للقراءة فقط" },
  matchTitle: { en: "Matches Agreed Selling Price", tr: "Anlaşılan Satış Fiyatına Uyuyor", ar: "مطابق لسعر البيع المتفق" },
  diffTitle: { en: "Invoice Total Differs from Agreed Price", tr: "Fatura Toplamı Anlaşılan Fiyattan Farklı", ar: "إجمالي الفاتورة يختلف عن السعر المتفق" },
  difference: { en: "Difference", tr: "Fark", ar: "الفرق" },
  reasonRequired: { en: "Reason Required", tr: "Neden Gerekli", ar: "السبب مطلوب" },
  diffReason: { en: "Price Difference Reason", tr: "Fiyat Farkı Nedeni", ar: "سبب فرق السعر" },
  diffReasonPick: { en: "Select a reason…", tr: "Bir neden seçin…", ar: "اختر سببًا…" },
  saveDraft: { en: "Save Invoice Draft", tr: "Fatura Taslağını Kaydet", ar: "حفظ مسودة الفاتورة" },
  issue: { en: "Issue Invoice", tr: "Faturayı Düzenle", ar: "إصدار الفاتورة" },
  cancel: { en: "Cancel", tr: "İptal", ar: "إلغاء" },
  cancelInv: { en: "Cancel Invoice", tr: "Faturayı iptal et", ar: "إلغاء الفاتورة" },
  viewInvoice: { en: "View Invoice", tr: "Faturayı Görüntüle", ar: "عرض الفاتورة" },
  downloadPdf: { en: "Download PDF", tr: "PDF İndir", ar: "تنزيل PDF" },
  print: { en: "Print", tr: "Yazdır", ar: "طباعة" },
  invoiceAmount: { en: "Invoice Amount", tr: "Fatura Tutarı", ar: "قيمة الفاتورة" },
  payStatus: { en: "Payment Status", tr: "Ödeme Durumu", ar: "حالة الدفع" },
  receivePayment: { en: "Receive Payment", tr: "Ödeme Al", ar: "استلام دفعة" },
  paymentHistory: { en: "Payment History", tr: "Ödeme Geçmişi", ar: "سجل الدفعات" },
  viewReceipts: { en: "View Receipts", tr: "Makbuzları Görüntüle", ar: "عرض الإيصالات" },
  needFields: { en: "Complete invoice date, due date, bank account and at least one valid line.", tr: "Fatura tarihi, vade, banka hesabı ve en az bir geçerli satırı tamamlayın.", ar: "أكمل تاريخ الفاتورة والاستحقاق والحساب المصرفي وبندًا واحدًا صحيحًا على الأقل." },
  needReason: { en: "A price-difference reason is required.", tr: "Fiyat farkı nedeni gereklidir.", ar: "سبب فرق السعر مطلوب." },
};
const tr = (k: keyof typeof T, lang: Language) => (T[k] as L3)[lang] || (T[k] as L3).en;
const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_STYLE: Record<CustomerInvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-600", issued: "bg-emerald-100 text-emerald-700",
  partially_paid: "bg-amber-100 text-amber-700", paid: "bg-blue-100 text-blue-700", cancelled: "bg-red-100 text-red-700",
};

const num = (s: string): number => { const n = Number(s); return Number.isFinite(n) ? n : 0; };
/** Mask an account number, keeping only the last four digits. */
const maskAccount = (acc?: string): string => { const s = (acc || "").replace(/\s+/g, ""); return s.length > 4 ? `••••${s.slice(-4)}` : s ? `••••${s}` : ""; };

export default function CustomerInvoicePanel({ shipmentId, currency, bankAccounts, canWrite, lang, clientId, companyName, agreedAmount, customerHasPayments, onInvoicesChange, onLinkCustomer, onReceivePayment, onViewPayments }: {
  shipmentId: string;
  currency: Currency;
  bankAccounts: BankAccount[];
  canWrite: boolean;
  lang: Language;
  clientId?: string;
  /** Read-only customer name from the shipment/order. */
  companyName?: string;
  /** Read-only agreed shipment selling price, for the price-difference comparison. */
  agreedAmount?: number;
  /** True when the customer already has payments/receipts (drives quick-access actions). */
  customerHasPayments?: boolean;
  onInvoicesChange?: (invoices: CustomerInvoice[]) => void;
  onLinkCustomer?: () => void;
  /** Open the existing Customer Account / AR flow to receive a payment (no duplicate logic here). */
  onReceivePayment?: (inv: CustomerInvoice) => void;
  /** Open the existing Customer Account / receipts flow (payment history + receipts). */
  onViewPayments?: (inv: CustomerInvoice) => void;
}) {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [hdr, setHdr] = useState({ invoiceDate: today, dueDate: "", paymentTerms: "", customTerm: "", bankAccountId: "", customerNotes: "", discountAmount: "", taxAmount: "", additionalCharges: "", priceDifferenceReason: "" });
  const [lines, setLines] = useState<LineDraft[]>([emptyLineDraft()]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Focus handoff: when a row is added/duplicated, focus its Service Type control.
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const serviceRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices`); if (res.ok) { const list = (await res.json()).invoices || []; setInvoices(list); onInvoicesChange?.(list); } }
    catch { /* panel-isolated */ } finally { setLoading(false); }
  }, [shipmentId, onInvoicesChange]);
  useEffect(() => { void load(); }, [load]);

  // After a row is added/duplicated, move focus + scroll it into view.
  useEffect(() => {
    if (!focusLineId) return;
    const btn = serviceRefs.current[focusLineId];
    const row = rowRefs.current[focusLineId];
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    btn?.focus();
    setFocusLineId(null);
  }, [focusLineId, lines]);

  const resetForm = () => { setHdr({ invoiceDate: today, dueDate: "", paymentTerms: "", customTerm: "", bankAccountId: "", customerNotes: "", discountAmount: "", taxAmount: "", additionalCharges: "", priceDifferenceReason: "" }); setLines([emptyLineDraft()]); setConfirmDeleteId(null); };

  // Auto-fill due date from a controlled payment term (Custom leaves it manual).
  const chooseTerm = (term: string) => {
    setHdr((h) => {
      const next = { ...h, paymentTerms: term };
      const days = paymentTermDays(term);
      if (days !== null && h.invoiceDate) { const d = new Date(h.invoiceDate); d.setDate(d.getDate() + days); next.dueDate = d.toISOString().slice(0, 10); }
      if (!isCustomPaymentTerm(term)) next.customTerm = "";
      return next;
    });
  };

  // Client-side preview (SERVER RECOMPUTES on save — never trusted here).
  const previewLines = useMemo(() => lines.map((l) => ({ ...l, amount: computeLineAmount(num(l.quantity), num(l.unitPrice)) })), [lines]);
  const totals = useMemo(() => computeInvoiceTotals(previewLines.map((l) => ({ id: l.id, serviceType: l.serviceType, quantity: num(l.quantity), unit: l.unit, unitPrice: num(l.unitPrice), amount: l.amount })), { discountAmount: num(hdr.discountAmount), taxAmount: num(hdr.taxAmount), additionalCharges: num(hdr.additionalCharges) }), [previewLines, hdr.discountAmount, hdr.taxAmount, hdr.additionalCharges]);
  const agreed = Number.isFinite(agreedAmount) ? Number(agreedAmount) : 0;
  const priceDiff = Math.round((totals.grandTotal - agreed + Number.EPSILON) * 100) / 100;
  const hasAgreed = agreed > 0;
  const hasDiff = hasAgreed && Math.abs(priceDiff) > 0.001;

  // Unit is no longer part of the line UI (item 3); it is not required to save a line.
  const lineValid = (l: LineDraft) => !!l.serviceType && (!isOtherServiceType(l.serviceType) || l.customServiceType.trim().length > 0) && num(l.quantity) > 0 && num(l.unitPrice) >= 0;
  const allLinesValid = lines.length > 0 && lines.every(lineValid);
  const headerValid = !!hdr.invoiceDate && !!hdr.dueDate && !!hdr.bankAccountId;
  const reasonOk = !hasDiff || hdr.priceDifferenceReason.trim().length > 0;
  const canSave = canWrite && !!clientId && allLinesValid && headerValid && reasonOk;

  const buildPayload = () => ({
    clientId,
    currency,
    invoiceDate: hdr.invoiceDate,
    dueDate: hdr.dueDate,
    paymentTerms: isCustomPaymentTerm(hdr.paymentTerms) ? (hdr.customTerm.trim() || "Custom") : hdr.paymentTerms || undefined,
    bankAccountId: hdr.bankAccountId || undefined,
    customerNotes: hdr.customerNotes.trim() || undefined,
    discountAmount: num(hdr.discountAmount),
    taxAmount: num(hdr.taxAmount),
    additionalCharges: num(hdr.additionalCharges),
    priceDifferenceReason: hasDiff ? hdr.priceDifferenceReason.trim() : undefined,
    invoiceLines: lines.map((l) => ({
      serviceType: l.serviceType,
      customServiceType: isOtherServiceType(l.serviceType) ? l.customServiceType.trim() : undefined,
      description: l.description.trim() || undefined,
      quantity: num(l.quantity),
      // Unit is optional now (removed from the UI); only sent if a legacy value is present.
      unit: l.unit || undefined,
      unitPrice: num(l.unitPrice),
    })),
  });

  const createDraft = async (): Promise<CustomerInvoice | null> => {
    const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) });
    if (res.ok) return (await res.json()).invoice as CustomerInvoice;
    const b = await res.json().catch(() => ({})); setErr(b.error || "Save failed."); return null;
  };
  const onSaveDraft = async () => {
    if (!canSave) { setErr(hasDiff && !reasonOk ? tr("needReason", lang) : tr("needFields", lang)); return; }
    setErr(null); setBusy(true);
    try { const inv = await createDraft(); if (inv) { setCreating(false); resetForm(); await load(); } }
    catch { setErr("Save failed."); } finally { setBusy(false); }
  };
  const onIssue = async () => {
    if (!canSave) { setErr(hasDiff && !reasonOk ? tr("needReason", lang) : tr("needFields", lang)); return; }
    setErr(null); setBusy(true);
    try {
      const inv = await createDraft();
      if (!inv) return;
      const bankId = inv.bankAccountId || hdr.bankAccountId || undefined;
      const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankAccountId: bankId, idempotencyKey: `issue-${inv.id}` }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setErr(b.error || "Issue failed."); await load(); return; }
      setCreating(false); resetForm(); await load();
    } catch { setErr("Issue failed."); } finally { setBusy(false); }
  };
  const issueExisting = async (inv: CustomerInvoice) => {
    const bankId = inv.bankAccountId || (bankAccounts.find((b) => b.active && b.currency === inv.currency && b.isDefaultForCurrency)?.id) || "";
    try { const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankAccountId: bankId || undefined }) });
      if (res.ok) await load(); else { const b = await res.json().catch(() => ({})); window.alert(b.error || "Issue failed."); } }
    catch { /* isolated */ }
  };
  const cancelInvoice = async (inv: CustomerInvoice) => {
    const reason = window.prompt(tr("cancelInv", lang) + ":");
    if (!reason || !reason.trim()) return;
    try { const res = await apiFetch(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); if (res.ok) await load(); }
    catch { /* isolated */ }
  };

  const setLine = (id: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  // Row operations (pure helpers keep the amount/total math server-authoritative).
  const addLine = () => { const id = `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; setLines((ls) => addLineDraft(ls, id)); setFocusLineId(id); };
  const duplicateLine = (id: string) => { const newId = `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; setLines((ls) => duplicateLineDraft(ls, id, newId)); setFocusLineId(newId); };
  const requestDelete = (l: LineDraft) => { if (lineDraftHasData(l)) setConfirmDeleteId(l.id); else performDelete(l.id); };
  const performDelete = (id: string) => { setLines((ls) => deleteLineDraft(ls, id)); setConfirmDeleteId(null); };
  // Enter on the last editable field of the last row appends a new line.
  const onLastFieldEnter = (l: LineDraft, isLast: boolean) => (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); if (isLast) addLine(); } };

  const banks = bankAccounts.filter((b) => b.active && b.currency === currency);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-black text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4 text-orange-600" /><span>{tr("title", lang)}</span></h3>
          <p className="text-[11px] text-slate-500 mt-1 max-w-xl">{tr("intro", lang)}</p>
        </div>
        {canWrite && !creating && clientId && <button onClick={() => { setCreating(true); setErr(null); }} className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1.5"><Plus className="w-4 h-4" />{tr("create", lang)}</button>}
      </div>

      {canWrite && !clientId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-amber-800">{tr("noCustomer", lang)}</p>
          {onLinkCustomer && <button onClick={onLinkCustomer} className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0">{tr("linkCustomer", lang)}</button>}
        </div>
      )}

      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />…</div>}
      {!loading && invoices.length === 0 && !creating && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-center space-y-2">
          <FileText className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-[12.5px] text-slate-500">{tr("none", lang)}</p>
          {canWrite && clientId && <button onClick={() => { setCreating(true); setErr(null); }} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-bold rounded-lg cursor-pointer border-0 inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />{tr("create", lang)}</button>}
        </div>
      )}

      {/* Existing invoices */}
      <div className="space-y-2.5">
        {invoices.map((inv) => {
          const issued = inv.status === "issued" || inv.status === "partially_paid" || inv.status === "paid";
          const lineCount = Array.isArray(inv.invoiceLines) ? inv.invoiceLines.length : 0;
          return (
          <div key={inv.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900 font-mono text-[14px]">{inv.invoiceNumber}</span>
                {issued && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              </div>
              <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wide ${STATUS_STYLE[inv.status]}`}>{STATUS_LABEL[inv.status]?.[lang] || inv.status}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5 mt-3">
              <InvField label={tr("invoiceNo", lang)} value={inv.invoiceNumber} />
              <InvField label={tr("status", lang)} value={STATUS_LABEL[inv.status]?.[lang] || inv.status} />
              <InvField label={tr("linesCount", lang)} value={lineCount > 0 ? String(lineCount) : "—"} />
              <InvField label={tr("invoiceDate", lang)} value={(inv.issuedAt || inv.invoiceDate || inv.createdAt) ? new Date(inv.issuedAt || inv.invoiceDate || inv.createdAt).toLocaleDateString() : "—"} />
              <InvField label={tr("dueDate", lang)} value={inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"} />
              <InvField label={tr("invoiceAmount", lang)} value={`${money(inv.grandTotal ?? inv.sellingAmount)} ${inv.currency}`} strong />
              <InvField label={tr("payStatus", lang)} value={STATUS_LABEL[inv.status]?.[lang] || inv.status} />
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-3.5 pt-3 border-t border-slate-100">
              <button onClick={() => openAccountingPdf(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/pdf?lang=${lang}`)} className="px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" />{tr("viewInvoice", lang)}</button>
              <button onClick={() => openAccountingPdf(`/api/cost-statements/${shipmentId}/invoices/${inv.id}/pdf?lang=${lang}`)} className="px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><Download className="w-3.5 h-3.5" />{tr("downloadPdf", lang)}</button>
              {issued && <button onClick={() => window.print()} className="px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" />{tr("print", lang)}</button>}
              {canWrite && inv.status === "draft" && <button onClick={() => issueExisting(inv)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1.5"><Send className="w-3.5 h-3.5" />{tr("issue", lang)}</button>}
              {canWrite && issued && <button onClick={() => cancelInvoice(inv)} className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><Ban className="w-3.5 h-3.5" />{tr("cancelInv", lang)}</button>}
            </div>
            {/* Payment quick access — reuses the existing Customer Account / receipts flow (no duplicate payment logic). */}
            {issued && (onReceivePayment || onViewPayments) && (
              <div className="flex items-center gap-2 flex-wrap mt-2.5 pt-2.5 border-t border-slate-100">
                {customerHasPayments ? (
                  <>
                    {onViewPayments && <button onClick={() => onViewPayments(inv)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><History className="w-3.5 h-3.5" />{tr("paymentHistory", lang)}</button>}
                    {onViewPayments && <button onClick={() => onViewPayments(inv)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" />{tr("viewReceipts", lang)}</button>}
                  </>
                ) : (
                  canWrite && onReceivePayment && <button onClick={() => onReceivePayment(inv)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />{tr("receivePayment", lang)}</button>
                )}
              </div>
            )}
          </div>
        );})}
      </div>

      {/* New invoice form */}
      {creating && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h4 className="text-[13px] font-black text-slate-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />{tr("create", lang)}</h4>
            <button onClick={() => { setCreating(false); resetForm(); setErr(null); }} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:border-slate-300 flex items-center justify-center cursor-pointer"><X className="w-4 h-4" /></button>
          </div>

          {/* Header */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <RoField label={tr("customer", lang)} value={companyName || "—"} />
            <RoField label={tr("invoiceNo", lang)} value={tr("invoiceNoAuto", lang)} muted />
            <RoField label={tr("currency", lang)} value={currency} />
            <Field label={tr("invoiceDate", lang)} required><input type="date" value={hdr.invoiceDate} onChange={(e) => setHdr({ ...hdr, invoiceDate: e.target.value })} className={inp} /></Field>
            <Field label={tr("dueDate", lang)} required><input type="date" value={hdr.dueDate} onChange={(e) => setHdr({ ...hdr, dueDate: e.target.value })} className={`${inp} ${!hdr.dueDate ? "border-red-300" : ""}`} /></Field>
            <Field label={tr("paymentTerms", lang)}>
              <CatalogSelect options={PAYMENT_TERMS} value={hdr.paymentTerms} lang={lang} placeholder={tr("paymentTerms", lang)} onChange={chooseTerm} />
            </Field>
            {isCustomPaymentTerm(hdr.paymentTerms) && <Field label={tr("customTerm", lang)}><input value={hdr.customTerm} onChange={(e) => setHdr({ ...hdr, customTerm: e.target.value })} className={inp} /></Field>}
            <Field label={tr("bank", lang)} required>
              <BankSelect banks={banks} value={hdr.bankAccountId} placeholder={tr("bankPick", lang)} onChange={(v) => setHdr({ ...hdr, bankAccountId: v })} invalid={!hdr.bankAccountId} />
            </Field>
            <Field label={tr("customerNotes", lang)} full><input value={hdr.customerNotes} onChange={(e) => setHdr({ ...hdr, customerNotes: e.target.value })} placeholder={tr("customerNotesPlaceholder", lang)} className={inp} /></Field>
          </div>

          {/* Lines table — the core working area */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-black text-slate-800 uppercase tracking-wide">{tr("lines", lang)}</span>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">{lines.length}</span>
              </div>
              <button onClick={addLine} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1.5 shadow-sm shadow-blue-600/20"><Plus className="w-4 h-4" />{tr("addLine", lang)}</button>
            </div>
            {lines.length === 0 ? (
              <div className="px-5 py-10 text-center space-y-1">
                <FileText className="w-8 h-8 text-slate-200 mx-auto" />
                <p className="text-[13px] font-bold text-slate-500">{tr("noLinesTitle", lang)}</p>
                <p className="text-[11.5px] text-slate-400">{tr("noLinesBody", lang)}</p>
                <button onClick={addLine} className="mt-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-bold rounded-lg cursor-pointer border-0 inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />{tr("addLine", lang)}</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] min-w-[880px] border-collapse">
                  <thead>
                    <tr className="text-left text-slate-500 bg-slate-50 border-b-2 border-slate-200">
                      <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wide w-10 text-center">{tr("rowNo", lang)}</th>
                      <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wide w-56">{tr("serviceType", lang)}</th>
                      <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wide min-w-[180px]">{tr("description", lang)}</th>
                      <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wide w-24 text-right">{tr("quantity", lang)}</th>
                      <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wide w-32 text-right">{tr("unitPrice", lang)}</th>
                      <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wide w-32 text-right">{tr("amount", lang)}</th>
                      <th className="py-3 px-3 text-[10px] font-black uppercase tracking-wide w-24 text-center">{tr("actions", lang)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => {
                      const confirming = confirmDeleteId === l.id;
                      const isLast = idx === lines.length - 1;
                      return (
                      <tr key={l.id} ref={(el) => { rowRefs.current[l.id] = el; }} className="border-b border-slate-100 align-top hover:bg-slate-50/40 transition-colors">
                        <td className="py-3 px-3 text-center align-middle"><span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[11px] font-black font-mono">{idx + 1}</span></td>
                        <td className="py-3 px-3">
                          <CatalogSelect options={INVOICE_SERVICE_TYPES} value={l.serviceType} lang={lang} searchable placeholder={tr("serviceType", lang)} onChange={(v) => setLine(l.id, { serviceType: v, ...(isOtherServiceType(v) ? {} : { customServiceType: "" }) })} invalid={!l.serviceType} triggerRef={(el) => { serviceRefs.current[l.id] = el; }} />
                          {isOtherServiceType(l.serviceType) && <input value={l.customServiceType} onChange={(e) => setLine(l.id, { customServiceType: e.target.value })} placeholder={tr("specifyService", lang)} className={`${inp} mt-1.5 ${l.customServiceType.trim() ? "" : "border-red-300"}`} />}
                        </td>
                        <td className="py-3 px-3"><input value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} placeholder={tr("descriptionPlaceholder", lang)} className={inp} /></td>
                        <td className="py-3 px-3"><input type="number" min="0" step="0.01" value={l.quantity} onChange={(e) => setLine(l.id, { quantity: e.target.value })} className={`${inp} text-right tabular-nums ${num(l.quantity) > 0 ? "" : "border-red-300"}`} /></td>
                        {/* Unit removed from the invoice line UI (item 3); legacy lines keep any stored unit. */}
                        <td className="py-3 px-3"><input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(l.id, { unitPrice: e.target.value })} onKeyDown={onLastFieldEnter(l, isLast)} className={`${inp} text-right tabular-nums`} /></td>
                        {/* Amount is auto — never typed. Visually stronger than inputs. */}
                        <td className="py-3 px-3 text-right align-middle"><span className="font-mono font-black text-[13.5px] text-slate-900 tabular-nums">{money(computeLineAmount(num(l.quantity), num(l.unitPrice)))}</span></td>
                        <td className="py-3 px-3 align-middle">
                          {confirming ? (
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => performDelete(l.id)} title={tr("confirmDelete", lang)} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-md cursor-pointer border-0">{tr("confirm", lang)}</button>
                              <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 bg-white border border-slate-200 text-slate-500 text-[10px] font-black rounded-md cursor-pointer">{tr("keep", lang)}</button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => duplicateLine(l.id)} title={tr("duplicate", lang)} aria-label={tr("duplicate", lang)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-600 text-slate-400 flex items-center justify-center cursor-pointer transition-colors"><Copy className="w-4 h-4" /></button>
                              <button onClick={() => requestDelete(l)} title={tr("deleteLine", lang)} aria-label={tr("deleteLine", lang)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:border-red-300 hover:text-red-600 text-slate-400 flex items-center justify-center cursor-pointer transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Totals + agreed price */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              {/* Agreed price reference (read only) */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-emerald-700">{tr("agreedPrice", lang)}</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl font-black font-mono text-emerald-700 tabular-nums">{money(agreed)}</span>
                  <span className="text-[11px] font-bold text-emerald-500">{currency}</span>
                  <span className="text-[9px] font-bold uppercase text-emerald-400 ml-auto">{tr("readOnly", lang)}</span>
                </div>
              </div>
              {/* Comparison state: green match vs orange difference */}
              {hasAgreed && !hasDiff && (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
                  <p className="text-[12px] font-black text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 shrink-0" />{tr("matchTitle", lang)}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wide text-emerald-600">{tr("difference", lang)}</span>
                    <span className="text-[13px] font-black font-mono text-emerald-700 tabular-nums">{money(0)} {currency}</span>
                  </div>
                </div>
              )}
              {hasDiff && (
                <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-black text-orange-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />{tr("diffTitle", lang)}</p>
                    <span className="text-[9px] font-black uppercase tracking-wide text-orange-700 bg-orange-200/70 rounded px-1.5 py-0.5 shrink-0">{tr("reasonRequired", lang)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wide text-orange-600">{tr("difference", lang)}</span>
                    <span className="text-[15px] font-black font-mono text-orange-700 tabular-nums">{money(Math.abs(priceDiff))} {currency}</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wide text-orange-700 mb-1">{tr("diffReason", lang)} *</label>
                    <CatalogSelect options={PRICE_DIFFERENCE_REASONS} value={hdr.priceDifferenceReason} lang={lang} placeholder={tr("diffReasonPick", lang)} onChange={(v) => setHdr({ ...hdr, priceDifferenceReason: v })} invalid={!hdr.priceDifferenceReason} />
                  </div>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
              <TotRow label={tr("subtotal", lang)} value={`${money(totals.subtotal)} ${currency}`} />
              <TotAdj label={tr("discount", lang)} v={hdr.discountAmount} onChange={(v) => setHdr({ ...hdr, discountAmount: v })} />
              <TotAdj label={tr("tax", lang)} v={hdr.taxAmount} onChange={(v) => setHdr({ ...hdr, taxAmount: v })} />
              <TotAdj label={tr("additional", lang)} v={hdr.additionalCharges} onChange={(v) => setHdr({ ...hdr, additionalCharges: v })} />
              <div className="border-t border-slate-200 pt-2 flex items-center justify-between">
                <span className="text-[12px] font-black uppercase tracking-wide text-slate-700">{tr("grandTotal", lang)}</span>
                <span className="text-xl font-black font-mono text-slate-900 tabular-nums">{money(totals.grandTotal)} <span className="text-[11px] text-slate-400">{currency}</span></span>
              </div>
              {/* Total Payable mirrors the Grand Total for display — no separate accounting source. */}
              <div className="rounded-lg bg-slate-900 px-3 py-2.5 flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wide text-slate-300">{tr("totalPayable", lang)}</span>
                <span className="text-lg font-black font-mono text-white tabular-nums">{money(totals.grandTotal)} <span className="text-[10px] text-slate-400 font-bold">{currency}</span></span>
              </div>
            </div>
          </div>

          {err && <p className="text-[12px] font-bold text-red-600">{err}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onSaveDraft} disabled={busy || !canSave} className="px-4 py-2.5 bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}{tr("saveDraft", lang)}</button>
            <button onClick={onIssue} disabled={busy || !canSave} className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[13px] font-bold rounded-lg cursor-pointer flex items-center gap-1.5"><Send className="w-4 h-4" />{tr("issue", lang)}</button>
            <button onClick={() => { setCreating(false); resetForm(); setErr(null); }} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 text-[13px] font-bold rounded-lg cursor-pointer">{tr("cancel", lang)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const inp = "w-full text-[12.5px] border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition";

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return <div className={full ? "md:col-span-3" : ""}><label className="block text-[10px] font-black uppercase tracking-wide text-slate-500 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>{children}</div>;
}
function RoField({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return <div><label className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">{label}</label><div className={`text-[13px] font-bold rounded-lg px-2.5 py-2 bg-slate-50 border border-slate-200 ${muted ? "text-slate-400 italic font-semibold" : "text-slate-700"}`}>{value}</div></div>;
}
function InvField({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-[9.5px] font-black uppercase tracking-wide text-slate-400">{label}</div><div className={`text-[13px] mt-0.5 ${strong ? "font-black text-slate-900 font-mono" : "font-bold text-slate-700"}`}>{value}</div></div>;
}
function TotRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between text-[12px]"><span className="text-slate-500 font-semibold">{label}</span><span className="font-mono font-bold text-slate-700 tabular-nums">{value}</span></div>;
}
function TotAdj({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return <div className="flex items-center justify-between gap-2 text-[12px]"><span className="text-slate-500 font-semibold">{label}</span><input type="number" min="0" step="0.01" value={v} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className="w-28 text-[12px] text-right tabular-nums border border-slate-200 rounded-md px-2 py-1 bg-white outline-none focus:border-blue-300" /></div>;
}

/**
 * Controlled dropdown from a catalog; `searchable` adds a filter box; i18n
 * labels. The menu renders in a PORTAL with fixed positioning so it is never
 * clipped by the (scrollable/narrow) invoice-lines table container. `triggerRef`
 * exposes the button so the parent can focus it (add-line UX).
 */
function CatalogSelect({ options, value, lang, placeholder, onChange, searchable, invalid, triggerRef }: { options: CatalogOption[]; value: string; lang: Language; placeholder: string; onChange: (v: string) => void; searchable?: boolean; invalid?: boolean; triggerRef?: (el: HTMLButtonElement | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const place = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width }); };
  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => { if (!btnRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);
  const label = options.find((o) => o.value === value)?.label;
  const filtered = q.trim() ? options.filter((o) => (o.label[lang] || o.label.en).toLowerCase().includes(q.trim().toLowerCase()) || o.value.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <>
      <button ref={(el) => { btnRef.current = el; triggerRef?.(el); }} type="button" onClick={() => setOpen((o) => !o)} className={`${inp} flex items-center justify-between text-left cursor-pointer ${invalid ? "border-red-300" : ""}`}>
        <span className={value ? "font-semibold text-slate-800 truncate" : "text-slate-400 truncate"}>{value ? (label?.[lang] || label?.en || value) : placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: rect.left, top: rect.top, width: Math.max(rect.width, 190), zIndex: 60 }} className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
          {searchable && <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-100"><Search className="w-3.5 h-3.5 text-slate-400 shrink-0" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="…" className="w-full text-[12px] outline-none bg-transparent" /></div>}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((o) => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); setQ(""); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 cursor-pointer border-0 bg-transparent flex items-center justify-between gap-2 text-[12.5px] font-semibold text-slate-700">
                {o.label[lang] || o.label.en}{o.value === value && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
              </button>
            ))}
          </div>
        </div>, document.body)}
    </>
  );
}

/**
 * Bank-account selector reusing the existing bank list. Each option shows bank
 * name, currency and a MASKED account number (last four only) plus the account
 * label — full account numbers are never rendered. Portal-positioned so it is
 * not clipped.
 */
function BankSelect({ banks, value, placeholder, onChange, invalid }: { banks: BankAccount[]; value: string; placeholder: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const place = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width }); };
  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => { if (!btnRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);
  const sel = banks.find((b) => b.id === value);
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)} className={`${inp} flex items-center justify-between text-left cursor-pointer ${invalid ? "border-red-300" : ""}`}>
        {sel ? (
          <span className="min-w-0 truncate"><span className="font-bold text-slate-800">{sel.bankName}</span><span className="text-slate-400 font-semibold"> · {sel.currency}{maskAccount(sel.accountNumber) ? ` · ${maskAccount(sel.accountNumber)}` : ""}</span></span>
        ) : <span className="text-slate-400 truncate">{placeholder}</span>}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: rect.left, top: rect.top, width: Math.max(rect.width, 240), zIndex: 60 }} className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {banks.length === 0 && <div className="px-3 py-3 text-[12px] text-slate-400">—</div>}
            {banks.map((b) => (
              <button key={b.id} type="button" onClick={() => { onChange(b.id); setOpen(false); }} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer border-0 bg-transparent flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-bold text-slate-800 truncate">{b.bankName}</span>
                  <span className="block text-[10.5px] font-semibold text-slate-400 mt-0.5">{b.currency}{maskAccount(b.accountNumber) ? ` · ${maskAccount(b.accountNumber)}` : ""}{b.accountHolderName ? ` · ${b.accountHolderName}` : ""}</span>
                </span>
                {b.id === value && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />}
              </button>
            ))}
          </div>
        </div>, document.body)}
    </>
  );
}
