import type { AppNotification, Language } from '../../types';

interface NotificationsPanelProps {
  notifications: AppNotification[];
  lang: Language;
  title: string;
  onBack: () => void;
}

export default function NotificationsPanel({ notifications, lang, title, onBack }: NotificationsPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wide">{title}</h3>
        <button onClick={onBack} className="text-[10px] text-slate-500 hover:text-white font-bold bg-slate-900 px-2 py-0.5 rounded">Back</button>
      </div>
      <div className="space-y-2">
        {notifications.map((n) => (
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
        {notifications.length === 0 && (
          <p className="text-xs text-slate-500 italic text-center py-10">No alerts logged yet.</p>
        )}
      </div>
    </div>
  );
}
