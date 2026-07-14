import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { TrendingUp, CheckCircle2, Award } from 'lucide-react';
import type { Language } from '../../../types';
import { TRANSLATIONS } from '../../../translations';

interface AdminReportsSectionProps {
  lang: Language;
  t: (key: keyof typeof TRANSLATIONS['en']) => string;
  isMobileMode: boolean;
  totalShipmentsCount: number;
  statusData: { name: string; value: number; color: string }[];
  currencyChartData: { name: string; Amount: number }[];
  totalCompleted30d: number;
  avgDailyCompleted: string;
  peakFormattedDay: string;
  performanceAnalyticsData: Array<{ date: string; label: string; [key: string]: string | number }>;
  /** Phase 2A follow-up (blocking-issue fix): true when more shipments
      exist beyond what's currently loaded (GET /api/shipments' own
      `hasMore`). `totalShipmentsCount`/`statusData` are exact, full-scope
      server aggregates regardless — this only gates the notice about
      currencyChartData/performanceAnalyticsData below, which are NOT. */
  shipmentsHasMore: boolean;
}

/**
 * Logistics Analytics / Reports tab content, extracted from AdminPanel.tsx
 * (PR #76, Admin bundle-size split) so it can be React.lazy-loaded instead
 * of always shipping in the main AdminPanel chunk. Role gating (only
 * canViewLogisticsAnalytics) stays in AdminPanel.tsx, same as before — this
 * component only renders once the caller has already decided it's allowed.
 */
