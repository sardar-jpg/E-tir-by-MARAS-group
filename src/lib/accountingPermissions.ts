/**
 * accountingPermissions.ts — the SINGLE source of truth for granular
 * accounting permissions (PR #140 review increment 4).
 *
 * One typed registry of canonical permission keys + one resolver
 * (resolveEffectivePermissions / hasPermission). There is no second
 * permission system: every UI show/hide and every server route derives from
 * this module. Super Admin always has all permissions; other employees get
 * only their explicitly-saved permissions, with a safe legacy default set for
 * accounts-role employees that have never been configured. Pure: no clock,
 * db, or session.
 */

// ── Canonical permission keys (never duplicated as string literals elsewhere) ──
export const ACCOUNTING_PERMISSION_KEYS = [
  "accounting.view",
  "costs.view", "costs.create", "costs.edit", "costs.deleteDraft", "costs.approve", "costs.reopen", "costs.manageApprovalWorkflow",
  "accounting.financialClose", "accounting.financialReopen",
  "vendorPayments.view", "vendorPayments.create", "vendorPayments.reverse", "vendorPayments.printVoucher",
  "invoices.view", "invoices.create", "invoices.editDraft", "invoices.issue", "invoices.cancel", "invoices.print",
  "customerPayments.view", "customerPayments.create", "customerPayments.allocate", "customerPayments.reverse",
  "receipts.view", "receipts.create", "receipts.print",
  "customerStatements.view", "customerStatements.export",
  "reports.view", "reports.export", "profitReports.view", "cashReports.view",
  "costStatements.print",
  "bankAccounts.view", "bankAccounts.manage",
  "accountingTemplates.view", "accountingTemplates.manage", "accountingTemplates.publish", "accountingTemplates.restore",
  "accountingCompanyProfile.view", "accountingCompanyProfile.manage", "accountingCompanyProfile.restore",
  "accountingAttachments.view", "accountingAttachments.upload", "accountingAttachments.remove",
  "accountingRepair.view", "accountingRepair.execute",
  "accountingAudit.view",
  "audit.view", "audit.export", "audit.viewSensitive", "audit.runReconciliation", "audit.executeRepair",
] as const;

