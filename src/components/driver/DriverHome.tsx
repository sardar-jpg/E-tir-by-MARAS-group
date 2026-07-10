import { Truck } from 'lucide-react';
import type { Shipment, Language } from '../../types';
import ActiveJobCard from './ActiveJobCard';

interface DriverHomeProps {
  driverName: string;
  activeJob: Shipment | null;
  driverId: string;
  onContinueJob: () => void;
  onChatWithAdmin: () => void;
  onViewJobs: () => void;
  lang: Language;
}

const LABELS: Record<Language, {
  greeting: (name: string) => string;
  subtitle: string;
  activeJob: string;
  noJob: string;
  noJobSub: string;
  viewJobs: string;
}> = {
  en: {
    greeting: (n) => `Welcome, ${n}`,
    subtitle: 'MARAS Operations',
    activeJob: 'Active Job',
    noJob: 'No active job assigned',
    noJobSub: 'New assignments from MARAS Operations will appear here.',
    viewJobs: 'View Jobs List',
  },
  tr: {
    greeting: (n) => `Hoş geldiniz, ${n}`,
    subtitle: 'MARAS Operasyon',
    activeJob: 'Aktif Sefer',
    noJob: 'Atanmış aktif sefer yok',
    noJobSub: "MARAS Operasyon'dan yeni görevler burada görünecek.",
    viewJobs: 'Seferleri Görüntüle',
  },
  ar: {
    greeting: (n) => `مرحباً، ${n}`,
    subtitle: 'عمليات MARAS',
    activeJob: 'المهمة النشطة',
    noJob: 'لا توجد مهمة نشطة مخصصة',
    noJobSub: 'ستظهر هنا المهام الجديدة من عمليات MARAS.',
    viewJobs: 'عرض قائمة المهام',
  },
};

export default function DriverHome({
  driverName,
  activeJob,
  driverId,
  onContinueJob,
  onChatWithAdmin,
  onViewJobs,
  lang,
}: DriverHomeProps) {
  const label = LABELS[lang] ?? LABELS.en;
  const firstName = driverName ? driverName.split(' ')[0] : 'Driver';

  return (
    <div className="space-y-5 animate-fade-in pb-4">
      {/* Driver greeting banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-orange-600/95 via-orange-500/90 to-amber-500/95 rounded-3xl p-4 shadow-[0_12px_24px_rgba(249,115,22,0.18)] border border-orange-400/20 text-white light-preserve">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-6 -mt-6" />
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black tracking-tight leading-none">{label.greeting(firstName)}</h3>
            <span className="text-[10px] text-orange-100/80 font-mono mt-0.5 block">{label.subtitle}</span>
          </div>
        </div>
      </div>

      {/* Active Job section */}
      <div>
        <h4 className="font-extrabold text-[#f97316] text-[10px] tracking-wide uppercase font-mono mb-3">
          {label.activeJob}
        </h4>

        {activeJob ? (
          <ActiveJobCard
            shipment={activeJob}
            driverId={driverId}
            onContinueJob={onContinueJob}
            onChatWithAdmin={onChatWithAdmin}
            lang={lang}
          />
        ) : (
          <div className="py-12 text-center space-y-4 bg-slate-900/40 rounded-2xl p-6 border border-slate-800/80">
            <div className="w-12 h-12 rounded-full bg-slate-950/80 border border-slate-800 flex items-center justify-center mx-auto">
              <Truck className="w-6 h-6 text-slate-600 shrink-0" />
            </div>
            <div>
              <p className="text-xs text-slate-300 font-bold">{label.noJob}</p>
              <p className="text-[10px] text-slate-500 mt-2 leading-relaxed max-w-[220px] mx-auto">
                {label.noJobSub}
              </p>
            </div>
            <button
              type="button"
              onClick={onViewJobs}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer active:scale-95"
            >
              <Truck className="w-3.5 h-3.5 text-orange-500" />
              <span>{label.viewJobs}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
