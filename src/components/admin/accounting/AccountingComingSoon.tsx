import {
  FileText, CreditCard, Scale, PieChart, Sparkles, CheckCircle2, Clock,
} from "lucide-react";
import type { Language } from "../../../types";
import { ACCOUNTING_PAGES, accountingPage } from "../../../lib/accountingNav";
import { PageHeader, Panel, pick } from "./AccountingUI";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText, CreditCard, Scale, PieChart, Sparkles,
};

const DETAIL: Record<string, { en: string; tr: string; ar: string }> = {
  acct_invoices: { en: "Issue and manage customer service invoices, multi-line, with profit and payment status per MAR order.", tr: "Çok satırlı müşteri hizmet faturaları; MAR siparişi başına kâr ve ödeme durumu.", ar: "إصدار وإدارة فواتير خدمات العملاء متعددة البنود مع الربح وحالة الدفع لكل طلب MAR." },
  acct_payments: { en: "Central register of customer receipts and vendor payments with allocation and reversal history.", tr: "Müşteri tahsilatları ve tedarikçi ödemelerinin merkezî kaydı; dağıtım ve iptal geçmişi.", ar: "سجل مركزي لمقبوضات العملاء ومدفوعات الموردين مع التوزيع وسجل العكس." },
  acct_receivables: { en: "Aged receivables and payables across all currencies — who owes us, who we owe, and by when.", tr: "Tüm para birimlerinde yaşlandırılmış alacak ve borçlar — kim bize, kime borçluyuz.", ar: "الذمم المدينة والدائنة المتقادمة بكل العملات — من له ومن عليه ومتى." },
  acct_reports: { en: "Profit & loss, revenue by customer, expense by category and exportable financial statements.", tr: "Kâr-zarar, müşteriye göre gelir, kategoriye göre gider ve dışa aktarılabilir mali tablolar.", ar: "الأرباح والخسائر، الإيرادات حسب العميل، المصروفات حسب الفئة وكشوف مالية قابلة للتصدير." },
  acct_ai: { en: "Daily financial summaries, anomaly detection, cash-flow forecasts and natural-language questions over your accounts.", tr: "Günlük mali özetler, anomali tespiti, nakit akışı tahmini ve hesaplarınıza doğal dilde sorular.", ar: "ملخصات مالية يومية، كشف الشذوذ، توقعات التدفق النقدي وأسئلة بلغة طبيعية على حساباتك." },
};

const T = {
  subtitle: { en: "This module is part of the Accounting roadmap and is being built next. The information architecture below is final.", tr: "Bu modül Muhasebe yol haritasının parçasıdır ve sırada. Aşağıdaki yapı nihaidir.", ar: "هذه الوحدة جزء من خارطة طريق المحاسبة وقيد الإنشاء تالياً. البنية أدناه نهائية." },
  planned: { en: "Planned for an upcoming release", tr: "Yakın bir sürümde planlandı", ar: "مخطط لإصدار قادم" },
  roadmap: { en: "Accounting Module Roadmap", tr: "Muhasebe Modülü Yol Haritası", ar: "خارطة طريق وحدة المحاسبة" },
  live: { en: "Available now", tr: "Şimdi mevcut", ar: "متاح الآن" },
  soon: { en: "Coming soon", tr: "Yakında", ar: "قريباً" },
};
const tr = (o: { en: string; tr: string; ar: string }, lang: Language) => o[lang] || o.en;

/** Placeholder for accounting pages not yet built — keeps the full IA visible. */
export default function AccountingComingSoon({ lang, tabId }: { lang: Language; tabId: string }) {
  const page = accountingPage(tabId);
  const Icon = (page && ICONS[page.icon]) || FileText;
  const detail = DETAIL[tabId];

  return (
    <div className="space-y-5">
      <PageHeader title={page ? pick(page.label, lang) : "Accounting"} subtitle={tr(T.subtitle, lang)} />

      <Panel className="overflow-hidden">
        <div className="flex flex-col items-center text-center py-8 px-4">
          <span className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 text-white flex items-center justify-center shadow-lg">
            <Icon className="w-8 h-8" />
          </span>
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[11px] font-black uppercase tracking-wide">
            <Clock className="w-3.5 h-3.5" />{tr(T.planned, lang)}
          </div>
          <h2 className="mt-4 text-[18px] font-black text-slate-900">{page ? pick(page.label, lang) : ""}</h2>
          {detail && <p className="mt-2 text-[13px] text-slate-500 max-w-md leading-relaxed">{tr(detail, lang)}</p>}
        </div>
      </Panel>

      <Panel title={tr(T.roadmap, lang)}>
        <div className="space-y-1.5">
          {ACCOUNTING_PAGES.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${p.id === tabId ? "bg-slate-900 text-white" : "bg-slate-50/60"}`}>
              {p.live ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Clock className={`w-4 h-4 shrink-0 ${p.id === tabId ? "text-amber-300" : "text-slate-300"}`} />}
              <span className={`text-[13px] font-bold flex-1 ${p.id === tabId ? "text-white" : "text-slate-700"}`}>{pick(p.label, lang)}</span>
              <span className={`text-[10px] font-black uppercase tracking-wide ${p.live ? "text-emerald-600" : p.id === tabId ? "text-amber-200" : "text-slate-400"}`}>
                {p.live ? tr(T.live, lang) : tr(T.soon, lang)}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
