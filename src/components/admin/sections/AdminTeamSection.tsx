import type { FormEvent } from 'react';
import { UserPlus, Plus, Trash2, Users, ShieldCheck } from 'lucide-react';
import type { Language } from '../../../types';
import PasswordInput from '../../PasswordInput';
import EmployeePermissionsEditor from '../EmployeePermissionsEditor';

interface AdminTeamSectionProps {
  lang: Language;
  adminsList: any[];
  isAddAdminOpen: boolean;
  setIsAddAdminOpen: (value: boolean) => void;
  adminFormError: string | null;
  setAdminFormError: (value: string | null) => void;
  newAdminName: string;
  setNewAdminName: (value: string) => void;
  newAdminEmail: string;
  setNewAdminEmail: (value: string) => void;
  newAdminPassword: string;
  setNewAdminPassword: (value: string) => void;
  newAdminConfirmPassword: string;
  setNewAdminConfirmPassword: (value: string) => void;
  newAdminType: 'operation' | 'accounts';
  setNewAdminType: (value: 'operation' | 'accounts') => void;
  handleCreateAdmin: (e: FormEvent) => Promise<void>;
  handleDeleteAdmin: (adminId: string) => Promise<void>;
  passwordToggleClasses: string;
  showPasswordLabel: string;
  hidePasswordLabel: string;
}

/**
 * Operation & Account Team ("Staff & Permissions") tab content, extracted
 * from AdminPanel.tsx (PR #78, Admin bundle-size split phase 2) so it can be
 * React.lazy-loaded instead of always shipping in the main AdminPanel chunk.
 * Role gating (resolvedAdminType === 'super') and the create/delete admin
 * handlers themselves stay in AdminPanel.tsx — this component only renders
 * once the caller has already decided it's allowed, and only holds the form
 * UI state, not the API logic.
 */
