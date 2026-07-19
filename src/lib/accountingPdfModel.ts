/**
 * accountingPdfModel.ts — pure builders that turn saved, server-authoritative
 * accounting records + the configured Company Profile + bank into a single
 * generic render model (AccountingPdfModel) consumed by one renderer
 * (accountingPdfRender.ts). Customer-facing documents STRIP internal cost /
 * profit / vendor data here, so the renderer can never leak it. No clock,
 * db, or session — callers pass everything in.
 *
 * Language/direction: the model carries `language` + `direction`; the
 * renderer lays out RTL or LTR accordingly. (Arabic GLYPH shaping needs an
 * embedded Arabic font — see accountingPdfRender.ts's note; English is full.)
 */
import type {
  CompanyProfile, BankAccount, BankAccountSnapshot, CustomerInvoice, CustomerPayment,
  PaymentReceipt, VendorPaymentTransaction, Currency, Language,
} from "../types";
import type { CustomerAccountStatement } from "./customerAccountStatement";
import { summarizeCustomerAccount } from "./customerPayments";
import { resolveTemplateRender, type TemplateConfig, type TemplateRenderOptions } from "./accountingTemplateConfig";

export type PdfDirection = "ltr" | "rtl";
export interface PdfCompany {
  name: string; address?: string; phone?: string; email?: string; website?: string;
  registration?: string; tax?: string; logoUrl?: string; stampUrl?: string;
  signatureUrl?: string; footerText?: string;
}
export interface PdfBank {
  bankName: string; accountHolderName: string; accountNumber: string;
  iban?: string; swift?: string; currency: string; branch?: string;
}
export interface PdfMetaRow { label: string; value: string }
export interface PdfColumn { key: string; label: string; align?: "left" | "right" }
export interface PdfTotalRow { label: string; value: string; strong?: boolean }
export interface AccountingPdfFlags { showBank: boolean; showSignature: boolean; showStamp: boolean; showPageNumbers: boolean }
export interface AccountingPdfModel {
  docType: "invoice" | "receipt" | "statement" | "voucher" | "cost_statement";
  title: string;
  badge?: { text: string; kind: "draft" | "issued" | "final" | "void" };
  language: Language;
  direction: PdfDirection;
  /** Internal documents (voucher, cost statement) carry this notice banner. */
  internalNotice?: string;
  company: PdfCompany;
  parties: PdfMetaRow[];
  meta: PdfMetaRow[];
  columns?: PdfColumn[];
  rows?: Record<string, string>[];
  totals?: PdfTotalRow[];
  notes?: string;
  paymentTerms?: string;
  bank?: PdfBank | null;
  flags: AccountingPdfFlags;
  footerText?: string;
  /** Controlled template render options (font/sizes/accent/logo) — Phase 11. */
  render?: TemplateRenderOptions;
}

/**
 * Apply a controlled TemplateConfig to a built model: overrides the
 * visibility flags, header/footer/notes/terms text, and attaches the render
 * options (font/sizes/accent/logo). Bounded — see accountingTemplateConfig.
 */
export function applyTemplateToModel(model: AccountingPdfModel, config: TemplateConfig | null | undefined): AccountingPdfModel {
  if (!config) return model;
  return {
    ...model,
    flags: {
      showBank: config.showBank && model.flags.showBank,      // never force a bank block onto docs that never carry one
      showSignature: config.showSignature,
      showStamp: config.showStamp,
      showPageNumbers: config.showPageNumbers,
    },
    notes: config.showNotes ? (model.notes || config.standardNotes) : undefined,
    paymentTerms: config.paymentTerms || model.paymentTerms,
    footerText: config.footerText || model.footerText,
    render: resolveTemplateRender(config),
  };
}

const directionFor = (lang: Language): PdfDirection => (lang === "ar" ? "rtl" : "ltr");
const money = (v: number, currency?: string): string =>
  `${(Number.isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? " " + currency : ""}`;

