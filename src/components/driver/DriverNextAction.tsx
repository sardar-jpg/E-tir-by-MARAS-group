import { useEffect, useState } from "react";
import {
  ArrowLeft, Check, CheckCircle2, Clock, Flag, Landmark, Lock, MapPin, Package, Truck, X,
} from "lucide-react";
import type { Language, Shipment, ShipmentStatus } from "../../types";
import { getDriverNextAction, localizeNextActionLabel } from "../../lib/driverJobFlow";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import { BTN_PRIMARY, localizeShipmentStatus } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign (Revision A) — the ONE place
 * the driver acts on a job's status. Renders exactly one of:
 *  - Accept / Decline (status "Assigned" — the dedicated assignment
 *    workflow; Decline is the existing Assigned→New exception),
 *  - a single large GREEN primary button for the one legal next status
 *    (getDriverNextAction — never a dropdown, never backward/skip/close),
 *    which opens a FULL-SCREEN confirmation moment stating the exact
 *    lifecycle consequence before submitting (a pothole can't submit a
 *    milestone),
 *  - a waiting note (status "New" — back with dispatch),
 *  - a completed note (Delivered onward — no driver action remains; chat
 *    stays open unless the shipment is actually Closed/Completed).
 *
 * The confirmation checklist is REMINDER-ONLY: static copy, never stored,
 * never submitted, never a gate on the action (the confirm button does
 * not depend on it). Confirm/cancel behavior is unchanged — confirm calls
 * the same onSubmitNextStatus; cancel simply closes the moment.
 */

const LABELS: Record<Language, {
  accept: string;
  decline: string;
  acceptPrompt: string;
  confirmTitle: (action: string) => string;
  consequence: (status: string) => string;
  reminderTitle: string;
  reminderNote: string;
  confirm: string;
  back: string;
  waiting: string;
  waitingSub: string;
  deliveredDone: string;
  deliveredDoneSub: string;
  closedDone: string;
  closedDoneSub: string;
  sending: string;
  closeConfirm: string;
}> = {
  en: {
    accept: "Accept Job",
    decline: "Decline",
    acceptPrompt: "New job assigned to you. Accept to start.",
    confirmTitle: (a) => a,
    consequence: (s) => `This will update the shipment status to “${s}”.`,
    reminderTitle: "Before you go",
    reminderNote: "Reminder only — not recorded",
    confirm: "Yes, confirm",
    back: "Not yet",
    waiting: "Waiting for dispatch",
    waitingSub: "MARAS will assign the next step. Nothing to do right now.",
    deliveredDone: "Delivery complete",
    deliveredDoneSub: "No more status updates needed. Chat stays open for files and questions.",
    closedDone: "Job closed",
    closedDoneSub: "This job is finished and locked. Chat is read-only.",
    sending: "Sending…",
    closeConfirm: "Close",
  },
  tr: {
    accept: "Görevi Kabul Et",
    decline: "Reddet",
    acceptPrompt: "Size yeni bir sefer atandı. Başlamak için kabul edin.",
    confirmTitle: (a) => a,
    consequence: (s) => `Bu işlem sevkiyat durumunu “${s}” olarak güncelleyecek.`,
    reminderTitle: "Yola çıkmadan önce",
    reminderNote: "Yalnızca hatırlatma — kaydedilmez",
    confirm: "Evet, onayla",
    back: "Henüz değil",
    waiting: "Operasyon bekleniyor",
    waitingSub: "MARAS bir sonraki adımı atayacak. Şu an yapılacak bir şey yok.",
    deliveredDone: "Teslimat tamamlandı",
    deliveredDoneSub: "Başka durum güncellemesi gerekmiyor. Dosyalar ve sorular için mesajlaşma açık kalır.",
    closedDone: "Sefer kapatıldı",
    closedDoneSub: "Bu sefer tamamlandı ve kilitlendi. Mesajlar salt okunur.",
    sending: "Gönderiliyor…",
    closeConfirm: "Kapat",
  },
  ar: {
    accept: "قبول المهمة",
    decline: "رفض",
    acceptPrompt: "تم تعيين مهمة جديدة لك. اقبلها للبدء.",
    confirmTitle: (a) => a,
    consequence: (s) => `سيؤدي هذا إلى تحديث حالة الشحنة إلى «${s}».`,
    reminderTitle: "قبل الانطلاق",
    reminderNote: "تذكير فقط — لا يُسجَّل",
    confirm: "نعم، أؤكد",
    back: "ليس بعد",
    waiting: "بانتظار العمليات",
    waitingSub: "ستحدد MARAS الخطوة التالية. لا يوجد إجراء مطلوب الآن.",
    deliveredDone: "اكتمل التسليم",
    deliveredDoneSub: "لا حاجة لتحديثات حالة إضافية. تبقى المحادثة مفتوحة للملفات والاستفسارات.",
    closedDone: "المهمة مغلقة",
    closedDoneSub: "انتهت هذه المهمة وتم قفلها. المحادثة للقراءة فقط.",
    sending: "جارٍ الإرسال…",
    closeConfirm: "إغلاق",
  },
};

/** Reminder-only checklist copy for the Start Journey moment. Static UI aid — never stored or submitted. */
const JOURNEY_REMINDERS: Record<Language, string[]> = {
  en: ["Cargo is loaded and secured", "CMR and papers are with you", "Truck is in good condition"],
  tr: ["Yük yüklendi ve sabitlendi", "CMR ve evraklar yanınızda", "Araç iyi durumda"],
  ar: ["الحمولة محمّلة ومثبّتة", "وثيقة CMR والأوراق معك", "الشاحنة بحالة جيدة"],
};