export type AccountingPermission = (typeof ACCOUNTING_PERMISSION_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(ACCOUNTING_PERMISSION_KEYS);

/** True when `key` is a recognized accounting permission (unknown values ignored). */
export function isKnownAccountingPermission(key: unknown): key is AccountingPermission {
  return typeof key === "string" && KEY_SET.has(key);
}

// ── UI grouping + trilingual labels (never show raw keys to the user) ──
export interface PermissionGroup {
  id: string;
  label: { en: string; ar: string; tr: string };
  permissions: Array<{ key: AccountingPermission; label: { en: string; ar: string; tr: string } }>;
}

const p = (key: AccountingPermission, en: string, ar: string, tr: string) => ({ key, label: { en, ar, tr } });

export const ACCOUNTING_PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "overview", label: { en: "Accounting Overview", ar: "نظرة عامة على المحاسبة", tr: "Muhasebe Genel Bakış" },
    permissions: [p("accounting.view", "Open accounting", "فتح المحاسبة", "Muhasebeyi aç")],
  },
  {
    id: "costs", label: { en: "Costs", ar: "التكاليف", tr: "Maliyetler" },
    permissions: [
      p("costs.view", "View cost statements", "عرض كشوف التكاليف", "Maliyet tablolarını görüntüle"),
      p("costs.create", "Create costs", "إنشاء التكاليف", "Maliyet oluştur"),
      p("costs.edit", "Edit costs", "تعديل التكاليف", "Maliyetleri düzenle"),
      p("costs.deleteDraft", "Delete draft cost line", "حذف بند تكلفة مسودة", "Taslak maliyet satırını sil"),
      p("costs.approve", "Approve costs", "اعتماد التكاليف", "Maliyetleri onayla"),
      p("costs.reopen", "Reopen closed costs", "إعادة فتح التكاليف المغلقة", "Kapalı maliyetleri yeniden aç"),
      p("costs.manageApprovalWorkflow", "Manage cost approval workflow", "إدارة سير عمل اعتماد التكلفة", "Maliyet onay iş akışını yönet"),
      p("accounting.financialClose", "Financially close a shipment", "الإغلاق المالي للشحنة", "Sevkiyatı mali olarak kapat"),
      p("accounting.financialReopen", "Request/decide Financial Reopen", "طلب/إقرار إعادة الفتح المالي", "Mali yeniden açmayı iste/karara bağla"),
      p("costStatements.print", "Print cost statement", "طباعة كشف التكاليف", "Maliyet tablosunu yazdır"),
    ],
  },
  {
    id: "vendorPayments", label: { en: "Vendor Payments", ar: "مدفوعات الموردين", tr: "Tedarikçi Ödemeleri" },
    permissions: [
      p("vendorPayments.view", "View vendor payments", "عرض مدفوعات الموردين", "Tedarikçi ödemelerini görüntüle"),
      p("vendorPayments.create", "Record vendor payment", "تسجيل دفعة مورد", "Tedarikçi ödemesi kaydet"),
      p("vendorPayments.reverse", "Reverse vendor payment", "عكس دفعة مورد", "Tedarikçi ödemesini geri al"),
      p("vendorPayments.printVoucher", "Print vendor voucher", "طباعة سند المورد", "Tedarikçi fişi yazdır"),
    ],
  },
  {
    id: "invoices", label: { en: "Customer Invoices", ar: "فواتير العملاء", tr: "Müşteri Faturaları" },
    permissions: [
      p("invoices.view", "View invoices", "عرض الفواتير", "Faturaları görüntüle"),
      p("invoices.create", "Create invoice", "إنشاء فاتورة", "Fatura oluştur"),
      p("invoices.editDraft", "Edit draft invoice", "تعديل فاتورة مسودة", "Taslak faturayı düzenle"),
      p("invoices.issue", "Issue invoice", "إصدار الفاتورة", "Faturayı düzenle/onayla"),
      p("invoices.cancel", "Cancel invoice", "إلغاء الفاتورة", "Faturayı iptal et"),
      p("invoices.print", "Print invoice", "طباعة الفاتورة", "Faturayı yazdır"),
    ],
  },
  {
    id: "customerPayments", label: { en: "Customer Payments", ar: "مدفوعات العملاء", tr: "Müşteri Ödemeleri" },
    permissions: [
      p("customerPayments.view", "View customer payments", "عرض مدفوعات العملاء", "Müşteri ödemelerini görüntüle"),
      p("customerPayments.create", "Record customer payment", "تسجيل دفعة عميل", "Müşteri ödemesi kaydet"),
      p("customerPayments.allocate", "Allocate payment", "تخصيص الدفعة", "Ödemeyi tahsis et"),
      p("customerPayments.reverse", "Reverse customer payment", "عكس دفعة عميل", "Müşteri ödemesini geri al"),
    ],
  },
  {
    id: "receipts", label: { en: "Receipts", ar: "الإيصالات", tr: "Makbuzlar" },
    permissions: [
      p("receipts.view", "View receipts", "عرض الإيصالات", "Makbuzları görüntüle"),
      p("receipts.create", "Create receipt", "إنشاء إيصال", "Makbuz oluştur"),
      p("receipts.print", "Print receipt", "طباعة الإيصال", "Makbuzu yazdır"),
    ],
  },
  {
    id: "customerStatements", label: { en: "Customer Statements", ar: "كشوف حسابات العملاء", tr: "Müşteri Ekstreleri" },
    permissions: [
      p("customerStatements.view", "View customer statements", "عرض كشوف الحسابات", "Müşteri ekstrelerini görüntüle"),
      p("customerStatements.export", "Export customer statements", "تصدير كشوف الحسابات", "Müşteri ekstrelerini dışa aktar"),
    ],
  },
  {
    id: "reports", label: { en: "Financial Reports", ar: "التقارير المالية", tr: "Mali Raporlar" },
    permissions: [
      p("reports.view", "View financial reports", "عرض التقارير المالية", "Mali raporları görüntüle"),
      p("reports.export", "Export financial reports", "تصدير التقارير المالية", "Mali raporları dışa aktar"),
      p("profitReports.view", "View Official Profit reports", "عرض تقارير الربح الرسمي", "Resmî kâr raporlarını görüntüle"),
      p("cashReports.view", "View cash movement reports", "عرض تقارير الحركة النقدية", "Nakit hareket raporlarını görüntüle"),
    ],
  },
  {
    id: "bankAccounts", label: { en: "Bank Accounts", ar: "الحسابات البنكية", tr: "Banka Hesapları" },
    permissions: [
      p("bankAccounts.view", "View bank accounts", "عرض الحسابات البنكية", "Banka hesaplarını görüntüle"),
      p("bankAccounts.manage", "Manage bank accounts", "إدارة الحسابات البنكية", "Banka hesaplarını yönet"),
    ],
  },
  {
    id: "templates", label: { en: "Templates", ar: "القوالب", tr: "Şablonlar" },
    permissions: [
      p("accountingTemplates.view", "View templates", "عرض القوالب", "Şablonları görüntüle"),
      p("accountingTemplates.manage", "Manage templates", "إدارة القوالب", "Şablonları yönet"),
      p("accountingTemplates.publish", "Publish template version", "نشر إصدار قالب", "Şablon sürümü yayınla"),
      p("accountingTemplates.restore", "Restore template version", "استعادة إصدار قالب", "Şablon sürümünü geri yükle"),
    ],
  },
  {
    id: "companyProfile", label: { en: "Company Profile", ar: "ملف الشركة", tr: "Şirket Profili" },
    permissions: [
      p("accountingCompanyProfile.view", "View company profile", "عرض ملف الشركة", "Şirket profilini görüntüle"),
      p("accountingCompanyProfile.manage", "Manage company profile", "إدارة ملف الشركة", "Şirket profilini yönet"),
      p("accountingCompanyProfile.restore", "Restore company profile", "استعادة ملف الشركة", "Şirket profilini geri yükle"),
    ],
  },
  {
    id: "attachments", label: { en: "Accounting Attachments", ar: "مرفقات المحاسبة", tr: "Muhasebe Ekleri" },
    permissions: [
      p("accountingAttachments.view", "View attachments", "عرض المرفقات", "Ekleri görüntüle"),
      p("accountingAttachments.upload", "Upload attachment", "رفع مرفق", "Ek yükle"),
      p("accountingAttachments.remove", "Remove attachment", "إزالة مرفق", "Eki kaldır"),
    ],
  },
  {
    id: "repairAudit", label: { en: "Repair and Audit", ar: "الإصلاح والتدقيق", tr: "Onarım ve Denetim" },
    permissions: [
      p("accountingRepair.view", "View ledger repair results", "عرض نتائج إصلاح السجلات", "Defter onarım sonuçlarını görüntüle"),
      p("accountingRepair.execute", "Execute ledger repair", "تنفيذ إصلاح السجلات", "Defter onarımını çalıştır"),
      p("accountingAudit.view", "View accounting audit", "عرض تدقيق المحاسبة", "Muhasebe denetimini görüntüle"),
    ],
  },
  {
    id: "auditLog", label: { en: "Audit Log", ar: "سجل التدقيق", tr: "Denetim Günlüğü" },
    permissions: [
      p("audit.view", "View audit log", "عرض سجل التدقيق", "Denetim günlüğünü görüntüle"),
      p("audit.viewSensitive", "View masked before/after detail", "عرض التفاصيل قبل/بعد المقنّعة", "Maskeli öncesi/sonrası ayrıntıyı görüntüle"),
      p("audit.export", "Export audit log", "تصدير سجل التدقيق", "Denetim günlüğünü dışa aktar"),
      p("audit.runReconciliation", "Run reconciliation", "تشغيل التسوية", "Mutabakatı çalıştır"),
      p("audit.executeRepair", "Execute reconciliation repair", "تنفيذ إصلاح التسوية", "Mutabakat onarımını çalıştır"),
    ],
  },
];

