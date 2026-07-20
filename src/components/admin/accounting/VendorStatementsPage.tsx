import type { Language, Vendor } from "../../../types";
import AccountStatementView from "./AccountStatementView";

const T = {
  title: { en: "Vendor Statements", tr: "Tedarikçi Ekstreleri", ar: "كشوف الموردين" },
  subtitle: { en: "Running-balance account statement per vendor — bills from cost statements, payments and payable balance by currency and period.", tr: "Tedarikçi bazında bakiyeli hesap ekstresi — maliyet kalemleri, ödemeler ve borç bakiyesi.", ar: "كشف حساب برصيد جارٍ لكل مورد — الفواتير من بيانات التكلفة والمدفوعات ورصيد الذمم حسب العملة والفترة." },
};

/** Vendor (AP) account statements page — one statement per vendor. */
export default function VendorStatementsPage({ lang, vendors, initialEntity }: { lang: Language; vendors: Vendor[]; initialEntity?: string }) {
  return (
    <AccountStatementView
      mode="vendor"
      lang={lang}
      title={T.title[lang] || T.title.en}
      subtitle={T.subtitle[lang] || T.subtitle.en}
      entities={vendors.map((v) => ({ id: v.id, name: v.companyName }))}
      endpoint="/api/vendor-accounts/statement"
      queryKey="vendor"
      initialEntity={initialEntity}
    />
  );
}
