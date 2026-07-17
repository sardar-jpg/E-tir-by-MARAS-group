import { useEffect, useState } from "react";
import {
  Check, CheckCircle2, Clock, DollarSign, FileText, X,
} from "lucide-react";
import type { Language } from "../../types";
import { TRUCK_TYPES } from "../../types";
import type { DriverOfferView } from "../../lib/driverAlliance";
import { MAX_QUOTE_PRICE_USD } from "../../lib/driverAlliance";
import { HERO_CARD, INNER_CARD } from "./driverUi";
import RouteBlock from "./RouteBlock";

/**
 * Driver App V2 — the offer sections embedded inside the Job screen
 * (Offers is not a navigation tab). Grouped by what the driver must do:
 * NEW offers awaiting an answer first, then submitted quotations
 * awaiting MARAS's decision, then recently decided offers (won / lost /
 * rejected / expired / closed), all read-only once decided.
 *
 * The collapsed card shows only the pricing-relevant summary (route,
 * cargo, loading date, expiry); the driver opens Shipment Details to see
 * the simple operational fields — From, To, Cargo, Loading Date, MARAS
 * Notes, Offer Expiry (addresses and weight join this list once the
 * offer contract carries them) — before the two allowed answers appear:
 * Submit Price (USD, behind an explicit confirmation, never editable) or
 * Reject (optional reason). There is NO chat during the offer stage —
 * the shipment conversation exists only after the driver accepts an
 * assigned job. A driver with an active job sees no answer controls at
 * all (the server enforces the rule regardless). No competitor
 * information of any kind ever renders.
 */
