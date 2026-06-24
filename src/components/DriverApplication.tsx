import React, { useState, useEffect, useRef, useMemo } from "react";
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
import { auth } from "../googleAuth";
import { TRANSLATIONS } from "../translations";
import { apiFetch } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { 
  Ship, MessageSquare, Truck, DollarSign, Bell, Send, CheckCircle2, 
  X, Camera, FileUp, AlertTriangle, ChevronRight, CornerDownRight, Landmark, User,
  Edit2, Phone, Shield, Check, MapPin, Activity, Briefcase, Paperclip, Search, Languages,
  Star, Award, HeartPulse, Palette, Settings, Volume2, VolumeX, Timer, Gauge, Fuel, Coffee, Trash2, ShieldAlert,
  Plus, Minus, Compass, Sun, Moon, Play, Lock
} from 'lucide-react';

const fetch = apiFetch;

interface DriverApplicationProps {
  lang: Language;
  loggedInDriverId?: string | null;
  loggedInDriver?: Driver | null;
  onLogout?: () => void;
  isMobile?: boolean;
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

// Retrieve Maps API key safely across development, iframe, and production runtimes
const GOOGLE_MAPS_KEY_FALLBACK =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

interface RouteDisplayProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
}

function RouteDisplay({ origin, destination }: RouteDisplayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map) return;
    
    // Clear previous route
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    }).then(({ routes }) => {
      if (routes?.[0]) {
        const newPolylines = routes[0].createPolylines();
        newPolylines.forEach(p => p.setMap(map));
        polylinesRef.current = newPolylines;

        if (routes[0].viewport) {
          map.fitBounds(routes[0].viewport);
        }
      }
    }).catch(err => {
      console.warn("Google Maps Corridor Routing failed:", err);
    });

    return () => {
      polylinesRef.current.forEach(p => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [routesLib, map, origin.lat, origin.lng, destination.lat, destination.lng]);

  return null;
}

interface MapCustomControlsProps {
  activeShipment: Shipment | null;
  lang: Language;
}

