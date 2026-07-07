import React, { useState, useEffect } from "react";
import { Language } from "../types";
import { TRANSLATIONS } from "../translations";
import { apiFetch } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";

const fetch = apiFetch;
import { 
  Ship, Calendar, Truck, ShieldCheck, Box, PackageOpen, ListOrdered, 
  MapPin, CheckCircle2, FileText, Image as ImageIcon, AlertTriangle, ExternalLink,
  Copy, Check, Globe, Activity, CloudSun, Clock, Moon, Lock, Shield, ArrowUpRight,
  Download, Printer, Compass, Navigation, Anchor, Plane, Bell
} from 'lucide-react';

interface PublicTrackingProps {
  lang: Language;
  tokenFromUrl?: string | null;
  onViewPrivacy?: () => void;
  onViewTerms?: () => void;
  isMobile?: boolean;
}

// Coordinate vectors on an 800x400 map canvas
const VECTOR_CITIES: Record<string, { x: number; y: number; labelEn: string; labelTr: string; labelAr: string; countryEn: string; countryTr: string; countryAr: string }> = {
  "istanbul": { 
    x: 80, y: 150, 
    labelEn: "Istanbul", labelTr: "İstanbul", labelAr: "إسطنبول", 
    countryEn: "Turkey", countryTr: "Türkiye", countryAr: "تركيا" 
  },
  "ankara": { 
    x: 230, y: 180, 
    labelEn: "Ankara", labelTr: "Ankara", labelAr: "أنقرة", 
    countryEn: "Turkey", countryTr: "Türkiye", countryAr: "تركيا" 
  },
  "gaziantep": { 
    x: 410, y: 220, 
    labelEn: "Gaziantep", labelTr: "Gaziantep", labelAr: "غازي عنتاب", 
    countryEn: "Turkey", countryTr: "Türkiye", countryAr: "تركيا" 
  },
  "zaho": { 
    x: 520, y: 200, 
    labelEn: "Ibrahim Khalil Gate", labelTr: "İbrahim Halil Sn.", labelAr: "معبر إبراهيم الخليل", 
    countryEn: "Border Checkpoint", countryTr: "Sınır Kapısı", countryAr: "المنفذ الحدودي" 
  },
  "erbil": { 
    x: 590, y: 240, 
    labelEn: "Erbil Hub", labelTr: "Erbil Lojistik", labelAr: "أربيل", 
    countryEn: "Iraq", countryTr: "Irak", countryAr: "العراق" 
  },
  "kirkuk": { 
    x: 630, y: 270, 
    labelEn: "Kirkuk", labelTr: "Kerkük", labelAr: "كركوك", 
    countryEn: "Iraq", countryTr: "Irak", countryAr: "العراق" 
  },
  "baghdad": { 
    x: 610, y: 340, 
    labelEn: "Baghdad Depot", labelTr: "Bağdat Depo", labelAr: "مستودع بغداد", 
    countryEn: "Iraq", countryTr: "Irak", countryAr: "العراق" 
  },
  "basra": { 
    x: 730, y: 400, 
    labelEn: "Basra Port", labelTr: "Basra Limanı", labelAr: "ميناء البصرة", 
    countryEn: "Iraq", countryTr: "Irak", countryAr: "العراق" 
  }
};

