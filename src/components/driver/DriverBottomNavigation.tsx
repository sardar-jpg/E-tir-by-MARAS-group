import { Home, Briefcase, MessageSquare, User } from "lucide-react";
import type { Language } from "../../types";

/**
 * Driver App V2 — the bottom navigation has exactly four sections:
 * Home, Job, Chat, Profile. Nothing else may be added here. Job is the
 * single operational center (offers, the assigned/active job, previous
 * jobs); its badge surfaces offers awaiting an answer. Chat is always
 * reachable (the Chat screen owns picking a job thread); its badge
 * surfaces new MARAS messages. Labels are localized, layout uses only
 * logical utilities (grid order follows the document direction, so
 * Arabic mirrors automatically), and the bar reserves the device
 * safe-area inset so it never sits under a home indicator.
 */
export type DriverTab = "home" | "job" | "chat" | "profile";

const NAV_LABELS: Record<DriverTab, Record<Language, string>> = {
  home: { en: "Home", tr: "Ana Sayfa", ar: "الرئيسية" },
  job: { en: "Job", tr: "Sefer", ar: "المهمة" },
  chat: { en: "Chat", tr: "Mesajlar", ar: "الدردشة" },
  profile: { en: "Profile", tr: "Profil", ar: "الملف" },
};

const NAV_ICONS: Record<DriverTab, typeof Home> = {
  home: Home,
  job: Briefcase,
  chat: MessageSquare,
  profile: User,
};

const TABS: DriverTab[] = ["home", "job", "chat", "profile"];

interface DriverBottomNavigationProps {
  activeTab: DriverTab;
  onSelect: (tab: DriverTab) => void;
  lang: Language;
  /** Unread MARAS chat messages across all of this driver's jobs. */
  chatUnreadCount?: number;
  /** Transport offers still awaiting this driver's answer — shown on Job. */
  pendingOffersCount?: number;
}

export default function DriverBottomNavigation({
  activeTab,
  onSelect,
  lang,
  chatUnreadCount = 0,
  pendingOffersCount = 0,
}: DriverBottomNavigationProps) {
  return (
    <nav
      aria-label={lang === "tr" ? "Ana gezinme" : lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
      className="grid grid-cols-4 bg-slate-950 border-t border-slate-800 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0 select-none"
    >
      {TABS.map((tab) => {
        const Icon = NAV_ICONS[tab];
        const isActive = activeTab === tab;
        const label = NAV_LABELS[tab][lang] ?? NAV_LABELS[tab].en;
        const badge = tab === "chat" ? chatUnreadCount : tab === "job" ? pendingOffersCount : 0;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 min-h-[56px] rounded-xl transition-colors cursor-pointer ${
              isActive ? "text-orange-500 bg-orange-500/10" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <span className="relative">
              <Icon className="w-6 h-6 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
              {badge > 0 && (
                <span className="absolute -top-1.5 -end-2 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-[18px] text-center light-preserve">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            <span className={`text-[11px] leading-none ${isActive ? "font-bold" : "font-medium"}`}>{label}</span>
            <span className={`h-1 w-8 rounded-full ${isActive ? "bg-orange-500" : "bg-transparent"}`} />
          </button>
        );
      })}
    </nav>
  );
}
