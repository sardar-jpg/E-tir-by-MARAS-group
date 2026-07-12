import type { FormEvent } from 'react';
import React from 'react';
import { UserPlus, Search, ClipboardList, Pencil, Mail, Phone, Share2, MessageSquare, Ship, Lock } from 'lucide-react';
import type { Language, Client, Shipment } from '../../../types';
import { TRANSLATIONS } from '../../../translations';
import PasswordInput from '../../PasswordInput';

interface AdminClientsSectionProps {
  lang: Language;
  t: (key: keyof typeof TRANSLATIONS['en']) => string;
  canWriteClients: boolean;
  clients: Client[];
  shipments: Shipment[];
  clientSearchQuery: string;
  setClientSearchQuery: (value: string) => void;
  expandedClientOrdersCompanyName: string | null;
  setExpandedClientOrdersCompanyName: (value: string | null) => void;
  isAddClientOpen: boolean;
  setIsAddClientOpen: (value: boolean) => void;
  isSubmittingClient: boolean;
  handleAddClientSubmit: (e: FormEvent) => Promise<void>;
  editClientTarget: Client | null;
  setEditClientTarget: (value: Client | null) => void;
  openEditClient: (client: Client) => void;
  isSubmittingEditClient: boolean;
  handleEditClientSubmit: (e: FormEvent) => Promise<void>;
  newClientCompanyName: string;
  setNewClientCompanyName: (value: string) => void;
  newClientContactName: string;
  setNewClientContactName: (value: string) => void;
  newClientPhone: string;
  setNewClientPhone: (value: string) => void;
  newClientEmail: string;
  setNewClientEmail: (value: string) => void;
  newClientAddress: string;
  setNewClientAddress: (value: string) => void;
  newClientNotes: string;
  setNewClientNotes: (value: string) => void;
  newClientIsEmployee: boolean;
  setNewClientIsEmployee: (value: boolean) => void;
  newClientUsername: string;
  setNewClientUsername: (value: string) => void;
  newClientPassword: string;
  setNewClientPassword: (value: string) => void;
  newClientConfirmPassword: string;
  setNewClientConfirmPassword: (value: string) => void;
  editClientContactName: string;
  setEditClientContactName: (value: string) => void;
  editClientPhone: string;
  setEditClientPhone: (value: string) => void;
  editClientEmail: string;
  setEditClientEmail: (value: string) => void;
  editClientAddress: string;
  setEditClientAddress: (value: string) => void;
  editClientNotes: string;
  setEditClientNotes: (value: string) => void;
  editClientIsEmployee: boolean;
  setEditClientIsEmployee: (value: boolean) => void;
  editClientUsername: string;
  setEditClientUsername: (value: string) => void;
  editClientPassword: string;
  setEditClientPassword: (value: string) => void;
  editClientConfirmPassword: string;
  setEditClientConfirmPassword: (value: string) => void;
  passwordToggleClasses: string;
  showPasswordLabel: string;
  hidePasswordLabel: string;
  triggerToast: (msg: string) => void;
  getDirectLink: (token: string) => string;
  getWhatsAppLink: (shipmentNum: string, token: string, loading: string, delivery: string) => string;
  handlePrepopulateGmail: (shipmentId: string) => void;
  setActiveTab: (tabId: 'gmail') => void;
}

/**
 * Clients Database tab content, extracted from AdminPanel.tsx (PR #78,
 * Admin bundle-size split phase 2) so it can be React.lazy-loaded instead
 * of always shipping in the main AdminPanel chunk. Role gating
 * (canManageClients, computed as canWriteClients in AdminPanel.tsx) and the
 * add/edit-client submit handlers stay in AdminPanel.tsx — this component
 * only holds the form/search/expand UI state and renders once the caller
 * has already decided the tab may render.
 */
