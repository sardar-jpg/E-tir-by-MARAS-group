import { Home, Truck, MessageSquare, Settings, User } from 'lucide-react';

export type DriverTab = 'home' | 'shipments' | 'chat' | 'notifications' | 'profile' | 'menu';

interface DriverBottomNavProps {
  activeTab: DriverTab;
  onSelect: (tab: DriverTab) => void;
  chatDisabled: boolean;
}

export default function DriverBottomNav({ activeTab, onSelect, chatDisabled }: DriverBottomNavProps) {
  return (
    <div className="grid grid-cols-5 bg-slate-950 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-900 mt-2 shrink-0 select-none">
      <button
        onClick={() => onSelect('home')}
        className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all cursor-pointer ${
          activeTab === 'home' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        <div className="relative flex flex-col items-center">
          <Home className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'home' ? 'text-[#f97316] scale-110' : ''}`} />
          {activeTab === 'home' && (
            <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
          )}
        </div>
        <span className="mt-1.5">Home</span>
      </button>
      <button
        onClick={() => onSelect('shipments')}
        className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all cursor-pointer ${
          activeTab === 'shipments' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        <div className="relative flex flex-col items-center">
          <Truck className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'shipments' ? 'text-[#f97316] scale-110' : ''}`} />
          {activeTab === 'shipments' && (
            <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
          )}
        </div>
        <span className="mt-1.5">Jobs</span>
      </button>
      <button
        onClick={() => onSelect('chat')}
        disabled={chatDisabled}
        className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all relative ${
          activeTab === 'chat' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
        } disabled:opacity-20`}
      >
        <div className="relative flex flex-col items-center">
          <MessageSquare className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'chat' ? 'text-[#f97316] scale-110' : ''}`} />
          {activeTab === 'chat' && (
            <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
          )}
        </div>
        <span className="mt-1.5">Chat</span>
      </button>
      <button
        onClick={() => onSelect('menu')}
        className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all cursor-pointer ${
          activeTab === 'menu' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        <div className="relative flex flex-col items-center">
          <Settings className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'menu' ? 'text-[#f97316] scale-110' : ''}`} />
          {activeTab === 'menu' && (
            <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
          )}
        </div>
        <span className="mt-1.5">Menu</span>
      </button>
      <button
        onClick={() => onSelect('profile')}
        className={`flex flex-col items-center gap-1 text-[9.5px] uppercase tracking-wider font-mono transition-all cursor-pointer ${
          activeTab === 'profile' ? 'text-white font-extrabold scale-105' : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        <div className="relative flex flex-col items-center">
          <User className={`w-4 h-4 shrink-0 transition-transform duration-300 ${activeTab === 'profile' ? 'text-[#f97316] scale-110' : ''}`} />
          {activeTab === 'profile' && (
            <span className="absolute -bottom-2 w-4 h-0.5 bg-orange-500 rounded-full"></span>
          )}
        </div>
        <span className="mt-1.5">Profile</span>
      </button>
    </div>
  );
}
