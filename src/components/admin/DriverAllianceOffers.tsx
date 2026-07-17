import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight, CheckCircle2, Clock, Megaphone, Plus, RefreshCw, Trophy, X, XCircle,
} from "lucide-react";
import type { AllianceOffer, AllianceOfferResponse, Driver, Shipment } from "../../types";
import { TRUCK_TYPES } from "../../types";
import { apiFetch } from "../../lib/api";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import {
  OFFER_EXPIRY_HOURS_OPTIONS,
  computeBusyDriverIds,
  isValidMarReference,
  matchDriversForOffer,
  sortResponsesForReview,
  summarizeResponses,
  type OfferResponseSummary,
} from "../../lib/driverAlliance";

/** Admin list rows arrive with per-offer response counts precomputed server-side. */
type OfferListItem = AllianceOffer & { responseSummary?: OfferResponseSummary };

/**
 * Driver Alliance Phase 1 — Transport Offers panel inside the EXISTING
 * Driver Alliance admin page (no new module). Operations creates a
 * USD-only transport request, broadcasts it (the server matches
 * Available drivers by route + truck type and invites them), reviews
 * incoming quotes/rejections, and selects exactly ONE winner — which the
 * server turns into a normal assigned shipment through the existing
 * workflow. All permissions and state rules are enforced server-side;
 * this panel only mirrors them. Rendered only for Super/Operations
 * admins (AdminPanel gates it; the API rejects everyone else anyway).
 */
interface DriverAllianceOffersProps {
  adminName: string;
  onChanged?: () => void;
  /** The Orders catalog (Shipment records) — the source every quote request links to. */
  shipments: Shipment[];
  /** Driver roster, for the pre-send matched-driver preview (same pure helpers the server uses). */
  drivers: Driver[];
  /** Opens the EXISTING official Create Order (shipment) workflow — no second form exists here. */
  onCreateNewOrder?: () => void;
  /** Set by AdminPanel after a Create-Order-from-Alliance completes: auto-select that Order. */
  preselectedOrderId?: string | null;
  onPreselectedConsumed?: () => void;
}

const EMPTY_SETTINGS = {
  truckType: TRUCK_TYPES[0].id,
  expiresInHours: "24",
  notes: "",
};

const OFFER_STATUS_STYLE: Record<AllianceOffer["status"], string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  broadcast: "bg-sky-50 text-sky-700 border-sky-200",
  winner_selected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
  expired: "bg-amber-50 text-amber-700 border-amber-200",
};

const OFFER_STATUS_LABEL: Record<AllianceOffer["status"], string> = {
  draft: "Draft",
  broadcast: "Waiting for prices",
  winner_selected: "Winner selected",
  cancelled: "Cancelled",
  expired: "Expired",
};

const RESPONSE_STATUS_LABEL: Record<AllianceOfferResponse["status"], string> = {
  invited: "Waiting",
  viewed: "Viewed",
  quoted: "Quoted",
  rejected: "Rejected",
  closed: "Closed",
};

const FREIGHT_TYPE_LABEL: Record<string, string> = { land: "Land", sea: "Sea", air: "Air" };

