/**
 * invoiceLineCatalog.ts — the single source of truth for the controlled lists
 * used by customer-invoice LINES: service types, units, and payment terms.
 *
 * These are UI/data-entry vocabularies. The values stored on an invoice line
 * are free strings server-side (so any legacy/custom value keeps rendering);
 * the UI simply constrains NEW entry to these lists, with an `Other` escape
 * hatch that permits a single custom free-text value.
 */
export type L3 = { en: string; ar: string; tr: string };
export interface CatalogOption { value: string; label: L3 }

export const SERVICE_TYPE_OTHER = "Other";
export const UNIT_OTHER = "Other";

/** Controlled customer-invoice service types. English `value` is persisted. */
export const INVOICE_SERVICE_TYPES: CatalogOption[] = [
  { value: "Sea Freight", label: { en: "Sea Freight", ar: "الشحن البحري", tr: "Deniz Taşımacılığı" } },
  { value: "Air Freight", label: { en: "Air Freight", ar: "الشحن الجوي", tr: "Hava Taşımacılığı" } },
  { value: "Land Freight", label: { en: "Land Freight", ar: "الشحن البري", tr: "Kara Taşımacılığı" } },
  { value: "Local Transportation", label: { en: "Local Transportation", ar: "النقل المحلي", tr: "Yerel Taşıma" } },
  { value: "International Transportation", label: { en: "International Transportation", ar: "النقل الدولي", tr: "Uluslararası Taşıma" } },
  { value: "Customs Clearance", label: { en: "Customs Clearance", ar: "التخليص الجمركي", tr: "Gümrük Müşavirliği" } },
  { value: "Customs Duty", label: { en: "Customs Duty", ar: "الرسوم الجمركية", tr: "Gümrük Vergisi" } },
  { value: "Port Handling", label: { en: "Port Handling", ar: "مناولة الميناء", tr: "Liman Elleçleme" } },
  { value: "Terminal Handling", label: { en: "Terminal Handling", ar: "مناولة المحطة", tr: "Terminal Elleçleme" } },
  { value: "Documentation Fee", label: { en: "Documentation Fee", ar: "رسوم التوثيق", tr: "Dokümantasyon Ücreti" } },
  { value: "Agency Fee", label: { en: "Agency Fee", ar: "رسوم الوكالة", tr: "Acente Ücreti" } },
  { value: "Storage", label: { en: "Storage", ar: "التخزين", tr: "Depolama" } },
  { value: "Warehousing", label: { en: "Warehousing", ar: "الإيداع بالمستودع", tr: "Depoculuk" } },
  { value: "Demurrage", label: { en: "Demurrage", ar: "غرامة التأخير", tr: "Demeraj" } },
  { value: "Detention", label: { en: "Detention", ar: "احتجاز الحاويات", tr: "Konteyner Bekleme" } },
  { value: "Loading", label: { en: "Loading", ar: "التحميل", tr: "Yükleme" } },
  { value: "Unloading", label: { en: "Unloading", ar: "التفريغ", tr: "Boşaltma" } },
  { value: "Inspection", label: { en: "Inspection", ar: "الفحص", tr: "Muayene" } },
  { value: "Insurance", label: { en: "Insurance", ar: "التأمين", tr: "Sigorta" } },
  { value: "Delivery Service", label: { en: "Delivery Service", ar: "خدمة التوصيل", tr: "Teslimat Hizmeti" } },
  { value: "Border Charges", label: { en: "Border Charges", ar: "رسوم الحدود", tr: "Sınır Ücretleri" } },
  { value: "Courier Service", label: { en: "Courier Service", ar: "خدمة البريد السريع", tr: "Kurye Hizmeti" } },
  { value: SERVICE_TYPE_OTHER, label: { en: "Other", ar: "أخرى", tr: "Diğer" } },
];