export default function AdminClientsSection({
  lang,
  t,
  canWriteClients,
  clients,
  shipments,
  clientSearchQuery,
  setClientSearchQuery,
  expandedClientOrdersCompanyName,
  setExpandedClientOrdersCompanyName,
  isAddClientOpen,
  setIsAddClientOpen,
  isSubmittingClient,
  handleAddClientSubmit,
  editClientTarget,
  setEditClientTarget,
  openEditClient,
  isSubmittingEditClient,
  handleEditClientSubmit,
  newClientCompanyName,
  setNewClientCompanyName,
  newClientContactName,
  setNewClientContactName,
  newClientPhone,
  setNewClientPhone,
  newClientEmail,
  setNewClientEmail,
  newClientAddress,
  setNewClientAddress,
  newClientNotes,
  setNewClientNotes,
  newClientIsEmployee,
  setNewClientIsEmployee,
  newClientUsername,
  setNewClientUsername,
  newClientPassword,
  setNewClientPassword,
  newClientConfirmPassword,
  setNewClientConfirmPassword,
  editClientContactName,
  setEditClientContactName,
  editClientPhone,
  setEditClientPhone,
  editClientEmail,
  setEditClientEmail,
  editClientAddress,
  setEditClientAddress,
  editClientNotes,
  setEditClientNotes,
  editClientIsEmployee,
  setEditClientIsEmployee,
  editClientUsername,
  setEditClientUsername,
  editClientPassword,
  setEditClientPassword,
  editClientConfirmPassword,
  setEditClientConfirmPassword,
  passwordToggleClasses,
  showPasswordLabel,
  hidePasswordLabel,
  triggerToast,
  getDirectLink,
  getWhatsAppLink,
  handlePrepopulateGmail,
  setActiveTab,
}: AdminClientsSectionProps) {
  const filteredClients = clients.filter(c =>
    c.companyName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
    c.contactName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(clientSearchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 leading-tight">
            {lang === 'tr' ? "Müşteri Veritabanı" : (lang === 'ar' ? "قاعدة بيانات العملاء" : "Clients Database")}
          </h2>
          <p className="text-slate-500 text-xs mt-0.5 font-medium">
            {lang === 'tr' ? "Sistemdeki tüm kayıtlı göndericileri yönetin, siparişlerini ve takip bağlantılarını inceleyin." : (lang === 'ar' ? "إدارة شاحني البضائع المسجلين، والتحقق من طلباتهم، ومشاركة روابط التتبع." : "Manage corporate freight shippers, check order histories, and share real-time tracking links.")}
          </p>
        </div>
        {canWriteClients && (
          <button
            onClick={() => setIsAddClientOpen(true)}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-sm hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>{lang === 'tr' ? "Yeni Müşteri Ekle" : (lang === 'ar' ? "إضافة عميل جديد" : "Add New Client")}</span>
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
              placeholder={lang === 'tr' ? "Müşteri veya yetkili ara..." : (lang === 'ar' ? "البحث عن عميل أو جهة اتصال..." : "Search client company, contact...")}
              value={clientSearchQuery}
              onChange={(e) => setClientSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 w-full text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="text-xs text-slate-500 font-semibold">
            {filteredClients.length} {lang === 'tr' ? "müşteri bulundu" : (lang === 'ar' ? "العملاء الذين تم العثور عليهم" : "clients found")}
          </div>
        </div>

        {/* Clients Grid/Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs md:text-sm">
            <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">{lang === 'tr' ? "Şirket / Kuruluş" : (lang === 'ar' ? "الشركة / المؤسسة" : "Company / Organization")}</th>
                <th className="px-5 py-3.5">{lang === 'tr' ? "Yetkili Temsilci" : (lang === 'ar' ? "جهة الاتصال" : "Representative")}</th>
                <th className="px-5 py-3.5">{lang === 'tr' ? "İletişim Bilgileri" : (lang === 'ar' ? "معلومات الاتصال" : "Contact Details")}</th>
                <th className="px-5 py-3.5">{lang === 'tr' ? "Sipariş Sayısı" : (lang === 'ar' ? "عدد الطلبات" : "Orders Count")}</th>
                <th className="px-5 py-3.5 text-right">{lang === 'tr' ? "İşlemler" : (lang === 'ar' ? "الإجراءات" : "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                    {lang === 'tr' ? "Herhangi bir kayıtlı müşteri bulunamadı." : (lang === 'ar' ? "لم يتم العثور على أي عملاء مسجلين." : "No registered clients found matching filter.")}
                  </td>
                </tr>
              ) : (
                filteredClients.map((client) => {
                  const clientShipments = shipments.filter(s => s.companyName.toLowerCase().trim() === client.companyName.toLowerCase().trim());
                  const isExpanded = expandedClientOrdersCompanyName === client.companyName;

                  return (
                    <React.Fragment key={client.id}>
                      <tr className={`hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-orange-50/10' : ''}`}>
                        <td className="px-5 py-4">
                          <div className="font-extrabold text-slate-800 leading-snug">{client.companyName}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {lang === 'tr' ? "Kayıt:" : (lang === 'ar' ? "التسجيل:" : "Registered:")} {new Date(client.createdAt).toLocaleDateString()}
                          </div>
                          {client.notes && (
                            <div className="text-[10px] text-slate-500 italic mt-1 max-w-xs truncate" title={client.notes}>
                              {client.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-700">
                          <div className="flex items-center gap-2">
                            <span>{client.contactName}</span>
                            {client.isEmployee && (
                              <span className="px-1.5 py-0.5 bg-orange-50 border border-orange-200 text-orange-600 text-[9px] font-black uppercase rounded tracking-wider">
                                {lang === 'tr' ? "Müşteri Personeli" : (lang === 'ar' ? "طاقم العميل" : "Client Staff")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs text-slate-600">
                            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-medium">{client.email || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-600">
                            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-mono">{client.phone || '—'}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-black ${
                            clientShipments.length > 0
                              ? "bg-orange-50 text-orange-600 border border-orange-100"
                              : "bg-slate-50 text-slate-400 border border-slate-100"
                          }`}>
                            {clientShipments.length} {lang === 'tr' ? "Sipariş" : (lang === 'ar' ? "طلبات" : "Orders")}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canWriteClients && (
                              <button
                                onClick={() => openEditClient(client)}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded-lg text-xs font-black cursor-pointer inline-flex items-center gap-1 border-0"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>{lang === 'tr' ? "Düzenle" : (lang === 'ar' ? "تعديل" : "Edit")}</span>
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setExpandedClientOrdersCompanyName(isExpanded ? null : client.companyName);
                              }}
                              className="px-2.5 py-1.5 bg-orange-100 hover:bg-orange-200 text-orange-700 hover:text-orange-800 rounded-lg text-xs font-black cursor-pointer inline-flex items-center gap-1 border-0"
                            >
                              <ClipboardList className="w-3.5 h-3.5" />
                              <span>
                                {isExpanded
                                  ? (lang === 'tr' ? "Gizle" : (lang === 'ar' ? "إخفاء" : "Hide Details"))
                                  : (lang === 'tr' ? "İncele" : (lang === 'ar' ? "عرض الطلبات" : "Check Orders"))
                                }
                              </span>
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Client Orders Section */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="px-5 py-4 bg-slate-50/50">
                            <div className="border border-slate-200 rounded-xl bg-white p-4 shadow-xs space-y-3">
                              <h4 className="font-extrabold text-sm text-slate-800 flex items-center gap-1.5">
                                <Ship className="w-4 h-4 text-orange-500" />
                                <span>{client.companyName} — {lang === 'tr' ? "Sipariş Geçmişi" : (lang === 'ar' ? "سجل الطلبات" : "Shipment Order History")}</span>
                              </h4>

                              {clientShipments.length === 0 ? (
                                <div className="py-6 text-center text-xs text-slate-400 italic">
                                  {lang === 'tr' ? "Bu müşteriye ait aktif sipariş bulunmamaktadır." : (lang === 'ar' ? "لا يوجد أي طلبات بضائع لهذا العميل حالياً." : "No orders are currently linked with this client company name.")}
                                </div>
                              ) : (
                                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto pr-1">
                                  {clientShipments.map((shipment) => {
                                    return (
                                      <div key={shipment.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-2">
                                            <span className="font-black text-slate-800 text-sm selectable">#{shipment.shipmentNumber}</span>
                                            <span className={`px-1.5 py-0.5 rounded-sm font-bold text-[10px] uppercase border ${
                                              shipment.status === "Delivered" || shipment.status === "Closed"
                                                ? "bg-green-50 text-green-700 border-green-200"
                                                : "bg-orange-50 text-orange-700 border-orange-200"
                                            }`}>
                                              {shipment.status}
                                            </span>
                                          </div>
                                          <div className="text-slate-600 font-extrabold">
                                            {shipment.loadingCity} ({shipment.loadingCountry}) ➔ {shipment.deliveryCity} ({shipment.deliveryCountry})
                                          </div>
                                          <div className="text-[10px] text-slate-400">
                                            {lang === 'tr' ? "Yük:" : (lang === 'ar' ? "الحمولة:" : "Cargo:")} {shipment.cargoDescription} ({shipment.cargoWeight} kg)
                                          </div>
                                        </div>

                                        {/* Actions: Copy or Share tracking links */}
                                        <div className="flex items-center flex-wrap gap-2 pt-2 md:pt-0">
                                          {/* Direct Link */}
                                          <button
                                            onClick={() => {
                                              const link = getDirectLink(shipment.shareToken);
                                              navigator.clipboard.writeText(link);
                                              triggerToast(lang === 'tr' ? "Takip linki kopyalandı!" : (lang === 'ar' ? "تم نسخ رابط التتبع بالنجاح!" : "Tracking link copied to clipboard!"));
                                            }}
                                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded-md font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer border-0"
                                            title={lang === "tr" ? "Link Kopyala" : (lang === "ar" ? "نسخ الرابط" : "Copy Shared Link")}
                                          >
                                            <Share2 className="w-3.5 h-3.5" />
                                            <span>{lang === 'tr' ? "Linki Kopyala" : (lang === 'ar' ? "نسخ" : "Copy Link")}</span>
                                          </button>

                                          {/* WhatsApp Share */}
                                          <a
                                            href={getWhatsAppLink(shipment.shipmentNumber, shipment.shareToken, shipment.loadingCity, shipment.deliveryCity)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="px-2.5 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 hover:text-green-800 rounded-md font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer border-0 no-underline"
                                          >
                                            <MessageSquare className="w-3.5 h-3.5" />
                                            <span>WhatsApp</span>
                                          </a>

                                          {/* Gmail Prepopulate */}
                                          <button
                                            onClick={() => {
                                              handlePrepopulateGmail(shipment.id);
                                              setActiveTab('gmail');
                                              triggerToast(lang === 'tr' ? "Gmail Konsolu yüklendi!" : (lang === 'ar' ? "تم التجهيز في لوحة Gmail!" : "Loaded inside Gmail Console!"));
                                            }}
                                            className="px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 hover:text-orange-800 rounded-md font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer border-0"
                                            title={lang === 'tr' ? 'Müşteriye Gmail Gönder' : (lang === 'ar' ? 'إرسال بريد Gmail' : 'Compose Operator Gmail')}
                                          >
                                            <Mail className="w-3.5 h-3.5" />
                                            <span>{lang === 'tr' ? 'E-Posta Hazırla' : (lang === 'ar' ? 'تجهيز' : 'Compose')}</span>
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Client Modal */}
      {editClientTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Pencil className="text-orange-500 w-5 h-5" />
                  <span>{lang === 'tr' ? "Müşteriyi Düzenle" : (lang === 'ar' ? "تعديل بيانات العميل" : "Edit Client")}</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{editClientTarget.companyName}</p>
              </div>
              <button
                onClick={() => setEditClientTarget(null)}
                className="p-1 px-2 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 border-0 cursor-pointer text-xs font-bold rounded-md"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditClientSubmit} autoComplete="off" className="space-y-4 text-xs font-sans">
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Yetkili Kişi" : (lang === 'ar' ? "اسم جهة الاتصال" : "Contact Representative Name")} *</label>
                <input
                  type="text"
                  required
                  value={editClientContactName}
                  onChange={(e) => setEditClientContactName(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "E-Posta" : (lang === 'ar' ? "البريد الإلكتروني" : "Email")}</label>
                  <input
                    type="email"
                    value={editClientEmail}
                    onChange={(e) => setEditClientEmail(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "Telefon" : (lang === 'ar' ? "الهاتف" : "Phone")}</label>
                  <input
                    type="text"
                    value={editClientPhone}
                    onChange={(e) => setEditClientPhone(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Adres" : (lang === 'ar' ? "العنوان" : "Address")}</label>
                <input
                  type="text"
                  value={editClientAddress}
                  onChange={(e) => setEditClientAddress(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Notlar" : (lang === 'ar' ? "الملاحظات" : "Notes")}</label>
                <textarea
                  value={editClientNotes}
                  onChange={(e) => setEditClientNotes(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium opacity-90"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                {/* fix/client-create-username: decoy username+password pair,
                    visually hidden but present in the DOM (not display:none,
                    which Chrome ignores for autofill targeting) — absorbs
                    Chrome/Safari's "fill the saved credential pair" heuristic
                    so it doesn't land on the real fields below, which is
                    exactly what happened live (the signed-in Admin's own
                    saved username/password got auto-filled into this Client
                    record's credential fields). autoComplete="off" alone is
                    not reliably honored by Chrome's password manager, hence
                    this decoy in addition to the autoComplete hints below. */}
                <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }} aria-hidden="true">
                  <input type="text" name="username" autoComplete="username" tabIndex={-1} readOnly value="" />
                  <input type="password" name="password" autoComplete="current-password" tabIndex={-1} readOnly value="" />
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editClientIsEmployee}
                    onChange={(e) => setEditClientIsEmployee(e.target.checked)}
                    className="w-4 h-4 accent-orange-600 cursor-pointer"
                  />
                  <span className="font-bold text-slate-700 text-xs">
                    {lang === 'tr' ? "Müşteri Personeli" : (lang === 'ar' ? "طاقم العميل" : "Client Staff")}
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-600 text-[11px] uppercase tracking-wider">
                      {lang === 'tr' ? "Kullanıcı Adı" : (lang === 'ar' ? "اسم المستخدم" : "Username")}
                    </label>
                    <input
                      type="text"
                      name="edit-client-login-username"
                      id="edit-client-login-username"
                      autoComplete="off"
                      value={editClientUsername}
                      onChange={(e) => setEditClientUsername(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-600 text-[11px] uppercase tracking-wider">
                      {lang === 'tr' ? "Yeni Şifre" : (lang === 'ar' ? "كلمة مرور جديدة" : "New Password")}
                      <span className="font-normal normal-case ml-1 text-slate-400">(leave blank to keep)</span>
                    </label>
                    <PasswordInput
                      name="edit-client-new-password"
                      id="edit-client-new-password"
                      autoComplete="new-password"
                      placeholder="Leave blank to keep current"
                      value={editClientPassword}
                      onChange={(e) => setEditClientPassword(e.target.value)}
                      inputClassName="w-full p-2.5 pe-9 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono text-xs"
                      toggleClassName={passwordToggleClasses}
                      showLabel={showPasswordLabel}
                      hideLabel={hidePasswordLabel}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-600 text-[11px] uppercase tracking-wider">
                      {lang === 'tr' ? "Yeni Şifreyi Onayla" : (lang === 'ar' ? "تأكيد كلمة المرور الجديدة" : "Confirm New Password")}
                    </label>
                    <PasswordInput
                      name="edit-client-confirm-password"
                      id="edit-client-confirm-password"
                      autoComplete="new-password"
                      placeholder="Leave blank to keep current"
                      value={editClientConfirmPassword}
                      onChange={(e) => setEditClientConfirmPassword(e.target.value)}
                      inputClassName="w-full p-2.5 pe-9 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono text-xs"
                      toggleClassName={passwordToggleClasses}
                      showLabel={showPasswordLabel}
                      hideLabel={hidePasswordLabel}
                    />
                  </div>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-700 font-semibold flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{lang === 'ar' ? "اسم الشركة ثابت ولا يمكن تغييره — لإعادة ربط الحساب بشركة أخرى يجب حذفه وإنشاء حساب جديد." : lang === 'tr' ? "Şirket adı değiştirilemez — farklı bir şirkete bağlamak için hesabı silin ve yeniden oluşturun." : "Company name cannot be changed here — to re-scope to a different company, delete and recreate the account."}</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditClientTarget(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer border-0"
                >
                  {lang === 'tr' ? "İptal" : (lang === 'ar' ? "إلغاء" : "Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEditClient}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 cursor-pointer border-0 inline-flex items-center gap-1"
                >
                  {isSubmittingEditClient ? (lang === 'tr' ? "Kaydediliyor..." : (lang === 'ar' ? "جاري الحفظ..." : "Saving...")) : (lang === 'tr' ? "Değişiklikleri Kaydet" : (lang === 'ar' ? "حفظ التعديلات" : "Save Changes"))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Client Modal */}
      {isAddClientOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <UserPlus className="text-orange-500 w-5 h-5" />
                <span>{lang === 'tr' ? "Yeni Müşteri Oluştur" : (lang === 'ar' ? "تسجيل عميل جديد" : "Create New Customer / Client")}</span>
              </h3>
              <button
                onClick={() => setIsAddClientOpen(false)}
                className="p-1 px-2 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 border-0 cursor-pointer text-xs font-bold rounded-md"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddClientSubmit} autoComplete="off" className="space-y-4 text-xs font-sans">
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Şirket Adı" : (lang === 'ar' ? "اسم الشركة" : "Company / Corporate Name")} *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Al-Mansour Industries"
                  value={newClientCompanyName}
                  onChange={(e) => setNewClientCompanyName(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Yetkili Kişi" : (lang === 'ar' ? "اسم جهة الاتصال" : "Contact Representative Name")} *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ahmad Al-Mansour"
                  value={newClientContactName}
                  onChange={(e) => setNewClientContactName(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "E-Posta Adresi" : (lang === 'ar' ? "البريد الإلكتروني" : "Email Address")}</label>
                  <input
                    type="email"
                    placeholder="e.g. contact@domain.com"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">{lang === 'tr' ? "Telefon Numarası" : (lang === 'ar' ? "رقم الهاتف" : "Phone Number")}</label>
                  <input
                    type="text"
                    placeholder="e.g. +964 770 111 2233"
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Ofis Adresi" : (lang === 'ar' ? "العنوان" : "Physical Office Address")}</label>
                <input
                  type="text"
                  placeholder="e.g. Karrada District, Baghdad"
                  value={newClientAddress}
                  onChange={(e) => setNewClientAddress(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700">{lang === 'tr' ? "Dahili Notlar" : (lang === 'ar' ? "ملاحظات إضافية" : "Internal Notes")}</label>
                <textarea
                  placeholder="Special logistics preferences, VIP rating..."
                  value={newClientNotes}
                  onChange={(e) => setNewClientNotes(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium opacity-90"
                />
              </div>

              {/* Client Owner login account. This form creates the company
                  record and its Owner login only — Client Staff accounts
                  are created separately, attached to an existing company
                  (see the "+ Add Employee" flow), never from here. */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                {/* fix/client-create-username: decoy pair — see the matching
                    comment in the Edit Client modal above for why this is
                    needed in addition to the autoComplete hints below. */}
                <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }} aria-hidden="true">
                  <input type="text" name="username" autoComplete="username" tabIndex={-1} readOnly value="" />
                  <input type="password" name="password" autoComplete="current-password" tabIndex={-1} readOnly value="" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-600 text-[11px] uppercase tracking-wider">
                      {lang === 'tr' ? "Kullanıcı Adı" : (lang === 'ar' ? "اسم المستخدم" : "Username")}
                    </label>
                    <input
                      type="text"
                      name="new-client-login-username"
                      id="new-client-login-username"
                      autoComplete="off"
                      placeholder="e.g. ahmed.ali"
                      value={newClientUsername}
                      onChange={(e) => setNewClientUsername(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-600 text-[11px] uppercase tracking-wider">
                      {lang === 'tr' ? "Şifre" : (lang === 'ar' ? "كلمة المرور" : "Password")}
                    </label>
                    <PasswordInput
                      name="new-client-login-password"
                      id="new-client-login-password"
                      autoComplete="new-password"
                      placeholder="Set login password"
                      value={newClientPassword}
                      onChange={(e) => setNewClientPassword(e.target.value)}
                      inputClassName="w-full p-2.5 pe-9 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono text-xs"
                      toggleClassName={passwordToggleClasses}
                      showLabel={showPasswordLabel}
                      hideLabel={hidePasswordLabel}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-600 text-[11px] uppercase tracking-wider">
                      {lang === 'tr' ? "Şifreyi Onayla" : (lang === 'ar' ? "تأكيد كلمة المرور" : "Confirm Password")}
                    </label>
                    <PasswordInput
                      name="new-client-confirm-password"
                      id="new-client-confirm-password"
                      autoComplete="new-password"
                      placeholder="Confirm login password"
                      value={newClientConfirmPassword}
                      onChange={(e) => setNewClientConfirmPassword(e.target.value)}
                      inputClassName="w-full p-2.5 pe-9 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-mono text-xs"
                      toggleClassName={passwordToggleClasses}
                      showLabel={showPasswordLabel}
                      hideLabel={hidePasswordLabel}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddClientOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer border-0"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingClient}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 cursor-pointer border-0 inline-flex items-center gap-1"
                >
                  {isSubmittingClient ? (lang === 'tr' ? "Kaydediliyor..." : (lang === 'ar' ? "جاري الحفظ..." : "Saving Client...")) : (lang === 'tr' ? "Müşteriyi Kaydet" : (lang === 'ar' ? "حفظ ملف العميل" : "Save Client"))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
