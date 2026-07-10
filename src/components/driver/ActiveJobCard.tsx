import { ChevronRight, MessageSquare, FileUp } from 'lucide-react';
import type { Shipment, Language } from '../../types';
import { resolveDriverAgreedAmount, resolveDriverTruckNumber, FREIGHT_TYPE_LABELS } from '../../lib/driverVisibility';

interface ActiveJobCardProps {
  shipment: Shipment;
  driverId: string;
  onContinueJob: () => void;
  onChatWithAdmin: () => void;
  onUploadDocument: () => void;
  lang: Language;
}

const LABELS: Record<Language, {
  continueJob: string; chat: string; upload: string;
  route: string; cargo: string; payout: string; from: string; to: string; notSpecified: string; truck: string;
}> = {
  en: { continueJob: 'Continue Job', chat: 'Chat', upload: 'Send Photo/File', route: 'Route', cargo: 'Cargo', payout: 'Your Payout', from: 'From', to: 'To', notSpecified: 'Not specified', truck: 'Truck' },
  tr: { continueJob: 'İşi Sürdür', chat: 'Mesaj', upload: 'Fotoğraf/Dosya Gönder', route: 'Güzergah', cargo: 'Kargo', payout: 'Ödemeniz', from: 'Nereden', to: 'Nereye', notSpecified: 'Belirtilmemiş', truck: 'Araç' },
  ar: { continueJob: 'متابعة المهمة', chat: 'محادثة', upload: 'إرسال صورة/ملف', route: 'المسار', cargo: 'الشحنة', payout: 'مستحقاتك', from: 'من', to: 'إلى', notSpecified: 'غير محدد', truck: 'الشاحنة' },
};

export default function ActiveJobCard({
  shipment: s,
  driverId,
  onContinueJob,
  onChatWithAdmin,
  onUploadDocument,
  lang,
}: ActiveJobCardProps) {
  const label = LABELS[lang] ?? LABELS.en;

  const agreedAmount = resolveDriverAgreedAmount(s, driverId);
  const truckNumber = resolveDriverTruckNumber(s, driverId);
  const freightLabel = FREIGHT_TYPE_LABELS[s.freightType || 'land'];

  const isAssigned = s.status === 'Assigned';
  const isTransit =
    s.status === 'In Transit' ||
    s.status === 'Border Crossing' ||
    s.status === 'Customs Clearance';

  const statusColor = isAssigned
    ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse'
    : isTransit
    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
    : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

  return (
    <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-4 space-y-4 shadow-[0_8px_30px_rgba(0,0,0,0.4)] relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/[0.04] rounded-full blur-2xl group-hover:bg-orange-500/[0.08] transition-all duration-500" />

      {/* Shipment number + status */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-[10px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
            #{s.shipmentNumber}
          </span>
          <span className="font-mono font-bold text-[9px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 uppercase tracking-wide">
            {freightLabel}
          </span>
        </div>
        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider font-mono border ${statusColor}`}>
          {s.status}
        </span>
      </div>

      {/* Route summary */}
      <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-900/40 space-y-1.5 relative z-10">
        <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest font-mono block">
          {label.route}
        </span>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-[9px] text-slate-500 font-mono">{label.from}</span>
            <strong className="text-slate-200 truncate text-xs">{s.loadingCity}</strong>
            <span className="text-[9px] text-slate-600">{s.loadingCountry}</span>
          </div>
          <ChevronRight className="w-4 h-4 text-orange-500 shrink-0" />
          <div className="flex flex-col flex-1 min-w-0 text-right">
            <span className="text-[9px] text-slate-500 font-mono">{label.to}</span>
            <strong className="text-slate-200 truncate text-xs">{s.deliveryCity}</strong>
            <span className="text-[9px] text-slate-600">{s.deliveryCountry}</span>
          </div>
        </div>
      </div>

      {/* Cargo + Payout + Truck */}
      <div className={`grid gap-3 relative z-10 ${truckNumber ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900/40 space-y-1">
          <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest font-mono block">
            {label.cargo}
          </span>
          <p className="text-[11px] font-bold text-slate-200 truncate">{s.cargoDescription}</p>
          <p className="text-[9px] text-slate-500 font-mono">
            {typeof s.cargoWeight === 'number' ? `${s.cargoWeight.toLocaleString()} kg` : label.notSpecified}
          </p>
        </div>
        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900/40 space-y-1">
          <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest font-mono block">
            {label.payout}
          </span>
          {agreedAmount !== null ? (
            <p className="text-sm font-black text-orange-500 font-mono">
              {agreedAmount.toLocaleString()}{' '}
              <span className="text-[10px]">{s.currency}</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500">—</p>
          )}
        </div>
        {truckNumber && (
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-900/40 space-y-1">
            <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest font-mono block">
              {label.truck}
            </span>
            <p className="text-[11px] font-bold text-slate-200 font-mono truncate">{truckNumber}</p>
          </div>
        )}
      </div>

      {/* Quick action buttons */}
      <div className="grid grid-cols-3 gap-2 pt-1 relative z-10">
        <button
          type="button"
          onClick={onContinueJob}
          className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-black text-[9px] uppercase tracking-wider transition-all active:scale-95 cursor-pointer border-0 shadow-[0_4px_12px_rgba(249,115,22,0.3)]"
        >
          <ChevronRight className="w-4 h-4" />
          <span>{label.continueJob}</span>
        </button>
        <button
          type="button"
          onClick={onChatWithAdmin}
          className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl bg-slate-900 hover:bg-slate-800 active:bg-slate-700 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-black text-[9px] uppercase tracking-wider transition-all active:scale-95 cursor-pointer"
        >
          <MessageSquare className="w-4 h-4 text-orange-400" />
          <span>{label.chat}</span>
        </button>
        <button
          type="button"
          onClick={onUploadDocument}
          className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl bg-slate-900 hover:bg-slate-800 active:bg-slate-700 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-black text-[9px] uppercase tracking-wider transition-all active:scale-95 cursor-pointer"
        >
          <FileUp className="w-4 h-4 text-orange-400" />
          <span>{label.upload}</span>
        </button>
      </div>
    </div>
  );
}