export default function AdminReportsSection({
  lang,
  t,
  isMobileMode,
  totalShipmentsCount,
  statusData,
  currencyChartData,
  totalCompleted30d,
  avgDailyCompleted,
  peakFormattedDay,
  performanceAnalyticsData,
  shipmentsHasMore,
}: AdminReportsSectionProps) {
  const performanceDataKey = lang === 'tr' ? 'Tamamlanan' : (lang === 'ar' ? 'المكتملة' : 'Completed');

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('reports')}</h2>
          <p className="text-slate-500 text-sm">
            {lang === 'tr'
              ? "Sevkiyat kayıtlarına dayalı operasyonel analizler. Finansal muhasebe analizleri ayrıca eklenecektir."
              : (lang === 'ar'
                ? "تحليلات تشغيلية مبنية على سجلات الشحنات. سيتم إضافة تحليلات المحاسبة المالية بشكل منفصل لاحقًا."
                : "Operational analytics based on shipment records. Financial accounting analytics will be added separately.")}
          </p>
          <p className="text-slate-400 text-xs mt-1">
            {lang === 'tr'
              ? `Veri kaynağı: sevkiyat kayıtları — toplam ${totalShipmentsCount} kayıt (tam rakam)`
              : (lang === 'ar'
                ? `مصدر البيانات: سجلات الشحنات — إجمالي ${totalShipmentsCount} سجل (رقم دقيق)`
                : `Data source: shipment records — ${totalShipmentsCount} total record${totalShipmentsCount === 1 ? '' : 's'} (exact figure)`)}
          </p>
          {/* Phase 2A follow-up (blocking-issue fix): totalShipmentsCount/
              statusData above are exact, full-scope server aggregates —
              currencyChartData and performanceAnalyticsData below are NOT
              (Firestore has no server-side SUM/GROUP-BY; see this PR's
              description). This notice makes that distinction visible
              instead of silently presenting a partial figure as complete. */}
          {shipmentsHasMore && (
            <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] font-medium mt-2">
              {lang === 'tr'
                ? "Not: Para Birimi Toplamları ve Teslimat Performansı grafikleri yalnızca şu anda yüklenmiş sevkiyat kayıtlarını yansıtır (tam veri seti değil)."
                : (lang === 'ar'
                  ? "ملاحظة: رسوم إجماليات العملات وأداء التسليم أدناه تعكس فقط سجلات الشحنات المحمّلة حالياً (ليست المجموعة الكاملة)."
                  : "Note: the Currency Totals and Delivery Performance charts below reflect only the shipment records currently loaded in this session, not the complete dataset.")}
            </p>
          )}
        </div>

        <div className={`grid grid-cols-1 ${isMobileMode ? '' : 'lg:grid-cols-2'} gap-6 pt-5`}>
          {/* Status breakdown Pie */}
          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col justify-between">
            <h3 className="font-bold text-slate-800 text-sm mb-4">{t('statusDistribution')}</h3>
            <div className="h-64">
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 italic">No registered shipments info available.</div>
              )}
            </div>
          </div>

          {/* Currency chart */}
          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col justify-between">
            <h3 className="font-bold text-slate-800 text-sm mb-4">{t('currencyDistribution')}</h3>
            <div className="h-64">
              {currencyChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={currencyChartData}>
                    <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => [`${Number(value).toLocaleString()}`, t('carrierAmount')]} />
                    <Bar dataKey="Amount" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 italic">No driver agreed amount data found.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Performance Analytics Section */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {lang === 'tr' ? 'Performans ve Hacim Analizi' : (lang === 'ar' ? 'تحليلات الأداء والحجم' : 'Performance Analytics')}
            </h2>
            <p className="text-slate-500 text-sm">
              {lang === 'tr' ? 'Son 30 günde tamamlanan teslimat hacmi ve operasyonel akış' : (lang === 'ar' ? 'حجم الشحنات المكتملة والإنتاجية التشغيلية على مدار الثلاثين يومًا الماضية' : 'Completed shipment volumes and operational productivity over the last 30 days')}
            </p>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-600">
            <TrendingUp className="w-4 h-4 text-orange-500 animate-pulse" />
            <span>
              {lang === 'tr' ? 'Son 30 Gün' : (lang === 'ar' ? 'آخر ٣٠ يومًا' : 'Last 30 Days')}
            </span>
          </div>
        </div>

        {/* Micro stats banner */}
        <div className={`grid grid-cols-1 ${isMobileMode ? 'grid-cols-1' : 'md:grid-cols-3'} gap-4`}>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100/70 flex items-center justify-center text-orange-600 shrink-0">
              <CheckCircle2 className="w-5 h-5 font-bold" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                {lang === 'tr' ? 'Toplam Tamamlanan (30g)' : (lang === 'ar' ? 'إجمالي المكتمل (٣٠ يوم)' : 'Total Completed (30d)')}
              </p>
              <p className="text-xl font-black text-slate-800">
                {totalCompleted30d}
              </p>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100/70 flex items-center justify-center text-orange-600 shrink-0">
              <TrendingUp className="w-5 h-5 font-bold" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                {lang === 'tr' ? 'Günlük Ortalama' : (lang === 'ar' ? 'المعدل اليومي' : 'Daily Average')}
              </p>
              <p className="text-xl font-black text-slate-800">
                {avgDailyCompleted}
              </p>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100/70 flex items-center justify-center text-emerald-600 shrink-0">
              <Award className="w-5 h-5 font-bold" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                {lang === 'tr' ? 'Zirve Hacim Günü' : (lang === 'ar' ? 'يوم ذروة العمليات' : 'Peak Volume Day')}
              </p>
              <p className="text-xs font-bold text-slate-800 truncate max-w-[180px]">
                {peakFormattedDay || "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceAnalyticsData} margin={{ top: 10, right: 20, left: -20, bottom: 5 }}>
                <XAxis
                  dataKey="label"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  dx={-5}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '0.75rem',
                    border: 'none',
                    color: '#f8fafc',
                    fontFamily: 'sans-serif',
                    fontSize: '12px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
                  }}
                  itemStyle={{ color: '#f97316' }}
                />
                <Line
                  type="monotone"
                  dataKey={performanceDataKey}
                  stroke="#f97316"
                  strokeWidth={3}
                  dot={{ r: 4, stroke: '#f97316', strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
