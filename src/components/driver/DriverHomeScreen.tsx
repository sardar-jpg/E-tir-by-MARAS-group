import { useState } from "react";
import {
  ArrowRight, Briefcase, ChevronRight, FileText, Loader2, Megaphone, MessageSquare,
} from "lucide-react";
import type { Driver, Language, Shipment, ShipmentStatus } from "../../types";
import { apiFetch } from "../../lib/api";
import { resolveDriverAgreedAmount } from "../../lib/driverVisibility";
import { isDriverChatAvailable } from "../../lib/driverJobFlow";
import DriverNextAction from "./DriverNextAction";
import {
  CARD, HERO_CARD, LIST_ROW, getJourneyProgress, getStatusChipClasses, localizeShipmentStatus,
} from "./driverUi";

/**
 * Driver App Revision A — Home is a WORKFLOW ASSISTANT, not a dashboard.
 * With an active job it contains exactly the five approved elements and
 * nothing else:
 *   1. Active Shipment   (one hero card: number, status chip, route)
 *   2. Current Status    (plain-language line inside the same card)
 *   3. One Primary Action (DriverNextAction — the single legal next
 *      status via the existing getDriverNextAction rule, with its
 *      full-screen confirmation moment)
 *   4. Chat              (shortcut button with unread badge)
 *   5. Shipment Details  (shortcut button)
 * No KPI tiles, no timeline, no activity feed, no map, no ETA, no
 * distance, no phone action, no secondary operational controls. The
 * full journey timeline lives on the Job (Trip Progress) screen.
 *
 * With no active job: a calm empty state, the driver's own Available-
 * for-Offers switch (the one alliance field a driver session may
 * write), the offers-waiting hint, and the latest previous job.
 *
 * The active job comes from the ONE shared selection rule
 * (useDriverActiveJob → selectDriverActiveJob) — the same job location
 * reporting follows.
 */
const LABELS: Record<Language, {
  greeting: (name: string) => string;
  activeShipment: string;
  agreedPayment: string;
  updated: string;
  stepOf: (step: number, total: number) => string;
  chat: string;
  details: string;
  availability: string;
  availabilityOn: string;
  availabilityOff: string;
  availabilityOnMsg: string;
  availabilityOffMsg: string;
  offersWaiting: (n: number) => string;
  noOffers: string;
  openJob: string;
  noJob: string;
  noJobSub: string;
  previous: string;
}> = {
  en: {
    greeting: (n) => `Hello, ${n} 👋`,
    activeShipment: "Active shipment",
    agreedPayment: "Agreed Driver Payment",
    updated: "Updated",
    stepOf: (s, t2) => `Step ${s} of ${t2} · Based on confirmed steps`,
    chat: "Chat",
    details: "Details",
    availability: "Available for Offers",
    availabilityOn: "On — you receive transport offers",
    availabilityOff: "Off — no transport offers",
    availabilityOnMsg: "You will now receive transport offers.",
    availabilityOffMsg: "You will no longer receive transport offers.",
    offersWaiting: (n) => (n === 1 ? "1 offer waiting for your price" : `${n} offers waiting for your price`),
    noOffers: "No new offers right now",
    openJob: "Open Job",
    noJob: "No active job right now",
    noJobSub: "When MARAS assigns you a job, everything about it will appear here — route, next step, chat and files.",
    previous: "Previous jobs",
  },
  tr: {
    greeting: (n) => `Merhaba, ${n} 👋`,
    activeShipment: "Aktif sevkiyat",
    agreedPayment: "Sürücü için anlaşılan ücret",
    updated: "Güncellendi",
    stepOf: (s, t2) => `Adım ${s} / ${t2} · Onaylanan adımlara göre`,
    chat: "Mesajlar",
    details: "Detaylar",
    availability: "Tekliflere Açık",
    availabilityOn: "Açık — taşıma teklifleri alırsınız",
    availabilityOff: "Kapalı — taşıma teklifi gelmez",
    availabilityOnMsg: "Artık taşıma teklifleri alacaksınız.",
    availabilityOffMsg: "Artık taşıma teklifi almayacaksınız.",
    offersWaiting: (n) => `${n} teklif fiyatınızı bekliyor`,
    noOffers: "Şu anda yeni teklif yok",
    openJob: "Sefere Git",
    noJob: "Şu anda aktif sefer yok",
    noJobSub: "MARAS size bir sefer atadığında her şey burada görünecek — güzergah, sonraki adım, mesajlar ve dosyalar.",
    previous: "Önceki seferler",
  },
  ar: {
    greeting: (n) => `مرحباً، ${n} 👋`,
    activeShipment: "الشحنة النشطة",
    agreedPayment: "الأجرة المتفق عليها للسائق",
    updated: "آخر تحديث",
    stepOf: (s, t2) => `الخطوة ${s} من ${t2} · وفق الخطوات المؤكدة`,
    chat: "الدردشة",
    details: "التفاصيل",
    availability: "متاح لعروض النقل",
    availabilityOn: "مفعّل — تصلك عروض النقل",
    availabilityOff: "متوقف — لا تصلك عروض النقل",
    availabilityOnMsg: "ستصلك عروض النقل من الآن.",
    availabilityOffMsg: "لن تصلك عروض النقل بعد الآن.",
    offersWaiting: (n) => `${n} عرض بانتظار سعرك`,
    noOffers: "لا توجد عروض جديدة حالياً",
    openJob: "فتح المهمة",
    noJob: "لا توجد مهمة نشطة حالياً",
    noJobSub: "عندما تخصص لك MARAS مهمة، سيظهر كل شيء عنها هنا — المسار والخطوة التالية والمحادثة والملفات.",
    previous: "المهام السابقة",
  },
};

