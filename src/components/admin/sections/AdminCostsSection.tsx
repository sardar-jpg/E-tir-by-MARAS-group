import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  DollarSign, ShieldCheck, BarChart as BarChartIcon, ClipboardList, Building2,
  Search, Edit3, Plus, Truck, Ship, Plane
} from 'lucide-react';
import type { Language } from '../../../types';
import type { CostStatement, Shipment } from '../../../types';
import { buildCostStatementRows, filterCostStatementRows } from '../../../lib/costStatementRegistryView';

interface AdminCostsSectionProps {
  lang: Language;
  isMobileMode: boolean;
  costStatements: CostStatement[];
  shipments: Shipment[];
  costSearchQuery: string;
  onCostSearchQueryChange: (value: string) => void;
  costStatusFilter: 'All' | 'Unpaid' | 'Partial' | 'Paid';
  onCostStatusFilterChange: (value: 'All' | 'Unpaid' | 'Partial' | 'Paid') => void;
  costTypeFilter: 'All' | 'land' | 'sea' | 'air';
  onCostTypeFilterChange: (value: 'All' | 'land' | 'sea' | 'air') => void;
  onSelectActiveStatement: (shipmentId: string) => void;
}

/**
 * Accounts & Cost Statements tab content, extracted from AdminPanel.tsx
 * (PR #76, Admin bundle-size split) so it can be React.lazy-loaded instead
 * of always shipping in the main AdminPanel chunk. Role gating
 * (canViewCostStatements) stays in AdminPanel.tsx — this component only
 * renders once the caller has already decided it's allowed.
 */
