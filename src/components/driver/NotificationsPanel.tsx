import { ArrowLeft, Bell } from 'lucide-react';
import type { AppNotification, Language } from '../../types';

const LABELS: Record<Language, { back: string; empty: string }> = {
  en: { back: 'Back', empty: 'No notifications yet.' },
  tr: { back: 'Geri', empty: 'Henüz bildirim yok.' },
  ar: { back: 'رجوع', empty: 'لا توجد إشعارات بعد.' },
};

interface NotificationsPanelProps {
  notifications: AppNotification[];
  lang: Language;
  title: string;
  onBack: () => void;
  /**
   * Deep-link: tapping a notification jumps to the screen it is about
   * (an offer notification opens the Job section and highlights the
   * offer; a chat notification opens that shipment's thread). Uses the
   * EXISTING notification contract only — the record's type and
   * shipmentId — so a future push-notification tap can reuse the same
   * routing.
   */
  onOpenNotification?: (n: AppNotification) => void;
}

export default function NotificationsPanel({ notifications, lang, title, onBack, onOpenNotification }: NotificationsPanelProps) {
  const t = LABELS[lang] ?? LABELS.en;
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-200 text-base text-start">{title}</h3>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 text-sm text-slate-300 hover:text-white font-bold bg-slate-900 border border-slate-800/60 rounded-2xl cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          <span>{t.back}</span>
        </button>
      </div>
      <div className="space-y-2">
        {notifications.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onOpenNotification?.(n)}
            className="w-full p-3.5 bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-2xl space-y-1 text-start transition-colors cursor-pointer active:scale-[0.99]"
          >
            <div className="flex items-center justify-between">
              {n.shipmentNumber ? (
                <span className="bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold px-2 py-0.5 rounded-lg">#{n.shipmentNumber}</span>
              ) : <span />}
              <span className="text-xs text-slate-500">{new Date(n.timestamp).toLocaleDateString()}</span>
            </div>
            <p className="font-bold text-slate-200 text-sm">
              {lang === 'en' ? n.titleEn : (lang === 'tr' ? n.titleTr : n.titleAr)}
            </p>
            <p className="text-sm text-slate-400 leading-snug">
              {lang === 'en' ? n.messageEn : (lang === 'tr' ? n.messageTr : n.messageAr)}
            </p>
          </button>
        ))}
        {notifications.length === 0 && (
          <div className="py-14 text-center space-y-3">
            <Bell className="w-8 h-8 text-slate-700 mx-auto" />
            <p className="text-sm text-slate-500">{t.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}
