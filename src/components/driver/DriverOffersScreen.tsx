import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, DollarSign, Truck, X } from "lucide-react";
import type { Language } from "../../types";
import { TRUCK_TYPES } from "../../types";
import type { DriverOfferView } from "../../lib/driverAlliance";
import { MAX_QUOTE_PRICE_USD } from "../../lib/driverAlliance";

/**
 * Driver Alliance Phase 1 — the driver's transport-offer screen, kept
 * deliberately tiny: see the offer, then EITHER submit one USD price
 * (with an optional note) OR reject. No chat, no bidding, no
 * negotiation, no second answer. Rendered as an overlay from Home — the
 * four-tab navigation is untouched. All rules are enforced server-side;
 * a stale action simply comes back with a clear message.
 */
const LABELS: Record<Language, {
  title: string;
  empty: string;
  back: string;
  loading: string;
  cargo: string;
  truck: string;
  note: string;
  yourPrice: string;
  pricePlaceholder: string;
  notePlaceholder: string;
  acceptToQuote: string;
  reject: string;
  submitPrice: string;
  cancel: string;
  sending: string;
  quoted: (p: string) => string;
  waitingAnswer: string;
  rejected: string;
  won: string;
  closed: string;
  newTag: string;
  usdOnly: string;
}> = {
  en: {
    title: "Transport Offers",
    empty: "No transport offers right now. New offers from MARAS will appear here.",
    back: "Back",
    loading: "Loading date",
    cargo: "Cargo",
    truck: "Truck type",
    note: "Note from MARAS",
    yourPrice: "Your price (USD)",
    pricePlaceholder: "e.g. 3800",
    notePlaceholder: "Optional note to MARAS…",
    acceptToQuote: "Accept to Quote",
    reject: "Reject",
    submitPrice: "Submit Price",
    cancel: "Cancel",
    sending: "Sending…",
    quoted: (p) => `You quoted ${p} USD. Waiting for MARAS.`,
    waitingAnswer: "Waiting for your answer",
    rejected: "You rejected this offer.",
    won: "MARAS selected your price — the shipment is assigned to you. Check your Jobs.",
    closed: "This offer is closed.",
    newTag: "New",
    usdOnly: "USD only",
  },
  tr: {
    title: "Taşıma Teklifleri",
    empty: "Şu anda taşıma teklifi yok. MARAS'tan gelen yeni teklifler burada görünecek.",
    back: "Geri",
    loading: "Yükleme tarihi",
    cargo: "Yük",
    truck: "Araç tipi",
    note: "MARAS notu",
    yourPrice: "Fiyatınız (USD)",
    pricePlaceholder: "örn. 3800",
    notePlaceholder: "MARAS'a isteğe bağlı not…",
    acceptToQuote: "Fiyat Vermek İstiyorum",
    reject: "Reddet",
    submitPrice: "Fiyatı Gönder",
    cancel: "Vazgeç",
    sending: "Gönderiliyor…",
    quoted: (p) => `${p} USD teklif verdiniz. MARAS bekleniyor.`,
    waitingAnswer: "Cevabınız bekleniyor",
    rejected: "Bu teklifi reddettiniz.",
    won: "MARAS fiyatınızı seçti — sevkiyat size atandı. Seferlerinize bakın.",
    closed: "Bu teklif kapandı.",
    newTag: "Yeni",
    usdOnly: "Sadece USD",
  },
  ar: {
    title: "عروض النقل",
    empty: "لا توجد عروض نقل حالياً. ستظهر هنا العروض الجديدة من MARAS.",
    back: "رجوع",
    loading: "تاريخ التحميل",
    cargo: "الحمولة",
    truck: "نوع الشاحنة",
    note: "ملاحظة من MARAS",
    yourPrice: "سعرك (دولار أمريكي)",
    pricePlaceholder: "مثال: 3800",
    notePlaceholder: "ملاحظة اختيارية إلى MARAS…",
    acceptToQuote: "أريد تقديم سعر",
    reject: "رفض",
    submitPrice: "إرسال السعر",
    cancel: "إلغاء",
    sending: "جارٍ الإرسال…",
    quoted: (p) => `قدمت سعر ${p} دولار. بانتظار MARAS.`,
    waitingAnswer: "بانتظار إجابتك",
    rejected: "رفضت هذا العرض.",
    won: "اختارت MARAS سعرك — تم تعيين الشحنة لك. راجع مهامك.",
    closed: "هذا العرض مغلق.",
    newTag: "جديد",
    usdOnly: "دولار أمريكي فقط",
  },
};

