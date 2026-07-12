import type { ComponentType } from 'react';
import { LayoutGrid, Ship, Map as MapIcon, MessageSquare, MoreHorizontal } from 'lucide-react';
import type { Language } from '../../../types';
import { resolvePrimaryMobileTabs, isMoreTabActive, type MobileNavTab } from '../../../lib/mobileAdminNav';
import { formatUnreadBadge } from '../../../lib/chatUnreadAccess';

export interface MobileNavTabEntry {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface MobileBottomNavProps {
  lang: Language;
  tabs: MobileNavTabEntry[];
  activeTab: string;
  isMoreOpen: boolean;
  onSelectTab: (id: string) => void;
  onOpenMore: () => void;
  /** feature/admin-mobile-ui correction pass: tab id -> unread count.
      Today only 'chat_center' is populated (from AdminPanel's own
      per-admin unreadChatMessages — src/lib/chatUnreadAccess.ts), same
      source as every other chat unread badge in the app, so this one
      stays in sync with the rest automatically. Any id not present here
      renders no badge. */
  badges?: Record<string, number>;
}

// Short, canonical bottom-nav labels for the 4 primary slots — the
// existing desktop tab labels (e.g. "Shipment Management" for
// 'shipments') are too long for a 5-column bottom bar, so this bar uses
// its own short wording per the confirmed spec, while everything else
// (permission gating, which tab is active, what tapping it does) is
// still driven entirely by the shared `tabs`/`activeTab` from AdminPanel.
const PRIMARY_LABELS: Record<string, Record<Language, string>> = {
  dashboard: { en: 'Dashboard', ar: 'الرئيسية', tr: 'Ana Sayfa' },
  shipments: { en: 'Orders', ar: 'الطلبات', tr: 'Siparişler' },
  tracking_map: { en: 'Tracking', ar: 'التتبع', tr: 'Takip' },
  chat_center: { en: 'Chat', ar: 'المحادثات', tr: 'Sohbet' },
};

const MORE_LABEL: Record<Language, string> = { en: 'More', ar: 'المزيد', tr: 'Daha Fazla' };

const PRIMARY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  dashboard: LayoutGrid,
  shipments: Ship,
  tracking_map: MapIcon,
  chat_center: MessageSquare,
};

/**
 * feature/admin-mobile-ui: fixed 5-item bottom nav for the mobile Admin
 * shell, mirroring the structure already established by
 * src/components/driver/DriverBottomNav.tsx (grid-cols-5, active-dot
 * indicator, safe-area-bottom padding) but in the Admin app's light
 * design language rather than the Driver app's dark theme. The 4
 * primary slots are resolved by resolvePrimaryMobileTabs (pure,
 * tested) — never hardcoded — so a role missing one of the ideal 4
 * (Accounts admins have none of dashboard/shipments/tracking_map/
 * chat_center) still gets a fully populated, role-correct bar instead
 * of empty/dead slots.
 */
export default function MobileBottomNav({ lang, tabs, activeTab, isMoreOpen, onSelectTab, onOpenMore, badges }: MobileBottomNavProps) {
  const primaryIds = resolvePrimaryMobileTabs(tabs as MobileNavTab[]);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const moreActive = isMoreOpen || isMoreTabActive(activeTab, primaryIds);

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-white border-t border-slate-200 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-2px_12px_rgba(15,23,42,0.06)]"
      aria-label={MORE_LABEL[lang] ?? MORE_LABEL.en}
    >
      {primaryIds.map((id) => {
        const tab = byId.get(id);
        if (!tab) return null;
        const Icon = PRIMARY_ICONS[id] ?? tab.icon;
        const isActive = !isMoreOpen && activeTab === id;
        const label = PRIMARY_LABELS[id]?.[lang] ?? PRIMARY_LABELS[id]?.en ?? tab.label;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectTab(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-1 min-h-[44px] py-1.5 text-[10px] font-bold transition-all cursor-pointer bg-transparent border-0 ${
              isActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <div className="relative flex flex-col items-center">
              <Icon className={`w-5 h-5 shrink-0 transition-transform ${isActive ? 'text-orange-500 scale-110' : ''}`} />
              {isActive && <span className="absolute -bottom-1.5 w-4 h-0.5 bg-orange-500 rounded-full" />}
              {formatUnreadBadge(badges?.[id] ?? 0) && (
                <span className="absolute -top-1.5 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center border-2 border-white">
                  {formatUnreadBadge(badges?.[id] ?? 0)}
                </span>
              )}
            </div>
            <span className="mt-1 truncate max-w-full px-0.5">{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenMore}
        aria-current={moreActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center gap-1 min-h-[44px] py-1.5 text-[10px] font-bold transition-all cursor-pointer bg-transparent border-0 ${
          moreActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <div className="relative flex flex-col items-center">
          <MoreHorizontal className={`w-5 h-5 shrink-0 transition-transform ${moreActive ? 'text-orange-500 scale-110' : ''}`} />
          {moreActive && <span className="absolute -bottom-1.5 w-4 h-0.5 bg-orange-500 rounded-full" />}
        </div>
        <span className="mt-1">{MORE_LABEL[lang] ?? MORE_LABEL.en}</span>
      </button>
    </nav>
  );
}
