import { Briefcase, ChevronRight, MessageSquare } from "lucide-react";
import type { Language } from "../../types";

/**
 * Driver App V2 — the Chat tab's informational state when the driver has
 * no accepted operational job. No conversation exists (and none is
 * created) during the offer stage or before the driver accepts an
 * assigned job — this screen says so plainly and routes to the Job
 * section. No support contact, no customer chat, no general chat.
 */
const LABELS: Record<Language, { title: string; body: string; openJob: string }> = {
  en: {
    title: "No shipment chat yet",
    body: "Shipment chat becomes available after you accept an assigned job.",
    openJob: "Open Job",
  },
  tr: {
    title: "Henüz sevkiyat sohbeti yok",
    body: "Sevkiyat mesajlaşması, atanan bir işi kabul etmenizden sonra açılır.",
    openJob: "Sefere Git",
  },
  ar: {
    title: "لا توجد محادثة شحنة بعد",
    body: "تعمل محادثة الشحنة بعد قبول العمل.",
    openJob: "فتح المهمة",
  },
};

interface DriverChatEmptyStateProps {
  lang: Language;
  onOpenJob: () => void;
}

export default function DriverChatEmptyState({ lang, onOpenJob }: DriverChatEmptyStateProps) {
  const t = LABELS[lang] ?? LABELS.en;
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-[320px] py-12 text-center space-y-4 bg-white rounded-3xl p-6 border border-slate-200">
        <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto">
          <MessageSquare className="w-7 h-7 text-slate-600 shrink-0" />
        </div>
        <div>
          <p className="text-base font-bold text-slate-800">{t.title}</p>
          <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">{t.body}</p>
        </div>
        <button
          type="button"
          onClick={onOpenJob}
          className="w-full min-h-[56px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(249,115,22,0.35)] transition-all active:scale-[0.98] cursor-pointer"
        >
          <Briefcase className="w-5 h-5 shrink-0" />
          <span>{t.openJob}</span>
          <ChevronRight className="w-5 h-5 shrink-0 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}
