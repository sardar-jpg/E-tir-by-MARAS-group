import React, { useState, useEffect } from "react";
import { Language, Shipment, Driver, ShipmentDocument, LocationUpdate } from "../types";
import { 
  Ship, Globe, Star, Truck, Calendar, DollarSign, Eye, EyeOff, MapPin, 
  Search, Shield, Clipboard, ArrowRight, MessageSquare, CheckCircle2, 
  FileText, Download, Clock, ChevronRight, X, Send, HelpCircle, 
  Activity, RefreshCw, Bell, Lock, Trash2, ShieldAlert
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { auth } from "../googleAuth";
import TrackingMap from "./TrackingMap";

// Local multilingual dictionary
const t = {
  en: {
    welcome: "Welcome back,",
    subtitle: "etir Customer Access & Logistics Hub",
    statsTotal: "Total Shipments",
    statsActive: "Active In-Transit",
    statsCompleted: "Deliveries Completed",
    statsFinancial: "Corporate Account Status",
    activeStatus: "Operational / Active",
    noShipments: "No shipments found matching your account criteria.",
    searchPlaceholder: "Search by Shipment ID, Plate, City, or Cargo...",
    filterAll: "All Cargo Services",
    filterLand: "Land Transport (TIR)",
    filterSea: "Ocean Freight (Sea)",
    filterAir: "Air Express (Air)",
    cargoDesc: "Cargo Description",
    weight: "Gross Weight",
    route: "Transportation Route",
    origin: "Origin / Loading",
    destination: "Destination / Discharge",
    assignedTruck: "Transport Fleet Plate",
    assignedDriver: "Operations Handler",
    cargoValue: "Agreed Freight Value",
    documents: "Corporate Shipment Docs",
    noDocs: "No corporate documents have been released yet by dispatch offices.",
    timeline: "Real-time Transport Progress",
    inquiryTitle: "Logistics Support & Inquiries",
    inquiryDesc: "Submit an inquiry directly to MARAS Operations Support for this shipment.",
    inquirySuccess: "Your inquiry has been logged successfully and forwarded to MARAS dispatchers.",
    inquiryError: "Could not send inquiry. Please try again.",
    inquiryPlaceholder: "Type your operational message or cargo concern...",
    submitInquiry: "Dispatch Support Inquiry",
    viewMap: "Live Tracking Satellite Map",
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
    notifications: "Notifications"
  },
  tr: {
    welcome: "Tekrar hoş geldiniz,",
    subtitle: "etir Müşteri Erişim & Lojistik Portalı",
    statsTotal: "Toplam Sevkiyat",
    statsActive: "Aktif Taşıma",
    statsCompleted: "Tamamlanan Teslimat",
    statsFinancial: "Kurumsal Hesap Durumu",
    activeStatus: "Operasyonel / Aktif",
    noShipments: "Hesap kriterlerinize uygun sevkiyat bulunamadı.",
    searchPlaceholder: "Sevkiyat No, Plaka, Şehir veya Yük ile ara...",
    filterAll: "Tüm Kargo Hizmetleri",
    filterLand: "Karayolu (TIR)",
    filterSea: "Denizyolu (Konteyner)",
    filterAir: "Havayolu Küresel",
    cargoDesc: "Yük / Kargo Açıklaması",
    weight: "Brüt Ağırlık",
    route: "Taşıma Güzergahı",
    origin: "Yükleme Noktası",
    destination: "Teslimat Noktası",
    assignedTruck: "Plaka / Çekici No",
    assignedDriver: "Yol Kaptanı",
    cargoValue: "Anlaşılan Navlun Tutarı",
    documents: "Resmi Sevkiyat Belgeleri",
    noDocs: "Bu sevkiyat için henüz evrak serbest bırakılmadı.",
    timeline: "Gerçek Zamanlı Yolculuk Zaman Tüneli",
    inquiryTitle: "Lojistik Destek Talepleri",
    inquiryDesc: "Bu sevkiyat ile ilgili MARAS Operasyon Ekibine hızlıca destek talebi iletin.",
    inquirySuccess: "Destek talebiniz başarıyla kaydedilmiş ve MARAS operasyon ekibine iletilmiştir.",
    inquiryError: "Talep gönderilemedi. Lütfen tekrar deneyin.",
    inquiryPlaceholder: "Yükün durumu veya operasyonel sorularınızı buraya yazın...",
    submitInquiry: "Operasyonel Talep Gönder",
    viewMap: "Canlı Uydu Takip Haritası",
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
    notifications: "Bildirimler"
  },
  ar: {
    welcome: "مرحباً بك مجدداً،",
    subtitle: "بوابة etir لعملاء الشحن وإدارة الخدمات اللوجستية",
    statsTotal: "إجمالي الشحنات",
    statsActive: "الناشطة قيد النقل",
    statsCompleted: "الشحنات المستلمة كلياً",
    statsFinancial: "الحالة المالية للحساب المؤتمن",
    activeStatus: "في النطاق العملياتي / نشط",
    noShipments: "لم يتم العثور على أي شحنات مرتبطة ببيانات شركتكم حالياً.",
    searchPlaceholder: "البحث برقم الشحنة، اللوحة، المدينة أو نوع البضاعة...",
    filterAll: "كافة قطاعات النقل",
    filterLand: "الشحن البري (TIR)",
    filterSea: "الشحن البحري (حاويات)",
    filterAir: "الشحن الجوي السريع",
    cargoDesc: "وصف الحمولة والبضاعة",
    weight: "الوزن الإجمالي",
    route: "مسار حركة الشحن",
    origin: "ميناء وموقع الشحن",
    destination: "موقع التسليم النهائي",
    assignedTruck: "رقم لوحة الشاحنة الدولية",
    assignedDriver: "قائد مركبة الشحن",
    cargoValue: "تكلفة الشحن المتفق عليها",
    documents: "المستندات والمعاملات الرسمية",
    noDocs: "لم يتم إصدار أو إرفاق مستندات رسمية لهذه الشحنة حتى الآن.",
    timeline: "الخط الزمني الفعلي لمسار الرحلة",
    inquiryTitle: "إرسال الاستفسارات والطلبات اللوجستية",
    inquiryDesc: "أرسل استفساراً سريعاً ومباشراً إلى مركز عمليات MARAS بخصوص هذه الشحنة.",
    inquirySuccess: "تم تسجيل استفسارك بنجاح وإرساله فوراً للمسؤولين في MARAS.",
    inquiryError: "فشل إرسال طلب الدعم. يرجى المحاولة لاحقاً.",
    inquiryPlaceholder: "تفاصيل استفسارك أو أسئلتك اللوجستية حول الحمولة...",
    submitInquiry: "إرسال طلب الدعم الفني",
    viewMap: "خارطة التتبع بالأقمار الصناعية",
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
    notifications: "الإشعارات"
  }
};

interface ClientDashboardProps {
  lang: Language;
  clientCompanyName: string;
  clientEmail: string;
  clientId: string;
  onLogout: () => void;
  isMobile?: boolean;
  viewOnly?: boolean;
}

export default function ClientDashboard({ lang, clientCompanyName, clientEmail, clientId, onLogout, isMobile = false, viewOnly = false }: ClientDashboardProps) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [freightTypeFilter, setFreightTypeFilter] = useState<'all' | 'land' | 'sea' | 'air'>('all');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);

  // Chat/Inquiry States
  const [inquiries, setInquiries] = useState<{[shipmentId: string]: any[]}>({});
  const [inquiryText, setInquiryText] = useState("");
  const [sendingInquiry, setSendingInquiry] = useState(false);
  const [inquiryStatus, setInquiryStatus] = useState<"idle" | "success" | "error">("idle");

  // Real-time Notification Center States
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const knownNotificationIdsRef = React.useRef<Set<string>>(new Set());

  // Client Account Deletion States
  const [showClientDeleteConfirm, setShowClientDeleteConfirm] = useState(false);
  const [understandClientDelete, setUnderstandClientDelete] = useState(false);
  const [isDeletingClientAccount, setIsDeletingClientAccount] = useState(false);

  const handleDeleteClientAccount = async () => {
    if (!understandClientDelete) return;
    setIsDeletingClientAccount(true);
    try {
      // 1. Delete backing collection data
      const response = await apiFetch(`/api/clients/${clientId}`, {
        method: "DELETE"
      });
      if (response.ok) {
        // 2. Delete user session from Firebase auth (if exists)
        try {
          if (auth.currentUser) {
            await auth.currentUser.delete();
          }
        } catch (authErr) {
          console.warn("Firebase Auth deletion failed or requires reauthentication:", authErr);
        }
        setToastMessage(lang === 'tr' ? "🗑️ Hesabınız tamamen silindi." : (lang === 'ar' ? "🗑️ تم حذف حسابكم بالكامل." : "🗑️ Your customer account was completely deleted."));
        // Logout user session and clean state
        if (onLogout) {
          setTimeout(onLogout, 2000);
        }
      } else {
        setToastMessage("❌ Failed to delete customer account. Try again.");
      }
    } catch (err) {
      console.error(err);
      setToastMessage("❌ Communication issue. Retry account purge.");
    } finally {
      setIsDeletingClientAccount(false);
      setShowClientDeleteConfirm(false);
    }
  };

  const curT = t[lang] || t.en;
  const isRtl = lang === "ar";

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
          const allNotifications = JSON.parse(text);
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
                if (!notif.read) {
                  hasNew = true;
                  const title = lang === 'en' ? notif.titleEn : (lang === 'tr' ? notif.titleTr : notif.titleAr);
                  const msg = lang === 'en' ? notif.messageEn : (lang === 'tr' ? notif.messageTr : notif.messageAr);
                  setToastMessage(`🔔 ${title}: ${msg}`);
                }
              }
            }
            if (hasNew) {
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

  const handleMarkAllRead = async () => {
    try {
      const unread = notifications.filter(n => !n.read);
      if (unread.length === 0) return;
      
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      
      await Promise.all(unread.map(n => 
        apiFetch(`/api/notifications/${n.id}/read`, { method: "POST" })
      ));
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      // Fetch core logistics datasets using apiFetch
      const resShipments = await apiFetch("/api/shipments");
      const resDrivers = await apiFetch("/api/drivers");

      let allShipments: Shipment[] = [];
      let allDrivers: Driver[] = [];

      if (resShipments.ok) {
        const text = await resShipments.text();
        if (!text.trim().startsWith("<")) {
          allShipments = JSON.parse(text);
        }
      }

      if (resDrivers.ok) {
        const text = await resDrivers.text();
        if (!text.trim().startsWith("<")) {
          allDrivers = JSON.parse(text);
        }
      }

      // Filter shipments strictly belonging to this corporate client
      const myShipments = allShipments.filter(s => 
        (s.companyName || "").toLowerCase().trim() === clientCompanyName.toLowerCase().trim()
      );

      setShipments(myShipments);
      setDrivers(allDrivers);

      // Fetch customer notifications
      try {
        const resNotifications = await apiFetch("/api/notifications");
        if (resNotifications.ok) {
          const text = await resNotifications.text();
          if (!text.trim().startsWith("<")) {
            const allNotifications = JSON.parse(text);
            const myShipmentIds = new Set(myShipments.map(s => s.id));
            const myNotifs = allNotifications.filter((n: any) => 
              n.shipmentId && 
              myShipmentIds.has(n.shipmentId) && 
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
              const msgs = JSON.parse(chatText);
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

  const handleSendInquiry = async (shipmentId: string) => {
    if (!inquiryText.trim()) return;
    setSendingInquiry(true);
    setInquiryStatus("idle");

    try {
      const res = await apiFetch(`/api/shipments/${shipmentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "client",
          senderName: `${clientCompanyName} (${lang === "ar" ? "عميل" : "Client"})`,
          type: "text",
          text: inquiryText.trim()
        })
      });

      if (res.ok) {
        setInquiryText("");
        setInquiryStatus("success");
        setTimeout(() => setInquiryStatus("idle"), 5000);
        // Refresh chats
        const resChat = await apiFetch(`/api/shipments/${shipmentId}/chat`);
        if (resChat.ok) {
          const chatText = await resChat.text();
          if (!chatText.trim().startsWith("<")) {
            const msgs = JSON.parse(chatText);
            setInquiries(prev => ({ ...prev, [shipmentId]: msgs }));
          }
        }
      } else {
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
  const totalShipments = shipments.length;
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

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto p-4 md:p-6 text-slate-100 font-sans" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* 1. Client Greeting Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5 text-left">
          <span className="text-xs uppercase text-orange-500 font-extrabold tracking-widest">{curT.subtitle}</span>
          <h2 className="text-xl md:text-2xl font-black text-white leading-tight">
            {curT.welcome} <span className="text-orange-400">{clientCompanyName}</span>
          </h2>
          <p className="text-xs text-slate-400 max-w-lg font-medium">
            Authorized Account Profile: <strong className="text-slate-200">{clientEmail}</strong> (Secure API Client-ID: {clientId})
          </p>
        </div>

        <div className="flex items-center gap-3">
          {viewOnly && (
            <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              View Only
            </span>
          )}

          {/* Bell Icon for Notifications */}
          <button
            id="client-notification-bell"
            onClick={() => setIsNotifOpen(true)}
            className="p-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700/80 rounded-xl text-slate-300 transition-all cursor-pointer inline-flex items-center justify-center relative"
            title={curT.notifications}
          >
            <Bell className="w-4 h-4 animate-bounce" />
            {notifications.some(n => !n.read) && (
              <span id="client-notification-bell-badge" className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-slate-950 animate-pulse"></span>
            )}
          </button>

          <button
            onClick={fetchDashboardData}
            disabled={loading}
            className="p-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700/80 rounded-xl text-slate-300 transition-all cursor-pointer inline-flex items-center justify-center disabled:opacity-50"
            title="Refresh Operations Stream"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {!viewOnly && (
            <button
              type="button"
              onClick={() => {
                setShowClientDeleteConfirm(true);
                setUnderstandClientDelete(false);
              }}
              className="px-4 py-2.5 bg-red-950/10 hover:bg-red-950/20 border border-red-900/30 hover:border-red-500/20 text-red-400 font-bold rounded-xl text-xs shadow transition-all cursor-pointer flex items-center gap-1 shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>{lang === 'tr' ? "Hesabı Sil" : (lang === 'ar' ? "حذف الحساب" : "Delete Account")}</span>
            </button>
          )}

          <button
            onClick={onLogout}
            className="px-4 py-2.5 bg-red-950/20 hover:bg-red-950/40 border border-red-900/40 hover:border-red-500/30 text-red-50 px-4 text-red-400 font-bold rounded-xl text-xs shadow-lg transition-all cursor-pointer shrink-0"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* 2. Bento Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Shipments */}
        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl flex items-center justify-between shadow text-left">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{curT.statsTotal}</span>
            <span className="text-2xl font-black text-white">{totalShipments}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-950 flex items-center justify-center text-blue-400 border border-slate-800">
            <Clipboard className="w-5 h-5" />
          </div>
        </div>

        {/* Active Transits */}
        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl flex items-center justify-between shadow text-left">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{curT.statsActive}</span>
            <span className="text-2xl font-black text-orange-400">{activeShipments}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-950 flex items-center justify-center text-orange-400 border border-slate-800">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
        </div>

        {/* Deliveries Completed */}
        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl flex items-center justify-between shadow text-left">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{curT.statsCompleted}</span>
            <span className="text-2xl font-black text-emerald-400">{completedShipments}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-950 flex items-center justify-center text-emerald-400 border border-slate-800">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        {/* Financial Status */}
        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl flex items-center justify-between shadow text-left">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">{curT.statsFinancial}</span>
            <span className="text-xs font-bold text-emerald-400 bg-emerald-900/20 border border-emerald-900/40 px-2 py-0.5 rounded-lg inline-block">
              Good Credit Rating
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-950 flex items-center justify-center text-blue-400 border border-slate-800">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Filter Navigation & Searches */}
      <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-2xl flex flex-col lg:flex-row gap-4 justify-between items-center">
        {/* Navigation Categories Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/80 p-1 border border-slate-800 rounded-xl w-full lg:w-auto">
          <button
            onClick={() => setFreightTypeFilter('all')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              freightTypeFilter === 'all' ? "bg-orange-600 text-white shadow shadow-orange-500/20" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {curT.filterAll}
          </button>
          <button
            onClick={() => setFreightTypeFilter('land')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              freightTypeFilter === 'land' ? "bg-orange-600 text-white shadow shadow-orange-500/20" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {curT.filterLand}
          </button>
          <button
            onClick={() => setFreightTypeFilter('sea')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              freightTypeFilter === 'sea' ? "bg-orange-600 text-white shadow shadow-orange-500/20" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {curT.filterSea}
          </button>
          <button
            onClick={() => setFreightTypeFilter('air')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              freightTypeFilter === 'air' ? "bg-orange-600 text-white shadow shadow-orange-500/20" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {curT.filterAir}
          </button>
        </div>

        {/* Fast Action search bar */}
        <div className="relative w-full lg:w-72">
          <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={curT.searchPlaceholder}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-orange-500 rounded-xl text-xs text-slate-100 placeholder-slate-500 font-semibold focus:outline-none transition-all text-left"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-4 py-8">
          <div className="animate-pulse h-28 bg-slate-900 border border-slate-800 rounded-2xl w-full"></div>
          <div className="animate-pulse h-28 bg-slate-900 border border-slate-800 rounded-2xl w-full"></div>
          <div className="animate-pulse h-28 bg-slate-900 border border-slate-800 rounded-2xl w-full"></div>
        </div>
      ) : filteredShipments.length === 0 ? (
        <div className="bg-slate-900 dark:bg-slate-900 p-8 rounded-2xl border border-slate-800/80 text-center text-slate-400 font-medium text-xs">
          {curT.noShipments}
        </div>
      ) : (
        /* 4. Active Shipments Layout Split */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT: Shipments Cards Stream */}
          <div className="lg:col-span-5 space-y-4 h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {filteredShipments.map(ship => {
              const isSelected = selectedShipment?.id === ship.id;
              const typeLabel = ship.freightType === "sea" ? "Sea 🚢" : ship.freightType === "air" ? "Air ✈️" : "Land 🚛";
              
              const isDeliverPiled = ["Delivered", "Completed", "Closed"].includes(ship.status);
              
              return (
                <div
                  key={ship.id}
                  onClick={() => setSelectedShipment(ship)}
                  className={`bg-slate-900 border p-4 rounded-2xl transition-all cursor-pointer text-left space-y-3 relative overflow-hidden flex flex-col justify-between ${
                    isSelected 
                      ? "ring-1 ring-orange-500 border-orange-500/80 bg-slate-900/90 shadow-lg shadow-orange-500/5" 
                      : "border-slate-800 hover:border-slate-700 hover:bg-slate-900/60"
                  }`}
                >
                  {/* Card Status Banner indicators */}
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black text-white selectable">{ship.shipmentNumber}</span>
                      <span className="px-2 py-0.5 bg-slate-950 border border-slate-800 text-[9px] font-black text-slate-300 rounded-lg">
                        {typeLabel}
                      </span>
                    </div>

                    <span className={`px-2.5 py-1 text-[9px] font-black uppercase rounded-lg border tracking-wide ${
                      isDeliverPiled 
                        ? "bg-emerald-950/30 text-emerald-400 border-emerald-900/40" 
                        : "bg-orange-950/30 text-orange-400 border-orange-900/40 animate-pulse"
                    }`}>
                      {ship.status}
                    </span>
                  </div>

                  {/* Route flow overview */}
                  <div className="grid grid-cols-7 items-center text-[11px] font-semibold text-slate-300">
                    <div className="col-span-3 text-left">
                      <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">{ship.loadingCountry}</p>
                      <p className="font-extrabold text-white line-clamp-1">{ship.loadingCity}</p>
                    </div>
                    
                    <div className="col-span-1 flex justify-center items-center">
                      <ArrowRight className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                    </div>

                    <div className="col-span-3 text-right">
                      <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider" dir="ltr">{ship.deliveryCountry}</p>
                      <p className="font-extrabold text-white line-clamp-1" dir="ltr">{ship.deliveryCity}</p>
                    </div>
                  </div>

                  {/* Weight, Plate info */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800 pt-3">
                    <div className="flex items-center gap-1">
                      <Truck className="w-3.5 h-3.5 text-slate-500" />
                      <span className="font-bold text-slate-300">{ship.truckNumber || "M-7733-IQ"}</span>
                    </div>
                    <p className="text-slate-500 font-bold">
                      {ship.cargoWeight ? `${ship.cargoWeight.toLocaleString()} KG` : "—"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT: Selected Shipment Deep-dive Panel */}
          <div className="lg:col-span-7">
            {selectedShipment ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-left space-y-6">
                
                {/* Header overview */}
                <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-5">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-orange-500 tracking-wider">Active Cargo Spotlight</span>
                    <h3 className="text-xl font-black text-white flex items-center gap-2">
                      <span className="selectable">{selectedShipment.shipmentNumber}</span>
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      Cargo: <strong className="text-slate-200">{selectedShipment.cargoDescription}</strong>
                    </p>
                  </div>

                  <button
                    onClick={() => setSelectedShipment(null)}
                    className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                    title={curT.close}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Specific Sea/Air details section */}
                {(selectedShipment.freightType === "sea" || selectedShipment.freightType === "air") && (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                    {selectedShipment.freightType === "sea" && (
                      <>
                        <div className="space-y-1">
                          <p className="text-[9px] text-slate-500 uppercase font-black">{curT.shippingLine}</p>
                          <p className="font-extrabold text-white">{selectedShipment.shippingLine || "MAERSK LINE"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[9px] text-slate-500 uppercase font-black">{curT.vessel}</p>
                          <p className="font-extrabold text-white">{selectedShipment.vesselName || "MAERSK MC-KINNEY MOLLER"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[9px] text-slate-500 uppercase font-black">{curT.bookingNo}</p>
                          <p className="font-extrabold text-white">{selectedShipment.bookingNumber || "MSK-BK-91902"}</p>
                        </div>
                        {selectedShipment.containerNumber && (
                          <div className="space-y-1">
                            <p className="text-[9px] text-slate-500 uppercase font-black">Container No</p>
                            <p className="font-extrabold text-white">{selectedShipment.containerNumber}</p>
                          </div>
                        )}
                        {selectedShipment.billOfLadingNumber && (
                          <div className="space-y-1">
                            <p className="text-[9px] text-slate-500 uppercase font-black">{curT.billOfLading}</p>
                            <p className="font-extrabold text-white">{selectedShipment.billOfLadingNumber}</p>
                          </div>
                        )}
                      </>
                    )}

                    {selectedShipment.freightType === "air" && (
                      <>
                        <div className="space-y-1">
                          <p className="text-[9px] text-slate-500 uppercase font-black">{curT.airline}</p>
                          <p className="font-extrabold text-white">{selectedShipment.airline || "Turkish Airlines Cargo"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[9px] text-slate-500 uppercase font-black">Flight No</p>
                          <p className="font-extrabold text-white">{selectedShipment.flightNumber || "TK-6192"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[9px] text-slate-500 uppercase font-black">{curT.waybill}</p>
                          <p className="font-extrabold text-white">{selectedShipment.airWaybillNumber || "235-9018293"}</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Satellite Maps block */}
                <div className="space-y-2">
                  <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-orange-500 animate-spin-slow" />
                    <span>{curT.viewMap}</span>
                  </h4>
                  <div className="rounded-xl overflow-hidden border border-slate-800 relative">
                    <TrackingMap 
                      shipments={[selectedShipment]} 
                      lang={lang} 
                      drivers={drivers} 
                    />
                  </div>
                </div>

                {/* Split layout: Timeline on left, Documents + inquiries on right */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
                  
                  {/* Timeline section */}
                  <div className="space-y-4">
                    <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 border-b border-slate-800 pb-2">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{curT.timeline}</span>
                    </h4>

                    {selectedShipment.timeline && selectedShipment.timeline.length > 0 ? (
                      <div className="space-y-3.5 text-xs max-h-72 overflow-y-auto pr-1">
                        {selectedShipment.timeline.map((update, idx) => {
                          const dateObj = new Date(update.timestamp);
                          const formattedTime = isNaN(dateObj.getTime()) 
                            ? update.timestamp 
                            : dateObj.toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { 
                                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" 
                              });
                          
                          const label = lang === "tr" ? update.labelTr : lang === "ar" ? update.labelAr : update.labelEn;
                          const details = lang === "tr" ? update.detailsTr : lang === "ar" ? update.detailsAr : update.detailsEn;

                          return (
                            <div key={idx} className="flex gap-3 relative pb-1">
                              {/* Continuous connector line */}
                              {idx < selectedShipment.timeline.length - 1 && (
                                <div className="absolute top-2 w-0.5 bg-slate-800 h-full left-1.5"></div>
                              )}
                              
                              <div className={`w-3.5 h-3.5 rounded-full z-15 shrink-0 flex items-center justify-center ${
                                idx === 0 
                                  ? "bg-orange-500 shadow shadow-orange-500/30" 
                                  : "bg-slate-800"
                              }`}>
                                <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                              </div>

                              <div className="space-y-0.5 text-left">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-extrabold text-white text-[11px] leading-tight">{label}</p>
                                  <span className="text-[9px] font-bold text-slate-500 whitespace-nowrap">{formattedTime}</span>
                                </div>
                                {details && <p className="text-[10px] text-slate-400 leading-normal">{details}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-center text-slate-500 text-[11px] font-semibold">
                        Freight manifests initialized. Full-scale tracking trace will activate upon truck engine start.
                      </div>
                    )}
                  </div>

                  {/* Documents + Support chat section */}
                  <div className="space-y-6">
                    
                    {/* Share documents container */}
                    <div className="space-y-3">
                      <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 border-b border-slate-800 pb-2">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>{curT.documents}</span>
                      </h4>

                      {selectedShipment.documents && selectedShipment.documents.length > 0 ? (
                        <div className="grid grid-cols-1 gap-1.5">
                          {selectedShipment.documents.map((doc, dIdx) => (
                            <div key={dIdx} className="bg-slate-950 border border-slate-800 p-2 text-xs rounded-xl flex items-center justify-between hover:border-slate-800">
                              <div className="flex items-center gap-2 truncate">
                                <FileText className="w-4 h-4 text-orange-500 shrink-0" />
                                <div className="truncate text-left">
                                  <p className="font-extrabold text-white truncate text-[11px] leading-tight">{doc.name}</p>
                                  <span className="text-[9px] font-black uppercase text-slate-500">{doc.category}</span>
                                </div>
                              </div>

                              <a 
                                href={doc.url} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="p-1 px-2.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-slate-300 hover:text-white font-extrabold text-[10px] transition-colors flex items-center gap-1.5 whitespace-nowrap"
                              >
                                <Download className="w-3 h-3 text-orange-400" />
                                <span>Get File</span>
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-center text-slate-400 text-[11px] font-semibold">
                          {curT.noDocs}
                        </div>
                      )}
                    </div>

                    {/* Support inquiries block */}
                    <div className="space-y-3">
                      <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5 border-b border-slate-800 pb-2">
                        <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                        <span>{curT.inquiryTitle}</span>
                      </h4>

                      <div className="space-y-3">
                        <p className="text-[10px] text-slate-400 leading-normal font-medium">
                          {curT.inquiryDesc}
                        </p>

                        {/* Message Feed logs */}
                        {inquiries[selectedShipment.id] && inquiries[selectedShipment.id].length > 0 && (
                          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-36 overflow-y-auto space-y-2 text-[11px]">
                            {inquiries[selectedShipment.id].map((msg, mIdx) => {
                              const isAdminSender = msg.sender === "admin" || (msg.senderName && (msg.senderName.toLowerCase().includes("admin") || msg.senderName.toLowerCase().includes("maras")));
                              return (
                                <div key={mIdx} className="space-y-0.5 text-left border-b border-slate-900 pb-1 last:border-0">
                                  <div className="flex items-center justify-between gap-2.5">
                                    <span className={`font-black uppercase text-[10px] ${isAdminSender ? 'text-orange-400' : 'text-slate-300'}`}>
                                      {msg.senderName || msg.sender}
                                    </span>
                                    <span className="text-[9px] text-slate-500 font-bold">
                                      {new Date(msg.timestamp).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", { hour: "numeric", minute: "2-digit" })}
                                    </span>
                                  </div>
                                  <p className="text-slate-300 text-[10px] leading-tight">{msg.text}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {viewOnly ? (
                          <div className="flex items-center gap-2 p-3 bg-slate-950 border border-slate-800 rounded-xl text-[10px] text-slate-500 font-semibold">
                            <Lock className="w-3.5 h-3.5 shrink-0 text-slate-600" />
                            <span>{lang === 'ar' ? "حساب المشاهدة فقط — لا يمكن إرسال الرسائل." : lang === 'tr' ? "Salt görüntüleme hesabı — mesaj gönderilemiyor." : "View-only account — sending messages is disabled."}</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <textarea
                              rows={2}
                              value={inquiryText}
                              onChange={(e) => setInquiryText(e.target.value)}
                              placeholder={curT.inquiryPlaceholder}
                              className="w-full bg-slate-950 border border-slate-800 p-2.5 hover:border-slate-800 focus:border-orange-500/80 rounded-xl text-xs text-white focus:outline-none transition-all resize-none"
                            />

                            {inquiryStatus === "success" && (
                              <p className="text-[10px] text-emerald-400 font-extrabold">{curT.inquirySuccess}</p>
                            )}
                            {inquiryStatus === "error" && (
                              <p className="text-[10px] text-red-400 font-extrabold">{curT.inquiryError}</p>
                            )}

                            <button
                              type="button"
                              onClick={() => handleSendInquiry(selectedShipment.id)}
                              disabled={sendingInquiry || !inquiryText.trim()}
                              className="w-full py-2 px-3 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 text-white font-extrabold text-[11px] rounded-xl transition-all border-0 shadow flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-widest"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{curT.submitInquiry}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            ) : (
              <div className="bg-slate-900/40 p-12 text-center text-slate-400 font-medium text-xs border border-slate-800 border-dashed rounded-2xl h-80 flex flex-col justify-center items-center gap-3">
                <div className="p-3 bg-slate-900 text-orange-400 rounded-xl border border-slate-800">
                  <Star className="w-5 h-5" />
                </div>
                <div className="space-y-0.5">
                  <h4 className="font-extrabold text-white block">No shipment selected</h4>
                  <p className="text-[11px] text-slate-500">Pick an active or completed cargo service on the left stream to inspect satellite status updates, tracking documents, or file support tickets.</p>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Real-time Customer Notification Center Overlay slide-over panel */}
      {isNotifOpen && (
        <div id="notifications-overlay" className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsNotifOpen(false)}
          ></div>

          {/* Sliding Panel */}
          <div className="relative w-full max-w-md bg-slate-950 border-l border-slate-800 text-slate-100 flex flex-col h-full shadow-2xl select-none">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="space-y-1 text-left">
                <h3 className="font-extrabold text-sm uppercase tracking-wider font-mono flex items-center gap-2 text-white">
                  <Bell className="w-4 h-4 text-orange-400 animate-pulse" />
                  <span>{curT.notifsTitle}</span>
                </h3>
                <p className="text-[10px] text-slate-500 font-medium">
                  {notifications.filter(n => !n.read).length} unread updates matching your fleet
                </p>
              </div>
              <div className="flex items-center gap-2">
                {notifications.some(n => !n.read) && (
                  <button
                    onClick={handleMarkAllRead}
                    className="p-1 px-2.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 hover:border-orange-500/30 text-[9px] uppercase tracking-wider font-mono font-black rounded-lg transition-all active:scale-95 cursor-pointer"
                  >
                    {curT.markAllRead}
                  </button>
                )}
                <button 
                  onClick={() => setIsNotifOpen(false)}
                  className="p-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-lg cursor-pointer transition-all active:scale-95"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {notifications.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 space-y-2 py-12">
                  <Bell className="w-8 h-8 text-slate-700 stroke-[1.5]" />
                  <p className="text-xs font-semibold">{curT.noNewNotifs}</p>
                </div>
              ) : (
                [...notifications].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((notif) => {
                  const title = lang === 'en' ? notif.titleEn : (lang === 'tr' ? notif.titleTr : notif.titleAr);
                  const msg = lang === 'en' ? notif.messageEn : (lang === 'tr' ? notif.messageTr : notif.messageAr);
                  const isUnread = !notif.read;

                  // Find shipment link
                  const linkedShipment = shipments.find(s => s.id === notif.shipmentId);

                  return (
                    <div 
                      key={notif.id} 
                      className={`p-3.5 border rounded-2xl transition-all relative overflow-hidden flex flex-col justify-between gap-2.5 ${
                        isUnread 
                          ? "bg-slate-900/60 border-orange-500/20 hover:border-orange-500/30 shadow-md shadow-orange-500-[2%]" 
                          : "bg-slate-900/20 border-slate-800 hover:border-slate-900"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 text-left">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-lg text-slate-400 font-black font-mono">
                              #{notif.shipmentNumber}
                            </span>
                            {isUnread && (
                              <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                            )}
                          </div>
                          <h4 className="text-xs font-black text-white">{title}</h4>
                          <p className="text-[10.5px] text-slate-400 font-medium leading-normal">{msg}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-900 pt-2 text-[9px] font-bold text-slate-500">
                        <span>
                          {new Date(notif.timestamp).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { month: "short", day: "numeric" })} at {new Date(notif.timestamp).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", { hour: "numeric", minute: "2-digit" })}
                        </span>
                        {linkedShipment && (
                          <button
                            onClick={() => {
                              setSelectedShipment(linkedShipment);
                              setIsNotifOpen(false);
                            }}
                            className="text-orange-400 hover:text-white flex items-center gap-0.5 uppercase tracking-wider font-mono font-extrabold cursor-pointer transition-all active:scale-95"
                          >
                            <span>{curT.viewShipment}</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showClientDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in text-left">
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-red-900/40 rounded-3xl p-6 max-w-md w-full shadow-[0_20px_50px_rgba(239,68,68,0.15)] space-y-6">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-900/20 border border-red-800/40 flex items-center justify-center text-red-100 shrink-0 select-none">
                <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-white tracking-tight uppercase font-mono">
                  {lang === 'tr' ? "Hesabınızı Kalıcı Olarak Silin" : (lang === 'ar' ? "حذف حساب العميل نهائياً" : "Permanently Delete Account")}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed mt-1">
                  {lang === 'tr' 
                    ? "Bu işlem etir tescilli veri tabanından yetkili kuruluş verilerinizi ve geçmiş tüm lojistik kayıtlarınızı siler. Geri alınamaz."
                    : (lang === 'ar'
                      ? "سيؤدي هذا الإجراء إلى حذف جميع بيانات ومعاملات الشحن التاريخية الخاصة بشركتكم من خنائم النظام بشكل لا يمكن التراجع عنه."
                      : "This action will completely remove your corporate credentials, profile associations, and past freight logs from our servers.")}
                </p>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-900 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer text-xs font-semibold text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={understandClientDelete}
                  onChange={(e) => setUnderstandClientDelete(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-800 bg-slate-900 text-red-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-red-500 mt-0.5"
                />
                <span className="leading-normal">
                  {lang === 'tr' 
                    ? "İş ortağımız MARAS sistemindeki tüm kurumsal erişimlerimin kaldırılmasını kabul ediyorum."
                    : (lang === 'ar'
                      ? "أقر وأوافق على إلغاء ترخيص حسابي وإزالة جميع الصلاحيات اللوجستية."
                      : "I consent to permanently cancel my account license and release all freight manifests associated with this client ID.")}
                </span>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={isDeletingClientAccount}
                onClick={() => setShowClientDeleteConfirm(false)}
                className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
              >
                {lang === 'tr' ? "İptal Et" : (lang === 'ar' ? "إلغاء الأمر" : "Cancel")}
              </button>

              <button
                type="button"
                disabled={isDeletingClientAccount || !understandClientDelete}
                onClick={handleDeleteClientAccount}
                className="flex-1 py-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 disabled:opacity-40 text-white font-extrabold text-xs rounded-xl uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 border-0 shadow-[0_4px_15px_rgba(239,68,68,0.2)] active:scale-95"
              >
                {isDeletingClientAccount ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                    <span>{lang === 'tr' ? "Siliniyor..." : "Deleting..."}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 text-white" />
                    <span>{lang === 'tr' ? "Hesabımı Sil" : (lang === 'ar' ? "حذف الحساب" : "Confirm Delete")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Toast Alert Notification Banner */}
      {toastMessage && (
        <div id="notifications-toast" className="fixed bottom-5 right-5 z-50 max-w-sm p-4 bg-slate-900 border border-orange-500/40 rounded-xl shadow-2xl flex items-center justify-between gap-3 text-xs text-white">
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white cursor-pointer font-bold p-1">&times;</button>
        </div>
      )}

    </div>
  );
}
