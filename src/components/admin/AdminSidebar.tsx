import type { ComponentType } from 'react';
import { Ship, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Language } from '../../types';

export interface AdminSidebarTab {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface AdminSidebarProps {
  tabs: AdminSidebarTab[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  lang: Language;
  isRtl: boolean;
  /** Desktop-only: icons-only vs icon+label. Persisted by the caller. */
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** Mobile/tablet-only: off-canvas drawer open state. */
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

type GroupKey = 'operations' | 'business' | 'system';

// Fixed grouping/order for the sidebar — independent of the order tabs are
// filtered in, so role-based filtering (done by the caller) keeps working
// unchanged and only decides which of these ids are present.
const GROUPS: { key: GroupKey; ids: string[] }[] = [
  { key: 'operations', ids: ['dashboard', 'shipments', 'tracking_map', 'drivers', 'chat_center'] },
  { key: 'business', ids: ['clients', 'vendors', 'costs', 'reports'] },
  { key: 'system', ids: ['settings', 'gmail', 'audit', 'team', 'my_account'] },
];

/**
 * BUG-24: GROUPS above is a second, hand-maintained list of tab ids that
 * has to be kept in sync with AdminPanel's rawTabs — nothing enforced that,
 * so a tab added to rawTabs without a matching GROUPS entry would silently
 * vanish from the desktop sidebar (it'd still show up in the mobile tab
 * bar, which renders straight off rawTabs). Exported so both a dev-time
 * check and a unit test can catch that drift instead of it only surfacing
 * as "why isn't my new tab in the sidebar".
 */
export function findUngroupedTabIds(tabIds: string[]): string[] {
  const grouped = new Set(GROUPS.flatMap((group) => group.ids));
  return tabIds.filter((id) => !grouped.has(id));
}

const GROUP_LABELS: Record<GroupKey, Record<Language, string>> = {
  operations: { en: 'Operations', tr: 'Operasyonlar', ar: 'العمليات' },
  business: { en: 'Business', tr: 'İşletme', ar: 'الأعمال' },
  system: { en: 'System', tr: 'Sistem', ar: 'النظام' },
};

const PANEL_LABEL: Record<Language, string> = {
  en: 'Admin Panel',
  tr: 'Yönetim Paneli',
  ar: 'لوحة الإدارة',
};

const COLLAPSE_LABEL: Record<Language, { collapse: string; expand: string }> = {
  en: { collapse: 'Collapse sidebar', expand: 'Expand sidebar' },
  tr: { collapse: 'Kenar çubuğunu daralt', expand: 'Kenar çubuğunu genişlet' },
  ar: { collapse: 'طي الشريط الجانبي', expand: 'توسيع الشريط الجانبي' },
};

const CLOSE_MENU_LABEL: Record<Language, string> = {
  en: 'Close menu',
  tr: 'Menüyü kapat',
  ar: 'إغلاق القائمة',
};

/**
 * Renders one nav item. Shared between the desktop aside (collapsible) and
 * the mobile drawer (always icon+label — space isn't the constraint there,
 * a fully expanded touch target is) so both stay in sync automatically
 * instead of drifting into two hand-maintained copies.
 */
function NavButton({
  tab,
  isActive,
  isRtl,
  showLabel,
  onClick,
}: {
  tab: AdminSidebarTab;
  isActive: boolean;
  isRtl: boolean;
  showLabel: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      title={tab.label}
      aria-current={isActive ? 'page' : undefined}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm font-semibold transition-all min-h-[44px] ${
        showLabel ? (isRtl ? 'text-right' : 'text-left') : 'justify-center'
      } ${
        isActive
          ? 'bg-orange-500 text-white shadow-sm'
          : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {showLabel && <span className="truncate">{tab.label}</span>}
    </button>
  );
}

function NavGroups({
  tabs,
  activeTab,
  onSelectTab,
  lang,
  isRtl,
  showLabel,
}: {
  tabs: AdminSidebarTab[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  lang: Language;
  isRtl: boolean;
  showLabel: boolean;
}) {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));

  return (
    <>
      {GROUPS.map((group) => {
        const groupTabs = group.ids
          .map((id) => byId.get(id))
          .filter((tab): tab is AdminSidebarTab => Boolean(tab));

        if (groupTabs.length === 0) return null;

        return (
          <div key={group.key}>
            {showLabel && (
              <p className="px-2.5 mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {GROUP_LABELS[group.key][lang] ?? GROUP_LABELS[group.key].en}
              </p>
            )}
            <div className="space-y-0.5">
              {groupTabs.map((tab) => (
                <NavButton
                  key={tab.id}
                  tab={tab}
                  isActive={activeTab === tab.id}
                  isRtl={isRtl}
                  showLabel={showLabel}
                  onClick={() => onSelectTab(tab.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export default function AdminSidebar({
  tabs,
  activeTab,
  onSelectTab,
  lang,
  isRtl,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}: AdminSidebarProps) {
  const showLabel = !isCollapsed;
  // Same physical edge as the collapse toggle should point to for
  // "close towards the edge the panel opens from" — RTL flips which
  // chevron means collapse vs. expand.
  const CollapseIcon = isRtl ? (isCollapsed ? ChevronLeft : ChevronRight) : (isCollapsed ? ChevronRight : ChevronLeft);

  return (
    <>
      <aside
        className={`hidden lg:flex lg:flex-col shrink-0 sticky top-0 h-screen bg-slate-900 ${isRtl ? 'border-l' : 'border-r'} border-slate-800 transition-[width] duration-200 ${
          isCollapsed ? 'w-[76px]' : 'w-64'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className={`px-3 py-6 border-b border-slate-800/80 flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 px-5'}`}>
          <span className="w-9 h-9 shrink-0 flex items-center justify-center bg-orange-500 text-white rounded-lg">
            <Ship className="w-4.5 h-4.5" />
          </span>
          {showLabel && (
            <div className="leading-tight min-w-0">
              <p className="font-extrabold text-white text-sm tracking-tight truncate">MARAS / eTIR</p>
              <p className="text-[11px] text-slate-400 font-semibold truncate">{PANEL_LABEL[lang] ?? PANEL_LABEL.en}</p>
            </div>
          )}
        </div>

        <nav className={`flex-1 py-4 space-y-6 overflow-y-auto ${isCollapsed ? 'px-2' : 'px-3'}`}>
          <NavGroups tabs={tabs} activeTab={activeTab} onSelectTab={onSelectTab} lang={lang} isRtl={isRtl} showLabel={showLabel} />
        </nav>

        <div className={`border-t border-slate-800/80 p-2 ${isCollapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? COLLAPSE_LABEL[lang]?.expand ?? COLLAPSE_LABEL.en.expand : COLLAPSE_LABEL[lang]?.collapse ?? COLLAPSE_LABEL.en.collapse}
            aria-label={isCollapsed ? COLLAPSE_LABEL[lang]?.expand ?? COLLAPSE_LABEL.en.expand : COLLAPSE_LABEL[lang]?.collapse ?? COLLAPSE_LABEL.en.collapse}
            aria-expanded={!isCollapsed}
            className={`flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-all min-h-[40px] ${
              isCollapsed ? 'w-10 justify-center' : 'w-full px-2.5 justify-start'
            }`}
          >
            <CollapseIcon className="w-4 h-4 shrink-0" />
            {showLabel && <span className="text-xs font-semibold">{COLLAPSE_LABEL[lang]?.collapse ?? COLLAPSE_LABEL.en.collapse}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile/tablet drawer — off-canvas, opened by AdminPanel's header
          Menu button. Role filtering is identical to the desktop aside
          (same `tabs` prop, same NavGroups renderer), so the drawer can
          never show a section the desktop sidebar hides. */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside
            className={`absolute top-0 bottom-0 w-72 max-w-[82vw] bg-slate-900 flex flex-col shadow-2xl ${isRtl ? 'right-0 border-l' : 'left-0 border-r'} border-slate-800`}
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="px-4 py-4 border-b border-slate-800/80 flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 shrink-0 flex items-center justify-center bg-orange-500 text-white rounded-lg">
                  <Ship className="w-4.5 h-4.5" />
                </span>
                <div className="leading-tight min-w-0">
                  <p className="font-extrabold text-white text-sm tracking-tight truncate">MARAS / eTIR</p>
                  <p className="text-[11px] text-slate-400 font-semibold truncate">{PANEL_LABEL[lang] ?? PANEL_LABEL.en}</p>
                </div>
              </div>
              <button
                onClick={onCloseMobile}
                title={CLOSE_MENU_LABEL[lang] ?? CLOSE_MENU_LABEL.en}
                aria-label={CLOSE_MENU_LABEL[lang] ?? CLOSE_MENU_LABEL.en}
                className="w-9 h-9 shrink-0 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-all"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <nav className="flex-1 py-4 px-3 space-y-6 overflow-y-auto">
              <NavGroups
                tabs={tabs}
                activeTab={activeTab}
                onSelectTab={(id) => {
                  onSelectTab(id);
                  onCloseMobile();
                }}
                lang={lang}
                isRtl={isRtl}
                showLabel
              />
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
