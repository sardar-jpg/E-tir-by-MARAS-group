import { AlertTriangle, RefreshCw } from "lucide-react";
import type { Language } from "../../../types";

const S: Record<string, Record<Language, string>> = {
  title: { en: "The dashboard could not be loaded", tr: "Panel yüklenemedi", ar: "تعذّر تحميل اللوحة" },
  body: {
    en: "Something went wrong while loading the overview. Please try again.",
    tr: "Genel bakış yüklenirken bir sorun oluştu. Lütfen tekrar deneyin.",
    ar: "حدث خطأ أثناء تحميل النظرة العامة. يرجى المحاولة مرة أخرى.",
  },
  retry: { en: "Retry", tr: "Tekrar dene", ar: "إعادة المحاولة" },
};
const L = (k: string, lang: Language) => S[k]?.[lang] ?? S[k]?.en ?? k;

/** Whole-dashboard error state with a retry affordance. */
export default function DashboardErrorState({ lang, onRetry }: { lang: Language; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <h2 className="text-sm font-black text-slate-900">{L("title", lang)}</h2>
      <p className="max-w-sm text-xs font-medium text-slate-500">{L("body", lang)}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <RefreshCw className="h-3.5 w-3.5" />{L("retry", lang)}
        </button>
      )}
    </div>
  );
}