export default function DriverAllianceOffers({ adminName, onChanged, shipments, drivers, onCreateNewOrder, preselectedOrderId = null, onPreselectedConsumed }: DriverAllianceOffersProps) {
  const [offers, setOffers] = useState<OfferListItem[]>([]);
  const [selected, setSelected] = useState<{ offer: AllianceOffer; responses: AllianceOfferResponse[] } | null>(null);
  // Order-linked creation flow: choose → pick (or create via the
  // existing Order workflow) → settings/preview → create draft.
  const [createStep, setCreateStep] = useState<null | "choose" | "pick" | "settings">(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Shipment | null>(null);
  const [settings, setSettings] = useState({ ...EMPTY_SETTINGS });
  const [isBusy, setIsBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const showBanner = (kind: "ok" | "error", text: string) => {
    setBanner({ kind, text });
    setTimeout(() => setBanner((prev) => (prev?.text === text ? null : prev)), 5000);
  };

  const loadOffers = useCallback(async () => {
    try {
      const res = await apiFetch("/api/alliance/offers");
      if (res.ok) {
        const data = await res.json();
        setOffers(data.items || []);
      }
    } catch (err) {
      console.warn("Failed to load alliance offers:", err);
    }
  }, []);

  const loadDetail = useCallback(async (offerId: string) => {
    try {
      const res = await apiFetch(`/api/alliance/offers/${offerId}`);
      if (res.ok) setSelected(await res.json());
    } catch (err) {
      console.warn("Failed to load alliance offer detail:", err);
    }
  }, []);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  const act = async (path: string, body: any, okMessage: string, offerId?: string) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const res = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, actorName: adminName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showBanner("ok", okMessage);
        await loadOffers();
        if (offerId) await loadDetail(offerId);
        onChanged?.();
      } else {
        showBanner("error", data?.error || "The action failed. Please try again.");
        if (offerId) await loadDetail(offerId);
      }
    } catch {
      showBanner("error", "Could not reach the server.");
    } finally {
      setIsBusy(false);
    }
  };

  const resetCreateFlow = () => {
    setCreateStep(null);
    setOrderSearch("");
    setSelectedOrder(null);
    setSettings({ ...EMPTY_SETTINGS });
  };

  const createOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy || !selectedOrder) return;
    setIsBusy(true);
    try {
      const res = await apiFetch("/api/alliance/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          truckType: settings.truckType,
          expiresInHours: Number(settings.expiresInHours),
          notes: settings.notes.trim() || undefined,
          currency: "USD",
          actorName: adminName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        resetCreateFlow();
        showBanner("ok", `Quote request created as a draft for ${data.referenceShipmentNumber || selectedOrder.shipmentNumber}. Broadcast it to invite matching drivers.`);
        await loadOffers();
      } else {
        showBanner("error", data?.error || "Failed to create the quote request.");
      }
    } catch {
      showBanner("error", "Could not reach the server.");
    } finally {
      setIsBusy(false);
    }
  };

  // ── Order selection: only real, MAR-numbered, unassigned, open Orders ──
  const eligibleOrders = shipments.filter(
    (s) => isValidMarReference(s.shipmentNumber) && !s.assignedDriverId && !isShipmentClosed(s.status, s.freightType)
  );
  const q = orderSearch.trim().toLowerCase();
  const filteredOrders = (q
    ? eligibleOrders.filter((s) =>
        [s.shipmentNumber, s.companyName, s.loadingCity, s.loadingCountry, s.deliveryCity, s.deliveryCountry]
          .some((v) => (v || "").toLowerCase().includes(q))
      )
    : eligibleOrders
  ).slice(0, 25);

  // Create-New-Order return path: AdminPanel opened the EXISTING Create
  // Order workflow for us and hands back the new Order's id — select it
  // and continue straight to the alliance settings step.
  useEffect(() => {
    if (!preselectedOrderId) return;
    const order = shipments.find((s) => s.id === preselectedOrderId);
    if (order) {
      setSelectedOrder(order);
      setCreateStep("settings");
      onPreselectedConsumed?.();
    }
  }, [preselectedOrderId, shipments, onPreselectedConsumed]);

  // Pre-send preview: the SAME pure matching helpers the server uses,
  // so the count shown here is exactly what broadcast will do.
  const matchedCount = selectedOrder
    ? matchDriversForOffer(
        drivers,
        { pickupCountry: selectedOrder.loadingCountry || "", deliveryCountry: selectedOrder.deliveryCountry || "", truckType: settings.truckType },
        computeBusyDriverIds(shipments)
      ).length
    : 0;

  const input = "w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none transition-all text-sm";

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-orange-500" />
            Transport Offers
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Request USD prices from matching available drivers before assigning a shipment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { loadOffers(); if (selected) loadDetail(selected.offer.id); }}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => (createStep ? resetCreateFlow() : setCreateStep("choose"))}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            New Offer
          </button>
        </div>
      </div>

      {banner && (
        <div className={`px-3 py-2 rounded-lg text-xs font-semibold border ${banner.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
          {banner.text}
        </div>
      )}

      {/* ── Order-linked creation flow ── */}
      {createStep === "choose" && (
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
          <p className="text-sm font-bold text-slate-800">Every quote request belongs to one MARAS Order (MAR reference). Choose how to start:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button type="button" onClick={() => setCreateStep("pick")} className="min-h-[56px] px-4 bg-white border border-slate-300 hover:border-slate-500 rounded-xl text-sm font-bold text-slate-800 cursor-pointer text-left">
              Link to Existing Order
              <span className="block text-xs font-medium text-slate-500 mt-0.5">Search by MAR reference, customer, origin, or destination.</span>
            </button>
            <button type="button" onClick={() => onCreateNewOrder?.()} className="min-h-[56px] px-4 bg-slate-900 hover:bg-slate-800 rounded-xl text-sm font-bold text-white cursor-pointer text-left">
              Create New Order
              <span className="block text-xs font-medium text-slate-300 mt-0.5">Opens the normal Create Order form — one MAR reference, generated once.</span>
            </button>
          </div>
        </div>
      )}

      {createStep === "pick" && (
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
          <input
            autoFocus
            className={input}
            placeholder="Search Orders — MAR reference, customer, origin, destination…"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
          />
          {filteredOrders.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No open, unassigned Orders match. Create a new Order instead.</p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {filteredOrders.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSelectedOrder(s); setCreateStep("settings"); }}
                  className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-slate-500 bg-white cursor-pointer flex items-center justify-between gap-2 flex-wrap"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-bold text-slate-900 font-mono">{s.shipmentNumber}</span>
                    <span className="text-xs text-slate-500 ms-2">{s.companyName || "—"}</span>
                    <span className="block text-xs text-slate-600 mt-0.5 truncate">
                      {s.loadingCity}, {s.loadingCountry} → {s.deliveryCity}, {s.deliveryCountry}
                      {s.loadingDate ? ` · Loading ${s.loadingDate}` : ""}
                    </span>
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200 shrink-0">{s.status}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setCreateStep("choose")} className="text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer">Back</button>
        </div>
      )}

      {createStep === "settings" && selectedOrder && (
        <form onSubmit={createOffer} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
          {/* Imported Order details — the Order is the source of truth */}
          <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs space-y-1">
            <p className="text-sm font-bold text-slate-900 font-mono">{selectedOrder.shipmentNumber}</p>
            <p className="text-slate-700">
              <span className="font-semibold">{selectedOrder.companyName || "—"}</span>
              <span className="ms-2 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Hidden from drivers</span>
            </p>
            <p className="text-slate-600">{selectedOrder.loadingCity}, {selectedOrder.loadingCountry} → {selectedOrder.deliveryCity}, {selectedOrder.deliveryCountry}</p>
            {selectedOrder.loadingAddress && <p className="text-slate-600">Loading address: {selectedOrder.loadingAddress}</p>}
            {selectedOrder.deliveryAddress && <p className="text-slate-600">Delivery address: {selectedOrder.deliveryAddress}</p>}
            <p className="text-slate-600">
              {selectedOrder.cargoDescription || "—"}
              {selectedOrder.cargoWeight > 0 ? ` · ${selectedOrder.cargoWeight.toLocaleString()} kg` : ""}
              {selectedOrder.loadingDate ? ` · Loading ${selectedOrder.loadingDate}` : ""}
            </p>
          </div>

          {/* Alliance-specific settings only */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className={input + " cursor-pointer"} value={settings.truckType} onChange={(e) => setSettings({ ...settings, truckType: e.target.value })} title="Required Truck Type">
              {TRUCK_TYPES.map((t) => <option key={t.id} value={t.id}>{t.en}</option>)}
            </select>
            <select className={input + " cursor-pointer"} value={settings.expiresInHours} onChange={(e) => setSettings({ ...settings, expiresInHours: e.target.value })} title="Offer Expiry">
              {OFFER_EXPIRY_HOURS_OPTIONS.map((h) => (
                <option key={h} value={String(h)}>Expires in {h} hours</option>
              ))}
            </select>
          </div>
          <input className={input} placeholder="Notes shown to drivers (optional)" value={settings.notes} onChange={(e) => setSettings({ ...settings, notes: e.target.value })} />

          {/* Driver preview: exactly what invited drivers will see */}
          <div className="p-3 bg-slate-900 rounded-lg text-xs text-slate-300 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Drivers will see</p>
            <p>{selectedOrder.loadingCity}, {selectedOrder.loadingCountry} → {selectedOrder.deliveryCity}, {selectedOrder.deliveryCountry}</p>
            {selectedOrder.loadingAddress && <p>Loading address: {selectedOrder.loadingAddress}</p>}
            {selectedOrder.deliveryAddress && <p>Delivery address: {selectedOrder.deliveryAddress}</p>}
            <p>
              {selectedOrder.cargoDescription || "—"}
              {selectedOrder.cargoWeight > 0 ? ` · ${selectedOrder.cargoWeight.toLocaleString()} kg` : ""}
              {selectedOrder.loadingDate ? ` · Loading ${selectedOrder.loadingDate}` : ""}
            </p>
            {settings.notes.trim() && <p>MARAS notes: {settings.notes.trim()}</p>}
            <p className="text-amber-300 font-semibold">Customer / company name is never shown to drivers.</p>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded px-2 py-1">Currency: USD only</span>
              <span className={`text-[11px] font-bold rounded px-2 py-1 border ${matchedCount > 0 ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-red-600 bg-red-50 border-red-200"}`}>
                {matchedCount} matched driver{matchedCount === 1 ? "" : "s"}
              </span>
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCreateStep("pick")} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer">Back</button>
              <button type="submit" disabled={isBusy || matchedCount === 0} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer">
                Create Draft Request
              </button>
            </div>
          </div>
          {matchedCount === 0 && (
            <p className="text-[11px] text-red-600 font-semibold">No available drivers match this route and truck type — adjust driver routes/availability first. The server also refuses to broadcast with zero matches.</p>
          )}
        </form>
      )}

      {/* Offers list */}
      {offers.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-2">No transport offers yet.</p>
      ) : (
        <div className="space-y-1.5">
          {offers.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => (selected?.offer.id === o.id ? setSelected(null) : loadDetail(o.id))}
              className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer flex items-center justify-between gap-2 flex-wrap ${
                selected?.offer.id === o.id ? "border-slate-500 bg-slate-50" : "border-slate-200 hover:border-slate-400 bg-white"
              }`}
            >
              <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 min-w-0">
                <span className="truncate">{o.pickupCity}, {o.pickupCountry}</span>
                <ArrowRight className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="truncate">{o.deliveryCity}, {o.deliveryCountry}</span>
              </span>
              <span className="flex items-center gap-2 text-[11px] shrink-0 flex-wrap">
                {(o.referenceShipmentNumber || o.winnerShipmentNumber) && (
                  <span className="font-mono font-bold text-slate-600">{o.winnerShipmentNumber || o.referenceShipmentNumber}</span>
                )}
                <span className="text-slate-500 font-medium">{TRUCK_TYPES.find((t) => t.id === o.truckType)?.en || o.truckType}</span>
                <span className="text-slate-400">{o.expectedLoadingDate}</span>
                {o.status !== "draft" && o.responseSummary && (
                  <span className="text-slate-500">
                    {o.responseSummary.invited} invited · {o.responseSummary.waiting} waiting · {o.responseSummary.quoted} quoted · {o.responseSummary.rejected} rejected
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full border font-bold ${OFFER_STATUS_STYLE[o.status]}`}>{OFFER_STATUS_LABEL[o.status]}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Offer detail */}
      {selected && (
        <div className="border border-slate-300 rounded-xl p-4 space-y-3 bg-slate-50/60">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-bold text-slate-900">
              {selected.offer.pickupCity}, {selected.offer.pickupCountry} → {selected.offer.deliveryCity}, {selected.offer.deliveryCountry}
              <span className="block text-xs font-medium text-slate-500 mt-0.5">
                {selected.offer.cargoDescription} · {FREIGHT_TYPE_LABEL[selected.offer.freightType || "land"] || "Land"} · {TRUCK_TYPES.find((t) => t.id === selected.offer.truckType)?.en || selected.offer.truckType} · Loading {selected.offer.expectedLoadingDate}
                {typeof selected.offer.distanceKm === "number" ? ` · ${selected.offer.distanceKm.toLocaleString()} km` : ""}
                {selected.offer.referenceShipmentNumber ? ` · Shipment ${selected.offer.referenceShipmentNumber}` : ""}
                {selected.offer.notes ? ` · ${selected.offer.notes}` : ""}
              </span>
              <span className="block text-xs font-medium text-slate-500 mt-0.5">
                {selected.offer.status === "expired"
                  ? `Expired ${selected.offer.expiresAt ? new Date(selected.offer.expiresAt).toLocaleString() : ""} — quotations are closed, but you can still select a winner below.`
                  : selected.offer.expiresAt
                  ? `Quotations close ${new Date(selected.offer.expiresAt).toLocaleString()}`
                  : `Expiry: ${selected.offer.expiresInHours || 24} hours after broadcast`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selected.offer.status === "draft" && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => act(`/api/alliance/offers/${selected.offer.id}/broadcast`, {}, "Offer broadcast — matching available drivers were invited.", selected.offer.id)}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
                >
                  <Megaphone className="w-3.5 h-3.5" /> Broadcast
                </button>
              )}
              {(selected.offer.status === "draft" || selected.offer.status === "broadcast" || selected.offer.status === "expired") && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => { if (confirm("Cancel this offer? Invited drivers will be notified.")) act(`/api/alliance/offers/${selected.offer.id}/cancel`, {}, "Offer cancelled.", selected.offer.id); }}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-50 text-red-600 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel Offer
                </button>
              )}
              <button type="button" onClick={() => setSelected(null)} className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {selected.offer.status === "winner_selected" && (
            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5" />
              Winner selected — shipment {selected.offer.winnerShipmentNumber || selected.offer.winnerShipmentId} was assigned through the normal shipment workflow. All other quotations were closed.
            </div>
          )}

          {/* Response counts */}
          {selected.responses.length > 0 && (() => {
            const s = summarizeResponses(selected.responses);
            return (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-bold">
                <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600">{s.invited} invited</span>
                <span className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700">{s.waiting} waiting</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">{s.quoted} quoted</span>
                <span className="px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600">{s.rejected} rejected</span>
                {s.closed > 0 && <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">{s.closed} closed</span>}
                <span className="text-slate-400 font-medium ms-1">Quotations sorted lowest price first</span>
              </div>
            );
          })()}

          {/* Invited drivers table */}
          {selected.responses.length === 0 ? (
            <p className="text-xs text-slate-400 italic">
              {selected.offer.status === "draft" ? "Not broadcast yet — no drivers invited." : "No matching available drivers were found for this offer."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <th className="py-1.5 pr-2">Driver</th>
                    <th className="py-1.5 pr-2">Status</th>
                    <th className="py-1.5 pr-2">Price (USD)</th>
                    <th className="py-1.5 pr-2">Submitted</th>
                    <th className="py-1.5 pr-2">Note</th>
                    <th className="py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortResponsesForReview(selected.responses).map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2 font-semibold text-slate-800">
                        {r.driverName}
                        {selected.offer.winnerDriverId === r.driverId && <Trophy className="w-3.5 h-3.5 text-amber-500 inline ms-1" />}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`inline-flex items-center gap-1 font-bold ${
                          r.status === "quoted" ? "text-emerald-600" : r.status === "rejected" ? "text-red-500" : "text-slate-500"
                        }`}>
                          {r.status === "quoted" ? <CheckCircle2 className="w-3 h-3" /> : r.status === "rejected" ? <XCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {RESPONSE_STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-2 font-bold text-slate-900">
                        {typeof r.priceUsd === "number" ? `$${r.priceUsd.toLocaleString()}` : "—"}
                      </td>
                      <td className="py-2 pr-2 text-slate-500">
                        {r.respondedAt ? new Date(r.respondedAt).toLocaleString() : "—"}
                      </td>
                      <td className="py-2 pr-2 text-slate-600 max-w-[220px] truncate" title={r.note || r.rejectReason || ""}>
                        {r.note || (r.rejectReason ? `Reject reason: ${r.rejectReason}` : "—")}
                      </td>
                      <td className="py-2 text-right">
                        {(selected.offer.status === "broadcast" || selected.offer.status === "expired") && r.status === "quoted" && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              if (confirm(`Select ${r.driverName} at $${r.priceUsd?.toLocaleString()} USD as the winner? This assigns the shipment immediately.`)) {
                                act(`/api/alliance/offers/${selected.offer.id}/select-winner`, { driverId: r.driverId }, `${r.driverName} selected — shipment assigned.`, selected.offer.id);
                              }
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-md cursor-pointer"
                          >
                            Select Winner
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
