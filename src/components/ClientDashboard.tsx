import React, { useState, useEffect, useRef } from "react";
import { Language, Shipment, Driver, DocumentCategory } from "../types";
import {
  Home, Package, MessageSquare, User, Bell, ArrowRight, FileText, Navigation,
  Search, SlidersHorizontal, Truck, Ship, Plane, ChevronRight, ChevronLeft,
  Clock, Scale, Info, RefreshCw, MapPin, CheckCircle2, Paperclip, Send,
  Download, Lock, X, Globe, LifeBuoy, Shield, LogOut, Trash2, ShieldAlert,
  WifiOff, Building2, Mail
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { isNotificationReadForUser, addReaderToNotification } from "../lib/notificationAccess";
import { accountDeletionCopy } from "../lib/accountDeletion";
import ClientShipmentMap from "./ClientShipmentMap";
import { canClientSendChatMessage } from "../lib/clientAccess";
import { validateUpload } from "../lib/uploadValidation";
import { MAX_CHAT_TEXT_LENGTH } from "../lib/chatMessageValidation";
import { canSubmitChatMessage } from "../lib/chatComposerState";
import {
  isShipmentClosed,
  resolveFreightMode,
  getStatusSequenceForFreightMode,
  normalizeStatusForSequence,
  getShipmentStatusLabel,
} from "../lib/shipmentStatusTransitions";
import { shouldShowDateSeparator, formatDateSeparatorLabel, isNearBottom, computeAutoGrowHeightPx } from "../lib/chatDisplay";

// Local multilingual dictionary
const t = {
  en: {
    welcome: "Welcome back,",
    subtitle: "etir Customer Access & Logistics Hub",
    statsTotal: "Total Shipments",
    statsActive: "Active In-Transit",
    statsCompleted: "Deliveries Completed",
    noShipments: "No shipments found matching your account criteria.",
    searchPlaceholder: "Search by Shipment ID, Plate, City, or Cargo...",
    filterAll: "All Cargo Services",
    filterLand: "Land Transport (TIR)",
    filterSea: "Ocean Freight (Sea)",
    filterAir: "Air Express (Air)",
    documents: "Shipment Documents",
    noDocs: "No shipment documents have been shared yet.",
    timeline: "Smart Tracking Progress",
    inquiryTitle: "Logistics Support & Inquiries",
    inquiryDesc: "Submit an inquiry directly to MARAS Operations Support for this shipment.",
    inquirySuccess: "Your inquiry has been logged successfully and forwarded to MARAS dispatchers.",
    inquiryError: "Could not send inquiry. Please try again.",
    inquiryPlaceholder: "Type your operational message or cargo concern...",
    submitInquiry: "Dispatch Support Inquiry",
    attachFile: "Attach a file",
    removeFile: "Remove file",
    uploadingFile: "Uploading...",
    uploadFileError: "File upload failed. Please try again.",
    textTooLongError: `Message is too long (max ${MAX_CHAT_TEXT_LENGTH} characters).`,
    viewMap: "Smart Tracking Map",
    smartTrackingNote: "GPS updates periodically to protect driver battery and app performance.",
    close: "Close Panel",
    eta: "Estimated Arrival (ETA)",
    etd: "Estimated Departure (ETD)",
    shippingLine: "Carrier / Line",
    vessel: "Vessel Name",
    bookingNo: "Booking Ref",
    billOfLading: "Bill of Lading",
    airline: "Flight Carrier",
    waybill: "Air Waybill Number",
    notifsTitle: "Logistics Updates Center",
    markAllRead: "Mark All as Read",
    noNewNotifs: "No recent updates",
    viewShipment: "Track",
    notifications: "Notifications",
    hello: "Hello,",
    currentShipment: "Current shipment",
    trackShipment: "Track Shipment",
    details: "Details",
    lastUpdate: "Last update",
    step: "Step",
    of: "of",
    statTotal: "Total",
    statActive: "In Transit",
    statDelivered: "Delivered",
    earlierShipments: "Earlier shipments",
    navHome: "Home",
    navShipments: "Shipments",
    navChat: "Chat",
    navProfile: "Profile",
    segAll: "All",
    segActive: "In Transit",
    segDelivered: "Delivered",
    segCancelled: "Cancelled",
    loadOlder: "Load older shipments",
    loading: "Loading…",
    searchFilter: "Search & Filter",
    reset: "Reset",
    searchPlaceholderShort: "Search by number, city, route",
    freightType: "Freight type",
    filterAllShort: "All",
    status: "Status",
    showResults: "Show results",
    mode_land: "Land · TIR",
    mode_sea: "Sea · Container",
    mode_air: "Air · Express",
    shipmentDetails: "Shipment Details",
    tabOverview: "Overview",
    tabTracking: "Tracking",
    cargo: "Cargo",
    weight: "Weight",
    freightTypeLabel: "Freight type",
    truck: "Truck",
    created: "Created",
    filesInChatNote: "Documents like the CMR and packing list are shared with you inside Chat.",
    openChat: "Open Shipment Chat",
    live: "Live",
    estArrival: "Est. arrival",
    sharedByMaras: "Shared by MARAS",
    viewTimeline: "View full timeline",
    journeyProgress: "Journey Progress",
    confirmedSteps: "Confirmed steps only",
    pending: "Pending",
    chatEmpty: "No messages yet. Send a message to MARAS Operations.",
    chatClosed: "This shipment is closed. Messages can no longer be sent.",
    chatViewOnly: "View-only account — sending messages is disabled.",
    messagePlaceholder: "Message MARAS…",
    attachment: "Attachment",
    companyInfo: "Company Information",
    notifSettings: "Notification Settings",
    language: "Language",
    help: "Help & Support",
    about: "About eTIR by MARAS",
    privacy: "Privacy Policy",
    signOut: "Sign Out",
    deleteAccount: "Delete account",
    verified: "Verified account",
    clientStaff: "Client Staff",
    customerApp: "Customer App",
    companyName: "Company",
    email: "Email",
    companyInfoNote: "Company details are managed by MARAS Operations. Contact support to update them.",
    soundAlerts: "Sound alerts",
    soundAlertsNote: "Play a sound for new shipment updates",
    notifSettingsNote: "You'll always receive shipment status updates, messages and shared files as notifications.",
    languageNote: "The whole app switches immediately, including right-to-left layout for Arabic.",
    unread: "unread updates",
    markAllReadShort: "Mark all read",
    emptyShipmentsTitle: "No shipments yet",
    emptyShipmentsSub: "When MARAS creates a shipment for your company, it will appear here with live tracking and chat.",
    emptyNotifTitle: "You're all caught up",
    emptyNotifSub: "New updates about your shipments — status changes, messages and files — will show up here.",
    emptyResultsTitle: "No shipments found",
    emptyResultsSub: "We couldn't find anything matching your search. Try a different number, city, or route.",
    emptyOfflineTitle: "You're offline",
    emptyOfflineSub: "We can't reach MARAS right now. Your last synced information is still available.",
    emptyGpsTitle: "Live location unavailable",
    emptyGpsSub: "The driver's GPS is off or out of range. Tracking resumes automatically when a new position is received.",
    track: "Track"
  },
  tr: {
    welcome: "Tekrar hoş geldiniz,",
    subtitle: "etir Müşteri Erişim & Lojistik Portalı",
    statsTotal: "Toplam Sevkiyat",
    statsActive: "Aktif Taşıma",
    statsCompleted: "Tamamlanan Teslimat",
    noShipments: "Hesap kriterlerinize uygun sevkiyat bulunamadı.",
    searchPlaceholder: "Sevkiyat No, Plaka, Şehir veya Yük ile ara...",
    filterAll: "Tüm Kargo Hizmetleri",
    filterLand: "Karayolu (TIR)",
    filterSea: "Denizyolu (Konteyner)",
    filterAir: "Havayolu Küresel",
    documents: "Sevkiyat Belgeleri",
    noDocs: "Bu sevkiyat için henüz evrak serbest bırakılmadı.",
    timeline: "Akıllı Takip Zaman Tüneli",
    inquiryTitle: "Lojistik Destek Talepleri",
    inquiryDesc: "Bu sevkiyat ile ilgili MARAS Operasyon Ekibine hızlıca destek talebi iletin.",
    inquirySuccess: "Destek talebiniz başarıyla kaydedilmiş ve MARAS operasyon ekibine iletilmiştir.",
    inquiryError: "Talep gönderilemedi. Lütfen tekrar deneyin.",
    inquiryPlaceholder: "Yükün durumu veya operasyonel sorularınızı buraya yazın...",
    submitInquiry: "Operasyonel Talep Gönder",
    attachFile: "Dosya ekle",
    removeFile: "Dosyayı kaldır",
    uploadingFile: "Yükleniyor...",
    uploadFileError: "Dosya yüklenemedi. Lütfen tekrar deneyin.",
    textTooLongError: `Mesaj çok uzun (en fazla ${MAX_CHAT_TEXT_LENGTH} karakter).`,
    viewMap: "Akıllı Takip Haritası",
    smartTrackingNote: "Sürücü bataryasını ve uygulama performansını korumak için GPS periyodik olarak güncellenir.",
    close: "Sekmeyi Kapat",
    eta: "Tahmini Varış (ETA)",
    etd: "Tahmini Çıkış (ETD)",
    shippingLine: "Armatör / Hat",
    vessel: "Gemi Adı",
    bookingNo: "Rezervasyon No",
    billOfLading: "Konşimento No",
    airline: "Havayolu Firması",
    waybill: "Hava Konşimentosu",
    notifsTitle: "Lojistik Bildirim Merkezi",
    markAllRead: "Tümünü Okundu İşaretle",
    noNewNotifs: "Yakın zamanda güncelleme yok",
    viewShipment: "Takip Et",
    notifications: "Bildirimler",
    hello: "Merhaba,",
    currentShipment: "Güncel sevkiyat",
    trackShipment: "Sevkiyatı Takip Et",
    details: "Detaylar",
    lastUpdate: "Son güncelleme",
    step: "Adım",
    of: "/",
    statTotal: "Toplam",
    statActive: "Yolda",
    statDelivered: "Teslim",
    earlierShipments: "Önceki sevkiyatlar",
    navHome: "Ana Sayfa",
    navShipments: "Sevkiyatlar",
    navChat: "Sohbet",
    navProfile: "Profil",
    segAll: "Tümü",
    segActive: "Yolda",
    segDelivered: "Teslim",
    segCancelled: "İptal",
    loadOlder: "Daha eski sevkiyatları yükle",
    loading: "Yükleniyor…",
    searchFilter: "Ara & Filtrele",
    reset: "Sıfırla",
    searchPlaceholderShort: "Numara, şehir, güzergah ile ara",
    freightType: "Taşıma türü",
    filterAllShort: "Tümü",
    status: "Durum",
    showResults: "Sonuçları göster",
    mode_land: "Karayolu · TIR",
    mode_sea: "Denizyolu · Konteyner",
    mode_air: "Havayolu · Express",
    shipmentDetails: "Sevkiyat Detayları",
    tabOverview: "Genel",
    tabTracking: "Takip",
    cargo: "Yük",
    weight: "Ağırlık",
    freightTypeLabel: "Taşıma türü",
    truck: "Tır",
    created: "Oluşturuldu",
    filesInChatNote: "CMR ve çeki listesi gibi belgeler sizinle Sohbet içinde paylaşılır.",
    openChat: "Sevkiyat Sohbetini Aç",
    live: "Canlı",
    estArrival: "Tahmini varış",
    sharedByMaras: "MARAS belirler",
    viewTimeline: "Zaman çizelgesini gör",
    journeyProgress: "Yolculuk İlerlemesi",
    confirmedSteps: "Yalnızca onaylı adımlar",
    pending: "Bekliyor",
    chatEmpty: "Henüz mesaj yok. MARAS Operasyon'a bir mesaj gönderin.",
    chatClosed: "Bu sevkiyat kapatıldı. Artık mesaj gönderilemez.",
    chatViewOnly: "Salt görüntüleme hesabı — mesaj gönderilemiyor.",
    messagePlaceholder: "MARAS'a mesaj…",
    attachment: "Ek",
    companyInfo: "Şirket Bilgileri",
    notifSettings: "Bildirim Ayarları",
    language: "Dil",
    help: "Yardım & Destek",
    about: "eTIR by MARAS Hakkında",
    privacy: "Gizlilik Politikası",
    signOut: "Çıkış Yap",
    deleteAccount: "Hesabı sil",
    verified: "Doğrulanmış hesap",
    clientStaff: "Müşteri Personeli",
    customerApp: "Müşteri Uygulaması",
    companyName: "Şirket",
    email: "E-posta",
    companyInfoNote: "Şirket bilgileri MARAS Operasyon tarafından yönetilir. Güncellemek için destek ile iletişime geçin.",
    soundAlerts: "Sesli uyarılar",
    soundAlertsNote: "Yeni sevkiyat güncellemelerinde ses çal",
    notifSettingsNote: "Sevkiyat durum güncellemeleri, mesajlar ve paylaşılan dosyaları her zaman bildirim olarak alırsınız.",
    languageNote: "Uygulama anında değişir; Arapça için sağdan sola düzen dahil.",
    unread: "okunmamış güncelleme",
    markAllReadShort: "Tümünü okundu işaretle",
    emptyShipmentsTitle: "Henüz sevkiyat yok",
    emptyShipmentsSub: "MARAS şirketiniz için bir sevkiyat oluşturduğunda, canlı takip ve sohbet ile burada görünür.",
    emptyNotifTitle: "Her şey güncel",
    emptyNotifSub: "Sevkiyatlarınızla ilgili yeni güncellemeler — durum, mesaj ve dosyalar — burada görünür.",
    emptyResultsTitle: "Sevkiyat bulunamadı",
    emptyResultsSub: "Aramaya uygun bir sonuç bulamadık. Farklı bir numara, şehir veya güzergah deneyin.",
    emptyOfflineTitle: "Çevrimdışısınız",
    emptyOfflineSub: "Şu an MARAS'a ulaşılamıyor. Son senkronize bilgiler hâlâ mevcut.",
    emptyGpsTitle: "Canlı konum yok",
    emptyGpsSub: "Sürücünün GPS'i kapalı veya kapsama dışı. Yeni konum alınınca takip otomatik devam eder.",
    track: "Takip"
  },
  ar: {
    welcome: "مرحباً بك مجدداً،",
    subtitle: "بوابة etir لعملاء الشحن وإدارة الخدمات اللوجستية",
    statsTotal: "إجمالي الشحنات",
    statsActive: "الناشطة قيد النقل",
    statsCompleted: "الشحنات المستلمة كلياً",
    noShipments: "لم يتم العثور على أي شحنات مرتبطة ببيانات شركتكم حالياً.",
    searchPlaceholder: "البحث برقم الشحنة، اللوحة، المدينة أو نوع البضاعة...",
    filterAll: "كافة قطاعات النقل",
    filterLand: "الشحن البري (TIR)",
    filterSea: "الشحن البحري (حاويات)",
    filterAir: "الشحن الجوي السريع",
    documents: "مستندات الشحنة",
    noDocs: "لم يتم إصدار أو إرفاق مستندات رسمية لهذه الشحنة حتى الآن.",
    timeline: "الخط الزمني للتتبع الذكي",
    inquiryTitle: "إرسال الاستفسارات والطلبات اللوجستية",
    inquiryDesc: "أرسل استفساراً سريعاً ومباشراً إلى مركز عمليات MARAS بخصوص هذه الشحنة.",
    inquirySuccess: "تم تسجيل استفسارك بنجاح وإرساله فوراً للمسؤولين في MARAS.",
    inquiryError: "فشل إرسال طلب الدعم. يرجى المحاولة لاحقاً.",
    inquiryPlaceholder: "تفاصيل استفسارك أو أسئلتك اللوجستية حول الحمولة...",
    submitInquiry: "إرسال طلب الدعم الفني",
    attachFile: "إرفاق ملف",
    removeFile: "إزالة الملف",
    uploadingFile: "جارٍ الرفع...",
    uploadFileError: "فشل رفع الملف. يرجى المحاولة مرة أخرى.",
    textTooLongError: `الرسالة طويلة جداً (الحد الأقصى ${MAX_CHAT_TEXT_LENGTH} حرفاً).`,
    viewMap: "خارطة التتبع الذكي",
    smartTrackingNote: "يتم تحديث نظام تحديد المواقع بشكل دوري للحفاظ على بطارية السائق وأداء التطبيق.",
    close: "إغلاق التفاصيل",
    eta: "الوصول المتوقع (ETA)",
    etd: "الإقلاع المتوقع (ETD)",
    shippingLine: "الخط الملاحي / الناقل",
    vessel: "اسم السفينة الناقلة",
    bookingNo: "رقم الحجز الملاحي",
    billOfLading: "بوليصة الشحن البحري",
    airline: "شركة الطيران الناقلة",
    waybill: "رقم بوليصة الشحن الجوي",
    notifsTitle: "مركز تحديثات الشحن والخدمات",
    markAllRead: "تحديد الكل كمقروء",
    noNewNotifs: "لا توجد تحديثات مؤخرة",
    viewShipment: "تتبع",
    notifications: "الإشعارات",
    hello: "مرحباً،",
    currentShipment: "الشحنة الحالية",
    trackShipment: "تتبّع الشحنة",
    details: "التفاصيل",
    lastUpdate: "آخر تحديث",
    step: "الخطوة",
    of: "من",
    statTotal: "الإجمالي",
    statActive: "في الطريق",
    statDelivered: "تم التسليم",
    earlierShipments: "شحنات سابقة",
    navHome: "الرئيسية",
    navShipments: "الشحنات",
    navChat: "الدردشة",
    navProfile: "الملف",
    segAll: "الكل",
    segActive: "في الطريق",
    segDelivered: "تم التسليم",
    segCancelled: "ملغاة",
    loadOlder: "تحميل شحنات أقدم",
    loading: "جارٍ التحميل…",
    searchFilter: "بحث وتصفية",
    reset: "إعادة ضبط",
    searchPlaceholderShort: "ابحث بالرقم أو المدينة أو المسار",
    freightType: "نوع الشحن",
    filterAllShort: "الكل",
    status: "الحالة",
    showResults: "عرض النتائج",
    mode_land: "بري · TIR",
    mode_sea: "بحري · حاويات",
    mode_air: "جوي · سريع",
    shipmentDetails: "تفاصيل الشحنة",
    tabOverview: "نظرة عامة",
    tabTracking: "التتبّع",
    cargo: "البضاعة",
    weight: "الوزن",
    freightTypeLabel: "نوع الشحن",
    truck: "الشاحنة",
    created: "تاريخ الإنشاء",
    filesInChatNote: "يتم مشاركة المستندات مثل CMR وقائمة التعبئة معك داخل الدردشة.",
    openChat: "فتح دردشة الشحنة",
    live: "مباشر",
    estArrival: "الوصول المتوقع",
    sharedByMaras: "يحدده مكتب MARAS",
    viewTimeline: "عرض الخط الزمني",
    journeyProgress: "تقدّم الرحلة",
    confirmedSteps: "الخطوات المؤكدة فقط",
    pending: "قيد الانتظار",
    chatEmpty: "لا توجد رسائل بعد. أرسل رسالة إلى مكتب MARAS.",
    chatClosed: "هذه الشحنة مغلقة. لم يعد بالإمكان إرسال رسائل.",
    chatViewOnly: "حساب للاطلاع فقط — لا يمكن إرسال الرسائل.",
    messagePlaceholder: "راسل MARAS…",
    attachment: "مرفق",
    companyInfo: "معلومات الشركة",
    notifSettings: "إعدادات الإشعارات",
    language: "اللغة",
    help: "المساعدة والدعم",
    about: "حول eTIR by MARAS",
    privacy: "سياسة الخصوصية",
    signOut: "تسجيل الخروج",
    deleteAccount: "حذف الحساب",
    verified: "حساب موثّق",
    clientStaff: "موظف العميل",
    customerApp: "تطبيق العميل",
    companyName: "الشركة",
    email: "البريد الإلكتروني",
    companyInfoNote: "تدار بيانات الشركة من قبل مكتب MARAS. تواصل مع الدعم للتحديث.",
    soundAlerts: "تنبيهات صوتية",
    soundAlertsNote: "تشغيل صوت عند وصول تحديثات جديدة",
    notifSettingsNote: "ستصلك دائماً تحديثات حالة الشحنة والرسائل والملفات كإشعارات.",
    languageNote: "يتغير التطبيق بالكامل فوراً، بما في ذلك التخطيط من اليمين لليسار.",
    unread: "تحديثات غير مقروءة",
    markAllReadShort: "تحديد الكل كمقروء",
    emptyShipmentsTitle: "لا توجد شحنات بعد",
    emptyShipmentsSub: "عندما ينشئ مكتب MARAS شحنة لشركتك، ستظهر هنا مع التتبّع المباشر والدردشة.",
    emptyNotifTitle: "لا جديد لديك",
    emptyNotifSub: "ستظهر هنا التحديثات الجديدة حول شحناتك — الحالة والرسائل والملفات.",
    emptyResultsTitle: "لم يتم العثور على شحنات",
    emptyResultsSub: "لم نجد شيئاً يطابق بحثك. جرّب رقماً أو مدينة أو مساراً مختلفاً.",
    emptyOfflineTitle: "أنت غير متصل",
    emptyOfflineSub: "تعذر الوصول إلى MARAS الآن. ما زالت آخر المعلومات المتزامنة متاحة.",
    emptyGpsTitle: "الموقع المباشر غير متاح",
    emptyGpsSub: "جهاز GPS لدى السائق مطفأ أو خارج التغطية. يستأنف التتبّع تلقائياً عند ورود موقع جديد.",
    track: "تتبع"
  }
};

// Small country-flag glyph shown beside the Home hero route, matching the
// approved design mockup. Maps known country names to an emoji flag; an
// unknown country renders nothing (graceful — identical to before). Purely
// cosmetic — no data, permission, or business-logic impact.
const COUNTRY_ISO: Record<string, string> = {
  "turkey": "TR", "türkiye": "TR", "turkiye": "TR",
  "iraq": "IQ", "syria": "SY", "iran": "IR", "jordan": "JO",
  "saudi arabia": "SA", "kuwait": "KW", "united arab emirates": "AE", "uae": "AE",
  "qatar": "QA", "bahrain": "BH", "oman": "OM", "lebanon": "LB", "egypt": "EG",
};
function countryFlag(name?: string | null): string {
  if (!name) return "";
  const iso = COUNTRY_ISO[name.toLowerCase().trim()];
  if (!iso) return "";
  return String.fromCodePoint(...[...iso].map((c) => 127397 + c.charCodeAt(0)));
}

interface ClientDashboardProps {
  lang: Language;
  clientCompanyName: string;
  clientEmail: string;
  clientId: string;
  onLogout: () => void;
  onLanguageChange?: (lang: Language) => void;
  isMobile?: boolean;
  viewOnly?: boolean;
}

// feature/chat-ui-ux-phase2: auto-growing composer bounds — two lines at
// rest (matching the existing rows={2}), up to ~6-7 lines before the
// textarea scrolls internally instead of pushing the rest of the page
// down.
const INQUIRY_COMPOSER_MIN_HEIGHT_PX = 56;
const INQUIRY_COMPOSER_MAX_HEIGHT_PX = 160;

export default function ClientDashboard({ lang, clientCompanyName, clientEmail, clientId, onLogout, onLanguageChange, isMobile = false, viewOnly = false }: ClientDashboardProps) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  // Phase 2A follow-up (blocking-issue fix): GET /api/shipments now
  // returns only the latest page (default 50) — these track cursor
  // pagination for the explicit "Load Older Shipments" action.
  const [shipmentsNextCursor, setShipmentsNextCursor] = useState<string | null>(null);
  const [shipmentsHasMore, setShipmentsHasMore] = useState(false);
  const [shipmentsLoadingMore, setShipmentsLoadingMore] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [freightTypeFilter, setFreightTypeFilter] = useState<'all' | 'land' | 'sea' | 'air'>('all');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [selectedShipmentLoading, setSelectedShipmentLoading] = useState(false);
  // PR #111 review (Delivered/Closed terminal & chat rules): this
  // dashboard previously had no shipment-status-based chat lock at all —
  // locks only at the freight-mode-appropriate closing status ("Closed"
  // for Land, "Completed" for Sea/Air); reaching "Delivered" must NOT
  // lock chat.
  const isChatClosed = selectedShipment ? isShipmentClosed(selectedShipment.status, selectedShipment.freightType) : false;
  // Phase 2A follow-up (blocking-issue fix): GET /api/shipments/stats —
  // a real, full-scope server aggregate (not `shipments.length`) for the
  // "Total Shipments" tile below, so it stays accurate once only a page
  // is loaded client-side.
  const [shipmentStatsTotal, setShipmentStatsTotal] = useState<number | null>(null);

  // Chat/Inquiry States
  const [inquiries, setInquiries] = useState<{[shipmentId: string]: any[]}>({});
  const [inquiryText, setInquiryText] = useState("");
  const [sendingInquiry, setSendingInquiry] = useState(false);
  const [inquiryStatus, setInquiryStatus] = useState<"idle" | "success" | "error">("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileDataUrl, setSelectedFileDataUrl] = useState("");
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileError, setFileError] = useState("");

  // feature/chat-ui-ux-phase2: smart auto-scroll for the inquiry feed —
  // previously this feed had no auto-scroll at all, so a new message just
  // appended silently below the visible area of the small feed box.
  // inquiryFeedRef is the scrollable feed; isInquiryFeedNearBottomRef
  // tracks (via the onScroll handler below) whether the client is already
  // close to the bottom — only then does a new message auto-scroll the
  // view.
  const inquiryFeedRef = useRef<HTMLDivElement>(null);
  const inquiryFeedEndRef = useRef<HTMLDivElement>(null);
  const isInquiryFeedNearBottomRef = useRef(true);
  // feature/chat-ui-ux-phase2: auto-growing composer textarea.
  const inquiryTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Opening a different shipment always starts its inquiry feed scrolled
  // to the latest messages.
  useEffect(() => {
    isInquiryFeedNearBottomRef.current = true;
  }, [selectedShipment?.id]);

  // Smart auto-scroll — only scrolls to the newest message when the
  // client was already near the bottom (or just switched shipment, per
  // the reset above).
  useEffect(() => {
    const count = selectedShipment ? (inquiries[selectedShipment.id]?.length ?? 0) : 0;
    if (count > 0 && isInquiryFeedNearBottomRef.current) {
      inquiryFeedEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShipment?.id, selectedShipment ? inquiries[selectedShipment.id]?.length : 0]);

  const handleInquiryFeedScroll = () => {
    const el = inquiryFeedRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isInquiryFeedNearBottomRef.current = isNearBottom(distanceFromBottom);
  };

  // Auto-grow the composer textarea with its content (including
  // shrinking back down after the draft is cleared on send).
  useEffect(() => {
    const el = inquiryTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${computeAutoGrowHeightPx(el.scrollHeight, INQUIRY_COMPOSER_MIN_HEIGHT_PX, INQUIRY_COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [inquiryText]);

  // Real-time Notification Center States
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const knownNotificationIdsRef = React.useRef<Set<string>>(new Set());
  // In-flight guard for POST /api/notifications/:id/read — prevents a
  // duplicate request for the same id firing before a previous one for it
  // has settled.
  const markingNotifsReadRef = React.useRef<Set<string>>(new Set());

  // Client Account Deletion States
  // Apple Guideline 5.1.1(v) consolidation: calls DELETE /api/account (not
  // DELETE /api/clients/:id directly) — that endpoint derives the delete
  // target from the verified session, never a client-supplied id, and
  // requires the account's current password before proceeding (every
  // Client account has one — clients never sign in via Firebase/Google at
  // all, so there is no Firebase Auth identity for this flow to touch;
  // the previous version's `auth.currentUser.delete()` call was not just
  // dead code but a latent cross-account bug — `auth.currentUser` reflects
  // whatever Firebase session happens to be cached in this browser, which
  // could be a completely different, unrelated Google-signed-in DRIVER
  // account from an earlier session on the same device, not this client).
  const [showClientDeleteConfirm, setShowClientDeleteConfirm] = useState(false);
  const [understandClientDelete, setUnderstandClientDelete] = useState(false);
  const [isDeletingClientAccount, setIsDeletingClientAccount] = useState(false);
  const [clientDeleteCurrentPassword, setClientDeleteCurrentPassword] = useState("");
  const [clientDeleteError, setClientDeleteError] = useState<
    null | "missing" | "incorrect" | "rate_limited" | "service_unavailable" | "generic" | "network"
  >(null);

  const handleDeleteClientAccount = async () => {
    if (!understandClientDelete) return;
    if (isDeletingClientAccount) return; // in-flight guard — no double-submit
    setIsDeletingClientAccount(true);
    setClientDeleteError(null);
    try {
      const response = await apiFetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: clientDeleteCurrentPassword }),
      });
      if (response.ok) {
        setClientDeleteCurrentPassword("");
        setToastMessage(accountDeletionCopy(lang).successMessage);
        setShowClientDeleteConfirm(false);
        // Logout user session and clean state
        if (onLogout) {
          setTimeout(onLogout, 2000);
        }
      } else if (response.status === 400) {
        setClientDeleteError("missing");
      } else if (response.status === 401) {
        setClientDeleteError("incorrect");
      } else if (response.status === 429) {
        setClientDeleteError("rate_limited");
      } else if (response.status === 503) {
        setClientDeleteError("service_unavailable");
      } else {
        setClientDeleteError("generic");
      }
    } catch (err) {
      console.error(err);
      setClientDeleteError("network");
    } finally {
      setIsDeletingClientAccount(false);
    }
  };

  const curT = t[lang] || t.en;
  const isRtl = lang === "ar";

  // Customer App — Design Revision A navigation state. Purely presentational:
  // it selects which approved screen is shown. No data/permission/API change.
  const [activeTab, setActiveTab] = useState<"home" | "shipments" | "chat" | "profile">("home");
  const [screen, setScreen] = useState<null | "tracking" | "journey" | "details" | "search" | "company" | "notifSettings" | "language">(null);
  const [detailsTab, setDetailsTab] = useState<"overview" | "tracking" | "chat">("overview");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "delivered" | "cancelled">("all");
  // Real, working setting (surfaced in Profile → Notification Settings): gates
  // the existing new-notification chime. Persisted locally.
  const [notifSoundEnabled, setNotifSoundEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("etir_client_notif_sound") !== "off"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("etir_client_notif_sound", notifSoundEnabled ? "on" : "off"); } catch { /* ignore */ }
  }, [notifSoundEnabled]);

  useEffect(() => {
    fetchDashboardData();
  }, [clientCompanyName]);

  useEffect(() => {
    if (toastMessage) {
      const handle = setTimeout(() => setToastMessage(null), 6000);
      return () => clearTimeout(handle);
    }
  }, [toastMessage]);

  // Sync notifications background polling
  const syncNotificationsBackground = async () => {
    try {
      const resNotifications = await apiFetch("/api/notifications");
      if (resNotifications.ok) {
        const text = await resNotifications.text();
        if (!text.trim().startsWith("<")) {
          const notifPage = JSON.parse(text);
          const allNotifications = Array.isArray(notifPage) ? notifPage : notifPage.items;
          const myShipmentIds = new Set(shipments.map(s => s.id));
          const myNotifs = allNotifications.filter((n: any) => 
            n.shipmentId && 
            myShipmentIds.has(n.shipmentId) && 
            n.type !== 'chat' && 
            n.type !== 'doc_upload' && 
            n.type !== 'assignment'
          );

          if (knownNotificationIdsRef.current.size > 0) {
            let hasNew = false;
            for (const notif of myNotifs) {
              if (!knownNotificationIdsRef.current.has(notif.id)) {
                knownNotificationIdsRef.current.add(notif.id);
                if (!isNotificationReadForUser(notif, clientId)) {
                  hasNew = true;
                  const title = lang === 'en' ? notif.titleEn : (lang === 'tr' ? notif.titleTr : notif.titleAr);
                  const msg = lang === 'en' ? notif.messageEn : (lang === 'tr' ? notif.messageTr : notif.messageAr);
                  setToastMessage(`🔔 ${title}: ${msg}`);
                }
              }
            }
            if (hasNew && notifSoundEnabled) {
              try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.type = "sine";
                oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.15);
              } catch (e) {}
            }
          } else {
            const initialIds = new Set<string>();
            myNotifs.forEach((n: any) => initialIds.add(n.id));
            knownNotificationIdsRef.current = initialIds;
          }
          setNotifications(myNotifs);
        }
      }
    } catch (err) {
      console.warn("Background notification sync failed:", err);
    }
  };

  useEffect(() => {
    if (shipments.length === 0) return;
    const handle = setInterval(() => {
      syncNotificationsBackground();
    }, 10000);
    return () => clearInterval(handle);
  }, [shipments.length]);

  // Notification Phase 1 correction: per-user read tracking
  // (readByUserIds), not the legacy shared `read` flag — this Client
  // account's own id (clientId, the verified session id, distinct for the
  // Owner vs. each Staff account on the same company) is added only for
  // notifications this account itself reads, and only after each
  // individual request succeeds. A failed request leaves that
  // notification unread, both locally and on the server, so it's not
  // silently lost from the badge count. Client Owner reading a
  // notification never marks it read for Client Staff, and vice versa —
  // they have distinct ids even though they share a company.
  const handleMarkAllRead = async () => {
    const unreadIds = notifications
      .filter(n => !isNotificationReadForUser(n, clientId))
      .map(n => n.id)
      .filter(id => !markingNotifsReadRef.current.has(id));
    if (unreadIds.length === 0) return;
    unreadIds.forEach(id => markingNotifsReadRef.current.add(id));
    await Promise.all(unreadIds.map(async (id) => {
      try {
        const res = await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
        if (res.ok) {
          setNotifications(prev => prev.map(n => n.id === id
            ? { ...n, readByUserIds: addReaderToNotification(n.readByUserIds, clientId) }
            : n
          ));
        } else {
          console.error(`Failed to mark notification ${id} as read: ${res.status}`);
        }
      } catch (err) {
        console.error(`Failed to mark notification ${id} as read:`, err);
      } finally {
        markingNotifsReadRef.current.delete(id);
      }
    }));
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      // Fetch core logistics datasets using apiFetch.
      //
      // Phase 2A follow-up (blocking-issue fix): GET /api/shipments now
      // returns only the LATEST page (default 50), already scoped
      // server-side to this client's own company
      // (buildClientOwnedShipmentQueryScopes, server.ts) — no more
      // page-through-to-exhaustion on this normal loading path. A client
      // with more than one page of shipments sees the newest 50 first and
      // reaches older ones via the explicit "Load Older Shipments" action
      // (handleLoadMoreShipments below), the same UX pattern as
      // AdminPanel's Shipments Registry tab.
      const resDrivers = await apiFetch("/api/drivers");
      const resShipmentsPage = await apiFetch("/api/shipments?limit=50");
      const resShipmentsStats = await apiFetch("/api/shipments/stats");

      let allDrivers: Driver[] = [];
      let myShipments: Shipment[] = [];
      let nextCursor: string | null = null;
      let hasMore = false;

      if (resShipmentsPage.ok) {
        const text = await resShipmentsPage.text();
        if (!text.trim().startsWith("<")) {
          const data = JSON.parse(text);
          // The server already scopes this to the client's own company —
          // this re-filter is a display-side belt-and-suspenders check
          // only (see clientAccess.ts's own note on the server's strict,
          // unnormalized companyName match vs. this normalized one), not
          // a second source of truth.
          myShipments = (data.items || []).filter((s: Shipment) =>
            (s.companyName || "").toLowerCase().trim() === clientCompanyName.toLowerCase().trim()
          );
          nextCursor = data.nextCursor ?? null;
          hasMore = !!data.hasMore;
        }
      }

      if (resShipmentsStats.ok) {
        const statsData = await resShipmentsStats.json();
        setShipmentStatsTotal(typeof statsData.total === "number" ? statsData.total : null);
      }

      if (resDrivers.ok) {
        const text = await resDrivers.text();
        if (!text.trim().startsWith("<")) {
          allDrivers = JSON.parse(text);
        }
      }

      setShipments(myShipments);
      setShipmentsNextCursor(nextCursor);
      setShipmentsHasMore(hasMore);
      setDrivers(allDrivers);

      // Fetch customer notifications
      try {
        const resNotifications = await apiFetch("/api/notifications");
        if (resNotifications.ok) {
          const text = await resNotifications.text();
          if (!text.trim().startsWith("<")) {
            const notifPage = JSON.parse(text);
            const allNotifications = Array.isArray(notifPage) ? notifPage : notifPage.items;
            // Phase 2A follow-up (blocking-issue fix): GET /api/notifications
            // already scopes results to this client's own company
            // server-side, independently of GET /api/shipments
            // (buildClientOwnedShipmentQueryScopes + fetchOwnedShipmentIds,
            // server.ts) — it does NOT depend on what's currently loaded
            // into `myShipments` here. The old `myShipmentIds.has(...)`
            // re-check below was redundant (and harmless) back when
            // `myShipments` always held the client's ENTIRE shipment list;
            // now that GET /api/shipments returns only the latest page,
            // that same re-check would have silently hidden every
            // notification for a shipment older than the loaded page —
            // removed rather than left in as a stale, now-incorrect gate.
            const myNotifs = allNotifications.filter((n: any) =>
              n.type !== 'chat' &&
              n.type !== 'doc_upload' &&
              n.type !== 'assignment'
            );
            
            if (knownNotificationIdsRef.current.size === 0) {
              const initialIds = new Set<string>();
              myNotifs.forEach((n: any) => initialIds.add(n.id));
              knownNotificationIdsRef.current = initialIds;
            }
            setNotifications(myNotifs);
          }
        }
      } catch (err) {
        console.warn("Could not retrieve notifications stream: ", err);
      }

      // Fetch chats/inquiries for each shipment
      for (const sh of myShipments) {
        try {
          const resChat = await apiFetch(`/api/shipments/${sh.id}/chat`);
          if (resChat.ok) {
            const chatText = await resChat.text();
            if (!chatText.trim().startsWith("<")) {
              const chatPage = JSON.parse(chatText);
              const msgs = Array.isArray(chatPage) ? chatPage : chatPage.items;
              setInquiries(prev => ({ ...prev, [sh.id]: msgs }));
            }
          }
        } catch (err) {
          console.warn("Could not retrieve comments/chat for shipment: ", sh.id);
        }
      }

    } catch (err) {
      console.error("Client dashboard loading exception: ", err);
    } finally {
      setLoading(false);
    }
  };

  // Phase 2A follow-up (blocking-issue fix): explicit "Load Older
  // Shipments" action, same pattern as AdminPanel's Shipments Registry
  // tab. Always strictly older rows (cursor mode is createdAt DESC from
  // wherever the currently-loaded list ends) — plain concatenation is
  // correct; still de-duplicated by id defensively.
  const handleLoadMoreShipments = async () => {
    if (!shipmentsHasMore || !shipmentsNextCursor || shipmentsLoadingMore) return;
    setShipmentsLoadingMore(true);
    try {
      const res = await apiFetch(`/api/shipments?limit=50&cursor=${encodeURIComponent(shipmentsNextCursor)}`);
      if (!res.ok) return;
      const text = await res.text();
      if (text.trim().startsWith("<")) return;
      const data = JSON.parse(text);
      const newItems: Shipment[] = (data.items || []).filter((s: Shipment) =>
        (s.companyName || "").toLowerCase().trim() === clientCompanyName.toLowerCase().trim()
      );
      setShipments(prev => {
        const seenIds = new Set(prev.map(s => s.id));
        return [...prev, ...newItems.filter(s => !seenIds.has(s.id))];
      });
      setShipmentsNextCursor(data.nextCursor ?? null);
      setShipmentsHasMore(!!data.hasMore);
    } catch (err) {
      console.warn("Failed to load older shipments:", err);
    } finally {
      setShipmentsLoadingMore(false);
    }
  };

  // Phase 2A follow-up (blocking-issue fix): opening a specific shipment's
  // detail (e.g. from a notification pointing at a shipment older than
  // whatever page happens to be loaded) must not require downloading the
  // whole list first — GET /api/shipments/:id is already permission-
  // scoped exactly like the list endpoint (a client can only ever reach
  // their own company's shipment; server.ts 403s otherwise), so this is
  // safe to call directly for any shipment id.
  const fetchShipmentById = async (id: string): Promise<Shipment | null> => {
    try {
      const res = await apiFetch(`/api/shipments/${id}`);
      if (!res.ok) return null;
      const text = await res.text();
      if (text.trim().startsWith("<")) return null;
      return JSON.parse(text);
    } catch (err) {
      console.warn("Failed to fetch shipment by id:", id, err);
      return null;
    }
  };

  const openShipmentById = async (id: string) => {
    const alreadyLoaded = shipments.find(s => s.id === id);
    if (alreadyLoaded) {
      setSelectedShipment(alreadyLoaded);
      return;
    }
    setSelectedShipmentLoading(true);
    try {
      const fetched = await fetchShipmentById(id);
      if (fetched) setSelectedShipment(fetched);
    } finally {
      setSelectedShipmentLoading(false);
    }
  };

  // customer-chat-file-upload-ui: selecting a file only reads it into
  // memory + runs the same client-side pre-check the server enforces
  // (validateUpload, src/lib/uploadValidation.ts) for fast feedback; the
  // actual upload happens on send (handleSendInquiry), same as the
  // existing admin attachment flow in App.tsx.
  const handleAttachmentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after removing it
    if (!file) return;

    const validation = validateUpload(file.type, file.name, file.size);
    if (!validation.ok) {
      setFileError(validation.error);
      setSelectedFile(null);
      setSelectedFileDataUrl("");
      return;
    }

    setFileError("");
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => setSelectedFileDataUrl((evt.target?.result as string) || "");
    reader.readAsDataURL(file);
  };

  const handleRemoveAttachment = () => {
    setSelectedFile(null);
    setSelectedFileDataUrl("");
    setFileError("");
  };

  const handleSendInquiry = async (shipmentId: string) => {
    // fix/chat-safety-reliability-phase1: in-flight guard — the Send
    // button already disables on sendingInquiry, but that only takes
    // effect after a re-render, so a double-tap could still race ahead of
    // it. Matches the same guard now applied to every other chat composer
    // (ChatCenter.tsx, App.tsx, DriverApplication.tsx).
    if (!canSubmitChatMessage({ text: inquiryText, hasAttachment: Boolean(selectedFile), isSending: sendingInquiry, isLocked: isChatClosed })) return;
    // fix/chat-safety-reliability-phase1: matches the shared server-side
    // limit (validateChatSendPayload, src/lib/chatMessageValidation.ts) —
    // the textarea's maxLength attribute already stops typing past this,
    // but a paste can still exceed it in some browsers, so check here too
    // rather than relying on the server's 400 alone.
    if (inquiryText.trim().length > MAX_CHAT_TEXT_LENGTH) {
      setFileError(curT.textTooLongError);
      return;
    }
    setSendingInquiry(true);
    setInquiryStatus("idle");
    setFileError("");

    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let fileCategory: DocumentCategory | undefined;

      if (selectedFile && selectedFileDataUrl) {
        setIsUploadingFile(true);
        try {
          const uploadRes = await apiFetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64DataUrl: selectedFileDataUrl,
              filename: selectedFile.name
            })
          });
          if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({}));
            setFileError(errData.error || curT.uploadFileError);
            setSendingInquiry(false);
            setIsUploadingFile(false);
            return;
          }
          const uploadData = await uploadRes.json();
          fileUrl = uploadData.url;
          fileName = selectedFile.name;
          fileCategory = selectedFile.type.startsWith("image/") ? "photo" : "other";
        } finally {
          setIsUploadingFile(false);
        }
      }

      const body: Record<string, unknown> = {
        sender: "client",
        senderName: `${clientCompanyName} (${lang === "ar" ? "عميل" : "Client"})`,
        type: fileUrl ? "file" : "text",
        // customer-chat-enablement-safety-review: explicit here for
        // defense-in-depth — the server independently forces every
        // "client"-role sender to client_admin regardless of this value
        // (resolveOutgoingChatChannel, src/lib/chatVisibility.ts), so a
        // client session can never actually reach driver_admin/
        // internal_staff even if this were tampered with.
        channel: "client_admin"
      };
      if (inquiryText.trim()) body.text = inquiryText.trim();
      if (fileUrl) {
        body.fileUrl = fileUrl;
        body.fileName = fileName;
        body.fileCategory = fileCategory;
      }

      const res = await apiFetch(`/api/shipments/${shipmentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        setInquiryText("");
        setSelectedFile(null);
        setSelectedFileDataUrl("");
        setInquiryStatus("success");
        setTimeout(() => setInquiryStatus("idle"), 5000);
        // Refresh chats
        const resChat = await apiFetch(`/api/shipments/${shipmentId}/chat`);
        if (resChat.ok) {
          const chatText = await resChat.text();
          if (!chatText.trim().startsWith("<")) {
            const chatPage = JSON.parse(chatText);
            const msgs = Array.isArray(chatPage) ? chatPage : chatPage.items;
            setInquiries(prev => ({ ...prev, [shipmentId]: msgs }));
          }
        }
      } else {
        // PR #111 review (Delivered/Closed terminal & chat rules): the
        // shipment was closed since this dashboard last loaded it — sync
        // local status so the composer locks to match, rather than
        // leaving it open for a retry the server will keep rejecting.
        let body: any = null;
        try { body = await res.json(); } catch {}
        if (res.status === 409 && body?.code === "SHIPMENT_CHAT_CLOSED") {
          setSelectedShipment((prev) => (prev && prev.id === shipmentId ? { ...prev, status: body.shipmentStatus } : prev));
        }
        setInquiryStatus("error");
      }
    } catch (err) {
      console.error(err);
      setInquiryStatus("error");
    } finally {
      setSendingInquiry(false);
    }
  };

  // Stats Counters
  //
  // Phase 2A follow-up (blocking-issue fix: dashboard aggregate
  // accuracy). "Total Shipments" is the real server aggregate
  // (GET /api/shipments/stats, fetched in fetchDashboardData) — never
  // `shipments.length`, which would silently under-report the moment
  // there's more than one page. "Active"/"Completed" below are NOT
  // server-aggregated (client role only gets a plain total, not a status
  // breakdown — see fetchShipmentStats' own header comment, server.ts,
  // for why) and remain computed from whichever shipments are currently
  // loaded — labeled as such wherever they're rendered.
  const totalShipments = shipmentStatsTotal ?? 0;
  const activeShipments = shipments.filter(s =>
    !["Delivered", "Completed", "Closed", "Arrived"].includes(s.status)
  ).length;
  const completedShipments = shipments.filter(s =>
    ["Delivered", "Completed", "Closed", "Arrived"].includes(s.status)
  ).length;

  // Filter & Search logic
  const filteredShipments = shipments.filter(s => {
    // Search query matches Cargo string, ID code, Driver Name, or Target destination cities
    const normSearch = searchQuery.toLowerCase().trim();
    const matchesSearch = 
      !normSearch ||
      (s.shipmentNumber || "").toLowerCase().includes(normSearch) ||
      (s.cargoDescription || "").toLowerCase().includes(normSearch) ||
      (s.assignedDriverName || "").toLowerCase().includes(normSearch) ||
      (s.loadingCity || "").toLowerCase().includes(normSearch) ||
      (s.deliveryCity || "").toLowerCase().includes(normSearch) ||
      (s.truckNumber || "").toLowerCase().includes(normSearch);

    // Freight Type match
    const shipmentType = s.freightType || "land";
    const matchesFreight = freightTypeFilter === 'all' || shipmentType === freightTypeFilter;

    return matchesSearch && matchesFreight;
  });

  // ==========================================================================
  // Customer (Trader) App — Design Revision A (approved) presentation layer.
  // Everything above (state, effects, handlers, permissions, business rules)
  // is unchanged. This section only renders those exact values in the approved
  // light-theme, tab-based interface. No API, workflow, or permission changes.
  // ==========================================================================
  const CARD = "bg-white border border-slate-200 rounded-2xl shadow-sm";
  const dirBack = isRtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />;

  const primaryShipment =
    shipments.find(s => !["Delivered", "Completed", "Closed", "Arrived", "Cancelled"].includes(s.status))
    || shipments[0] || null;
  const chatShipment = selectedShipment || primaryShipment;

  const statusChipClass = (status: string) =>
    ["Delivered", "Completed", "Closed", "Arrived"].includes(status) ? "bg-emerald-50 text-emerald-700"
      : (status as string) === "Cancelled" ? "bg-slate-100 text-slate-500"
      : "bg-blue-50 text-blue-700";
  const statusLabel = (status: string) => {
    const l = getShipmentStatusLabel(status) as any;
    return l?.[lang] || l?.en || status;
  };
  const modeOf = (s: Shipment) => resolveFreightMode(s.freightType);
  const modeLabel = (m: "land" | "sea" | "air") => m === "sea" ? curT.mode_sea : m === "air" ? curT.mode_air : curT.mode_land;
  const FreightIcon = ({ s, className }: { s: Shipment; className?: string }) => {
    const m = modeOf(s);
    return m === "sea" ? <Ship className={className} /> : m === "air" ? <Plane className={className} /> : <Truck className={className} />;
  };
  const journeyOf = (s: Shipment) => {
    const seq = getStatusSequenceForFreightMode(resolveFreightMode(s.freightType));
    const idx = seq.indexOf(normalizeStatusForSequence(s.status as any));
    const step = idx >= 0 ? idx + 1 : 0;
    const total = seq.length;
    const pct = total ? Math.round((step / total) * 100) : 0;
    return { step, total, pct };
  };
  const fmtDate = (ts?: string) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleDateString(lang === "tr" ? "tr-TR" : lang === "ar" ? "ar" : "en-US", { year: "numeric", month: "short", day: "numeric" });
  };
  const lastUpdateOf = (s: Shipment) => {
    const ts = (s as any).updatedAt || (s as any).createdAt;
    if (!ts) return "—";
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(lang === "tr" ? "tr-TR" : lang === "ar" ? "ar" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const initials = (name: string) => (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  const langLabel = (l: Language) => l === "ar" ? "العربية" : l === "tr" ? "Türkçe" : "English";

  // Filter/status combine on top of the preserved `filteredShipments`.
  const visibleShipments = filteredShipments.filter(s => {
    if (statusFilter === "all") return true;
    const terminal = ["Delivered", "Completed", "Closed", "Arrived"].includes(s.status);
    if (statusFilter === "delivered") return terminal;
    if (statusFilter === "cancelled") return (s.status as string) === "Cancelled";
    return !terminal && (s.status as string) !== "Cancelled";
  });

  const openTracking = (s: Shipment) => { setSelectedShipment(s); setScreen("tracking"); };
  const openDetails = (s: Shipment) => { setSelectedShipment(s); setDetailsTab("overview"); setScreen("details"); };
  const openChatFor = (s: Shipment) => { setSelectedShipment(s); setScreen(null); setActiveTab("chat"); };

  const journeyBar = (s: Shipment) => {
    const j = journeyOf(s);
    return (
      <>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-extrabold text-slate-900">{statusLabel(s.status)}</span>
          {j.total > 0 && <span className="text-[12px] font-bold text-slate-400">{curT.step} {j.step} {curT.of} {j.total}</span>}
        </div>
        <div className="h-2 rounded-full bg-slate-100 mt-2.5 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600" style={{ width: `${j.pct}%` }} />
        </div>
      </>
    );
  };

  const stat = (label: string, val: number | string, color: string) => (
    <div className="flex-1 text-center">
      <div className={`text-[22px] font-extrabold ${color}`}>{val}</div>
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{label}</div>
    </div>
  );

  const shipmentRow = (s: Shipment) => (
    <button key={s.id} onClick={() => openDetails(s)} className={`${CARD} w-full p-[15px] text-start block`}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-extrabold text-slate-900">{s.shipmentNumber}</span>
        <span className={`px-2.5 py-1 rounded-full text-[11.5px] font-extrabold ${statusChipClass(s.status)}`}>{statusLabel(s.status)}</span>
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <span className="text-[15px] font-bold text-slate-900">{s.loadingCity}</span>
        <ArrowRight className={`w-4 h-4 text-slate-300 ${isRtl ? "rotate-180" : ""}`} />
        <span className="text-[15px] font-bold text-slate-900" dir="ltr">{s.deliveryCity}</span>
      </div>
      <div className="flex items-center justify-between mt-2.5">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold">
          <FreightIcon s={s} className="w-3.5 h-3.5" /> {modeLabel(modeOf(s))}
        </span>
        <span className="text-[11.5px] font-bold text-slate-400">{lastUpdateOf(s)}</span>
      </div>
    </button>
  );

  const detailRow = (Icon: any, k: string, v: React.ReactNode, last = false) => (
    <div className={`flex items-center justify-between py-3.5 ${last ? "" : "border-b border-slate-100"}`}>
      <span className="flex items-center gap-3 text-[14px] font-semibold text-slate-500">
        <span className="w-9 h-9 rounded-xl bg-slate-50 text-blue-600 flex items-center justify-center"><Icon className="w-[17px] h-[17px]" /></span>{k}
      </span>
      <span className="text-[14.5px] font-extrabold text-slate-900 text-end max-w-[58%]">{v}</span>
    </div>
  );

  const carrierRows = (s: Shipment) => {
    const items: [any, string, string][] = [];
    if (s.freightType === "sea") {
      if (s.shippingLine) items.push([Ship, curT.shippingLine, s.shippingLine]);
      if (s.vesselName) items.push([Ship, curT.vessel, s.vesselName]);
      if (s.bookingNumber) items.push([FileText, curT.bookingNo, s.bookingNumber]);
      if (s.billOfLadingNumber) items.push([FileText, curT.billOfLading, s.billOfLadingNumber]);
    } else if (s.freightType === "air") {
      if (s.airline) items.push([Plane, curT.airline, s.airline]);
      if (s.flightNumber) items.push([Plane, "Flight", s.flightNumber]);
      if (s.airWaybillNumber) items.push([FileText, curT.waybill, s.airWaybillNumber]);
    }
    if (s.etd) items.push([Clock, curT.etd, fmtDate(s.etd)]);
    if (s.eta) items.push([Clock, curT.eta, fmtDate(s.eta)]);
    return items.map(([Ic, k, v], i) => (
      <div key={`c${i}`} className="flex items-center justify-between py-3.5 border-b border-slate-100">
        <span className="flex items-center gap-3 text-[14px] font-semibold text-slate-500">
          <span className="w-9 h-9 rounded-xl bg-slate-50 text-blue-600 flex items-center justify-center"><Ic className="w-[17px] h-[17px]" /></span>{k}
        </span>
        <span className="text-[14.5px] font-extrabold text-slate-900 text-end max-w-[58%]">{v}</span>
      </div>
    ));
  };

  const segmented = (opts: [string, string][], val: string, on: (v: string) => void) => (
    <div className="flex bg-slate-100 rounded-2xl p-1 gap-1">
      {opts.map(([k, label]) => (
        <button key={k} onClick={() => on(k)} className={`flex-1 text-center text-[12.5px] py-2 rounded-xl transition-all ${val === k ? "bg-white text-slate-900 font-extrabold shadow-sm" : "text-slate-500 font-bold"}`}>{label}</button>
      ))}
    </div>
  );

  const homeSkeleton = (
    <div className="space-y-3.5 pt-1">
      <div className="h-40 rounded-2xl bg-slate-200/60 animate-pulse" />
      <div className="h-14 rounded-2xl bg-slate-200/60 animate-pulse" />
      <div className="h-20 rounded-2xl bg-slate-200/60 animate-pulse" />
    </div>
  );

  const renderInlineEmpty = (kind: string) => {
    const map: Record<string, [any, string, string, string, string]> = {
      "no-shipments": [Package, "text-blue-600", "bg-blue-50", curT.emptyShipmentsTitle, curT.emptyShipmentsSub],
      "no-notifications": [Bell, "text-emerald-600", "bg-emerald-50", curT.emptyNotifTitle, curT.emptyNotifSub],
      "no-results": [Search, "text-amber-600", "bg-amber-50", curT.emptyResultsTitle, curT.emptyResultsSub],
      "offline": [WifiOff, "text-red-500", "bg-red-50", curT.emptyOfflineTitle, curT.emptyOfflineSub],
      "gps": [MapPin, "text-slate-500", "bg-slate-100", curT.emptyGpsTitle, curT.emptyGpsSub],
    };
    const [Icon, color, bg, title, sub] = map[kind] || map["no-shipments"];
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        <div className={`w-28 h-28 rounded-[34px] ${bg} flex items-center justify-center`}><Icon className={`w-[52px] h-[52px] ${color}`} /></div>
        <div className="text-[20px] font-extrabold text-slate-900 mt-5">{title}</div>
        <div className="text-[14px] font-medium text-slate-500 leading-relaxed mt-2 max-w-[280px]">{sub}</div>
      </div>
    );
  };

  const ScreenHeader = ({ title, right }: { title: string; right?: React.ReactNode }) => (
    <div className="flex-none flex items-center justify-between px-4 h-14 bg-white border-b border-slate-200">
      <button onClick={() => setScreen(null)} className="w-10 h-10 -ms-2 flex items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100">{dirBack}</button>
      <div className="font-extrabold text-[16px] text-slate-900">{title}</div>
      <div className="w-10 flex items-center justify-end">{right}</div>
    </div>
  );

  // ── Chat conversation (reused by the Chat tab and the Details → Chat tab) ──
  const renderChatConversation = (ship: Shipment) => {
    const msgs = inquiries[ship.id] || [];
    const locked = isShipmentClosed(ship.status, ship.freightType);
    const canSend = !locked && canClientSendChatMessage({ isEmployee: viewOnly });
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[#F4F6FA]">
        <div ref={inquiryFeedRef} onScroll={handleInquiryFeedScroll} className="flex-1 overflow-y-auto px-[18px] py-3.5 space-y-2.5">
          {msgs.length === 0 && (
            <div className="text-center text-slate-400 text-[12.5px] font-semibold py-10">{curT.chatEmpty}</div>
          )}
          {msgs.map((msg: any, i: number) => {
            const sep = shouldShowDateSeparator(msg.timestamp, msgs[i - 1]?.timestamp);
            const isSystem = msg.type === "system" || msg.sender === "system" || !!msg.isSystem;
            const isAdmin = msg.sender === "admin" || (msg.senderName && (String(msg.senderName).toLowerCase().includes("admin") || String(msg.senderName).toLowerCase().includes("maras")));
            const time = new Date(msg.timestamp).toLocaleTimeString(lang === "tr" ? "tr-TR" : lang === "ar" ? "ar" : "en-US", { hour: "numeric", minute: "2-digit" });
            return (
              <div key={i}>
                {sep && <div className="flex justify-center py-1.5"><span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-500 text-[11px] font-bold">{formatDateSeparatorLabel(msg.timestamp, lang)}</span></div>}
                {isSystem ? (
                  // Refinement #6 — automatic system updates read as a subtle,
                  // centred status line, clearly distinct from human messages.
                  <div className="flex justify-center py-1">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500 text-[11.5px] font-bold">
                      <Info className="w-3.5 h-3.5 text-slate-400" /> {msg.text || statusLabel(ship.status)} · {time}
                    </span>
                  </div>
                ) : (
                  <div className={`max-w-[80%] ${isAdmin ? "" : "ms-auto"}`}>
                    <div className={`${isAdmin ? "bg-white border border-slate-200 rounded-2xl rounded-es-md text-slate-800" : "bg-blue-600 text-white rounded-2xl rounded-ee-md"} p-3`}>
                      {msg.type === "file" && (
                        <a href={msg.fileUrl || "#"} target="_blank" rel="noreferrer" onClick={(e) => { if (!msg.fileUrl || msg.fileUrl === "#") e.preventDefault(); }} className={`flex items-center gap-2.5 ${isAdmin ? "text-slate-800" : "text-white"}`}>
                          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isAdmin ? "bg-red-50 text-red-500" : "bg-white/20 text-white"}`}><FileText className="w-5 h-5" /></span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-extrabold truncate">{msg.fileName || curT.attachment}</span>
                            <span className={`block text-[11px] font-semibold ${isAdmin ? "text-slate-400" : "text-white/70"}`}>{String(msg.fileCategory || "file").toUpperCase()}</span>
                          </span>
                          <Download className={`w-4 h-4 shrink-0 ${isAdmin ? "text-slate-400" : "text-white/80"}`} />
                        </a>
                      )}
                      {msg.text && <p className={`text-[14.5px] leading-normal break-words ${msg.type === "file" ? "mt-2" : ""}`}>{msg.text}</p>}
                    </div>
                    <div className={`text-[11px] text-slate-400 font-semibold mt-1 ${isAdmin ? "ms-1" : "me-1 text-end"}`}>{isAdmin ? `${msg.senderName || "MARAS"} · ${time}` : time}</div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={inquiryFeedEndRef} />
        </div>
        {locked ? (
          <div className="flex-none p-[18px] border-t border-slate-200 bg-white"><div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500"><Lock className="w-4 h-4 text-slate-400" /> {curT.chatClosed}</div></div>
        ) : !canSend ? (
          <div className="flex-none p-[18px] border-t border-slate-200 bg-white"><div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500"><Lock className="w-4 h-4 text-slate-400" /> {curT.chatViewOnly}</div></div>
        ) : (
          <div className="flex-none border-t border-slate-200 bg-white px-3.5 py-2.5">
            {fileError && <p className="text-[11px] font-bold text-red-500 mb-1.5 px-1">{fileError}</p>}
            {inquiryStatus === "error" && <p className="text-[11px] font-bold text-red-500 mb-1.5 px-1">{curT.inquiryError}</p>}
            {selectedFile && (
              <div className="flex items-center gap-2 mb-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[12px] font-semibold text-slate-600">
                <FileText className="w-4 h-4 text-blue-600 shrink-0" /><span className="truncate flex-1">{selectedFile.name}</span>
                <button onClick={handleRemoveAttachment} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <label className="w-11 h-11 rounded-full bg-slate-100 text-blue-600 flex items-center justify-center shrink-0 cursor-pointer" title={curT.attachFile}>
                <Paperclip className="w-5 h-5" />
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleAttachmentSelect} disabled={isUploadingFile || sendingInquiry} className="hidden" />
              </label>
              <textarea
                ref={inquiryTextareaRef}
                rows={1}
                value={inquiryText}
                onChange={(e) => setInquiryText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendInquiry(ship.id); } }}
                placeholder={curT.messagePlaceholder}
                maxLength={MAX_CHAT_TEXT_LENGTH}
                disabled={sendingInquiry}
                style={{ minHeight: 44, maxHeight: INQUIRY_COMPOSER_MAX_HEIGHT_PX }}
                className="flex-1 bg-slate-100 rounded-2xl px-4 py-2.5 text-[14.5px] text-slate-900 placeholder-slate-400 outline-none resize-none leading-normal"
              />
              <button onClick={() => handleSendInquiry(ship.id)} disabled={!canSubmitChatMessage({ text: inquiryText, hasAttachment: Boolean(selectedFile), isSending: sendingInquiry, isLocked: locked })} className="w-11 h-11 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 disabled:bg-slate-300 shadow-lg shadow-blue-600/25">
                {isUploadingFile ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-[18px] h-[18px]" />}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const chatHeaderBar = (ship: Shipment) => (
    <div className="flex-none bg-white border-b border-slate-200 px-4 h-16 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0"><MessageSquare className="w-5 h-5" /></div>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold text-slate-900 truncate">MARAS Operations</div>
          <div className="flex items-center gap-2 mt-0.5"><span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10.5px] font-extrabold" dir="ltr">{ship.shipmentNumber}</span><span className="text-[11.5px] font-bold text-emerald-600">{statusLabel(ship.status)}</span></div>
        </div>
      </div>
    </div>
  );

  // ── Screens ──────────────────────────────────────────────────────────────
  const renderHome = () => {
    const s = primaryShipment;
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pt-3 pb-6">
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-[13px] font-semibold text-slate-500">{curT.hello}</div>
            <div className="text-[21px] font-extrabold tracking-tight text-slate-900 leading-tight">{clientCompanyName}</div>
          </div>
          <button id="client-notification-bell" onClick={() => setIsNotifOpen(true)} aria-label={curT.notifications} className="relative w-11 h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-600">
            <Bell className="w-5 h-5" />
            {notifications.some(n => !isNotificationReadForUser(n, clientId)) && (
              <span id="client-notification-bell-badge" className="absolute -top-1 -end-1 min-w-[17px] h-[17px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-[#F4F6FA]">
                {notifications.filter(n => !isNotificationReadForUser(n, clientId)).length}
              </span>
            )}
          </button>
        </div>

        {loading ? homeSkeleton : !s ? renderInlineEmpty("no-shipments") : (
          <>
            <div className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-slate-400 mt-1 mb-2.5 px-0.5">{curT.currentShipment}</div>
            <div className={`${CARD} p-5`}>
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-extrabold text-slate-500" dir="ltr">{s.shipmentNumber}</span>
                <span className={`px-3 py-1 rounded-full text-[12px] font-extrabold ${statusChipClass(s.status)}`}>{statusLabel(s.status)}</span>
              </div>
              <div className="flex items-center gap-2.5 mt-3">
                {countryFlag(s.loadingCountry) && <span className="text-[19px] leading-none select-none">{countryFlag(s.loadingCountry)}</span>}
                <div className="text-[21px] font-extrabold tracking-tight text-slate-900">{s.loadingCity}</div>
                <ArrowRight className={`w-[18px] h-[18px] text-slate-300 ${isRtl ? "rotate-180" : ""}`} />
                <div className="text-[21px] font-extrabold tracking-tight text-slate-900" dir="ltr">{s.deliveryCity}</div>
                {countryFlag(s.deliveryCountry) && <span className="text-[19px] leading-none select-none">{countryFlag(s.deliveryCountry)}</span>}
              </div>
              <div className="h-px bg-slate-100 my-4" />
              {journeyBar(s)}
              <div className="text-[11.5px] font-bold text-slate-400 mt-2.5">{curT.lastUpdate}: {lastUpdateOf(s)}</div>
            </div>

            <button onClick={() => openTracking(s)} className="w-full h-14 mt-4 rounded-2xl bg-blue-600 text-white font-extrabold text-[16px] flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/20">
              <Navigation className="w-5 h-5" /> {curT.trackShipment}
            </button>
            <div className="flex gap-3 mt-3">
              <button onClick={() => openChatFor(s)} className="flex-1 h-[52px] rounded-2xl bg-white border border-blue-200 text-blue-700 font-extrabold text-[15px] flex items-center justify-center gap-2">
                <MessageSquare className="w-[18px] h-[18px]" /> {curT.navChat}
              </button>
              <button onClick={() => openDetails(s)} className="flex-1 h-[52px] rounded-2xl bg-white border border-slate-200 text-slate-600 font-extrabold text-[15px] flex items-center justify-center gap-2">
                <FileText className="w-[18px] h-[18px]" /> {curT.details}
              </button>
            </div>

            <div className="flex items-center justify-between mt-5 px-1">
              {stat(curT.statTotal, totalShipments, "text-slate-900")}
              <div className="w-px h-9 bg-slate-200" />
              {stat(curT.statActive, activeShipments, "text-blue-600")}
              <div className="w-px h-9 bg-slate-200" />
              {stat(curT.statDelivered, completedShipments, "text-emerald-600")}
            </div>

            {shipments.length > 1 && (
              <>
                <div className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-slate-400 mt-6 mb-2.5 px-0.5">{curT.earlierShipments}</div>
                <div className="space-y-2.5">{shipments.filter(x => x.id !== s.id).slice(0, 3).map(x => shipmentRow(x))}</div>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  const renderShipments = () => (
    <div className="flex-1 overflow-y-auto px-[18px] pt-3 pb-6">
      <div className="flex items-center justify-between py-2">
        <div className="text-[22px] font-extrabold text-slate-900">{curT.navShipments}</div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => setScreen("search")} aria-label={curT.searchFilter} className="w-11 h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-600"><Search className="w-[19px] h-[19px]" /></button>
          <button onClick={() => setScreen("search")} aria-label={curT.searchFilter} className="w-11 h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-600"><SlidersHorizontal className="w-[19px] h-[19px]" /></button>
        </div>
      </div>
      {segmented([["all", curT.segAll], ["active", curT.segActive], ["delivered", curT.segDelivered], ["cancelled", curT.segCancelled]], statusFilter, (v) => setStatusFilter(v as any))}
      <div className="space-y-2.5 mt-3.5">
        {loading ? homeSkeleton
          : visibleShipments.length === 0 ? renderInlineEmpty(searchQuery ? "no-results" : "no-shipments")
          : visibleShipments.map(s => shipmentRow(s))}
        {shipmentsHasMore && !loading && (
          <button onClick={handleLoadMoreShipments} disabled={shipmentsLoadingMore} className="w-full py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 text-[13px] font-bold disabled:opacity-50">
            {shipmentsLoadingMore ? curT.loading : curT.loadOlder}
          </button>
        )}
      </div>
    </div>
  );

  const renderSearch = () => (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title={curT.searchFilter} right={<button onClick={() => { setSearchQuery(""); setFreightTypeFilter("all"); setStatusFilter("all"); }} className="text-[12px] font-bold text-slate-500">{curT.reset}</button>} />
      <div className="flex-1 overflow-y-auto px-[18px] py-4 space-y-5">
        <div className="h-[50px] rounded-2xl bg-white border border-blue-200 flex items-center gap-3 px-4">
          <Search className="w-[18px] h-[18px] text-blue-600" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={curT.searchPlaceholderShort} className="flex-1 bg-transparent outline-none text-[14.5px] font-semibold text-slate-900 placeholder-slate-400" />
        </div>
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2.5">{curT.freightType}</div>
          <div className="flex flex-wrap gap-2.5">
            {([["all", curT.filterAllShort], ["land", curT.mode_land], ["sea", curT.mode_sea], ["air", curT.mode_air]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFreightTypeFilter(k as any)} className={`px-4 py-2.5 rounded-full text-[13px] font-bold ${freightTypeFilter === k ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2.5">{curT.status}</div>
          <div className="flex flex-wrap gap-2.5">
            {([["all", curT.segAll], ["active", curT.segActive], ["delivered", curT.segDelivered], ["cancelled", curT.segCancelled]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setStatusFilter(k as any)} className={`px-4 py-2.5 rounded-full text-[13px] font-bold ${statusFilter === k ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-none p-[18px] border-t border-slate-200 bg-white">
        <button onClick={() => { setActiveTab("shipments"); setScreen(null); }} className="w-full h-[52px] rounded-2xl bg-blue-600 text-white font-extrabold text-[15px]">{curT.showResults} ({visibleShipments.length})</button>
      </div>
    </div>
  );

  const renderJourney = () => {
    const s = selectedShipment;
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ScreenHeader title={curT.journeyProgress} right={s ? <span className="text-[11px] font-extrabold text-blue-600" dir="ltr">{s.shipmentNumber.split("-").pop()}</span> : undefined} />
        <div className="flex-1 overflow-y-auto px-[18px] py-4">
          {!s ? renderInlineEmpty("no-shipments") : (
            <>
              <div className={`${CARD} p-4`}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-extrabold text-slate-900">{curT.step} {journeyOf(s).step} {curT.of} {journeyOf(s).total}</span>
                  <span className="text-[12px] font-bold text-slate-400">{curT.confirmedSteps}</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 mt-3 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600" style={{ width: `${journeyOf(s).pct}%` }} /></div>
              </div>
              <div className={`${CARD} p-5 mt-3.5`}>{timelineList(s)}</div>
            </>
          )}
        </div>
      </div>
    );
  };

  const timelineList = (s: Shipment) => {
    const events = (s.timeline || []) as any[];
    const seq = getStatusSequenceForFreightMode(resolveFreightMode(s.freightType));
    const curIdx = seq.indexOf(normalizeStatusForSequence(s.status as any));
    const futureSteps = curIdx >= 0 ? seq.slice(curIdx + 1) : [];
    type Row = { label: string; sub: string; state: "done" | "cur" | "pending"; details?: string };
    const rows: Row[] = [];
    events.forEach((u, i) => {
      const d = new Date(u.timestamp);
      const sub = isNaN(d.getTime()) ? u.timestamp : d.toLocaleDateString(lang === "tr" ? "tr-TR" : lang === "ar" ? "ar" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const label = lang === "tr" ? u.labelTr : lang === "ar" ? u.labelAr : u.labelEn;
      const details = lang === "tr" ? u.detailsTr : lang === "ar" ? u.detailsAr : u.detailsEn;
      rows.push({ label: label || u.status, sub, details, state: i === events.length - 1 ? "cur" : "done" });
    });
    futureSteps.forEach(st => rows.push({ label: statusLabel(st), sub: curT.pending, state: "pending" }));
    return (
      <div>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-3.5 relative pb-5 last:pb-0">
            {i < rows.length - 1 && <div className={`absolute top-9 w-0.5 ${r.state === "done" ? "bg-emerald-500" : "bg-slate-200"}`} style={{ insetInlineStart: "17px", bottom: "-4px" }} />}
            <div className={`w-[36px] h-[36px] rounded-full flex items-center justify-center shrink-0 z-10 ${r.state === "done" ? "bg-emerald-500 text-white" : r.state === "cur" ? "bg-blue-600 text-white ring-4 ring-blue-100 scale-110 shadow-lg shadow-blue-600/30" : "bg-white border-2 border-slate-200 text-slate-300"}`}>
              {r.state === "done" ? <CheckCircle2 className="w-5 h-5" /> : r.state === "cur" ? <FreightIcon s={s} className="w-[18px] h-[18px]" /> : <span className="text-[13px] font-extrabold">{i + 1}</span>}
            </div>
            <div className="min-w-0 pt-1">
              <div className={`text-[14.5px] ${r.state === "cur" ? "font-extrabold text-blue-700" : r.state === "pending" ? "font-bold text-slate-400" : "font-bold text-slate-900"}`}>{r.label}</div>
              <div className={`text-[12px] font-semibold mt-0.5 ${r.state === "cur" ? "text-blue-500" : "text-slate-400"}`}>{r.sub}</div>
              {r.details && r.state !== "pending" && <div className="text-[12px] text-slate-500 font-medium mt-1 leading-snug">{r.details}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDetails = () => {
    const s = selectedShipment;
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ScreenHeader title={curT.shipmentDetails} />
        {!s ? <div className="flex-1 overflow-y-auto px-[18px] py-4">{renderInlineEmpty("no-shipments")}</div> : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-[18px] pt-3">
              <div className={`${CARD} p-4`}>
                <div className="flex items-center justify-between"><div className="text-[18px] font-extrabold text-slate-900" dir="ltr">{s.shipmentNumber}</div><span className={`px-3 py-1 rounded-full text-[12px] font-extrabold ${statusChipClass(s.status)}`}>{statusLabel(s.status)}</span></div>
                <div className="text-[12.5px] font-semibold text-slate-500 mt-1">{s.loadingCity}, {s.loadingCountry} → {s.deliveryCity}, {s.deliveryCountry}</div>
              </div>
              <div className="flex gap-6 border-b border-slate-200 mt-3.5 px-1">
                {([["overview", curT.tabOverview], ["tracking", curT.tabTracking], ["chat", curT.navChat]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setDetailsTab(k as any)} className={`relative py-3 text-[14px] ${detailsTab === k ? "text-blue-600 font-extrabold" : "text-slate-400 font-bold"}`}>{label}{detailsTab === k && <span className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-full bg-blue-600" />}</button>
                ))}
              </div>
            </div>
            {detailsTab === "overview" && (
              <div className="flex-1 overflow-y-auto px-[18px] py-3.5 space-y-3">
                <div className={`${CARD} px-4`}>
                  {detailRow(Package, curT.cargo, s.cargoDescription || "—")}
                  {typeof s.cargoWeight === "number" && detailRow(Scale, curT.weight, `${s.cargoWeight.toLocaleString()} kg`)}
                  <div className="flex items-center justify-between py-3.5 border-b border-slate-100">
                    <span className="flex items-center gap-3 text-[14px] font-semibold text-slate-500"><span className="w-9 h-9 rounded-xl bg-slate-50 text-blue-600 flex items-center justify-center"><FreightIcon s={s} className="w-[17px] h-[17px]" /></span>{curT.freightTypeLabel}</span>
                    <span className="text-[14.5px] font-extrabold text-slate-900 text-end">{modeLabel(modeOf(s))}</span>
                  </div>
                  {s.truckNumber && detailRow(Navigation, curT.truck, s.truckNumber)}
                  {carrierRows(s)}
                  {detailRow(Clock, curT.created, fmtDate((s as any).createdAt))}
                  {detailRow(Clock, curT.lastUpdate, lastUpdateOf(s), true)}
                </div>
                <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-3.5 flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><Info className="w-[18px] h-[18px]" /></span>
                  <p className="text-[12.5px] font-semibold text-slate-600 leading-snug">{curT.filesInChatNote}</p>
                </div>
                <button onClick={() => openChatFor(s)} className="w-full h-[52px] rounded-2xl bg-blue-600 text-white font-extrabold text-[15px] flex items-center justify-center gap-2"><MessageSquare className="w-[18px] h-[18px]" /> {curT.openChat}</button>
              </div>
            )}
            {detailsTab === "tracking" && (
              <div className="flex-1 overflow-y-auto px-[18px] py-3.5 space-y-3">
                <div className={`${CARD} overflow-hidden p-0`}><ClientShipmentMap shipment={s} drivers={drivers} lang={lang} variant="card" /></div>
                <div className={`${CARD} p-3.5`}>{journeyBar(s)}</div>
                <button onClick={() => openTracking(s)} className="w-full h-[52px] rounded-2xl bg-blue-600 text-white font-extrabold text-[15px] flex items-center justify-center gap-2"><Navigation className="w-[18px] h-[18px]" /> {curT.trackShipment}</button>
                <button onClick={() => setScreen("journey")} className="w-full py-3 rounded-2xl bg-white border border-slate-200 text-slate-700 font-bold text-[13.5px]">{curT.viewTimeline}</button>
              </div>
            )}
            {detailsTab === "chat" && renderChatConversation(s)}
          </div>
        )}
      </div>
    );
  };

  const renderTracking = () => {
    const s = selectedShipment;
    if (!s) {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <ScreenHeader title={curT.trackShipment} />
          <div className="flex-1 overflow-y-auto">{renderInlineEmpty("no-shipments")}</div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col min-h-0 relative bg-slate-100">
        <div className="absolute inset-0"><ClientShipmentMap shipment={s} drivers={drivers} lang={lang} variant="fill" /></div>
        <div className="relative z-10 flex items-center justify-between px-4 pt-3">
          <button onClick={() => setScreen(null)} aria-label="Back" className="w-11 h-11 rounded-2xl bg-white shadow-md flex items-center justify-center text-slate-700">{dirBack}</button>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white shadow-md text-[12px] font-extrabold text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500" />{curT.live}</span>
            <button onClick={fetchDashboardData} aria-label="Refresh" className="w-11 h-11 rounded-2xl bg-white shadow-md flex items-center justify-center text-slate-700"><RefreshCw className={`w-[18px] h-[18px] ${loading ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
        <div className="flex-1" />
        {/* Refinement #2 — taller, more readable info sheet. */}
        <div className="relative z-10 bg-[#F4F6FA] rounded-t-3xl px-[18px] pt-3 pb-5 shadow-[0_-10px_40px_rgba(15,27,45,0.12)]">
          <div className="w-11 h-1.5 rounded-full bg-slate-300 mx-auto mb-3.5" />
          <div className="flex items-center justify-between">
            <div><div className="text-[18px] font-extrabold text-slate-900" dir="ltr">{s.shipmentNumber}</div><div className="text-[12.5px] font-semibold text-slate-500">{s.loadingCity} → {s.deliveryCity}</div></div>
            <span className={`px-3 py-1 rounded-full text-[12px] font-extrabold ${statusChipClass(s.status)}`}>{statusLabel(s.status)}</span>
          </div>
          <div className={`${CARD} p-3.5 mt-3.5`}>{journeyBar(s)}</div>
          <div className="flex gap-3 mt-3">
            <div className={`${CARD} flex-1 p-3.5`}><div className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">{curT.lastUpdate}</div><div className="text-[14px] font-extrabold text-slate-900 mt-1">{lastUpdateOf(s)}</div></div>
            <div className={`${CARD} flex-1 p-3.5`}><div className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">{curT.estArrival}</div><div className="text-[13px] font-bold text-slate-500 mt-1">{s.eta ? fmtDate(s.eta) : curT.sharedByMaras}</div></div>
          </div>
          <button onClick={() => setScreen("journey")} className="w-full mt-3 py-3 rounded-2xl bg-white border border-slate-200 text-slate-700 font-bold text-[13.5px] flex items-center justify-center gap-2">{curT.viewTimeline}<ChevronRight className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} /></button>
          <div className="text-[11px] text-slate-400 font-semibold text-center mt-2.5">{curT.smartTrackingNote}</div>
        </div>
      </div>
    );
  };

  const renderChatTab = () => {
    const ship = chatShipment;
    if (!ship) {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-none bg-white border-b border-slate-200 px-4 h-16 flex items-center"><div className="text-[18px] font-extrabold text-slate-900">{curT.navChat}</div></div>
          <div className="flex-1 overflow-y-auto">{renderInlineEmpty("no-shipments")}</div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {chatHeaderBar(ship)}
        {renderChatConversation(ship)}
      </div>
    );
  };

  const profileRow = (Icon: any, label: string, onClick: () => void, value?: string) => (
    <button onClick={onClick} className="w-full flex items-center justify-between px-[18px] py-4 border-b border-slate-100 last:border-0">
      <span className="flex items-center gap-3.5 text-[15px] font-bold text-slate-900"><span className="w-9 h-9 rounded-xl bg-slate-50 text-blue-600 flex items-center justify-center"><Icon className="w-[17px] h-[17px]" /></span>{label}</span>
      <span className="flex items-center gap-2 text-[13.5px] font-bold text-slate-400">{value}<ChevronRight className={`w-[17px] h-[17px] ${isRtl ? "rotate-180" : ""}`} /></span>
    </button>
  );

  const renderProfile = () => (
    <div className="flex-1 overflow-y-auto px-[18px] pt-3 pb-6">
      <div className="text-[22px] font-extrabold text-slate-900 py-2">{curT.navProfile}</div>
      <div className={`${CARD} p-5 flex items-center gap-4`}>
        <div className="w-[60px] h-[60px] rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-white flex items-center justify-center text-[21px] font-extrabold shrink-0">{initials(clientCompanyName)}</div>
        <div className="min-w-0"><div className="text-[18px] font-extrabold text-slate-900 truncate">{clientCompanyName}</div><div className="text-[12.5px] font-semibold text-slate-500 truncate">{clientEmail}</div><span className="inline-block mt-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10.5px] font-extrabold">{viewOnly ? curT.clientStaff : curT.verified}</span></div>
      </div>
      <div className={`${CARD} mt-3.5 overflow-hidden`}>
        {profileRow(Building2, curT.companyInfo, () => setScreen("company"))}
        {profileRow(Bell, curT.notifSettings, () => setScreen("notifSettings"))}
        {profileRow(Globe, curT.language, () => setScreen("language"), langLabel(lang))}
      </div>
      <div className={`${CARD} mt-3.5 overflow-hidden`}>
        {profileRow(LifeBuoy, curT.help, () => { })}
        {profileRow(Info, curT.about, () => { })}
        {profileRow(Shield, curT.privacy, () => { })}
      </div>
      <div className={`${CARD} mt-3.5 overflow-hidden`}>
        <button onClick={onLogout} className="w-full flex items-center px-[18px] py-4">
          <span className="flex items-center gap-3.5 text-[15px] font-bold text-red-600"><span className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center"><LogOut className="w-[17px] h-[17px]" /></span>{curT.signOut}</span>
        </button>
      </div>
      <div className="text-center mt-5">
        <button onClick={() => { setShowClientDeleteConfirm(true); setUnderstandClientDelete(false); setClientDeleteError(null); setClientDeleteCurrentPassword(""); }} className="text-[12px] font-semibold text-slate-400 hover:text-red-500">{curT.deleteAccount}</button>
      </div>
      <div className="text-center text-[11px] font-semibold text-slate-300 mt-2">eTIR by MARAS · {curT.customerApp}</div>
    </div>
  );

  const renderCompany = () => (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title={curT.companyInfo} />
      <div className="flex-1 overflow-y-auto px-[18px] py-4">
        <div className={`${CARD} px-4`}>
          {detailRow(Building2, curT.companyName, clientCompanyName)}
          {detailRow(Mail, curT.email, clientEmail || "—", true)}
        </div>
        <p className="text-[12px] text-slate-400 font-semibold mt-3 px-1 leading-snug">{curT.companyInfoNote}</p>
      </div>
    </div>
  );

  const renderNotifSettings = () => (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title={curT.notifSettings} />
      <div className="flex-1 overflow-y-auto px-[18px] py-4 space-y-3">
        <div className={`${CARD} p-4 flex items-center justify-between`}>
          <div className="min-w-0 pe-3"><div className="text-[15px] font-extrabold text-slate-900">{curT.soundAlerts}</div><div className="text-[12.5px] font-semibold text-slate-500 mt-0.5">{curT.soundAlertsNote}</div></div>
          <button onClick={() => setNotifSoundEnabled(v => !v)} aria-label={curT.soundAlerts} className={`w-[52px] h-[31px] rounded-full relative shrink-0 transition-colors ${notifSoundEnabled ? "bg-blue-600" : "bg-slate-300"}`}>
            <span className={`absolute top-[3px] w-[25px] h-[25px] rounded-full bg-white shadow transition-all ${notifSoundEnabled ? "end-[3px]" : "start-[3px]"}`} />
          </button>
        </div>
        <p className="text-[12px] text-slate-400 font-semibold px-1 leading-snug">{curT.notifSettingsNote}</p>
      </div>
    </div>
  );

  const renderLanguage = () => (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title={curT.language} />
      <div className="flex-1 overflow-y-auto px-[18px] py-4 space-y-3">
        {([["en", "English", "English"], ["ar", "العربية", "Arabic · RTL"], ["tr", "Türkçe", "Turkish"]] as const).map(([code, name, sub]) => (
          <button key={code} onClick={() => onLanguageChange && onLanguageChange(code as Language)} className={`${CARD} w-full p-4 flex items-center justify-between ${lang === code ? "ring-2 ring-blue-500 border-blue-500" : ""}`}>
            <div className="text-start"><div className="text-[16px] font-extrabold text-slate-900">{name}</div><div className="text-[12px] font-semibold text-slate-400 mt-0.5">{sub}</div></div>
            <span className={`w-7 h-7 rounded-full flex items-center justify-center ${lang === code ? "bg-blue-600 text-white" : "border-2 border-slate-200"}`}>{lang === code ? <CheckCircle2 className="w-4 h-4" /> : null}</span>
          </button>
        ))}
        <p className="text-[12px] text-slate-400 font-semibold text-center mt-1">{curT.languageNote}</p>
      </div>
    </div>
  );

  const bottomNav = (
    <nav className="flex-none bg-white border-t border-slate-200 grid grid-cols-4 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {([["home", curT.navHome, Home], ["shipments", curT.navShipments, Package], ["chat", curT.navChat, MessageSquare], ["profile", curT.navProfile, User]] as const).map(([key, label, Icon]) => {
        const on = activeTab === key;
        return (
          <button key={key} onClick={() => { setScreen(null); setActiveTab(key); }} className="flex flex-col items-center gap-1 py-1.5 rounded-xl">
            <Icon className={`w-6 h-6 ${on ? "text-blue-600" : "text-slate-400"}`} strokeWidth={on ? 2.4 : 2} />
            <span className={`text-[10.5px] ${on ? "text-blue-600 font-extrabold" : "text-slate-400 font-semibold"}`}>{label}</span>
            <span className={`h-[3px] w-4 rounded-full ${on ? "bg-blue-600" : "bg-transparent"}`} />
          </button>
        );
      })}
    </nav>
  );

  const notifOverlay = isNotifOpen ? (
    <div id="notifications-overlay" className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsNotifOpen(false)} />
      <div className="relative w-full max-w-md bg-[#F4F6FA] h-full flex flex-col shadow-2xl">
        <div className="flex-none bg-white border-b border-slate-200 px-4 h-16 flex items-center justify-between">
          <div>
            <div className="text-[16px] font-extrabold text-slate-900">{curT.notifications}</div>
            <div className="text-[11.5px] font-semibold text-slate-400">{notifications.filter(n => !isNotificationReadForUser(n, clientId)).length} {curT.unread}</div>
          </div>
          <div className="flex items-center gap-2">
            {notifications.some(n => !isNotificationReadForUser(n, clientId)) && <button onClick={handleMarkAllRead} className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-extrabold">{curT.markAllReadShort}</button>}
            <button onClick={() => setIsNotifOpen(false)} aria-label={curT.close} className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
          {notifications.length === 0 ? renderInlineEmpty("no-notifications") : [...notifications].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((notif) => {
            const title = lang === "en" ? notif.titleEn : (lang === "tr" ? notif.titleTr : notif.titleAr);
            const msg = lang === "en" ? notif.messageEn : (lang === "tr" ? notif.messageTr : notif.messageAr);
            const unread = !isNotificationReadForUser(notif, clientId);
            return (
              <div key={notif.id} className={`${CARD} p-4 ${unread ? "border-blue-200" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Bell className="w-[18px] h-[18px]" /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="text-[10.5px] font-extrabold text-slate-400" dir="ltr">#{notif.shipmentNumber}</span>{unread && <span className="w-2 h-2 rounded-full bg-orange-500" />}</div>
                    <div className="text-[14px] font-extrabold text-slate-900 mt-0.5">{title}</div>
                    <div className="text-[12.5px] font-medium text-slate-500 mt-0.5 leading-snug">{msg}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] font-semibold text-slate-400">{new Date(notif.timestamp).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { month: "short", day: "numeric" })} · {new Date(notif.timestamp).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", { hour: "numeric", minute: "2-digit" })}</span>
                      {notif.shipmentId && <button onClick={async () => { setIsNotifOpen(false); await openShipmentById(notif.shipmentId); setDetailsTab("overview"); setScreen("details"); }} className="text-blue-600 font-extrabold text-[12px] flex items-center gap-0.5">{curT.track}<ChevronRight className={`w-3.5 h-3.5 ${isRtl ? "rotate-180" : ""}`} /></button>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  const deleteModal = showClientDeleteConfirm ? (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 text-start" dir={isRtl ? "rtl" : "ltr"}>
      <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-red-50 flex items-center justify-center text-red-500 shrink-0"><ShieldAlert className="w-5 h-5" /></div>
          <div>
            <h3 className="font-extrabold text-[17px] text-slate-900">{lang === "tr" ? "Hesabınızı Kalıcı Olarak Silin" : (lang === "ar" ? "حذف حساب العميل نهائياً" : "Permanently Delete Account")}</h3>
            <p className="text-[13px] text-slate-500 leading-relaxed mt-1">{accountDeletionCopy(lang).privacyNotice}</p>
          </div>
        </div>
        {clientDeleteError && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-[12.5px] text-red-600 leading-relaxed">
            {clientDeleteError === "missing" ? accountDeletionCopy(lang).missingPasswordError
              : clientDeleteError === "incorrect" ? accountDeletionCopy(lang).incorrectPasswordError
              : clientDeleteError === "rate_limited" ? accountDeletionCopy(lang).rateLimitedError
              : clientDeleteError === "service_unavailable" ? accountDeletionCopy(lang).serviceUnavailableError
              : clientDeleteError === "network" ? accountDeletionCopy(lang).networkFailureError
              : accountDeletionCopy(lang).genericFailureError}
          </div>
        )}
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
          <label className="text-[13px] font-bold text-slate-700 block">{accountDeletionCopy(lang).passwordLabel}</label>
          <input type="password" autoComplete="current-password" value={clientDeleteCurrentPassword} onChange={(e) => setClientDeleteCurrentPassword(e.target.value)} placeholder={accountDeletionCopy(lang).passwordPlaceholder} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 text-[13px] focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none" />
          <label className="flex items-start gap-3 cursor-pointer text-[13px] font-semibold text-slate-700">
            <input type="checkbox" checked={understandClientDelete} onChange={(e) => setUnderstandClientDelete(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-red-500 accent-red-500 mt-0.5" />
            <span className="leading-normal">{lang === "tr" ? "Tüm kurumsal erişimlerimin kaldırılmasını kabul ediyorum." : (lang === "ar" ? "أوافق على إلغاء ترخيص حسابي وإزالة جميع الصلاحيات." : "I consent to permanently cancel my account and release all records associated with this client ID.")}</span>
          </label>
        </div>
        <div className="flex gap-3">
          <button type="button" disabled={isDeletingClientAccount} onClick={() => setShowClientDeleteConfirm(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[13px] rounded-xl transition-all">{lang === "tr" ? "İptal" : (lang === "ar" ? "إلغاء" : "Cancel")}</button>
          <button type="button" disabled={isDeletingClientAccount || !understandClientDelete} onClick={handleDeleteClientAccount} className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-extrabold text-[13px] rounded-xl transition-all flex items-center justify-center gap-1.5">
            {isDeletingClientAccount ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>{accountDeletionCopy(lang).deletingLabel}</span></> : <><Trash2 className="w-4 h-4" /><span>{lang === "tr" ? "Hesabı Sil" : (lang === "ar" ? "حذف الحساب" : "Delete")}</span></>}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const toast = toastMessage ? (
    <div id="notifications-toast" className="fixed bottom-24 inset-x-4 z-50 max-w-md mx-auto p-4 bg-white border border-slate-200 rounded-2xl shadow-2xl flex items-center justify-between gap-3 text-[13px] font-semibold text-slate-800">
      <span className="min-w-0">{toastMessage}</span>
      <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-700 shrink-0"><X className="w-4 h-4" /></button>
    </div>
  ) : null;

  return (
    <div className="h-full flex flex-col bg-[#F4F6FA] text-slate-900 select-none" dir={isRtl ? "rtl" : "ltr"}>
      {screen === "tracking" ? renderTracking()
        : screen === "journey" ? renderJourney()
        : screen === "details" ? renderDetails()
        : screen === "search" ? renderSearch()
        : screen === "company" ? renderCompany()
        : screen === "notifSettings" ? renderNotifSettings()
        : screen === "language" ? renderLanguage()
        : activeTab === "home" ? renderHome()
        : activeTab === "shipments" ? renderShipments()
        : activeTab === "chat" ? renderChatTab()
        : renderProfile()}
      {!screen && bottomNav}
      {notifOverlay}
      {deleteModal}
      {toast}
    </div>
  );
}