// ── Legacy accounts-role defaults (only when NO explicit permissions exist) ──
// A safe operational set — everything an accounts admin has always been able
// to do — but NOT the sensitive actions, which require explicit Super Admin
// grant. Explicit permissions, when present, are authoritative instead.
export const LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS: readonly AccountingPermission[] = [
  "accounting.view",
  "costs.view", "costs.create", "costs.edit",
  "vendorPayments.view", "vendorPayments.create", "vendorPayments.printVoucher",
  "invoices.view", "invoices.create", "invoices.editDraft", "invoices.issue", "invoices.print",
  "customerPayments.view", "customerPayments.create", "customerPayments.allocate",
  "receipts.view", "receipts.create", "receipts.print",
  "customerStatements.view", "customerStatements.export",
  "reports.view", "reports.export",
  "costStatements.print",
  "bankAccounts.view",
  "accountingTemplates.view",
  "accountingCompanyProfile.view",
  "accountingAttachments.view", "accountingAttachments.upload",
  "accountingRepair.view",
  "audit.view",
];

// Sensitive permissions NEVER granted by the legacy default (documented +
// asserted): they require explicit Super Admin approval.
export const SENSITIVE_ACCOUNTING_PERMISSIONS: readonly AccountingPermission[] = [
  "costs.approve", "costs.reopen", "costs.manageApprovalWorkflow",
  "accounting.financialClose", "accounting.financialReopen",
  "profitReports.view", "cashReports.view",
  "vendorPayments.reverse",
  "customerPayments.reverse",
  "invoices.cancel",
  "bankAccounts.manage",
  "accountingTemplates.manage", "accountingTemplates.publish", "accountingTemplates.restore",
  "accountingCompanyProfile.manage", "accountingCompanyProfile.restore",
  "accountingAttachments.remove",
  "accountingRepair.execute",
  "accountingAudit.view",
  "audit.viewSensitive", "audit.export", "audit.runReconciliation", "audit.executeRepair",
];

