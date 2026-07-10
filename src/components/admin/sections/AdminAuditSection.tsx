import { ShieldCheck } from 'lucide-react';
import type { ActivityLog, Language } from '../../../types';
import { TRANSLATIONS } from '../../../translations';

interface AdminAuditSectionProps {
  lang: Language;
  t: (key: keyof typeof TRANSLATIONS['en']) => string;
  activityLogs: ActivityLog[];
}

/**
 * Audit Logs tab content, extracted from AdminPanel.tsx (PR #78, Admin
 * bundle-size split phase 2) so it can be React.lazy-loaded instead of
 * always shipping in the main AdminPanel chunk. Role gating
 * (resolvedAdminType === 'super') stays in AdminPanel.tsx — this component
 * only renders once the caller has already decided it's allowed.
 */
export default function AdminAuditSection({ lang, t, activityLogs }: AdminAuditSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-orange-500" />
            {t('auditLogsTitle')}
          </h2>
          <p className="text-slate-500 text-xs">Immutable security operations logs of ship authorizations and file modifications</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs md:text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold">
              <th className="p-4">{t('actor')}</th>
              <th className="p-4">Shipment #</th>
              <th className="p-4">{t('action')}</th>
              <th className="p-4 text-right">{t('time')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono text-xs">
            {activityLogs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50/50">
                <td className="p-4 font-bold text-slate-800">{log.actor}</td>
                <td className="p-4 text-orange-600 font-bold">#{log.shipmentNumber}</td>
                <td className="p-4 text-slate-700">
                  {lang === 'en' ? log.actionEn : (lang === 'tr' ? log.actionTr : log.actionAr)}
                </td>
                <td className="p-4 text-right text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