function companyFrom(profile: CompanyProfile | null | undefined): PdfCompany {
  const p = profile || {};
  return {
    name: p.companyName || p.companyNameEn || "MARAS Group",
    address: p.address, phone: p.phone, email: p.email, website: p.website,
    registration: p.registrationDetails, tax: p.taxDetails,
    logoUrl: p.logoUrl, stampUrl: p.stampUrl, signatureUrl: p.signatureUrl, footerText: p.footerText,
  };
}
function bankFrom(b: BankAccount | BankAccountSnapshot | null | undefined): PdfBank | null {
  if (!b) return null;
  return { bankName: b.bankName, accountHolderName: b.accountHolderName, accountNumber: b.accountNumber, iban: b.iban, swift: b.swift, currency: b.currency, branch: b.branch };
}

// ── i18n label sets (English primary; Arabic/Turkish carried for RTL/LTR) ──
type L3 = { en: string; ar: string; tr: string };
const pick = (l: L3, lang: Language): string => l[lang] || l.en;
const LBL = {
  invoice: { en: "INVOICE", ar: "فاتورة", tr: "FATURA" },
  receipt: { en: "PAYMENT RECEIPT", ar: "إيصال دفع", tr: "ÖDEME MAKBUZU" },
  statement: { en: "ACCOUNT STATEMENT", ar: "كشف حساب", tr: "HESAP EKSTRESİ" },
  voucher: { en: "VENDOR PAYMENT VOUCHER", ar: "سند دفع مورد", tr: "TEDARİKÇİ ÖDEME FİŞİ" },
  draft: { en: "DRAFT", ar: "مسودة", tr: "TASLAK" },
  issued: { en: "ISSUED", ar: "صادر", tr: "DÜZENLENDİ" },
  paid: { en: "PAID", ar: "مدفوع", tr: "ÖDENDİ" },
  void: { en: "VOID", ar: "ملغى", tr: "İPTAL" },
  internal: { en: "INTERNAL — MARAS ACCOUNTING ONLY", ar: "داخلي — محاسبة مراس فقط", tr: "DAHİLİ — YALNIZCA MARAS MUHASEBE" },
  invoiceNo: { en: "Invoice No", ar: "رقم الفاتورة", tr: "Fatura No" },
  receiptNo: { en: "Receipt No", ar: "رقم الإيصال", tr: "Makbuz No" },
  voucherNo: { en: "Voucher No", ar: "رقم السند", tr: "Fiş No" },
  order: { en: "Order (MAR)", ar: "الطلب (MAR)", tr: "Sipariş (MAR)" },
  customer: { en: "Customer", ar: "العميل", tr: "Müşteri" },
  vendor: { en: "Vendor", ar: "المورد", tr: "Tedarikçi" },
  issueDate: { en: "Issue Date", ar: "تاريخ الإصدار", tr: "Düzenlenme Tarihi" },
  paymentDate: { en: "Payment Date", ar: "تاريخ الدفع", tr: "Ödeme Tarihi" },
  dueDate: { en: "Due Date", ar: "تاريخ الاستحقاق", tr: "Vade Tarihi" },
  currency: { en: "Currency", ar: "العملة", tr: "Para Birimi" },
  method: { en: "Method", ar: "الطريقة", tr: "Yöntem" },
  reference: { en: "Reference", ar: "المرجع", tr: "Referans" },
  account: { en: "Account", ar: "الحساب", tr: "Hesap" },
  description: { en: "Description", ar: "الوصف", tr: "Açıklama" },
  qty: { en: "Qty", ar: "الكمية", tr: "Miktar" },
  unit: { en: "Unit", ar: "السعر", tr: "Birim" },
  amount: { en: "Amount", ar: "المبلغ", tr: "Tutar" },
  total: { en: "Total", ar: "الإجمالي", tr: "Toplam" },
  subtotal: { en: "Subtotal", ar: "المجموع الفرعي", tr: "Ara Toplam" },
  paymentTerms: { en: "Payment Terms", ar: "شروط الدفع", tr: "Ödeme Koşulları" },
  notes: { en: "Notes", ar: "ملاحظات", tr: "Notlar" },
  bankDetails: { en: "Bank Details", ar: "التفاصيل المصرفية", tr: "Banka Bilgileri" },
  allocatedTo: { en: "Allocated to invoices", ar: "موزعة على الفواتير", tr: "Faturalara dağıtıldı" },
  advanceCredit: { en: "Advance credit", ar: "رصيد مقدم", tr: "Avans kredi" },
  status: { en: "Status", ar: "الحالة", tr: "Durum" },
  proof: { en: "Payment proof", ar: "إثبات الدفع", tr: "Ödeme kanıtı" },
  remainingPayable: { en: "Remaining payable", ar: "المتبقي المستحق", tr: "Kalan borç" },
  costItem: { en: "Cost item", ar: "بند التكلفة", tr: "Maliyet kalemi" },
  dateRange: { en: "Date Range", ar: "الفترة", tr: "Tarih Aralığı" },
  opening: { en: "Opening balance", ar: "الرصيد الافتتاحي", tr: "Açılış bakiyesi" },
  closing: { en: "Closing balance", ar: "الرصيد الختامي", tr: "Kapanış bakiyesi" },
  debit: { en: "Debit", ar: "مدين", tr: "Borç" },
  credit: { en: "Credit", ar: "دائن", tr: "Alacak" },
  balance: { en: "Balance", ar: "الرصيد", tr: "Bakiye" },
  date: { en: "Date", ar: "التاريخ", tr: "Tarih" },
  generatedOn: { en: "Generated on", ar: "تم الإنشاء في", tr: "Oluşturulma" },
  reversed: { en: "REVERSED", ar: "معكوس", tr: "İPTAL" },
} as const;

