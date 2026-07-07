import type { ComponentType } from 'react';
import { Ship } from 'lucide-react';
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
}

type GroupKey = 'operations' | 'business' | 'system';

// Fixed grouping/order for the sidebar — independent of the order tabs are
// filtered in, so role-based filtering (done by the caller) keeps working
// unchanged and only decides which of these ids are present.
const GROUPS: { key: GroupKey; ids: string[] }[] = [
  { key: 'operations', ids: ['dashboard', 'shipments', 'tracking_map', 'drivers'] },
  { key: 'business', ids: ['clients', 'vendors', 'costs', 'reports'] },
  { key: 'system', ids: ['gmail', 'audit', 'team', 'my_account'] },
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

export default function AdminSidebar({ tabs, activeTab, onSelectTab, lang, isRtl }: AdminSidebarProps) {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));

  return (
    <aside
      className={`hidden lg:flex lg:flex-col w-64 shrink-0 bg-slate-900 ${isRtl ? 'border-l' : 'border-r'} border-slate-800`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="px-5 py-6 border-b border-slate-800/80 flex items-center gap-2.5">
        <span className="w-9 h-9 shrink-0 flex items-center justify-center bg-orange-500 text-white rounded-lg">
          <Ship className="w-4.5 h-4.5" />
        </span>
        <div className="leading-tight min-w-0">
          <p className="font-extrabold text-white text-sm tracking-tight truncate">MARAS / eTIR</p>
          <p className="text-[11px] text-slate-400 font-semibold truncate">{PANEL_LABEL[lang] ?? PANEL_LABEL.en}</p>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-6 overflow-y-auto">
        {GROUPS.map((group) => {
          const groupTabs = group.ids
            .map((id) => byId.get(id))
            .filter((tab): tab is AdminSidebarTab => Boolean(tab));

          if (groupTabs.length === 0) return null;

          return (
            <div key={group.key}>
              <p className="px-2.5 mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {GROUP_LABELS[group.key][lang] ?? GROUP_LABELS[group.key].en}
              </p>
              <div className="space-y-0.5">
                {groupTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => onSelectTab(tab.id)}
                      title={tab.label}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-semibold transition-all ${isRtl ? 'text-right' : 'text-left'} ${
                        isActive
                          ? 'bg-orange-500 text-white shadow-sm'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
