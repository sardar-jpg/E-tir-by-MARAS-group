import type { ComponentType } from 'react';
import { Ship, Bell, BellRing, ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import type { Language } from '../../../types';

interface MobileTopAppBarProps {
  lang: Language;
  isRtl: boolean;
  title: string;
  TitleIcon?: ComponentType<{ className?: string }>;
  unreadNotifications: number;
  onBellClick: () => void;
  onMenuClick: () => void;
  /** Optional back button for detail-style pages (e.g. an open order). Omit for the 5 primary tab pages. */
  onBack?: () => void;
}

/**
 * feature/admin-mobile-ui: fixed top app bar for the mobile Admin shell.
 * Sits below the app's own persistent outer header (App.tsx — brand,
 * language switch, Logout — already responsive and always visible above
 * AdminPanel), so this bar focuses on page-level context rather than
 * re-duplicating the full brand treatment: a compact brand mark, the
 * current page's title (from the same filteredAdminTabs AdminPanel
 * already computes), the notification bell (same state/data as the
 * desktop bell — this component only renders the trigger; the dropdown
 * panel itself stays in AdminPanel.tsx, positioned for this bar), and a
 * quick-access menu button that opens the same "More" sheet as the
 * bottom nav's More item.
 */
export default function MobileTopAppBar({
  lang,
  isRtl,
  title,
  TitleIcon,
  unreadNotifications,
  onBellClick,
  onMenuClick,
  onBack,
}: MobileTopAppBarProps) {
  const BackIcon = isRtl ? ChevronRight : ChevronLeft;
  return (
    <div className="lg:hidden sticky top-0 z-30 flex items-center gap-2 bg-white border-b border-slate-200 px-3 py-2.5 min-h-[52px]">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={lang === 'tr' ? 'Geri' : (lang === 'ar' ? 'رجوع' : 'Back')}
          className="w-9 h-9 shrink-0 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer border-0 bg-transparent"
        >
          <BackIcon className="w-5 h-5" />
        </button>
      ) : (
        <span className="w-8 h-8 shrink-0 flex items-center justify-center bg-slate-900 text-white rounded-lg">
          <Ship className="w-4 h-4" />
        </span>
      )}

      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        {TitleIcon && !onBack && <TitleIcon className="w-4 h-4 text-orange-500 shrink-0" />}
        <span className="font-extrabold text-sm text-slate-900 truncate">{title}</span>
      </div>

      <button
        type="button"
        onClick={onBellClick}
        aria-label={lang === 'tr' ? 'Bildirimler' : (lang === 'ar' ? 'الإشعارات' : 'Notifications')}
        className="relative w-9 h-9 shrink-0 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer border-0 bg-transparent"
      >
        {unreadNotifications > 0 ? (
          <BellRing className="w-4.5 h-4.5 text-orange-500" />
        ) : (
          <Bell className="w-4.5 h-4.5" />
        )}
        {unreadNotifications > 0 && (
          <span className="absolute top-1 end-1 bg-orange-500 text-white font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center border-2 border-white">
            {unreadNotifications > 9 ? '9+' : unreadNotifications}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onMenuClick}
        aria-label={lang === 'tr' ? 'Menü' : (lang === 'ar' ? 'القائمة' : 'Menu')}
        className="w-9 h-9 shrink-0 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer border-0 bg-transparent"
      >
        <Menu className="w-4.5 h-4.5" />
      </button>
    </div>
  );
}
