import { Anchor, Plane, Truck, Clock, MessageSquare, Pencil, AlertCircle } from 'lucide-react';
import type { Shipment, Language } from '../../../types';
import type { TRANSLATIONS } from '../../../translations';

type TimingAnalysis = {
  colorClass: string;
  textColorClass: string;
  bgBadgeClass: string;
  label: string;
  subtext: string;
  lagPercentage?: number;
};

interface MobileOrdersListProps {
  lang: Language;
  t: (key: keyof typeof TRANSLATIONS['en']) => string;
  shipments: Shipment[];
  analyzeShipmentTiming: (s: Shipment) => TimingAnalysis;
  getShipmentProgressPercentage: (s: Shipment) => number;
  onViewDetails: (id: string) => void;
  onEdit: (s: Shipment) => void;
  onChat: (s: Shipment) => void;
}

const STATUS_BADGE_CLASS = (status: string) =>
  status === 'New'
    ? 'bg-slate-100 text-slate-700'
    : status === 'Assigned' || status === 'Accepted'
      ? 'bg-orange-100 text-orange-800'
      : status === 'Delivered'
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-blue-100 text-blue-800';

/**
 * feature/admin-mobile-ui: card-based Orders list for mobile, rendered
 * instead of the desktop Shipments Registry `<table>` when isMobileMode
 * is true. The search bar and freight-type/status filter pills above this
 * (in AdminPanel.tsx) already wrap reasonably at narrow widths and are
 * reused unchanged — only the wide multi-column table itself doesn't work
 * on a phone, so this replaces just that with one card per shipment built
 * from the same already-filtered `shipments` array and the same
 * analyzeShipmentTiming/getShipmentProgressPercentage helpers the desktop
 * table uses. View/Edit/Chat map to the exact same handlers as the
 * desktop row actions — no new shipment logic here.
 */
export default function MobileOrdersList({
  lang,
  t,
  shipments,
  analyzeShipmentTiming,
  getShipmentProgressPercentage,
  onViewDetails,
  onEdit,
  onChat,
}: MobileOrdersListProps) {
  if (shipments.length === 0) {
    return (
      <div className="lg:hidden bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center text-slate-400 italic text-sm">
        <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <span>{t('noShipmentsMatched')}</span>
      </div>
    );
  }

  return (
    <div className="lg:hidden space-y-3">
      {shipments.map((s) => {
        const fType = s.freightType || 'land';
        const analysis = analyzeShipmentTiming(s);
        const progress = getShipmentProgressPercentage(s);
        return (
          <div key={s.id} className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {fType === 'sea' ? (
                  <span className="p-1.5 bg-blue-50 text-blue-600 rounded-md shrink-0"><Anchor className="w-3.5 h-3.5" /></span>
                ) : fType === 'air' ? (
                  <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-md shrink-0"><Plane className="w-3.5 h-3.5" /></span>
                ) : (
                  <span className="p-1.5 bg-orange-50 text-orange-600 rounded-md shrink-0"><Truck className="w-3.5 h-3.5" /></span>
                )}
                <div className="min-w-0">
                  <p className="font-mono font-bold text-slate-900 text-sm truncate">{s.shipmentNumber}</p>
                  <p className="text-xs font-semibold text-slate-700 truncate">{s.companyName}</p>
                </div>
              </div>
              <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${STATUS_BADGE_CLASS(s.status)}`}>
                {s.status}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
              <span className="truncate">{s.loadingCity}</span>
              <span className="text-slate-300 font-bold">→</span>
              <span className="truncate">{s.deliveryCity}</span>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-mono font-bold text-slate-900">{s.agreedAmount.toLocaleString()} {s.currency}</span>
              <span className={`flex items-center gap-1 font-bold ${analysis.textColorClass}`}>
                <Clock className="w-3 h-3" />
                {progress}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${analysis.colorClass}`} style={{ width: `${progress}%` }} />
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => onViewDetails(s.id)}
                className="flex-1 min-h-[36px] text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg cursor-pointer border-0"
              >
                {lang === 'tr' ? 'Detay' : lang === 'ar' ? 'التفاصيل' : 'View'}
              </button>
              <button
                type="button"
                onClick={() => onEdit(s)}
                className="min-h-[36px] px-3 flex items-center justify-center text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer border-0"
                aria-label={lang === 'tr' ? 'Düzenle' : lang === 'ar' ? 'تعديل' : 'Edit'}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChat(s)}
                className="min-h-[36px] px-3 flex items-center justify-center text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer border-0"
                aria-label={lang === 'tr' ? 'Sohbet' : lang === 'ar' ? 'محادثة' : 'Chat'}
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