const DEFAULT_FLAGS: AccountingPdfFlags = { showBank: true, showSignature: true, showStamp: true, showPageNumbers: true };

// ── Customer Invoice (customer-facing — NO cost/profit) ───────────────────
export function buildInvoicePdfModel(params: {
  invoice: CustomerInvoice; company: CompanyProfile | null; bank: BankAccount | BankAccountSnapshot | null;
  language: Language; nowIso: string; flags?: Partial<AccountingPdfFlags>;
}): AccountingPdfModel {
  const inv = params.invoice;
  const lang = params.language;
  const isDraft = inv.status === "draft";
  return {
    docType: "invoice",
    title: pick(LBL.invoice, lang),
    badge: isDraft ? { text: pick(LBL.draft, lang), kind: "draft" } : inv.status === "cancelled" ? { text: pick(LBL.void, lang), kind: "void" } : { text: pick(LBL.issued, lang), kind: "issued" },
    language: lang, direction: directionFor(lang),
    company: companyFrom(inv.companySnapshot || params.company),
    parties: [{ label: pick(LBL.customer, lang), value: inv.companyName }],
    meta: [
      { label: pick(LBL.invoiceNo, lang), value: inv.invoiceNumber },
      { label: pick(LBL.order, lang), value: inv.shipmentNumber },
      { label: pick(LBL.issueDate, lang), value: (inv.issuedAt || inv.createdAt || params.nowIso).slice(0, 10) },
      { label: pick(LBL.currency, lang), value: inv.currency },
    ],
    columns: [
      { key: "desc", label: pick(LBL.description, lang), align: "left" },
      { key: "qty", label: pick(LBL.qty, lang), align: "right" },
      { key: "unit", label: pick(LBL.unit, lang), align: "right" },
      { key: "amount", label: pick(LBL.amount, lang), align: "right" },
    ],
    rows: [invoiceLineRow(inv, lang)],
    totals: [{ label: `${pick(LBL.total, lang)} (${inv.currency})`, value: money(inv.sellingAmount, inv.currency), strong: true }],
    notes: inv.notes,
    paymentTerms: inv.description && inv.pricingMode !== "manual" ? undefined : undefined,
    bank: bankFrom(inv.bankAccountSnapshot || params.bank),
    flags: { ...DEFAULT_FLAGS, ...params.flags },
    footerText: (inv.companySnapshot || params.company || {}).footerText,
  };
}
function invoiceLineRow(inv: CustomerInvoice, lang: Language): Record<string, string> {
  const perUnit = inv.pricingMode === "per_truck" || inv.pricingMode === "per_container" || inv.pricingMode === "per_service";
  return {
    desc: inv.description || pick(LBL.invoice, lang),
    qty: perUnit && typeof inv.unitQuantity === "number" ? String(inv.unitQuantity) : "1",
    unit: perUnit && typeof inv.unitPrice === "number" ? money(inv.unitPrice) : money(inv.sellingAmount),
    amount: money(inv.sellingAmount),
  };
}

