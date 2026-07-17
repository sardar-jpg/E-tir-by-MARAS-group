import { useState } from "react";
import {
  ArrowRight, Briefcase, Check, CheckCircle2, ChevronDown, Clock, DollarSign, Truck, X,
} from "lucide-react";
import type { Language } from "../../types";
import { TRUCK_TYPES } from "../../types";
import type { DriverOfferView } from "../../lib/driverAlliance";
import { MAX_QUOTE_PRICE_USD } from "../../lib/driverAlliance";

/**
 * Driver App V2 — the Offers tab, kept deliberately tiny: each offer is
 * ONE large card showing origin, destination, truck type, loading date,
 * and expiry, with exactly two possible answers — submit one USD price
 * (with a required confirmation step, because it can never be changed)
 * or reject (optional reason). No chat, no bidding, no negotiation, no
 * competitor information, no accept-without-price action, no second
 * answer. A driver with an active job cannot answer offers — the server
 * enforces it, and this screen shows a paused banner instead of answer
 * controls. All rules are enforced server-side; a stale action simply
 * comes back with a clear message.
 */
const LABELS: Record<Language, {
  title: string;
  empty: string;
  pausedBanner: string;
  loading: string;
  truck: string;
  freightNames: Record<string, string>;
  distance: string;
  expires: string;
  note: string;
  yourPrice: string;
  pricePlaceholder: string;
  notePlaceholder: string;
  reasonPlaceholder: string;
  answer: string;
  reject: string;
  confirmReject: string;
  submitPrice: string;
  confirmTitle: (p: string) => string;
  confirmWarning: string;
  confirmSend: string;
  back: string;
  sending: string;
  submitted: (p: string) => string;
  rejected: string;
  won: string;
  lost: string;
  expired: string;
  closed: string;
  newTag: string;
  usdOnly: string;
}> = {
  en: {
    title: "Offers",
    empty: "No transport offers right now. New offers from MARAS will appear here.",
    pausedBanner: "You have an active job. New offers are paused until it is finished.",
    loading: "Loading date",
    truck: "Truck type",
    freightNames: { land: "Land", sea: "Sea", air: "Air" },
    distance: "Distance",
    expires: "Offer expires",
    note: "Note from MARAS",
    yourPrice: "Your price (USD)",
    pricePlaceholder: "e.g. 3800",
    notePlaceholder: "Optional note to MARAS…",
    reasonPlaceholder: "Optional reason…",
    answer: "Answer this offer",
    reject: "Reject",
    confirmReject: "Confirm Reject",
    submitPrice: "Submit Price",
    confirmTitle: (p) => `Send ${p} USD?`,
    confirmWarning: "You can submit one price only. It cannot be changed later.",
    confirmSend: "Yes, Send Price",
    back: "Back",
    sending: "Sending…",
    submitted: (p) => `Submitted — ${p} USD. Waiting for MARAS.`,
    rejected: "You rejected this offer.",
    won: "MARAS selected your price — the shipment is assigned to you. Check your Job.",
    lost: "Another driver has been selected. Thank you for your quotation.",
    expired: "This offer has expired. Prices can no longer be submitted.",
    closed: "This offer is closed.",
    newTag: "New",
    usdOnly: "USD only",
  },
  tr: {
    title: "Teklifler",
    empty: "Şu anda taşıma teklifi yok. MARAS'tan gelen yeni teklifler burada görünecek.",
    pausedBanner: "Aktif bir seferiniz var. Yeni teklifler sefer bitene kadar durduruldu.",
    loading: "Yükleme tarihi",
    truck: "Araç tipi",
    freightNames: { land: "Karayolu", sea: "Denizyolu", air: "Havayolu" },
    distance: "Mesafe",
    expires: "Teklifin bitişi",
    note: "MARAS notu",
    yourPrice: "Fiyatınız (USD)",
    pricePlaceholder: "örn. 3800",
    notePlaceholder: "MARAS'a isteğe bağlı not…",
    reasonPlaceholder: "İsteğe bağlı neden…",
    answer: "Bu teklifi cevapla",
    reject: "Reddet",
    confirmReject: "Reddetmeyi Onayla",
    submitPrice: "Fiyatı Gönder",
    confirmTitle: (p) => `${p} USD gönderilsin mi?`,
    confirmWarning: "Yalnızca bir fiyat gönderebilirsiniz. Daha sonra değiştirilemez.",
    confirmSend: "Evet, Fiyatı Gönder",
    back: "Geri",
    sending: "Gönderiliyor…",
    submitted: (p) => `Gönderildi — ${p} USD. MARAS bekleniyor.`,
    rejected: "Bu teklifi reddettiniz.",
    won: "MARAS fiyatınızı seçti — sevkiyat size atandı. Seferinize bakın.",
    lost: "Başka bir sürücü seçildi. Fiyat teklifiniz için teşekkür ederiz.",
    expired: "Bu teklifin süresi doldu. Artık fiyat gönderilemez.",
    closed: "Bu teklif kapandı.",
    newTag: "Yeni",
    usdOnly: "Sadece USD",
  },
  ar: {
    title: "العروض",
    empty: "لا توجد عروض نقل حالياً. ستظهر هنا العروض الجديدة من MARAS.",
    pausedBanner: "لديك مهمة نشطة. العروض الجديدة متوقفة حتى انتهائها.",
    loading: "تاريخ التحميل",
    truck: "نوع الشاحنة",
    freightNames: { land: "بري", sea: "بحري", air: "جوي" },
    distance: "المسافة",
    expires: "ينتهي العرض",
    note: "ملاحظة من MARAS",
    yourPrice: "سعرك (دولار أمريكي)",
    pricePlaceholder: "مثال: 3800",
    notePlaceholder: "ملاحظة اختيارية إلى MARAS…",
    reasonPlaceholder: "سبب اختياري…",
    answer: "أجب على هذا العرض",
    reject: "رفض",
    confirmReject: "تأكيد الرفض",
    submitPrice: "إرسال السعر",
    confirmTitle: (p) => `إرسال ${p} دولار؟`,
    confirmWarning: "يمكنك إرسال سعر واحد فقط، ولا يمكن تغييره لاحقاً.",
    confirmSend: "نعم، أرسل السعر",
    back: "رجوع",
    sending: "جارٍ الإرسال…",
    submitted: (p) => `تم الإرسال — ${p} دولار. بانتظار MARAS.`,
    rejected: "رفضت هذا العرض.",
    won: "اختارت MARAS سعرك — تم تعيين الشحنة لك. راجع مهمتك.",
    lost: "تم اختيار سائق آخر. شكراً لك على تقديم سعرك.",
    expired: "انتهت مدة هذا العرض. لم يعد بالإمكان إرسال الأسعار.",
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
  /** One-active-job rule: with a job underway, answer controls are hidden. */
  hasActiveJob: boolean;
  onOpenOffer: (offerId: string) => void;
  onRespond: (offerId: string, action: "quote" | "reject", priceUsd?: number, note?: string) => Promise<boolean>;
}

export default function DriverOffersScreen({ lang, offers, hasActiveJob, onOpenOffer, onRespond }: DriverOffersScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const [openOfferId, setOpenOfferId] = useState<string | null>(null);
  // Composer phases within the open card: idle → quoting → confirming,
  // or idle → rejecting. One free-text field, reused: quote note when
  // quoting, optional reject reason when rejecting — never both.
  const [phase, setPhase] = useState<"idle" | "quoting" | "confirming" | "rejecting">("idle");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);

  const resetComposer = () => {
    setPhase("idle");
    setPrice("");
    setNote("");
  };

  const toggleCard = (offerId: string) => {
    if (openOfferId === offerId) {
      setOpenOfferId(null);
      resetComposer();
      return;
    }
    setOpenOfferId(offerId);
    resetComposer();
    onOpenOffer(offerId);
  };

  const submit = async (open: DriverOfferView, action: "quote" | "reject") => {
    if (isSending) return;
    setIsSending(true);
    const ok = await onRespond(open.id, action, action === "quote" ? Number(price) : undefined, note.trim() || undefined);
    setIsSending(false);
    if (ok) resetComposer();
  };

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <h2 className="text-2xl font-bold text-white text-start">{t.title}</h2>

      {/* One active job → offers are paused; no answer controls render. */}
      {hasActiveJob && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-slate-900 border border-amber-500/30 text-start">
          <Briefcase className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-amber-400 leading-snug">{t.pausedBanner}</p>
        </div>
      )}

      {offers.length === 0 ? (
        <div className="py-14 text-center bg-slate-900 rounded-3xl p-6 border border-slate-800">
          <p className="text-sm text-slate-400 leading-relaxed max-w-[280px] mx-auto">{t.empty}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((o) => {
            const answered = o.myResponse.status === "quoted" || o.myResponse.status === "rejected" || o.myResponse.status === "closed";
            // The server resolves an out-of-time offer's status to
            // "expired", so no client clock check is needed here.
            const canAnswer = o.status === "broadcast" && !answered && !hasActiveJob;
            const pending = o.status === "broadcast" && (o.myResponse.status === "invited" || o.myResponse.status === "viewed");
            const isOpen = openOfferId === o.id;
            const anotherDriverSelected = !o.isWinner && (o.myResponse.status === "closed" || o.status === "winner_selected");

            return (
              <div
                key={o.id}
                className={`bg-slate-900 border rounded-3xl transition-all ${
                  pending ? "border-orange-500/40" : o.isWinner ? "border-emerald-500/30" : "border-slate-800"
                }`}
              >
                {/* Card face — everything the driver needs at a glance */}
                <button
                  type="button"
                  onClick={() => toggleCard(o.id)}
                  className="w-full text-start p-4 space-y-3 cursor-pointer active:scale-[0.995] transition-transform"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5 text-base min-w-0">
                      <span className="font-bold text-slate-200 truncate">{o.pickupCity}</span>
                      <ArrowRight className="w-5 h-5 text-orange-500 shrink-0 rtl:rotate-180" />
                      <span className="font-bold text-slate-200 truncate">{o.deliveryCity}</span>
                    </span>
                    {pending && !hasActiveJob && (
                      <span className="shrink-0 bg-orange-500 text-white text-xs font-bold rounded-full px-2.5 py-0.5 light-preserve">{t.newTag}</span>
                    )}
                    {o.isWinner && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-sm text-slate-300">
                    <span className="inline-flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
                      <Truck className="w-4 h-4 text-slate-500 shrink-0" />
                      <span className="font-semibold">{truckTypeLabel(o.truckType, lang)}</span>
                    </span>
                    {o.expectedLoadingDate && (
                      <span className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 font-semibold">
                        {t.loading}: {o.expectedLoadingDate}
                      </span>
                    )}
                    {typeof o.distanceKm === "number" && (
                      <span className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 font-semibold">
                        {o.distanceKm.toLocaleString()} km
                      </span>
                    )}
                  </div>

                  {o.expiresAt && pending && (
                    <p className="text-sm font-semibold text-amber-400/90 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>{t.expires}: {new Date(o.expiresAt).toLocaleString()}</span>
                    </p>
                  )}

                  {/* Answered / decided states shown right on the card */}
                  {o.isWinner ? (
                    <p className="text-sm font-bold text-emerald-400 leading-snug">{t.won}</p>
                  ) : anotherDriverSelected ? (
                    <p className="text-sm font-semibold text-slate-400 leading-snug">{t.lost}</p>
                  ) : o.myResponse.status === "quoted" ? (
                    <p className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                      {t.submitted((o.myResponse.priceUsd ?? 0).toLocaleString())}
                    </p>
                  ) : o.myResponse.status === "rejected" ? (
                    <p className="text-sm font-semibold text-slate-500">{t.rejected}</p>
                  ) : o.status === "expired" ? (
                    <p className="text-sm font-semibold text-slate-500">{t.expired}</p>
                  ) : !canAnswer && !pending ? (
                    <p className="text-sm font-semibold text-slate-500">{t.closed}</p>
                  ) : canAnswer && !isOpen ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-orange-400">
                      <ChevronDown className="w-4 h-4 shrink-0" />
                      {t.answer}
                    </span>
                  ) : null}
                </button>

                {/* Answer area — only for an open, still-answerable card */}
                {isOpen && canAnswer && (
                  <div className="px-4 pb-4 space-y-3">
                    {o.notes && (
                      <p className="text-sm text-slate-300 text-start">
                        <span className="text-slate-500">{t.note}: </span>
                        <span className="font-semibold">{o.notes}</span>
                      </p>
                    )}
                    <p className="text-xs font-bold text-slate-500 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 inline-block">{t.usdOnly}</p>

                    {phase === "confirming" ? (
                      /* Confirmation step — one price, forever. */
                      <div className="bg-slate-950 border border-orange-500/40 rounded-2xl p-4 space-y-3 text-start">
                        <p className="text-base font-bold text-white">{t.confirmTitle(Number(price).toLocaleString())}</p>
                        <p className="text-sm text-slate-400 leading-snug">{t.confirmWarning}</p>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setPhase("quoting")}
                            disabled={isSending}
                            className="col-span-1 min-h-[56px] rounded-2xl bg-slate-900 border border-slate-700 text-slate-300 font-bold text-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                          >
                            {t.back}
                          </button>
                          <button
                            type="button"
                            onClick={() => submit(o, "quote")}
                            disabled={isSending}
                            className="col-span-2 min-h-[56px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50 light-preserve"
                          >
                            <Check className="w-5 h-5 shrink-0" />
                            <span>{isSending ? t.sending : t.confirmSend}</span>
                          </button>
                        </div>
                      </div>
                    ) : phase === "rejecting" ? (
                      <div className="bg-slate-950 border border-red-500/30 rounded-2xl p-4 space-y-3">
                        <input
                          type="text"
                          maxLength={500}
                          placeholder={t.reasonPlaceholder}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className="w-full min-h-[48px] px-3.5 bg-slate-900 border border-slate-800 focus:border-red-500/50 text-sm text-slate-200 rounded-2xl outline-none transition-colors placeholder-slate-600"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={resetComposer}
                            disabled={isSending}
                            className="col-span-1 min-h-[56px] rounded-2xl bg-slate-900 border border-slate-700 text-slate-300 font-bold text-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                          >
                            {t.back}
                          </button>
                          <button
                            type="button"
                            onClick={() => submit(o, "reject")}
                            disabled={isSending}
                            className="col-span-2 min-h-[56px] rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50 light-preserve"
                          >
                            <X className="w-5 h-5 shrink-0" />
                            <span>{isSending ? t.sending : t.confirmReject}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Price entry + the two allowed actions */
                      <div className="space-y-3">
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
                            className="flex-1 min-w-0 min-h-[52px] px-3.5 bg-slate-950 border border-slate-800 focus:border-orange-500/60 text-xl font-bold text-white rounded-2xl outline-none transition-colors placeholder-slate-600"
                          />
                        </div>
                        <input
                          type="text"
                          maxLength={500}
                          placeholder={t.notePlaceholder}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className="w-full min-h-[48px] px-3.5 bg-slate-950 border border-slate-800 focus:border-orange-500/60 text-sm text-slate-200 rounded-2xl outline-none transition-colors placeholder-slate-600"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => { setPhase("rejecting"); setNote(""); }}
                            disabled={isSending}
                            className="col-span-1 min-h-[60px] rounded-2xl bg-slate-950 border border-red-500/30 text-red-400 font-bold text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                          >
                            <X className="w-4 h-4 shrink-0" />
                            <span>{t.reject}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPhase("confirming")}
                            disabled={isSending || !price.trim() || Number(price) <= 0}
                            className="col-span-2 min-h-[60px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(249,115,22,0.35)] transition-all active:scale-95 cursor-pointer disabled:opacity-50 light-preserve"
                          >
                            <DollarSign className="w-5 h-5 shrink-0" />
                            <span>{t.submitPrice}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
