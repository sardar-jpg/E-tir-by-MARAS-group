import type { Language, ShipmentStatus } from "../types";

/**
 * Display labels for every ShipmentStatus, keyed by the exact English
 * value stored on the record (that value stays the canonical status used
 * everywhere for comparisons, filters, and API payloads — only the
 * rendered TEXT is localized here). Added for PR #155 QA follow-up:
 * ShipmentStatusBadge previously rendered the raw English status string
 * regardless of the selected language, which meant "Accepted" / "In
 * Transit" / "Customs Clearance" stayed English even in Arabic and
 * Turkish dashboards.
 */
const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, Record<Language, string>> = {
  New: { en: "New", tr: "Yeni", ar: "جديد" },
  "Waiting for Driver Quotes": { en: "Waiting for Quotes", tr: "Teklif Bekleniyor", ar: "بانتظار عروض الأسعار" },
  Assigned: { en: "Assigned", tr: "Atanmış", ar: "مُعيّن" },
  Accepted: { en: "Accepted", tr: "Kabul Edildi", ar: "مقبول" },
  Loading: { en: "Loading", tr: "Yükleniyor", ar: "جارٍ التحميل" },
  Loaded: { en: "Loaded", tr: "Yüklendi", ar: "تم التحميل" },
  "In Transit": { en: "In Transit", tr: "Yolda", ar: "قيد النقل" },
  "Border Crossing": { en: "Border Crossing", tr: "Sınır Geçişi", ar: "عبور الحدود" },
  "Customs Clearance": { en: "Customs Clearance", tr: "Gümrük İşlemleri", ar: "التخليص الجمركي" },
  Arrived: { en: "Arrived", tr: "Ulaştı", ar: "وصلت" },
  Delivered: { en: "Delivered", tr: "Teslim Edildi", ar: "تم التسليم" },
  Closed: { en: "Closed", tr: "Kapatıldı", ar: "مغلقة" },
  "Booking Confirmed": { en: "Booking Confirmed", tr: "Rezervasyon Onaylandı", ar: "تم تأكيد الحجز" },
  "Container Released": { en: "Container Released", tr: "Konteyner Serbest Bırakıldı", ar: "تم تحرير الحاوية" },
  "Loaded on Vessel": { en: "Loaded on Vessel", tr: "Gemiye Yüklendi", ar: "تم التحميل على السفينة" },
  "Vessel Departed": { en: "Vessel Departed", tr: "Gemi Hareket Etti", ar: "غادرت السفينة" },
  "Arrived at Port": { en: "Arrived at Port", tr: "Limana Ulaştı", ar: "وصلت إلى الميناء" },
  Released: { en: "Released", tr: "Serbest Bırakıldı", ar: "تم الإفراج" },
  "Out for Delivery": { en: "Out for Delivery", tr: "Dağıtıma Çıktı", ar: "خرجت للتسليم" },
  Completed: { en: "Completed", tr: "Tamamlandı", ar: "مكتمل" },
  "Cargo Received": { en: "Cargo Received", tr: "Kargo Teslim Alındı", ar: "تم استلام البضاعة" },
  "Security Check Completed": { en: "Security Check Completed", tr: "Güvenlik Kontrolü Tamamlandı", ar: "اكتمل الفحص الأمني" },
  "Departed Airport": { en: "Departed Airport", tr: "Havalimanından Ayrıldı", ar: "غادرت المطار" },
  "Arrived Airport": { en: "Arrived Airport", tr: "Havalimanına Ulaştı", ar: "وصلت إلى المطار" },
};

/** Falls back to the raw status string for anything unrecognized, so an unexpected/legacy value never renders blank. */
export function translateShipmentStatus(status: string, lang: Language): string {
  return SHIPMENT_STATUS_LABEL[status as ShipmentStatus]?.[lang] ?? status;
}
