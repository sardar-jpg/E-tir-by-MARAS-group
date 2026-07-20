import type { Language } from "../types";

/**
 * Accounting module page registry — the single source of truth for the
 * Accounting sidebar section and its in-module routing. Pure data (no React,
 * no icons) so it is unit-testable and shared by the sidebar, the mobile nav
 * and AdminPanel's render switch. `live: false` pages render a professional
 * "planned for a later release" placeholder while keeping the full information
 * architecture visible (matches the approved design).
 *
 * Every tab id here is also role-gated by canViewCostStatements in AdminPanel
 * (super + accounts today) exactly like the existing `costs` tab — this
 * registry only decides ORDER + LABELS + which pages are built yet, never who
 * may see them.
 */
export type L3 = { en: string; tr: string; ar: string };

export interface AccountingPage {
  /** AdminPanel activeTab id. */
  id: string;
  /** lucide icon name resolved to a component by the caller. */
  icon: string;
  label: L3;
  /** false → renders the "coming soon" roadmap placeholder. */
  live: boolean;
}

export const ACCOUNTING_PAGES: AccountingPage[] = [
  { id: "acct_dashboard", icon: "LayoutDashboard", live: true, label: { en: "Accounting Dashboard", tr: "Muhasebe Panosu", ar: "لوحة المحاسبة" } },
  { id: "costs", icon: "FileBarChart", live: true, label: { en: "Cost Statements", tr: "Maliyet Tabloları", ar: "بيانات التكلفة" } },
  { id: "acct_customer_statements", icon: "Users", live: true, label: { en: "Customer Statements", tr: "Müşteri Ekstreleri", ar: "كشوف العملاء" } },
  { id: "acct_vendor_statements", icon: "Building2", live: true, label: { en: "Vendor Statements", tr: "Tedarikçi Ekstreleri", ar: "كشوف الموردين" } },
  { id: "acct_invoices", icon: "FileText", live: false, label: { en: "Customer Invoices", tr: "Müşteri Faturaları", ar: "فواتير العملاء" } },
  { id: "acct_payments", icon: "CreditCard", live: false, label: { en: "Payments", tr: "Ödemeler", ar: "المدفوعات" } },
  { id: "acct_receivables", icon: "Scale", live: false, label: { en: "Receivables & Payables", tr: "Alacaklar ve Borçlar", ar: "الذمم المدينة والدائنة" } },
  { id: "acct_reports", icon: "PieChart", live: false, label: { en: "Financial Reports", tr: "Mali Raporlar", ar: "التقارير المالية" } },
  { id: "acct_ai", icon: "Sparkles", live: false, label: { en: "AI Financial Assistant", tr: "Yapay Zekâ Mali Asistanı", ar: "المساعد المالي الذكي" } },
];

/** All accounting tab ids (used to build the sidebar group + role filter). */
export const ACCOUNTING_TAB_IDS: string[] = ACCOUNTING_PAGES.map((p) => p.id);

/** Tab ids with a real page built (the rest show the roadmap placeholder). */
export const ACCOUNTING_LIVE_TAB_IDS: string[] = ACCOUNTING_PAGES.filter((p) => p.live).map((p) => p.id);

export const isAccountingTab = (id: string): boolean => ACCOUNTING_TAB_IDS.includes(id);
export const isLiveAccountingTab = (id: string): boolean => ACCOUNTING_LIVE_TAB_IDS.includes(id);

export const accountingPage = (id: string): AccountingPage | undefined => ACCOUNTING_PAGES.find((p) => p.id === id);
export const accountingLabel = (id: string, lang: Language): string => {
  const p = accountingPage(id);
  return p ? (p.label[lang] || p.label.en) : id;
};