/** Controlled units of measure for invoice lines. English `value` is persisted. */
export const INVOICE_UNITS: CatalogOption[] = [
  { value: "Shipment", label: { en: "Shipment", ar: "شحنة", tr: "Sevkiyat" } },
  { value: "Container", label: { en: "Container", ar: "حاوية", tr: "Konteyner" } },
  { value: "Truck", label: { en: "Truck", ar: "شاحنة", tr: "Kamyon" } },
  { value: "Trip", label: { en: "Trip", ar: "رحلة", tr: "Sefer" } },
  { value: "Service", label: { en: "Service", ar: "خدمة", tr: "Hizmet" } },
  { value: "Package", label: { en: "Package", ar: "طرد", tr: "Paket" } },
  { value: "Pallet", label: { en: "Pallet", ar: "منصة", tr: "Palet" } },
  { value: "Ton", label: { en: "Ton", ar: "طن", tr: "Ton" } },
  { value: "Kilogram", label: { en: "Kilogram", ar: "كيلوغرام", tr: "Kilogram" } },
  { value: "Cubic Meter", label: { en: "Cubic Meter", ar: "متر مكعب", tr: "Metreküp" } },
  { value: "Day", label: { en: "Day", ar: "يوم", tr: "Gün" } },
  { value: "Hour", label: { en: "Hour", ar: "ساعة", tr: "Saat" } },
  { value: "Item", label: { en: "Item", ar: "عنصر", tr: "Kalem" } },
  { value: UNIT_OTHER, label: { en: "Other", ar: "أخرى", tr: "Diğer" } },
];

/** Controlled payment terms. `Custom` allows a custom due date / term label. */
export const PAYMENT_TERM_CUSTOM = "Custom";
export const PAYMENT_TERMS: CatalogOption[] = [
  { value: "Due on receipt", label: { en: "Due on receipt", ar: "مستحق عند الاستلام", tr: "Teslimde ödenir" } },
  { value: "7 days", label: { en: "7 days", ar: "7 أيام", tr: "7 gün" } },
  { value: "15 days", label: { en: "15 days", ar: "15 يومًا", tr: "15 gün" } },
  { value: "30 days", label: { en: "30 days", ar: "30 يومًا", tr: "30 gün" } },
  { value: "45 days", label: { en: "45 days", ar: "45 يومًا", tr: "45 gün" } },
  { value: "60 days", label: { en: "60 days", ar: "60 يومًا", tr: "60 gün" } },
  { value: PAYMENT_TERM_CUSTOM, label: { en: "Custom", ar: "مخصص", tr: "Özel" } },
];

/** The suggested price-difference reasons (used when the grand total ≠ agreed price). */
export const PRICE_DIFFERENCE_REASONS: CatalogOption[] = [
  { value: "Additional customer-approved service", label: { en: "Additional customer-approved service", ar: "خدمة إضافية بموافقة العميل", tr: "Müşteri onaylı ek hizmet" } },
  { value: "Partial invoice", label: { en: "Partial invoice", ar: "فاتورة جزئية", tr: "Kısmi fatura" } },
  { value: "Extra port charge", label: { en: "Extra port charge", ar: "رسوم ميناء إضافية", tr: "Ek liman ücreti" } },
  { value: "Revised commercial agreement", label: { en: "Revised commercial agreement", ar: "اتفاق تجاري مُعدّل", tr: "Revize edilmiş ticari anlaşma" } },
  { value: "Other", label: { en: "Other", ar: "أخرى", tr: "Diğer" } },
];

export const isOtherServiceType = (v: string): boolean => v === SERVICE_TYPE_OTHER;
export const isOtherUnit = (v: string): boolean => v === UNIT_OTHER;
export const isCustomPaymentTerm = (v: string): boolean => v === PAYMENT_TERM_CUSTOM;

/** Map a controlled payment term to a net day count (Custom / unknown → null). */
export const paymentTermDays = (term: string): number | null => {
  if (term === "Due on receipt") return 0;
  const m = /^(\d+)\s*days$/.exec(term);
  return m ? Number(m[1]) : null;
};