// ── Payment Receipt (customer-facing) ─────────────────────────────────────
export function buildReceiptPdfModel(params: {
  receipt: PaymentReceipt; company: CompanyProfile | null; language: Language; nowIso: string;
  advanceCredit?: number; flags?: Partial<AccountingPdfFlags>;
}): AccountingPdfModel {
  const r = params.receipt;
  const lang = params.language;
  const isVoid = r.status === "void";
  return {
    docType: "receipt",
    title: pick(LBL.receipt, lang),
    badge: isVoid ? { text: pick(LBL.void, lang), kind: "void" } : { text: pick(LBL.paid, lang), kind: "issued" },
    language: lang, direction: directionFor(lang),
    company: companyFrom(r.companySnapshot || params.company),
    parties: [{ label: pick(LBL.customer, lang), value: r.companyName }],
    meta: [
      { label: pick(LBL.receiptNo, lang), value: r.receiptNumber },
      { label: pick(LBL.paymentDate, lang), value: (r.paymentDate || "").slice(0, 10) },
      { label: pick(LBL.method, lang), value: r.paymentMethod || "-" },
      { label: pick(LBL.reference, lang), value: r.reference || "-" },
      { label: pick(LBL.account, lang), value: r.bankAccountSnapshot || "-" },
      { label: pick(LBL.status, lang), value: isVoid ? pick(LBL.void, lang) : pick(LBL.paid, lang) },
    ],
    columns: [
      { key: "inv", label: pick(LBL.invoiceNo, lang), align: "left" },
      { key: "amount", label: pick(LBL.amount, lang), align: "right" },
    ],
    rows: (r.allocations || []).map((a) => ({ inv: a.invoiceNumber, amount: money(a.amount) })),
    totals: [
      { label: `${pick(LBL.amount, lang)} (${r.currency})`, value: money(r.amount, r.currency), strong: true },
      ...(params.advanceCredit && params.advanceCredit > 0 ? [{ label: pick(LBL.advanceCredit, lang), value: money(params.advanceCredit, r.currency) }] : []),
    ],
    notes: isVoid && r.voidReason ? `${pick(LBL.reversed, lang)}: ${r.voidReason}` : undefined,
    bank: null,
    flags: { ...DEFAULT_FLAGS, showBank: false, ...params.flags },
    footerText: (r.companySnapshot || params.company || {}).footerText,
  };
}

// ── Customer Account Statement (customer-facing) ──────────────────────────
export function buildStatementPdfModel(params: {
  statement: CustomerAccountStatement; company: CompanyProfile | null; language: Language; nowIso: string; flags?: Partial<AccountingPdfFlags>;
}): AccountingPdfModel {
  const s = params.statement;
  const lang = params.language;
  return {
    docType: "statement",
    title: pick(LBL.statement, lang),
    language: lang, direction: directionFor(lang),
    company: companyFrom(params.company),
    parties: [{ label: pick(LBL.customer, lang), value: s.companyName }],
    meta: [
      { label: pick(LBL.currency, lang), value: s.currency },
      { label: pick(LBL.dateRange, lang), value: `${s.from || "-"} → ${s.to || "-"}` },
      { label: pick(LBL.opening, lang), value: money(s.openingBalance, s.currency) },
      { label: pick(LBL.generatedOn, lang), value: params.nowIso.slice(0, 10) },
    ],
    columns: [
      { key: "date", label: pick(LBL.date, lang), align: "left" },
      { key: "ref", label: pick(LBL.reference, lang), align: "left" },
      { key: "debit", label: pick(LBL.debit, lang), align: "right" },
      { key: "credit", label: pick(LBL.credit, lang), align: "right" },
      { key: "balance", label: pick(LBL.balance, lang), align: "right" },
    ],
    rows: [
      { date: "", ref: pick(LBL.opening, lang), debit: "", credit: "", balance: money(s.openingBalance) },
      ...s.rows.map((row) => ({ date: row.date, ref: row.ref, debit: row.debit ? money(row.debit) : "", credit: row.credit ? money(row.credit) : "", balance: money(row.balance) })),
    ],
    totals: [{ label: `${pick(LBL.closing, lang)} (${s.currency})`, value: money(s.closingBalance, s.currency), strong: true }],
    bank: null,
    flags: { ...DEFAULT_FLAGS, showBank: false, showSignature: false, showStamp: false, ...params.flags },
    footerText: (params.company || {}).footerText,
  };
}

