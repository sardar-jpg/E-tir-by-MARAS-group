import { Bell, MessageSquare, FileText, ClipboardList, RefreshCw, X } from 'lucide-react';
import type { AppNotification, Language, Shipment } from '../../../types';

interface MobileNotificationsSheetProps {
  lang: Language;
  isRtl: boolean;
  notifications: AppNotification[];
  shipments: Shipment[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onMarkOneRead: (id: string) => void;
  onOpenChat: (shipment: Shipment, channel: AppNotification['channel']) => void;
}

/**
 * feature/admin-mobile-ui: full-screen notifications sheet opened from
 * MobileTopAppBar's bell (and the More menu's Notifications row). The
 * desktop notification dropdown (rendered inside the now
 * `hidden lg:flex` "Admin Quick Action Header") stays exactly as-is for
 * desktop; this is a separate, mobile-appropriate rendering of the same
 * `notifications` state and the same mark-read/open-chat handlers
 * AdminPanel already owns — no new notification logic is introduced.
 */
export default function MobileNotificationsSheet({
  lang,
  isRtl,
  notifications,
  shipments,
  onClose,
  onMarkAllRead,
  onMarkOneRead,
  onOpenChat,
}: MobileNotificationsSheetProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-white flex flex-col" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 min-h-[52px] shrink-0">
        <div className="flex items-center gap-1.5 font-extrabold text-sm text-slate-900">
          <Bell className="w-4 h-4 text-slate-600" />
          <span>{lang === 'tr' ? 'Bildirimler' : lang === 'ar' ? 'الإشعارات' : 'Notifications'}</span>
          {unreadCount > 0 && (
            <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-bold">
              {unreadCount} {lang === 'tr' ? 'yeni' : lang === 'ar' ? 'جديد' : 'new'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-xs text-orange-500 hover:text-orange-600 font-bold cursor-pointer border-0 bg-transparent"
            >
              {lang === 'tr' ? 'Tümünü okundu işaretle' : lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all as read'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'tr' ? 'Kapat' : lang === 'ar' ? 'إغلاق' : 'Close'}
            className="w-9 h-9 shrink-0 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-lg cursor-pointer border-0 bg-transparent"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-24">
        {notifications.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            {lang === 'tr' ? 'Henüz bildirim yok.' : lang === 'ar' ? 'لا توجد إشعارات حالياً.' : 'No recent notifications.'}
          </div>
        ) : (
          notifications.map((notif) => {
            const shipment = shipments.find((s) => s.id === notif.shipmentId);
            const isUnread = !notif.read;
            return (
              <div
                key={notif.id}
                className={`p-3 rounded-xl border text-xs transition-all ${
                  isUnread ? 'bg-orange-50/40 border-orange-100' : 'bg-slate-50/50 border-slate-100'
                }`}
              >
                <div className="flex gap-2">
                  <span className="mt-0.5 shrink-0">
                    {notif.type === 'chat' && <MessageSquare className="w-4 h-4 text-orange-500" />}
                    {notif.type === 'doc_upload' && <FileText className="w-4 h-4 text-orange-500" />}
                    {notif.type === 'assignment' && <ClipboardList className="w-4 h-4 text-green-500" />}
                    {notif.type === 'status_update' && <RefreshCw className="w-4 h-4 text-purple-500" />}
                    {notif.type !== 'chat' && notif.type !== 'doc_upload' && notif.type !== 'assignment' && notif.type !== 'status_update' && (
                      <Bell className="w-4 h-4 text-slate-400" />
                    )}
                  </span>
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-800">
                        {lang === 'tr' ? notif.titleTr : lang === 'ar' ? notif.titleAr : notif.titleEn}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {new Date(notif.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-600 font-medium leading-normal">
                      {lang === 'tr' ? notif.messageTr : lang === 'ar' ? notif.messageAr : notif.messageEn}
                    </p>
                    <div className="flex items-center gap-3 pt-1 border-t border-slate-100/60 mt-1">
                      {shipment && (
                        <button
                          type="button"
                          onClick={() => onOpenChat(shipment, notif.channel)}
                          className="text-[10px] text-orange-600 hover:text-orange-700 font-extrabold flex items-center gap-0.5 cursor-pointer bg-transparent border-0"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>{lang === 'tr' ? 'Sohbeti Aç' : lang === 'ar' ? 'فتح المحادثة' : 'Open Chat'}</span>
                        </button>
                      )}
                      {isUnread && (
                        <button
                          type="button"
                          onClick={() => onMarkOneRead(notif.id)}
                          className="text-[10px] text-slate-400 hover:text-slate-600 font-bold cursor-pointer bg-transparent border-0"
                        >
                          {lang === 'tr' ? 'Okundu' : lang === 'ar' ? 'مقروء' : 'Dismiss'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