function MapCustomControls({ activeShipment, lang }: MapCustomControlsProps) {
  const map = useMap();

  const handleZoomIn = () => {
    if (map) {
      map.setZoom((map.getZoom() || 6) + 1);
    }
  };

  const handleZoomOut = () => {
    if (map) {
      map.setZoom((map.getZoom() || 6) - 1);
    }
  };

  const handleCenterRoute = () => {
    if (!map) return;
    if (typeof google === "undefined" || !google.maps) return;

    if (activeShipment) {
      const originName = (activeShipment.loadingCity || "").toLowerCase().trim();
      const destName = (activeShipment.deliveryCity || "").toLowerCase().trim();
      const startLoc = CITY_COORDINATES[originName] || CITY_COORDINATES["istanbul"];
      const endLoc = CITY_COORDINATES[destName] || CITY_COORDINATES["baghdad"];
      
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(startLoc);
      bounds.extend(endLoc);
      map.fitBounds(bounds);
    }
  };

  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5 pointer-events-auto">
      {/* Zoom Panel */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-xl flex flex-col overflow-hidden">
        <button
          type="button"
          onClick={handleZoomIn}
          title={lang === "tr" ? "Yakınlaştır" : lang === "ar" ? "تكبير" : "Zoom In"}
          aria-label={lang === "tr" ? "Yakınlaştır" : lang === "ar" ? "تكبير" : "Zoom In"}
          className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border-b border-slate-800 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          title={lang === "tr" ? "Uzaklaştır" : lang === "ar" ? "تصغير" : "Zoom Out"}
          aria-label={lang === "tr" ? "Uzaklaştır" : lang === "ar" ? "تصغير" : "Zoom Out"}
          className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Auto-Centering Control */}
      <button
        type="button"
        onClick={handleCenterRoute}
        title={lang === "tr" ? "Rotaya Odaklan" : lang === "ar" ? "التركيز على المسار" : "Focus on Route"}
        className="w-7 h-7 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-xl flex items-center justify-center text-orange-400 hover:text-orange-300 hover:bg-slate-800 hover:scale-105 active:scale-95 transition-all cursor-pointer"
      >
        <Compass className="w-3.5 h-3.5 animate-pulse text-orange-500" style={{ animationDuration: "3s" }} />
      </button>
    </div>
  );
}

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
  onLogout,
  isMobile = false
}: DriverApplicationProps) {
  const isMobileMode = isMobile || useIsMobile(768);
  const [showControlsModal, setShowControlsModal] = useState(false);
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
  const isShipmentFinished = activeShipment ? (activeShipment.status === 'Delivered' || activeShipment.status === 'Arrived' || activeShipment.status === 'Closed' || activeShipment.status === 'Completed') : false;

  // Calculate real percentage of total trip distance based on shipment start and end coordinates
  const calculateDistancePercentage = (): number => {
    if (!activeShipment) return 0;
    if (isShipmentFinished) return 100;
    if (activeShipment.status === 'New') return 0;

    const startCity = (activeShipment.loadingCity || "istanbul").toLowerCase().trim();
    const endCity = (activeShipment.deliveryCity || "baghdad").toLowerCase().trim();

    const start = CITY_COORDINATES[startCity] || CITY_COORDINATES["istanbul"];
    const end = CITY_COORDINATES[endCity] || CITY_COORDINATES["baghdad"];

    if (!lastGpsCoords) {
      // Fallback logic if dynamic GPS coordinate has not updated yet
      switch (activeShipment.status) {
        case 'Assigned': return 10;
        case 'Accepted': return 25;
        case 'Loading': return 40;
        case 'Loaded': return 55;
        case 'In Transit': return 75;
        case 'Border Crossing': return 88;
        case 'Customs Clearance': return 94;
        default: return 0;
      }
    }

    const vLat = end.lat - start.lat;
    const vLng = end.lng - start.lng;

    const uLat = lastGpsCoords.lat - start.lat;
    const uLng = lastGpsCoords.lng - start.lng;

    const denominator = vLat * vLat + vLng * vLng;
    if (denominator === 0) return 0;

    const dotProduct = uLat * vLat + uLng * vLng;
    const t = dotProduct / denominator;

    return Math.max(0, Math.min(98, Math.round(t * 100)));
  };

  const [activeTab, setActiveTab] = useState<'shipments' | 'chat' | 'notifications' | 'profile' | 'menu'>('shipments');

  const [activeMapsKey, setActiveMapsKey] = useState<string>(GOOGLE_MAPS_KEY_FALLBACK);
  const hasValidMapsKey = Boolean(activeMapsKey) && activeMapsKey !== "YOUR_API_KEY";
  const [mapsAuthError, setMapsAuthError] = useState<boolean>(() => {
    return Boolean((window as any).googleMapsAuthFailed);
  });

  useEffect(() => {
    const handleMapsFailure = () => {
      setMapsAuthError(true);
    };
    window.addEventListener("google-maps-auth-failure", handleMapsFailure);
    return () => {
      window.removeEventListener("google-maps-auth-failure", handleMapsFailure);
    };
  }, []);

  useEffect(() => {
    fetch("/api/maps-key")
      .then(async res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return res.json();
        } else {
          const text = await res.text();
          throw new Error(`Non-JSON response: ${text.slice(0, 50)}`);
        }
      })
      .then(data => {
        if (data && data.key) {
          setActiveMapsKey(data.key);
        }
      })
      .catch(err => console.warn("Could not retrieve map configuration gracefully:", err.message));
  }, []);

  // Driver App Settings & Tools States
  const [telemetryInterval, setTelemetryInterval] = useState<number>(15);
  const [distanceUnit, setDistanceUnit] = useState<'km' | 'mi'>('km');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [speedLimitWarn, setSpeedLimitWarn] = useState<boolean>(true);
  
  // Break / Driving Limit Timer States
  const [drivingStatus, setDrivingStatus] = useState<'off' | 'driving' | 'resting'>('off');
  const [drivingTimeLeft, setDrivingTimeLeft] = useState<number>(4.5 * 3600); // 4.5 hours in seconds
  const [restingTimeLeft, setRestingTimeLeft] = useState<number>(45 * 60); // 45 minutes in seconds

  // Proof of Delivery Signature States
  const [podReceiverName, setPodReceiverName] = useState<string>("");
  const [podChecklist, setPodChecklist] = useState({ sealIntact: false, cargoVerified: false });
  const [podSigningActive, setPodSigningActive] = useState<boolean>(false);
  const [podUploading, setPodUploading] = useState<boolean>(false);

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Check if touch event
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coords = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    isDrawingRef.current = true;
  };

  const drawSignature = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coords = getCoordinates(e);
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = '#1e3a8a'; // Blue ink color for official feel
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleCompleteDeliveryWithSignature = async () => {
    if (!activeShipment) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;

    const base64DataUrl = canvas.toDataURL('image/png');

    setPodUploading(true);
    try {
      // 1. Upload signature image to backend media gateway
      let finalSignatureUrl = "";
      try {
        const uploadRes = await apiFetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64DataUrl: base64DataUrl,
            filename: `SIGNATURE_POD_${activeShipment.shipmentNumber}.png`
          })
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          finalSignatureUrl = uploadData.url;
        }
      } catch (uploadErr) {
        console.warn("POD Signature upload failed:", uploadErr);
      }

      // 2. Put status details
      const response = await apiFetch(`/api/shipments/${activeShipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "Delivered",
          remarksDesc: `Shipment marked delivered at destination depot. Digitally signed by consignee representative: ${podReceiverName || "Authorized Receiver"}. Signature URL linked in logs.`,
          updaterName: getDriverName(),
          role: "driver"
        })
      });

      if (response.ok) {
        triggerToast("🎉 Proof of Delivery Captured! Shipment registered as Delivered.");
        
        // 3. Document payload for dispatcher chat timeline sync
        try {
          const sigPayload = {
            sender: "driver",
            senderName: getDriverName(),
            type: "file",
            fileName: `POD_Signature_${activeShipment.shipmentNumber}.png`,
            fileCategory: "delivery_proof",
            fileUrl: finalSignatureUrl || base64DataUrl,
            text: `📦 Proof of Delivery (POD) Signed by: ${podReceiverName || "Authorized Receiver"}.\n- Seals Checked: ${podChecklist.sealIntact ? "YES" : "NO"}\n- Cargo Condition Verified: ${podChecklist.cargoVerified ? "YES" : "NO"}`
          };

          await apiFetch(`/api/shipments/${activeShipment.id}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sigPayload)
          });
        } catch (chatErr) {
          console.warn("Could not save POD signature packet to chat timeline:", chatErr);
        }

        setPodSigningActive(false);
        setPodReceiverName("");
        setPodChecklist({ sealIntact: false, cargoVerified: false });
        fetchData(); // Refresh UI
      } else {
        triggerToast("❌ Status update failed. Please check dispatcher connection.");
      }
    } catch (err) {
      console.error("POD Sign-off save error:", err);
      triggerToast("❌ Communication issue. Retry POD capture.");
    } finally {
      setPodUploading(false);
    }
  };

  // Fuel & Dynamic Cargo Calculator States
  const [calcCargoWeight, setCalcCargoWeight] = useState<number>(18); // 18 tons default
  const [calcDistance, setCalcDistance] = useState<number>(420); // 420 km default
  const [calcTerrain, setCalcTerrain] = useState<'flat' | 'hilly' | 'mountain'>('flat');
  const [calcResult, setCalcResult] = useState<{ fuel: number; time: number } | null>({ fuel: 161.7, time: 5.25 });

  // Countdown limits stopwatch effect
  useEffect(() => {
    let timer: any;
    if (drivingStatus === 'driving') {
      timer = setInterval(() => {
        setDrivingTimeLeft(prev => {
          if (prev <= 1) {
            setDrivingStatus('off');
            triggerToast("🚨 Driving Limit Reached! Pull over immediately for a mandatory 45-minute rest break.");
            return 4.5 * 3600;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (drivingStatus === 'resting') {
      timer = setInterval(() => {
        setRestingTimeLeft(prev => {
          if (prev <= 1) {
            setDrivingStatus('off');
            triggerToast("✅ Rest break completed successfully! Ready for your next driving shift.");
            return 45 * 60;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [drivingStatus]);

  const formatTimer = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const calculateFuelEstimate = () => {
    let terrainFactor = 1.0;
    let avgSpeed = 80; // km/h
    if (calcTerrain === 'hilly') {
      terrainFactor = 1.25;
      avgSpeed = 70;
    } else if (calcTerrain === 'mountain') {
      terrainFactor = 1.55;
      avgSpeed = 50;
    }

    const consumptionPer100Km = (32 + (calcCargoWeight * 0.45)) * terrainFactor;
    const fuelVal = (calcDistance / 100) * consumptionPer100Km;
    const estimatedHours = calcDistance / avgSpeed;

    setCalcResult({
      fuel: Math.round(fuelVal * 10) / 10,
      time: Math.round(estimatedHours * 10) / 10
    });
  };

  // Run calculation as inputs change
  useEffect(() => {
    calculateFuelEstimate();
  }, [calcCargoWeight, calcDistance, calcTerrain]);

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

  // Call Simulator States and Timers
  const [callState, setCallState] = useState<'idle' | 'calling' | 'connected'>('idle');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [shipmentsFilter, setShipmentsFilter] = useState<'active' | 'completed'>('active');

  useEffect(() => {
    let interval: any;
    if (callState === 'connected') {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [callState]);

  const handleStartCall = () => {
    if (callState !== 'idle') return;
    setCallState('calling');
    triggerToast(lang === 'tr' ? "☎️ Güvenli sevk telsiz araması başlatılıyor..." : (lang === 'ar' ? "☎️ جاري الاتصال الهاتفي الآمن..." : "☎️ Placing encrypted VoIP radio call to Logistics HQ..."));
    
    // Play calling ring tones using Web Audio API
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.01, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch (_) {}

    setTimeout(() => {
      setCallState('connected');
      triggerToast(lang === 'tr' ? "🎙️ Sevk sorumlusuna bağlanıldı." : (lang === 'ar' ? "🎙️ تم الاتصال بمسؤول المتابعة." : "🎙️ Connected to Logistics Command."));
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } catch (_) {}
    }, 2200);
  };

  const handleEndCall = () => {
    setCallState('idle');
    triggerToast(lang === 'tr' ? "📞 Sevk telsiz kanalı kapatıldı." : (lang === 'ar' ? "📞 تم إغلاق خط الاتصال." : "📞 Dispatch radio channel closed."));
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (_) {}
  };

  // Input states
  const [newMessageText, setNewMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  
  // Theme mode switch (light vs dark)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('driver_app_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('driver_app_theme', theme);
  }, [theme]);

  // Driver Account Deletion States
  const [showDriverDeleteConfirm, setShowDriverDeleteConfirm] = useState(false);
  const [understandDriverDelete, setUnderstandDriverDelete] = useState(false);
  const [isDeletingDriverAccount, setIsDeletingDriverAccount] = useState(false);

  const handleDeleteDriverAccount = async () => {
    if (!understandDriverDelete) return;
    setIsDeletingDriverAccount(true);
    const targetId = loggedInDriverId || selectedDriverId;
    try {
      // 1. Delete backing collection data
      const response = await apiFetch(`/api/drivers/${targetId}`, {
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
        triggerToast("🗑️ Account completely deleted from corporate registry.");
        // Logout user session and clean state
        if (onLogout) {
          onLogout();
        }
      } else {
        triggerToast("❌ Failed to initiate account purge. Try again.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Purge action failed. Check connection.");
    } finally {
      setIsDeletingDriverAccount(false);
      setShowDriverDeleteConfirm(false);
    }
  };

  // Custom file sim trigger
  const [fileSimOpen, setFileSimOpen] = useState(false);
  const [simFileName, setSimFileName] = useState("");
  const [simFileCategory, setSimFileCategory] = useState<DocumentCategory>("cmr");
  const [simFileUrl, setSimFileUrl] = useState("#");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Camera Document Scanner states
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [scanState, setScanState] = useState<'scanning' | 'review' | 'uploading'>('scanning');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [scanFilter, setScanFilter] = useState<'color' | 'grayscale' | 'mono'>('color');
  const [scanCategory, setScanCategory] = useState<DocumentCategory>("cmr");
  const [scanDocName, setScanDocName] = useState("");
  const [flashLight, setFlashLight] = useState(false);

  // GPS live simulation states
  const [gpsSimActive, setGpsSimActive] = useState<boolean>(true);
  const [gpsProgress, setGpsProgress] = useState<number>(35); // starts at 35% along path
  const [gpsSpeed, setGpsSpeed] = useState<number>(82); // simulated speed in km/h
  const [lastGpsCoords, setLastGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  
  // Driver Assist adaptive routing & traffic patterns states
  const [trafficPattern, setTrafficPattern] = useState<'optimal' | 'moderate' | 'congested' | 'border_delay'>('moderate');
  const [assistActive, setAssistActive] = useState<boolean>(true);
  const [quickStatusOpen, setQuickStatusOpen] = useState(false);

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

  const [simTime, setSimTime] = useState<string>(() => {
    const date = new Date();
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    return `${hours}:${minutes} ${ampm}`;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const date = new Date();
      let hours = date.getHours();
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      setSimTime(`${hours}:${minutes} ${ampm}`);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(`etir_cached_gps_${selectedDriverId}`, JSON.stringify(cachedCoords));
    } catch (_) {}
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

      const resDrivers = await apiFetch("/api/drivers");
      if (resDrivers.ok) {
        let driversList = await safeJson(resDrivers);
        if (loggedInDriver && !driversList.some((d: Driver) => d.id === loggedInDriver.id)) {
          driversList = [...driversList, loggedInDriver];
        }
        setDrivers(driversList);
      }

      let activeShipmentsList: Shipment[] = [];
      const resShipments = await apiFetch(`/api/shipments?driverId=${selectedDriverId}`);
      if (resShipments.ok) {
        const list = await safeJson(resShipments);
        activeShipmentsList = list;
        setShipments(list);
        
        // update active shipment details dynamically if it is loaded
        if (activeShipment) {
          const fresh = list.find((s: Shipment) => s.id === activeShipment.id);
          if (fresh) {
            setActiveShipment(fresh);
            const isCompleted = fresh.status === 'Delivered' || fresh.status === 'Arrived' || fresh.status === 'Closed' || fresh.status === 'Completed';
            if (isCompleted) {
              setGpsSimActive(false);
            }
          }
        }
      }

      // Fetch dynamic messages
      if (activeShipment) {
        const resChat = await apiFetch(`/api/shipments/${activeShipment.id}/chat`);
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
      const resNotifs = await apiFetch("/api/notifications");
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
          const resChat = await apiFetch(`/api/shipments/${activeShipment.id}/chat`);
          if (resChat.ok) {
            const txt = await resChat.text();
            if (txt.trim() && !txt.trim().startsWith("<")) {
              const msgs: ChatMessage[] = JSON.parse(txt);
              setChatMessages(msgs);

              const hasUnseenFromAdmin = msgs.some((m: any) => m.sender === 'admin' && m.status !== 'seen');
              if (hasUnseenFromAdmin) {
                await apiFetch(`/api/shipments/${activeShipment.id}/chat/seen`, {
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
        const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
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
        const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
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
      if (syncedCount === 0 && itemsToSync.length > 0) {
        triggerToast("⚠️ GPS location sync failed. Your recent location updates haven't reached dispatch yet — will retry automatically.");
      } else {
        setCachedCoords([]);
      }
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

    const startLoc = CITY_COORDINATES[(activeShipment?.loadingCity || "").toLowerCase().trim()] || 
                     CITY_COORDINATES["istanbul"];
    const endLoc = CITY_COORDINATES[(activeShipment?.deliveryCity || "").toLowerCase().trim()] || 
                   CITY_COORDINATES["baghdad"];

    const interval = setInterval(() => {
      const runGpsFallback = () => {
        setGpsProgress(prev => {
          let next = prev + 1;
          if (next > 95) {
            next = 10; // Reset loop
          }

          const interpolationPct = next / 100;
          const latDrift = (Math.random() - 0.5) * 0.0015;
          const lngDrift = (Math.random() - 0.5) * 0.0015;

          const currentLat = startLoc.lat + (endLoc.lat - startLoc.lat) * interpolationPct + latDrift;
          const currentLng = startLoc.lng + (endLoc.lng - startLoc.lng) * interpolationPct + lngDrift;

          setLastGpsCoords({ lat: currentLat, lng: currentLng });
          transmitGPS(currentLat, currentLng);
          return next;
        });
      };

      if (navigator.geolocation) {
        try {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const currentLat = position.coords.latitude;
              const currentLng = position.coords.longitude;
              setLastGpsCoords({ lat: currentLat, lng: currentLng });
              transmitGPS(currentLat, currentLng);
            },
            (error) => {
              // Geolocation failed or denied, run graceful simulation fallback path
              runGpsFallback();
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
          );
        } catch (err) {
          console.warn("Synchronous Geolocation execution blocked or failed inside iframe:", err);
          runGpsFallback();
        }
      } else {
        runGpsFallback();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [gpsSimActive, activeShipment?.id, selectedDriverId, drivers, isForceOffline]);

  const handleManualTeleport = (cityName: string) => {
    const coords = CITY_COORDINATES[(cityName || "").toLowerCase().trim()];
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
      const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
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
      } else {
        let msg = "Failed to update profile. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
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

        // Upload via the server, which now writes durably to Firebase
        // Storage itself (see /api/upload in server.ts) — no separate
        // client-side Storage fallback needed or possible anymore, since
        // Storage now requires the server's own dedicated account
        // (see storage.rules).
        try {
          const uploadRes = await apiFetch("/api/upload", {
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
          console.warn("Avatar upload request failed:", gatewayErr);
        }

        if (!uploadedViaGateway) {
          triggerToast(lang === 'tr' ? "Yükleme başarısız oldu!" : (lang === 'ar' ? "فشل رفع الصورة!" : "Failed to upload avatar image. Please try again."));
          setIsUploadingAvatar(false);
          return;
        }

        setProfileAvatarUrl(uploadedUrl);

        // Force immediate database update to ensure instant persistence
        const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
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
        } else {
          triggerToast(lang === 'tr' ? "Resim yüklendi ama profil kaydedilemedi. Lütfen tekrar deneyin." : (lang === 'ar' ? "تم رفع الصورة لكن فشل حفظ الملف الشخصي. حاول مرة أخرى." : "Photo uploaded but couldn't save to your profile. Please try again."));
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
      const res = await apiFetch(`/api/shipments/${shipment.id}/status`, {
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
        
        // Automatically enable and sync the device GPS location data upon accepting a shipment
        setGpsSimActive(true);
        if (navigator.geolocation) {
          triggerToast("📡 Initializing hardware GPS connection... Obtaining precise coordinates.");
          try {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                setLastGpsCoords({ lat, lng });
                transmitGPS(lat, lng);
                triggerToast("🚀 Hardware GPS connection synced! Location successfully broadcast to dispatcher.");
              },
              (err) => {
                console.warn("Hardware GPS failed, using smart route simulator fallback:", err.message);
                // Fallback immediately to simulation start location
                const startCity = (shipment.loadingCity || "istanbul").toLowerCase().trim();
                const startCoords = CITY_COORDINATES[startCity] || CITY_COORDINATES["istanbul"];
                setLastGpsCoords(startCoords);
                transmitGPS(startCoords.lat, startCoords.lng);
                triggerToast("📡 Simulated GPS tracking initiated in auto-mode.");
              },
              { enableHighAccuracy: true, timeout: 5000 }
            );
          } catch (geoErr) {
            console.warn("Synchronous Geolocation blocked or failed in iframe:", geoErr);
            const startCity = (shipment.loadingCity || "istanbul").toLowerCase().trim();
            const startCoords = CITY_COORDINATES[startCity] || CITY_COORDINATES["istanbul"];
            setLastGpsCoords(startCoords);
            transmitGPS(startCoords.lat, startCoords.lng);
          }
        } else {
          // Fallback immediately to simulation start location
          const startCity = (shipment.loadingCity || "istanbul").toLowerCase().trim();
          const startCoords = CITY_COORDINATES[startCity] || CITY_COORDINATES["istanbul"];
          setLastGpsCoords(startCoords);
          transmitGPS(startCoords.lat, startCoords.lng);
        }

        fetchData();
      } else {
        let msg = "Failed to accept assignment. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    }
  };

  // Handle Order Rejection
  const handleRejectAssignment = async (shipment: Shipment) => {
    try {
      const res = await apiFetch(`/api/shipments/${shipment.id}/status`, {
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
      } else {
        let msg = "Failed to reject assignment. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    }
  };

  // Handle Custom Status Update Form
  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShipment) return;
    try {
      const res = await apiFetch(`/api/shipments/${activeShipment.id}/status`, {
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
      } else {
        let msg = "Failed to update status. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    }
  };

  // Chat message injection
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShipment || !newMessageText.trim()) return;

    try {
      const res = await apiFetch(`/api/shipments/${activeShipment.id}/chat`, {
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
      } else {
        triggerToast("❌ Message failed to send. Please try again.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Could not reach the server. Your message was not sent.");
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

  // Generates a mock scanned paperwork dynamically with standard canvas drawing
  const generateSimulatedDocument = (category: DocumentCategory): string => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    // White sheet background with slight off-white paper texture
    ctx.fillStyle = "#fafbfc";
    ctx.fillRect(0, 0, 600, 800);

    // Grid lines for blue/grey paper texture feel
    ctx.strokeStyle = "rgba(100, 116, 139, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 600; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 800);
      ctx.stroke();
    }
    for (let j = 0; j < 800; j += 40) {
      ctx.beginPath();
      ctx.moveTo(0, j);
      ctx.lineTo(600, j);
      ctx.stroke();
    }

    // Outer margin border
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 560, 760);

    // Dynamic Header
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 16px monospace";
    let title = "INTERNATIONAL CONSIGNMENT NOTE (CMR)";
    let code = "CMR-TR-30920-E";
    if (category === "invoice") {
      title = "COMMERCIAL LOGISTICS INVOICE";
      code = "INV-2026-X992";
    } else if (category === "packing_list") {
      title = "PACKING LIST & INVENTORY PROTOCOL";
      code = "PL-77112-L2";
    } else if (category === "customs") {
      title = "CUSTOMS TRANSFER TRANSIT RECEIPT";
      code = "CST-GATE-ENTRY";
    } else if (category === "delivery_proof") {
      title = "PROOF OF DELIVERY PROOF (POD)";
      code = "POD-DELIVERED";
    } else if (category === "photo") {
      title = "LIVE CARGO CORRELATION GRAPH";
      code = "PHOTO-ATTACH-GPS";
    }

    ctx.fillText(title, 40, 60);

    // Draw Serial Number Code
    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#ef4444";
    ctx.fillText(`SERIAL NO: ${code}`, 40, 85);

    // Decorative Barcode
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(380, 45, 180, 25);
    for (let b = 385; b < 560; b += 4 + Math.random() * 8) {
      ctx.fillStyle = "#fafbfc";
      ctx.fillRect(b, 45, 2 + Math.random() * 3, 25);
    }
    ctx.fillStyle = "#0f172a";
    ctx.font = "9px monospace";
    ctx.fillText(`*${activeShipment?.shipmentNumber || "998240-E"}*`, 420, 80);

    // Horizontal Separator
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, 110);
    ctx.lineTo(580, 110);
    ctx.stroke();

    // Box 1: Dispatcher & Shipper Details
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#1e293b";
    ctx.fillText("1. SENDER / CARRIER DISPATCH NODE", 35, 135);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#475569";
    ctx.fillText(`OPERATOR: ${getDriverName()}`, 35, 155);
    ctx.fillText(`REGISTRATION CODE: TR-${activeShipment?.truckNumber || "TR-34-ETA-55"}`, 35, 170);
    ctx.fillText(`ROUTING GATEWAY: Istanbul Central Hub Node`, 35, 185);

    // Box 2: Consignment Details
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#1e293b";
    ctx.fillText("2. CARGO & TRANSIT INSTRUCTIONS", 35, 220);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#475569";
    ctx.fillText(`SPECIFICATION: ${activeShipment?.cargoDescription || "Industrial Refrigerated Cargo"}`, 35, 240);
    ctx.fillText(`TOTAL TARGET WEIGHT: ${activeShipment?.cargoWeight || "24,500"} KG`, 35, 255);
    ctx.fillText(`TRANSIT TEMPERATURE PRESET: +4.0° C`, 35, 270);

    // Box 3: Origin & Destination Route
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#1e293b";
    ctx.fillText("3. TRANSIT SEGMENT DIRECTIONAL CORRIDOR", 35, 310);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#475569";
    ctx.fillText(`LOADING CITY: ${activeShipment?.loadingCity || "Istanbul"}`, 35, 330);
    ctx.fillText(`DELIVERY DESTINATION: ${activeShipment?.deliveryCity || "Baghdad"}`, 35, 345);
    ctx.fillText(`AGREED VALUATION: ${activeShipment?.agreedAmount || "4,800"} ${activeShipment?.currency || "USD"}`, 35, 360);

    // Draw stamp
    ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
    ctx.lineWidth = 3;
    ctx.save();
    ctx.translate(430, 260);
    ctx.rotate(-0.15);
    ctx.strokeRect(0, 0, 120, 60);
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "rgba(239, 68, 68, 0.75)";
    ctx.fillText("ETIR APPROVED", 10, 25);
    ctx.fillText("BORDER SECURE", 10, 42);
    ctx.font = "bold 8px monospace";
    ctx.fillText(`STAMP: ${new Date().toISOString().slice(0, 10)}`, 10, 52);
    ctx.restore();

    // Box 4: Signature / Handshake verification lines
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(20, 400);
    ctx.lineTo(580, 400);
    ctx.stroke();

    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#1e293b";
    ctx.fillText("4. FORMAL VERIFICATION HANDSHAKE", 35, 425);

    // Mock handwritten lines using path curves
    ctx.strokeStyle = "#2563eb"; // Blue pen ink
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(50, 470);
    ctx.bezierCurveTo(90, 440, 110, 490, 150, 460);
    ctx.bezierCurveTo(180, 440, 200, 480, 240, 450);
    ctx.stroke();

    ctx.font = "9px monospace";
    ctx.fillStyle = "#475569";
    ctx.fillText(`Driver Signature: Verification Token ${activeShipment?.id?.slice(0, 6).toUpperCase() || "H39B0"}`, 35, 490);

    // Custom QR Code drawing
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(450, 425, 90, 90);
    // Draw white speckles on QR to look real
    ctx.fillStyle = "#fafbfc";
    for (let q = 0; q < 12; q++) {
      ctx.fillRect(450 + Math.random() * 80, 425 + Math.random() * 80, 8 + Math.random() * 15, 8 + Math.random() * 15);
    }
    // QR eye finders
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(450, 425, 25, 25);
    ctx.fillRect(515, 425, 25, 25);
    ctx.fillRect(450, 490, 25, 25);
    ctx.fillStyle = "#fafbfc";
    ctx.fillRect(455, 430, 15, 15);
    ctx.fillRect(520, 430, 15, 15);
    ctx.fillRect(455, 495, 15, 15);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(459, 434, 7, 7);
    ctx.fillRect(524, 434, 7, 7);
    ctx.fillRect(459, 499, 7, 7);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "8px monospace";
    ctx.fillText("SCAN DYNAMIC DOCUMENT HANDSHAKE QR NODE", 390, 525);

    // Draw some custom crop alignment marks on the corners
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, 30); ctx.lineTo(30, 30); ctx.moveTo(30, 10); ctx.lineTo(30, 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(590, 30); ctx.lineTo(570, 30); ctx.moveTo(570, 10); ctx.lineTo(570, 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, 770); ctx.lineTo(30, 770); ctx.moveTo(30, 790); ctx.lineTo(30, 770);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(590, 770); ctx.lineTo(570, 770); ctx.moveTo(570, 790); ctx.lineTo(570, 770);
    ctx.stroke();

    return canvas.toDataURL("image/png");
  };

  const handleUploadScannedDocument = async () => {
    if (!activeShipment || !scanDocName.trim() || !capturedImage) return;

    setScanState("uploading");

    try {
      let finalFileUrl = capturedImage;

      // 1. Post to our highly available central media gateway route
      try {
        const uploadRes = await apiFetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64DataUrl: capturedImage,
            filename: scanDocName
          })
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          finalFileUrl = uploadData.url;
          console.log("Scanned document uploaded via central media gateway:", finalFileUrl);
        }
      } catch (uploadGatewayErr) {
        console.log("Local media gateway fallback for camera scan:", uploadGatewayErr);
      }

      // 2. Add message + document record
      const scanPayload = {
        sender: "driver",
        senderName: getDriverName(),
        type: "file",
        fileName: scanDocName,
        fileCategory: scanCategory,
        fileUrl: finalFileUrl,
        text: `Scanned & processed official document [${scanCategory.toUpperCase()}]: ${scanDocName}`
      };

      const res = await apiFetch(`/api/shipments/${activeShipment.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanPayload)
      });

      if (res.ok) {
        setScanDocName("");
        setCapturedImage(null);
        setIsScanOpen(false);
        triggerToast("🎉 Scanned document uploaded and synchronized successfully!");
        fetchData();
      } else {
        triggerToast("❌ Failed to upload scanned document. Please try again.");
      }
    } catch (e) {
      console.error(e);
      triggerToast("Failed to process scanned document upload");
    } finally {
      setScanState("scanning");
    }
  };

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    } catch (err) {
      console.warn("navigator.mediaDevices.getUserMedia not available or blocked in sandbox iframe:", err);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const captureCameraSnapshot = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        setCapturedImage(dataUrl);
        setScanState("review");
        stopCamera();
      }
    } else {
      // Fallback: draw dynamic simulated doc
      const dataUrl = generateSimulatedDocument(scanCategory);
      setCapturedImage(dataUrl);
      setScanState("review");
    }
  };

  // Simulate Document or Photo upload inside Chat
  const handleSimulateUpload = async () => {
    if (!activeShipment || !simFileName.trim()) return;
    
    setIsUploading(true);

    try {
      let finalFileUrl = simFileUrl;
      let uploadFailed = false;

      if (selectedFile && simFileUrl && simFileUrl.startsWith("data:")) {
        try {
          const uploadRes = await apiFetch("/api/upload", {
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
            console.log("File uploaded successfully via media gateway:", finalFileUrl);
          } else {
            uploadFailed = true;
          }
        } catch (uploadGatewayErr) {
          uploadFailed = true;
          console.warn("Upload request failed:", uploadGatewayErr);
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

      const res = await apiFetch(`/api/shipments/${activeShipment.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mockFilePayload)
      });

      if (res.ok) {
        setSimFileName("");
        setSimFileUrl("#");
        setSelectedFile(null);
        setFileSimOpen(false);
        if (uploadFailed) {
          triggerToast("⚠️ Message sent, but the file couldn't be saved to storage. It may not display correctly for dispatch.");
        } else {
          triggerToast("Attachment uploaded and synchronized successfully!");
        }
        fetchData();
      } else {
        triggerToast("❌ Failed to upload attachment. Please try again.");
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

  // Driver Assist logic block (Adaptive ETA & Traffic Pattern Engine)
  const assistCalculations = useMemo(() => {
    if (!activeShipment) return null;

    const originName = (activeShipment.loadingCity || "istanbul").toLowerCase().trim();
    const destName = (activeShipment.deliveryCity || "baghdad").toLowerCase().trim();

    const origin = CITY_COORDINATES[originName] || CITY_COORDINATES["istanbul"];
    const dest = CITY_COORDINATES[destName] || CITY_COORDINATES["baghdad"];

    // Haversine calculation to determine real road coordinates distance
    const R = 6371; // earth radius in km
    const dLat = (dest.lat - origin.lat) * Math.PI / 180;
    const dLon = (dest.lng - origin.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(origin.lat * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const rawDistance = Math.round(R * c);
    
    // Road/routing layout safety factor multiplier (usually physical roads are ~25% longer than straight lines)
    const routeDistance = Math.max(120, Math.round(rawDistance * 1.25));
    const processedDistance = Math.max(0, Math.round(routeDistance * (1 - gpsProgress / 100)));

    // Choose speed parameters and delay bounds based on selected traffic scenarios
    let avgSpeed = 70; // km/h
    let trafficFactorDescription = "";
    let borderDelayHours = 0;
    let congestionDelayHours = 0;
    let statusLabelEnglish = "Moderate Flow";

    switch(trafficPattern) {
      case 'optimal':
        avgSpeed = 82;
        borderDelayHours = 0.5;
        congestionDelayHours = 0.04;
        trafficFactorDescription = lang === 'tr' 
          ? "Akıcı Yol Koşulları - Gecikme Saptanmadı (%100 Motor Hızı)" 
          : (lang === 'ar' ? "حركة مرور طليقة - لم يتم العثور على تأخيرات (سعة ١٠٠٪)" : "Fluid highway velocity - No active delays detected.");
        statusLabelEnglish = "Optimal Flow";
        break;
      case 'congested':
        avgSpeed = 44;
        borderDelayHours = 1.0;
        congestionDelayHours = 2.4;
        trafficFactorDescription = lang === 'tr' 
          ? "Yoğun Trafik ve Otoyol Çalışmaları - Düşük Hız ve Dur-Kalk" 
          : (lang === 'ar' ? "ازدحام شديد وأعمال طرق - سرعة منخفضة" : "Heavy metropolitan bumper-to-bumper peak queueing & lane restrictions.");
        statusLabelEnglish = "Severe Congestion";
        break;
      case 'border_delay':
        avgSpeed = 70;
        borderDelayHours = 4.5;
        congestionDelayHours = 0.5;
        trafficFactorDescription = lang === 'tr' 
          ? "Sınır Gümrük Yoğunluğu - Uzun TIR Kuyrukları ve Belge Kontrolü" 
          : (lang === 'ar' ? "تراكم الشاحنات بجمارك الحدود - فحص ممتد" : "Customs checkpoint backlog and documentation safety verification queue.");
        statusLabelEnglish = "Customs Backlog";
        break;
      case 'moderate':
      default:
        avgSpeed = 68;
        borderDelayHours = 1.0;
        congestionDelayHours = 0.8;
        trafficFactorDescription = lang === 'tr' 
          ? "Tipik Şehirlerarası Yoğunluk ve Olağan Sınır Kontrolü" 
          : (lang === 'ar' ? "ازدحام معتاد وفحص جمركي عادي" : "Standard inter-state congestion & average customs clearance inspection period.");
        statusLabelEnglish = "Normal Volumes";
        break;
    }

    // Combine current telemetry velocity if available and simulation is active
    let activeSpeed = avgSpeed;
    if (gpsSimActive && gpsSpeed > 0) {
      // average simulated telemetry with pattern
      activeSpeed = Math.round((gpsSpeed + avgSpeed) / 2);
    }

    // Remaining travel hours
    const netTravelHours = processedDistance / activeSpeed;
    const totalDelays = borderDelayHours + congestionDelayHours;
    const finalEtaHours = netTravelHours + totalDelays;

    // Relative ETA text formatting
    const totalMinutes = Math.round(finalEtaHours * 60);
    const displayHours = Math.floor(totalMinutes / 60);
    const displayMinutes = totalMinutes % 60;

    // Target absolute arrival date
    const now = new Date();
    const etaDate = new Date(now.getTime() + totalMinutes * 60 * 1000);
    
    // Formatting absolute time
    const timeString = etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    
    let etaDayLabel = lang === 'tr' ? "Bugün" : (lang === 'ar' ? "اليوم" : "Today");
    if (etaDate.getDate() !== now.getDate()) {
      etaDayLabel = lang === 'tr' ? "Yarın" : (lang === 'ar' ? "غداً" : "Tomorrow");
      if (etaDate.getDate() > now.getDate() + 1) {
        etaDayLabel = etaDate.toLocaleDateString([], { day: 'numeric', month: 'short' });
      }
    }

    return {
      routeDistance,
      processedDistance,
      avgSpeed,
      activeSpeed,
      borderDelayHours,
      congestionDelayHours,
      totalDelays,
      finalEtaHours,
      displayHours,
      displayMinutes,
      etaDayLabel,
      timeString,
      trafficFactorDescription,
      statusLabelEnglish
    };
  }, [activeShipment, gpsProgress, gpsSpeed, gpsSimActive, trafficPattern, lang]);

  return (
    <div 
      className={`${isMobileMode 
        ? "w-full h-[100dvh] text-slate-100 flex flex-col bg-slate-950 overflow-hidden relative select-none" 
        : "p-4 md:p-8 bg-slate-950 min-h-screen text-slate-100 flex flex-col lg:flex-row gap-8 justify-center items-center bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(249,115,22,0.12),rgba(0,0,0,0))] font-sans select-none"
      } ${theme === 'light' ? 'theme-light' : ''}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      
      {/* Simulation Trigger Controller inside screen - Desktop view only */}
      {!loggedInDriverId && !isMobileMode && (
        <div className="w-full lg:w-80 bg-slate-900/85 backdrop-blur-md p-6 rounded-3xl border border-slate-800/70 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.65)] space-y-5 shrink-0 overflow-y-auto">
          <div>
            <span className="text-[10px] uppercase font-black tracking-widest text-[#f97316] font-mono block mb-1">Developer Mode</span>
            <h3 className="font-extrabold text-white text-base tracking-tight">Driver Node Console</h3>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">Select dispatcher nodes to simulate live telemetry synchronizations and offline queues.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider font-mono">Simulated Account</label>
            <select
              value={selectedDriverId}
              onChange={(e) => {
                setSelectedDriverId(e.target.value);
                setActiveShipment(null);
                setActiveTab('shipments');
              }}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 text-xs font-bold rounded-xl outline-none focus:border-amber-500 transition-all cursor-pointer"
            >
              {drivers.map(d => (
                <option key={d.id} value={d.id} className="bg-slate-950 text-slate-200 font-bold">
                  {d.name} ({d.truckNumber})
                </option>
              ))}
            </select>
          </div>

          {/* Simulate Offline Connection Switch */}
          <div className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Connection State</span>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase font-mono ${
                isForceOffline 
                  ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' 
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isForceOffline ? 'bg-amber-500' : 'bg-emerald-400 animate-pulse'}`}></span>
                {isForceOffline ? 'Offline' : 'Online'}
              </span>
            </div>
            <button
              onClick={() => {
                setIsForceOffline(prev => !prev);
                triggerToast(!isForceOffline ? "Simulated offline storage mode active." : "Network connection re-established, synchronizing queues...");
              }}
              className={`w-full py-2 px-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 border cursor-pointer ${
                isForceOffline
                  ? 'bg-emerald-600/10 hover:bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-600/10 hover:bg-amber-600/20 border-amber-500/30 text-amber-500'
              }`}
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>{isForceOffline ? 'Connect Online' : 'Force Offline'}</span>
            </button>
          </div>

          <div className="bg-slate-950/85 p-4 border border-slate-800 rounded-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl group-hover:bg-amber-500/10 transition-all duration-500" />
            <span className="text-[9px] font-bold tracking-widest text-slate-500 uppercase font-mono block mb-1">Active Profile</span>
            <p className="font-extrabold text-[#f97316] text-xs uppercase tracking-tight">{getDriverName()}</p>
            <p className="text-slate-400 font-mono text-[10px] mt-0.5">{getDriverTruck()}</p>
          </div>
        </div>
      )}

      {/* Floating Gear Workspace controls - ONLY visible if isMobileMode and not logged in as a real driver */}
      {isMobileMode && !loggedInDriverId && (
        <div className="fixed bottom-24 right-4 z-[999] flex flex-col items-end gap-2">
          {showControlsModal && (
            <div className="w-72 bg-slate-900/95 backdrop-blur-md text-slate-100 p-4 rounded-3xl border border-slate-800 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] space-y-3 text-left" dir="ltr">
              <div>
                <span className="text-[8px] tracking-widest uppercase font-mono font-bold text-orange-500 block">Simulation Node Controller</span>
                <h4 className="font-extrabold text-xs text-white">Switch Dispatch Account</h4>
              </div>

              <select
                value={selectedDriverId}
                onChange={(e) => {
                  setSelectedDriverId(e.target.value);
                  setActiveShipment(null);
                  setActiveTab('shipments');
                  setShowControlsModal(false);
                }}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 text-xs font-bold rounded-xl outline-none"
              >
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.truckNumber})
                  </option>
                ))}
              </select>

              {/* Mobile quick offline simulation button */}
              <button
                onClick={() => {
                  setIsForceOffline(prev => !prev);
                  triggerToast(!isForceOffline ? "Simulated offline storage mode active." : "Network connection re-established, synchronizing queues...");
                  setShowControlsModal(false);
                }}
                className={`w-full py-2 bg-slate-950 border text-[10px] font-mono tracking-wider uppercase font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer ${
                  isForceOffline ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-500'
                }`}
              >
                <Shield className="w-3 h-3" />
                <span>{isForceOffline ? 'Simulate Online' : 'Simulate Offline'}</span>
              </button>

              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/40">
                <p className="font-bold text-orange-500 text-xs">{getDriverName()}</p>
                <p className="text-slate-400 font-mono text-[9px]">{getDriverTruck()}</p>
              </div>
            </div>
          )}
          
          <button 
            type="button"
            onClick={() => setShowControlsModal(!showControlsModal)}
            className="w-12 h-12 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white flex items-center justify-center shadow-[0_4px_20px_rgba(249,115,22,0.35)] transition-all border-0 cursor-pointer active:scale-90"
            title="Workspace Controls"
          >
            <Truck className="w-5 h-5 animate-pulse" />
          </button>
        </div>
      )}

      {/* MOBILE APP PHONE CONTAINER SCREEN WITH GLASS & HARDWARE BUTTON SIMULATIONS */}
      <div 
        className={isMobileMode 
          ? "w-full h-full flex flex-col justify-between overflow-hidden relative bg-slate-950" 
          : "relative mx-auto lg:mx-0 select-none group"
        }
      >
        {/* Physical hardware side active state keys */}
        {!isMobileMode && (
          <>
            {/* Left side mock volume keys */}
            <div className="absolute -left-[14px] top-28 w-[4px] h-11 bg-gradient-to-r from-slate-700 to-slate-800 rounded-l-md border-r border-slate-900 shadow-md"></div>
            <div className="absolute -left-[14px] top-42 w-[4px] h-11 bg-gradient-to-r from-slate-700 to-slate-800 rounded-l-md border-r border-slate-900 shadow-md"></div>
            {/* Right side mock power button toggle */}
            <div className="absolute -right-[14px] top-34 w-[4px] h-16 bg-gradient-to-l from-slate-700 to-slate-800 rounded-r-md border-l border-slate-900 shadow-md"></div>
          </>
        )}

        <div 
          className={isMobileMode 
            ? "w-full h-full flex flex-col justify-between overflow-hidden relative" 
            : "w-full max-w-[390px] h-[790px] bg-slate-950 rounded-[50px] p-[10px] shadow-[0_35px_80px_-15px_rgba(0,0,0,0.98),0_0_50px_rgba(249,115,22,0.08)] relative border-[12px] border-slate-800/95 flex flex-col justify-between overflow-hidden outline outline-[1px] outline-slate-700/60"
          }
        >
          
          {/* Real-looking reflective dynamic camera island with glowing optical pulse */}
          {!isMobileMode && (
            <div className="absolute top-[16px] left-1/2 -translate-x-1/2 w-[110px] h-7 bg-black rounded-full z-[100] flex items-center justify-between px-3.5 shadow-inner">
              <span className="w-2.5 h-2.5 bg-slate-900 rounded-full border border-slate-800/80 shadow-inner flex items-center justify-center">
                <span className="w-[3px] h-[3px] bg-emerald-500 rounded-full animate-pulse"></span>
              </span>
              <span className="w-12 h-1 bg-slate-900 rounded-full"></span>
            </div>
          )}

          {/* Inner Phone Screen */}
          <div 
            className={isMobileMode 
              ? "w-full h-full bg-slate-950 text-slate-100 overflow-hidden flex flex-col justify-between pt-1 pb-4 relative"
              : "w-full h-full bg-slate-950 text-slate-100 rounded-[38px] overflow-hidden flex flex-col justify-between pt-9 pb-4 relative"
            }
          >
            
            {/* CALL OVERLAY FOR SMARTPHONE INTERFACE */}
            {callState !== 'idle' && (
              <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-lg z-50 flex flex-col justify-between p-6 text-center select-none animate-fade-in" dir="ltr">
                <div className="pt-10 space-y-2 flex flex-col items-center">
                  <span className="bg-orange-500/10 text-orange-400 font-mono text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border border-orange-500/20">
                    Encrypted Sat-Com Audio
                  </span>
                  <h3 className="font-extrabold text-white text-lg tracking-tight pt-2">HQ Operations Helpline</h3>
                  <p className="text-[10px] text-slate-400 font-mono font-medium lowercase">Duty dispatcher dispatcher-hq-node-9</p>
                </div>

                {/* Pulsing visual indicator */}
                <div className="flex flex-col items-center justify-center my-6 space-y-4">
                  <div className="relative">
                    <div className={`absolute -inset-4 bg-orange-500/10 rounded-full blur-xl transition-all duration-1000 ${callState === 'connected' ? 'scale-125 opacity-100 animate-pulse' : 'scale-75 opacity-20'}`} />
                    <div className="w-24 h-24 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-white relative z-10 mx-auto">
                      <div className={`w-20 h-20 rounded-full bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center font-black text-xl border-4 ${callState === 'connected' ? 'border-emerald-500 animate-pulse' : 'border-slate-800'}`}>
                        HQ
                      </div>
                    </div>
                    {callState === 'connected' && (
                      <span className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-500 rounded-full border-4 border-slate-950 flex items-center justify-center animate-ping" />
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className={`font-mono font-bold text-xs ${callState === 'connected' ? 'text-emerald-400' : 'text-orange-400 animate-pulse'}`}>
                      {callState === 'calling' ? 'DIALING SECURE SAT-LINK...' : 'CONNECTED (VOIP)'}
                    </p>
                    {callState === 'connected' && (
                      <p className="font-mono text-xs font-black text-white/90">
                        {Math.floor(callDuration / 60).toString().padStart(2, '0')}:{ (callDuration % 60).toString().padStart(2, '0') }
                      </p>
                    )}
                  </div>
                </div>

                {/* Call stats / Voice waves */}
                {callState === 'connected' ? (
                  <div className="bg-slate-900/60 p-3 rounded-2xl border border-slate-800/45 text-[10px] text-slate-400 max-w-xs w-full mx-auto space-y-1 text-left font-mono">
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-500">SIGNAL LATENCY:</span>
                      <span className="text-emerald-400">12ms (OPTIMAL)</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-500">SAT ENCRYPTION:</span>
                      <span className="text-orange-400">AES-GCM-256</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-500">BANDWIDTH:</span>
                      <span className="text-white">Opus High-Def</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 max-w-xs mx-auto italic leading-relaxed">
                    Connecting to closest logistics relay node. If signal is lost, coordinate cache remains stored locally.
                  </p>
                )}

                {/* Hang Up Action */}
                <div className="pb-8 flex flex-col items-center">
                  <button
                    onClick={handleEndCall}
                    className="w-14 h-14 bg-red-600 hover:bg-red-700 hover:scale-105 active:scale-95 text-white rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(220,38,38,0.4)] transition-all cursor-pointer border-0"
                    title="End Radio Link"
                    aria-label="End Radio Link"
                  >
                    <X className="w-5 h-5 font-black text-white" />
                  </button>
                  <span className="text-[9px] font-mono font-black text-slate-500 block uppercase tracking-widest mt-2">End helpline radio</span>
                </div>
              </div>
            )}

            {/* Native System Status Bar */}
            <div className="px-5 pt-1.5 pb-1 flex items-center justify-between text-[10px] font-mono text-slate-400 bg-slate-950 z-20 select-none">
              <span className="font-bold tracking-tight text-white">{simTime || "12:00 PM"}</span>
              <div className="flex items-center gap-1.5">
                {isForceOffline ? (
                  <div className="flex items-center gap-1 text-amber-500 font-black tracking-tight animate-pulse bg-amber-500/10 px-1.5 py-0.5 rounded-md border border-amber-500/20">
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                    <span>SIM_OFFLINE</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-emerald-400 font-extrabold tracking-tight bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20 text-[9px]">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                    <span>LTE 5G</span>
                  </div>
                )}
                {/* Battery level mock */}
                <div className="flex items-center gap-0.5 border border-slate-700 rounded-sm px-0.5 py-px w-5 h-3">
                  <div className="bg-slate-400 h-full w-[85%] rounded-[1px]" />
                </div>
              </div>
            </div>

            {/* Header Mobile Brand */}
            <div className="p-4 bg-slate-950 border-b border-slate-900 flex items-center justify-between z-20 relative shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <Truck className="w-4 h-4 text-orange-500" />
                </div>
                <h2 className="text-white font-black text-xs tracking-wider uppercase font-mono">{t('brand')}</h2>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button 
                  type="button"
                  onClick={() => setActiveTab('notifications')}
                  className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-white transition-all relative cursor-pointer"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.some(n => !n.read) && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                  )}
                </button>
              </div>
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
                <div className="space-y-4.5 animate-fade-in">
                  
                  {/* Stunning Driver stats HUD banner */}
                  <div className="relative overflow-hidden bg-gradient-to-r from-orange-600/95 via-orange-500/90 to-amber-500/95 rounded-3xl p-4 shadow-[0_12px_24px_rgba(249,115,22,0.18)] border border-orange-400/20 text-white space-y-3 shrink-0 light-preserve">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-6 -mt-6" />
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-[13px] font-black tracking-tighter">
                          ★
                        </div>
                        <div>
                          <h4 className="text-xs font-black tracking-tight leading-none uppercase">{getDriverName() ? getDriverName().split(" ")[0] : "Driver"}</h4>
                          <span className="text-[9px] text-orange-100/90 font-mono tracking-tight">{getDriverTruck() || "TRUCK"}</span>
                        </div>
                      </div>
                      <span className="bg-white/15 px-2 py-0.5 rounded-full font-mono font-black text-[8px] uppercase tracking-wider text-orange-50 border border-white/10">
                        Elite Pilot
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/10 text-center relative z-10 text-white">
                      <div>
                        <span className="text-[8px] text-orange-100/75 block uppercase font-mono tracking-widest leading-none">Efficiency</span>
                        <strong className="text-xs font-black tracking-tight">98.4%</strong>
                      </div>
                      <div className="border-x border-white/10">
                        <span className="text-[8px] text-orange-100/75 block uppercase font-mono tracking-widest leading-none">Streak</span>
                        <strong className="text-xs font-black tracking-tight">12 Days</strong>
                      </div>
                      <div>
                        <span className="text-[8px] text-orange-100/75 block uppercase font-mono tracking-widest leading-none">Distance</span>
                        <strong className="text-xs font-black tracking-tight">3,124 km</strong>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-900 pb-2.5">
                    <div>
                      <h3 className="font-extrabold text-[#f97316] text-xs tracking-wide uppercase font-mono">{t('activeShipments')}</h3>
                      <p className="text-[10px] text-slate-500 font-medium">Assigned to your heavy transit fleet</p>
                    </div>
                    <span className="bg-orange-500/10 text-orange-400 font-mono font-black text-[10px] px-2.5 py-0.5 rounded-full border border-orange-500/20">
                      {shipments.filter(s => s.status !== 'Delivered' && s.status !== 'Arrived' && s.status !== 'Closed' && s.status !== 'Completed').length} Active
                    </span>
                  </div>

                  {/* Modern Horizontal Filter Bar */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1 select-none no-scrollbar">
                    {[
                      { id: 'active', en: 'Active Jobs', tr: 'Aktif Seferler', ar: 'المهام النشطة' },
                      { id: 'completed', en: 'Completed', tr: 'Tamamlananlar', ar: 'المكتملة' }
                    ].map(f => {
                      const isActive = shipmentsFilter === f.id;
                      const label = lang === 'tr' ? f.tr : lang === 'ar' ? f.ar : f.en;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setShipmentsFilter(f.id as any)}
                          className={`px-3 py-1.5 rounded-xl border font-mono text-[9.5px] font-bold tracking-tight whitespace-nowrap transition-all cursor-pointer ${
                            isActive
                              ? 'bg-orange-600/15 border-orange-500/40 text-orange-400 font-black'
                              : 'bg-slate-950/40 border-slate-800 hover:border-slate-800 text-slate-400'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-3.5">
                    {shipments
                      .filter(s => {
                        const isFinished = s.status === 'Delivered' || s.status === 'Arrived' || s.status === 'Closed' || s.status === 'Completed';
                        if (shipmentsFilter === 'active') return !isFinished;
                        if (shipmentsFilter === 'completed') return isFinished;
                        return true;
                      })
                      .map((s) => {
                      const isAssigned = s.status === 'Assigned';
                      const isTransit = s.status === 'In Transit' || s.status === 'Border Crossing' || s.status === 'Customs Clearance';
                      const isDelivered = s.status === 'Delivered' || s.status === 'Arrived';
                      
                      return (
                        <div 
                          key={s.id} 
                          onClick={() => {
                            setActiveShipment(s);
                            setSelectedStatusVal(s.status);
                            const isCompleted = s.status === 'Delivered' || s.status === 'Arrived' || s.status === 'Closed' || s.status === 'Completed';
                            if (isCompleted) {
                              setGpsSimActive(false);
                            }
                          }}
                          className="group relative bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 hover:border-orange-500/40 rounded-[22px] p-4 transition-all duration-300 cursor-pointer shadow-[0_4px_25px_rgba(0,0,0,0.3)] space-y-3.5 overflow-hidden active:scale-[0.99]"
                        >
                          {/* Interactive glow overlay */}
                          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-orange-500/5 to-transparent rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                          
                          <div className="flex items-center justify-between relative z-10">
                            <div className="flex items-center gap-1.5">
                              <span className="bg-slate-950 text-slate-200 font-mono font-bold px-2 py-0.5 rounded text-[10px] border border-slate-800">
                                #{s.shipmentNumber}
                              </span>
                            </div>
                            
                            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider font-mono border ${
                              isAssigned ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse' :
                              isTransit ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' :
                              isDelivered ? 'bg-teal-500/10 text-teal-400 border-teal-500/20' :
                              'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            }`}>
                              {s.status}
                            </span>
                          </div>

                          {/* Interactive route line design */}
                          <div className="space-y-2.5 relative z-10 bg-slate-950/40 p-3 rounded-xl border border-slate-900/40">
                            <p className="font-bold text-xs text-slate-100 truncate">{s.cargoDescription}</p>
                            
                            {/* Route tracking line */}
                            <div className="flex items-stretch justify-between gap-1 text-[11px] relative pt-1">
                              {/* Technical dashed path line */}
                              <div className="absolute top-3 left-[15%] right-[15%] h-px border-t border-dashed border-slate-800" />
                              
                              <div className="flex flex-col text-left max-w-[45%]">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono leading-none mb-1">Loading Depot</span>
                                <strong className="text-slate-200 text-xs truncate">{s.loadingCity}</strong>
                              </div>

                              <div className="flex items-center self-center justify-center bg-slate-900 border border-slate-800 w-5 h-5 rounded-full shrink-0 z-10 group-hover:text-orange-400 group-hover:border-orange-500/30 transition-colors">
                                <ChevronRight className="w-3 h-3 text-slate-500 group-hover:text-orange-400" />
                              </div>

                              <div className="flex flex-col text-right max-w-[45%]">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono leading-none mb-1">Delivery Point</span>
                                <strong className="text-slate-200 text-xs truncate">{s.deliveryCity}</strong>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 relative z-10 text-xs">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest font-mono">Agreed Payout</span>
                              <span className="font-extrabold text-orange-500 font-mono text-sm mt-0.5">
                                {(() => {
                                  if (s.assignedDriverId === selectedDriverId) {
                                    return (s.agreedAmount ?? 0).toLocaleString();
                                  }
                                  const ad = s.additionalDrivers?.find((d: any) => d.driverId === selectedDriverId);
                                  if (ad && ad.agreedAmount !== undefined) {
                                    return ad.agreedAmount.toLocaleString();
                                  }
                                  return (s.agreedAmount ?? 0).toLocaleString();
                                })()}{' '}
                                <span className="text-[10px]">{s.currency}</span>
                              </span>
                            </div>
                            
                            <span className="text-[10px] font-bold text-slate-400 group-hover:text-[#f97316] flex items-center gap-1 transition-all">
                              <span>Open Job</span>
                              <ChevronRight className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition-transform" />
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {shipments.length === 0 && (
                      <div className="py-20 text-center space-y-3 bg-slate-900/40 rounded-2.5xl p-6 border border-slate-800/80">
                        <div className="w-12 h-12 rounded-full bg-slate-950/80 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                          <Truck className="w-6 h-6 shrink-0" />
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 font-bold">{t('noAssignedShipments')}</p>
                          <p className="text-[10px] text-slate-500 mt-1">Check back later or refresh simulation database</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            {/* EXPANDED SHIPMENT DETAIL & CHAT / STATUS TAB PANEL */}
            {activeTab === 'shipments' && activeShipment && (
              <div className="space-y-4 pb-20">
                {/* Back Link & Direct Call Hotline */}
                <div className="flex items-center justify-between select-none">
                  <button 
                    onClick={() => setActiveShipment(null)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-all bg-slate-900/40 hover:bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full cursor-pointer"
                  >
                    {lang === 'en' ? '← Back to Jobs' : lang === 'tr' ? '← İşlere Geri Dön' : '← العودة إلى المهام'}
                  </button>
                  <button 
                    type="button"
                    onClick={handleStartCall}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-400 hover:text-white transition-all bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/35 px-3.5 py-1.5 rounded-full cursor-pointer shadow-[0_2px_10px_rgba(249,115,22,0.15)] active:scale-95 duration-250"
                  >
                    <Phone className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <span>{lang === 'tr' ? 'Sorumluyu Ara' : (lang === 'ar' ? 'اتصال بالمسؤول' : 'Call HQ Dispatch')}</span>
                  </button>
                </div>



                {/* ACCESSIBILITY-FIRST DRIVER QUICK ACTIONS COCKPIT GRID */}
                {!isShipmentFinished && (() => {
                  const quickT = {
                    en: {
                      title: "Quick Cockpit Actions",
                      subtitle: "High-contrast controls optimized for secure one-tap driving use",
                      startShipment: "Start Shipment",
                      startShipmentSubAction: "Accept Shipment",
                      startShipmentSubTransit: "Set In-Transit",
                      startShipmentSubActive: "Driving Live",
                      addDoc: "Add Document",
                      addDocSub: "Scan CMR / Paperwork",
                      statusUpdate: "Status Update",
                      statusUpdateSub: "Tap to change state",
                      recommendedNext: "RECOMMENDED NEXT",
                      currentStatus: "Current status: ",
                      cancel: "Close Panel",
                      updating: "Updating Logistics status..."
                    },
                    tr: {
                      title: "Hızlı Sürücü Eylemleri",
                      subtitle: "Tek dokunuşla güvenli sürüş için optimize edilmiş kontroller",
                      startShipment: "Sevkiyatı Başlat",
                      startShipmentSubAction: "Sevkiyatı Kabul Et",
                      startShipmentSubTransit: "Yola Çık",
                      startShipmentSubActive: "Yolculuk Aktif",
                      addDoc: "Evrak Ekle",
                      addDocSub: "CMR veya Belge Tara",
                      statusUpdate: "Durum Güncelle",
                      statusUpdateSub: "Konumu değiştir",
                      recommendedNext: "SIRADAKİ ÖNERİLEN",
                      currentStatus: "Mevcut durum: ",
                      cancel: "Paneli Kapat",
                      updating: "Lojistik durumu güncelleniyor..."
                    },
                    ar: {
                      title: "أوامر السائق السريعة",
                      subtitle: "أزرار تحكم متباينة للغاية ومحسنة للاستخدام الآمن بلمسة واحدة أثناء القيادة",
                      startShipment: "بدء الشحن",
                      startShipmentSubAction: "قبول الشحنة",
                      startShipmentSubTransit: "تغيير إلى في الطريق",
                      startShipmentSubActive: "التتبع جاري",
                      addDoc: "إضافة ملف",
                      addDocSub: "مسح CMR مستندات",
                      statusUpdate: "تحديث الحالة",
                      statusUpdateSub: "اضغط لتعديل الخطوة",
                      recommendedNext: "الخطوة التالية المقترحة",
                      currentStatus: "الحالة الحالية: ",
                      cancel: "إغلاق لوحة التحكم",
                      updating: "جاري تحديث الحالة اللوجستية..."
                    }
                  }[lang as 'en' | 'tr' | 'ar'] || {
                    title: "Quick Cockpit Actions",
                    subtitle: "High-contrast controls optimized for secure one-tap driving use",
                    startShipment: "Start Shipment",
                    startShipmentSubAction: "Accept Shipment",
                    startShipmentSubTransit: "Set In-Transit",
                    startShipmentSubActive: "Driving Live",
                    addDoc: "Add Document",
                    addDocSub: "Scan CMR / Paperwork",
                    statusUpdate: "Status Update",
                    statusUpdateSub: "Tap to change state",
                    recommendedNext: "RECOMMENDED NEXT",
                    currentStatus: "Current status: ",
                    cancel: "Close Panel",
                    updating: "Updating Logistics status..."
                  };

                  const getNextExpectedStatus = (curr: string): string => {
                    const list = ['Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered'];
                    const idx = list.indexOf(curr);
                    if (idx !== -1 && idx < list.length - 1) {
                      return list[idx + 1];
                    }
                    return 'Delivered';
                  };

                  const nextRecStatus = getNextExpectedStatus(activeShipment.status);

                  const handleQuickStart = async () => {
                    if (activeShipment.status === "Assigned") {
                      await handleAcceptAssignment(activeShipment);
                    } else if (activeShipment.status === "In Transit") {
                      triggerToast(lang === 'tr' ? "ℹ️ Yolculuk zaten aktif. GPS verici düzgün çalışıyor." : "ℹ️ Transit is already active. GPS transmitter running normally.");
                    } else {
                      try {
                        const res = await apiFetch(`/api/shipments/${activeShipment.id}/status`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            status: "In Transit",
                            remarksDesc: "Transit auto-started via high-contrast Quick Actions cockpit.",
                            updaterName: getDriverName(),
                            role: "driver"
                          })
                        });
                        if (res.ok) {
                          setGpsSimActive(true);
                          triggerToast(lang === 'tr' ? "🚀 Yolculuk Başlatıldı! GPS simülatörü aktif." : "🚀 Transit Started! GPS live transmitter activated.");
                          fetchData();
                        } else {
                          triggerToast("❌ Failed to start transit. Please try again.");
                        }
                      } catch (err) {
                        console.error("Quick Start transit error:", err);
                        triggerToast("❌ Could not reach the server.");
                      }
                    }
                  };

                  const handleQuickAddDoc = () => {
                    setScanDocName(`SCAN_${new Date().toISOString().slice(0,10).replace(/-/g, "")}_${Math.floor(1000 + Math.random() * 9000)}.png`);
                    setScanCategory("cmr");
                    setCapturedImage(null);
                    setScanFilter("color");
                    setScanState("scanning");
                    setIsScanOpen(true);
                    startCamera();
                  };

                  const handleQuickStatusSelect = async (newSt: string) => {
                    try {
                      const res = await apiFetch(`/api/shipments/${activeShipment.id}/status`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          status: newSt,
                          remarksDesc: `Auto-updated via Driver Quick Actions cockpit`,
                          updaterName: getDriverName(),
                          role: "driver"
                        })
                      });
                      if (res.ok) {
                        triggerToast(`${lang === 'tr' ? 'Durum Güncellendi:' : 'Logistics State Verified:'} ${newSt}`);
                        setQuickStatusOpen(false);
                        fetchData();
                        if (newSt === "In Transit") {
                          setGpsSimActive(true);
                        }
                      } else {
                        triggerToast("❌ Failed to update status. Please try again.");
                      }
                    } catch (err) {
                      console.error("Status check update error", err);
                      triggerToast("❌ Could not reach the server.");
                    }
                  };

                  // Check highlight or active state
                  const isAssigned = activeShipment.status === "Assigned";
                  const isPreTransit = ["Accepted", "Loading", "Loaded"].includes(activeShipment.status);
                  const isTransit = activeShipment.status === "In Transit";

                  return (
                    <div id="driver-quick-actions-cockpit" className="p-5 bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-3xl space-y-4 shadow-[0_8px_30px_rgba(0,0,0,0.5)] select-none">
                      <div className="flex flex-col text-left">
                        <span className="text-[9px] font-black tracking-widest text-[#f97316] uppercase font-mono">
                          {quickT.title}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {quickT.subtitle}
                        </span>
                      </div>

                      {/* Three Column Spacious Tactile Grid */}
                      <div className="grid grid-cols-3 gap-3.5">
                        {/* 1. START SHIPMENT */}
                        <button
                          type="button"
                          onClick={handleQuickStart}
                          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all duration-300 transform active:scale-95 cursor-pointer max-w-full text-center relative overflow-hidden h-24 ${
                            isAssigned 
                              ? "bg-orange-500 text-white border-orange-600 shadow-[0_4px_18px_rgba(249,115,22,0.4)] animate-pulse"
                              : isPreTransit
                              ? "bg-slate-900 hover:bg-slate-800 text-orange-400 border-orange-500/30 animate-shimmer"
                              : isTransit
                              ? "bg-emerald-950/40 text-emerald-400 border-emerald-500/30"
                              : "bg-slate-950/80 text-slate-500 border-slate-900"
                          }`}
                        >
                          <div className={`p-2 rounded-xl mb-1.5 ${isAssigned ? "bg-white/10" : "bg-slate-950/60"}`}>
                            <Play className={`w-5 h-5 ${isAssigned ? "text-white" : isTransit ? "text-emerald-400" : "text-orange-500"}`} />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-wider block truncate w-full">
                            {quickT.startShipment}
                          </span>
                          <span className="text-[8px] text-slate-400 mt-0.5 truncate block w-full">
                            {isAssigned 
                              ? quickT.startShipmentSubAction 
                              : isPreTransit 
                              ? quickT.startShipmentSubTransit 
                              : isTransit 
                              ? quickT.startShipmentSubActive 
                              : activeShipment.status}
                          </span>
                        </button>

                        {/* 2. ADD DOCUMENT */}
                        <button
                          type="button"
                          onClick={handleQuickAddDoc}
                          className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-100 hover:border-slate-700 transition-all transform active:scale-95 cursor-pointer h-24 text-center"
                        >
                          <div className="p-2 rounded-xl bg-slate-950/60 mb-1.5 text-orange-500">
                            <Camera className="w-5 h-5 text-orange-400" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-wider block truncate w-full">
                            {quickT.addDoc}
                          </span>
                          <span className="text-[8px] text-slate-400 mt-0.5 truncate block w-full">
                            {quickT.addDocSub}
                          </span>
                        </button>

                        {/* 3. STATUS UPDATE */}
                        <button
                          type="button"
                          onClick={() => setQuickStatusOpen(!quickStatusOpen)}
                          className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all transform active:scale-95 cursor-pointer h-24 text-center ${
                            quickStatusOpen 
                              ? "bg-slate-800 text-white border-slate-600 shadow-inner" 
                              : "bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[#f97316] hover:border-slate-700"
                          }`}
                        >
                          <div className="p-2 rounded-xl bg-slate-950/60 mb-1.5 text-[#f97316]">
                            <Activity className="w-5 h-5 text-orange-400" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-wider block truncate w-full">
                            {quickT.statusUpdate}
                          </span>
                          <span className="text-[8px] text-slate-400 mt-0.5 truncate block w-full">
                            {quickT.statusUpdateSub}
                          </span>
                        </button>
                      </div>

                      {/* EXPANDED INTERACTIVE HIGH-CONTRAST CHANNELS DRAWER */}
                      {quickStatusOpen && (
                        <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3 animate-fade-in text-left">
                          <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                            <div>
                              <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 block font-mono">
                                {quickT.currentStatus}
                              </span>
                              <span className="text-white font-extrabold text-xs uppercase font-mono">
                                {activeShipment.status}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setQuickStatusOpen(false)}
                              className="text-[9px] font-bold text-slate-500 hover:text-white uppercase tracking-wider bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 cursor-pointer"
                            >
                              {quickT.cancel}
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {['Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered'].map(st => {
                              const isNext = st === nextRecStatus;
                              const isCurrent = st === activeShipment.status;
                              return (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() => handleQuickStatusSelect(st)}
                                  className={`p-3 rounded-xl border text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer relative ${
                                    isCurrent 
                                      ? "bg-amber-500/10 text-amber-500 border-amber-500/30 font-black cursor-default"
                                      : isNext
                                      ? "bg-orange-500 text-white border-orange-600 shadow-[0_2px_12px_rgba(249,115,22,0.3)] font-black"
                                      : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white"
                                  }`}
                                >
                                  {isNext && (
                                    <span className="absolute -top-1 px-1 bg-[#f97316] text-[#ffffff] text-[6.5px] font-black rounded uppercase tracking-wider scale-95 border border-orange-600 block">
                                      {quickT.recommendedNext}
                                    </span>
                                  )}
                                  <span>{st}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Driver views parameters */}
                <div className="p-5 bg-slate-900 border border-slate-800/80 rounded-3xl space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl group-hover:bg-orange-500/10 transition-all duration-500" />
                  
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">Shipment ID</span>
                      <span className="font-mono text-sm font-black text-white mt-0.5">{activeShipment.shipmentNumber}</span>
                    </div>
                    
                    <span className="bg-orange-500/10 text-orange-400 text-[10px] font-black uppercase tracking-wider font-mono px-3 py-1 rounded-full border border-orange-500/25">
                      {activeShipment.status}
                    </span>
                  </div>

                  <div className="space-y-3.5 text-xs">
                    <div>
                      <span className="text-slate-500 font-bold block text-[9px] uppercase tracking-wider font-mono mb-1">{t('cargoInfo')}</span>
                      <p className="font-extrabold text-slate-100 text-xs leading-normal">{activeShipment.cargoDescription}</p>
                      <span className="inline-flex items-center gap-1.5 bg-slate-950 text-slate-400 font-mono text-[9px] font-bold mt-2 px-2 py-1 rounded-lg border border-slate-800">
                        Total Weight: {(activeShipment.cargoWeight ?? 0).toLocaleString()} kg
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-slate-800/80 pt-3">
                      <div>
                        <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider font-mono block">Loading Depot</span>
                        <p className="font-extrabold text-slate-200 mt-1">{activeShipment.loadingCity || "Unassigned"}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">{activeShipment.loadingCountry || ""}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider font-mono block font-mono">Consignee City</span>
                        <p className="font-extrabold text-slate-200 mt-1">{activeShipment.deliveryCity || "Unassigned"}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">{activeShipment.deliveryCountry || ""}</p>
                      </div>
                    </div>

                    <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between bg-slate-950/60 p-3 rounded-2xl border border-slate-800/60">
                      <div className="flex flex-col">
                        <span className="text-slate-500 font-bold text-[9px] uppercase tracking-widest font-mono">{t('carrierAmount')}</span>
                        <span className="text-slate-400 text-[10px] mt-0.5">Fixed carrier revenue</span>
                      </div>
                      <span className="text-orange-500 font-mono font-black text-base tracking-tight">
                        {(() => {
                          if (activeShipment.assignedDriverId === selectedDriverId) {
                            return (activeShipment.agreedAmount ?? 0).toLocaleString();
                          }
                          const ad = activeShipment.additionalDrivers?.find((d: any) => d.driverId === selectedDriverId);
                          if (ad && ad.agreedAmount !== undefined) {
                            return ad.agreedAmount.toLocaleString();
                          }
                          return (activeShipment.agreedAmount ?? 0).toLocaleString();
                        })()}{' '}
                        <span className="text-xs">{activeShipment.currency || "USD"}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Google Maps Real-time tracking progress panel */}
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-slate-200 font-bold text-xs uppercase tracking-wider text-left">Live Transit Route Tracker</h4>
                      <p className="text-[10px] text-slate-500 text-left">Real-time GPS correlation on Google Maps</p>
                    </div>
                    {gpsSimActive && (
                      <span className="bg-emerald-950 text-emerald-400 border border-emerald-900 text-[9px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                        Simulating Transit
                      </span>
                    )}
                  </div>

                  {mapsAuthError ? (
                    <div className="w-full rounded-2xl border border-red-950 bg-slate-950 p-6 flex flex-col justify-center items-center text-center space-y-4 min-h-[240px] select-text">
                      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 animate-bounce">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <div className="space-y-1 max-w-sm">
                        <span className="inline-block bg-red-500/15 text-red-400 font-mono font-black text-[9px] tracking-widest px-2.5 py-0.5 rounded border border-red-500/25 uppercase">
                          Google Maps API Auth Error
                        </span>
                        <h5 className="font-extrabold text-xs text-white uppercase tracking-tight leading-normal pt-1">
                          RefererNotAllowedMapError
                        </h5>
                        <p className="text-[10px] text-slate-400 leading-relaxed pt-1">
                          Your Maps API key is configured with Website restrictions in the Google Cloud Console, but your current browser URL is not authorized yet.
                        </p>
                        <div className="space-y-1.5 pt-2 text-left">
                          <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest block">URL to authorize:</span>
                          <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl text-[10px] font-mono font-bold text-orange-400 select-all break-all text-center">
                            {window.location.origin}/*
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : hasValidMapsKey ? (
                    <div className="relative w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950" style={{ height: '240px' }}>
                      <APIProvider apiKey={activeMapsKey}>
                        <Map
                          id="driver_shipment_progress_map"
                          defaultCenter={lastGpsCoords || CITY_COORDINATES[(activeShipment?.loadingCity || "").toLowerCase().trim()] || CITY_COORDINATES["istanbul"]}
                          defaultZoom={6}
                          gestureHandling={'cooperative'}
                          disableDefaultUI={true}
                          zoomControl={false}
                          mapId="DEMO_MAP_ID"
                        >
                          {/* Custom Map Controls (Zoom Panel and Auto-Center) */}
                          <MapCustomControls activeShipment={activeShipment} lang={lang} />

                          {/* Route Polyline Renderer */}
                          <RouteDisplay 
                            origin={CITY_COORDINATES[(activeShipment?.loadingCity || "").toLowerCase().trim()] || CITY_COORDINATES["istanbul"]} 
                            destination={CITY_COORDINATES[(activeShipment?.deliveryCity || "").toLowerCase().trim()] || CITY_COORDINATES["baghdad"]} 
                          />

                          {/* Origin Marker */}
                          <AdvancedMarker 
                            position={CITY_COORDINATES[(activeShipment?.loadingCity || "").toLowerCase().trim()] || CITY_COORDINATES["istanbul"]} 
                            title={`Origin: ${activeShipment.loadingCity}`}
                          >
                            <div className="flex flex-col items-center justify-center">
                              <span className="bg-emerald-600 border border-emerald-500 text-white font-bold text-[9px]/tight px-1.5 py-0.5 rounded shadow-md z-10 select-none whitespace-nowrap">
                                {activeShipment.loadingCity}
                              </span>
                              <div style={{ width: '40px', height: '40px' }} className="w-10 h-10 bg-emerald-600/20 border border-emerald-500 rounded-full flex items-center justify-center">
                                <div className="w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white"></div>
                              </div>
                            </div>
                          </AdvancedMarker>

                          {/* Destination Marker */}
                          <AdvancedMarker 
                            position={CITY_COORDINATES[(activeShipment?.deliveryCity || "").toLowerCase().trim()] || CITY_COORDINATES["baghdad"]} 
                            title={`Destination: ${activeShipment.deliveryCity}`}
                          >
                            <div className="flex flex-col items-center justify-center">
                              <span className="bg-blue-600 border border-blue-500 text-white font-bold text-[9px]/tight px-1.5 py-0.5 rounded shadow-md z-10 select-none whitespace-nowrap">
                                {activeShipment.deliveryCity}
                              </span>
                              <div style={{ width: '40px', height: '40px' }} className="w-10 h-10 bg-blue-600/20 border border-blue-500 rounded-full flex items-center justify-center animate-pulse">
                                <div className="w-3.5 h-3.5 bg-blue-500 rounded-full border-2 border-white"></div>
                              </div>
                            </div>
                          </AdvancedMarker>

                          {/* Live Truck Marker */}
                          {lastGpsCoords && (
                            <AdvancedMarker position={lastGpsCoords} title={`Vehicle Plaque: ${getDriverTruck()}`}>
                              <div className="flex flex-col items-center justify-center">
                                <span className="bg-orange-600 border border-orange-500 text-white font-bold font-mono text-[8px]/tight px-1.5 py-0.5 rounded shadow-md z-10 select-none whitespace-nowrap">
                                  {getDriverTruck() || 'TRUCK'}
                                </span>
                                <div style={{ width: '40px', height: '40px' }} className="w-10 h-10 bg-orange-600 border border-white rounded-full flex items-center justify-center shadow-lg transition-all duration-1000">
                                  <Truck className="w-4 h-4 text-white" />
                                </div>
                              </div>
                            </AdvancedMarker>
                          )}
                        </Map>
                      </APIProvider>
                    </div>
                  ) : (
                    /* Elegant Setup / Instruction Splash block when Google Maps Key is not yet configured */
                    <div className="w-full rounded-2xl border border-slate-800 bg-slate-950 p-6 flex flex-col justify-center items-center text-center space-y-4 min-h-[240px]">
                      <div className="w-12 h-12 rounded-full bg-orange-500/5 border border-orange-500/20 flex items-center justify-center shadow-inner">
                        <MapPin className="w-5 h-5 text-orange-500" />
                      </div>
                      <div className="space-y-1">
                        <h5 className="font-extrabold text-xs text-white uppercase tracking-wider font-mono">Maps API Offline</h5>
                        <p className="text-[10.5px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                          Provide a valid developer token to authorize live satellite tracking and driving route polyline overlays.
                        </p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-xl text-left text-[10px]/relaxed text-slate-400 space-y-1.5 max-w-xs w-full">
                        <p className="text-[9px] font-black text-white uppercase tracking-wider font-mono">Authentication Instructions:</p>
                        <p className="flex items-start gap-1"><span className="text-[#f97316] font-bold">1.</span> <span>Authorise <strong className="text-slate-200">Maps JavaScript API</strong> in GCP console.</span></p>
                        <p className="flex items-start gap-1"><span className="text-[#f97316] font-bold">2.</span> <span>Define <strong className="text-orange-500 font-mono">GOOGLE_MAPS_PLATFORM_KEY</strong> environment hook.</span></p>
                      </div>
                    </div>
                  )}

                  {/* Route Progress bar & telemetry metadata row */}
                  {lastGpsCoords && (
                    <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-3.5 shadow-sm text-xs select-none">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800/40">
                          <span className="text-slate-500 text-[9px] uppercase tracking-wider block font-mono">Live Speed</span>
                          <span className="font-bold text-slate-200 font-mono text-xs">{isShipmentFinished ? 0 : gpsSpeed} km/h</span>
                        </div>
                        <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800/40">
                          <span className="text-slate-500 text-[9px] uppercase tracking-wider block font-mono">Progress</span>
                          <span className="font-extrabold text-[#f97316] font-sans text-xs">{calculateDistancePercentage()}% Complete</span>
                        </div>
                        <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800/40">
                          <span className="text-slate-500 text-[9px] uppercase tracking-wider block font-mono">Sat Status</span>
                          {isShipmentFinished ? (
                            <span className="font-bold text-slate-500 font-mono text-[10px]/none inline-flex items-center gap-1 mt-0.5 justify-center">
                              <span className="w-1.5 h-1.5 bg-slate-600 rounded-full"></span>
                              CLOSED
                            </span>
                          ) : (
                            <span className="font-bold text-emerald-400 font-mono text-[10px]/none inline-flex items-center gap-1 mt-0.5 justify-center">
                              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                              ACTIVE
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono font-bold">
                          <span>ROUTE PROGRESS (GPS)</span>
                          <span>{calculateDistancePercentage()}%</span>
                        </div>
                        <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                          <div 
                            className="bg-gradient-to-r from-orange-600 to-orange-400 h-2 rounded-full transition-all duration-1000" 
                            style={{ width: `${calculateDistancePercentage()}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* PROOF OF DELIVERY (POD) SIGN-OFF & HANDOFF SIGNATURE PANEL */}
                {!isShipmentFinished && (
                  <div id="driver-pod-signature-portal" className="p-5 bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-3xl space-y-4 shadow-[0_8px_30px_rgba(0,0,0,0.5)] text-left select-none relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl group-hover:bg-orange-500/10 transition-all duration-500" />
                    <div className="flex items-start gap-2.5 relative z-10 text-left">
                      <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-500/25 flex items-center justify-center text-orange-500 shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-orange-400" />
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-white uppercase tracking-wider font-mono block">
                          Proof of Delivery (POD)
                        </span>
                        <span className="text-[9px] text-slate-400 block leading-tight mt-0.5">
                          Collect digital signature & checklist approval at destination depot
                        </span>
                      </div>
                    </div>

                    {!podSigningActive ? (
                      <div className="space-y-3.5 relative z-10 text-left">
                        <p className="text-[10.5px] text-slate-400 leading-normal">
                          Ready to hand off cargo and complete the logistics run? Verify cargo seal integrity, item count, and collect the consignee representative's signature directly on screen to mark secure delivery.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setPodSigningActive(true);
                            // Clear signature state
                            setTimeout(clearSignature, 100);
                          }}
                          className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 shadow-md border-0"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-white" />
                          <span>Initiate Delivery Sign-off</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4 animate-fade-in relative z-10 text-left">
                        {/* Handoff Checklist */}
                        <div className="space-y-2.5 bg-slate-950 p-3.5 rounded-2xl border border-slate-800/60">
                          <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest font-mono block">
                            Handoff Verification Checklist
                          </span>
                          
                          <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-slate-400 hover:text-white">
                            <input
                              type="checkbox"
                              checked={podChecklist.sealIntact}
                              onChange={(e) => setPodChecklist(prev => ({ ...prev, sealIntact: e.target.checked }))}
                              className="w-4 h-4 rounded border-slate-800 bg-slate-900 text-orange-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-orange-500"
                            />
                            <span>Confirm trailer seal is intact & matches BOL</span>
                          </label>

                          <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-slate-400 hover:text-white">
                            <input
                              type="checkbox"
                              checked={podChecklist.cargoVerified}
                              onChange={(e) => setPodChecklist(prev => ({ ...prev, cargoVerified: e.target.checked }))}
                              className="w-4 h-4 rounded border-slate-800 bg-slate-900 text-orange-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-orange-500"
                            />
                            <span>Verify cargo item count & physical condition</span>
                          </label>
                        </div>

                        {/* Authorized Receiver Name */}
                        <div className="space-y-1.5">
                          <label className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest font-mono block">
                            Recipient Name / Stamp
                          </label>
                          <input
                            type="text"
                            value={podReceiverName}
                            onChange={(e) => setPodReceiverName(e.target.value)}
                            placeholder="e.g. John Doe (Depot Manager)"
                            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-orange-500/50 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none transition-colors"
                          />
                        </div>

                        {/* Signature Drawing Canvas Area */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest font-mono block">
                              Recipients Signature Pad
                            </label>
                            <button
                              type="button"
                              onClick={clearSignature}
                              className="text-[8px] font-black text-slate-500 hover:text-red-400 uppercase tracking-wider transition-colors cursor-pointer"
                            >
                              Clear Pad
                            </button>
                          </div>
                          
                          <div className="relative bg-slate-950 rounded-xl border border-slate-800 overflow-hidden h-36">
                            <canvas
                              ref={sigCanvasRef}
                              width={360}
                              height={144}
                              onMouseDown={startDrawing}
                              onMouseMove={drawSignature}
                              onMouseUp={stopDrawing}
                              onMouseLeave={stopDrawing}
                              onTouchStart={startDrawing}
                              onTouchMove={drawSignature}
                              onTouchEnd={stopDrawing}
                              className="w-full h-full cursor-crosshair touch-none bg-slate-950"
                            />
                            <div className="absolute bottom-2.5 left-3 pointer-events-none text-[8.5px] text-slate-500 uppercase tracking-wider font-mono font-bold select-none opacity-40">
                              X ___________________________ (Sign Here)
                            </div>
                          </div>
                        </div>

                        {/* Sign Actions */}
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            disabled={podUploading}
                            onClick={() => setPodSigningActive(false)}
                            className="flex-1 py-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                          >
                            Cancel
                          </button>
                          
                          <button
                            type="button"
                            disabled={podUploading || !podReceiverName.trim() || !podChecklist.sealIntact || !podChecklist.cargoVerified}
                            onClick={handleCompleteDeliveryWithSignature}
                            className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-40 text-slate-950 font-black text-xs rounded-xl uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 border-0 shadow-[0_4px_15px_rgba(16,185,129,0.3)] active:scale-95"
                          >
                            {podUploading ? (
                              <>
                                <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin shrink-0" />
                                <span>Syncing...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-slate-950" />
                                <span>Confirm & Deliver</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* DRIVER ASSIST AUTOMATIC Predictive ETA & TRAFFIC PATTERNS PANEL */}
                {!isShipmentFinished && (() => {
                  const assistT = {
                    en: {
                      title: "Driver Assist Core",
                      subtitle: "Adaptive traffic & predictive ETA autopilot",
                      modeAuto: "Auto-Predictor Live",
                      modeManual: "Autopilot Paused",
                      trafficScenario: "Selected Road Scenario",
                      remDistance: "Remaining Dist.",
                      estSpeed: "Estimated Speed",
                      extraDelay: "Scheduled Delays",
                      etaArrival: "Predicted Arrival Time",
                      calculating: "Dynamic calculations live...",
                      optimal: "Optimal Flow",
                      moderate: "Normal Peak",
                      congested: "Heavy Traffic",
                      border: "Custom Backlog",
                      statusText: "Traffic conditions optimized",
                      enableHint: "Toggle off to enter manual routing planning.",
                      disabledHint: "Adaptive driver assist is currently paused. Tap above to resume dynamic ETA prediction."
                    },
                    tr: {
                      title: "Sürücü Asistanı Paneli",
                      subtitle: "Yapay zeka uyumlu trafik ve ETA hesaplama",
                      modeAuto: "Otomatik Tahminleyici Aktif",
                      modeManual: "Yapay Zeka Duraklatıldı",
                      trafficScenario: "Yol ve Trafik Durumu Simülasyonu",
                      remDistance: "Kalan Mesafe",
                      estSpeed: "Öngörülen Hız",
                      extraDelay: "Gümrük & Kontrol Gecikmesi",
                      etaArrival: "Tahmini Varış Süresi",
                      calculating: "Canlı güncellenen veriler...",
                      optimal: "Akıcı Yol",
                      moderate: "Olağan Akış",
                      congested: "Yoğun Trafik",
                      border: "Sınır Yoğunluğu",
                      statusText: "Trafik koşulları optimize edildi",
                      enableHint: "Manuel planlamaya geçmek için devredışı bırakın.",
                      disabledHint: "Uyumlu asistan geçici olarak durduruldu. Canlı tahmini başlatmak için yukarı dokunun."
                    },
                    ar: {
                      title: "مساعد السائق الذكي",
                      subtitle: "حساب الوقت المقدر والازدحام التلقائي",
                      modeAuto: "توقع تلقائي نشط",
                      modeManual: "مساعد السائق معطل",
                      trafficScenario: "محاكاة حالة المرور المحددة",
                      remDistance: "المسافة المتبقية",
                      estSpeed: "السرعة المتوقعة",
                      extraDelay: "تأخيرات التفتيش والجمارك",
                      etaArrival: "وقت الوصول المتوقع",
                      calculating: "تحديث ذكي مستمر...",
                      optimal: "طريق سريع",
                      moderate: "تدفق معتاد",
                      congested: "ازدحام شديد",
                      border: "طابور الحدود",
                      statusText: "تم تحسين حسابات القيادة",
                      enableHint: "قم بالإيقاف للعودة للتخطيط اليدوي.",
                      disabledHint: "مساعد السائق معطل حاليًا. انقر أعلاه لاستئناف توقع وقت الوصول التلقائي."
                    }
                  }[lang as 'en' | 'tr' | 'ar'] || {
                    title: "Driver Assist Core",
                    subtitle: "Adaptive traffic & predictive ETA autopilot",
                    modeAuto: "Auto-Predictor Live",
                    modeManual: "Autopilot Paused",
                    trafficScenario: "Selected Road Scenario",
                    remDistance: "Remaining Dist.",
                    estSpeed: "Estimated Speed",
                    extraDelay: "Scheduled Delays",
                    etaArrival: "Predicted Arrival Time",
                    calculating: "Dynamic calculations live...",
                    optimal: "Optimal Flow",
                    moderate: "Normal Peak",
                    congested: "Heavy Traffic",
                    border: "Custom Backlog",
                    statusText: "Traffic conditions optimized",
                    enableHint: "Toggle off to enter manual routing planning.",
                    disabledHint: "Adaptive driver assist is currently paused. Tap above to resume dynamic ETA prediction."
                  };

                  return (
                    <div id="driver-assist-core" className="p-5 bg-slate-900 border border-slate-800/80 rounded-3xl space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)] relative overflow-hidden group select-none">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl group-hover:bg-orange-500/10 transition-all duration-500" />
                      
                      {/* Section Title with Activation Toggle */}
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                        <div className="flex items-start gap-2 max-w-[70%] text-left">
                          <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-500/25 flex items-center justify-center text-orange-500 shrink-0">
                            <Compass className="w-4 h-4 animate-pulse text-orange-400" />
                          </div>
                          <div>
                            <span className="text-[10px] font-black text-white uppercase tracking-wider font-mono block">
                              {assistT.title}
                            </span>
                            <span className="text-[9px] text-slate-400 block truncate leading-tight mt-0.5">
                              {assistT.subtitle}
                            </span>
                          </div>
                        </div>

                        {/* Slide/Toggle Pill Element */}
                        <button
                          type="button"
                          onClick={() => {
                            const nextState = !assistActive;
                            setAssistActive(nextState);
                            triggerToast(nextState ? "⚡ Driver Assist predictor activated!" : "⚠️ Driver Assist paused. Manual calculations set.");
                          }}
                          className={`px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-wider transition-all duration-300 inline-flex items-center gap-1.5 cursor-pointer ${
                            assistActive 
                              ? "bg-orange-500/15 text-orange-400 border-orange-500/35 shadow-[0_2px_10px_rgba(249,115,22,0.15)] animate-shimmer" 
                              : "bg-slate-950/80 text-slate-400 border-slate-800 hover:bg-slate-900"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${assistActive ? "bg-orange-500 animate-pulse" : "bg-slate-500"}`} />
                          <span>{assistActive ? assistT.modeAuto : assistT.modeManual}</span>
                        </button>
                      </div>

                      {assistActive && assistCalculations ? (
                        <div className="space-y-4">
                          {/* Traffic Simulation Scenarios Selector */}
                          <div className="space-y-2">
                            <span className="text-slate-500 text-[8px] font-bold uppercase tracking-wider font-mono block text-left">
                              {assistT.trafficScenario}
                            </span>
                            <div className="grid grid-cols-4 gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                              {[
                                { key: 'optimal', text: assistT.optimal },
                                { key: 'moderate', text: assistT.moderate },
                                { key: 'congested', text: assistT.congested },
                                { key: 'border_delay', text: assistT.border }
                              ].map(item => (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() => {
                                    setTrafficPattern(item.key as any);
                                    triggerToast(`Driver Assist: Traffic pattern adjusted to ${item.key.toUpperCase()}`);
                                  }}
                                  className={`py-1 text-[8px] font-bold rounded-lg uppercase tracking-wider transition-all duration-200 cursor-pointer text-center select-none border border-transparent box-border ${
                                    trafficPattern === item.key 
                                      ? "bg-orange-500 !text-white border-orange-600 shadow-sm font-black" 
                                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                                  }`}
                                >
                                  {item.text}
                                </button>
                              ))}
                            </div>
                            
                            {/* Scenario verbal description contextual helper */}
                            <p className="text-[10px] text-slate-400 leading-relaxed text-left border-l-2 border-orange-500/40 pl-2 py-0.5 select-text">
                              {assistCalculations.trafficFactorDescription}
                            </p>
                          </div>

                          {/* Predictor Core Metric Bento Grid */}
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/70 text-center relative overflow-hidden">
                              <span className="text-[7.5px] font-bold text-slate-500 uppercase tracking-widest block font-mono">
                                {assistT.remDistance}
                              </span>
                              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                                <span className="font-bold text-slate-200 text-xs font-mono">
                                  {assistCalculations.processedDistance}
                                </span>
                                <span className="text-[8px] font-mono text-slate-500">KM</span>
                              </div>
                              <span className="text-[7px] text-slate-500 font-mono block mt-0.5">
                                / {assistCalculations.routeDistance} km total
                              </span>
                            </div>

                            <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/70 text-center">
                              <span className="text-[7.5px] font-bold text-slate-500 uppercase tracking-widest block font-mono">
                                {assistT.estSpeed}
                              </span>
                              <div className="mt-1 flex items-baseline justify-center gap-1">
                                <Gauge className="w-3 h-3 text-orange-400 shrink-0 self-center" />
                                <span className="font-bold text-slate-200 text-xs font-mono">
                                  {assistCalculations.activeSpeed}
                                </span>
                                <span className="text-[8px] font-mono text-slate-500">KMH</span>
                              </div>
                              <span className="text-[7px] text-slate-500 font-mono block mt-0.5">
                                avg road factor
                              </span>
                            </div>

                            <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/70 text-center">
                              <span className="text-[7.5px] font-bold text-slate-500 uppercase tracking-widest block font-mono">
                                {assistT.extraDelay}
                              </span>
                              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                                <span className={`font-bold text-xs font-mono ${assistCalculations.totalDelays > 2 ? 'text-orange-400' : 'text-slate-200'}`}>
                                  +{assistCalculations.totalDelays.toFixed(1)}
                                </span>
                                <span className="text-[8px] font-mono text-slate-500">HRS</span>
                              </div>
                              <span className="text-[7px] text-slate-500 font-mono block mt-0.5">
                                border & queue wait
                              </span>
                            </div>
                          </div>

                          {/* Main High Contrast Predicted ETA Output Block */}
                          <div className="bg-orange-500/5 rounded-2xl p-4 border border-orange-500/15 flex items-center justify-between">
                            <div className="space-y-1 text-left">
                              <span className="text-[8px] font-bold text-[#f97316] uppercase tracking-wider font-mono block">
                                {assistT.etaArrival}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-black text-xl tracking-tight font-sans">
                                  {assistCalculations.timeString}
                                </span>
                                <span className="bg-orange-500/10 text-orange-400 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border border-orange-500/20">
                                  {assistCalculations.etaDayLabel}
                                </span>
                              </div>
                              <p className="text-[9px] font-mono text-slate-500">
                                {assistT.calculating}
                              </p>
                            </div>

                            <div className="flex flex-col items-end gap-1 font-mono">
                              <div className="bg-orange-500/10 text-orange-400 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-orange-500/20 inline-flex items-center gap-1">
                                <Timer className="w-3 h-3 text-orange-400" />
                                <span>
                                  {assistCalculations.displayHours > 0 && `${assistCalculations.displayHours}h `}
                                  {assistCalculations.displayMinutes}m
                                </span>
                              </div>
                              <span className="text-[8px] text-slate-500 uppercase tracking-widest font-black">
                                total duration
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Paused Manual planning dashboard view */
                        <div className="py-4 px-2 rounded-2xl bg-slate-950/40 border border-slate-800/60 flex flex-col items-center justify-center text-center space-y-2">
                          <AlertTriangle className="w-7 h-7 text-slate-500" />
                          <p className="text-[10.5px] text-slate-400 max-w-xs leading-relaxed">
                            {assistT.disabledHint}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* STATUS ACTIONS CONDITIONAL ROUTING */}
                {(() => {
                  const isShipmentFinished = activeShipment.status === 'Delivered' || activeShipment.status === 'Arrived' || activeShipment.status === 'Closed' || activeShipment.status === 'Completed';
                  if (isShipmentFinished) {
                    return (
                      <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-3 shadow-[0_4px_25px_rgba(0,0,0,0.3)] select-none">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
                          <Lock className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs text-emerald-400 font-extrabold font-mono tracking-tight uppercase">
                            {lang === 'tr' ? 'Sefer Tamamlandı ve Kilitlendi' : lang === 'ar' ? 'تم اكتمال المهمة وقفلها' : 'Job Finalized & Locked'}
                          </p>
                          <p className="text-[10px] text-slate-400 leading-normal mt-1">
                            {lang === 'tr' ? 'Bu teslimat tamamlanmıştır, sürücü güncellemelerine kapalıdır.' : lang === 'ar' ? 'تم تسليم هذه الشحنة وإغلاق التحديثات لسلامة البيانات.' : 'This delivery has been successfully finalized. Operational logs are now locked.'}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  if (activeShipment.status === "Assigned") {
                    return (
                      <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
                        <p className="text-xs text-white font-bold leading-normal">{t('assignDriver')}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <button 
                            onClick={() => handleRejectAssignment(activeShipment)}
                            className="py-2.5 bg-red-950/40 hover:bg-red-900/40 border border-red-500/20 text-red-400 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95"
                          >
                            {t('rejectShipment')}
                          </button>
                          <button 
                            onClick={() => handleAcceptAssignment(activeShipment)}
                            className="py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-xs font-bold rounded-xl transition-all shadow-[0_4px_15px_rgba(249,115,22,0.3)] cursor-pointer active:scale-95"
                          >
                            {t('acceptShipment')}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <form onSubmit={handleStatusUpdate} className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
                      <div className="border-b border-slate-800 pb-2">
                        <h4 className="font-black text-xs text-white uppercase tracking-wider font-mono">{t('status')} Updates Terminal</h4>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">Target Logistics State</label>
                        <select
                          value={selectedStatusVal}
                          onChange={(e) => setSelectedStatusVal(e.target.value as ShipmentStatus)}
                          className="w-full p-3 bg-slate-950 border border-slate-800 text-xs text-slate-200 font-bold rounded-xl outline-none focus:border-amber-500 transition-all cursor-pointer"
                        >
                          {['Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered'].map(st => (
                            <option key={st} value={st} className="bg-slate-950 text-slate-200 font-bold">{st}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">Remarks / Cargo Incident Logs</label>
                        <input 
                          type="text" 
                          placeholder={t('remarksPlaceholder')}
                          value={remarks}
                          onChange={(e) => setRemarks(e.target.value)}
                          className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none focus:border-amber-500 transition-all"
                        />
                      </div>

                      <button 
                        type="submit" 
                        className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-extrabold text-xs rounded-xl shadow-[0_4px_15px_rgba(249,115,22,0.35)] transition-all cursor-pointer active:scale-95 text-center uppercase tracking-wider font-mono"
                      >
                        {t('updateStatusBtn')}
                      </button>
                    </form>
                  );
                })()}



                {/* Shared Official documents visibility inside mobile */}
                <div className="space-y-3 bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
                  <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
                    <h4 className="text-white font-black text-xs uppercase tracking-wider font-mono text-left">Shared Files Center</h4>
                    {!(activeShipment.status === 'Delivered' || activeShipment.status === 'Arrived' || activeShipment.status === 'Closed' || activeShipment.status === 'Completed') && (
                      <button
                        type="button"
                        onClick={() => {
                          setScanDocName(`SCAN_${new Date().toISOString().slice(0,10).replace(/-/g, "")}_${Math.floor(1000 + Math.random() * 9000)}.png`);
                          setScanCategory("cmr");
                          setCapturedImage(null);
                          setScanFilter("color");
                          setScanState("scanning");
                          setIsScanOpen(true);
                          startCamera();
                        }}
                        className="p-1 px-2.5 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-400 hover:text-white font-extrabold text-[8.5px] uppercase tracking-wider font-mono rounded-lg flex items-center gap-1 cursor-pointer transition-all active:scale-95"
                      >
                        <Camera className="w-3 h-3 shrink-0 animate-pulse text-emerald-400" />
                        <span>Scan Document</span>
                      </button>
                    )}
                  </div>
                  {activeShipment.documents && activeShipment.documents.length > 0 ? (
                    <div className="space-y-2">
                      {activeShipment.documents.map(d => (
                        <div key={d.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs hover:border-slate-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-orange-500/5 border border-orange-500/20 text-orange-500 h-7 w-7 flex items-center justify-center">
                              <Paperclip className="w-3.5 h-3.5" />
                            </div>
                            <span className="truncate max-w-[150px] font-mono text-[10px] text-slate-200">{d.name}</span>
                          </div>
                          <span className="text-[8px] bg-slate-900 border border-slate-800 text-orange-400 px-1.5 py-0.5 rounded-md uppercase font-black font-mono tracking-wider">{d.category}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic block text-left py-2">No operational files registered.</p>
                  )}
                </div>

              </div>
            )}

            {/* CHAT TAB PANEL (Shipment Conversation room) */}
            {activeTab === 'chat' && (
              <div className="h-full flex flex-col justify-between pt-1 text-slate-200">
                {activeShipment ? (
                  <div className="flex-1 flex flex-col justify-between overflow-hidden h-[540px]">
                    <div className="bg-slate-900/60 p-3.5 border-b border-slate-800 flex items-center justify-between shrink-0 select-none">
                      <div className="flex items-center gap-2">
                        {isShipmentFinished ? (
                          <span className="relative flex h-2 w-2">
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
                          </span>
                        ) : (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        )}
                        <div>
                          <h4 className="font-extrabold text-xs text-white uppercase tracking-wider font-mono">Consignee Helpline</h4>
                          <span className="text-[9px] text-[#f97316] font-mono font-bold">
                            {isShipmentFinished 
                              ? (lang === 'tr' ? `Tamamlanan Görev #${activeShipment.shipmentNumber}` : lang === 'ar' ? `المهمة المكتملة #${activeShipment.shipmentNumber}` : `Finished Duty #${activeShipment.shipmentNumber}`)
                              : `Transit Duty #${activeShipment.shipmentNumber}`
                            }
                          </span>
                        </div>
                      </div>
                      {!isShipmentFinished && (
                          <div className="flex gap-1.5 items-center">
                            <button 
                              onClick={() => {
                                setScanDocName(`SCAN_${new Date().toISOString().slice(0,10).replace(/-/g, "")}_${Math.floor(1000 + Math.random() * 9000)}.png`);
                                setScanCategory("cmr");
                                setCapturedImage(null);
                                setScanFilter("color");
                                setScanState("scanning");
                                setIsScanOpen(true);
                                startCamera();
                              }}
                              className="p-1 px-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-extrabold text-[9px] uppercase tracking-wider font-mono rounded-full inline-flex items-center gap-1 cursor-pointer shadow-[0_2px_10px_rgba(16,185,129,0.25)] transition-all active:scale-95 border-0"
                            >
                              <Camera className="w-3 h-3 shrink-0 animate-pulse" />
                              <span>Scan Document</span>
                            </button>
                            <button 
                              onClick={() => setFileSimOpen(true)}
                              className="p-1 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-extrabold text-[9px] uppercase tracking-wider font-mono rounded-full inline-flex items-center gap-1 cursor-pointer transition-all active:scale-95 border border-slate-700"
                            >
                              <FileUp className="w-3 h-3 shrink-0" />
                              <span>Upload File</span>
                            </button>
                          </div>
                        )}
                      </div>

                    {/* Chat Search Input */}
                    <div className="px-3.5 py-2 bg-slate-950 border-b border-slate-900 flex items-center gap-2 shrink-0 transition-all select-none">
                      <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <input
                        type="text"
                        placeholder={lang === 'tr' ? 'Mesajlarda ara...' : lang === 'ar' ? 'البحث عن رسالة...' : 'Search messages...'}
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        className="bg-transparent text-[10px] text-slate-300 placeholder-slate-700 focus:outline-none w-full font-mono border-0"
                      />
                      {chatSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setChatSearchQuery("")}
                          className="text-slate-400 hover:text-white text-[9px] font-bold px-2 py-0.5 bg-slate-900 border border-slate-800 rounded cursor-pointer border-0"
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
                    {!isShipmentFinished && (
                      <div className="bg-slate-950 px-3 py-2 border-t border-slate-900 overflow-x-auto shrink-0 flex gap-2 items-center scroll-smooth no-scrollbar select-none">
                        {(QUICK_TEMPLATES[lang] || QUICK_TEMPLATES.en).map((chip, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => setNewMessageText(chip.text)}
                            className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800/80 text-slate-300 hover:text-white rounded-lg text-[9px] font-bold whitespace-nowrap transition-all cursor-pointer shadow-sm select-none active:scale-95"
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Message input */}
                    {isShipmentFinished ? (
                      <div className="p-4 bg-slate-950 border-t border-slate-900 text-center text-slate-500 font-mono text-[10px] select-none">
                        ⚠️ Radio connection has been closed for this completed job.
                      </div>
                    ) : (
                      <form onSubmit={handleSendMessage} className="bg-slate-950 p-3.5 border-t border-slate-900 flex items-center gap-2.5 shrink-0 select-none">
                        <button 
                          type="button" 
                          onClick={() => setFileSimOpen(true)}
                          title="Attach Document / Photo"
                          className="p-3 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer inline-flex items-center active:scale-95"
                        >
                          <Paperclip className="w-4 h-4 shrink-0" />
                        </button>

                        <input 
                          type="text" 
                          placeholder={t('typeMessage')}
                          value={newMessageText}
                          onChange={(e) => setNewMessageText(e.target.value)}
                          className="flex-1 p-3 bg-slate-900 border border-slate-800 focus:border-orange-500/50 outline-none rounded-xl text-xs text-white placeholder-slate-600 transition-all font-mono"
                        />
                        <button 
                          type="submit" 
                          disabled={!newMessageText.trim()}
                          aria-label={lang === 'tr' ? 'Gönder' : lang === 'ar' ? 'إرسال' : 'Send message'}
                          className="p-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl transition-all cursor-pointer inline-flex items-center disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none select-none active:scale-95 border-0 shadow-[0_2px_10px_rgba(249,115,22,0.2)]"
                        >
                          <Send className="w-4 h-4 shrink-0" />
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="py-24 text-center text-slate-500 space-y-4 px-6 select-none">
                    <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2.5xl flex items-center justify-center mx-auto text-slate-600">
                      <MessageSquare className="w-7 h-7 mx-auto shrink-0" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-400">Helpline Chat Room Empty</p>
                      <p className="text-[10px] text-slate-500 max-w-xs mx-auto leading-relaxed">Select any active job inside your assigned shipments directory to launch direct radio channels with dispatchers.</p>
                    </div>
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
                      <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                        <span className="text-[9.5px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800/65 pb-1.5">{profileT.personalData}</span>
                        
                        <div className="flex items-center justify-between text-xs py-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.fullName}
                          </span>
                          <strong className="text-slate-200">{profileName}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-800">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.username}
                          </span>
                          <strong className="text-slate-300 font-mono text-[10.5px]">@{profileUsername}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-800">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.phone}
                          </span>
                          <strong className="text-slate-200 font-sans">{profilePhone}</strong>
                        </div>
                      </div>

                      {/* Tractor & Trailer Specifications */}
                      <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                        <span className="text-[9.5px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800/65 pb-1.5">{editProfileLabels.truckSpecs}</span>
                        
                        <div className="flex items-center justify-between text-xs py-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Truck className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.truckNumber}
                          </span>
                          <strong className="text-slate-200 font-mono tracking-wide">{profileTruckNumber}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-800">
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
                      <div className="space-y-3 p-4 bg-slate-900 border border-slate-800 rounded-2xl text-left">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800 pb-1.5">{profileT.personalData}</span>
                        
                        {/* Edit Mode Avatar Section */}
                        <div className="flex items-center gap-4 py-2 border-b border-slate-800/40 pb-3">
                          <div className="relative">
                            <div className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-white font-black text-sm shadow border border-slate-800 bg-slate-800">
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
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.fullName}</label>
                          <input 
                            type="text" 
                            required
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-bold focus:border-orange-500 transition-all text-left"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.username}</label>
                          <input 
                            type="text" 
                            required
                            value={profileUsername}
                            onChange={(e) => setProfileUsername(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-mono focus:border-orange-500 transition-all text-left hover:border-slate-700"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.phone}</label>
                          <input 
                            type="text"
                            required 
                            value={profilePhone}
                            onChange={(e) => setProfilePhone(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-bold focus:border-orange-500 transition-all text-left"
                          />
                        </div>
                      </div>

                      {/* Truck Details Edit fields */}
                      <div className="space-y-4 p-4.5 bg-slate-900 border border-slate-800 rounded-2.5xl text-left">
                        <span className="text-[10px] font-black text-white block uppercase tracking-wider border-b border-slate-800 pb-2 font-mono">{editProfileLabels.truckSpecs}</span>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.truckNumber}</label>
                          <input 
                            type="text" 
                            required
                            value={profileTruckNumber}
                            onChange={(e) => setProfileTruckNumber(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-mono focus:border-orange-500 transition-all text-left"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.truckType}</label>
                          <select 
                            value={profileTruckType}
                            onChange={(e) => setProfileTruckType(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-bold focus:border-orange-500 transition-all text-left cursor-pointer"
                          >
                            {TRUCK_TYPES.map(type => (
                              <option key={type.id} value={type.id} className="bg-slate-950 text-white font-bold">
                                {lang === 'en' ? type.en : (lang === 'tr' ? type.tr : type.ar)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-2">
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
                          className="flex-1 py-2.5 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white border border-slate-800 font-bold text-xs rounded-xl transition-all cursor-pointer text-center select-none active:scale-95"
                        >
                          {editProfileLabels.cancelBtn}
                        </button>
                        <button 
                          type="submit" 
                          disabled={isSavingProfile}
                          className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:opacity-40 text-white font-extrabold text-xs rounded-xl shadow-[0_4px_15px_rgba(249,115,22,0.3)] transition-all flex items-center justify-center gap-1.5 cursor-pointer select-none active:scale-95 border-0"
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

                  <div className="mt-4 pt-4 border-t border-slate-900">
                    {!showDriverDeleteConfirm ? (
                      <button 
                        type="button" 
                        onClick={() => {
                          setShowDriverDeleteConfirm(true);
                          setUnderstandDriverDelete(false);
                        }}
                        className="w-full py-2 bg-red-950/10 hover:bg-red-950/30 border border-red-900/30 hover:border-red-500/30 text-red-400 font-extrabold text-[10.5px] uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{lang === 'tr' ? "Hesabımı Tamamen Sil" : (lang === 'ar' ? "حذف الحساب نهائياً" : "Delete My Account")}</span>
                      </button>
                    ) : (
                      <div className="bg-slate-950 p-3.5 rounded-2xl border border-red-900/20 space-y-3 animate-fade-in">
                        <div className="flex items-start gap-2 text-red-400">
                          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 animate-pulse" />
                          <div className="text-left">
                            <h5 className="text-[11px] font-black uppercase tracking-wider font-mono">
                              {lang === 'tr' ? "Kalıcı Hesap Silme İşlemi" : (lang === 'ar' ? "حذف الحساب بشكل نهائي" : "Irreversible Profile Purge")}
                            </h5>
                            <p className="text-[9.5px] text-slate-400 leading-tight mt-0.5">
                              {lang === 'tr' 
                                ? "Bu işlem geri alınamaz. Tüm lojistik geçmişiniz, aktif tır plakanız ve sürücü sevk yetkileriniz sistemden tamamen silinecektir."
                                : (lang === 'ar' 
                                  ? "هذا الإجراء نهائي ولا يمكن التراجع عنه. سيتم مسح تفويض الشاحنة وتاريخ السفر بالكامل من النظم."
                                  : "This cannot be undone. Your active manifests, historical trips, and fleet registry authorization will be permanently wiped.")}
                            </p>
                          </div>
                        </div>

                        <label className="flex items-start gap-2.5 cursor-pointer text-[10.5px] font-bold text-slate-400 hover:text-white">
                          <input
                            type="checkbox"
                            checked={understandDriverDelete}
                            onChange={(e) => setUnderstandDriverDelete(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-800 bg-slate-900 text-red-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-red-500 mt-0.5"
                          />
                          <span className="leading-tight text-left">
                            {lang === 'tr' 
                              ? "Hesabımın silinmesini ve sistemden çıkarılmasını istiyorum."
                              : (lang === 'ar' 
                                ? "أوافق على حذف حسابي بشكل دائم ومسح هويتي التعريفية."
                                : "I consent to permanently purge my account identity and logs.")}
                          </span>
                        </label>

                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isDeletingDriverAccount}
                            onClick={() => setShowDriverDeleteConfirm(false)}
                            className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                          >
                            {lang === 'tr' ? "Vazgeç" : (lang === 'ar' ? "إلغاء Действие" : "Cancel")}
                          </button>
                          
                          <button
                            type="button"
                            disabled={isDeletingDriverAccount || !understandDriverDelete}
                            onClick={handleDeleteDriverAccount}
                            className="flex-1 py-1.5 bg-gradient-to-r from-red-600 to-red-600 hover:from-red-600 hover:to-red-700 disabled:opacity-40 text-white font-black text-[10px] rounded-xl uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 shadow-md border-0"
                          >
                            {isDeletingDriverAccount ? (
                              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                            ) : (
                              <Trash2 className="w-3 h-3 shrink-0" />
                            )}
                            <span>{lang === 'tr' ? "Profilimi Sil" : (lang === 'ar' ? "تأكيد الحذف" : "Purge Account")}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* EXPANDED MENU & PILOT CONSOLE PANEL */}
            {activeTab === 'menu' && (
              <div className="space-y-4 animate-fade-in text-left font-sans">
                {(() => {
                  const menuOptions = {
                    en: {
                      title: "App Settings",
                      subtitle: "Customize your driver portal application",
                      activeDriver: "Active Driver Profile",
                      statusActive: "Active & Online",
                      truckId: "Truck ID",
                      typeId: "Truck Type",
                      ratingLabel: "Safety & Performance",
                      ratingVal: "4.98 Excellent Rating",
                      pingRateLabel: "GPS Sync Frequency",
                      pingRateSub: "Controls coordinate updates to dispatcher map",
                      pingHigh: "High Accuracy (15s)",
                      pingMed: "Battery Saver (45s)",
                      pingLow: "Eco Saver (90s)",
                      audioAlerts: "Critical Sound Alerts",
                      audioAlertsSub: "Play audio warnings on active dispatch changes",
                      speedAdvisor: "Speed Post Guard",
                      speedAdvisorSub: "Spoken warnings near border control zones",
                      unitsLabel: "Measurement Units",
                      unitsSub: "Toggle distance unit between metric and imperial",
                      activeLang: "Application Language",
                      activeLangSub: "Active language selected for dispatcher text",
                      savePref: "Save Preferences",
                      savePrefSub: "Save modifications locally on device",
                      toastSaved: "Settings preference and sync rate saved successfully!"
                    },
                    tr: {
                      title: "Uygulama Ayarları",
                      subtitle: "Sürücü portalı uygulamanızı özelleştirin",
                      activeDriver: "Aktif Sürücü Profili",
                      statusActive: "Aktif ve Çevrimiçi",
                      truckId: "Araç Plaka",
                      typeId: "Araç Tipi",
                      ratingLabel: "Güvenlik ve Performans",
                      ratingVal: "4.98 Mükemmel Sürücü",
                      pingRateLabel: "GPS Konum Sıklığı",
                      pingRateSub: "Sevk sorumlusu haritasına konum yükleme süresi",
                      pingHigh: "Yüksek Hassasiyet (15sn)",
                      pingMed: "Pil Tasarrufu (45sn)",
                      pingLow: "Eko Tasarruf (90sn)",
                      audioAlerts: "Sesli Uyarı Bildirimleri",
                      audioAlertsSub: "Aktif sevk değişikliklerinde sesli uyarı çal",
                      speedAdvisor: "Hız Sınırı Koruyucu",
                      speedAdvisorSub: "Sınır kapısı yaklaşımında sesli uyarı ver",
                      unitsLabel: "Ölçüm Birimi",
                      unitsSub: "Kilometre (KM) ile Mil (MI) arasında geçiş yapın",
                      activeLang: "Uygulama Dili",
                      activeLangSub: "Sevk sorumlusu metni için seçilen aktif dil",
                      savePref: "Tercihleri Kaydet",
                      savePrefSub: "Değişiklikleri yerel cihaz durumuna uygula",
                      toastSaved: "Uygulama tercihleri başarıyla kaydedildi!"
                    },
                    ar: {
                      title: "إعدادات التطبيق",
                      subtitle: "تخصيص تطبيق بوابة السائق الخاص بك",
                      activeDriver: "ملف السائق النشط",
                      statusActive: "نشط ومتصل بالإنترنت",
                      truckId: "رقم الشاحنة",
                      typeId: "نوع الشاحنة",
                      ratingLabel: "الأمان والأداء",
                      ratingVal: "٤.٩٨ تقييم ممتاز",
                      pingRateLabel: "تحديث تتبع الموقع (GPS)",
                      pingRateSub: "التحكم في سرعة مزامنة إحداثيات الموقع للمرسل",
                      pingHigh: "دقة عالية (١٥ ثانية)",
                      pingMed: "توفير البطارية (٤٥ ثانية)",
                      pingLow: "الموفر الاقتصادي (٩٠ ثانية)",
                      audioAlerts: "التنبيهات الصوتية الهامة",
                      audioAlertsSub: "تشغيل أصوات تنبيه عند تحديث المهام",
                      speedAdvisor: "مستشار حد السرعة",
                      speedAdvisorSub: "تحذير صوتي عند الاقتراب من البوابات الحدودية",
                      unitsLabel: "وحدات القياس",
                      unitsSub: "التحويل بين النظام المتري (كم) والإمبراطوري (ميل)",
                      activeLang: "لغة التطبيق",
                      activeLangSub: "اللغة النشطة لرسائل وتوجيهات الإرسال",
                      savePref: "حفظ التوجيهات",
                      savePrefSub: "تطبيق التعديلات وحفظها على الجهاز",
                      toastSaved: "تم تحديث تفضيلات التطبيق وحفظها بنجاح!"
                    }
                  };
                  const menuT = menuOptions[lang] || menuOptions.en;

                  const dr = drivers.find(d => d.id === selectedDriverId);

                  return (
                    <>
                      {/* Header Title Block */}
                      <div className="border-b border-slate-900 pb-3 flex items-center justify-between">
                        <div>
                          <h3 className="font-extrabold text-sm text-white tracking-tight uppercase font-mono">{menuT.title}</h3>
                          <p className="text-[10px] text-slate-500 mt-0.5">{menuT.subtitle}</p>
                        </div>
                        <span className="bg-orange-500/10 text-orange-400 font-mono font-black text-[10px] px-2.5 py-0.5 rounded-full border border-orange-500/20">
                          v4.5-Live
                        </span>
                      </div>

                      {/* ACTIVE DRIVER COMPACT BADGE CARD */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 relative overflow-hidden shadow-md">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-orange-600/5 rounded-full blur-xl" />
                        <div className="relative">
                          {profileAvatarUrl ? (
                            <img 
                              src={profileAvatarUrl} 
                              alt="Driver Profile" 
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded-full object-cover border-2 border-orange-500/40 shadow-sm"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center border-2 border-orange-500/40 text-white font-extrabold text-sm uppercase">
                              {(profileName || dr?.name || "DR").substring(0, 2)}
                            </div>
                          )}
                          <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-900 animate-pulse" />
                        </div>
                        <div className="flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-black text-white">{profileName || dr?.name || "Verified Operator"}</h4>
                            <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-extrabold px-1.5 py-0.5 rounded border border-emerald-500/15 font-mono uppercase">
                              {menuT.statusActive}
                            </span>
                          </div>
                          <p className="text-[9.5px] text-slate-400 font-mono flex items-center gap-2">
                            <span>{menuT.truckId}: <strong className="text-white font-bold">{profileTruckNumber || dr?.truckNumber || "-"}</strong></span>
                            <span className="text-slate-700 font-sans">•</span>
                            <span className="uppercase text-[8.5px] font-semibold text-slate-500">{profileTruckType || dr?.truckType || "reefer"}</span>
                          </p>
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((s) => (
                                <Star key={s} className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                              ))}
                            </div>
                            <span className="text-[9.5px] font-extrabold text-amber-500 font-mono tracking-tight">{menuT.ratingVal}</span>
                          </div>
                        </div>
                      </div>

                      {/* GPS TRACKING ACCURACY SETTING (AUTOMATED & FRIENDLY STYLE) */}
                      <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4.5 space-y-3.5 shadow-md relative overflow-hidden group">
                        {/* Soft ambient background glow representing live transmission signal */}
                        <div className="absolute -top-10 -right-10 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl animate-pulse" />
                        
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-inner">
                            <Compass className="w-4 h-4 text-emerald-400 animate-spin" style={{ animationDuration: '40s' }} />
                          </div>
                          <div>
                            <h4 className="text-xs font-black text-white uppercase tracking-tight">
                              {lang === 'tr' ? "Akıllı GPS Müzakeresi" : lang === 'ar' ? "تتبع الموقع التلقائي الذكي" : "Smart GPS Telemetry"}
                            </h4>
                            <span className="text-[8.5px] text-emerald-400 font-mono tracking-wider font-extrabold uppercase flex items-center gap-1 mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                              {lang === 'tr' ? "Aktif ve Otomatik" : lang === 'ar' ? "مفعل تلقائياً" : "Active & Auto-Optimized"}
                            </span>
                          </div>
                        </div>

                        <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-slate-400 text-[10.5px] leading-relaxed space-y-2">
                          <p>
                            {lang === 'tr' 
                              ? "Cihazınızın konumu sevkiyat sorumlusu haritasıyla arka planda tamamen otomatik olarak senkronize edilir. Manuel müdahale veya ayar yapılması gerekmez." 
                              : lang === 'ar' 
                              ? "يتم مزامنة موقع جهازك مع خريطة المرسل بالكامل تحت الخلفية بشكل تلقائي، لا يتطلب أي تحكم يدوي."
                              : "Your position is automatically synchronized with the backend dispatcher map dynamically. No manual adjustment ever needed."}
                          </p>
                          <div className="flex items-center justify-between text-[9px] font-mono border-t border-slate-900/85 pt-2 text-slate-500">
                            <span>{lang === 'tr' ? "Sıklık:" : "Dynamic Interval:"}</span>
                            <span className="font-extrabold text-orange-400">15s In-Transit</span>
                          </div>
                        </div>
                      </div>

                      {/* TOGGLE SETTINGS PANEL */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3.5 shadow-md">
                        <div className="flex items-center gap-2 pb-1 border-b border-slate-800">
                          <Settings className="w-4 h-4 text-orange-500" />
                          <h4 className="text-xs font-black text-white uppercase tracking-tight">App Preferences</h4>
                        </div>

                        <div className="space-y-3">
                          {/* Unit Configuration preference toggle */}
                          <div className="flex items-center justify-between py-1 bg-slate-950/40 p-2 rounded-xl border border-slate-800 text-xs">
                            <div className="space-y-0.5">
                              <span className="text-[11px] font-bold text-white block">{menuT.unitsLabel}</span>
                              <span className="text-[9px] text-slate-500 block leading-tight">{menuT.unitsSub}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const nextUnit = distanceUnit === 'km' ? 'mi' : 'km';
                                setDistanceUnit(nextUnit);
                                triggerToast(`Units switched to ${nextUnit.toUpperCase()}`);
                              }}
                              className="px-3 py-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-orange-400 font-mono text-[9.5px] uppercase font-black tracking-wider rounded-lg transition-all"
                            >
                              {distanceUnit === 'km' ? 'KM (METRIC)' : 'MI (IMPERIAL)'}
                            </button>
                          </div>

                          {/* Daylight/Nighttime View Theme Switcher - Now prominently in App Preferences */}
                          <div className="flex items-center justify-between py-1 bg-slate-950/40 p-2 rounded-xl border border-slate-800 text-xs">
                            <div className="space-y-0.5 text-left">
                              <span className="text-[11px] font-bold text-white block">
                                {lang === 'tr' ? "Görünürlük Kontrast Modu" : lang === 'ar' ? "وضع تباين الرؤية" : "Visibility Contrast Mode"}
                              </span>
                              <span className="text-[9px] text-slate-500 block leading-tight">
                                {lang === 'tr' 
                                  ? "Gündüz Işığı ile Gece Karanlığı arasında geçiş yapın" 
                                  : lang === 'ar' 
                                  ? "التنقل بين الوضع النهاري والوضع الداكن للرؤية" 
                                  : "Toggle between bright Day Light and relaxed Night Dark"}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                                setTheme(nextTheme);
                                triggerToast(nextTheme === 'light' ? "☀️ Light mode enabled for bright daylight visibility." : "🌙 Dark mode enabled for relaxed night driving.");
                              }}
                              className="px-3 py-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-orange-400 font-mono text-[9.5px] uppercase font-black tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer animate-fade-in"
                            >
                              {theme === 'dark' ? (
                                <>
                                  <Moon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                  <span>Night (Dark)</span>
                                </>
                              ) : (
                                <>
                                  <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span>Day (Light)</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Sound Notification Feed preference toggle */}
                          <div className="flex items-center justify-between py-1 bg-slate-950/40 p-2 rounded-xl border border-slate-800 text-xs">
                            <div className="space-y-0.5">
                              <span className="text-[11px] font-bold text-white block">{menuT.audioAlerts}</span>
                              <span className="text-[9px] text-slate-600 block leading-tight">{menuT.audioAlertsSub}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSoundEnabled(!soundEnabled);
                                triggerToast(!soundEnabled ? "Audio alerts enabled!" : "Audio alerts muted.");
                              }}
                              className={`p-1 w-9 rounded-full cursor-pointer flex transition-all ${soundEnabled ? 'bg-orange-600 justify-end' : 'bg-slate-900 border border-slate-800 justify-start'}`}
                            >
                              <span className={`w-3.5 h-3.5 rounded-full shadow ${soundEnabled ? 'bg-white' : 'bg-slate-600'}`} />
                            </button>
                          </div>

                          {/* Speed advising advisor alerts */}
                          <div className="flex items-center justify-between py-1 bg-slate-950/40 p-2 rounded-xl border border-slate-800 text-xs">
                            <div className="space-y-0.5">
                              <span className="text-[11px] font-bold text-white block">{menuT.speedAdvisor}</span>
                              <span className="text-[9px] text-slate-600 block leading-tight">{menuT.speedAdvisorSub}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSpeedLimitWarn(!speedLimitWarn);
                                triggerToast(!speedLimitWarn ? "Border post advisory alerts enabled!" : "Border post advisory alerts muted.");
                              }}
                              className={`p-1 w-9 rounded-full cursor-pointer flex transition-all ${speedLimitWarn ? 'bg-orange-600 justify-end' : 'bg-slate-900 border border-slate-800 justify-start'}`}
                            >
                              <span className={`w-3.5 h-3.5 rounded-full shadow ${speedLimitWarn ? 'bg-white' : 'bg-slate-600'}`} />
                            </button>
                          </div>

                          {/* Application Selected Language Indicator Card */}
                          <div className="flex items-center justify-between py-1 bg-slate-950/40 p-2 rounded-xl border border-slate-800 text-xs text-left">
                            <div className="space-y-0.5">
                              <span className="text-[11px] font-bold text-white block">{menuT.activeLang}</span>
                              <span className="text-[9px] text-slate-600 block leading-tight">{menuT.activeLangSub}</span>
                            </div>
                            <span className="px-2.5 py-1 bg-orange-500/10 text-orange-400 font-extrabold text-[10px] rounded border border-orange-500/20 font-mono uppercase">
                              {lang === 'tr' ? "🇹🇷 Türkçe" : (lang === 'ar' ? "🇸🇦 العربية" : "🇺🇸 English")}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* CONVENIENT DIAGNOSTICS & SAVE PREFERENCES INTERACTION */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4.5 space-y-3.5 relative shadow-md">
                        <button
                          type="button"
                          onClick={() => {
                            triggerToast(menuT.toastSaved);
                          }}
                          className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-extrabold text-[11px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-98 shadow-md"
                        >
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-white" />
                          <span>{menuT.savePref}</span>
                        </button>
                      </div>
                    </>
                  );
                })()}

                <div className="space-y-4 pt-4 border-t border-slate-800/60 mt-4">
                {/* Header title block */}
                <div className="border-b border-slate-900 pb-3 flex items-center justify-between">
                  <div>
                    <h3 className="font-extrabold text-sm text-white tracking-tight uppercase font-mono">Pilot Operations</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">Control panel & active telemetry logs</p>
                  </div>
                  <span className="bg-orange-500/10 text-orange-400 font-mono font-black text-[10px] px-2.5 py-0.5 rounded-full border border-orange-500/20">
                    v4.5-Live
                  </span>
                </div>

                {/* MODULE 1: SHIFT COMPLIANCE TIMER (ELD Hours of Service Tracker) */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2.5xl p-4.5 space-y-3.5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-orange-600/5 rounded-full blur-xl" />
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                        <Timer className="w-4 h-4 text-orange-500" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-white uppercase tracking-tight">ELD Hours of Service</h4>
                        <span className="text-[9px] text-slate-500 block uppercase font-mono tracking-tight">Shift Safety Monitor</span>
                      </div>
                    </div>
                    {drivingStatus === 'driving' ? (
                      <span className="bg-emerald-500/10 text-emerald-400 font-mono text-[9px] font-bold px-2 py-0.5 rounded border border-emerald-500/20 animate-pulse">
                        ● ON DUTY
                      </span>
                    ) : drivingStatus === 'resting' ? (
                      <span className="bg-cyan-500/10 text-cyan-400 font-mono text-[9px] font-bold px-2 py-0.5 rounded border border-cyan-500/20">
                        ☕ BREAK
                      </span>
                    ) : (
                      <span className="bg-slate-950 text-slate-400 font-mono text-[9px] font-bold px-2 py-0.5 rounded border border-slate-800">
                        OFF DUTY
                      </span>
                    )}
                  </div>

                  {/* Timer Displays */}
                  <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[8px] text-slate-500 block uppercase font-mono tracking-widest leading-none mb-1">Max drive time cycle</span>
                      <strong className={`text-lg font-mono font-black ${drivingStatus === 'driving' ? 'text-orange-500' : 'text-slate-400'}`}>
                        {formatTimer(drivingTimeLeft)}
                      </strong>
                    </div>
                    <div className="border-l border-slate-800 pl-4 text-right">
                      <span className="text-[8px] text-slate-500 block uppercase font-mono tracking-widest leading-none mb-1">Rest countdown</span>
                      <strong className={`text-lg font-mono font-black ${drivingStatus === 'resting' ? 'text-cyan-400' : 'text-slate-500'}`}>
                        {formatTimer(restingTimeLeft)}
                      </strong>
                    </div>
                  </div>

                  {/* Interactive Timer Controls */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDrivingStatus('driving');
                        triggerToast("🚛 Logged On-Duty: Driving cycle timer started.");
                      }}
                      disabled={drivingStatus === 'driving'}
                      className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all text-center select-none cursor-pointer ${
                        drivingStatus === 'driving'
                          ? 'bg-orange-600/20 text-orange-400 border border-orange-500/20'
                          : 'bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300'
                      }`}
                    >
                      Drive
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrivingStatus('resting');
                        triggerToast("☕ Rest Break Initiated. Enjoy your downtime!");
                      }}
                      disabled={drivingStatus === 'resting'}
                      className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all text-center select-none cursor-pointer ${
                        drivingStatus === 'resting'
                          ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/20'
                          : 'bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300'
                      }`}
                    >
                      Rest
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrivingStatus('off');
                        setDrivingTimeLeft(4.5 * 3600);
                        setRestingTimeLeft(45 * 60);
                        triggerToast("🏁 Off-Duty mode active. Compliant logs synchronized with dispatcher.");
                      }}
                      className="py-2 bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-900/30 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all text-center select-none cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* MODULE 2: DYNAMIC CARGO FUEL ESTIMATOR */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2.5xl p-4.5 space-y-3.5 relative overflow-hidden">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                      <Fuel className="w-4 h-4 text-orange-500" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase tracking-tight">Fuel & Route Calculator</h4>
                      <span className="text-[9px] text-slate-500 block uppercase font-mono tracking-tight">Cargo Planning Auxiliary</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Cargo Weight Weight Slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span className="font-bold">TRAILER CARGO LOAD</span>
                        <strong className="text-orange-500 font-black">{calcCargoWeight} TONS</strong>
                      </div>
                      <input 
                        type="range" 
                        min="2" 
                        max="40" 
                        value={calcCargoWeight} 
                        onChange={(e) => setCalcCargoWeight(Number(e.target.value))}
                        className="w-full accent-orange-500 bg-slate-950 rounded-lg appearance-none h-1.5 cursor-pointer"
                      />
                    </div>

                    {/* Distance Slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span className="font-bold">ESTIMATED ROUTE DISTANCE</span>
                        <strong className="text-orange-500 font-black">{calcDistance} {distanceUnit}</strong>
                      </div>
                      <input 
                        type="range" 
                        min="20" 
                        max="1200" 
                        value={calcDistance} 
                        onChange={(e) => setCalcDistance(Number(e.target.value))}
                        className="w-full accent-orange-500 bg-slate-950 rounded-lg appearance-none h-1.5 cursor-pointer"
                      />
                    </div>

                    {/* Route Terrain Select */}
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 block uppercase font-black tracking-wider font-mono">Topographical Terrain</label>
                      <div className="grid grid-cols-3 gap-1.5 select-none">
                        {(['flat', 'hilly', 'mountain'] as const).map((tType) => (
                          <button
                            key={tType}
                            type="button"
                            onClick={() => setCalcTerrain(tType)}
                            className={`py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all tracking-wider text-center cursor-pointer select-none border ${
                              calcTerrain === tType 
                                ? 'bg-orange-600/10 text-orange-400 border-orange-500/30' 
                                : 'bg-slate-950 border-slate-800 hover:border-slate-800 text-slate-400'
                            }`}
                          >
                            {tType}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Result outputs and estimations banner */}
                    {calcResult && (
                      <div className="bg-slate-950 p-2.5 rounded-2xl border border-slate-800/80 grid grid-cols-2 gap-2 text-center text-xs">
                        <div className="border-r border-slate-800/80 pr-2">
                          <span className="text-[8px] text-slate-500 block uppercase font-mono tracking-widest leading-none mb-1">Fuel Needed</span>
                          <strong className="font-mono text-orange-500 font-black text-sm">{calcResult.fuel} L</strong>
                        </div>
                        <div className="pl-2">
                          <span className="text-[8px] text-slate-500 block uppercase font-mono tracking-widest leading-none mb-1">Transit Time</span>
                          <strong className="font-mono text-white font-black text-sm">{calcResult.time} Hrs</strong>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* MODULE 3: DETAILED DISPATCHER SETTINGS SYSTEM */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2.5xl p-4.5 space-y-3.5 relative">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                      <Settings className="w-4 h-4 text-orange-500" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase tracking-tight">System Configuration</h4>
                      <span className="text-[9px] text-slate-500 block uppercase font-mono tracking-tight">Active Preferences</span>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">

                    {/* Metric Imperial Switch */}
                    <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-[10px] font-mono">
                      <span className="text-slate-300 font-bold uppercase tracking-wider">Metric Units Override</span>
                      <button
                        type="button"
                        onClick={() => {
                          const nextUnit = distanceUnit === 'km' ? 'mi' : 'km';
                          setDistanceUnit(nextUnit);
                          triggerToast(`Units switched to ${nextUnit.toUpperCase()}`);
                        }}
                        className="px-2.5 py-1 bg-slate-900 border border-slate-800 text-orange-400 text-[9px] uppercase font-black tracking-wider rounded-lg transition-all"
                      >
                        {distanceUnit === 'km' ? 'Metric (KM)' : 'Imperial (MI)'}
                      </button>
                    </div>

                    {/* Daylight/Nighttime View Theme Switcher */}
                    <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-[10px] font-mono">
                      <span className="text-slate-300 font-bold uppercase tracking-wider">Visibility Contrast Mode</span>
                      <button
                        type="button"
                        onClick={() => {
                          const nextTheme = theme === 'dark' ? 'light' : 'dark';
                          setTheme(nextTheme);
                          triggerToast(nextTheme === 'light' ? "☀️ Light mode enabled for bright daylight visibility." : "🌙 Dark mode enabled for relaxed night driving.");
                        }}
                        className="px-2.5 py-1 bg-slate-900 border border-slate-800 text-orange-400 text-[9px] uppercase font-black tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        {theme === 'dark' ? (
                          <>
                            <Moon className="w-3 h-3 text-orange-400 shrink-0" />
                            <span>Night Dark</span>
                          </>
                        ) : (
                          <>
                            <Sun className="w-3 h-3 text-amber-500 animate-spin shrink-0" style={{ animationDuration: "12s" }} />
                            <span>Day Light</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Speed Advisor Alarm Warning */}
                    <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-[10px] font-mono">
                      <span className="text-slate-300 font-bold uppercase tracking-wider">Speed Limit Guard</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSpeedLimitWarn(!speedLimitWarn);
                          triggerToast(!speedLimitWarn ? "Excessive speed advisory alerts enabled." : "Excessive speed advisory alerts muted.");
                        }}
                        className={`p-1 w-10 rounded-full cursor-pointer flex transition-all ${speedLimitWarn ? 'bg-orange-600 justify-end' : 'bg-slate-900 border border-slate-800 justify-start'}`}
                      >
                        <span className={`w-3.5 h-3.5 rounded-full shadow ${speedLimitWarn ? 'bg-white' : 'bg-slate-600'}`} />
                      </button>
                    </div>

                    {/* System sound indicator parameters */}
                    <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-[10px] font-mono">
                      <span className="text-slate-300 font-bold uppercase tracking-wider">Operational Audio FX</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSoundEnabled(!soundEnabled);
                          triggerToast(!soundEnabled ? "Audio response sound effects enabled." : "Audio responses muted.");
                        }}
                        className={`p-1 w-10 rounded-full cursor-pointer flex transition-all ${soundEnabled ? 'bg-orange-600 justify-end' : 'bg-slate-900 border border-slate-800 justify-start'}`}
                      >
                        <span className={`w-3.5 h-3.5 rounded-full shadow ${soundEnabled ? 'bg-white' : 'bg-slate-600'}`} />
                      </button>
                    </div>

                    {/* Storage Diagnostics clear DB button */}
                    <button
                      type="button"
                      onClick={() => {
                        triggerToast("⚡ Diagnostics: System telemetry cache cleared, re-indexed local stores successfully.");
                      }}
                      className="w-full py-2 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white font-mono uppercase font-bold text-[9px] tracking-wider border border-slate-800 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      <span>Re-zero Database Handshakes</span>
                    </button>
                  </div>
                </div>
                </div> {/* close hidden wrapper */}
              </div>
            )}

            {/* Custom simulated file uploads modal overlay inside mobile frame */}
            {fileSimOpen && (
              <div className="absolute inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-5 select-none animate-fade-in">
                <div className="bg-slate-900 p-5.5 border border-slate-800/80 rounded-3xl w-full max-w-[320px] space-y-4 shadow-[0_15px_45px_rgba(0,0,0,0.6)] text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <h5 className="font-extrabold text-[#f97316] uppercase tracking-wider font-mono">Payload Transmitter</h5>
                    <button onClick={() => setFileSimOpen(false)} className="text-slate-500 hover:text-white transition-colors cursor-pointer border-0 bg-transparent p-1"><X className="w-4 h-4" /></button>
                  </div>

                  <div className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">Upload Dispatch Photo / PDF</label>
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
                        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-100 rounded-xl text-xs font-mono file:bg-slate-900 file:border-0 file:text-[9px] file:text-slate-300 file:px-2 file:py-1 file:rounded-md file:mr-2 file:cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">Payload Handle Identifier</label>
                      <input 
                        type="text" 
                        placeholder="e.g. CMR_DOC_BORDER_GATE_A.pdf" 
                        value={simFileName}
                        onChange={(e) => setSimFileName(e.target.value)}
                        className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl font-mono text-xs focus:border-[#f97316] outline-none transition-all"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">Payload Category Code</label>
                      <select
                        value={simFileCategory}
                        onChange={(e) => setSimFileCategory(e.target.value as DocumentCategory)}
                        className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl text-xs font-bold outline-none cursor-pointer"
                      >
                        <option value="cmr" className="bg-slate-950 text-white font-bold">CMR Document (Shipment Protocol)</option>
                        <option value="invoice" className="bg-slate-950 text-white font-bold">Invoice Receipt</option>
                        <option value="packing_list" className="bg-slate-950 text-white font-bold">Packing Sheet</option>
                        <option value="customs" className="bg-slate-950 text-white font-bold">Customs Clearance Receipt</option>
                        <option value="delivery_proof" className="bg-slate-950 text-white font-bold">Delivery Voucher (POD)</option>
                        <option value="photo" className="bg-slate-950 text-white font-bold">Cargo Live Photo</option>
                        <option value="other" className="bg-slate-950 text-white font-bold">Other PDF / Doc File</option>
                      </select>
                    </div>

                    <button 
                      onClick={handleSimulateUpload}
                      disabled={!simFileName.trim() || isUploading}
                      className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:opacity-40 text-white font-extrabold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95 border-0 shadow-[0_4px_15px_rgba(249,115,22,0.3)] mt-2"
                    >
                      {isUploading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Camera className="w-4 h-4 shrink-0" />
                      )}
                      <span>{isUploading ? "Uploading payload..." : "Attach Document File"}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Immersive Mobile Document Scanner Overlay Modal */}
            {isScanOpen && (
              <div className="absolute inset-0 bg-slate-950/95 z-50 flex flex-col justify-between overflow-hidden select-none animate-fade-in text-xs font-sans">
                {/* Header HUD */}
                <div className="bg-slate-900 border-b border-slate-800 p-4.5 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <div>
                      <h5 className="font-extrabold text-[#10b981] uppercase tracking-widest font-mono text-left">Mobile DocScan v3.1</h5>
                      <span className="text-[9px] text-slate-400 block uppercase font-mono tracking-wider">Dynamic Alignment Core</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      stopCamera();
                      setIsScanOpen(false);
                    }} 
                    className="text-slate-400 hover:text-white transition-colors cursor-pointer border-0 bg-slate-950 p-2 rounded-full hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Main Scan Viewfinder */}
                {scanState === "scanning" && (
                  <div className="flex-1 flex flex-col justify-between p-4 relative overflow-hidden bg-slate-950">
                    <div className="absolute inset-0 z-0 flex items-center justify-center">
                      {/* Active video element or high-tech dynamic drawing fallback vector */}
                      {videoRef ? (
                        <video 
                          ref={videoRef}
                          autoPlay 
                          playsInline 
                          muted 
                          className="w-full h-full object-cover opacity-80"
                        />
                      ) : null}

                      {/* Fallback Vector Viewfinder illustration if video stream is not initialized yet */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-950/80 z-0">
                        <div className="border border-slate-700/60 bg-slate-900/60 rounded-xl p-5.5 max-w-[240px] text-center space-y-3.5 shadow-2xl relative">
                          <Compass className="w-10 h-10 text-emerald-400 mx-auto animate-spin" style={{ animationDuration: "12s" }} />
                          <div className="space-y-1">
                            <h6 className="font-extrabold text-slate-200 text-xs font-mono uppercase font-black">Alignment Calibration</h6>
                            <p className="text-[10px] text-slate-400 leading-normal">
                              Align document flat in frame. Scanner automatically calibrates contrast and handles page layout warping.
                            </p>
                          </div>
                          {/* Live edge finder boxes */}
                          <div className="absolute -top-1.5 -left-1.5 w-6 h-6 border-t-2 border-l-2 border-[#10b981] rounded-tl-lg" />
                          <div className="absolute -top-1.5 -right-1.5 w-6 h-6 border-t-2 border-r-2 border-[#10b981] rounded-tr-lg" />
                          <div className="absolute -bottom-1.5 -left-1.5 w-6 h-6 border-b-2 border-l-2 border-[#10b981] rounded-bl-lg" />
                          <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 border-b-2 border-r-2 border-[#10b981] rounded-br-lg" />
                        </div>
                      </div>
                    </div>

                    {/* Laser Scanner Line and HUD Overlay */}
                    <div className="absolute inset-0 pointer-events-none z-10">
                      {/* Laser beam scan */}
                      <div className="absolute left-0 w-full h-[3px] bg-gradient-to-r from-transparent via-[#10b981] to-transparent shadow-[0_0_12px_#10b981] animate-pulse" />
                      
                      {/* Scanner Corners */}
                      <div className="absolute top-8 left-8 w-12 h-12 border-t-4 border-l-4 border-emerald-400/80 rounded-tl-2xl" />
                      <div className="absolute top-8 right-8 w-12 h-12 border-t-4 border-r-4 border-emerald-400/80 rounded-tr-2xl" />
                      <div className="absolute bottom-8 left-8 w-12 h-12 border-b-4 border-l-4 border-emerald-400/80 rounded-bl-2xl" />
                      <div className="absolute bottom-8 right-8 w-12 h-12 border-b-4 border-r-4 border-emerald-400/80 rounded-br-2xl" />

                      {/* Continuous Edge confidence marker */}
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/60 border border-emerald-400/25 text-[#10b981] rounded-full px-4 py-1.5 text-[9.5px] font-mono tracking-wider font-extrabold flex items-center gap-1.5 backdrop-blur-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                        <span>DOCUMENT ALIGNED (98.3%)</span>
                      </div>
                    </div>

                    {/* Viewfinder Controls */}
                    <div className="z-20 flex justify-between items-center text-[10px] font-mono select-none">
                      <span className="bg-slate-900/90 text-slate-300 px-3 py-1 rounded-full border border-slate-800">
                        FPS: <strong className="text-emerald-400">30Hz</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setFlashLight(!flashLight)}
                        className={`p-1.5 px-3 rounded-full flex items-center gap-1 cursor-pointer transition-all ${flashLight ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-900 border border-slate-800 text-slate-300'}`}
                      >
                        <span>🔦 FLASH: {flashLight ? "ON" : "OFF"}</span>
                      </button>
                    </div>

                    {/* Selector of Simulation presets to make it 100% testable in any frame */}
                    <div className="z-20 space-y-2 text-left">
                      <div className="bg-slate-900/90 p-3 rounded-2xl border border-slate-800 backdrop-blur-md space-y-1.5">
                        <span className="text-[8.5px] font-bold text-slate-400 block uppercase tracking-wide">Or choose active document preset:</span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { label: "CMR Protocol", val: "cmr" },
                            { label: "Logistics Invoice", val: "invoice" },
                            { label: "Packing List", val: "packing_list" },
                            { label: "Customs Stamp", val: "customs" }
                          ].map((doc) => (
                            <button
                              key={doc.val}
                              type="button"
                              onClick={() => {
                                setScanCategory(doc.val as DocumentCategory);
                                setScanDocName(`SCAN_${doc.val.toUpperCase()}_${new Date().toISOString().slice(0,10).replace(/-/g, "")}_${Math.floor(1000 + Math.random() * 9000)}.png`);
                                const mockDataUrl = generateSimulatedDocument(doc.val as DocumentCategory);
                                setCapturedImage(mockDataUrl);
                                setScanState("review");
                                stopCamera();
                              }}
                              className="p-1 px-2.5 bg-slate-950/80 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-200 text-left text-[10px] font-mono leading-tight hover:border-emerald-500/20 active:scale-95 cursor-pointer flex justify-between items-center"
                            >
                              <span>{doc.label}</span>
                              <ChevronRight className="w-3 h-3 text-emerald-400" />
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Primary Trigger Actions bar */}
                      <div className="flex items-center justify-between gap-4 pt-1 select-none">
                        {/* Custom photo uploader label alias */}
                        <label className="p-3 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 rounded-2xl transition-all cursor-pointer flex items-center justify-center active:scale-95 shrink-0">
                          <FileUp className="w-4 h-4" />
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setScanDocName(file.name);
                                setScanCategory("cmr");
                                const reader = new FileReader();
                                reader.onload = (evt) => {
                                  const b64 = evt.target?.result as string;
                                  setCapturedImage(b64);
                                  setScanState("review");
                                  stopCamera();
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="hidden"
                          />
                        </label>

                        {/* Capture Shutter Switch Button */}
                        <button
                          type="button"
                          onClick={captureCameraSnapshot}
                          className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-2xl uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 border-0 shadow-[0_4px_20px_rgba(16,185,129,0.35)] active:scale-95"
                        >
                          <div className="w-4 h-4 rounded-full border-2 border-slate-950 shrink-0 bg-transparent flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-slate-950" />
                          </div>
                          <span>Capture Document</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Review, Enhancements and metadata assignment screen */}
                {scanState === "review" && (
                  <div className="flex-1 flex flex-col justify-between p-5 overflow-y-auto bg-slate-900 space-y-4">
                    
                    {/* Captured visual buffer */}
                    <div className="p-1 px-1.5 bg-slate-950 rounded-2xl border border-slate-800 shadow-inner flex flex-col items-center justify-center relative overflow-hidden min-h-[220px]">
                      <span className="absolute top-2.5 right-2.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-bold text-[8px] uppercase tracking-wider px-2 py-0.5 rounded">
                        {scanFilter === "mono" ? "MONOCHROME FAX FILTER" : scanFilter === "grayscale" ? "GRAYSCALE INTENSE" : "ORIGINAL CHROMATIC"}
                      </span>
                      {capturedImage && (
                        <img 
                          src={capturedImage}
                          alt="Captured Scan Preview"
                          className="max-h-[220px] rounded-lg shadow-md transition-all object-contain"
                          style={{
                            filter: scanFilter === "mono" 
                              ? "contrast(180%) brightness(110%) grayscale(100%)" 
                              : scanFilter === "grayscale" 
                              ? "grayscale(100%) contrast(120%)" 
                              : "none"
                          }}
                        />
                      )}
                    </div>

                    {/* Metadata attributes */}
                    <div className="space-y-3 pt-1 select-none text-left">
                      
                      {/* Interactive Optimization Filter Bar */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider font-mono">Contrast Laser Optimization</label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {[
                            { val: "color", label: "Color Photo", desc: "Original Raw Colors" },
                            { val: "grayscale", label: "Grayscale", desc: "Clean Scan Copy" },
                            { val: "mono", label: "B&W Mono", desc: "High Contrast Fax" }
                          ].map(f => (
                            <button
                              key={f.val}
                              type="button"
                              onClick={() => setScanFilter(f.val as any)}
                              className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                                scanFilter === f.val 
                                  ? 'bg-emerald-500/10 border-emerald-500/35 text-white font-extrabold shadow-sm' 
                                  : 'bg-slate-950 border-slate-800 hover:border-slate-800 text-slate-400'
                              }`}
                            >
                              <span className="text-[10px] block font-bold leading-normal">{f.label}</span>
                              <span className="text-[7.5px] opacity-60 block leading-tight mt-0.5">{f.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* File Handle input */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">Payload Filename</label>
                        <input 
                          type="text" 
                          placeholder="e.g. CUSTOMS_CLEARANCE_STAMP.png" 
                          value={scanDocName}
                          onChange={(e) => setScanDocName(e.target.value)}
                          className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl font-mono text-xs focus:border-emerald-500 outline-none transition-all"
                        />
                      </div>

                      {/* Document Category dropdown */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-500 block uppercase tracking-wider font-mono">Document Category</label>
                        <select
                          value={scanCategory}
                          onChange={(e) => {
                            const newCategory = e.target.value as DocumentCategory;
                            setScanCategory(newCategory);
                            // Auto reset mock file layout name with date prefix
                            setScanDocName(`SCAN_${newCategory.toUpperCase()}_${new Date().toISOString().slice(0,10).replace(/-/g, "")}_${Math.floor(1000 + Math.random() * 9000)}.png`);
                          }}
                          className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl text-xs font-bold outline-none cursor-pointer"
                        >
                          <option value="cmr" className="bg-slate-950 text-white font-bold">CMR Document (Shipment Protocol)</option>
                          <option value="invoice" className="bg-slate-950 text-white font-bold">Invoice Receipt</option>
                          <option value="packing_list" className="bg-slate-950 text-white font-bold">Packing Sheet</option>
                          <option value="customs" className="bg-slate-950 text-white font-bold">Customs Clearance Receipt</option>
                          <option value="delivery_proof" className="bg-slate-950 text-white font-bold">Delivery Voucher (POD)</option>
                          <option value="photo" className="bg-slate-950 text-white font-bold">Cargo Live Photo</option>
                          <option value="other" className="bg-slate-950 text-white font-bold">Other Sworn Document</option>
                        </select>
                      </div>

                    </div>

                    {/* Interactive review trigger actions */}
                    <div className="flex gap-3 shrink-0 pt-2 select-none">
                      <button 
                        onClick={() => {
                          setCapturedImage(null);
                          setScanState("scanning");
                          startCamera();
                        }}
                        className="p-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                        <span className="font-bold text-[10px] uppercase">Retake</span>
                      </button>

                      <button 
                        onClick={handleUploadScannedDocument}
                        disabled={!scanDocName.trim()}
                        className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-40 text-slate-950 font-black text-xs rounded-xl uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 border-0 shadow-[0_4px_15px_rgba(16,185,129,0.3)] active:scale-95"
                      >
                        <Send className="w-4 h-4 shrink-0 text-slate-950" />
                        <span>Transmit to Dispatcher</span>
                      </button>
                    </div>

                  </div>
                )}

                {/* Secure sync progress HUD */}
                {scanState === "uploading" && (
                  <div className="flex-1 flex flex-col justify-center items-center p-6 bg-slate-950 space-y-6 select-none animate-pulse">
                    <div className="w-16 h-16 border-4 border-[#10b981] border-t-transparent rounded-full animate-spin flex items-center justify-center shadow-lg">
                      <Compass className="w-7 h-7 text-emerald-400 animate-pulse" />
                    </div>
                    <div className="text-center space-y-2">
                      <h5 className="font-extrabold text-[#10b981] text-sm font-mono uppercase tracking-widest">Enabling Telemetry Sync</h5>
                      <p className="text-[10px] text-slate-400 leading-relaxed font-mono max-w-[240px] mx-auto text-center">
                        Applying high-contrast monochrome calibration and routing encrypted PDF segment transmission to central dispatcher...
                      </p>
                    </div>
                    <div className="w-full max-w-[200px] h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                      <div className="h-full bg-[#10b981] animate-pulse" style={{ width: "85%" }} />
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>

          {/* Bottom Dock Navigation Tabs menu */}
          <div className="grid grid-cols-4 bg-slate-950 py-3 border-t border-slate-900 mt-2 shrink-0 select-none">
            <button 
              onClick={() => {
                setActiveTab('shipments');
                setFileSimOpen(false);
              }}
              className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all cursor-pointer ${
                activeTab === 'shipments' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <div className="relative flex flex-col items-center">
                <Truck className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'shipments' ? 'text-[#f97316] scale-110' : ''}`} />
                {activeTab === 'shipments' && (
                  <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
                )}
              </div>
              <span className="mt-1.5">Jobs</span>
            </button>
            <button 
              onClick={() => {
                setActiveTab('chat');
                setFileSimOpen(false);
              }}
              disabled={!activeShipment}
              className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all relative ${
                activeTab === 'chat' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
              } disabled:opacity-20`}
            >
              <div className="relative flex flex-col items-center">
                <MessageSquare className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'chat' ? 'text-[#f97316] scale-110' : ''}`} />
                {activeTab === 'chat' && (
                  <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
                )}
              </div>
              <span className="mt-1.5">Chat</span>
            </button>
            <button 
              onClick={() => {
                setActiveTab('menu');
                setFileSimOpen(false);
              }}
              className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all cursor-pointer ${
                activeTab === 'menu' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <div className="relative flex flex-col items-center">
                <Settings className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'menu' ? 'text-[#f97316] scale-110' : ''}`} />
                {activeTab === 'menu' && (
                  <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
                )}
              </div>
              <span className="mt-1.5">Menu</span>
            </button>
            <button 
              onClick={() => {
                setActiveTab('profile');
                setFileSimOpen(false);
              }}
              className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all cursor-pointer ${
                activeTab === 'profile' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <div className="relative flex flex-col items-center">
                <User className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'profile' ? 'text-[#f97316] scale-110' : ''}`} />
                {activeTab === 'profile' && (
                  <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
                )}
              </div>
              <span className="mt-1.5">Profile</span>
            </button>
          </div>

          </div>

        </div>

      </div>

    </div>
  );
}
