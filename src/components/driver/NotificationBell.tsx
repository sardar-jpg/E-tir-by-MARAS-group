import { Bell } from 'lucide-react';

interface NotificationBellProps {
  unreadCount: number;
  label: string;
  onClick: () => void;
}

export default function NotificationBell({ unreadCount, label, onClick }: NotificationBellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-white transition-all relative cursor-pointer"
    >
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-orange-500 text-white text-[9px] font-black leading-[15px] text-center font-mono">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}