/**
 * Plain-language "what is happening now" line per Land status — display
 * copy only, driven entirely by the stored status. Sea/Air statuses fall
 * back to the shared localized status label.
 */
const STATUS_DESCRIPTIONS: Partial<Record<ShipmentStatus, Record<Language, string>>> = {
  Accepted: {
    en: "You accepted this job. Start loading when you are at the pickup.",
    tr: "Bu seferi kabul ettiniz. Yükleme noktasına vardığınızda yüklemeye başlayın.",
    ar: "قبلت هذه المهمة. ابدأ التحميل عند وصولك إلى نقطة الاستلام.",
  },
  Loading: {
    en: "Loading is in progress. Confirm when the cargo is on board.",
    tr: "Yükleme devam ediyor. Yük araca alındığında onaylayın.",
    ar: "التحميل جارٍ. أكّد عند اكتمال تحميل البضاعة.",
  },
  Loaded: {
    en: "Cargo is loaded. Start your journey when you are ready.",
    tr: "Yük tamamlandı. Hazır olduğunuzda yola çıkın.",
    ar: "اكتمل التحميل. انطلق في رحلتك عندما تكون جاهزاً.",
  },
  "In Transit": {
    en: "You are on the way to the border. Tap the button below when you arrive.",
    tr: "Sınıra doğru yoldasınız. Vardığınızda aşağıdaki düğmeye dokunun.",
    ar: "أنت في الطريق إلى الحدود. اضغط الزر أدناه عند وصولك.",
  },
  "Border Crossing": {
    en: "You are at the border. Start customs clearance when processing begins.",
    tr: "Sınırdasınız. İşlemler başladığında gümrük sürecini başlatın.",
    ar: "أنت عند الحدود. ابدأ التخليص الجمركي عند بدء المعاملات.",
  },
  "Customs Clearance": {
    en: "Customs clearance is in progress. Confirm when you arrive at the destination.",
    tr: "Gümrük işlemleri sürüyor. Varış noktasına ulaştığınızda onaylayın.",
    ar: "التخليص الجمركي جارٍ. أكّد عند وصولك إلى الوجهة.",
  },
  Arrived: {
    en: "You are at the destination. Confirm once the delivery is handed over.",
    tr: "Varış noktasındasınız. Teslimat tamamlandığında onaylayın.",
    ar: "أنت في الوجهة. أكّد بعد تسليم الشحنة.",
  },
};

function formatUpdatedTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface DriverHomeScreenProps {
  driverName: string;
  driverId: string;
  driver: Driver | null;
  activeJob: Shipment | null;
  lang: Language;
  /** Offers still awaiting this driver's answer. */
  pendingOffersCount: number;
  /** Unread MARAS chat messages for the active job (Chat button badge). */
  activeJobUnreadChat: number;
  /** Latest completed job — the one quiet row in the no-job state. */
  latestPreviousJob: Shipment | null;
  isSubmittingStatus: boolean;
  onSubmitNextStatus: (shipment: Shipment) => void;
  onAccept: (shipment: Shipment) => void;
  onDecline: (shipment: Shipment) => void;
  onOpenJob: () => void;
  onOpenChat: (shipment: Shipment) => void;
  onOpenDetails: (shipment: Shipment) => void;
  onDriverUpdated: (driver: Driver) => void;
  onToast: (msg: string) => void;
}