/** The subject whose permissions we resolve (a subset of the admin record). */
export interface PermissionSubject {
  role?: string;
  adminType?: string;
  active?: boolean;
  permissions?: unknown;
}

/**
 * Keep only recognized permission keys from arbitrary input (for storage on
 * save + resolution). Unknown values are dropped; duplicates removed.
 */
export function sanitizeAccountingPermissions(input: unknown): AccountingPermission[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<AccountingPermission>();
  for (const v of input) if (isKnownAccountingPermission(v)) out.add(v);
  return [...out];
}

/**
 * Resolve the EFFECTIVE accounting permissions for a subject:
 *   - non-admin, or explicitly disabled (active === false) → NONE
 *   - Super Admin → ALL (bypass)
 *   - an explicit permissions ARRAY (even empty) → authoritative (sanitized)
 *   - otherwise, accounts role → the legacy default set
 *   - otherwise (e.g. operation) → NONE
 * Missing/garbage permission data therefore denies safely.
 */
export function resolveEffectivePermissions(subject: PermissionSubject | null | undefined): Set<AccountingPermission> {
  if (!subject || subject.role !== "admin") return new Set();
  if (subject.active === false) return new Set();
  if (subject.adminType === "super") return new Set(ACCOUNTING_PERMISSION_KEYS);
  if (Array.isArray(subject.permissions)) return new Set(sanitizeAccountingPermissions(subject.permissions));
  if (subject.adminType === "accounts") return new Set(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS);
  return new Set();
}

/** Whether a subject holds a specific accounting permission. */
export function hasPermission(subject: PermissionSubject | null | undefined, key: AccountingPermission): boolean {
  return resolveEffectivePermissions(subject).has(key);
}

/** Added/removed keys between two permission sets (for the audit log). */
export function diffPermissions(before: unknown, after: unknown): { added: AccountingPermission[]; removed: AccountingPermission[] } {
  const b = new Set(sanitizeAccountingPermissions(before));
  const a = new Set(sanitizeAccountingPermissions(after));
  return {
    added: [...a].filter((k) => !b.has(k)),
    removed: [...b].filter((k) => !a.has(k)),
  };
}
