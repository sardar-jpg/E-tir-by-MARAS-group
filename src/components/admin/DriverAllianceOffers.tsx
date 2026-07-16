import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight, CheckCircle2, Clock, Megaphone, Plus, RefreshCw, Trophy, X, XCircle,
} from "lucide-react";
import type { AllianceOffer, AllianceOfferResponse } from "../../types";
import { TRUCK_TYPES } from "../../types";
import { apiFetch } from "../../lib/api";

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
}

const EMPTY_FORM = {
  pickupCountry: "",
  pickupCity: "",
  deliveryCountry: "",
  deliveryCity: "",
  truckType: TRUCK_TYPES[0].id,
  cargoDescription: "",
  expectedLoadingDate: "",
  notes: "",
  referenceShipmentId: "",
};

const OFFER_STATUS_STYLE: Record<AllianceOffer["status"], string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  broadcast: "bg-sky-50 text-sky-700 border-sky-200",
  winner_selected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

const OFFER_STATUS_LABEL: Record<AllianceOffer["status"], string> = {
  draft: "Draft",
  broadcast: "Waiting for prices",
  winner_selected: "Winner selected",
  cancelled: "Cancelled",
};

const RESPONSE_STATUS_LABEL: Record<AllianceOfferResponse["status"], string> = {
  invited: "Waiting",
  viewed: "Viewed",
  quoted: "Quoted",
  rejected: "Rejected",
};

export default function DriverAllianceOffers({ adminName, onChanged }: DriverAllianceOffersProps) {
  const [offers, setOffers] = useState<AllianceOffer[]>([]);
  const [selected, setSelected] = useState<{ offer: AllianceOffer; responses: AllianceOfferResponse[] } | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
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

  const createOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setIsBusy(true);
    try {
      const res = await apiFetch("/api/alliance/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          referenceShipmentId: form.referenceShipmentId.trim() || undefined,
          notes: form.notes.trim() || undefined,
          currency: "USD",
          actorName: adminName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setForm({ ...EMPTY_FORM });
        setIsFormOpen(false);
        showBanner("ok", "Offer created as a draft. Broadcast it to invite matching drivers.");
        await loadOffers();
      } else {
        showBanner("error", data?.error || "Failed to create the offer.");
      }
    } catch {
      showBanner("error", "Could not reach the server.");
    } finally {
      setIsBusy(false);
    }
  };

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
            onClick={() => setIsFormOpen((v) => !v)}
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

      {/* Create form */}
      {isFormOpen && (
        <form onSubmit={createOffer} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required className={input} placeholder="Pickup Country *" value={form.pickupCountry} onChange={(e) => setForm({ ...form, pickupCountry: e.target.value })} />
            <input required className={input} placeholder="Delivery Country *" value={form.deliveryCountry} onChange={(e) => setForm({ ...form, deliveryCountry: e.target.value })} />
            <input required className={input} placeholder="Pickup City *" value={form.pickupCity} onChange={(e) => setForm({ ...form, pickupCity: e.target.value })} />
            <input required className={input} placeholder="Delivery City *" value={form.deliveryCity} onChange={(e) => setForm({ ...form, deliveryCity: e.target.value })} />
            <select className={input + " cursor-pointer"} value={form.truckType} onChange={(e) => setForm({ ...form, truckType: e.target.value })}>
              {TRUCK_TYPES.map((t) => <option key={t.id} value={t.id}>{t.en}</option>)}
            </select>
            <input required type="date" className={input} value={form.expectedLoadingDate} onChange={(e) => setForm({ ...form, expectedLoadingDate: e.target.value })} title="Expected Loading Date" />
          </div>
          <input required className={input} placeholder="Cargo Description *" value={form.cargoDescription} onChange={(e) => setForm({ ...form, cargoDescription: e.target.value })} />
          <input className={input} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <input className={input} placeholder="Reference Shipment ID (optional — winner will be assigned to it)" value={form.referenceShipmentId} onChange={(e) => setForm({ ...form, referenceShipmentId: e.target.value })} />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded px-2 py-1">Currency: USD only</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer">Cancel</button>
              <button type="submit" disabled={isBusy} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer">Create Draft Offer</button>
            </div>
          </div>
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
              <span className="flex items-center gap-2 text-[11px] shrink-0">
                <span className="text-slate-500 font-medium">{TRUCK_TYPES.find((t) => t.id === o.truckType)?.en || o.truckType}</span>
                <span className="text-slate-400">{o.expectedLoadingDate}</span>
                {o.status === "broadcast" && <span className="text-slate-500">{o.invitedDriverIds.length} invited</span>}
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
                {selected.offer.cargoDescription} · {TRUCK_TYPES.find((t) => t.id === selected.offer.truckType)?.en || selected.offer.truckType} · Loading {selected.offer.expectedLoadingDate}
                {selected.offer.notes ? ` · ${selected.offer.notes}` : ""}
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
              {(selected.offer.status === "draft" || selected.offer.status === "broadcast") && (
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
              Winner selected — shipment {selected.offer.winnerShipmentId} was assigned through the normal shipment workflow.
            </div>
          )}

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
                  {selected.responses.map((r) => (
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
                      <td className="py-2 pr-2 text-slate-600 max-w-[220px] truncate" title={r.note || ""}>{r.note || "—"}</td>
                      <td className="py-2 text-right">
                        {selected.offer.status === "broadcast" && r.status === "quoted" && (
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
