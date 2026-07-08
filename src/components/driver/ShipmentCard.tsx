import { ChevronRight } from 'lucide-react';
import type { Shipment } from '../../types';
import { resolveDriverAgreedAmount, resolveDriverTruckNumber, FREIGHT_TYPE_LABELS } from '../../lib/driverVisibility';

interface ShipmentCardProps {
  shipment: Shipment;
  driverId: string;
  onClick: () => void;
}

export default function ShipmentCard({ shipment: s, driverId, onClick }: ShipmentCardProps) {
  const isAssigned = s.status === 'Assigned';
  const isTransit = s.status === 'In Transit' || s.status === 'Border Crossing' || s.status === 'Customs Clearance';
  const isDelivered = s.status === 'Delivered' || s.status === 'Arrived';

  const agreedAmount = resolveDriverAgreedAmount(s, driverId);
  const truckNumber = resolveDriverTruckNumber(s, driverId);
  const freightLabel = FREIGHT_TYPE_LABELS[s.freightType || 'land'];

  return (
    <div
      onClick={onClick}
      className="group relative bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 hover:border-orange-500/40 rounded-[22px] p-4 transition-all duration-300 cursor-pointer shadow-[0_4px_25px_rgba(0,0,0,0.3)] space-y-3.5 overflow-hidden active:scale-[0.99]"
    >
      {/* Interactive glow overlay */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-orange-500/5 to-transparent rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-1.5">
          <span className="bg-slate-950 text-slate-200 font-mono font-bold px-2 py-0.5 rounded text-[10px] border border-slate-800">
            #{s.shipmentNumber}
          </span>
          <span className="bg-slate-950 text-slate-400 font-mono font-bold px-2 py-0.5 rounded text-[9px] border border-slate-800 uppercase tracking-wide">
            {freightLabel}
          </span>
        </div>

        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider font-mono border ${
          isAssigned ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse' :
          isTransit ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' :
          isDelivered ? 'bg-teal-500/10 text-teal-400 border-teal-500/20' :
          'bg-blue-500/10 text-blue-400 border-blue-500/20'
        }`}>
          {s.status}
        </span>
      </div>

      {/* Interactive route line design */}
      <div className="space-y-2.5 relative z-10 bg-slate-950/40 p-3 rounded-xl border border-slate-900/40">
        <p className="font-bold text-xs text-slate-100 truncate">{s.cargoDescription}</p>

        {/* Route tracking line */}
        <div className="flex items-stretch justify-between gap-1 text-[11px] relative pt-1">
          {/* Technical dashed path line */}
          <div className="absolute top-3 left-[15%] right-[15%] h-px border-t border-dashed border-slate-800" />

          <div className="flex flex-col text-left max-w-[45%]">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono leading-none mb-1">Loading Depot</span>
            <strong className="text-slate-200 text-xs truncate">{s.loadingCity}</strong>
          </div>

          <div className="flex items-center self-center justify-center bg-slate-900 border border-slate-800 w-5 h-5 rounded-full shrink-0 z-10 group-hover:text-orange-400 group-hover:border-orange-500/30 transition-colors">
            <ChevronRight className="w-3 h-3 text-slate-500 group-hover:text-orange-400" />
          </div>

          <div className="flex flex-col text-right max-w-[45%]">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono leading-none mb-1">Delivery Point</span>
            <strong className="text-slate-200 text-xs truncate">{s.deliveryCity}</strong>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 relative z-10 text-xs">
        <div className="flex flex-col">
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest font-mono">Agreed Payout</span>
          <span className="font-extrabold text-orange-500 font-mono text-sm mt-0.5">
            {agreedAmount !== null ? (
              <>
                {agreedAmount.toLocaleString()}{' '}
                <span className="text-[10px]">{s.currency}</span>
              </>
            ) : (
              <span className="text-slate-500">Not available</span>
            )}
          </span>
        </div>

        {truckNumber && (
          <div className="flex flex-col text-right">
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest font-mono">Truck</span>
            <span className="font-bold text-slate-300 font-mono text-xs mt-0.5">{truckNumber}</span>
          </div>
        )}

        <span className="text-[10px] font-bold text-slate-400 group-hover:text-[#f97316] flex items-center gap-1 transition-all">
          <span>Open Job</span>
          <ChevronRight className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </div>
  );
}
