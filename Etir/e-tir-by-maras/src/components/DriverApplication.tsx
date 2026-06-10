import React, { useState, useEffect, useRef } from "react";
import { 
  Shipment, 
  Driver, 
  ChatMessage, 
  AppNotification, 
  ShipmentStatus, 
  Currency,
  Language,
  DocumentCategory,
  TRUCK_TYPES
} from "../types";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../googleAuth";
import { TRANSLATIONS } from "../translations";
import { apiFetch } from "../lib/api";
import { 
  Ship, MessageSquare, Truck, DollarSign, Bell, Send, CheckCircle2, 
  X, Camera, FileUp, AlertTriangle, ChevronRight, CornerDownRight, Landmark, User,
  Edit2, Phone, Shield, Check, MapPin, Activity, Briefcase, Paperclip, Search, Languages,
  Star, Award, HeartPulse, Palette
} from 'lucide-react';

const fetch = apiFetch;

interface DriverApplicationProps {
  lang: Language;
  loggedInDriverId?: string | null;
  loggedInDriver?: Driver | null;
  onLogout?: () => void;
}

const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "istanbul": { lat: 41.0082, lng: 28.9784 },
  "bursa": { lat: 40.1885, lng: 29.0610 },
  "gaziantep": { lat: 37.0662, lng: 37.3833 },
  "erbil": { lat: 36.1912, lng: 44.0091 },
  "baghdad": { lat: 33.3152, lng: 44.3661 },
  "basra": { lat: 30.5081, lng: 47.7835 },
  "zaho": { lat: 37.1436, lng: 42.6886 },
  "dahuk": { lat: 36.8615, lng: 42.9926 },
  "mosul": { lat: 36.3489, lng: 43.1577 },
  "suleymaniye": { lat: 35.5613, lng: 45.4375 },
  "kirkuk": { lat: 35.4670, lng: 44.3920 },
  "ankara": { lat: 39.9334, lng: 32.8597 }
};

const CHAT_TRANSLATIONS_DICT: Record<string, Record<"tr" | "ar" | "en", string>> = {
  "customs clearance approved. please execute route.": {
    en: "Customs clearance approved. Please execute route.",
    tr: "Gümrük izni onaylandı. Lütfen rotayı takip edin gidin.",
    ar: "تمت الموافقة على التخليص الجمركي. يرجى اتباع المسار."
  },
  "what is your current eta at zakho border?": {
    en: "What is your current ETA at Zakho Border?",
    tr: "Zaho Sınır Kapısındaki güncel tahmini varış süreniz (ETA) nedir?",
    ar: "ما هو وقت الوصول المقدر الحالي الخاص بك في منفذ زاخو؟"
  },
  "please upload the signed cmr document as soon as possible.": {
    en: "Please upload the signed CMR document as soon as possible.",
    tr: "Lütfen imzalı CMR belgesini en kısa sürede sisteme yükleyin.",
    ar: "يرجى تحميل مستند CMR الموقع في أقرب وقت ممكن الحدوث."
  },
  "are you experiencing any delays?": {
    en: "Are you experiencing any delays?",
    tr: "Herhangi bir gecikme yaşıyor musunuz?",
    ar: "هل تواجه أي تأخيرات حالياً؟"
  },
  "consignment processed through initial customs clearance.": {
    en: "Consignment processed through initial customs clearance.",
    tr: "Sevkiyat ilk gümrükleme işleminden geçti.",
    ar: "تمت معالجة الشحنة من خلال التخليص الجمركي الأولي."
  },
  "we detected offline state. confirm physical status.": {
    en: "We detected offline state. Confirm physical status.",
    tr: "Çevrimdışı durum tespit ettik. Fiziksel transiti doğrulayın.",
    ar: "لقد اكتشفنا حالة عدم اتصال بالشبكة. يرجى تأكيد الوضع الفعلي للشحنة."
  }
};

const QUICK_TEMPLATES: Record<"tr" | "ar" | "en", { label: string; text: string }[]> = {
  en: [
    { label: "📍 Border Arrived", text: "I have arrived at the customs border check-point. Ready to declare transport documents." },
    { label: "⏱️ ETA 1 hour", text: "Latest status update: My estimated time of arrival is approximately 1 hour." },
    { label: "⛽ Rest Stop", text: "Currently at rest stop / refuelling. Resuming transit shortly." },
    { label: "📦 Cargo Loaded", text: "Cargo loading completed. Paperwork holds in progress." },
    { label: "⚠️ Border Delay", text: "Operational warning: Facing transit delays due to custom clearance lines." }
  ],
  tr: [
    { label: "📍 Sınıra Gelindi", text: "Gümrük sınır kapısı kontrol noktasına ulaştım. İşlemler için hazırım." },
    { label: "⏱️ ETA 1 Saat", text: "Güncelleme: Tahmini varış sürem yaklaşık 1 saattir." },
    { label: "⛽ Kısa Mola / Yakıt", text: "Zorunlu yakıt ve dinlenme molasındayım. Yakında yola devam edeceğim." },
    { label: "📦 Yükleme Bitti", text: "Yükleme tamamlandı. Evrakların sisteme girilmesini bekliyorum." },
    { label: "⚠️ Sınır Gecikmesi", text: "Sınır kapısında yoğunluk nedeniyle transit gecikmesi yaşanmaktadır." }
  ],
  ar: [
    { label: "📍 وصلت المعبر", text: "لقد وصلت إلى منفذ التفتيش الجمركي الحدودي. مستعد لتخليص المستندات." },
    { label: "⏱️ وصول خلال ساعة", text: "تحديث: الوقت المقدر للوصول هو حوالي ساعة واحدة تقريبا." },
    { label: "⛽ استراحة وتزود", text: "في استراحة قصيرة والتزود بالوقود حاليا. سأستأنف الرحلة قريباً." },
    { label: "📦 تم الاستلام بالكامل", text: "تم تحميل الشحنة بالكامل. بانتظار الانتهاء من فحص الأوراق الجمركية." },
    { label: "⚠️ تأخير بالحدود", text: "نواجه تأخيراً تشغيلياً على الحدود بسبب طوابير الانتظار الجمركية." }
  ]
};