const NEXT_STATUS_ICONS: Partial<Record<ShipmentStatus, typeof Truck>> = {
  Loading: Package,
  Loaded: CheckCircle2,
  "In Transit": Truck,
  "Border Crossing": Flag,
  "Customs Clearance": Landmark,
  Arrived: MapPin,
  Delivered: CheckCircle2,
};

interface DriverNextActionProps {
  shipment: Pick<Shipment, "id" | "status" | "freightType" | "shipmentNumber" | "loadingCity" | "deliveryCity">;
  lang: Language;
  isSubmitting: boolean;
  onSubmitNextStatus: () => void;
  onAccept: () => void;
  onDecline: () => void;
}

export default function DriverNextAction({
  shipment,
  lang,
  isSubmitting,
  onSubmitNextStatus,
  onAccept,
  onDecline,
}: DriverNextActionProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const [confirming, setConfirming] = useState(false);

  // A background poll can change the job's status underneath an open
  // confirm step — always drop back to the un-confirmed state so the
  // driver re-reads what they are about to submit.
  useEffect(() => {
    setConfirming(false);
  }, [shipment.id, shipment.status]);

  if (shipment.status === "Assigned") {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-[0_1px_2px_rgba(15,27,45,0.03)]">
        <p className="text-sm font-semibold text-slate-700 text-start">{t.acceptPrompt}</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onDecline}
            disabled={isSubmitting}
            className="col-span-1 min-h-[56px] rounded-2xl bg-white border border-red-200 text-red-600 font-bold text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4 shrink-0" />
            <span>{t.decline}</span>
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isSubmitting}
            className="col-span-2 min-h-[56px] rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold text-base flex items-center justify-center gap-2 shadow-[0_6px_18px_-6px_rgba(22,163,74,0.5)] transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <Check className="w-5 h-5 shrink-0" />
            <span>{isSubmitting ? t.sending : t.accept}</span>
          </button>
        </div>
      </div>
    );
  }

  if (shipment.status === "New") {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 text-start">
        <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">{t.waiting}</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{t.waitingSub}</p>
        </div>
      </div>
    );
  }

  const action = getDriverNextAction(shipment.status, shipment.freightType);

  if (!action) {
    const closed = isShipmentClosed(shipment.status, shipment.freightType);
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 text-start">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${
            closed
              ? "bg-slate-100 border-slate-200 text-slate-500"
              : "bg-emerald-50 border-emerald-200 text-emerald-600"
          }`}
        >
          {closed ? <Lock className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">{closed ? t.closedDone : t.deliveredDone}</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{closed ? t.closedDoneSub : t.deliveredDoneSub}</p>
        </div>
      </div>
    );
  }

  const actionLabel = localizeNextActionLabel(action, lang);
  const nextStatusLabel = localizeShipmentStatus(action.nextStatus, lang);
  const MomentIcon = NEXT_STATUS_ICONS[action.nextStatus] ?? Truck;
  const reminders = action.nextStatus === "In Transit" ? (JOURNEY_REMINDERS[lang] ?? JOURNEY_REMINDERS.en) : null;

  if (confirming) {
    /* ── Full-screen confirmation moment (Revision A, mockup 04) ──
       States the exact action and its exact lifecycle consequence; one
       large green confirmation button; a clear cancel/back action. */
    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-slate-100 animate-fade-in" role="dialog" aria-modal="true" aria-label={actionLabel}>
        {/* Consequence header */}
        <div className="bg-gradient-to-b from-blue-900 to-blue-700 text-white px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-8">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isSubmitting}
            aria-label={t.closeConfirm}
            className="w-10 h-10 rounded-2xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer mb-4"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </button>
          <div className="text-center">
            <div className="w-20 h-20 rounded-3xl bg-white/15 inline-flex items-center justify-center">
              <MomentIcon className="w-10 h-10" />
            </div>
            <h2 className="text-[26px] leading-8 font-extrabold mt-4">{t.confirmTitle(actionLabel)}</h2>
            <p className="text-[14.5px] font-medium opacity-90 mt-2 leading-relaxed max-w-[300px] mx-auto">
              {t.consequence(nextStatusLabel)}
            </p>
          </div>
        </div>

        {/* Context + reminder-only checklist */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {reminders && (
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-[0_10px_30px_-12px_rgba(15,27,45,0.1)]">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{t.reminderTitle}</span>
                <span className="text-[11px] font-bold text-slate-400">{t.reminderNote}</span>
              </div>
              <ul>
                {reminders.map((r) => (
                  <li key={r} className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-b-0 text-start">
                    <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4" />
                    </span>
                    <span className="text-[15px] font-bold text-slate-800">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs font-semibold text-slate-400 text-center">
            #{shipment.shipmentNumber} · {shipment.loadingCity} → {shipment.deliveryCity}
          </p>
        </div>

        {/* One large confirm + clear cancel */}
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-2.5">
          <button
            type="button"
            onClick={onSubmitNextStatus}
            disabled={isSubmitting}
            className={`w-full ${BTN_PRIMARY} gap-2.5`}
          >
            <Check className="w-6 h-6 shrink-0" />
            <span>{isSubmitting ? t.sending : t.confirm}</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isSubmitting}
            className="w-full min-h-[54px] rounded-2xl bg-white border border-slate-200 text-slate-600 font-bold text-[15px] transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            {t.back}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={isSubmitting}
      className={`w-full ${BTN_PRIMARY} gap-2.5`}
    >
      <MomentIcon className="w-6 h-6 shrink-0" />
      <span>{actionLabel}</span>
    </button>
  );
}
