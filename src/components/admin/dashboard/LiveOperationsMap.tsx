import React, { useEffect, useMemo, useState } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MapPin, Radio, Maximize2, ArrowRight } from "lucide-react";
import type { Shipment, Driver, Language } from "../../../types";
import { apiFetch } from "../../../lib/api";

/**
 * Turkey → Iraq land-corridor coordinates (mirrors the set ClientShipmentMap
 * uses). Only cities with a known coordinate are ever plotted — a shipment
 * whose city isn't here is skipped, never given a fake pin.
 */
const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  istanbul: { lat: 41.0082, lng: 28.9784 },
  bursa: { lat: 40.1885, lng: 29.061 },
  gaziantep: { lat: 37.0662, lng: 37.3833 },
  erbil: { lat: 36.1912, lng: 44.0091 },
  baghdad: { lat: 33.3152, lng: 44.3661 },
  basra: { lat: 30.5081, lng: 47.7835 },
  zaho: { lat: 37.1436, lng: 42.6886 },
  dahuk: { lat: 36.8615, lng: 42.9926 },
  mosul: { lat: 36.3489, lng: 43.1577 },
  suleymaniye: { lat: 35.5613, lng: 45.4375 },
  kirkuk: { lat: 35.467, lng: 44.392 },
  ankara: { lat: 39.9334, lng: 32.8597 },
};

const GOOGLE_MAPS_KEY_FALLBACK =
  (process.env as any).GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

const S: Record<string, Record<Language, string>> = {
  title: { en: "Live Operations Map", tr: "Canlı Operasyon Haritası", ar: "خريطة العمليات الحية" },
  live: { en: "Live", tr: "Canlı", ar: "مباشر" },
  viewAll: { en: "View all on Map", tr: "Haritada Gör", ar: "عرض الكل على الخريطة" },
  fullscreen: { en: "Open full map", tr: "Tam ekran harita", ar: "فتح الخريطة كاملة" },
  inTransit: { en: "In Transit", tr: "Yolda", ar: "قيد النقل" },
  atBorder: { en: "At Border", tr: "Sınırda", ar: "على الحدود" },
  assigned: { en: "Assigned", tr: "Atanmış", ar: "مُعيّن" },
  pending: { en: "Pending", tr: "Bekleyen", ar: "قيد الانتظار" },
  unavailable: { en: "The live map is temporarily unavailable.", tr: "Canlı harita geçici olarak kullanılamıyor.", ar: "الخريطة الحية غير متاحة مؤقتًا." },
  noPositions: { en: "No plottable land shipments right now.", tr: "Şu an haritalanacak kara sevkiyatı yok.", ar: "لا توجد شحنات برية قابلة للعرض حاليًا." },
};
const L = (k: string, lang: Language) => S[k]?.[lang] ?? S[k]?.en ?? k;

/** Compact, card-local error boundary — a map failure shows an inline
 * message here, never the app-wide fallback and never a blank dashboard. */
class MapBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error("LiveOperationsMap render error:", err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function LegendDot({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {label}
      <span className="font-black tabular-nums text-slate-900">{count}</span>
    </span>
  );
}

const coordFor = (city: string | undefined) => CITY_COORDINATES[(city || "").toLowerCase().trim()];
const gps = (d: Driver | undefined): { lat: number; lng: number } | null =>
  d && typeof d.latitude === "number" && typeof d.longitude === "number" && d.latitude !== 0 && d.longitude !== 0
    ? { lat: d.latitude, lng: d.longitude }
    : null;

function markerColor(status: string): string {
  if (status === "In Transit") return "bg-blue-500 border-blue-300";
  if (status === "Customs Clearance") return "bg-rose-500 border-rose-300";
  if (status === "Assigned") return "bg-emerald-500 border-emerald-300";
  if (status === "New" || status === "Waiting for Driver Quotes") return "bg-amber-500 border-amber-300";
  return "bg-slate-400 border-slate-200";
}

/**
 * Live Operations Map card. Reuses the app's REAL Google Maps integration
 * (the same @vis.gl/react-google-maps stack + `/api/maps-key` + Turkey→Iraq
 * corridor coordinates that ClientShipmentMap uses) and live shipment/driver
 * data — never a static image. Each active land shipment is plotted at its
 * driver's live GPS when available, else its known destination city; a
 * shipment with no known coordinate is skipped rather than faked. Missing
 * key / render failure degrade to a clean inline empty state. "View all on
 * Map" opens the full GPS Tracking console.
 */
export default function LiveOperationsMap({
  shipments,
  drivers,
  lang,
  onViewAll,
}: {
  shipments: Shipment[];
  drivers: Driver[];
  lang: Language;
  onViewAll: () => void;
}) {
  const [mapsKey, setMapsKey] = useState<string>(GOOGLE_MAPS_KEY_FALLBACK);
  const [authFailed, setAuthFailed] = useState<boolean>(() => Boolean((window as any).googleMapsAuthFailed));

  useEffect(() => {
    const handler = () => setAuthFailed(true);
    window.addEventListener("google-maps-auth-failure", handler);
    return () => window.removeEventListener("google-maps-auth-failure", handler);
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch("/api/maps-key")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.headers.get("content-type")?.includes("application/json")) throw new Error("non-JSON");
        return res.json();
      })
      .then((data) => { if (alive && data?.key) setMapsKey(data.key); })
      .catch((err) => console.warn("Map key fetch failed:", err?.message));
    return () => { alive = false; };
  }, []);

  const driverById = useMemo(() => {
    const m = new Map<string, Driver>();
    for (const d of drivers) if (d.id) m.set(d.id, d);
    return m;
  }, [drivers]);

  // Land corridor only (same scope as the GPS Tracking tab); plot live GPS
  // when we have it, else the known destination city, else skip.
  const land = useMemo(() => shipments.filter((s) => (s.freightType || "land") === "land"), [shipments]);
  const points = useMemo(() => {
    const out: { id: string; pos: { lat: number; lng: number }; status: string; label: string }[] = [];
    for (const s of land) {
      if (s.status === "Delivered" || s.status === "Closed") continue;
      const pos = gps(driverById.get(s.assignedDriverId)) || coordFor(s.deliveryCity);
      if (!pos) continue;
      out.push({ id: s.id, pos, status: s.status, label: `${s.shipmentNumber} · ${s.deliveryCity}` });
    }
    return out;
  }, [land, driverById]);

  const count = (pred: (s: Shipment) => boolean) => land.filter(pred).length;
  const inTransit = count((s) => s.status === "In Transit");
  const atBorder = count((s) => s.status === "Customs Clearance");
  const assigned = count((s) => s.status === "Assigned");
  const pending = count((s) => s.status === "New" || s.status === "Waiting for Driver Quotes");

  const hasKey = Boolean(mapsKey) && mapsKey !== "YOUR_API_KEY" && !authFailed;

  const emptyState = (msg: string) => (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400">
      <MapPin className="h-8 w-8 text-slate-300" />
      <span className="px-6 text-center text-xs italic">{msg}</span>
    </div>
  );

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={L("title", lang)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 p-4">
        <h3 className="flex items-center gap-2 text-sm font-black tracking-tight text-slate-900">
          <MapPin className="h-4 w-4 text-orange-500" />
          {L("title", lang)}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-600">
            <Radio className="h-3 w-3" />{L("live", lang)}
          </span>
        </h3>
        <button onClick={onViewAll} title={L("fullscreen", lang)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline">
          <Maximize2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{L("viewAll", lang)}</span>
        </button>
      </div>

      <div className="relative h-[300px] w-full bg-slate-100 md:h-[340px]">
        {!hasKey ? (
          emptyState(L("unavailable", lang))
        ) : (
          <MapBoundary fallback={emptyState(L("unavailable", lang))}>
            <APIProvider apiKey={mapsKey}>
              <GoogleMap
                id="dashboard_live_ops_map"
                defaultCenter={points[0]?.pos || { lat: 36.5, lng: 41.5 }}
                defaultZoom={points.length ? 6 : 5}
                gestureHandling="cooperative"
                disableDefaultUI
                mapId="DEMO_MAP_ID"
                style={{ width: "100%", height: "100%" }}
              >
                {points.map((p) => (
                  <AdvancedMarker key={p.id} position={p.pos} title={p.label}>
                    <span className={`block h-3 w-3 rounded-full border-2 shadow ${markerColor(p.status)}`} />
                  </AdvancedMarker>
                ))}
              </GoogleMap>
            </APIProvider>
            {points.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                <span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold text-slate-500 shadow">{L("noPositions", lang)}</span>
              </div>
            )}
          </MapBoundary>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 p-3">
        <LegendDot color="bg-blue-500" label={L("inTransit", lang)} count={inTransit} />
        <LegendDot color="bg-rose-500" label={L("atBorder", lang)} count={atBorder} />
        <LegendDot color="bg-emerald-500" label={L("assigned", lang)} count={assigned} />
        <LegendDot color="bg-amber-500" label={L("pending", lang)} count={pending} />
        <button onClick={onViewAll} className="ms-auto inline-flex items-center gap-0.5 text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline">
          {L("viewAll", lang)}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </button>
      </div>
    </section>
  );
}