// ── Vendor Payment Voucher (INTERNAL only) ────────────────────────────────
export function buildVoucherPdfModel(params: {
  payment: VendorPaymentTransaction; company: CompanyProfile | null; language: Language; nowIso: string;
  remainingPayable?: number; costItemDescription?: string; flags?: Partial<AccountingPdfFlags>;
}): AccountingPdfModel {
  const p = params.payment;
  const lang = params.language;
  const isReversed = p.status === "reversed";
  return {
    docType: "voucher",
    title: pick(LBL.voucher, lang),
    badge: isReversed ? { text: pick(LBL.reversed, lang), kind: "void" } : undefined,
    language: lang, direction: directionFor(lang),
    internalNotice: pick(LBL.internal, lang),
    company: companyFrom(params.company),
    parties: [{ label: pick(LBL.vendor, lang), value: p.vendorName || "-" }],
    meta: [
      { label: pick(LBL.voucherNo, lang), value: p.id },
      { label: pick(LBL.order, lang), value: p.shipmentNumber },
      { label: pick(LBL.costItem, lang), value: params.costItemDescription || p.costItemId },
      { label: pick(LBL.paymentDate, lang), value: (p.paymentDate || "").slice(0, 10) },
      { label: pick(LBL.method, lang), value: p.paymentMethod || "-" },
      { label: pick(LBL.account, lang), value: p.bankAccountSnapshot || "-" },
      { label: pick(LBL.reference, lang), value: p.reference || "-" },
      { label: pick(LBL.proof, lang), value: p.attachmentUrl ? (p.attachmentName || "attached") : "-" },
      ...(typeof params.remainingPayable === "number" ? [{ label: pick(LBL.remainingPayable, lang), value: money(params.remainingPayable, p.currency) }] : []),
      ...(isReversed ? [{ label: pick(LBL.status, lang), value: `${pick(LBL.reversed, lang)}${p.reversalReason ? " — " + p.reversalReason : ""}` }] : []),
    ],
    totals: [{ label: `${pick(LBL.amount, lang)} (${p.currency})`, value: money(p.amount, p.currency), strong: true }],
    bank: null,
    flags: { ...DEFAULT_FLAGS, showBank: false, ...params.flags },
    footerText: (params.company || {}).footerText,
  };
}

/** Advance credit for a customer+currency (for the receipt footer). */
export function advanceCreditFor(invoices: CustomerInvoice[], payments: CustomerPayment[], currency: Currency): number {
  const s = summarizeCustomerAccount(invoices, payments).find((x) => x.currency === currency);
  return s ? s.unallocatedCredit : 0;
}

/**
 * A representative SAMPLE model for a document type, for the "preview before
 * saving" Template Settings feature (never persisted). Uses the configured
 * company + placeholder amounts so the user sees layout + branding + toggles.
 */
