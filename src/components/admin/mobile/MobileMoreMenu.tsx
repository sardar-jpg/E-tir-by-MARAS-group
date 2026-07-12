import { useState, type ComponentType } from 'react';
import { Bell, LogOut, ChevronRight, ChevronLeft, ChevronDown, Clock, FileText, Receipt, FileStack, Share2, Globe } from 'lucide-react';
import type { Language } from '../../../types';

export interface MoreMenuTab {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface MobileMoreMenuProps {
  lang: Language;
  isRtl: boolean;
  /** Real, already role-filtered tabs to show as working links — built by resolveMoreMenuTabIds from AdminPanel's own filteredAdminTabs, plus 'team' when the role is allowed it. */
  tabs: MoreMenuTab[];
  onSelectTab: (id: string) => void;
  unreadNotifications: number;
  onOpenNotifications: () => void;
  onLogout?: () => void;
  /** feature/admin-mobile-ui correction pass: App.tsx's own language
      <select> (outer header) is hidden on mobile now — this is mobile's
      replacement, a compact segmented control right below the title. */
  onLangChange?: (lang: Language) => void;
}

// feature/admin-mobile-ui: labels the confirmed spec asks for that this
// codebase doesn't have a matching real tab for at all — no component,
// no route (see the investigation this PR is based on). Shown as
// visibly disabled "Coming Soon" entries rather than either being
// silently omitted (the spec explicitly lists them) or wired to a page
// that doesn't exist (would be a broken link / fabricated feature).
const COMING_SOON_ITEMS: { key: string; icon: ComponentType<{ className?: string }>; label: Record<Language, string> }[] = [
  { key: 'sales_inquiries', icon: FileText, label: { en: 'Sales Inquiries', ar: 'استفسارات المبيعات', tr: 'Satış Talepleri' } },
  { key: 'quotations', icon: FileStack, label: { en: 'Quotations', ar: 'عروض الأسعار', tr: 'Teklifler' } },
  { key: 'documents', icon: FileStack, label: { en: 'Documents', ar: 'المستندات', tr: 'Belgeler' } },
  { key: 'invoices', icon: Receipt, label: { en: 'Invoices', ar: 'الفواتير', tr: 'Faturalar' } },
  { key: 'shared_view', icon: Share2, label: { en: 'Shared View', ar: 'العرض المشترك', tr: 'Paylaşılan Görünüm' } },
];

const TITLE: Record<Language, string> = { en: 'More', ar: 'المزيد', tr: 'Daha Fazla' };
const NOTIFICATIONS_LABEL: Record<Language, string> = { en: 'Notifications', ar: 'الإشعارات', tr: 'Bildirimler' };
const LOGOUT_LABEL: Record<Language, string> = { en: 'Logout', ar: 'تسجيل الخروج', tr: 'Çıkış Yap' };
const COMING_SOON_BADGE: Record<Language, string> = { en: 'Soon', ar: 'قريباً', tr: 'Yakında' };
const COMING_SOON_SECTION_LABEL: Record<Language, string> = { en: 'Coming Soon', ar: 'قريباً', tr: 'Yakında Gelecek' };

const LANG_OPTIONS: { id: Language; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'tr', label: 'TR' },
  { id: 'ar', label: 'AR' },
];

/**
 * feature/admin-mobile-ui: full-screen "More" page opened from the
 * bottom nav's 5th slot. Content is built entirely from tabs AdminPanel
 * already computed and role-filtered (src/lib/adminAccess.ts) — this
 * component adds no permission logic of its own, and the "Coming Soon"
 * items are inert (no onClick, no route) so they can never be mistaken
 * for a working feature.
 *
 * Correction pass: title is sticky (page is long enough to scroll), row
 * padding is tighter, "Coming Soon" is a collapsed-by-default disclosure
 * instead of always-open, and a compact language switcher replaces the
 * one that used to live in App.tsx's now-mobile-hidden outer header.
 */
export default function MobileMoreMenu({ lang, isRtl, tabs, onSelectTab, unreadNotifications, onOpenNotifications, onLogout, onLangChange }: MobileMoreMenuProps) {
  const ChevronIcon = isRtl ? ChevronLeft : ChevronRight;
  const [isComingSoonOpen, setIsComingSoonOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <h2 className="sticky top-0 z-10 -mx-4 px-4 py-2.5 bg-slate-50/95 backdrop-blur-xs text-base font-extrabold text-slate-900 mb-3 border-b border-slate-200">
        {TITLE[lang] ?? TITLE.en}
      </h2>

      {onLangChange && (
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 shadow-xs px-3 py-2 mb-3">
          <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="flex-1 grid grid-cols-3 gap-1">
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onLangChange(opt.id)}
                className={`min-h-[32px] rounded-lg text-xs font-black tracking-wide cursor-pointer border-0 transition-all ${
                  lang === opt.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100 mb-3">
        <button
          type="button"
          onClick={onOpenNotifications}
          className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-start cursor-pointer bg-transparent border-0"
        >
          <span className="w-8 h-8 shrink-0 flex items-center justify-center bg-orange-50 text-orange-500 rounded-lg">
            <Bell className="w-4 h-4" />
          </span>
          <span className="flex-1 font-bold text-sm text-slate-800">{NOTIFICATIONS_LABEL[lang] ?? NOTIFICATIONS_LABEL.en}</span>
          {unreadNotifications > 0 && (
            <span className="bg-orange-500 text-white font-bold text-[10px] min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center">
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
          <ChevronIcon className="w-4 h-4 text-slate-300 shrink-0" />
        </button>

        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-start cursor-pointer bg-transparent border-0"
            >
              <span className="w-8 h-8 shrink-0 flex items-center justify-center bg-slate-100 text-slate-600 rounded-lg">
                <Icon className="w-4 h-4" />
              </span>
              <span className="flex-1 font-bold text-sm text-slate-800 truncate">{tab.label}</span>
              <ChevronIcon className="w-4 h-4 text-slate-300 shrink-0" />
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-3">
        <button
          type="button"
          onClick={() => setIsComingSoonOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] cursor-pointer bg-transparent border-0"
        >
          <span className="w-8 h-8 shrink-0 flex items-center justify-center bg-slate-100 text-slate-400 rounded-lg">
            <Clock className="w-4 h-4" />
          </span>
          <span className="flex-1 font-bold text-sm text-slate-500 text-start">{COMING_SOON_SECTION_LABEL[lang] ?? COMING_SOON_SECTION_LABEL.en}</span>
          <ChevronDown className={`w-4 h-4 text-slate-300 shrink-0 transition-transform ${isComingSoonOpen ? 'rotate-180' : ''}`} />
        </button>

        {isComingSoonOpen && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {COMING_SOON_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.key}
                  aria-disabled="true"
                  className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] opacity-50 cursor-not-allowed select-none"
                >
                  <span className="w-8 h-8 shrink-0 flex items-center justify-center bg-slate-100 text-slate-400 rounded-lg">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 font-bold text-sm text-slate-500 truncate">{item.label[lang] ?? item.label.en}</span>
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                    {COMING_SOON_BADGE[lang] ?? COMING_SOON_BADGE.en}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] bg-white hover:bg-red-50 border border-red-200 text-red-500 font-bold text-sm rounded-xl cursor-pointer shadow-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>{LOGOUT_LABEL[lang] ?? LOGOUT_LABEL.en}</span>
        </button>
      )}
    </div>
  );
}
