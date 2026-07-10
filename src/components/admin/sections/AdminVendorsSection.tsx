import type { FormEvent } from 'react';
import { UserPlus, Search, Mail, Phone, X } from 'lucide-react';
import type { Language, Vendor, CostStatement } from '../../../types';
import { TRANSLATIONS } from '../../../translations';

interface AdminVendorsSectionProps {
  lang: Language;
  t: (key: keyof typeof TRANSLATIONS['en']) => string;
  canWriteVendors: boolean;
  vendors: Vendor[];
  costStatements: CostStatement[];
  vendorSearchQuery: string;
  setVendorSearchQuery: (value: string) => void;
  isAddVendorOpen: boolean;
  setIsAddVendorOpen: (value: boolean) => void;
  isSubmittingVendor: boolean;
  handleAddVendorSubmit: (e: FormEvent) => Promise<void>;
  newVendorCompanyName: string;
  setNewVendorCompanyName: (value: string) => void;
  newVendorContactName: string;
  setNewVendorContactName: (value: string) => void;
  newVendorServiceType: string;
  setNewVendorServiceType: (value: string) => void;
  newVendorEmail: string;
  setNewVendorEmail: (value: string) => void;
  newVendorPhone: string;
  setNewVendorPhone: (value: string) => void;
  newVendorAddress: string;
  setNewVendorAddress: (value: string) => void;
  newVendorNotes: string;
  setNewVendorNotes: (value: string) => void;
}

/**
 * Vendor & Partner Directory tab content, extracted from AdminPanel.tsx
 * (PR #78, Admin bundle-size split phase 2) so it can be React.lazy-loaded
 * instead of always shipping in the main AdminPanel chunk. Role gating
 * (canManageVendors, computed as canWriteVendors in AdminPanel.tsx) and the
 * add-vendor submit handler stay in AdminPanel.tsx — this component only
 * holds the form/search UI state and renders once the caller has already
 * decided the tab may render.
 */
