import { useEffect, useState } from "react";
import { Check, CheckCircle2, Clock, Lock, X } from "lucide-react";
import type { Language, Shipment } from "../../types";
import { getDriverNextAction, localizeNextActionLabel } from "../../lib/driverJobFlow";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import { BTN_PRIMARY } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign — the ONE place the driver
 * acts on a job's status. Renders exactly one of:
 *  - Accept / Decline (status "Assigned" — the dedicated assignment
 *    workflow; Decline is the existing Assigned→New exception),
 *  - a single large primary button for the one legal next status
 *    (getDriverNextAction — never a dropdown, never backward/skip/close),
 *    with an inline confirm step so a pothole can't submit a milestone,
 *  - a waiting note (status "New" — back with dispatch),
 *  - a completed note (Delivered onward — no driver action remains; chat
 *    stays open unless the shipment is actually Closed/Completed).
 */

const LABELS: Record<Language, {
  accept: string;
  decline: string;
  acceptPrompt: string;
  confirmTitle: (action: string) => string;
  confirm: string;
  back: string;
  waiting: string;
  waitingSub: string;
  deliveredDone: string;
  deliveredDoneSub: string;
  closedDone: string;
  closedDoneSub: string;
  sending: string;
}> = {
  en: {
    accept: "Accept Job",
    decline: "Decline",
    acceptPrompt: "New job assigned to you. Accept to start.",
    confirmTitle: (a) => `Confirm: ${a}?`,
    confirm: "Yes, confirm",
    back: "Not yet",
    waiting: "Waiting for dispatch",
    waitingSub: "MARAS will assign the next step. Nothing to do right now.",
    deliveredDone: "Delivery complete",
    deliveredDoneSub: "No more status updates needed. Chat stays open for documents and questions.",
    closedDone: "Job closed",
    closedDoneSub: "This job is finished and locked. Chat is read-only.",
    sending: "Sending…",
  },
  tr: {
    accept: "Görevi Kabul Et",
    decline: "Reddet",
    acceptPrompt: "Size yeni bir sefer atandı. Başlamak için kabul edin.",
    confirmTitle: (a) => `Onayla: ${a}?`,
    confirm: "Evet, onayla",
    back: "Henüz değil",
    waiting: "Operasyon bekleniyor",
    waitingSub: "MARAS bir sonraki adımı atayacak. Şu an yapılacak bir şey yok.",
    deliveredDone: "Teslimat tamamlandı",
    deliveredDoneSub: "Başka durum güncellemesi gerekmiyor. Belgeler ve sorular için mesajlaşma açık kalır.",
    closedDone: "Sefer kapatıldı",
    closedDoneSub: "Bu sefer tamamlandı ve kilitlendi. Mesajlar salt okunur.",
    sending: "Gönderiliyor…",
  },
  ar: {
    accept: "قبول المهمة",
    decline: "رفض",
    acceptPrompt: "تم تعيين مهمة جديدة لك. اقبلها للبدء.",
    confirmTitle: (a) => `تأكيد: ${a}؟`,
    confirm: "نعم، أؤكد",
    back: "ليس بعد",
    waiting: "بانتظار العمليات",
    waitingSub: "ستحدد MARAS الخطوة التالية. لا يوجد إجراء مطلوب الآن.",
    deliveredDone: "اكتمل التسليم",
    deliveredDoneSub: "لا حاجة لتحديثات حالة إضافية. تبقى المحادثة مفتوحة للمستندات والاستفسارات.",
    closedDone: "المهمة مغلقة",
    closedDoneSub: "انتهت هذه المهمة وتم قفلها. المحادثة للقراءة فقط.",
    sending: "جارٍ الإرسال…",
  },
};

interface DriverNextActionProps {
  shipment: Pick<Shipment, "id" | "status" | "freightType">;
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
      <div className="bg-slate-900 border border-slate-800/60 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-200 text-start">{t.acceptPrompt}</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onDecline}
            disabled={isSubmitting}
            className="col-span-1 min-h-[56px] rounded-2xl bg-slate-950 border border-red-500/30 text-red-400 font-bold text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4 shrink-0" />
            <span>{t.decline}</span>
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isSubmitting}
            className="col-span-2 min-h-[56px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(249,115,22,0.35)] transition-all active:scale-95 cursor-pointer disabled:opacity-50 light-preserve"
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
      <div className="bg-slate-900 border border-slate-800/60 rounded-2xl p-4 flex items-center gap-3 text-start">
        <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-200">{t.waiting}</p>
          <p className="text-xs text-slate-400 mt-0.5 leading-snug">{t.waitingSub}</p>
        </div>
      </div>
    );
  }

  const action = getDriverNextAction(shipment.status, shipment.freightType);

  if (!action) {
    const closed = isShipmentClosed(shipment.status, shipment.freightType);
    return (
      <div className="bg-slate-900 border border-slate-800/60 rounded-2xl p-4 flex items-center gap-3 text-start">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${
            closed
              ? "bg-slate-800 border-slate-700 text-slate-400"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          }`}
        >
          {closed ? <Lock className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-200">{closed ? t.closedDone : t.deliveredDone}</p>
          <p className="text-xs text-slate-400 mt-0.5 leading-snug">{closed ? t.closedDoneSub : t.deliveredDoneSub}</p>
        </div>
      </div>
    );
  }

  const actionLabel = localizeNextActionLabel(action, lang);

  if (confirming) {
    return (
      <div className="bg-slate-900 border border-orange-500/40 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold text-slate-200 text-start">{t.confirmTitle(actionLabel)}</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isSubmitting}
            className="col-span-1 min-h-[56px] rounded-2xl bg-slate-950 border border-slate-700 text-slate-300 font-bold text-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {t.back}
          </button>
          <button
            type="button"
            onClick={onSubmitNextStatus}
            disabled={isSubmitting}
            className="col-span-2 min-h-[56px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(249,115,22,0.35)] transition-all active:scale-95 cursor-pointer disabled:opacity-50 light-preserve"
          >
            <Check className="w-5 h-5 shrink-0" />
            <span>{isSubmitting ? t.sending : t.confirm}</span>
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
      <CheckCircle2 className="w-6 h-6 shrink-0" />
      <span>{actionLabel}</span>
    </button>
  );
}