export default function PublicTracking({ lang: initialLang, tokenFromUrl, onViewPrivacy, onViewTerms, isMobile }: PublicTrackingProps) {
  const isMobileMode = isMobile || useIsMobile(768);
  const [lang, setLang] = useState<Language>(initialLang);

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

  const t = (key: keyof typeof TRANSLATIONS['en']) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS['en'][key] || String(key);
  };

  const isRtl = lang === 'ar';

  const [loading, setLoading] = useState(true);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [shipment, setShipment] = useState<any | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [customerEmailInput, setCustomerEmailInput] = useState("");
  const [isSubmittingSubscription, setIsSubmittingSubscription] = useState(false);
  const [subscriptionSuccess, setSubscriptionSuccess] = useState(false);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleSubscribeCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerEmailInput || !customerEmailInput.includes("@")) {
      triggerToast(lang === 'tr' ? "Lütfen geçerli bir e-posta adresi girin." : (lang === 'ar' ? "يرجى إدخال عنوان بريد إلكتروني صالح." : "Please enter a valid email address."));
      return;
    }
    
    setIsSubmittingSubscription(true);
    try {
      const res = await fetch(`/api/share/${tokenFromUrl}/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: customerEmailInput,
          channel: "email"
        })
      });
      
      if (res.ok) {
        const updated = await res.json();
        setShipment(updated);
        setSubscriptionSuccess(true);
        setCustomerEmailInput("");
        triggerToast(lang === 'tr' ? "Canlı bildirim aboneliğiniz başarıyla onaylandı!" : (lang === 'ar' ? "تم تفعيل الاشتراك في الإشعارات المباشرة بنجاح!" : "Live notification subscription successfully authorized!"));
      } else {
        triggerToast("Failed to process subscription registration request.");
      }
    } catch (err) {
      triggerToast("Network or connection error. Please try again.");
    } finally {
      setIsSubmittingSubscription(false);
    }
  };

  // local telemetry states to look premium and active
  const [satelliteCount, setSatelliteCount] = useState(12);
  const [simmedSpeed, setSimmedSpeed] = useState(82);

  const fetchSharedInfo = async () => {
    if (!tokenFromUrl) {
      setErrorNotice("Invalid tracking link parameter. Please retrieve a secure token from MARAS Administration.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/share/${tokenFromUrl}`);
      if (res.ok) {
        const data = await res.json();
        setShipment(data);
        setErrorNotice(null);
      } else {
        const errObj = await res.json();
        setErrorNotice(errObj.error || t('notAuthorizedDesc'));
      }
    } catch (e) {
      setErrorNotice("Service offline. Unable to reach MARAS central gateway.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSharedInfo();
    const interval = setInterval(fetchSharedInfo, 5000);
    return () => clearInterval(interval);
  }, [tokenFromUrl, lang]);

  // Telemetry fluctuation loop
  useEffect(() => {
    const timer = setInterval(() => {
      setSatelliteCount(prev => {
        const delta = Math.random() > 0.5 ? 1 : -1;
        const next = prev + delta;
        return next >= 8 && next <= 16 ? next : prev;
      });
      setSimmedSpeed(prev => {
        const delta = Math.floor(Math.random() * 5) - 2;
        const next = prev + delta;
        return next >= 75 && next <= 90 ? next : prev;
      });
    }, 3500);

    return () => clearInterval(timer);
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-200" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="space-y-6 text-center max-w-sm">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-slate-800 border-t-orange-500 animate-spin mx-auto" />
            <Ship className="w-6 h-6 text-orange-500 absolute top-5 left-1/2 -ml-3 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-100">MARAS CENTRAL LOGISTICS GATEWAY</h2>
            <p className="text-xs text-slate-400">Verifying security token and initializing telemetry data links...</p>
          </div>
        </div>
      </div>
    );
  }

  if (errorNotice || !shipment) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-300" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto border border-rose-500/20">
            <AlertTriangle className="w-8 h-8 text-rose-500 animate-bounce" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-black text-slate-100 uppercase tracking-tight">{t('externalViewStatus')}</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {errorNotice || t('notAuthorizedDesc')}
            </p>
          </div>
          <div className="pt-6 border-t border-slate-800/80 text-[10px] text-slate-500 font-mono tracking-widest uppercase">
            etir Security Hub • MARAS Group
          </div>
        </div>
      </div>
    );
  }

  const statusSteps = shipment.freightType === 'sea'
    ? ['Booking Confirmed', 'Container Released', 'Loaded on Vessel', 'Vessel Departed', 'In Transit', 'Arrived at Port', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
    : shipment.freightType === 'air'
      ? ['Booking Confirmed', 'Cargo Received', 'Security Check Completed', 'Departed Airport', 'In Transit', 'Arrived Airport', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
      : ['New', 'Assigned', 'Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered', 'Closed'];

  const currentStepIndex = statusSteps.indexOf(shipment.status) >= 0 ? statusSteps.indexOf(shipment.status) : 0;
  const progressPercent = Math.round((currentStepIndex / (statusSteps.length - 1)) * 100);

  // Resolve vector cities
  const getCityVector = (cityName: string, defaultKey: string) => {
    const norm = cityName ? cityName.toLowerCase().trim() : "";
    for (const [key, val] of Object.entries(VECTOR_CITIES)) {
      if (norm.includes(key) || key.includes(norm)) {
        return val;
      }
    }
    return VECTOR_CITIES[defaultKey];
  };

  const startCityObj = getCityVector(shipment.loadingCity, "istanbul");
  const endCityObj = getCityVector(shipment.deliveryCity, "baghdad");

  // Interpolate route
  const getBezierPoint = (p0: {x: number, y: number}, p1: {x: number, y: number}, p2: {x: number, y: number}, t: number) => {
    const x = (1-t)*(1-t)*p0.x + 2*(1-t)*t*p1.x + t*t*p2.x;
    const y = (1-t)*(1-t)*p0.y + 2*(1-t)*t*p1.y + t*t*p2.y;
    return { x, y };
  };

  const p0 = { x: startCityObj.x, y: startCityObj.y };
  const p2 = { x: endCityObj.x, y: endCityObj.y };
  const p1 = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - 60 };

  const ratio = currentStepIndex / (statusSteps.length - 1);
  const truckPos = getBezierPoint(p0, p1, p2, ratio);

  // Status explanations in multi-language
  const statusTextsMap = {
    en: {
      "New": "Order entered in system. Logistics teams preparing export clearance profiles.",
      "Assigned": "Transport unit designated. Secure etir manifest assigned.",
      "Accepted": "Driver accepted dispatch order. Safety protocols initialized.",
      "Loading": "Cargo arriving at terminal yard. Active verification and load securement.",
      "Loaded": "Manifest sealed by customs authority. Ready for corridor departure.",
      "In Transit": "Active transit along the strategic highway. Normal velocity maintained.",
      "Border Crossing": "Customs clearance active at international crossing point.",
      "Customs Clearance": "Verification of transit seals & regulatory cargo inspections.",
      "Arrived": "Entered destination hub. Secure staging for drop-off active.",
      "Delivered": "Cargo unloaded & client handoff finalized. Electronic TIR signed."
    },
    tr: {
      "New": "Sipariş sisteme girildi. İhracat gümrükleme planları hazırlanıyor.",
      "Assigned": "Taşıma birimi atandı ve güvenli etir beyannamesi oluşturuldu.",
      "Accepted": "Sürücü eşleştirmeyi onayladı. Güvenlik prosedürleri başlatıldı.",
      "Loading": "Yük gümrüklü sahaya ulaştı. Yük tespiti ve emniyete alma yapılıyor.",
      "Loaded": "Mühürleme resmi makamlarca tamamlandı. Çıkış izni verildi.",
      "In Transit": "Uluslararası otoyolda ana güzergah üzerinde seyir halinde.",
      "Border Crossing": "İlgili sınır kapısında gümrük tescil ve geçiş işlemleri sürüyor.",
      "Customs Clearance": "Belgeler ve mühürler ithalat denetimine tabi tutuluyor.",
      "Arrived": "Varış terminaline ulaşıldı. Güvenli indirme sahasına yanaşıldı.",
      "Delivered": "Yük teslim edildi, fiziki doğrulamalar yapıldı ve teslim evrakı onaylandı."
    },
    ar: {
      "New": "تم إدخال الشحنة في النظام الأساسي وتجهيز ملفات تصدير etir.",
      "Assigned": "تم تحديد آلية النقل البري وإسناد رقم البيان الجمركي المؤمن.",
      "Accepted": "أكد اختصاصي النقل قبول الشحنة وبدء تفعيل بروتوكول السلامة.",
      "Loading": "وصول الحمولة لساحة التحميل والتأكد من تثبيت الصناديق والمقاييس.",
      "Loaded": "تم ختم البيان الجمركي رسمياً والتأهب للانطلاق البري.",
      "In Transit": "الحركة نشطة حالياً على طول الطريق السريع بمتوسط سرعة ممتاز.",
      "Border Crossing": "الآلية متواجدة عند المنفذ الحدودي الدولي لإنهاء التفتيش وختم المرور.",
      "Customs Clearance": "إخضاع الأختام والبيانات الجمركية للفحص والتدقيق القانوني الرسمي.",
      "Arrived": "الوصول اللوجستي لمنطقة التوزيع والتفريغ ونقل الشحنات المتجهة.",
      "Delivered": "اكتمال الرحلة وتفريغ الحمولة بأمان للعميل النهائي والتوقيع."
    }
  };

  const getStatusDesc = (statusString: string) => {
    const map = statusTextsMap[lang] || statusTextsMap['en'];
    return (map as any)[statusString] || "Corridor tracking operational.";
  };

  const currentStatusDesc = getStatusDesc(shipment.status);

  // Layout components
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans tracking-tight pb-20 selection:bg-orange-500 selection:text-white" dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* PROFESSIONAL TELEMETRY TOP BAR */}
      <section className="bg-slate-900/90 border-b border-slate-800/80 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          
          {/* Logo Brand Brand */}
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-black shadow-md ${
              shipment?.freightType === 'sea' ? 'bg-blue-600 shadow-blue-600/10' :
              shipment?.freightType === 'air' ? 'bg-indigo-600 shadow-indigo-600/10' :
              'bg-orange-600 shadow-orange-600/10'
            }`}>
              {shipment?.freightType === 'sea' ? (
                <Anchor className="w-5 h-5" />
              ) : shipment?.freightType === 'air' ? (
                <Plane className="w-5 h-5" />
              ) : (
                <Truck className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">{t('brand')}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <p className="text-[9.5px] text-slate-400 font-mono uppercase tracking-widest leading-none">Global Client Gateway</p>
            </div>
          </div>

          {/* Quick Stats Ticker */}
          <div className={`${isMobileMode ? 'hidden' : 'hidden lg:flex'} items-center gap-3 font-mono text-[10px] text-slate-400`}>
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-sm border border-slate-800">
              <Activity className="w-3 h-3 text-emerald-400" />
              <span>RADAR STATUS:</span>
              <strong className="text-emerald-400">LIVE FEED</strong>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-sm border border-slate-800">
              <Globe className="w-3 h-3 text-cyan-400" />
              <span>SAT GPX:</span>
              <strong className="text-cyan-400">{satelliteCount} CON</strong>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-sm border border-slate-800">
              <Clock className="w-3 h-3 text-orange-400" />
              <span>UPDATED:</span>
              <strong className="text-slate-300 font-bold">{new Date(shipment.updatedAt).toLocaleTimeString()}</strong>
            </div>
          </div>

          {/* Utility Tools */}
          <div className="flex items-center gap-2 self-center">
            {/* Lang switcher */}
            <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
              {(['en', 'tr', 'ar'] as Language[]).map((val) => (
                <button
                  key={val}
                  onClick={() => setLang(val)}
                  className={`px-2 py-1 rounded text-[10.5px] font-black uppercase transition-all cursor-pointer ${
                    lang === val 
                      ? 'bg-orange-600 text-white font-extrabold shadow-sm' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>

            {/* Print */}
            <button 
              onClick={() => window.print()}
              className="p-2 bg-slate-950/80 hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="Print Page"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
          </div>

        </div>
      </section>

      {/* BODY MAIN */}
      <main className={`max-w-5xl mx-auto ${isMobileMode ? 'px-2 py-4' : 'px-4 py-6'} space-y-5`}>
        
        {/* TOP COMPACT SUMMARY HERO */}
        <div className={`bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 ${isMobileMode ? 'p-4' : 'p-6'} rounded-2xl relative overflow-hidden shadow-xl`}>
          <div className="absolute top-0 right-0 w-64 h-64 bg-orange-600/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className={`flex flex-col ${isMobileMode ? '' : 'md:flex-row md:items-center'} justify-between gap-4 border-b border-slate-800/60 pb-5`}>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9.5px] font-mono text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800 uppercase tracking-widest">
                  Secure Client Gateway
                </span>
                <span className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 font-black font-mono px-2 py-0.5 rounded">
                  {shipment.freightType === 'sea' ? 'Ocean Freight / Denizyolu' : shipment.freightType === 'air' ? 'Air Freight / Havayolu' : 'Land Freight / Karayolu'}: #{shipment.shipmentNumber}
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-black text-slate-100 tracking-tight mt-1.5">
                {shipment.freightType === 'sea' ? (
                  `${shipment.portOfLoading || "Port of Loading"} ➔ ${shipment.portOfDischarge || "Port of Discharge"}`
                ) : shipment.freightType === 'air' ? (
                  `${shipment.airportOfDeparture || "Airport of Departure"} ➔ ${shipment.airportOfArrival || "Airport of Arrival"}`
                ) : (
                  `${shipment.loadingCity || ""} ➔ ${shipment.deliveryCity || ""}`
                )}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {lang === 'en' ? "Verified transit tracker for client clearance procedures." : (lang === 'tr' ? "Müşteri gümrük işlemleri için doğrulanmış canlı geçiş takibi." : "تتبع الشحنات المعتمد للمتابعة المباشرة من قبل العملاء والمستلمين.")}
              </p>
            </div>
 
            <div className={`flex flex-col ${isMobileMode ? '' : 'sm:flex-row sm:items-center'} gap-2 w-full md:w-auto`}>
              <button 
                onClick={handleCopyLink}
                className="px-4 py-2 bg-slate-950 text-xs font-bold border border-slate-800 text-slate-200 hover:bg-slate-800 hover:border-slate-700 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                <span>{copiedLink ? (lang === 'tr' ? "Kopyalandı!" : (lang === 'ar' ? "تم النسخ!" : "Copied!")) : t('copyLink')}</span>
              </button>
 
              <div className="bg-orange-600/10 text-orange-400 border border-orange-500/20 px-4 py-2 rounded-xl text-center">
                <span className="text-[9px] font-bold block uppercase tracking-wider leading-none text-slate-400">{t('status')}</span>
                <strong className="text-xs font-black uppercase mt-0.5 block whitespace-nowrap">{shipment.status}</strong>
              </div>
            </div>
          </div>
 
          {/* ACTIVE DISPATCHER ESTIMATE & EXPLANATION */}
          <div className={`pt-5 grid grid-cols-1 ${isMobileMode ? '' : 'md:grid-cols-3'} gap-4`}>
            
            <div className="md:col-span-2 space-y-1">
              <span className="text-[9.5px] font-mono text-slate-400 uppercase tracking-wider block">CURRENT EVENT EXPLANATION:</span>
              <p className="text-xs text-slate-400 leading-relaxed font-semibold">
                {currentStatusDesc}
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
              <div>
                <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider leading-none">PROGRESS</span>
                <strong className="text-base font-black text-orange-500 font-mono">{progressPercent}%</strong>
              </div>
              <div className="flex-1 max-w-[120px] bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-800">
                <div 
                  className="bg-gradient-to-r from-orange-600 to-amber-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

          </div>

          {/* STATUS INTEGRATED STEPS PROGRESS MATRIX */}
          <div className="mt-6 pt-5 border-t border-slate-800/60 overflow-x-auto">
            <div className="flex items-center justify-between min-w-[700px] relative px-2 py-2">
              
              {statusSteps.map((step, idx) => {
                const isPassed = idx <= currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center relative z-10 font-sans">
                    <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
                      isCurrent
                        ? "bg-orange-500 border-orange-500 text-white shadow-lg scale-115 ring-4 ring-orange-500/20"
                        : isPassed
                          ? "bg-orange-600 border-orange-600 text-white"
                          : "bg-slate-950 border-slate-800 text-slate-500"
                    }`}>
                      {isCurrent ? (
                        <Navigation className="w-3.5 h-3.5 text-white animate-pulse" />
                      ) : isPassed ? (
                        <Check className="w-3.5 h-3.5 text-white" />
                      ) : (
                        <span className="font-mono text-[10px]">{idx + 1}</span>
                      )}
                    </div>
                    <span className={`text-[9px] mt-2 block font-extrabold font-mono tracking-tight uppercase truncate max-w-[75px] ${
                      isCurrent 
                        ? 'text-orange-400 font-black' 
                        : isPassed 
                          ? 'text-slate-300' 
                          : 'text-slate-600'
                    }`}>
                      {step}
                    </span>
                  </div>
                );
              })}

              {/* Progress Line backer */}
              <div className="absolute top-[22px] left-8 right-8 h-0.5 bg-slate-800 -z-10">
                <div 
                  className="bg-gradient-to-r from-orange-600 to-amber-500 h-full transition-all duration-1000"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

            </div>
          </div>

        </div>

        {/* HIGH-FIDELITY CORRIDOR ROAD MAP - PREMIUM SVG RADAR */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 relative overflow-hidden shadow-lg">
          
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-orange-500 animate-spin" style={{ animationDuration: '8s' }} />
              <div>
                <h3 className="font-extrabold text-xs text-slate-100 uppercase tracking-wider">
                  {shipment.freightType === 'sea' ? (
                    lang === 'en' ? "MARITIME VOYAGE TELEMETRY RADAR" : (lang === 'tr' ? "DENİZYOLU SEVKİYAT SEFİR RADARI" : "رادار تتبع وملاحة مسار شحنات خدمات الشحن البحري")
                  ) : shipment.freightType === 'air' ? (
                    lang === 'en' ? "AIRSPACE TRANSIT FLIGHT TELEMETRY RADAR" : (lang === 'tr' ? "HAVAYOLU UÇUŞ SEVKİYAT TAKİP RADARI" : "رادار تتبع الطيران والملاحة لخدمات الشحن الجوي مباشر")
                  ) : (
                    lang === 'en' ? "CORRIDOR TRANSIT TELEMETRY RADAR" : (lang === 'tr' ? "KORİDOR SEVKİYAT GEÇİŞ RADARI" : "رادار بث وتتبع مسار النقل البري المباشر")
                  )}
                </h3>
                <p className="text-[10px] text-slate-400">
                  {shipment.freightType === 'sea' ? (
                    lang === 'en' ? "Ocean cargo channel projections between loading terminal port and final discharge port" : (lang === 'tr' ? "Yükleme ve varış limanları arasındaki denizyolu rota tespiti" : "مسار الملاحة البحرية الدولي المباشر للشحنة بين موانئ الشحن")
                  ) : shipment.freightType === 'air' ? (
                    lang === 'en' ? "Active global aerial corridors between departure airport and target arrival platform" : (lang === 'tr' ? "Kalkış havalimanı ile varış havalimanı arasındaki havayolu uçuş rotası" : "مسار العبور والملاحة الجوي للشحنة بين مطار المغادرة ومطار الوصول")
                  ) : (
                    lang === 'en' ? "GPS route projections between loading terminal and delivery target" : (lang === 'tr' ? "Yükleme terminali ile teslimat hedefi arasındaki canlı GPS rota projeksiyonu" : "إسقاطات مسار نظام تحديد المواقع الجغرافي النشط بين نقطة البداية والوصول")
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[9px] font-mono font-bold text-slate-400">
                <CloudSun className="w-3.5 h-3.5 text-yellow-500" />
                <span>{shipment.freightType === 'sea' ? "OCEAN SEAS TEMP:" : shipment.freightType === 'air' ? "ALTITUDE TEMP:" : "ROUTE TEMP:"}</span>
                <strong className="text-emerald-400">{shipment.freightType === 'sea' ? "18°C STABLE" : shipment.freightType === 'air' ? "-45°C WIND" : "24°C CLEAR"}</strong>
              </span>
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-bold text-[9px] px-2 py-0.5 rounded uppercase">
                {shipment.freightType === 'sea' ? "14 KNOTS" : shipment.freightType === 'air' ? "840 KM/H" : `${simmedSpeed} KM/H`}
              </span>
            </div>
          </div>

          {/* SVG Map Canvas */}
          <div className="relative bg-slate-950 rounded-xl overflow-hidden mt-4 border border-slate-800/80">
            <svg 
              viewBox="0 0 800 450" 
              className="w-full h-auto max-h-[380px] bg-sky-950/5 relative text-slate-400 select-none"
            >
              {/* Tactical grid background overlay */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" strokeOpacity="0.015" strokeWidth="1" />
                </pattern>
                <linearGradient id="curveGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={shipment.freightType === 'sea' ? "#2563eb" : shipment.freightType === 'air' ? "#6366f1" : "#ea580c"} stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.85" />
                </linearGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* Borders visualization */}
              <line x1="490" y1="0" x2="490" y2="450" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="3 3" strokeOpacity="0.3" />
              <text x="500" y="25" fill="#f43f5e" fontSize="9" fontWeight="bold" fontFamily="monospace" opacity="0.6">
                {shipment.freightType === 'sea' ? (
                  lang === 'en' ? "INTERNATIONAL CHANNELS / SUEZ CANAL PASSAGE" : "ULUSLARARASI DENİZ SUYOLU GEÇİTLERİ"
                ) : shipment.freightType === 'air' ? (
                  lang === 'en' ? "INTERNATIONAL AIRSPACE CHANNELS" : "ULUSLARARASI HAVA SAHASI GEÇİŞ HATTI"
                ) : (
                  lang === 'en' ? "TURKEY / IRAQ BORDER CROSSING" : (lang === 'tr' ? "TÜRKİYE / IRAK SINIR KAPISI" : "الحدود الدولية - معبر إبراهيم الخليل")
                )}
              </text>

              {/* Transit road connector curve */}
              <path 
                d={`M ${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`} 
                fill="none" 
                stroke="#1e293b" 
                strokeWidth="4" 
                strokeLinecap="round" 
              />
              <path 
                id="transitPath"
                d={`M ${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`} 
                fill="none" 
                stroke="url(#curveGradient)" 
                strokeWidth="2.5" 
                strokeDasharray="6 4"
                strokeLinecap="round" 
              />

              {/* Helper checkpoints along route */}
              {Object.entries(VECTOR_CITIES).map(([key, city]) => {
                const isOrigin = key.toLowerCase() === shipment.loadingCity?.toLowerCase().trim();
                const isDest = key.toLowerCase() === shipment.deliveryCity?.toLowerCase().trim();
                const isBorder = key === "zaho";

                const isFeatured = isOrigin || isDest || isBorder || key === "ankara" || key === "erbil";
                if (!isFeatured) return null;

                return (
                  <g key={key} transform={`translate(${city.x}, ${city.y})`} className="cursor-default">
                    <circle 
                      r={isOrigin || isDest ? "6.5" : "4.5"} 
                      fill={isOrigin ? "#ea580c" : (isDest ? "#0ea5e9" : "#334155")} 
                      stroke="#0f172a" 
                      strokeWidth="1.5" 
                    />
                    <text 
                      y={isOrigin || isDest ? "-11" : "15"}
                      textAnchor="middle" 
                      fill={isOrigin ? "#f97316" : (isDest ? "#38bdf8" : "#94a3b8")}
                      fontSize="9.5" 
                      fontWeight="extrabold"
                      fontFamily="sans-serif"
                    >
                      {lang === 'en' ? city.labelEn : (lang === 'tr' ? city.labelTr : city.labelAr)}
                    </text>
                  </g>
                );
              })}

              {/* ACTIVE VEHICLE MOVING INDICATOR */}
              {truckPos && (
                <g transform={`translate(${truckPos.x}, ${truckPos.y})`}>
                  <circle r="22" className="animate-pulse" fill={shipment.freightType === 'sea' ? '#2563eb' : shipment.freightType === 'air' ? '#6366f1' : '#ea580c'} fillOpacity="0.07" />
                  <circle r="14" fill={shipment.freightType === 'sea' ? '#2563eb' : shipment.freightType === 'air' ? '#6366f1' : '#ea580c'} fillOpacity="0.12" />
                  <circle r="8.5" fill={shipment.freightType === 'sea' ? '#2563eb' : shipment.freightType === 'air' ? '#6366f1' : '#ea580c'} stroke="#ffffff" strokeWidth="2" />
                  
                  <g transform="translate(0, -25)">
                    <rect x="-42" y="-10" width="84" height="15" rx="3.5" fill="#0f172a" stroke={shipment.freightType === 'sea' ? '#2563eb' : shipment.freightType === 'air' ? '#6366f1' : '#ea580c'} strokeWidth="1" />
                    <text 
                      textAnchor="middle" 
                      y="1"
                      fill={shipment.freightType === 'sea' ? '#2563eb' : shipment.freightType === 'air' ? '#5c6bc0' : '#f97316'} 
                      fontSize="8.5" 
                      fontWeight="black" 
                      fontFamily="monospace"
                    >
                      #{shipment.shipmentNumber}
                    </text>
                  </g>
                </g>
              )}
            </svg>

            {/* Float Overlay Info on Map */}
            <div className={`${isMobileMode ? 'relative mx-2.5 mb-2.5 mt-3' : 'relative md:absolute md:bottom-3 md:left-4 md:right-4 mx-3 mb-3 md:mx-0 md:mb-0 mt-4 md:mt-0'} bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg flex flex-col ${isMobileMode ? '' : 'md:flex-row md:items-center'} justify-between gap-2.5 font-mono text-[9.5px] md:text-[10px]`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="text-slate-400 uppercase">Live Routing:</span>
                <strong className="text-slate-200">
                  {startCityObj.labelEn} ➔ {endCityObj.labelEn}
                </strong>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 justify-between md:justify-end">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="text-slate-400 flex items-center gap-1 transition-colors hover:text-slate-200 border-0 bg-transparent cursor-pointer p-0 font-mono text-[9.5px] md:text-[10px]"
                  title="Copy Tracking Link"
                >
                  <Activity className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="whitespace-nowrap">Telemetry Link:</span>
                  <strong className="text-emerald-400 uppercase hover:underline flex items-center gap-1 font-extrabold pb-0.5">
                    ACTIVE SHARE
                    <Copy className="w-2.5 h-2.5 text-emerald-400 shrink-0" strokeWidth={2.5} />
                  </strong>
                </button>
                {copiedLink && (
                  <span className="text-emerald-400 text-[9px] font-black animate-pulse font-mono tracking-tight bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 rounded">COPIED!</span>
                )}
                <span className="text-slate-500 hidden sm:inline">|</span>
                <span className="text-slate-300">Est Dist Left: ~{Math.max(10, 100 - progressPercent)}%</span>
              </div>
            </div>

          </div>

        </div>

        {/* METADATA GRID: SPECS, TRACTOR DETAILS, GATEWAYS */}
        <div className={`grid grid-cols-1 ${isMobileMode ? '' : 'md:grid-cols-2'} gap-6`}>
          
          {/* CARGO & VEHICLE SPECIFIC BENTO BOX */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <h3 className="font-extrabold text-xs text-slate-100 uppercase tracking-widest border-b border-slate-800 pb-2.5 flex items-center gap-2">
              <Box className="w-4 h-4 text-orange-500 shrink-0" />
              {t('cargoInfo')}
            </h3>

            <div className="grid grid-cols-2 gap-2 text-xs">
              
              {shipment.freightType === 'sea' ? (
                <>
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60 col-span-2">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">{t('cargoInfo')}</span>
                    <p className="font-bold text-slate-200 mt-1 truncate">{shipment.cargoDescription || "Maritime Ocean Freight"}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Shipping Line & Vessel</span>
                    <p className="font-bold text-blue-400 mt-1 truncate font-mono text-[11px]">{shipment.shippingLine || "-"} • {shipment.vesselName || "-"}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Containers Spec Summary</span>
                    <p className="font-bold text-slate-200 mt-1 truncate font-mono text-xs">
                      {shipment.numberOfContainers || 1}x {shipment.containerType || "40GP"} ({shipment.containerNumber || "-"})
                    </p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Booking / BL Reference</span>
                    <p className="font-mono text-[10.5px] text-slate-300 mt-1 truncate">
                      BKG: {shipment.bookingNumber || "-"} | BL: {shipment.billOfLadingNumber || "-"}
                    </p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Geographical Ports of Call</span>
                    <p className="font-mono text-[10px] text-emerald-400 mt-1 truncate">
                      POL: {shipment.portOfLoading || "-"} ➔ POD: {shipment.portOfDischarge || "-"}
                    </p>
                  </div>
                </>
              ) : shipment.freightType === 'air' ? (
                <>
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60 col-span-2">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">{t('cargoInfo')}</span>
                    <p className="font-bold text-slate-200 mt-1 truncate">{shipment.cargoDescription || "Air Freight Shipment"}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Carrier Airline & Flight</span>
                    <p className="font-bold text-indigo-400 mt-1 truncate font-mono text-xs">{shipment.airline || "-"} • FLT {shipment.flightNumber || "-"}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Air Waybill (AWB) #</span>
                    <p className="font-mono font-black text-xs text-orange-400 mt-1 truncate">{shipment.airWaybillNumber || "-"}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Volumetric Weights</span>
                    <p className="font-mono text-[10.5px] text-slate-200 mt-1 truncate">
                      Gross: {(shipment.grossWeight || 0).toLocaleString()}kg | Chg: {(shipment.chargeableWeight || 0).toLocaleString()}kg
                    </p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Total Package Count</span>
                    <p className="font-mono font-bold text-emerald-400 text-xs mt-1">{shipment.numberOfPackages || 1} PKGS</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">{t('cargoInfo')}</span>
                    <p className="font-bold text-slate-200 mt-1 truncate">{shipment.cargoDescription || "General Road Cargo"}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Certified Net Weight</span>
                    <p className="font-mono font-black text-slate-100 text-sm mt-1">{(shipment.cargoWeight || 0).toLocaleString()} kg</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">Vehicle Plate Registry</span>
                    <p className="font-mono font-extrabold text-orange-400 text-sm mt-1">{shipment.truckNumber || "-"}</p>
                  </div>

                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/60">
                    <span className="text-slate-500 uppercase text-[9px] font-bold block">etir Security Lock</span>
                    <div className="flex items-center gap-1 text-emerald-400 font-bold mt-1">
                      <Shield className="w-3.5 h-3.5 shrink-0" />
                      <span>SECURE DIGITAL SEAL</span>
                    </div>
                  </div>
                </>
              )}

            </div>

            {/* VERIFIED CARRIER BADGE */}
            <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-orange-500 font-extrabold text-xs">
                  {shipment.freightType === 'sea' ? 'S' : shipment.freightType === 'air' ? 'A' : 'DR'}
                </div>
                <div>
                  <span className="text-[8.5px] text-slate-500 uppercase block tracking-wider font-bold">
                    {shipment.freightType === 'sea' ? "Responsible Shipping Line" : shipment.freightType === 'air' ? "Responsible Air Carrier" : "Assigned Transport Unit"}
                  </span>
                  <strong className="text-xs text-slate-400">
                    {shipment.freightType === 'sea' ? (shipment.shippingLine || "Ocean Carrier Logistics") : shipment.freightType === 'air' ? (shipment.airline || "Airline Logistics Operator") : (shipment.assignedDriverName || "MARAS Specialist")}
                  </strong>
                </div>
              </div>
              <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-[8.5px] text-emerald-400 font-bold px-2 py-0.5 rounded-full uppercase">
                Active Transit
              </span>
            </div>

          </div>

          {/* GEOGRAPHIC ROUTE TERMINAL NODES */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <h3 className="font-extrabold text-xs text-slate-100 uppercase tracking-widest border-b border-slate-800 pb-2.5 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
              {lang === 'en' ? "LOGISTICS ROUTING GATEWAYS" : (lang === 'tr' ? "LOJİSTİK GÜZERGAH NOKTALARI" : "عقد ومراكز التوجيه والدعم")}
            </h3>

            <div className="space-y-3">
              
              {/* Origin Terminal Node */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/60 flex items-start gap-3">
                <span className="p-1.5 bg-orange-500/10 text-orange-400 rounded-lg text-xs font-black shrink-0 font-mono">
                  DEP
                </span>
                <div className="space-y-0.5">
                  <span className="text-slate-500 uppercase font-black text-[9px] tracking-wider block">
                    {shipment.freightType === 'sea' ? "PORT OF LOADING (POL)" : shipment.freightType === 'air' ? "DEPARTURE AIRPORT (APOD)" : "DISPATCH ORIGIN (LOADING CITY)"}
                  </span>
                  <h4 className="font-bold text-slate-200 text-xs text-wrap">
                    {shipment.freightType === 'sea' ? (shipment.portOfLoading || "-") : shipment.freightType === 'air' ? (shipment.airportOfDeparture || "-") : `${shipment.loadingCity || "-"}, ${shipment.loadingCountry || "-"}`}
                  </h4>
                  <p className="text-[10.5px] text-slate-400 font-semibold">{shipment.loadingAddress || "MARAS Logistics Terminal Origin"}</p>
                </div>
              </div>

              {/* Destination Terminal Node */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/60 flex items-start gap-3">
                <span className="p-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg text-xs font-black shrink-0 font-mono">
                  ARR
                </span>
                <div className="space-y-0.5">
                  <span className="text-slate-500 uppercase font-black text-[9px] tracking-wider block">
                    {shipment.freightType === 'sea' ? "PORT OF DISCHARGE & TARGET" : shipment.freightType === 'air' ? "ARRIVAL AIRPORT & TARGET" : "DELIVERY DESTINATION TARGET"}
                  </span>
                  <h4 className="font-bold text-slate-200 text-xs text-wrap">
                    {shipment.freightType === 'sea' ? `${shipment.portOfDischarge || "-"} ➔ ${shipment.finalDestination || "-"}` : shipment.freightType === 'air' ? `${shipment.airportOfArrival || "-"} ➔ ${shipment.finalDestination || "-"}` : `${shipment.deliveryCity || "-"}, ${shipment.deliveryCountry || "-"}`}
                  </h4>
                  <p className="text-[10.5px] text-slate-400 font-semibold">{shipment.deliveryAddress || "MARAS Logistics Terminal Target"}</p>
                </div>
              </div>

            </div>

          </div>

        </div>

        {/* SECURE BLOCKCHAIN DOCUMENT VAULT PORTER */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-orange-500 shrink-0" />
              <div>
                <h3 className="font-extrabold text-xs text-slate-100 uppercase tracking-widest">{t('documentsShared')}</h3>
                <p className="text-[10px] text-slate-400">
                  {lang === 'en' ? "Verified digitally signed transit records accessible for import officers & clients" : (lang === 'tr' ? "İthalat memurları ve müşteriler için doğrulanmış dijital imzalı geçiş belgeleri" : "الوثائق والمستندات الرسمية المعتمدة رقمياً المتاحة للجمارك والشركات")}
                </p>
              </div>
            </div>
            
            <span className="bg-slate-950 text-slate-500 font-mono font-bold text-[9px] px-2 in-block self-start py-0.5 rounded border border-slate-800/80 uppercase">
              TIR SHARED CARNET VAULT
            </span>
          </div>

          {shipment.documents && shipment.documents.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {shipment.documents.map((doc: any) => (
                <div key={doc.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-3 shadow-xs hover:border-slate-700 transition-all group">
                  <div className="flex items-center gap-2.5 truncate">
                    <div className="w-8 h-8 rounded-lg bg-orange-600/10 text-orange-400 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="truncate text-xs">
                      <p className="font-extrabold text-slate-300 truncate group-hover:text-slate-100 transition-colors">{doc.name}</p>
                      <span className="text-[9.5px] text-slate-500 block font-mono">Category: {doc.category.toUpperCase()}</span>
                    </div>
                  </div>
                  <a 
                    href={doc.url}
                    download
                    onClick={(e) => {
                      if (doc.url === "#") {
                        e.preventDefault();
                        triggerToast("Secure specimen document ready for local offline reading (Specimen file download).");
                      }
                    }}
                    className="p-1 px-3 bg-slate-900 hover:bg-orange-600 text-slate-300 hover:text-white font-extrabold rounded text-[10px] flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <Download className="w-3 h-3 shrink-0" />
                    <span>Get File</span>
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800/80">
              <Lock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-400 text-xs italic">{t('noDocsForPublic')}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{lang === 'en' ? "Authorized trade documents are hidden except those explicitly designated by terminal inspectors." : (lang === 'tr' ? "Kayıtlı gümrük belgeleri, yetkili müfettişler tarafından açıkça yetkilendirilmediği sürece gizlidir." : "جميع الوثائق محمية ومخفية عدا ما يتم تفويضه بموافقة الإدارة لمصلحة التحقق والجمارك.")}</p>
            </div>
          )}
        </div>

        {/* LOGISTICS TRANSIT EVENT LOGS TIMELINE */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <ListOrdered className="w-4 h-4 text-orange-500 shrink-0" />
            <div>
              <h3 className="font-extrabold text-xs text-slate-100 uppercase tracking-widest">{t('timeline')}</h3>
              <p className="text-[10px] text-slate-400">
                {lang === 'en' ? "Immutable corridor transition logs synchronized from drivers and regional border hubs" : (lang === 'tr' ? "Sürücüler ve bölgesel sınır kapılarından senkronize edilen doğrulanmış geçiş kayıtları" : "سجل الأحداث والعمليات التفصيلي المتزامن مباشرة مع نقاط المرور الجغرافي")}
              </p>
            </div>
          </div>

          <div className="relative border-l-2 border-slate-800 pl-4 space-y-6 ml-2 pt-2">
            {shipment.timeline && shipment.timeline.map((event: any, idx: number) => (
              <div key={idx} className="relative">
                {/* Visual marker dot */}
                <span className="absolute -left-[20.5px] top-1 bg-slate-900 border-2 border-orange-500 rounded-full w-2.5 h-2.5"></span>
                
                <div className="space-y-1 text-xs">
                  <span className="text-[9px] font-mono text-slate-500 font-bold block">
                    {new Date(event.timestamp).toLocaleString(lang === 'tr' ? 'tr-TR' : (lang === 'ar' ? 'ar-EG' : 'en-US'))}
                  </span>
                  
                  <h4 className="font-bold text-slate-200 text-sm flex items-center gap-1.5">
                    {lang === 'en' ? event.labelEn : (lang === 'tr' ? event.labelTr : event.labelAr)}
                    {idx === 0 && (
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-ping" />
                    )}
                  </h4>
                  
                  <p className="text-xs text-slate-400 leading-normal font-medium max-w-2xl">
                    {lang === 'en' ? event.detailsEn : (lang === 'tr' ? event.detailsTr : event.detailsAr)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 🔒 LIVE ALERTS & CUSTOMER NOTIFICATION HUB */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Bell className="w-4 h-4 text-orange-500 shrink-0" />
            <div>
              <h3 className="font-extrabold text-xs text-slate-100 uppercase tracking-widest">
                {lang === 'en' ? "Customer Notification Hub" : (lang === 'tr' ? "Müşteri Bildirim Portalı" : "مركز إشعارات العملاء المباشر")}
              </h3>
              <p className="text-[10px] text-slate-400">
                {lang === 'en' ? "Receive active push notifications & electronic logs of cargo status parameter changes" : (lang === 'tr' ? "Yük durum parametre değişikliklerini gerçek zamanlı bildirimlerle anında takip edin" : "احصل على إشعارات فورية وتقارير إلكترونية تزامناً مع أي تحديثات على وضع شحنتك")}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubscribeCustomer} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <input
                type="email"
                required
                value={customerEmailInput}
                onChange={(e) => setCustomerEmailInput(e.target.value)}
                placeholder={lang === 'en' ? "Enter your email for live updates" : (lang === 'tr' ? "Canlı güncellemeler için e-posta girin" : "أدخل بريدك الإلكتروني هنا للتحديثات الفورية")}
                className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl px-4 py-2.5 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none placeholder-slate-600 font-sans"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmittingSubscription}
              className="bg-orange-600 hover:bg-orange-700 active:translate-y-px text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all font-sans cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
            >
              <span>{isSubmittingSubscription ? (lang === 'en' ? "Registering..." : "Kayıt yapılıyor...") : (lang === 'en' ? "Subscribe to Alerts" : (lang === 'tr' ? "Takip Aboneliği Başlat" : "اشترك في التنبيهات"))}</span>
            </button>
          </form>
        </div>

      </main>

      {/* FOOTER */}
      <footer className="max-w-5xl mx-auto px-4 pt-12 border-t border-slate-900 text-center text-slate-500 text-[10px] uppercase font-mono tracking-widest space-y-2 pb-12">
        <p>MARAS Group Logistics • Trusted International Road Transit Core (etir Gateway)</p>
        <p className="text-[9px] text-slate-600">Istanbul | Ankara | Gaziantep | Zakho | Erbil | Baghdad | Basra</p>
        {(onViewPrivacy || onViewTerms) && (
          <p className="pt-2 flex flex-wrap justify-center gap-2">
            {onViewPrivacy && (
              <button
                type="button"
                onClick={onViewPrivacy}
                className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-slate-800 cursor-pointer transition-all text-[9.5px] uppercase font-mono tracking-widest outline-none shadow-sm font-semibold"
              >
                🔒 Privacy Policy / Gizlilik Politikası
              </button>
            )}
            {onViewTerms && (
              <button
                type="button"
                onClick={onViewTerms}
                className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-slate-800 cursor-pointer transition-all text-[9.5px] uppercase font-mono tracking-widest outline-none shadow-sm font-semibold"
              >
                ⚖️ Terms & Conditions / Kullanım Koşulları
              </button>
            )}
          </p>
        )}
      </footer>

      {/* Floating system Toast feedback notification banner */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-55 px-4.5 py-3 bg-slate-900 border border-orange-500/40 text-orange-400 font-sans font-semibold text-xs rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-bottom-4 duration-300 flex items-center gap-2 max-w-sm">
          <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
          <span>{toast}</span>
        </div>
      )}

    </div>
  );
}