export default function DriverApplication({ 
  lang, 
  loggedInDriverId = null, 
  loggedInDriver = null, 
  onLogout 
}: DriverApplicationProps) {
  const t = (key: keyof typeof TRANSLATIONS['en']) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS['en'][key] || String(key);
  };

  const isRtl = lang === 'ar';

  // Profile translation dictionary
  const profileT = {
    en: {
      profileTitle: "My Driver Profile",
      personalData: "Personal & Vehicle Data",
      fullName: "Full Name",
      username: "Username Hash",
      phone: "Contact phone",
      truckNumber: "Plate Number / Truck ID",
      truckType: "Truck Type / Category",
      saveProfile: "Save Changes",
      activeJobs: "Active Jobs",
      completedJobs: "Completed Deliveries",
      profileUpdated: "Profile updated successfully!",
      noActive: "None",
      saveSpinner: "Updating account...",
      logout: "Log Out Account"
    },
    tr: {
      profileTitle: "Sürücü Profilim",
      personalData: "Kişisel ve Araç Bilgileri",
      fullName: "Adı Soyadı",
      username: "Kullanıcı Adı",
      phone: "İrtibat Telefonu",
      truckNumber: "Plaka Numarası / Tır ID",
      truckType: "Tır / Dorse Kategori",
      saveProfile: "Değişiklikleri Kaydet",
      activeJobs: "Aktif Seferler",
      completedJobs: "Tamamlanan Teslimatlar",
      profileUpdated: "Profiliniz başarıyla güncellendi!",
      noActive: "Yok",
      saveSpinner: "Kayıt güncelleniyor...",
      logout: "Güvenli Çıkış Yap"
    },
    ar: {
      profileTitle: "ملفي الشخصي كأخصائي نقل",
      personalData: "البيانات الشخصية وبيانات المركبة",
      fullName: "الاسم الكامل",
      username: "اسم المستخدم",
      phone: "رقم الهاتف",
      truckNumber: "رقم اللوحة / الشاحنة",
      truckType: "صنف ونوع الشاحنة",
      saveProfile: "حفظ التغييرات",
      activeJobs: "الرحلات النشطة",
      completedJobs: "الرحلات المكتملة",
      profileUpdated: "تم تحديث الملف الشخصي بنجاح!",
      noActive: "لا يوجد",
      saveSpinner: "جاري حفظ التعديلات...",
      logout: "تسجيل الخروج"
    }
  }[lang] || {
    profileTitle: "My Driver Profile",
    personalData: "Personal & Vehicle Data",
    fullName: "Full Name",
    username: "Username Hash",
    phone: "Contact phone",
    truckNumber: "Plate Number / Truck ID",
    saveProfile: "Save Changes",
    activeJobs: "Active Jobs",
    completedJobs: "Completed Deliveries",
    profileUpdated: "Profile updated successfully!",
    noActive: "None",
    saveSpinner: "Updating account...",
    logout: "Log Out Account"
  };

  // Driver Selector (for mockup simulation simplicity)
  const [drivers, setDrivers] = useState<Driver[]>(() => {
    return loggedInDriver ? [loggedInDriver] : [];
  });
  const [selectedDriverId, setSelectedDriverId] = useState<string>(loggedInDriverId || "driver-1");

  const knownNotificationIdsRef = React.useRef<Set<string>>(new Set());
  const knownChatMessageIdsRef = React.useRef<Set<string>>(new Set());
  const gpsCooldownRef = React.useRef<number>(0);

  // Keep loggedInDriver in sync with drivers catalog
  useEffect(() => {
    if (loggedInDriver) {
      setDrivers(prev => {
        if (!prev.some(d => d.id === loggedInDriver.id)) {
          return [...prev, loggedInDriver];
        }
        return prev.map(d => d.id === loggedInDriver.id ? { ...d, ...loggedInDriver } : d);
      });
    }
  }, [loggedInDriver]);

  useEffect(() => {
    if (loggedInDriverId) {
      setSelectedDriverId(loggedInDriverId);
    }
  }, [loggedInDriverId]);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  
  // Active selected shipment for detail / chat inside driver app
  const [activeShipment, setActiveShipment] = useState<Shipment | null>(null);
  const [activeTab, setActiveTab] = useState<'shipments' | 'chat' | 'notifications' | 'profile'>('shipments');

  // Profile Form States
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileTruckNumber, setProfileTruckNumber] = useState("");
  const [profileTruckType, setProfileTruckType] = useState("reefer");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // Input states
  const [newMessageText, setNewMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({});
  const [isTranslatingId, setIsTranslatingId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [selectedStatusVal, setSelectedStatusVal] = useState<ShipmentStatus>("Accepted");
  
  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'chat' && chatMessages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    }
  }, [chatMessages.length, activeTab, activeShipment?.id]);
  
  // Custom file sim trigger
  const [fileSimOpen, setFileSimOpen] = useState(false);
  const [simFileName, setSimFileName] = useState("");
  const [simFileCategory, setSimFileCategory] = useState<DocumentCategory>("cmr");
  const [simFileUrl, setSimFileUrl] = useState("#");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // GPS live simulation states
  const [gpsSimActive, setGpsSimActive] = useState<boolean>(true);
  const [gpsProgress, setGpsProgress] = useState<number>(35); // starts at 35% along path
  const [gpsSpeed, setGpsSpeed] = useState<number>(82); // simulated speed in km/h
  const [lastGpsCoords, setLastGpsCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  // GPS caching and offline simulation states
  const [cachedCoords, setCachedCoords] = useState<{ lat: number; lng: number; timestamp: string }[]>(() => {
    try {
      const saved = localStorage.getItem(`etir_cached_gps_${selectedDriverId}`);
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [isForceOffline, setIsForceOffline] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncAttemptTime, setLastSyncAttemptTime] = useState<number>(0);

  useEffect(() => {
    localStorage.setItem(`etir_cached_gps_${selectedDriverId}`, JSON.stringify(cachedCoords));
  }, [cachedCoords, selectedDriverId]);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch drivers list & shipment context
  const fetchData = async () => {
    try {
      const safeJson = async (res: Response) => {
        const text = await res.text();
        if (text.trim().startsWith("<")) {
          throw new Error("Received HTML instead of JSON. The backend server might still be initializing.");
        }
        return JSON.parse(text);
      };

      const resDrivers = await fetch("/api/drivers");
      if (resDrivers.ok) {
        let driversList = await safeJson(resDrivers);
        if (loggedInDriver && !driversList.some((d: Driver) => d.id === loggedInDriver.id)) {
          driversList = [...driversList, loggedInDriver];
        }
        setDrivers(driversList);
      }

      let activeShipmentsList: Shipment[] = [];
      const resShipments = await fetch(`/api/shipments?driverId=${selectedDriverId}`);
      if (resShipments.ok) {
        const list = await safeJson(resShipments);
        activeShipmentsList = list;
        setShipments(list);
        
        // update active shipment details dynamically if it is loaded
        if (activeShipment) {
          const fresh = list.find((s: Shipment) => s.id === activeShipment.id);
          if (fresh) setActiveShipment(fresh);
        }
      }

      // Fetch dynamic messages
      if (activeShipment) {
        const resChat = await fetch(`/api/shipments/${activeShipment.id}/chat`);
        if (resChat.ok) {
          const msgs: ChatMessage[] = await safeJson(resChat);
          
          if (knownChatMessageIdsRef.current.size === 0) {
            const initialIds = new Set<string>();
            msgs.forEach((m) => initialIds.add(m.id));
            knownChatMessageIdsRef.current = initialIds;
          } else {
            for (const m of msgs) {
              if (!knownChatMessageIdsRef.current.has(m.id)) {
                knownChatMessageIdsRef.current.add(m.id);
                // Alert only if sender is 'admin' (dispatcher)
                if (m.sender === 'admin') {
                  if (activeTab !== 'chat') {
                    const alertMsg = lang === 'en' 
                      ? `💬 Dispatch: "${m.text}"` 
                      : (lang === 'tr' ? `💬 Mesaj: "${m.text}"` : `💬 إشعار: "${m.text}"`);
                    triggerToast(alertMsg);
                    
                    // Web Audio API subtle alert sound
                    try {
                      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                      const osc = audioCtx.createOscillator();
                      const gain = audioCtx.createGain();
                      osc.connect(gain);
                      gain.connect(audioCtx.destination);
                      osc.frequency.value = 523.25; // C5
                      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
                      osc.start();
                      osc.stop(audioCtx.currentTime + 0.1);
                    } catch (_) {}
                  }
                }
              }
            }
          }

          setChatMessages(msgs);
          if (activeTab === 'chat') {
            const hasUnseenFromAdmin = msgs.some((m: any) => m.sender === 'admin' && m.status !== 'seen');
            if (hasUnseenFromAdmin) {
              fetch(`/api/shipments/${activeShipment.id}/chat/seen`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ viewer: "driver" })
              }).catch(err => console.warn(err));
            }
          }
        }
      }

      // Fetch notifications
      const resNotifs = await fetch("/api/notifications");
      if (resNotifs.ok) {
        const rawList: AppNotification[] = await safeJson(resNotifs);
        
        // Filter list strictly to this driver's shipments
        const driverShipmentIds = new Set([
          ...activeShipmentsList.map(s => s.id),
          ...(activeShipment ? [activeShipment.id] : [])
        ]);
        const list = rawList.filter(n => n.shipmentId && driverShipmentIds.has(n.shipmentId));
        
        if (knownNotificationIdsRef.current.size === 0) {
          const initialIds = new Set<string>();
          list.forEach((n) => initialIds.add(n.id));
          knownNotificationIdsRef.current = initialIds;
        } else {
          for (const notif of list) {
            if (!knownNotificationIdsRef.current.has(notif.id)) {
              knownNotificationIdsRef.current.add(notif.id);
              
              const title = lang === 'en' ? notif.titleEn : (lang === 'tr' ? notif.titleTr : notif.titleAr);
              const msg = lang === 'en' ? notif.messageEn : (lang === 'tr' ? notif.messageTr : notif.messageAr);
              
              // Trigger toast alert for message/doc_upload/status_update
              triggerToast(`🔔 ${title}: ${msg}`);
              
              // Sound chime
              try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.frequency.value = 659.25; // E5
                gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.15);
                
                setTimeout(() => {
                  const osc2 = audioCtx.createOscillator();
                  const gain2 = audioCtx.createGain();
                  osc2.connect(gain2);
                  gain2.connect(audioCtx.destination);
                  osc2.frequency.value = 987.77; // B5
                  gain2.gain.setValueAtTime(0.04, audioCtx.currentTime);
                  osc2.start();
                  osc2.stop(audioCtx.currentTime + 0.2);
                }, 110);
              } catch (_) {}
            }
          }
        }
        setNotifications(list);
      }

    } catch (e) {
      console.warn("Telemetry or data fetch error: ", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 12000);
    return () => clearInterval(interval);
  }, [selectedDriverId, activeShipment?.id]);

  // Fast chat-only polling when active tab is chat to support snappy read receipts and messaging updates
  useEffect(() => {
    let interval: any;
    if (activeShipment && activeTab === 'chat') {
      const fetchChatOnly = async () => {
        try {
          const resChat = await fetch(`/api/shipments/${activeShipment.id}/chat`);
          if (resChat.ok) {
            const txt = await resChat.text();
            if (txt.trim() && !txt.trim().startsWith("<")) {
              const msgs: ChatMessage[] = JSON.parse(txt);
              setChatMessages(msgs);

              const hasUnseenFromAdmin = msgs.some((m: any) => m.sender === 'admin' && m.status !== 'seen');
              if (hasUnseenFromAdmin) {
                await fetch(`/api/shipments/${activeShipment.id}/chat/seen`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ viewer: "driver" })
                });
              }
            }
          }
        } catch (err) {
          console.warn("Active driver chat fast poll error:", err);
        }
      };
      
      // Initial trigger and set quick 3.5s interval
      fetchChatOnly();
      interval = setInterval(fetchChatOnly, 3500);
    }
    return () => clearInterval(interval);
  }, [activeShipment?.id, activeTab]);

  // Synchronize edit profile drafts when simulated driver or driver catalog changes
  useEffect(() => {
    const dr = drivers.find(d => d.id === selectedDriverId);
    if (dr) {
      setProfileName(dr.name || "");
      setProfileUsername(dr.username || "");
      setProfilePhone(dr.phone || "");
      setProfileTruckNumber(dr.truckNumber || "");
      setProfileTruckType(dr.truckType || "reefer");
      setProfileAvatarUrl(dr.avatarUrl || "");
    }
  }, [selectedDriverId, drivers]);

  // Unified GPS transmission with caching on connection failure and rate limit resilience
  const transmitGPS = async (lat: number, lng: number) => {
    const timestamp = new Date().toISOString();
    const isOffline = isForceOffline || !navigator.onLine;

    // Direct local caching if offline or under rate-limit cooldown
    if (isOffline || Date.now() < gpsCooldownRef.current) {
      const newPoint = { lat, lng, timestamp };
      setCachedCoords(prev => {
        const next = [...prev, newPoint];
        return next.slice(-30);
      });
      if (Date.now() < gpsCooldownRef.current) {
        console.warn("Telemetry transmission postponed due to rate-limit cooldown. Caching coordinates locally:", newPoint);
      } else {
        console.log("Local caching: connection is offline, cached GPS locally.", newPoint);
      }
      return false;
    }

    try {
      const dr = drivers.find(d => d.id === selectedDriverId);
      if (dr) {
        const res = await fetch(`/api/drivers/${selectedDriverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...dr,
            latitude: lat,
            longitude: lng,
            lastUpdated: timestamp
          })
        });

        if (res.status === 429) {
          // Trigger 30-second client-side cooldown to protect the gateway/database
          gpsCooldownRef.current = Date.now() + 30000;
          console.warn("GPS transmission throttled by platform rate limits (429). Storing inside local cache and cooling down live transmitter for 30s.");
          
          const newPoint = { lat, lng, timestamp };
          setCachedCoords(prev => {
            const next = [...prev, newPoint];
            return next.slice(-30);
          });
          return false;
        }

        if (!res.ok) {
          throw new Error("HTTP error status " + res.status);
        }
        return true;
      }
    } catch (err: any) {
      console.warn("Telemetry transmission failed, caching coordinates locally:", err.message || err);
      const newPoint = { lat, lng, timestamp };
      setCachedCoords(prev => {
        const next = [...prev, newPoint];
        return next.slice(-30);
      });
      return false;
    }
    return false;
  };

  // Sync back cached points once connection is restored
  const triggerGpsSync = async () => {
    if (isSyncing || cachedCoords.length === 0) return;
    setIsSyncing(true);
    setLastSyncAttemptTime(Date.now());

    const dr = drivers.find(d => d.id === selectedDriverId);
    if (!dr) {
      setIsSyncing(false);
      return;
    }

    console.log("Background synchronization: Restoring telemetry log...");
    const itemsToSync = [...cachedCoords];

    try {
      let syncedCount = 0;
      for (const item of itemsToSync) {
        const res = await fetch(`/api/drivers/${selectedDriverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...dr,
            latitude: item.lat,
            longitude: item.lng,
            lastUpdated: item.timestamp
          })
        });
        if (res.ok) {
          syncedCount++;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      console.log(`✅ Sync completed: ${syncedCount} GPS points synchronized!`);
      setCachedCoords([]);
    } catch (e) {
      console.error("GPS cache synchronization failed:", e);
    } finally {
      setIsSyncing(false);
      setLastSyncAttemptTime(Date.now());
    }
  };

  // Auto-sync when going online
  useEffect(() => {
    const isOnline = !isForceOffline && navigator.onLine;
    const dr = drivers.find(d => d.id === selectedDriverId);
    const now = Date.now();
    // Only trigger if we are online, have cached points, and are not already syncing/throttled on cooldown
    if (isOnline && cachedCoords.length > 0 && !isSyncing && dr && (now - lastSyncAttemptTime > 15000)) {
      triggerGpsSync();
    }
  }, [isForceOffline, cachedCoords.length, isSyncing, drivers, selectedDriverId, lastSyncAttemptTime]);

  // Synchronized GPS Telemetry transmitter task loop
  useEffect(() => {
    if (!gpsSimActive) {
      return;
    }

    const startLoc = (activeShipment ? CITY_COORDINATES[activeShipment.loadingCity.toLowerCase().trim()] : null) || 
                     CITY_COORDINATES["istanbul"];
    const endLoc = (activeShipment ? CITY_COORDINATES[activeShipment.deliveryCity.toLowerCase().trim()] : null) || 
                   CITY_COORDINATES["baghdad"];

    const interval = setInterval(() => {
      setGpsProgress(prev => {
        let next = prev + 1;
        if (next > 95) {
          next = 10; // Reset loop
        }

        // Interpolation
        const interpolationPct = next / 100;
        // Adding slight random micro-drift to simulate active bumpy driving feedback
        const latDrift = (Math.random() - 0.5) * 0.0015;
        const lngDrift = (Math.random() - 0.5) * 0.0015;

        const currentLat = startLoc.lat + (endLoc.lat - startLoc.lat) * interpolationPct + latDrift;
        const currentLng = startLoc.lng + (endLoc.lng - startLoc.lng) * interpolationPct + lngDrift;

        setLastGpsCoords({ lat: currentLat, lng: currentLng });

        // Submit position to transmitter helper
        transmitGPS(currentLat, currentLng);

        return next;
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [gpsSimActive, activeShipment?.id, selectedDriverId, drivers, isForceOffline]);

  const handleManualTeleport = (cityName: string) => {
    const coords = CITY_COORDINATES[cityName.toLowerCase().trim()];
    if (!coords) return;

    setLastGpsCoords(coords);
    triggerToast(`GPS Position verified at ${cityName}`);

    transmitGPS(coords.lat, coords.lng);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) return;
    setIsSavingProfile(true);
    try {
      const res = await fetch(`/api/drivers/${selectedDriverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          username: profileUsername,
          phone: profilePhone,
          truckNumber: profileTruckNumber,
          truckType: profileTruckType,
          avatarUrl: profileAvatarUrl
        })
      });
      if (res.ok) {
        const updated = await res.json();
        // Update local drivers state
        setDrivers(prev => prev.map(d => d.id === selectedDriverId ? updated : d));
        triggerToast(profileT.profileUpdated);
        setIsEditingProfile(false);
        // Refresh all data
        fetchData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAvatar(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64DataUrl = evt.target?.result as string;
        if (!base64DataUrl) {
          setIsUploadingAvatar(false);
          return;
        }

        let uploadedUrl = "";
        let uploadedViaGateway = false;

        // Try the `/api/upload` endpoint first (Server-handled storage)
        try {
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64DataUrl,
              filename: file.name
            })
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            uploadedUrl = uploadData.url;
            uploadedViaGateway = true;
            console.log("Avatar uploaded successfully via server upload gateway:", uploadedUrl);
          }
        } catch (gatewayErr) {
          console.warn("Media gateway upload failed, falling back to Firebase Storage:", gatewayErr);
        }

        // If the server-side API failed, fallback to Firebase Storage
        if (!uploadedViaGateway) {
          try {
            const storageRef = ref(storage, `avatars/${selectedDriverId}/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);
            uploadedUrl = await getDownloadURL(storageRef);
            console.log("Avatar uploaded successfully to Firebase Storage! URL: ", uploadedUrl);
          } catch (storageErr) {
            console.error("Firebase Storage upload also failed:", storageErr);
            triggerToast(lang === 'tr' ? "Yükleme başarısız oldu!" : (lang === 'ar' ? "فشل رفع الصورة!" : "Failed to upload avatar image. Details: Firebase Storage permission denied."));
            setIsUploadingAvatar(false);
            return;
          }
        }

        setProfileAvatarUrl(uploadedUrl);

        // Force immediate database update to ensure instant persistence
        const res = await fetch(`/api/drivers/${selectedDriverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileName,
            username: profileUsername,
            phone: profilePhone,
            truckNumber: profileTruckNumber,
            truckType: profileTruckType,
            avatarUrl: uploadedUrl
          })
        });
        if (res.ok) {
          const updated = await res.json();
          setDrivers(prev => prev.map(d => d.id === selectedDriverId ? updated : d));
          triggerToast(lang === 'tr' ? "Profil resmi güncellendi!" : (lang === 'ar' ? "تم تحديث الصورة الشخصية!" : "Profile photo updated!"));
          fetchData();
        }
        setIsUploadingAvatar(false);
      };

      reader.onerror = () => {
        setIsUploadingAvatar(false);
        triggerToast("Failed to read file.");
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Avatar upload failed:", err);
      triggerToast("Failed to upload avatar image");
      setIsUploadingAvatar(false);
    }
  };

  // Handle Order Acceptance
  const handleAcceptAssignment = async (shipment: Shipment) => {
    try {
      const res = await fetch(`/api/shipments/${shipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "Accepted",
          updaterName: getDriverName(),
          remarksDesc: "Assigned shipment order accepted by dispatched driver.",
          role: "driver"
        })
      });
      if (res.ok) {
        triggerToast(t('acceptSuccess'));
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Order Rejection
  const handleRejectAssignment = async (shipment: Shipment) => {
    try {
      const res = await fetch(`/api/shipments/${shipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "New", // Reset to New in backend
          updaterName: getDriverName(),
          remarksDesc: `Driver rejected assignment.`,
          role: "driver"
        })
      });
      if (res.ok) {
        triggerToast(t('rejectSuccess'));
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Custom Status Update Form
  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShipment) return;
    try {
      const res = await fetch(`/api/shipments/${activeShipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: selectedStatusVal,
          remarksDesc: remarks || undefined,
          updaterName: getDriverName(),
          role: "driver"
        })
      });
      if (res.ok) {
        setRemarks("");
        triggerToast(t('statusUpdated'));
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Chat message injection
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShipment || !newMessageText.trim()) return;

    try {
      const res = await fetch(`/api/shipments/${activeShipment.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "driver",
          senderName: getDriverName(),
          type: "text",
          text: newMessageText
        })
      });

      if (res.ok) {
        setNewMessageText("");
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Translate individual message text for driver comprehension
  const handleTranslate = (msgId: string, originalText: string) => {
    if (translatedMessages[msgId]) {
      // Toggle off
      setTranslatedMessages(prev => {
        const copy = { ...prev };
        delete copy[msgId];
        return copy;
      });
      return;
    }

    setIsTranslatingId(msgId);
    setTimeout(() => {
      const cleanText = originalText.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
      let translation = "";

      // Look up in dictionary
      const dictMatch = CHAT_TRANSLATIONS_DICT[cleanText];
      if (dictMatch && dictMatch[lang]) {
        translation = dictMatch[lang];
      } else {
        // Dynamic fallback logic
        if (lang === "tr") {
          translation = `[TR Tercüme]: "${originalText}"`;
        } else if (lang === "ar") {
          translation = `[ترجمة AR]: "${originalText}"`;
        } else {
          translation = `[EN Translation]: "${originalText}"`;
        }
      }

      setTranslatedMessages(prev => ({
        ...prev,
        [msgId]: translation
      }));
      setIsTranslatingId(null);
    }, 450);
  };

  // Simulate Document or Photo upload inside Chat
  const handleSimulateUpload = async () => {
    if (!activeShipment || !simFileName.trim()) return;
    
    setIsUploading(true);

    try {
      let finalFileUrl = simFileUrl;

      if (selectedFile && simFileUrl && simFileUrl.startsWith("data:")) {
        let uploadedViaGateway = false;
        try {
          // 1. Try uploading to our highly available central media gateway route
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64DataUrl: simFileUrl,
              filename: simFileName || selectedFile.name
            })
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            finalFileUrl = uploadData.url;
            uploadedViaGateway = true;
            console.log("File uploaded successfully via central media gateway:", finalFileUrl);
          }
        } catch (uploadGatewayErr) {
          console.log("Local media gateway fallback triggered:", uploadGatewayErr);
        }

        // 2. If local upload didn't succeed, fallback to Firebase Storage silently
        if (!uploadedViaGateway) {
          try {
            const fileRef = ref(storage, `shipments/${activeShipment.id}/${Date.now()}_${selectedFile.name}`);
            const uploadResult = await uploadBytes(fileRef, selectedFile);
            finalFileUrl = await getDownloadURL(uploadResult.ref);
            console.log("File uploaded successfully to Firebase Storage! URL: ", finalFileUrl);
          } catch (storageErr) {
            console.log("Firebase Storage fallback also failed, retaining base64 inline encoding representation:", storageErr);
          }
        }
      }

      const mockFilePayload = {
        sender: "driver",
        senderName: getDriverName(),
        type: "file",
        fileName: simFileName,
        fileCategory: simFileCategory,
        fileUrl: finalFileUrl || "#",
        text: `Sent a document [${simFileCategory.toUpperCase()}]: ${simFileName}`
      };

      const res = await fetch(`/api/shipments/${activeShipment.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mockFilePayload)
      });

      if (res.ok) {
        setSimFileName("");
        setSimFileUrl("#");
        setSelectedFile(null);
        setFileSimOpen(false);
        triggerToast("Attachment uploaded and synchronized successfully!");
        fetchData();
      }
    } catch (e) {
      console.error(e);
      triggerToast("Failed to upload files");
    } finally {
      setIsUploading(false);
    }
  };

  const getDriverName = () => {
    const dr = drivers.find(d => d.id === selectedDriverId);
    return dr ? dr.name : "Driver";
  };

  const getDriverTruck = () => {
    const dr = drivers.find(d => d.id === selectedDriverId);
    return dr ? dr.truckNumber : "";
  };

  return (
    <div className="p-4 md:p-6 bg-slate-100 min-h-screen text-slate-800 flex flex-col lg:flex-row gap-6 justify-center items-start" dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* Simulation Trigger Controller inside screen */}
      {!loggedInDriverId && (
        <div className="w-full lg:w-80 bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 shrink-0">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Testing Workspace Controls</h3>
            <p className="text-xs text-slate-400 mt-1">Select drivers to simulate different phone views and interactive cargo notifications.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600 block">Switch Active Driver Account</label>
            <select
              value={selectedDriverId}
              onChange={(e) => {
                setSelectedDriverId(e.target.value);
                setActiveShipment(null);
                setActiveTab('shipments');
              }}
              className="w-full p-2 border border-slate-250 bg-slate-50 hover:bg-slate-100 text-xs font-semibold rounded-lg"
            >
              {drivers.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.truckNumber})
                </option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 p-3.5 border border-slate-200 text-xs rounded-xl space-y-1">
            <span className="font-bold text-slate-700 uppercase tracking-widest text-[10px]">Driver Profile</span>
            <p className="font-bold text-slate-900">{getDriverName()}</p>
            <p className="text-slate-500 font-mono text-[10px]/tight">{getDriverTruck()}</p>
          </div>
        </div>
      )}

      {/* MOBILE APP PHONE CONTAINER SCREEN */}
      <div className="mx-auto lg:mx-0 w-full max-w-[390px] h-[780px] bg-slate-950 rounded-[40px] p-3.5 shadow-2xl relative border-[6px] border-slate-800 flex flex-col justify-between overflow-hidden">
        
        {/* Dynamic Mobile Top Speaker / Camera Notch */}
        <div className="absolute top-5 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-950 border border-slate-900 rounded-full z-30 flex items-center justify-around px-3">
          <span className="w-3.5 h-3.5 bg-slate-900 border border-slate-800 rounded-full"></span>
          <span className="w-10 h-1 bg-slate-800 rounded-full"></span>
        </div>

        {/* Inner Phone Screen */}
        <div className="w-full h-full bg-slate-900 text-slate-100 rounded-[28px] overflow-hidden flex flex-col justify-between pt-10 pb-4 relative">
          
          {/* Header Mobile Brand */}
          <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between z-20">
            <span className="font-mono text-[10px] text-slate-400 font-bold">12:00 PM</span>
            <h2 className="text-orange-500 font-bold text-sm tracking-tight">{t('brand')}</h2>
            <Bell className="w-4 h-4 text-slate-400" />
          </div>

          {/* Active Toast Alert (Mobile screen inline) */}
          {toast && (
            <div className="absolute top-16 left-4 right-4 bg-orange-600 text-white p-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg z-50">
              <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
              <span>{toast}</span>
            </div>
          )}

          {/* Core App View Controller */}
          <div className="flex-1 overflow-y-auto bg-slate-950 p-4 relative text-sm">
            
            {/* NOTIFICATION FEED POPUP PANEL */}
            {activeTab === 'notifications' && (() => {
              const myNotifications = notifications.filter(n => 
                n.shipmentId && (shipments.some(s => s.id === n.shipmentId) || (activeShipment && activeShipment.id === n.shipmentId))
              );
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wide">{t('notifications')}</h3>
                    <button onClick={() => setActiveTab('shipments')} className="text-[10px] text-slate-500 hover:text-white font-bold bg-slate-900 px-2 py-0.5 rounded">Back</button>
                  </div>
                  <div className="space-y-2">
                    {myNotifications.map((n) => (
                      <div key={n.id} className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="bg-orange-950 text-orange-400 text-[9px] font-bold px-1.5 rounded font-mono">#{n.shipmentNumber}</span>
                          <span className="text-[9px] text-slate-500">{new Date(n.timestamp).toLocaleDateString()}</span>
                        </div>
                        <p className="font-bold text-slate-100 text-xs">
                          {lang === 'en' ? n.titleEn : (lang === 'tr' ? n.titleTr : n.titleAr)}
                        </p>
                        <p className="text-[11px] text-slate-400 leading-tight">
                          {lang === 'en' ? n.messageEn : (lang === 'tr' ? n.messageTr : n.messageAr)}
                        </p>
                      </div>
                    ))}
                    {myNotifications.length === 0 && (
                      <p className="text-xs text-slate-500 italic text-center py-10">No alerts logged yet.</p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* SHIPMENTS LIST VIEW */}
            {activeTab === 'shipments' && !activeShipment && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-sm text-slate-200 tracking-tight">{t('activeShipments')}</h3>
                  <span className="bg-orange-500/10 text-orange-400 font-mono font-bold text-xs px-2.5 py-0.5 rounded-full">
                    {shipments.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {shipments.map((s) => (
                    <div 
                      key={s.id} 
                      onClick={() => {
                        setActiveShipment(s);
                        setSelectedStatusVal(s.status);
                      }}
                      className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl transition-all cursor-pointer space-y-3 shadow"
                    >
                      <div className="flex items-center justify-between">
                        <span className="bg-slate-850 text-white font-mono font-bold px-2 py-0.5 rounded text-[10px]">
                          {s.shipmentNumber}
                        </span>
                        
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold ${
                          s.status === 'Assigned' ? 'bg-orange-950 text-orange-400' :
                          s.status === 'Accepted' ? 'bg-teal-950 text-teal-400' :
                          'bg-blue-950 text-blue-400'
                        }`}>
                          {s.status}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-400 space-y-1 border-l border-slate-800 pl-2">
                        <p className="font-semibold text-slate-200 truncate">{s.cargoDescription}</p>
                        <p>{s.loadingCity} ➔ {s.deliveryCity}</p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-850 text-xs">
                        {/* AGREED AMOUNT VISIBLE */}
                        <span className="font-bold text-orange-500">{s.agreedAmount.toLocaleString()} {s.currency}</span>
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      </div>
                    </div>
                  ))}

                  {shipments.length === 0 && (
                    <div className="p-8 text-center text-slate-500 italic space-y-2">
                      <Truck className="w-8 h-8 mx-auto text-slate-700" />
                      <p className="text-xs">{t('noAssignedShipments')}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* EXPANDED SHIPMENT DETAIL & CHAT / STATUS TAB PANEL */}
            {activeTab === 'shipments' && activeShipment && (
              <div className="space-y-4 pb-20">
                {/* Back Link */}
                <button 
                  onClick={() => setActiveShipment(null)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  {lang === 'en' ? '← Back to Jobs' : lang === 'tr' ? '← İşlere Geri Dön' : '← العودة إلى المهام'}
                </button>

                {/* ROLE-BASED PRIVACY WARNING IN DRIVER WINDOW */}
                <div className="p-2.5 bg-amber-950/40 border border-amber-900 text-amber-300 rounded-xl text-[10px]/normal flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('restrictedNotice')}</span>
                </div>

                {/* Driver views parameters */}
                <div className="p-4 bg-slate-900 border border-slate-850 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-white">{activeShipment.shipmentNumber}</span>
                    <span className="bg-slate-800 text-orange-400 text-xs font-bold px-2.5 py-0.5 rounded-full">{activeShipment.status}</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-500 font-bold block">{t('cargoInfo')}</span>
                      <p className="font-semibold text-slate-100">{activeShipment.cargoDescription}</p>
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">Weight: {activeShipment.cargoWeight.toLocaleString()} kg</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-2">
                      <div>
                        <span className="text-slate-500 block">From City</span>
                        <p className="font-bold text-slate-200">{activeShipment.loadingCity}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{activeShipment.loadingCountry}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Delivery City</span>
                        <p className="font-bold text-slate-200">{activeShipment.deliveryCity}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{activeShipment.deliveryCountry}</p>
                      </div>
                    </div>

                    <div className="border-t border-slate-800 pt-2 flex items-center justify-between bg-slate-850/50 p-2.5 rounded-xl">
                      <span className="text-slate-400 font-bold">{t('carrierAmount')}</span>
                      <span className="text-orange-500 font-mono font-extrabold text-sm">
                        {activeShipment.agreedAmount.toLocaleString()} {activeShipment.currency}
                      </span>
                    </div>
                  </div>
                </div>

                {/* STATUS ACTIONS CONDITIONAL ROUTING */}
                {activeShipment.status === "Assigned" ? (
                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-3">
                    <p className="text-xs text-slate-300 font-semibold">{t('assignDriver')}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => handleRejectAssignment(activeShipment)}
                        className="p-2.5 bg-red-950 hover:bg-red-900 border border-red-900 text-red-100 text-xs font-extrabold rounded-xl transition-all"
                      >
                        {t('rejectShipment')}
                      </button>
                      <button 
                        onClick={() => handleAcceptAssignment(activeShipment)}
                        className="p-2.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-extrabold rounded-xl transition-all shadow-md"
                      >
                        {t('acceptShipment')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleStatusUpdate} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                    <h4 className="font-bold text-xs text-slate-200 text-left">{t('status')} Tracking Update</h4>
                    
                    <select
                      value={selectedStatusVal}
                      onChange={(e) => setSelectedStatusVal(e.target.value as ShipmentStatus)}
                      className="w-full p-2 bg-slate-950 border border-slate-800 text-xs text-slate-200 font-bold rounded-lg outline-none"
                    >
                      {['Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered'].map(st => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>

                    <input 
                      type="text" 
                      placeholder={t('remarksPlaceholder')}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className="w-full p-2 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-lg outline-none"
                    />

                    <button 
                      type="submit" 
                      className="w-full p-2.5 bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all"
                    >
                      {t('updateStatusBtn')}
                    </button>
                  </form>
                )}



                {/* Shared Official documents visibility inside mobile */}
                <div className="space-y-2">
                  <h4 className="text-slate-400 font-bold text-xs uppercase tracking-wider text-left">Shared Files Center</h4>
                  {activeShipment.documents && activeShipment.documents.length > 0 ? (
                    <div className="space-y-1.5">
                      {activeShipment.documents.map(d => (
                        <div key={d.id} className="p-2.5 bg-slate-900 border border-slate-850 rounded-xl flex items-center justify-between text-xs">
                          <span className="truncate max-w-[150px] font-mono text-[10px] text-slate-300">{d.name}</span>
                          <span className="text-[8px] bg-slate-850 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded uppercase font-bold">{d.category}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic block text-left">No operational files registered.</p>
                  )}
                </div>

              </div>
            )}

            {/* CHAT TAB PANEL (Shipment Conversation room) */}
            {activeTab === 'chat' && (
              <div className="h-full flex flex-col justify-between pt-1 text-slate-200">
                {activeShipment ? (
                  <div className="flex-1 flex flex-col justify-between overflow-hidden h-[540px]">
                    <div className="bg-slate-900 p-2 border-b border-slate-800 flex items-center justify-between shrink-0">
                      <div>
                        <h4 className="font-bold text-xs text-slate-200">Admin ↔ direct helpline</h4>
                        <span className="text-[9px] text-orange-400 font-mono">#{activeShipment.shipmentNumber}</span>
                      </div>
                      <button 
                        onClick={() => setFileSimOpen(true)}
                        className="p-1 px-2.5 bg-orange-500 text-white font-bold text-[10px] rounded-full inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileUp className="w-3.5 h-3.5 shrink-0" />
                        <span>Send Attachment</span>
                      </button>
                    </div>

                    {/* Chat Search Input */}
                    <div className="px-2 py-1.5 bg-slate-900 border-b border-slate-800/60 flex items-center gap-1.5 shrink-0 transition-all">
                      <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <input
                        type="text"
                        placeholder={lang === 'tr' ? 'Mesajlarda ara...' : lang === 'ar' ? 'البحث عن رسالة...' : 'Search messages...'}
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        className="bg-transparent text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none w-full font-sans border-0"
                      />
                      {chatSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setChatSearchQuery("")}
                          className="text-slate-400 hover:text-white text-[9px] font-bold px-1.5 py-0.5 bg-slate-800 rounded cursor-pointer border-0"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Messages list scrollable */}
                    <div className="flex-1 overflow-y-auto p-2 my-1 space-y-3 max-h-[380px]">
                      {chatMessages
                        .filter(msg => {
                          if (!chatSearchQuery.trim()) return true;
                          const q = chatSearchQuery.toLowerCase().trim();
                          return (msg.text || "").toLowerCase().includes(q) || 
                                 (msg.fileName || "").toLowerCase().includes(q) || 
                                 (msg.senderName || "").toLowerCase().includes(q);
                        })
                        .map((msg) => {
                          const isMe = msg.sender === 'driver';
                          return (
                            <div key={msg.id} className={`flex flex-col max-w-[85%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                              <span className="text-[8px] text-slate-500 font-bold mb-0.5">{msg.senderName}</span>
                              <div className={`p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${
                                isMe 
                                  ? 'bg-orange-600 text-white rounded-tr-none' 
                                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                              }`}>
                                 {msg.type === 'file' ? (
                                  <div className="space-y-2">
                                    <span className="bg-slate-950 text-orange-400 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase block w-max">{msg.fileCategory}</span>
                                    <a 
                                      href={msg.fileUrl || "#"} 
                                      download={msg.fileName || "document.bin"}
                                      onClick={(e) => {
                                        if (!msg.fileUrl || msg.fileUrl === "#") {
                                          e.preventDefault();
                                          triggerToast("Document specimen offline preview active.");
                                        }
                                      }}
                                      className="font-bold underline cursor-pointer flex items-center gap-1 hover:text-orange-200 break-all"
                                    >
                                      <FileUp className="w-3.5 h-3.5 shrink-0 inline text-orange-400" />
                                      <span>{msg.fileName}</span>
                                    </a>

                                    {/* Rich image preview for live cargo photo uploads */}
                                    {((msg.fileCategory === 'photo' || msg.fileName?.match(/\.(jpeg|jpg|gif|png|webp)/i)) && msg.fileUrl && msg.fileUrl !== '#') && (
                                      <div className="mt-2 rounded-lg overflow-hidden border border-slate-800 max-w-[170px]">
                                        <img 
                                          src={msg.fileUrl} 
                                          alt={msg.fileName} 
                                          className="w-full h-auto object-cover max-h-[110px]" 
                                          referrerPolicy="no-referrer"
                                        />
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <p>{msg.text}</p>
                                    {translatedMessages[msg.id] && (
                                      <div className="mt-1.5 pt-1.5 border-t border-slate-800 text-orange-400 italic text-[11px] font-sans">
                                        <div className="flex items-center gap-1 mb-0.5 text-[8px] text-slate-500 not-italic font-bold uppercase tracking-wider">
                                          <Languages className="w-2.5 h-2.5 text-orange-400" />
                                          <span>{lang === 'tr' ? "Tercüme Edildi" : lang === 'ar' ? "تمت الترجمة" : "Translated"}</span>
                                        </div>
                                        <span>{translatedMessages[msg.id]}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[8px] text-slate-500 font-mono">
                                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                {isMe && (
                                  <span className={`inline-flex items-center gap-0.5 ${msg.status === 'seen' ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                                    • {msg.status === 'seen' ? '✓✓ Seen' : '✓ Sent'}
                                  </span>
                                )}
                                {!isMe && msg.text && (
                                  <>
                                    <span>•</span>
                                    <button
                                      type="button"
                                      onClick={() => handleTranslate(msg.id, msg.text || "")}
                                      className="text-[8px] text-slate-400 hover:text-orange-400 inline-flex items-center gap-0.5 cursor-pointer underline bg-transparent border-0 p-0 font-bold"
                                      disabled={isTranslatingId === msg.id}
                                    >
                                      <Languages className="w-2.5 h-2.5 shrink-0" />
                                      <span>
                                        {isTranslatingId === msg.id 
                                          ? (lang === 'tr' ? "Çevriliyor..." : "Translating...") 
                                          : translatedMessages[msg.id] 
                                            ? (lang === 'tr' ? "Gizle" : lang === 'ar' ? "إخفاء" : "Hide")
                                            : (lang === 'tr' ? "Türkçe" : lang === 'ar' ? "العربية" : "Translate")}
                                      </span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}

                      {chatMessages.length === 0 && (
                        <div className="py-20 text-center text-slate-600 italic text-xs">
                          No messaging threads active for shipment {activeShipment.shipmentNumber}. Send a greeting to the admin!
                        </div>
                      )}

                      {chatMessages.length > 0 && chatMessages.filter(msg => {
                        if (!chatSearchQuery.trim()) return true;
                        const q = chatSearchQuery.toLowerCase().trim();
                        return (msg.text || "").toLowerCase().includes(q) || 
                               (msg.fileName || "").toLowerCase().includes(q) || 
                               (msg.senderName || "").toLowerCase().includes(q);
                      }).length === 0 && (
                        <div className="py-10 text-center text-slate-600 text-xs italic">
                          No search results matching "{chatSearchQuery}".
                        </div>
                      )}

                      {/* Thread autoscroll anchor point */}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Quick response chips list */}
                    <div className="bg-slate-950 px-2 py-1.5 border-t border-slate-900 overflow-x-auto shrink-0 flex gap-1.5 items-center scroll-smooth no-scrollbar">
                      {(QUICK_TEMPLATES[lang] || QUICK_TEMPLATES.en).map((chip, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setNewMessageText(chip.text)}
                          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800/80 text-slate-300 hover:text-white rounded-full text-[9px] font-semibold whitespace-nowrap transition-all cursor-pointer shadow-sm select-none"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>

                    {/* Message input */}
                    <form onSubmit={handleSendMessage} className="bg-slate-950 p-3 border-t border-slate-900 flex items-center gap-2 shrink-0">
                      <button 
                        type="button" 
                        onClick={() => setFileSimOpen(true)}
                        title="Attach Document / Photo"
                        className="p-3 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer inline-flex items-center"
                      >
                        <Paperclip className="w-4 h-4 shrink-0" />
                      </button>

                      <input 
                        type="text" 
                        placeholder={t('typeMessage')}
                        value={newMessageText}
                        onChange={(e) => setNewMessageText(e.target.value)}
                        className="flex-1 p-3 bg-slate-900 border border-slate-800 focus:outline-none rounded-xl text-xs text-white placeholder-slate-500 focus:border-slate-500"
                      />
                      <button 
                        type="submit" 
                        disabled={!newMessageText.trim()}
                        className="p-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all cursor-pointer inline-flex items-center animate-pulse"
                      >
                        <Send className="w-4 h-4 shrink-0" />
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 italic space-y-2">
                    <MessageSquare className="w-8 h-8 mx-auto text-slate-800" />
                    <p className="text-xs">Select any shipment inside shipments list to open direct administrative messenger.</p>
                  </div>
                )}
              </div>
            )}

            {/* PROFILE TAB PANEL */}
            {activeTab === 'profile' && (() => {
              const editProfileLabels = {
                en: {
                  editBtn: "Edit Profile Info",
                  cancelBtn: "Cancel",
                  truckSpecs: "Tractor & Trailer specs",
                },
                tr: {
                  editBtn: "Profili Düzenle",
                  cancelBtn: "İptal",
                  truckSpecs: "Tır Teknik Özellikleri",
                },
                ar: {
                  editBtn: "تعديل الملف الشخصي",
                  cancelBtn: "إلغاء",
                  truckSpecs: "مواصفات الشاحنة",
                }
              }[lang] || {
                editBtn: "Edit Profile Info",
                cancelBtn: "Cancel",
                truckSpecs: "Tractor & Trailer specs",
              };

              const initials = profileName
                ? profileName
                    .split(" ")
                    .map(n => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()
                : "DR";

              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="font-extrabold text-sm text-slate-200 tracking-tight">{profileT.profileTitle}</h3>
                    <span className="bg-orange-500/10 text-orange-400 font-mono font-bold text-[10px] px-2 py-0.5 rounded uppercase">
                      ID: {selectedDriverId}
                    </span>
                  </div>

                  {!isEditingProfile ? (
                    // READ ONLY VIEW
                    <div className="space-y-4">
                      {/* Driver Avatar */}
                      <div className="flex flex-col items-center justify-center py-4 text-center">
                        <div className="relative group">
                          <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-white font-black text-lg shadow-md border-2 border-slate-800 bg-slate-800">
                            {isUploadingAvatar ? (
                              <div className="flex items-center justify-center w-full h-full bg-slate-950/70">
                                <span className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                              </div>
                            ) : profileAvatarUrl ? (
                              <img src={profileAvatarUrl} alt={profileName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center">
                                {initials}
                              </div>
                            )}
                          </div>
                          
                          {/* File input (invisible) */}
                          <input 
                            type="file" 
                            ref={avatarFileRef} 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handleUploadAvatar} 
                          />

                          {/* Hover camera trigger overlay */}
                          <button
                            type="button"
                            onClick={() => avatarFileRef.current?.click()}
                            disabled={isUploadingAvatar}
                            className="absolute inset-0 bg-black/40 hover:bg-black/65 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            title={lang === 'tr' ? "Fotoğrafı Değiştir" : "Change Photo"}
                          >
                            <Camera className="w-5 h-5 text-white" />
                          </button>
                          
                          {/* Pulse indicator for active/online status */}
                          <span className="absolute bottom-1 right-1 w-4 h-4 bg-emerald-500 border-2 border-slate-900 rounded-full animate-pulse z-10" />
                        </div>

                        {/* Direct change trigger */}
                        <button
                          type="button"
                          onClick={() => avatarFileRef.current?.click()}
                          disabled={isUploadingAvatar}
                          className="mt-2.5 text-[10.5px] text-orange-400 hover:text-orange-500 font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5 shrink-0" />
                          <span>{lang === 'tr' ? "Profil Resmini Güncelle" : (lang === 'ar' ? "تحديث الصورة الشخصية" : "Update Profile Photo")}</span>
                        </button>

                        <h4 className="mt-3 font-black text-slate-100 text-sm tracking-tight">{profileName}</h4>
                        <p className="text-[10px] font-mono font-bold text-orange-400">@{profileUsername || "driver"}</p>
                      </div>

                      {/* Stats Counter Grid */}
                      <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-3 border border-slate-800/80 rounded-2xl text-center">
                        <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/40">
                          <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wide">{profileT.activeJobs}</span>
                          <p className="text-base font-black text-orange-500 mt-0.5">
                            {drivers.find(d => d.id === selectedDriverId)?.activeShipmentsCount ?? 0}
                          </p>
                        </div>
                        <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/40">
                          <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wide">{profileT.completedJobs}</span>
                          <p className="text-base font-black text-emerald-500 mt-0.5">
                            {drivers.find(d => d.id === selectedDriverId)?.completedShipmentsCount ?? 0}
                          </p>
                        </div>
                      </div>

                      {/* Personal Info Box */}
                      <div className="p-3.5 bg-slate-900 border border-slate-850 rounded-2xl space-y-3">
                        <span className="text-[9.5px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800/65 pb-1.5">{profileT.personalData}</span>
                        
                        <div className="flex items-center justify-between text-xs py-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.fullName}
                          </span>
                          <strong className="text-slate-200">{profileName}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-850">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.username}
                          </span>
                          <strong className="text-slate-300 font-mono text-[10.5px]">@{profileUsername}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-850">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.phone}
                          </span>
                          <strong className="text-slate-200 font-sans">{profilePhone}</strong>
                        </div>
                      </div>

                      {/* Tractor & Trailer Specifications */}
                      <div className="p-3.5 bg-slate-900 border border-slate-850 rounded-2xl space-y-3">
                        <span className="text-[9.5px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800/65 pb-1.5">{editProfileLabels.truckSpecs}</span>
                        
                        <div className="flex items-center justify-between text-xs py-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Truck className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.truckNumber}
                          </span>
                          <strong className="text-slate-200 font-mono tracking-wide">{profileTruckNumber}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-850">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.truckType}
                          </span>
                          <strong className="text-orange-400 font-bold uppercase text-[10.5px]">
                            {(() => {
                              const matched = TRUCK_TYPES.find(t => t.id === profileTruckType);
                              if (!matched) return profileTruckType;
                              return lang === 'en' ? matched.en : (lang === 'tr' ? matched.tr : matched.ar);
                            })()}
                          </strong>
                        </div>
                      </div>

                      <button 
                        type="button"
                        onClick={() => setIsEditingProfile(true)}
                        className="w-full p-2.5 bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-[0.98]"
                      >
                        <Edit2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{editProfileLabels.editBtn}</span>
                      </button>
                    </div>
                  ) : (
                    // EDIT FORM VIEW
                    <form onSubmit={handleUpdateProfile} className="space-y-3.5">
                      <div className="space-y-3 p-4 bg-slate-900 border border-slate-850 rounded-2xl text-left">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800 pb-1.5">{profileT.personalData}</span>
                        
                        {/* Edit Mode Avatar Section */}
                        <div className="flex items-center gap-4 py-2 border-b border-slate-800/40 pb-3">
                          <div className="relative">
                            <div className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-white font-black text-sm shadow border border-slate-800 bg-slate-850">
                              {isUploadingAvatar ? (
                                <div className="flex items-center justify-center w-full h-full bg-slate-900">
                                  <span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                              ) : profileAvatarUrl ? (
                                <img src={profileAvatarUrl} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center">
                                  {initials}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <h5 className="text-xs font-bold text-slate-200">
                              {lang === 'tr' ? "Profil Fotoğrafı" : (lang === 'ar' ? "الصورة الشخصية" : "Profile Photo")}
                            </h5>
                            <p className="text-[10px] text-slate-500">
                              {lang === 'tr' ? "PNG veya JPG biçimleri" : (lang === 'ar' ? "يدعم صيغ PNG و JPG" : "Supports PNG and JPG formats")}
                            </p>
                            <button
                              type="button"
                              onClick={() => avatarFileRef.current?.click()}
                              disabled={isUploadingAvatar}
                              className="px-2.5 py-1 bg-slate-950 border border-slate-800 hover:border-orange-500/50 text-orange-400 font-extrabold text-[10px] rounded transition-all cursor-pointer flex items-center gap-1 mt-1"
                            >
                              <Camera className="w-3 h-3 text-orange-400" />
                              <span>{lang === 'tr' ? "Yükle / Değiştir" : (lang === 'ar' ? "رفع / تغيير" : "Upload / Change")}</span>
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 block text-left font-bold">{profileT.fullName}</label>
                          <input 
                            type="text" 
                            required
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            className="w-full p-2 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-lg outline-none font-semibold focus:border-orange-500 transition-all text-left"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 block text-left font-bold">{profileT.username}</label>
                          <input 
                            type="text" 
                            required
                            value={profileUsername}
                            onChange={(e) => setProfileUsername(e.target.value)}
                            className="w-full p-2 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-lg outline-none font-mono focus:border-orange-500 transition-all text-left"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 block text-left font-bold">{profileT.phone}</label>
                          <input 
                            type="text"
                            required 
                            value={profilePhone}
                            onChange={(e) => setProfilePhone(e.target.value)}
                            className="w-full p-2 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-lg outline-none font-semibold focus:border-orange-500 transition-all text-left"
                          />
                        </div>
                      </div>

                      {/* Truck Details Edit fields */}
                      <div className="space-y-3 p-4 bg-slate-900 border border-slate-850 rounded-2xl text-left">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800 pb-1.5">{editProfileLabels.truckSpecs}</span>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 block text-left font-bold">{profileT.truckNumber}</label>
                          <input 
                            type="text" 
                            required
                            value={profileTruckNumber}
                            onChange={(e) => setProfileTruckNumber(e.target.value)}
                            className="w-full p-2 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-lg outline-none font-mono focus:border-orange-500 transition-all text-left"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 block text-left font-bold">{profileT.truckType}</label>
                          <select 
                            value={profileTruckType}
                            onChange={(e) => setProfileTruckType(e.target.value)}
                            className="w-full p-2 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-lg outline-none font-semibold focus:border-orange-500 transition-all text-left cursor-pointer"
                          >
                            {TRUCK_TYPES.map(type => (
                              <option key={type.id} value={type.id} className="bg-slate-950 text-white">
                                {lang === 'en' ? type.en : (lang === 'tr' ? type.tr : type.ar)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button 
                          type="button"
                          onClick={() => {
                            const dr = drivers.find(d => d.id === selectedDriverId);
                            if (dr) {
                              setProfileName(dr.name || "");
                              setProfileUsername(dr.username || "");
                              setProfilePhone(dr.phone || "");
                              setProfileTruckNumber(dr.truckNumber || "");
                              setProfileTruckType(dr.truckType || "reefer");
                            }
                            setIsEditingProfile(false);
                          }}
                          disabled={isSavingProfile}
                          className="flex-1 p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-extrabold text-xs rounded-xl transition-all cursor-pointer text-center"
                        >
                          {editProfileLabels.cancelBtn}
                        </button>
                        <button 
                          type="submit" 
                          disabled={isSavingProfile}
                          className="flex-1 p-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {isSavingProfile ? (
                            <span>{profileT.saveSpinner}</span>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>{profileT.saveProfile}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}

                  {onLogout && (
                    <button 
                      type="button" 
                      onClick={onLogout}
                      className="w-full py-2.5 bg-slate-950 hover:bg-red-950/40 border border-slate-800 hover:border-red-500/30 text-slate-400 hover:text-red-400 font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                    >
                      <X className="w-4 h-4 shrink-0 text-red-500" />
                      <span>{profileT.logout}</span>
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Custom simulated file uploads modal overlay inside mobile frame */}
            {fileSimOpen && (
              <div className="absolute inset-0 bg-slate-950/90 z-40 flex items-center justify-center p-4">
                <div className="bg-slate-900 p-4 border border-slate-800 rounded-2xl w-full space-y-4 text-xs">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-slate-200">Simulate Digital Payload Upload</h5>
                    <button onClick={() => setFileSimOpen(false)} className="text-slate-500"><X className="w-4 h-4" /></button>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 block uppercase">Upload Real Photo / Doc</label>
                      <input 
                        type="file" 
                        accept="image/*,application/pdf,.doc,.docx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setSelectedFile(file);
                            setSimFileName(file.name);
                            if (file.type.startsWith("image/")) {
                              setSimFileCategory("photo");
                            } else if (file.name.toLowerCase().includes("cmr")) {
                              setSimFileCategory("cmr");
                            } else if (file.name.toLowerCase().includes("invoice")) {
                              setSimFileCategory("invoice");
                            } else if (file.name.toLowerCase().includes("packing")) {
                              setSimFileCategory("packing_list");
                            } else if (file.name.toLowerCase().includes("customs")) {
                              setSimFileCategory("customs");
                            } else if (file.name.toLowerCase().includes("delivery") || file.name.toLowerCase().includes("pod")) {
                              setSimFileCategory("delivery_proof");
                            }
                            
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                              const b64 = evt.target?.result as string;
                              setSimFileUrl(b64);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 block uppercase font-mono">Or Manual File Name</label>
                      <input 
                        type="text" 
                        placeholder="e.g. IMG_HASSAN_BORDER_CROSSING.jpg" 
                        value={simFileName}
                        onChange={(e) => setSimFileName(e.target.value)}
                        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg font-mono text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 block uppercase">Document Category</label>
                      <select
                        value={simFileCategory}
                        onChange={(e) => setSimFileCategory(e.target.value as DocumentCategory)}
                        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg text-xs"
                      >
                        <option value="cmr">CMR Document</option>
                        <option value="invoice">Invoice Receipt</option>
                        <option value="packing_list">Packing Sheet</option>
                        <option value="customs">Customs Clearance Receipt</option>
                        <option value="delivery_proof">Delivery Voucher (POD)</option>
                        <option value="photo">Cargo Live Photo</option>
                        <option value="other">Other PDF / Doc File</option>
                      </select>
                    </div>

                    <button 
                      onClick={handleSimulateUpload}
                      disabled={!simFileName.trim() || isUploading}
                      className="w-full p-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-850 text-white font-extrabold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {isUploading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Camera className="w-4 h-4 shrink-0" />
                      )}
                      <span>{isUploading ? "Uploading to Cloud Storage..." : "Attach Document to Chat"}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Bottom Dock Navigation Tabs menu */}
          <div className="grid grid-cols-4 bg-slate-950 py-2 border-t border-slate-905 mt-2 shrink-0">
            <button 
              onClick={() => {
                setActiveTab('shipments');
                setFileSimOpen(false);
              }}
              className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
                activeTab === 'shipments' ? 'text-orange-500 font-bold' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Truck className="w-4 h-4 shrink-0" />
              <span>Jobs</span>
            </button>
            <button 
              onClick={() => {
                setActiveTab('chat');
                setFileSimOpen(false);
              }}
              disabled={!activeShipment}
              className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all relative ${
                activeTab === 'chat' ? 'text-orange-500 font-bold' : 'text-slate-500 hover:text-slate-300'
              } disabled:opacity-30`}
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span>Chat</span>
            </button>
            <button 
              onClick={() => {
                setActiveTab('notifications');
                setFileSimOpen(false);
              }}
              className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
                activeTab === 'notifications' ? 'text-orange-500 font-bold' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <div className="relative">
                <Bell className="w-4 h-4 shrink-0" />
                {notifications.some(n => !n.read) && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-orange-500 animate-ping"></span>
                )}
              </div>
              <span>Alerts</span>
            </button>
            <button 
              onClick={() => {
                setActiveTab('profile');
                setFileSimOpen(false);
              }}
              className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
                activeTab === 'profile' ? 'text-orange-500 font-bold' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <User className="w-4 h-4 shrink-0" />
              <span>Profile</span>
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