function truckTypeLabel(id: string, lang: Language): string {
  const t = TRUCK_TYPES.find((x) => x.id === id);
  if (!t) return id;
  return lang === "en" ? t.en : lang === "tr" ? t.tr : t.ar;
}

interface DriverOffersScreenProps {
  lang: Language;
  offers: DriverOfferView[];
  onBack: () => void;
  onOpenOffer: (offerId: string) => void;
  onRespond: (offerId: string, action: "quote" | "reject", priceUsd?: number, note?: string) => Promise<boolean>;
}

export default function DriverOffersScreen({ lang, offers, onBack, onOpenOffer, onRespond }: DriverOffersScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const [openOfferId, setOpenOfferId] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);

  const open = offers.find((o) => o.id === openOfferId) || null;

  const resetComposer = () => {
    setIsQuoting(false);
    setPrice("");
    setNote("");
  };

  const submit = async (action: "quote" | "reject") => {
    if (!open || isSending) return;
    setIsSending(true);
    const ok = await onRespond(open.id, action, action === "quote" ? Number(price) : undefined, note.trim() || undefined);
    setIsSending(false);
    if (ok) resetComposer();
  };

  // ── Detail ──
  if (open) {
    const answered = open.myResponse.status === "quoted" || open.myResponse.status === "rejected";
    const canAnswer = open.status === "broadcast" && !answered;
    return (
      <div className="space-y-4 animate-fade-in pb-4">
        <button
          type="button"
          onClick={() => { setOpenOfferId(null); resetComposer(); }}
          className="inline-flex items-center gap-2 min-h-[44px] px-3.5 text-sm font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 rounded-2xl transition-all cursor-pointer active:scale-95"
        >
          <ArrowLeft className="w-4 h-4 shrink-0 rtl:rotate-180" />
          <span>{t.back}</span>
        </button>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-4">
          {/* Route */}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 text-start">
              <p className="text-base font-bold text-slate-200 truncate">{open.pickupCity}</p>
              <p className="text-xs text-slate-500 truncate">{open.pickupCountry}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-orange-500 shrink-0 rtl:rotate-180" />
            <div className="flex-1 min-w-0 text-end">
              <p className="text-base font-bold text-slate-200 truncate">{open.deliveryCity}</p>
              <p className="text-xs text-slate-500 truncate">{open.deliveryCountry}</p>
            </div>
          </div>

          <div className="space-y-2 text-sm text-start">
            <p className="text-slate-300"><span className="text-slate-500">{t.cargo}:</span> <span className="font-semibold">{open.cargoDescription}</span></p>
            <p className="text-slate-300 flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-slate-500">{t.truck}:</span> <span className="font-semibold">{truckTypeLabel(open.truckType, lang)}</span>
            </p>
            <p className="text-slate-300"><span className="text-slate-500">{t.loading}:</span> <span className="font-semibold">{open.expectedLoadingDate}</span></p>
            {open.notes && <p className="text-slate-300"><span className="text-slate-500">{t.note}:</span> <span className="font-semibold">{open.notes}</span></p>}
            <p className="text-xs font-bold text-slate-500 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 inline-block">{t.usdOnly}</p>
          </div>
        </div>

        {/* Answer states */}
        {open.isWinner ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-start gap-3 text-start">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-emerald-300 leading-snug">{t.won}</p>
          </div>
        ) : open.myResponse.status === "quoted" ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-start gap-3 text-start">
            <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-slate-200 leading-snug">
              {t.quoted((open.myResponse.priceUsd ?? 0).toLocaleString())}
            </p>
          </div>
        ) : open.myResponse.status === "rejected" ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-semibold text-slate-400 text-start">
            {t.rejected}
          </div>
        ) : !canAnswer ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-semibold text-slate-400 text-start">
            {t.closed}
          </div>
        ) : isQuoting ? (
          <div className="bg-slate-900 border border-orange-500/40 rounded-2xl p-4 space-y-3">
            <label className="text-sm font-bold text-slate-200 block text-start">{t.yourPrice}</label>
            <div className="flex items-center gap-2">
              <span className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-orange-500 shrink-0">
                <DollarSign className="w-5 h-5" />
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={MAX_QUOTE_PRICE_USD}
                placeholder={t.pricePlaceholder}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="flex-1 min-w-0 min-h-[48px] px-3.5 bg-slate-950 border border-slate-800 focus:border-orange-500/60 text-lg font-bold text-white rounded-2xl outline-none transition-colors placeholder-slate-600"
              />
            </div>
            <input
              type="text"
              maxLength={500}
              placeholder={t.notePlaceholder}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full min-h-[48px] px-3.5 bg-slate-950 border border-slate-800 focus:border-orange-500/60 text-sm text-slate-100 rounded-2xl outline-none transition-colors placeholder-slate-600"
            />
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={resetComposer}
                disabled={isSending}
                className="col-span-1 min-h-[56px] rounded-2xl bg-slate-950 border border-slate-700 text-slate-300 font-bold text-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => submit("quote")}
                disabled={isSending || !price.trim() || Number(price) <= 0}
                className="col-span-2 min-h-[56px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50 light-preserve"
              >
                <Check className="w-5 h-5 shrink-0" />
                <span>{isSending ? t.sending : t.submitPrice}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => submit("reject")}
              disabled={isSending}
              className="col-span-1 min-h-[60px] rounded-2xl bg-slate-950 border border-red-500/30 text-red-400 font-bold text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            >
              <X className="w-4 h-4 shrink-0" />
              <span>{t.reject}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsQuoting(true)}
              disabled={isSending}
              className="col-span-2 min-h-[60px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(249,115,22,0.35)] transition-all active:scale-95 cursor-pointer disabled:opacity-50 light-preserve"
            >
              <DollarSign className="w-5 h-5 shrink-0" />
              <span>{t.acceptToQuote}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── List ──
  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white text-start">{t.title}</h2>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 text-sm text-slate-300 hover:text-white font-bold bg-slate-900 border border-slate-800 rounded-2xl cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          <span>{t.back}</span>
        </button>
      </div>

      {offers.length === 0 ? (
        <div className="py-14 text-center bg-slate-900 rounded-3xl p-6 border border-slate-800">
          <p className="text-sm text-slate-400 leading-relaxed max-w-[280px] mx-auto">{t.empty}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {offers.map((o) => {
            const pending = o.status === "broadcast" && (o.myResponse.status === "invited" || o.myResponse.status === "viewed");
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { setOpenOfferId(o.id); resetComposer(); onOpenOffer(o.id); }}
                className={`w-full text-start bg-slate-900 border rounded-3xl p-4 space-y-2 transition-all cursor-pointer active:scale-[0.99] ${
                  pending ? "border-orange-500/40" : o.isWinner ? "border-emerald-500/30" : "border-slate-800 opacity-80"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <span className="font-bold text-slate-200 truncate">{o.pickupCity}</span>
                    <ArrowRight className="w-4 h-4 text-orange-500 shrink-0 rtl:rotate-180" />
                    <span className="font-bold text-slate-200 truncate">{o.deliveryCity}</span>
                  </span>
                  {pending && (
                    <span className="shrink-0 bg-orange-500 text-white text-xs font-bold rounded-full px-2.5 py-0.5 light-preserve">{t.newTag}</span>
                  )}
                  {o.isWinner && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                </div>
                <p className="text-xs text-slate-500">
                  {truckTypeLabel(o.truckType, lang)} · {o.expectedLoadingDate}
                  {o.myResponse.status === "quoted" && typeof o.myResponse.priceUsd === "number"
                    ? ` · ${o.myResponse.priceUsd.toLocaleString()} USD`
                    : ""}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
