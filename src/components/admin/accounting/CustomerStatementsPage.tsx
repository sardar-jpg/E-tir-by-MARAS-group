import type { Language, Client } from "../../../types";
import AccountStatementView from "./AccountStatementView";

const T = {
  title: { en: "Customer Statements", tr: "Müşteri Ekstreleri", ar: "كشوف العملاء" },
  subtitle: { en: "Running-balance account statement per customer — invoices, payments and receivable balance by currency and period.", tr: "Müşteri bazında bakiyeli hesap ekstresi — faturalar, ödemeler ve alacak bakiyesi.", ar: "كشف حساب برصيد جارٍ لكل عميل — الفواتير والمدفوعات ورصيد الذمم حسب العملة والفترة." },
};

/** Customer (AR) account statements page — one statement per customer company. */
export default function CustomerStatementsPage({ lang, clients }: { lang: Language; clients: Client[] }) {
  return (
    <AccountStatementView
      mode="customer"
      lang={lang}
      title={T.title[lang] || T.title.en}
      subtitle={T.subtitle[lang] || T.subtitle.en}
      entities={clients.map((c) => ({ id: c.id, name: c.companyName }))}
      endpoint="/api/customer-accounts/statement"
      queryKey="company"
      pdfPath={(name, currency, l) => `/api/customer-accounts/statement/pdf?company=${encodeURIComponent(name)}&currency=${currency}&lang=${l}`}
    />
  );
}