const LABELS: Record<Language, {
  newOffers: string;
  submittedOffers: string;
  decidedOffers: string;
  empty: string;
  pausedBanner: string;
  viewDetails: string;
  hideDetails: string;
  from: string;
  to: string;
  loadingAddress: string;
  deliveryAddress: string;
  cargo: string;
  weight: string;
  truck: string;
  loading: string;
  expires: string;
  note: string;
  yourPrice: string;
  pricePlaceholder: string;
  notePlaceholder: string;
  reasonPlaceholder: string;
  reject: string;
  confirmReject: string;
  submitPrice: string;
  confirmTitle: (p: string) => string;
  confirmWarning: string;
  confirmSend: string;
  back: string;
  sending: string;
  submitted: (p: string) => string;
  waiting: string;
  rejected: string;
  won: string;
  lost: string;
  expired: string;
  closed: string;
  newTag: string;
  usdOnly: string;
}> = {
  en: {
    newOffers: "New offers",
    submittedOffers: "Waiting for MARAS decision",
    decidedOffers: "Recently decided",
    empty: "No transport offers right now. New offers from MARAS will appear here.",
    pausedBanner: "You have an active job. New offers are paused until it is finished.",
    viewDetails: "Shipment Details",
    hideDetails: "Hide details",
    from: "From",
    to: "To",
    loadingAddress: "Loading address",
    deliveryAddress: "Delivery address",
    cargo: "Cargo",
    weight: "Weight",
    truck: "Truck",
    loading: "Loading date",
    expires: "Offer expires",
    note: "MARAS notes",
    yourPrice: "Your price (USD)",
    pricePlaceholder: "e.g. 3800",
    notePlaceholder: "Optional note to MARAS…",
    reasonPlaceholder: "Optional reason…",
    reject: "Reject",
    confirmReject: "Confirm Reject",
    submitPrice: "Submit Price (USD)",
    confirmTitle: (p) => `Send ${p} USD?`,
    confirmWarning: "You can submit one price only. It cannot be changed later.",
    confirmSend: "Yes, Send Price",
    back: "Back",
    sending: "Sending…",
    submitted: (p) => `Submitted — ${p} USD`,
    waiting: "Waiting for MARAS.",
    rejected: "You rejected this offer.",
    won: "MARAS selected your price — the shipment is assigned to you.",
    lost: "Another driver has been selected. Thank you for your quotation.",
    expired: "This offer has expired. Prices can no longer be submitted.",
    closed: "This offer is closed.",
    newTag: "New",
    usdOnly: "USD only",
  },
  tr: {
    newOffers: "Yeni teklifler",
    submittedOffers: "MARAS kararı bekleniyor",
    decidedOffers: "Son kararlar",
    empty: "Şu anda taşıma teklifi yok. MARAS'tan gelen yeni teklifler burada görünecek.",
    pausedBanner: "Aktif bir seferiniz var. Yeni teklifler sefer bitene kadar durduruldu.",
    viewDetails: "Sevkiyat Detayları",
    hideDetails: "Detayları gizle",
    from: "Nereden",
    to: "Nereye",
    loadingAddress: "Yükleme adresi",
    deliveryAddress: "Teslimat adresi",
    cargo: "Yük",
    weight: "Ağırlık",
    truck: "Araç",
    loading: "Yükleme tarihi",
    expires: "Teklifin bitişi",
    note: "MARAS notları",
    yourPrice: "Fiyatınız (USD)",
    pricePlaceholder: "örn. 3800",
    notePlaceholder: "MARAS'a isteğe bağlı not…",
    reasonPlaceholder: "İsteğe bağlı neden…",
    reject: "Reddet",
    confirmReject: "Reddetmeyi Onayla",
    submitPrice: "Fiyatı Gönder (USD)",
    confirmTitle: (p) => `${p} USD gönderilsin mi?`,
    confirmWarning: "Yalnızca bir fiyat gönderebilirsiniz. Daha sonra değiştirilemez.",
    confirmSend: "Evet, Fiyatı Gönder",
    back: "Geri",
    sending: "Gönderiliyor…",
    submitted: (p) => `Gönderildi — ${p} USD`,
    waiting: "MARAS bekleniyor.",
    rejected: "Bu teklifi reddettiniz.",
    won: "MARAS fiyatınızı seçti — sevkiyat size atandı.",
    lost: "Başka bir sürücü seçildi. Fiyat teklifiniz için teşekkür ederiz.",
    expired: "Bu teklifin süresi doldu. Artık fiyat gönderilemez.",
    closed: "Bu teklif kapandı.",
    newTag: "Yeni",
    usdOnly: "Sadece USD",
  },
  ar: {
    newOffers: "عروض جديدة",
    submittedOffers: "بانتظار قرار MARAS",
    decidedOffers: "آخر القرارات",
    empty: "لا توجد عروض نقل حالياً. ستظهر هنا العروض الجديدة من MARAS.",
    pausedBanner: "لديك مهمة نشطة. العروض الجديدة متوقفة حتى انتهائها.",
    viewDetails: "تفاصيل الشحنة",
    hideDetails: "إخفاء التفاصيل",
    from: "من",
    to: "إلى",
    loadingAddress: "عنوان التحميل",
    deliveryAddress: "عنوان التسليم",
    cargo: "الحمولة",
    weight: "الوزن",
    truck: "الشاحنة",
    loading: "تاريخ التحميل",
    expires: "ينتهي العرض",
    note: "ملاحظات MARAS",
    yourPrice: "سعرك (دولار أمريكي)",
    pricePlaceholder: "مثال: 3800",
    notePlaceholder: "ملاحظة اختيارية إلى MARAS…",
    reasonPlaceholder: "سبب اختياري…",
    reject: "رفض",
    confirmReject: "تأكيد الرفض",
    submitPrice: "أرسل السعر (دولار)",
    confirmTitle: (p) => `إرسال ${p} دولار؟`,
    confirmWarning: "يمكنك إرسال سعر واحد فقط، ولا يمكن تغييره لاحقاً.",
    confirmSend: "نعم، أرسل السعر",
    back: "رجوع",
    sending: "جارٍ الإرسال…",
    submitted: (p) => `تم الإرسال — ${p} دولار`,
    waiting: "بانتظار MARAS.",
    rejected: "رفضت هذا العرض.",
    won: "اختارت MARAS سعرك — تم تعيين الشحنة لك.",
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
  /** Deep-link target (e.g. from a notification) — expanded on arrival. */
  highlightOfferId?: string | null;
  onOpenOffer: (offerId: string) => void;
  onRespond: (offerId: string, action: "quote" | "reject", priceUsd?: number, note?: string) => Promise<boolean>;
}

export default function DriverOffersScreen({
  lang,
  offers,
  hasActiveJob,
  highlightOfferId = null,
  onOpenOffer,
  onRespond,
}: DriverOffersScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const [openOfferId, setOpenOfferId] = useState<string | null>(null);
  // Composer phases inside the open card. One free-text field, reused:
  // quote note when quoting, optional reject reason when rejecting.
  const [phase, setPhase] = useState<"idle" | "confirming" | "rejecting">("idle");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Notification deep-link: expand (and mark viewed) the target offer.
  useEffect(() => {
    if (highlightOfferId && offers.some((o) => o.id === highlightOfferId)) {
      setOpenOfferId(highlightOfferId);
      setPhase("idle");
      setPrice("");
      setNote("");
      onOpenOffer(highlightOfferId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightOfferId]);

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

  const submit = async (o: DriverOfferView, action: "quote" | "reject") => {
    if (isSending) return;
    setIsSending(true);
    const ok = await onRespond(o.id, action, action === "quote" ? Number(price) : undefined, note.trim() || undefined);
    setIsSending(false);
    if (ok) resetComposer();
  };

  // ── Grouping: what must the driver act on first? ──
  const isPending = (o: DriverOfferView) =>
    o.status === "broadcast" && (o.myResponse.status === "invited" || o.myResponse.status === "viewed");
  const isSubmitted = (o: DriverOfferView) =>
    o.myResponse.status === "quoted" && !o.isWinner && o.status !== "winner_selected" && o.status !== "cancelled";
  const newOffers = offers.filter(isPending);
  const submittedOffers = offers.filter(isSubmitted);
  const decidedOffers = offers.filter((o) => !isPending(o) && !isSubmitted(o));

  if (offers.length === 0 && !hasActiveJob) {
    return (
      <div className="py-10 text-center bg-slate-900 rounded-3xl p-6 border border-slate-800/60">
        <p className="text-sm text-slate-400 leading-relaxed max-w-[280px] mx-auto">{t.empty}</p>
      </div>
    );
  }

  const renderCard = (o: DriverOfferView) => {
    const answered = o.myResponse.status === "quoted" || o.myResponse.status === "rejected" || o.myResponse.status === "closed";
    // The server resolves an out-of-time offer's status to "expired",
    // so no client clock check is needed here.
    const canAnswer = o.status === "broadcast" && !answered && !hasActiveJob;
    const pending = isPending(o);
    const isOpen = openOfferId === o.id;
    const anotherDriverSelected = !o.isWinner && (o.myResponse.status === "closed" || o.status === "winner_selected");

    return (
      <div
        key={o.id}
        className={`${
          pending && !hasActiveJob
            ? `${HERO_CARD} border-s-4 border-s-amber-400`
            : o.isWinner
              ? "bg-slate-900 border border-emerald-500/30 rounded-3xl border-s-4 border-s-emerald-500"
              : "bg-slate-900 border border-slate-800/60 rounded-3xl"
        }`}
      >
        {/* ── Collapsed summary: only what matters at a glance ── */}
        <button
          type="button"
          onClick={() => toggleCard(o.id)}
          className="w-full text-start p-4 space-y-3 cursor-pointer active:scale-[0.995] transition-transform"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-base min-w-0">
              <RouteBlock fromCity={o.pickupCity} toCity={o.deliveryCity} />
            </span>
            {pending && !hasActiveJob && (
              <span className="shrink-0 bg-amber-400 text-slate-950 text-xs font-bold rounded-full px-2.5 py-0.5 light-preserve">{t.newTag}</span>
            )}
            {o.isWinner && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          </div>

          <p className="text-sm text-slate-300 font-semibold truncate">
            {o.cargoDescription}
            {typeof o.weightKg === "number" ? ` · ${o.weightKg.toLocaleString()} kg` : ""}
          </p>

          {o.expectedLoadingDate && (
            <div className="flex items-center gap-2 flex-wrap text-sm text-slate-300">
              <span className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 font-semibold">
                {t.loading}: {o.expectedLoadingDate}
              </span>
            </div>
          )}

          {o.expiresAt && pending && (
            <p className="text-sm font-semibold text-amber-400/90 flex items-center gap-1.5">
              <Clock className="w-4 h-4 shrink-0" />
              <span>{t.expires}: {new Date(o.expiresAt).toLocaleString()}</span>
            </p>
          )}

          {/* Decided / answered states on the card face */}
          {o.isWinner ? (
            <p className="text-sm font-bold text-emerald-400 leading-snug">{t.won}</p>
          ) : anotherDriverSelected ? (
            <p className="text-sm font-semibold text-slate-400 leading-snug">{t.lost}</p>
          ) : o.myResponse.status === "quoted" ? (
            <p className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              {t.submitted((o.myResponse.priceUsd ?? 0).toLocaleString())} · {t.waiting}
            </p>
          ) : o.myResponse.status === "rejected" ? (
            <p className="text-sm font-semibold text-slate-500">{t.rejected}</p>
          ) : o.status === "expired" ? (
            <p className="text-sm font-semibold text-slate-500">{t.expired}</p>
          ) : !canAnswer && !pending ? (
            <p className="text-sm font-semibold text-slate-500">{t.closed}</p>
          ) : null}
        </button>

        {/* ── Large action: open the FULL details before any answer ── */}
        {!isOpen && (
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => toggleCard(o.id)}
              className="w-full min-h-[52px] rounded-2xl bg-slate-950 border border-slate-700 hover:border-orange-500/50 text-slate-200 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <FileText className="w-4 h-4 text-orange-500 shrink-0" />
              <span>{t.viewDetails}</span>
            </button>
          </div>
        )}

        {/* ── Full shipment details (every driver-safe field) ── */}
        {isOpen && (
          <div className="px-4 pb-4 space-y-3">
            {/* The simple operational fields, in the confirmed order.
                Loading address, delivery address, and weight are NOT in
                the offer contract yet — they render here automatically
                once the contract carries them (no placeholders, no
                invented values). */}
            <div className={`${INNER_CARD} p-4 space-y-0 divide-y divide-slate-800/50 text-start text-sm [&>p]:py-2 [&>p:first-child]:pt-0 [&>p:last-child]:pb-0`}>
              <p className="text-slate-300"><span className="text-slate-500">{t.from}:</span> <span className="font-semibold">{o.pickupCity}, {o.pickupCountry}</span></p>
              <p className="text-slate-300"><span className="text-slate-500">{t.to}:</span> <span className="font-semibold">{o.deliveryCity}, {o.deliveryCountry}</span></p>
              {o.loadingAddress && (
                <p className="text-slate-300"><span className="text-slate-500">{t.loadingAddress}:</span> <span className="font-semibold">{o.loadingAddress}</span></p>
              )}
              {o.deliveryAddress && (
                <p className="text-slate-300"><span className="text-slate-500">{t.deliveryAddress}:</span> <span className="font-semibold">{o.deliveryAddress}</span></p>
              )}
              <p className="text-slate-300"><span className="text-slate-500">{t.cargo}:</span> <span className="font-semibold">{o.cargoDescription}</span></p>
              {typeof o.weightKg === "number" && (
                <p className="text-slate-300"><span className="text-slate-500">{t.weight}:</span> <span className="font-semibold">{o.weightKg.toLocaleString()} kg</span></p>
              )}
              {o.expectedLoadingDate && (
                <p className="text-slate-300"><span className="text-slate-500">{t.loading}:</span> <span className="font-semibold">{o.expectedLoadingDate}</span></p>
              )}
              {o.notes && (
                <p className="text-slate-300"><span className="text-slate-500">{t.note}:</span> <span className="font-semibold">{o.notes}</span></p>
              )}
              {o.expiresAt && (
                <p className="text-slate-300"><span className="text-slate-500">{t.expires}:</span> <span className="font-semibold">{new Date(o.expiresAt).toLocaleString()}</span></p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-500 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">{t.usdOnly}</span>
              {/* Truck type: small reference only — matching already
                  guaranteed it fits this driver's registered truck. */}
              <span className="text-xs text-slate-500">{t.truck}: {truckTypeLabel(o.truckType, lang)}</span>
            </div>

            {/* ── Answer controls — only while still answerable ── */}
            {canAnswer && (
              phase === "confirming" ? (
                <div className="bg-slate-950 border border-orange-500/40 rounded-2xl p-4 space-y-3 text-start">
                  <p className="text-base font-bold text-white">{t.confirmTitle(Number(price).toLocaleString())}</p>
                  <p className="text-sm text-slate-400 leading-snug">{t.confirmWarning}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPhase("idle")}
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
              )
            )}

            <button
              type="button"
              onClick={() => toggleCard(o.id)}
              className="w-full min-h-[44px] rounded-2xl text-slate-500 hover:text-slate-300 font-bold text-xs transition-colors cursor-pointer"
            >
              {t.hideDetails}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {hasActiveJob && offers.length > 0 && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-slate-900 border border-amber-500/30 text-start">
          <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-amber-400 leading-snug">{t.pausedBanner}</p>
        </div>
      )}

      {newOffers.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-sm font-bold text-orange-400 text-start flex items-center gap-2">
            {t.newOffers}
            <span className="text-xs font-bold text-white bg-orange-500 rounded-full px-2 py-0.5 light-preserve">{newOffers.length}</span>
          </h3>
          {newOffers.map(renderCard)}
        </section>
      )}

      {submittedOffers.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-sm font-bold text-slate-400 text-start">{t.submittedOffers}</h3>
          {submittedOffers.map(renderCard)}
        </section>
      )}

      {decidedOffers.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-sm font-bold text-slate-400 text-start">{t.decidedOffers}</h3>
          {decidedOffers.map(renderCard)}
        </section>
      )}
    </div>
  );
}
