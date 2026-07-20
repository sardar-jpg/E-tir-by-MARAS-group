/**
 * expenseTypes.ts — the single source of truth for shipment expense (cost line)
 * categories used by the Cost Statement Add Expense flow.
 *
 * This is a UI/data-entry constant only: `costType` is still stored server-side
 * as a free string (see costStatementItem.ts / buildCostItemFromInput), so
 * historical records with any legacy free-text type keep rendering unchanged.
 * New records are constrained to this controlled list in the UI — with the
 * single `Other` escape hatch that lets a user type a custom category. No
 * server, accounting, or storage behaviour changes.
 */
export type L3 = { en: string; ar: string; tr: string };

/** The sentinel value used when the user needs a category outside the list. */
export const EXPENSE_TYPE_OTHER = "Other";

export interface ExpenseTypeOption {
  /** The canonical value persisted in CostItem.costType (English, stable). */
  value: string;
  label: L3;
}

/**
 * Controlled expense categories. English `value` is what gets stored (matching
 * the existing free-text convention); labels are for display only.
 */
export const EXPENSE_TYPES: ExpenseTypeOption[] = [
  { value: "Freight", label: { en: "Freight", ar: "الشحن", tr: "Navlun" } },
  { value: "Land Freight", label: { en: "Land Freight", ar: "الشحن البري", tr: "Kara Taşımacılığı" } },
  { value: "Sea Freight", label: { en: "Sea Freight", ar: "الشحن البحري", tr: "Deniz Taşımacılığı" } },
  { value: "Air Freight", label: { en: "Air Freight", ar: "الشحن الجوي", tr: "Hava Taşımacılığı" } },
  { value: "Customs Clearance", label: { en: "Customs Clearance", ar: "التخليص الجمركي", tr: "Gümrük Müşavirliği" } },
  { value: "Customs Duty", label: { en: "Customs Duty", ar: "الرسوم الجمركية", tr: "Gümrük Vergisi" } },
  { value: "Port Charges", label: { en: "Port Charges", ar: "رسوم الميناء", tr: "Liman Ücretleri" } },
  { value: "Border Fees", label: { en: "Border Fees", ar: "رسوم الحدود", tr: "Sınır Ücretleri" } },
  { value: "Loading", label: { en: "Loading", ar: "التحميل", tr: "Yükleme" } },
  { value: "Unloading", label: { en: "Unloading", ar: "التفريغ", tr: "Boşaltma" } },
  { value: "Storage", label: { en: "Storage", ar: "التخزين", tr: "Depolama" } },
  { value: "Demurrage", label: { en: "Demurrage", ar: "غرامة التأخير", tr: "Demeraj" } },
  { value: "Detention", label: { en: "Detention", ar: "احتجاز الحاويات", tr: "Konteyner Bekleme" } },
  { value: "Handling", label: { en: "Handling", ar: "المناولة", tr: "Elleçleme" } },
  { value: "Documentation", label: { en: "Documentation", ar: "التوثيق", tr: "Dokümantasyon" } },
  { value: "Inspection", label: { en: "Inspection", ar: "الفحص", tr: "Muayene" } },
  { value: "Insurance", label: { en: "Insurance", ar: "التأمين", tr: "Sigorta" } },
  { value: "Driver Allowance", label: { en: "Driver Allowance", ar: "بدل السائق", tr: "Sürücü Harcırahı" } },
  { value: "Fuel", label: { en: "Fuel", ar: "الوقود", tr: "Yakıt" } },
  { value: "Toll Fees", label: { en: "Toll Fees", ar: "رسوم الطرق", tr: "Geçiş Ücretleri" } },
  { value: "Local Transportation", label: { en: "Local Transportation", ar: "النقل المحلي", tr: "Yerel Taşıma" } },
  { value: "Agency Fee", label: { en: "Agency Fee", ar: "رسوم الوكالة", tr: "Acente Ücreti" } },
  { value: "Bank Charges", label: { en: "Bank Charges", ar: "رسوم بنكية", tr: "Banka Masrafları" } },
  { value: EXPENSE_TYPE_OTHER, label: { en: "Other", ar: "أخرى", tr: "Diğer" } },
];

/** True when `value` is exactly the "Other" sentinel. */
export const isOtherExpenseType = (value: string): boolean => value === EXPENSE_TYPE_OTHER;

/** True when `value` is one of the controlled options (including "Other"). */
export const isKnownExpenseType = (value: string): boolean => EXPENSE_TYPES.some((t) => t.value === value);
