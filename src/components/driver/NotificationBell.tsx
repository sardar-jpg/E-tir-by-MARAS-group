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
      className="w-10 h-10 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-800 transition-all relative cursor-pointer flex items-center justify-center active:scale-95"
    >
      <Bell className="w-[18px] h-[18px]" />
      {unreadCount > 0 && (
        <span className="absolute -top-1.5 -end-1.5 min-w-[17px] h-[17px] px-[3px] rounded-full bg-orange-500 text-white text-[10px] font-bold leading-[17px] text-center border-2 border-white box-content">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}