export default function DriverHomeScreen({
  driverName,
  driverId,
  driver,
  activeJob,
  lang,
  pendingOffersCount,
  activeJobUnreadChat,
  latestPreviousJob,
  isSubmittingStatus,
  onSubmitNextStatus,
  onAccept,
  onDecline,
  onOpenJob,
  onOpenChat,
  onOpenDetails,
  onDriverUpdated,
  onToast,
}: DriverHomeScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const firstName = driverName ? driverName.split(" ")[0] : "";

  // The driver's OWN availability switch (Driver Quote Requests). Absent
  // counts as available, so legacy profiles stay opted in — the exact
  // convention the server and matching use.
  const [isSavingOffers, setIsSavingOffers] = useState(false);
  const offersEnabled = driver?.availableForOffers !== false;

  const handleToggleAvailableForOffers = async () => {
    if (isSavingOffers) return;
    setIsSavingOffers(true);
    try {
      const res = await apiFetch(`/api/drivers/${driverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availableForOffers: !offersEnabled }),
      });
      if (res.ok) {
        const updated = await res.json();
        onDriverUpdated(updated);
        onToast(!offersEnabled ? t.availabilityOnMsg : t.availabilityOffMsg);
      } else {
        let msg = "Failed to update. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        onToast(`❌ ${msg}`);
      }
    } catch (err) {
      console.error(err);
      onToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      setIsSavingOffers(false);
    }
  };

  /* ── Active job: exactly five elements ── */
  if (activeJob) {
    const statusDesc =
      STATUS_DESCRIPTIONS[activeJob.status]?.[lang] ??
      STATUS_DESCRIPTIONS[activeJob.status]?.en ??
      localizeShipmentStatus(activeJob.status, lang);
    const updatedAt = formatUpdatedTime(activeJob.updatedAt);
    const chatAvailable = isDriverChatAvailable(activeJob.status);
    // The driver's OWN agreed amount only (resolveDriverAgreedAmount —
    // existing driver-facing field; never a customer price, never another
    // driver's figure). null → the line is simply not rendered: no zero,
    // no placeholder, nothing fabricated.
    const agreedAmount = resolveDriverAgreedAmount(activeJob, driverId);
    const progress = getJourneyProgress(activeJob.status, activeJob.freightType);

    return (
      <div className="h-full flex flex-col animate-fade-in pb-2">
        <h2 className="text-base font-bold text-slate-900 text-start">{t.greeting(firstName || "—")}</h2>

        <div className="flex-1 min-h-3" />

        {/* 1+2 · Active Shipment + Current Status — ONE hero card */}
        <div className={`${HERO_CARD} p-6`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{t.activeShipment}</span>
            <span className={`px-3 py-1 rounded-full text-xs font-bold border shrink-0 ${getStatusChipClasses(activeJob.status, activeJob.freightType)}`}>
              {localizeShipmentStatus(activeJob.status, lang)}
            </span>
          </div>
          <p className="text-[15px] font-bold text-slate-500 tabular-nums selectable mt-2 text-start">#{activeJob.shipmentNumber}</p>
          {/* Route — wraps gracefully, never truncates city names */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-3 text-start">
            <span className="text-[24px] leading-8 font-extrabold text-slate-900 tracking-tight break-words min-w-0">{activeJob.loadingCity || "—"}</span>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0 rtl:rotate-180" />
            <span className="text-[24px] leading-8 font-extrabold text-slate-900 tracking-tight break-words min-w-0">{activeJob.deliveryCity || "—"}</span>
          </div>
          <div className="h-px bg-slate-100 my-4" />
          <p className="text-sm text-slate-600 font-medium leading-relaxed text-start">{statusDesc}</p>
          {agreedAmount !== null && (
            <p className="text-[13px] mt-2.5 text-start">
              <span className="font-semibold text-slate-400">{t.agreedPayment}: </span>
              <span className="font-bold text-slate-700 tabular-nums">{agreedAmount.toLocaleString()} {activeJob.currency || "USD"}</span>
            </p>
          )}
          {updatedAt && (
            <p className="text-xs font-bold text-slate-400 mt-2 tabular-nums text-start">{t.updated} {updatedAt}</p>
          )}
        </div>

        <div className="flex-1 min-h-3" />

        {/* 4+5 · Chat + Shipment Details shortcuts */}
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          {chatAvailable && (
            <button
              type="button"
              onClick={() => onOpenChat(activeJob)}
              className="relative min-h-[56px] rounded-2xl bg-white border border-blue-200 text-blue-700 font-bold text-[15px] flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-[0_1px_2px_rgba(15,27,45,0.03)]"
            >
              <MessageSquare className="w-5 h-5 shrink-0" />
              <span>{t.chat}</span>
              {activeJobUnreadChat > 0 && (
                <span className="absolute -top-2 -end-1.5 min-w-[20px] h-[20px] px-1 rounded-full bg-orange-500 text-white text-[11px] font-bold leading-[20px] text-center border-2 border-slate-100 box-content">
                  {activeJobUnreadChat > 9 ? "9+" : activeJobUnreadChat}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenDetails(activeJob)}
            className={`min-h-[56px] rounded-2xl bg-white border border-slate-200 text-slate-600 font-bold text-[15px] flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-[0_1px_2px_rgba(15,27,45,0.03)] ${chatAvailable ? "" : "col-span-2"}`}
          >
            <FileText className="w-5 h-5 shrink-0" />
            <span>{t.details}</span>
          </button>
        </div>

        {/* 3 · The ONE primary action (existing legal next-action rule) */}
        <DriverNextAction
          shipment={activeJob}
          lang={lang}
          isSubmitting={isSubmittingStatus}
          onSubmitNextStatus={() => onSubmitNextStatus(activeJob)}
          onAccept={() => onAccept(activeJob)}
          onDecline={() => onDecline(activeJob)}
        />
        {progress.index > 0 && (
          <p className="text-center text-xs font-semibold text-slate-400 mt-2.5 tabular-nums">
            {t.stepOf(progress.index + 1, progress.total)}
          </p>
        )}
      </div>
    );
  }

  /* ── No active job: calm empty state + offers availability ── */
  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <h2 className="text-base font-bold text-slate-900 text-start">{t.greeting(firstName || "—")}</h2>

      <div className={`${CARD} px-6 py-9 text-center`}>
        <div className="w-[72px] h-[72px] rounded-3xl bg-blue-50 text-blue-600 inline-flex items-center justify-center">
          <Briefcase className="w-8 h-8" />
        </div>
        <p className="text-lg font-extrabold text-slate-900 mt-4">{t.noJob}</p>
        <p className="text-sm text-slate-500 font-medium leading-relaxed mt-1.5 max-w-[280px] mx-auto">{t.noJobSub}</p>
      </div>

      {/* Available for Offers switch — the one alliance field a driver may write */}
      <button
        type="button"
        onClick={handleToggleAvailableForOffers}
        disabled={isSavingOffers}
        aria-pressed={offersEnabled}
        className={`w-full flex items-center gap-3 min-h-[60px] px-4 border rounded-2xl text-start transition-colors cursor-pointer disabled:opacity-60 bg-white shadow-[0_1px_2px_rgba(15,27,45,0.03)] ${
          offersEnabled ? "border-emerald-200" : "border-slate-200"
        }`}
      >
        <Megaphone className={`w-5 h-5 shrink-0 ${offersEnabled ? "text-emerald-600" : "text-slate-400"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-800">{t.availability}</span>
          <span className={`block text-xs mt-0.5 font-semibold ${offersEnabled ? "text-emerald-600" : "text-slate-400"}`}>
            {offersEnabled ? t.availabilityOn : t.availabilityOff}
          </span>
        </span>
        {isSavingOffers ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400 shrink-0" />
        ) : (
          <span
            className={`shrink-0 w-12 h-7 rounded-full relative transition-colors ${offersEnabled ? "bg-green-600" : "bg-slate-300"}`}
            aria-hidden="true"
          >
            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-sm transition-all ${offersEnabled ? "end-0.5" : "start-0.5"}`} />
          </span>
        )}
      </button>

      {/* Offers now + THE one action */}
      <div className={`${pendingOffersCount > 0 ? `${HERO_CARD} border-s-4 border-s-amber-400` : CARD} p-5 text-center space-y-4`}>
        <p className={`font-bold ${pendingOffersCount > 0 ? "text-lg text-amber-600" : "text-[15px] text-slate-500"}`}>
          {pendingOffersCount > 0 ? t.offersWaiting(pendingOffersCount) : t.noOffers}
        </p>
        <button
          type="button"
          onClick={onOpenJob}
          className="w-full min-h-[60px] rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold text-lg flex items-center justify-center gap-2 shadow-[0_10px_24px_-8px_rgba(22,163,74,0.45)] transition-all duration-150 active:scale-[0.98] cursor-pointer"
        >
          <Briefcase className="w-5 h-5 shrink-0" />
          <span>{t.openJob}</span>
          <ChevronRight className="w-5 h-5 shrink-0 rtl:rotate-180" />
        </button>
      </div>

      {/* Latest previous job — one quiet row */}
      {latestPreviousJob && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 text-start">{t.previous}</h3>
          <button
            type="button"
            onClick={() => onOpenDetails(latestPreviousJob)}
            className={`${LIST_ROW} p-4`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-start">
                <p className="text-sm font-bold text-slate-800 tabular-nums truncate">#{latestPreviousJob.shipmentNumber}</p>
                <p className="text-xs text-slate-500 font-semibold mt-0.5 truncate">
                  {latestPreviousJob.loadingCity} → {latestPreviousJob.deliveryCity}
                </p>
              </div>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusChipClasses(latestPreviousJob.status, latestPreviousJob.freightType)}`}>
                  {localizeShipmentStatus(latestPreviousJob.status, lang)}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
              </span>
            </div>
          </button>
        </section>
      )}
    </div>
  );
}