export default function AdminTeamSection({
  lang,
  adminsList,
  isAddAdminOpen,
  setIsAddAdminOpen,
  adminFormError,
  setAdminFormError,
  newAdminName,
  setNewAdminName,
  newAdminEmail,
  setNewAdminEmail,
  newAdminPassword,
  setNewAdminPassword,
  newAdminConfirmPassword,
  setNewAdminConfirmPassword,
  newAdminType,
  setNewAdminType,
  handleCreateAdmin,
  handleDeleteAdmin,
  passwordToggleClasses,
  showPasswordLabel,
  hidePasswordLabel,
}: AdminTeamSectionProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-indigo-600" />
              {lang === 'tr' ? 'Operasyon ve Hesap Yönetim Ekibi' : (lang === 'ar' ? 'فريق العمليات والحسابات' : 'Operations & Account Team')}
            </h2>
            <p className="text-slate-500 text-xs">
              {lang === 'tr'
                ? 'Yönetim paneline sınırlı erişim sağlayacak operasyon veya hesap liderleri yetkilendirin'
                : (lang === 'ar'
                  ? 'قم بإضافة مسؤولي عمليات أو حسابات بصلاحيات محدودة للعمل على لوحة التحكم'
                  : 'Provision other operation and accounts administrators with limited visual panel boundaries')
              }
            </p>
          </div>
          <button
            onClick={() => {
              setAdminFormError(null);
              setIsAddAdminOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold text-xs flex items-center gap-2 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{lang === 'tr' ? 'Ekip Üyesi Ekle' : (lang === 'ar' ? 'إضافة عضو فريق' : 'Add Team Member')}</span>
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Master Owner administrator Card */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-5 relative overflow-hidden text-white shadow-md">
              <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl pointer-events-none"></div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-orange-500 bg-orange-500/10 uppercase tracking-widest px-2 py-0.5 rounded-full mb-3">
                    Owner / Super Admin
                  </span>
                  <h3 className="text-sm font-bold truncate">Sardar (MARAS Office)</h3>
                  <p className="text-slate-400 text-xs font-mono select-all truncate mt-1">sardar@maras.iq</p>
                </div>
                <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 text-orange-500">
                  <ShieldCheck className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* Database fetched admins list */}
            {adminsList.map((adm: any) => {
              const isAccountAdmin = adm.adminType === 'accounts' || adm.adminType === 'account';
              return (
                <div key={adm.id} className="bg-white rounded-xl border border-slate-200 p-5 relative overflow-hidden hover:shadow-md transition">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mb-3 ${
                        isAccountAdmin
                          ? 'text-teal-600 bg-teal-50'
                          : 'text-indigo-600 bg-indigo-50'
                      }`}>
                        {isAccountAdmin
                          ? (lang === 'tr' ? 'Muhasebe Ekibi' : 'Accounts Admin')
                          : (lang === 'tr' ? 'Operasyon Ekibi' : 'Operations Admin')
                        }
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 truncate">{adm.name}</h3>
                      <p className="text-slate-500 text-xs font-mono select-all truncate mt-1">{adm.email}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteAdmin(adm.id)}
                      className="p-1.5 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-400 rounded-md transition cursor-pointer border-0"
                      title="Revoke Access"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="border-t border-slate-100 mt-4 pt-3 space-y-1 text-[11px] text-slate-500">
                    {adm.createdAt && (
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>{lang === 'tr' ? 'Yetkilendirildi' : 'Authorized'}</span>
                        <span>{new Date(adm.createdAt).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>

                  {/* Accounting permissions — Super Admin manages them here in
                      Settings → Team (the ONLY place); operational screens only
                      read the saved permissions. Server re-enforces the rules. */}
                  <EmployeePermissionsEditor employeeId={adm.id} lang={lang} />
                </div>
              );
            })}

            {adminsList.length === 0 && (
              <div className="col-span-full border border-dashed border-slate-200 rounded-xl p-8 text-center bg-slate-50/50">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-xs">
                  {lang === 'tr' ? 'Ek operasyonel ekip bulunmuyor.' : 'No additional operational or finance accounts provisioned yet.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Admin Creation Dialog Backdrop */}
      {isAddAdminOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-6 bg-slate-950 text-white relative">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl pointer-events-none"></div>
              <h3 className="text-base font-black flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <span>{lang === 'tr' ? 'Yeni Ekip Üyesi Yetkilendir' : (lang === 'ar' ? 'تفويض عضو فريق جديد' : 'Authorize New Team Member')}</span>
              </h3>
              <p className="text-slate-400 text-[11px] mt-1">
                {lang === 'tr' ? 'Ekip üyesinin mail adresini ve şifresini belirleyin.' : 'Specify name, restricted login credentials, and permission boundaries.'}
              </p>
            </div>

            <form onSubmit={handleCreateAdmin} className="p-6 space-y-4">
              {adminFormError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs font-semibold select-all">
                  {adminFormError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">{lang === 'tr' ? 'Tam Adı' : 'Full Name'}</label>
                <input
                  type="text"
                  required
                  value={newAdminName}
                  onChange={(e) => setNewAdminName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Email Address</label>
                <input
                  type="email"
                  required
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="john@maras.iq"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Password Key</label>
                <PasswordInput
                  required
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  placeholder="Strong unique key"
                  inputClassName="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pe-9 text-slate-900 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  toggleClassName={passwordToggleClasses}
                  showLabel={showPasswordLabel}
                  hideLabel={hidePasswordLabel}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Confirm Password Key</label>
                <PasswordInput
                  required
                  value={newAdminConfirmPassword}
                  onChange={(e) => setNewAdminConfirmPassword(e.target.value)}
                  placeholder="Repeat the key above"
                  inputClassName="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pe-9 text-slate-900 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  toggleClassName={passwordToggleClasses}
                  showLabel={showPasswordLabel}
                  hideLabel={hidePasswordLabel}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Permission Boundary / Role</label>
                <select
                  value={newAdminType}
                  onChange={(e) => setNewAdminType(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-xs font-semibold focus:ring-1 focus:ring-indigo-500 outline-none"
                >
                  <option value="operation">Operations Administrator (No Accounts / Finance Statements access)</option>
                  <option value="accounts">Accounts Accountant (No Shipments GPS trackers / Drivers chats access)</option>
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddAdminOpen(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-800 text-xs font-extrabold cursor-pointer hover:bg-slate-50 rounded-lg transition border-0 bg-transparent"
                >
                  {lang === 'tr' ? 'Vazgeç' : (lang === 'ar' ? 'إلغاء' : 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-lg shadow-sm transition border-0 cursor-pointer"
                >
                  {lang === 'tr' ? 'Yetkilendir' : (lang === 'ar' ? 'تفعيل الحساب' : 'Authorize Member')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
