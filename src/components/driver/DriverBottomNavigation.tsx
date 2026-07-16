import { Home, Briefcase, MessageSquare, User } from "lucide-react";
import type { Language } from "../../types";

/**
 * feature/driver-app-comprehensive-redesign — the Driver App's bottom
 * navigation has exactly four sections: Home, Jobs, Chat, Account. The
 * old separate Menu and Profile tabs are merged into Account. Chat is
 * always reachable (the Chat screen owns picking a job thread); the
 * unread badge surfaces new MARAS messages. Labels are localized, layout
 * uses only logical utilities (grid order follows the document direction,
 * so Arabic mirrors automatically), and the bar reserves the device
 * safe-area inset so it never sits under a home indicator.
 */
export type DriverTab = "home" | "jobs" | "chat" | "account";

const NAV_LABELS: Record<DriverTab, Record<Language, string>> = {
  home: { en: "Home", tr: "Ana Sayfa", ar: "الرئيسية" },
  jobs: { en: "Jobs", tr: "Seferler", ar: "المهام" },
  chat: { en: "Chat", tr: "Mesajlar", ar: "الدردشة" },
  account: { en: "Account", tr: "Hesap", ar: "حسابي" },
};

const NAV_ICONS: Record<DriverTab, typeof Home> = {
  home: Home,
  jobs: Briefcase,
  chat: MessageSquare,
  account: User,
};

const TABS: DriverTab[] = ["home", "jobs", "chat", "account"];

interface DriverBottomNavigationProps {
  activeTab: DriverTab;
  onSelect: (tab: DriverTab) => void;
  lang: Language;
  /** Unread MARAS chat messages across all of this driver's jobs. */
  chatUnreadCount?: number;
}

export default function DriverBottomNavigation({
  activeTab,
  onSelect,
  lang,
  chatUnreadCount = 0,
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
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 min-h-[56px] rounded-xl transition-colors cursor-pointer ${
              isActive ? "text-orange-500" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <span className="relative">
              <Icon className="w-6 h-6 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
              {tab === "chat" && chatUnreadCount > 0 && (
                <span className="absolute -top-1.5 -end-2 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-[18px] text-center light-preserve">
                  {chatUnreadCount > 9 ? "9+" : chatUnreadCount}
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