export function buildSamplePreviewModel(docType: AccountingPdfModel["docType"], company: CompanyProfile | null, language: Language): AccountingPdfModel {
  const c = companyFrom(company);
  const base = { language, direction: directionFor(language), company: c, flags: { ...DEFAULT_FLAGS }, footerText: c.footerText } as const;
  const sampleParty = [{ label: pick(docType === "voucher" ? LBL.vendor : LBL.customer, language), value: docType === "voucher" ? "Sample Vendor Co" : "Sample Customer Co" }];
  if (docType === "receipt") {
    return { ...base, docType, title: pick(LBL.receipt, language), badge: { text: pick(LBL.paid, language), kind: "issued" }, parties: sampleParty,
      meta: [{ label: pick(LBL.receiptNo, language), value: "RCPT-0001" }, { label: pick(LBL.paymentDate, language), value: "2026-07-19" }, { label: pick(LBL.method, language), value: "wire" }],
      columns: [{ key: "inv", label: pick(LBL.invoiceNo, language), align: "left" }, { key: "amount", label: pick(LBL.amount, language), align: "right" }],
      rows: [{ inv: "MAR-2026-1001", amount: "1,500.00" }], totals: [{ label: `${pick(LBL.amount, language)} (USD)`, value: "1,500.00 USD", strong: true }], bank: null };
  }
  if (docType === "statement") {
    return { ...base, docType, title: pick(LBL.statement, language), parties: sampleParty,
      meta: [{ label: pick(LBL.currency, language), value: "USD" }, { label: pick(LBL.dateRange, language), value: "2026-07-01 → 2026-07-31" }],
      columns: [{ key: "date", label: pick(LBL.date, language), align: "left" }, { key: "ref", label: pick(LBL.reference, language), align: "left" }, { key: "debit", label: pick(LBL.debit, language), align: "right" }, { key: "credit", label: pick(LBL.credit, language), align: "right" }, { key: "balance", label: pick(LBL.balance, language), align: "right" }],
      rows: [{ date: "2026-07-05", ref: "MAR-2026-1001", debit: "1,500.00", credit: "", balance: "1,500.00" }, { date: "2026-07-10", ref: "PAY-1", debit: "", credit: "500.00", balance: "1,000.00" }],
      totals: [{ label: `${pick(LBL.closing, language)} (USD)`, value: "1,000.00 USD", strong: true }], bank: null };
  }
  if (docType === "voucher" || docType === "cost_statement") {
    return { ...base, docType, title: pick(docType === "voucher" ? LBL.voucher : LBL.invoice, language), internalNotice: pick(LBL.internal, language), parties: sampleParty,
      meta: [{ label: pick(LBL.order, language), value: "MAR-2026-1001" }, { label: pick(LBL.paymentDate, language), value: "2026-07-19" }, { label: pick(LBL.method, language), value: "wire" }],
      columns: [{ key: "desc", label: pick(LBL.description, language), align: "left" }, { key: "amount", label: pick(LBL.amount, language), align: "right" }],
      rows: [{ desc: "Sample cost line", amount: "4,000.00" }], totals: [{ label: `${pick(LBL.amount, language)} (USD)`, value: "4,000.00 USD", strong: true }], bank: null };
  }
  // invoice (default)
  return { ...base, docType: "invoice", title: pick(LBL.invoice, language), badge: { text: pick(LBL.issued, language), kind: "issued" }, parties: sampleParty,
    meta: [{ label: pick(LBL.invoiceNo, language), value: "MAR-2026-1001" }, { label: pick(LBL.order, language), value: "MAR-2026-1001" }, { label: pick(LBL.issueDate, language), value: "2026-07-19" }, { label: pick(LBL.currency, language), value: "USD" }],
    columns: [{ key: "desc", label: pick(LBL.description, language), align: "left" }, { key: "qty", label: pick(LBL.qty, language), align: "right" }, { key: "unit", label: pick(LBL.unit, language), align: "right" }, { key: "amount", label: pick(LBL.amount, language), align: "right" }],
    rows: [{ desc: "Freight service (sample)", qty: "1", unit: "1,500.00", amount: "1,500.00" }],
    totals: [{ label: `${pick(LBL.total, language)} (USD)`, value: "1,500.00 USD", strong: true }],
    bank: { bankName: "Sample Bank", accountHolderName: c.name, accountNumber: "0000-0000", currency: "USD" } };
}