export default function AdminCostsSection({
  lang,
  isMobileMode,
  costStatements,
  shipments,
  costSearchQuery,
  onCostSearchQueryChange,
  costStatusFilter,
  onCostStatusFilterChange,
  costTypeFilter,
  onCostTypeFilterChange,
  onSelectActiveStatement,
}: AdminCostsSectionProps) {
  const totalCostsByCurrency = costStatements.reduce((acc, s) => {
    const cur = s.currency || "USD";
    if (!acc[cur]) acc[cur] = { total: 0, paid: 0, balance: 0 };
    acc[cur].total += Number(s.totalCost || 0);
    acc[cur].paid += Number(s.paidAmount || 0);
    acc[cur].balance += Number(s.remainingBalance || 0);
    return acc;
  }, {} as Record<string, { total: number, paid: number, balance: number }>);

  const statusCounts = costStatements.reduce((acc, s) => {
    const status = s.paymentStatus || "Unpaid";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { Paid: 0, Partial: 0, Unpaid: 0 } as Record<string, number>);

  // Accounting Phase B: chart buckets are keyed by (name, CURRENCY) and
  // every label carries its currency — amounts in USD, IQD, TRY, and EUR
  // are never added together as if they were equivalent (there is no FX
  // conversion in this system by design). The statement-level cards above
  // already group by currency (totalCostsByCurrency).
  const freightCosts = costStatements.reduce((acc, s) => {
    const type = s.shipmentType || "land";
    const cur = s.currency || "USD";
    const key = `${type}|${cur}`;
    acc[key] = (acc[key] || 0) + Number(s.totalCost || 0);
    return acc;
  }, {} as Record<string, number>);
  const freightChartData = Object.entries(freightCosts).map(([key, value]) => {
    const [name, cur] = key.split("|");
    const label = name === 'land' ? (lang === 'tr' ? 'Karayolu' : 'Land Freight') : name === 'sea' ? (lang === 'tr' ? 'Denizyolu' : 'Sea Freight') : (lang === 'tr' ? 'Havayolu' : 'Air Freight');
    return { name: `${label} (${cur})`, value };
  });

  const customerCosts = costStatements.reduce((acc, s) => {
    const cur = s.currency || "USD";
    const key = `${s.companyName || "Unknown"} (${cur})`;
    acc[key] = (acc[key] || 0) + Number(s.totalCost || 0);
    return acc;
  }, {} as Record<string, number>);
  const customerChartData = Object.entries(customerCosts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 5);

  const supplierCosts = {} as Record<string, number>;
  costStatements.forEach(s => {
    (s.items || []).forEach(item => {
      const base = item.supplierName || (lang === 'tr' ? 'Diğer Vendor' : 'Other Vendor');
      const key = `${base} (${item.currency || s.currency || "USD"})`;
      supplierCosts[key] = (supplierCosts[key] || 0) + Number(item.totalAmount || 0);
    });
  });
  const supplierChartData = Object.entries(supplierCosts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 5);

  // Built from costStatements first (see costStatementRegistryView.ts) so
  // this doesn't depend on the `shipments` client array — GET
  // /api/shipments 403s for accounts admins (canViewShipmentRegistry,
  // adminAccess.ts), so `shipments` is always [] for that role, but they
  // can still fetch costStatements (canViewCostStatements) and should see
  // them here.
  const costStatementRegistryRows = buildCostStatementRows(costStatements, shipments);
  const filteredShipmentsCosts = filterCostStatementRows(
    costStatementRegistryRows,
    costSearchQuery,
    costStatusFilter,
    costTypeFilter
  );

  const activeCurrencies = Object.keys(totalCostsByCurrency);

  return (
    <div className="space-y-6">

      {/* Header Title Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-xl font-bold font-sans text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-orange-500 bg-orange-100 p-1 rounded-full shrink-0" />
            <span>{lang === 'tr' ? 'Hesaplar ve Maliyet Beyannameleri' : (lang === 'ar' ? 'الحسابات وبيانات التكلفة' : 'Accounts & Cost Statements')}</span>
          </h2>
          <p className="text-slate-500 text-xs mt-1 leading-relaxed">
            {lang === 'tr'
              ? 'Muhasebe paneli: maliyet girdilerini ekleyin, her sevkiyat için döküm hazırlayın, faturaları saklayın ve beyanname PDF’i üretin.'
              : (lang === 'ar' ? 'القسم المحاسبي الداخلي لإضافة النفقات وتفصيل كشوف التكلفة وإرفاق المستندات.' : 'Internal accounting panel to declare shipment expenses, breakdown costs, store receipts, and print statements.')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 p-2 rounded-xl border border-slate-200 self-start lg:self-center font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-bold">{lang === 'tr' ? 'Sadece Yetkili Personel' : (lang === 'ar' ? 'حساب محاسب معتمد' : 'Authorized Role: Accounts & Admin')}</span>
        </div>
      </div>

      {/* Financial Overview Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeCurrencies.length > 0 ? (
          activeCurrencies.map((cur) => {
            const values = totalCostsByCurrency[cur];
            return (
              <div key={cur} className="bg-slate-950 text-white rounded-xl p-4 border border-slate-800 shadow-md space-y-3 relative overflow-hidden">
                <div className="absolute top-2 right-2 bg-orange-600/10 border border-orange-500/20 text-orange-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest">{cur}</div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{lang === 'tr' ? 'Bütçe Özeti' : 'Budget Summary'} ({cur})</span>
                <div className="grid grid-cols-3 gap-2 divide-x divide-slate-800 pt-1">
                  <div>
                    <p className="text-[9px] text-slate-400 uppercase font-semibold">{lang === 'tr' ? 'Toplam' : 'Total'}</p>
                    <p className="text-sm font-black text-white">{Number(values.total).toLocaleString()} <span className="text-[10px] text-slate-400">{cur}</span></p>
                  </div>
                  <div className="pl-2">
                    <p className="text-[9px] text-slate-400 uppercase font-semibold">{lang === 'tr' ? 'Ödenen' : 'Paid'}</p>
                    <p className="text-sm font-bold text-emerald-400">{Number(values.paid).toLocaleString()} <span className="text-[9px] text-slate-400">{cur}</span></p>
                  </div>
                  <div className="pl-2">
                    <p className="text-[9px] text-slate-400 uppercase font-semibold">{lang === 'tr' ? 'Kalan' : 'Due'}</p>
                    <p className="text-sm font-bold text-orange-400">{Number(values.balance).toLocaleString()} <span className="text-[9px] text-slate-400">{cur}</span></p>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-slate-950 text-white rounded-xl p-4 border border-slate-800 shadow-md flex items-center justify-center p-6 italic text-xs text-slate-400">
            {lang === 'tr' ? 'Kayıtlı maliyet bulunmamaktadır.' : 'No declared costs available.'}
          </div>
        )}

        {/* Counts Bento card */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{lang === 'tr' ? 'Beyanname Durumları' : 'Statement Statuses'}</span>
          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="text-center bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex-1">
              <p className="text-xs text-emerald-800 font-bold">{lang === 'tr' ? 'Ödenen' : 'Paid'}</p>
              <p className="text-lg font-black text-emerald-900 mt-0.5">{statusCounts.Paid || 0}</p>
            </div>
            <div className="text-center bg-orange-50 border border-orange-200 rounded-lg p-2 flex-1">
              <p className="text-xs text-orange-800 font-bold">{lang === 'tr' ? 'Kısmi' : 'Partial'}</p>
              <p className="text-lg font-black text-orange-950 mt-0.5">{statusCounts.Partial || 0}</p>
            </div>
            <div className="text-center bg-red-50 border border-red-200 rounded-lg p-2 flex-1">
              <p className="text-xs text-slate-700 font-bold">{lang === 'tr' ? 'Ödenmemiş' : 'Unpaid'}</p>
              <p className="text-lg font-black text-slate-900 mt-0.5">{statusCounts.Unpaid || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Analytics Charts Panel */}
      <div className={`grid grid-cols-1 ${isMobileMode ? '' : 'lg:grid-cols-3'} gap-6`}>

        {/* Cost by Freight Type */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col">
          <h3 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5 uppercase tracking-wide">
            <BarChartIcon className="w-4 h-4 text-slate-500" />
            <span>{lang === 'tr' ? 'Yük Tipine Göre Maliyet' : 'Maliyet Dağılımı (Segment)'}</span>
          </h3>
          <div className="h-44 mt-auto">
            {freightChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={freightChartData}>
                  <XAxis dataKey="name" fontSize={10} stroke="#64748b" tickLine={false} axisLine={false} />
                  <YAxis fontSize={10} stroke="#64748b" tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => [`${Number(value).toLocaleString()} Total`, 'Cost']} />
                  <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 italic text-xs">No analytics data available.</div>
            )}
          </div>
        </div>

        {/* Cost by Customer (Top 5) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col">
          <h3 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5 uppercase tracking-wide">
            <ClipboardList className="w-4 h-4 text-slate-500" />
            <span>{lang === 'tr' ? 'Müşterilere Göre Maliyet (En Yüksek 5)' : 'Top 5 Customers by Expense Volume'}</span>
          </h3>
          <div className="h-44 mt-auto">
            {customerChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={customerChartData} layout="vertical">
                  <XAxis type="number" fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={80} fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                  <Tooltip formatter={(val) => [`${Number(val).toLocaleString()}`, 'Total Cost']} />
                  <Bar dataKey="value" fill="#0f172a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 italic text-xs">No analytics data available.</div>
            )}
          </div>
        </div>

        {/* Cost by Supplier (Top 5) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col">
          <h3 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5 uppercase tracking-wide">
            <Building2 className="w-4 h-4 text-slate-500" />
            <span>{lang === 'tr' ? 'Tedarikçilere Göre Ödemeler (En Yüksek 5)' : 'Top Suppliers by Declared Costs'}</span>
          </h3>
          <div className="h-44 mt-auto">
            {supplierChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={supplierChartData}>
                  <XAxis dataKey="name" fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                  <YAxis fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                  <Tooltip formatter={(val) => [`${Number(val).toLocaleString()}`, 'Settlements']} />
                  <Bar dataKey="value" fill="#14532d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 italic text-xs">No supplier entries recorded.</div>
            )}
          </div>
        </div>

      </div>

      {/* Interactive Filters and Registry */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-4">

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

          {/* Search Bar matching ship / customer / supplier */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={costSearchQuery}
              onChange={(e) => onCostSearchQueryChange(e.target.value)}
              placeholder={lang === 'tr' ? "Sevkiyat No, müşteri, tedarikçi adı, plaka ile ara..." : "Search by shipment, customer, supplier name, truck plate..."}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:border-slate-400 font-sans shadow-inner"
            />
            {costSearchQuery && (
              <button
                onClick={() => onCostSearchQueryChange("")}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 font-bold text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* Status Drop Filter */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
              <span className="text-slate-500 font-semibold">{lang === 'tr' ? 'Ödeme Durumu:' : 'Payment:'}</span>
              <select
                value={costStatusFilter}
                onChange={(e) => onCostStatusFilterChange(e.target.value as any)}
                className="bg-transparent font-bold outline-none cursor-pointer"
              >
                <option value="All">{lang === 'tr' ? 'Tümü' : 'All'}</option>
                <option value="Paid">{lang === 'tr' ? 'Ödenen' : 'Paid'}</option>
                <option value="Partial">{lang === 'tr' ? 'Kısmi' : 'Partial'}</option>
                <option value="Unpaid">{lang === 'tr' ? 'Ödenmemiş' : 'Unpaid'}</option>
              </select>
            </div>

            {/* Freight Segment Filter */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
              <span className="text-slate-500 font-semibold">{lang === 'tr' ? 'Sevkiyat Segmenti:' : 'Segment:'}</span>
              <select
                value={costTypeFilter}
                onChange={(e) => onCostTypeFilterChange(e.target.value as any)}
                className="bg-transparent font-bold outline-none cursor-pointer text-xs"
              >
                <option value="All">{lang === 'tr' ? 'Tümü' : 'All'}</option>
                <option value="land">{lang === 'tr' ? 'Karayolu' : 'Land'}</option>
                <option value="sea">{lang === 'tr' ? 'Denizyolu' : 'Sea'}</option>
                <option value="air">{lang === 'tr' ? 'Havayolu' : 'Air'}</option>
              </select>
            </div>

          </div>

        </div>

        {/* Shipment Registry List */}
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <th className="p-3 font-semibold">{lang === 'tr' ? 'Sevkiyat / Yük Detayı' : 'Shipment Details'}</th>
                <th className="p-3 font-semibold">{lang === 'tr' ? 'Müşteri / Firma' : 'Shipper / Client'}</th>
                <th className="p-3 font-semibold text-center">{lang === 'tr' ? 'Yük Tipi' : 'Freight Type'}</th>
                <th className="p-3 font-semibold text-right">{lang === 'tr' ? 'Öngörülen Tutar' : 'Contract Agreed Amount'}</th>
                <th className="p-3 font-semibold text-right">{lang === 'tr' ? 'Toplam Maliyetlerin' : 'Total Expense Declared'}</th>
                <th className="p-3 font-semibold text-right">{lang === 'tr' ? 'Ödenen / Bakiye' : 'Paid / Balance'}</th>
                <th className="p-3 font-semibold text-center">{lang === 'tr' ? 'Fatura Durumu' : 'Budget Status'}</th>
                <th className="p-3 font-semibold text-center">{lang === 'tr' ? 'İşlemler' : 'Action Tool'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredShipmentsCosts.length > 0 ? (
                filteredShipmentsCosts.map((row) => {
                  const stmt = row.statement;
                  const freightType = row.freightType;

                  return (
                    <tr key={row.shipmentId} className="hover:bg-slate-50/50 transition-colors">

                      {/* Shipment Details */}
                      <td className="p-3">
                        <div className="font-extrabold text-slate-900 group-hover:text-orange-600 transition-colors uppercase tracking-tight">{row.shipmentNumber}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 max-w-xs truncate">{row.cargoDescription || "General cargo goods"}</div>
                      </td>

                      {/* Client Name */}
                      <td className="p-3 font-semibold text-slate-800">{row.companyName}</td>

                      {/* Freight Segment Type */}
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center justify-center p-1.5 bg-slate-100 border border-slate-200 text-slate-600 rounded-lg">
                          {freightType === 'land' ? <Truck className="w-3.5 h-3.5" /> : freightType === 'sea' ? <Ship className="w-3.5 h-3.5 text-blue-600" /> : <Plane className="w-3.5 h-3.5 text-violet-600" />}
                        </span>
                      </td>

                      {/* Contract amount agreed with customer */}
                      <td className="p-3 text-right font-mono font-bold text-slate-700">
                        {Number(row.agreedAmount || 0).toLocaleString()} <span className="text-[10px] text-slate-400">{row.currency || "USD"}</span>
                      </td>

                      {/* Declared total costs */}
                      <td className="p-3 text-right">
                        {stmt ? (
                          <span className="font-mono font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {Number(stmt.totalCost).toLocaleString()} <span className="text-[10px] text-slate-500">{stmt.currency}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px] font-mono">0.00 {row.currency || "USD"}</span>
                        )}
                      </td>

                      {/* Paid and Remaining Balance block */}
                      <td className="p-3 text-right font-mono font-medium">
                        {stmt ? (
                          <div className="space-y-0.5">
                            <div className="text-emerald-600 font-bold">{Number(stmt.paidAmount).toLocaleString()} <span className="text-[9px] text-slate-400">{stmt.currency}</span></div>
                            <div className="text-orange-600 font-bold text-[10px]">{Number(stmt.remainingBalance).toLocaleString()} <span className="text-[9px] text-slate-400">Due</span></div>
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Budget payment status */}
                      <td className="p-3 text-center">
                        {stmt ? (
                          <span className={`inline-block text-[10px] font-black uppercase px-2.5 py-1 rounded-full tracking-wide ${
                            stmt.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200/50' : stmt.paymentStatus === 'Partial' ? 'bg-orange-100 text-orange-800 border border-orange-200/50' : 'bg-red-100 text-red-800 border border-red-200/50'
                          }`}>
                            {stmt.paymentStatus}
                          </span>
                        ) : (
                          <span className="inline-block text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200/60 px-2.5 py-1 rounded-full">{lang === 'tr' ? 'Eklenmedi' : 'Unconfigured'}</span>
                        )}
                      </td>

                      {/* Action to create or view cost statement */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => onSelectActiveStatement(row.shipmentId)}
                          className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-xl border transition-all cursor-pointer inline-flex items-center gap-1 shrink-0 ${
                            stmt
                              ? 'bg-slate-900 border-slate-800 text-white hover:bg-slate-800'
                              : 'bg-white border-orange-500/40 hover:border-orange-500 text-orange-600 hover:bg-orange-500/5'
                          }`}
                        >
                          {stmt ? <Edit3 className="w-3 h-3 text-orange-400" /> : <Plus className="w-3 h-3 text-orange-500 animate-pulse" />}
                          <span>{stmt ? (lang === 'tr' ? 'Düzenle / İncele' : 'Manage Costs') : (lang === 'tr' ? 'Tablo Oluştur' : 'Add Costs')}</span>
                        </button>
                      </td>

                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 italic font-medium">
                    {lang === 'tr' ? 'Aranan bütçe kriterlerine uygun sevkiyat bulunamadı.' : 'No matched shipments found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
}