export default function AdminVendorsSection({
  lang,
  t,
  canWriteVendors,
  vendors,
  costStatements,
  vendorSearchQuery,
  setVendorSearchQuery,
  isAddVendorOpen,
  setIsAddVendorOpen,
  isSubmittingVendor,
  handleAddVendorSubmit,
  newVendorCompanyName,
  setNewVendorCompanyName,
  newVendorContactName,
  setNewVendorContactName,
  newVendorServiceType,
  setNewVendorServiceType,
  newVendorEmail,
  setNewVendorEmail,
  newVendorPhone,
  setNewVendorPhone,
  newVendorAddress,
  setNewVendorAddress,
  newVendorNotes,
  setNewVendorNotes,
}: AdminVendorsSectionProps) {
  const filteredVendors = vendors.filter(v =>
    v.companyName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
    v.contactName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
    v.serviceType.toLowerCase().includes(vendorSearchQuery.toLowerCase())
  );

  const getServiceTypeColor = (type: string) => {
    const tt = type.toLowerCase();
    if (tt.includes('customs')) return 'bg-purple-50 text-purple-700 border-purple-100';
    if (tt.includes('port')) return 'bg-cyan-50 text-cyan-700 border-cyan-100';
    if (tt.includes('sea') || tt.includes('ship')) return 'bg-blue-50 text-blue-700 border-blue-100';
    if (tt.includes('transit') || tt.includes('fuel')) return 'bg-amber-50 text-amber-700 border-amber-100';
    if (tt.includes('truck') || tt.includes('road') || tt.includes('land')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    return 'bg-slate-50 text-slate-600 border-slate-100';
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 leading-tight">
            {lang === 'tr' ? "Tedarikçi ve Çözüm Ortakları" : (lang === 'ar' ? "قاعدة بيانات الموردين" : "Vendor & Partner Directory")}
          </h2>
          <p className="text-slate-500 text-xs mt-0.5 font-medium">
            {lang === 'tr' ? "Gümrük acenteleri, limanlar, armatörler ve nakliye tedarikçilerinizi yönetin, maliyet ilişkilendirmelerini inceleyin." : (lang === 'ar' ? "إدارة مخلصي الجمارك، والموانئ، وخطوط الشحن، والموردين الخارجيين مع رصد لبيانات التكلفة." : "Manage customs clearance dispatchers, harbor terminals, shipping lines, and operational trade vendors.")}
          </p>
        </div>
        {canWriteVendors && (
          <button
            onClick={() => setIsAddVendorOpen(true)}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-sm hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border-0 w-full sm:w-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>{lang === 'tr' ? "Yeni Tedarikçi Ekle" : (lang === 'ar' ? "إضافة مورد جديد" : "Add New Vendor")}</span>
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Search and Filters Bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder={lang === 'tr' ? "Tedarikçi veya yetkili ara..." : (lang === 'ar' ? "البحث عن مورد أو شريك..." : "Search corporate vendors, custom brokers...")}
              value={vendorSearchQuery}
              onChange={(e) => setVendorSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 w-full text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-semibold"
            />
          </div>
          <div className="text-xs text-slate-500 font-semibold">
            {filteredVendors.length} {lang === 'tr' ? "tedarikçi bulundu" : (lang === 'ar' ? "الموردين الذين تم العثور عليهم" : "vendors found")}
          </div>
        </div>

        {/* Vendors Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs md:text-sm">
            <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">{lang === 'tr' ? "Tedarikçi Adı" : (lang === 'ar' ? "اسم المورد" : "Partner Name")}</th>
                <th className="px-5 py-3.5">{lang === 'tr' ? "Hizmet Türü" : (lang === 'ar' ? "نوع الخدمة" : "Service Category")}</th>
                <th className="px-5 py-3.5">{lang === 'tr' ? "Yetkili Kişi" : (lang === 'ar' ? "جهة الاتصال" : "Representative")}</th>
                <th className="px-5 py-3.5">{lang === 'tr' ? "İletişim" : (lang === 'ar' ? "الاتصال" : "Contact Details")}</th>
                <th className="px-5 py-3.5">{lang === 'tr' ? "Kayıtlı Gider" : (lang === 'ar' ? "المصاريف المرتبطة" : "Linked Expenses")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                    {lang === 'tr' ? "Kriterlere uygun kayıtlı tedarikçi bulunamadı." : (lang === 'ar' ? "لم يتم العثور على أي موردين مطابقين." : "No registered partners found matching filter.")}
                  </td>
                </tr>
              ) : (
                filteredVendors.map((vendor) => {
                  const linkedItemsCount = costStatements
                    .flatMap(cs => cs.items || [])
                    .filter(item => (item.supplierName || '').toLowerCase().trim() === vendor.companyName.toLowerCase().trim()).length;

                  return (
                    <tr key={vendor.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-extrabold text-slate-800 leading-snug">{vendor.companyName}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                          Registered: {new Date(vendor.createdAt).toLocaleDateString()}
                        </div>
                        {vendor.address && (
                          <div className="text-[10px] text-slate-500 mt-1 max-w-xs truncate" title={vendor.address}>
                            📍 {vendor.address}
                          </div>
                        )}
                        {vendor.notes && (
                          <div className="text-[10px] text-slate-400 italic mt-0.5 max-w-xs truncate" title={vendor.notes}>
                            Note: {vendor.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black border uppercase tracking-wider ${getServiceTypeColor(vendor.serviceType)}`}>
                          {vendor.serviceType}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-700">
                        {vendor.contactName}
                      </td>
                      <td className="px-5 py-4 space-y-0.5">
                        {vendor.email && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600">
                            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-medium font-mono">{vendor.email}</span>
                          </div>
                        )}
                        {vendor.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600">
                            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-mono">{vendor.phone}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-black ${
                          linkedItemsCount > 0
                            ? "bg-orange-50 text-orange-600 border border-orange-100"
                            : "bg-slate-50 text-slate-400 border border-slate-100"
                        }`}>
                          {linkedItemsCount} {lang === 'tr' ? "Maliyet Satırı" : (lang === 'ar' ? "بنود التكلفة" : "Cost Items")}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Vendor slideover/Modal Overlay */}
      {isAddVendorOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-slate-900">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl w-full max-w-lg overflow-hidden animate-scale-up">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div>
                <h3 className="font-black text-sm tracking-tight uppercase text-orange-500">
                  {lang === 'tr' ? "Yeni Tedarikçi Tanımla" : (lang === 'ar' ? "إضافة شريك توريد" : "Register Freight Supplier")}
                </h3>
                <h2 className="text-xl font-black">
                  {lang === 'tr' ? "Sistem Tedarikçi Kartı" : (lang === 'ar' ? "بطاقة المورد الجديدة" : "Add New Logistics Supplier")}
                </h2>
              </div>
              <button
                onClick={() => setIsAddVendorOpen(false)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer border-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddVendorSubmit} className="p-6 space-y-4 text-xs font-sans">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2 text-slate-900">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "Şirket / Kuruluş Adı" : (lang === 'ar' ? "اسم الشركة" : "Company / Firm Name")} *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Erbil Transit Customs Brokerage"
                    value={newVendorCompanyName}
                    onChange={(e) => setNewVendorCompanyName(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-bold bg-white text-slate-900"
                  />
                </div>

                <div className="space-y-1.5 text-slate-900">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "Yetkili Temsilci" : (lang === 'ar' ? "الشخص المسؤول" : "Contact Representative")} *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Saman Ahmed"
                    value={newVendorContactName}
                    onChange={(e) => setNewVendorContactName(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium bg-white text-slate-900"
                  />
                </div>

                <div className="space-y-1.5 text-slate-900 overflow-hidden">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "Hizmet Kategorisi" : (lang === 'ar' ? "تصنيف الخدمة" : "Service Category")} *</label>
                  <select
                    value={newVendorServiceType}
                    onChange={(e) => setNewVendorServiceType(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 bg-white font-bold text-slate-900"
                  >
                    <option value="Customs Clearance">{lang === 'tr' ? "Gümrük Müşavirliği" : "Customs Clearance"}</option>
                    <option value="Port Services">{lang === 'tr' ? "Liman Hizmetleri" : "Port Services"}</option>
                    <option value="Shipping Line">{lang === 'tr' ? "Denizyolu Acentesi" : "Shipping Line"}</option>
                    <option value="Transit & Fuel">{lang === 'tr' ? "Transit Geçiş & Yakıt" : "Transit & Fuel"}</option>
                    <option value="Inland Trucking">{lang === 'tr' ? "Çekici & Dorse Nakliye" : "Inland Trucking"}</option>
                    <option value="Other Service">{lang === 'tr' ? "Diğer Hizmet Sağlayıcı" : "Other Service"}</option>
                  </select>
                </div>

                <div className="space-y-1.5 text-slate-900">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "E-posta Adresi" : (lang === 'ar' ? "البريد الإلكتروني" : "Email Address")}</label>
                  <input
                    type="email"
                    placeholder="e.g. ops@erbilcustoms.iq"
                    value={newVendorEmail}
                    onChange={(e) => setNewVendorEmail(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono bg-white text-slate-900"
                  />
                </div>

                <div className="space-y-1.5 text-slate-900">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "Telefon Numarası" : (lang === 'ar' ? "رقم الهاتف" : "Phone Number")} *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. +964 750 111 2233"
                    value={newVendorPhone}
                    onChange={(e) => setNewVendorPhone(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono bg-white text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-1.5 text-slate-900">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Hizmet / Ofis Adresi" : (lang === 'ar' ? "العنوان بالتفصيل" : "Operational Office Address")}</label>
                <input
                  type="text"
                  placeholder="e.g. Ibrahim Khalil Border Gate Office #4, Zakho"
                  value={newVendorAddress}
                  onChange={(e) => setNewVendorAddress(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium bg-white text-slate-900"
                />
              </div>

              <div className="space-y-1.5 text-slate-900">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Ek Notlar / Anlaşma Detayları" : (lang === 'ar' ? "ملاحظات وشروط" : "Internal Notes & Credit Terms")}</label>
                <textarea
                  placeholder="e.g. 30 days payment credit term. Net cash only for borders."
                  value={newVendorNotes}
                  onChange={(e) => setNewVendorNotes(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium opacity-90 bg-white text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 text-slate-900">
                <button
                  type="button"
                  onClick={() => setIsAddVendorOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer border-0"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVendor}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 cursor-pointer border-0 inline-flex items-center gap-1"
                >
                  {isSubmittingVendor ? (lang === 'tr' ? "Kaydediliyor..." : "Saving Vendor...") : (lang === 'tr' ? "Çözüm Ortağını Kaydet" : "Save Vendor")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
