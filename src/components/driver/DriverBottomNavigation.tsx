import { Home, Megaphone, Briefcase, MessageSquare, FolderOpen, User } from "lucide-react";
import type { Language } from "../../types";

/**
 * Driver App V2 — the bottom navigation has exactly six sections:
 * Home, Offers, Job (the one active job), Chat, Documents, Profile.
 * Nothing else may be added here. Chat is always reachable (the Chat
 * screen owns picking a job thread); the chat badge surfaces new MARAS
 * messages and the offers badge surfaces offers awaiting an answer.
 * Labels are localized, layout uses only logical utilities (grid order
 * follows the document direction, so Arabic mirrors automatically), and
 * the bar reserves the device safe-area inset so it never sits under a
 * home indicator.
 */
export type DriverTab = "home" | "offers" | "job" | "chat" | "documents" | "profile";

const NAV_LABELS: Record<DriverTab, Record<Language, string>> = {
  home: { en: "Home", tr: "Ana Sayfa", ar: "الرئيسية" },
  offers: { en: "Offers", tr: "Teklifler", ar: "العروض" },
  job: { en: "Job", tr: "Sefer", ar: "المهمة" },
  chat: { en: "Chat", tr: "Mesajlar", ar: "الدردشة" },
  documents: { en: "Papers", tr: "Belgeler", ar: "المستندات" },
  profile: { en: "Profile", tr: "Profil", ar: "الملف" },
};

const NAV_ICONS: Record<DriverTab, typeof Home> = {
  home: Home,
  offers: Megaphone,
  job: Briefcase,
  chat: MessageSquare,
  documents: FolderOpen,
  profile: User,
};

const TABS: DriverTab[] = ["home", "offers", "job", "chat", "documents", "profile"];

interface DriverBottomNavigationProps {
  activeTab: DriverTab;
  onSelect: (tab: DriverTab) => void;
  lang: Language;
  /** Unread MARAS chat messages across all of this driver's jobs. */
  chatUnreadCount?: number;
  /** Transport offers still awaiting this driver's answer. */
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
      className="grid grid-cols-6 bg-slate-950 border-t border-slate-800 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0 select-none"
    >
      {TABS.map((tab) => {
        const Icon = NAV_ICONS[tab];
        const isActive = activeTab === tab;
        const label = NAV_LABELS[tab][lang] ?? NAV_LABELS[tab].en;
        const badge = tab === "chat" ? chatUnreadCount : tab === "offers" ? pendingOffersCount : 0;
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
              <Icon className="w-5.5 h-5.5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
              {badge > 0 && (
                <span className="absolute -top-1.5 -end-2 min-w-[17px] h-[17px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-[17px] text-center light-preserve">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            <span className={`text-[10px] leading-none ${isActive ? "font-bold" : "font-medium"}`}>{label}</span>
            <span className={`h-1 w-6 rounded-full ${isActive ? "bg-orange-500" : "bg-transparent"}`} />
          </button>
        );
      })}
    </nav>
  );
}
