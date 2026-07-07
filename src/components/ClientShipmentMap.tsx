import React, { useState, useEffect, useRef } from "react";
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Compass, MapPin, Plus, Minus, Truck } from "lucide-react";
import { Language, Shipment, Driver } from "../types";
import { apiFetch } from "../lib/api";

const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "istanbul":    { lat: 41.0082, lng: 28.9784 },
  "bursa":       { lat: 40.1885, lng: 29.0610 },
  "gaziantep":   { lat: 37.0662, lng: 37.3833 },
  "erbil":       { lat: 36.1912, lng: 44.0091 },
  "baghdad":     { lat: 33.3152, lng: 44.3661 },
  "basra":       { lat: 30.5081, lng: 47.7835 },
  "zaho":        { lat: 37.1436, lng: 42.6886 },
  "dahuk":       { lat: 36.8615, lng: 42.9926 },
  "mosul":       { lat: 36.3489, lng: 43.1577 },
  "suleymaniye": { lat: 35.5613, lng: 45.4375 },
  "kirkuk":      { lat: 35.4670, lng: 44.3920 },
  "ankara":      { lat: 39.9334, lng: 32.8597 },
};

const GOOGLE_MAPS_KEY_FALLBACK =
  (process.env as any).GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

// ── Inner components (must live inside APIProvider) ──────────────────────────

interface RouteDisplayProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
}

function RouteDisplay({ origin, destination }: RouteDisplayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map) return;
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode: "DRIVING",
      fields: ["path", "distanceMeters", "durationMillis", "viewport"],
    }).then(({ routes }) => {
      if (routes?.[0]) {
        const lines = routes[0].createPolylines();
        lines.forEach(p => p.setMap(map));
        polylinesRef.current = lines;
        if (routes[0].viewport) map.fitBounds(routes[0].viewport);
      }
    }).catch(err => console.warn("Route render failed:", err));

    return () => {
      polylinesRef.current.forEach(p => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [routesLib, map, origin.lat, origin.lng, destination.lat, destination.lng]);

  return null;
}

interface ZoomControlsProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
}

function ZoomControls({ origin, destination }: ZoomControlsProps) {
  const map = useMap();

  const zoomIn  = () => map && map.setZoom((map.getZoom() || 6) + 1);
  const zoomOut = () => map && map.setZoom((map.getZoom() || 6) - 1);

  const center = () => {
    if (!map || typeof google === "undefined") return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(origin);
    bounds.extend(destination);
    map.fitBounds(bounds);
  };

  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5 pointer-events-auto">
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-xl flex flex-col overflow-hidden">
        <button type="button" onClick={zoomIn} className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border-b border-slate-800 cursor-pointer">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={zoomOut} className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer">
          <Minus className="w-3.5 h-3.5" />
        </button>
      </div>
      <button type="button" onClick={center} className="w-7 h-7 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg shadow-xl flex items-center justify-center hover:bg-slate-800 transition-all cursor-pointer">
        <Compass className="w-3.5 h-3.5 text-orange-500 animate-pulse" style={{ animationDuration: "3s" }} />
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface ClientShipmentMapProps {
  shipment: Shipment;
  drivers: Driver[];
  lang: Language;
}

export default function ClientShipmentMap({ shipment, drivers, lang }: ClientShipmentMapProps) {
  const [activeMapsKey, setActiveMapsKey] = useState<string>(GOOGLE_MAPS_KEY_FALLBACK);
  const hasValidMapsKey = Boolean(activeMapsKey) && activeMapsKey !== "YOUR_API_KEY";

  const [mapsAuthError, setMapsAuthError] = useState<boolean>(() =>
    Boolean((window as any).googleMapsAuthFailed)
  );

  useEffect(() => {
    const handler = () => setMapsAuthError(true);
    window.addEventListener("google-maps-auth-failure", handler);
    return () => window.removeEventListener("google-maps-auth-failure", handler);
  }, []);

  useEffect(() => {
    apiFetch("/api/maps-key")
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get("content-type");
        if (ct?.includes("application/json")) return res.json();
        throw new Error("Non-JSON response");
      })
      .then(data => { if (data?.key) setActiveMapsKey(data.key); })
      .catch(err => console.warn("Map key fetch failed:", err.message));
  }, []);

  // BUG-13: only draw a route when both endpoints resolve to a real,
  // known coordinate — never fall back to a fixed Istanbul/Baghdad pin for
  // a shipment whose city doesn't match (e.g. a Sea/Air shipment, which
  // this form never collects a city for in the first place).
  const origin = CITY_COORDINATES[(shipment.loadingCity || "").toLowerCase().trim()];
  const dest   = CITY_COORDINATES[(shipment.deliveryCity || "").toLowerCase().trim()];
  const hasKnownRoute = Boolean(origin && dest);

  const assignedDriver = drivers.find(d => d.id === shipment.assignedDriverId);
  const truckPos: { lat: number; lng: number } | null =
    assignedDriver &&
    typeof assignedDriver.latitude === "number" &&
    typeof assignedDriver.longitude === "number" &&
    assignedDriver.latitude !== 0 &&
    assignedDriver.longitude !== 0
      ? { lat: assignedDriver.latitude, lng: assignedDriver.longitude }
      : null;

  if (mapsAuthError) {
    return (
      <div className="w-full rounded-xl border border-red-950 bg-slate-950 p-5 flex flex-col items-center justify-center text-center space-y-3 min-h-[200px] select-text">
        <div className="w-9 h-9 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 animate-bounce">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-[10px] text-slate-400 leading-relaxed max-w-[220px]">
          {lang === "ar"
            ? "فشل تحميل الخريطة. يرجى المحاولة لاحقاً."
            : lang === "tr"
            ? "Harita yüklenemedi. Lütfen tekrar deneyin."
            : "Map failed to load. Please try again later."}
        </p>
      </div>
    );
  }

  if (!hasValidMapsKey) {
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-950 flex flex-col items-center justify-center text-center space-y-2 min-h-[200px]">
        <MapPin className="w-5 h-5 text-slate-600" />
        <p className="text-[10.5px] text-slate-500 max-w-[200px] leading-relaxed px-4">
          {lang === "ar"
            ? "الخريطة غير متاحة حالياً."
            : lang === "tr"
            ? "Harita şu an kullanılamıyor."
            : "Map currently unavailable."}
        </p>
      </div>
    );
  }

  // BUG-13: be honest when we don't have a real coordinate for this
  // shipment's route (e.g. Sea/Air, which this app tracks by port/airport
  // rather than city) instead of drawing a fake Istanbul->Baghdad route.
  if (!hasKnownRoute) {
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-950 flex flex-col items-center justify-center text-center space-y-2 min-h-[200px]">
        <MapPin className="w-5 h-5 text-slate-600" />
        <p className="text-[10.5px] text-slate-500 max-w-[220px] leading-relaxed px-4">
          {lang === "ar"
            ? "معاينة الخريطة غير متاحة لهذه الشحنة."
            : lang === "tr"
            ? "Bu sevkiyat için harita önizlemesi mevcut değil."
            : "Map preview isn't available for this shipment's route."}
        </p>
      </div>
    );
  }

  // Both endpoints are guaranteed defined past the hasKnownRoute check above.
  const originCoords = origin as google.maps.LatLngLiteral;
  const destCoords = dest as google.maps.LatLngLiteral;

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950"
      style={{ height: "280px" }}
    >
      <APIProvider apiKey={activeMapsKey}>
        <Map
          id="client_shipment_map"
          defaultCenter={truckPos || originCoords}
          defaultZoom={6}
          gestureHandling="cooperative"
          disableDefaultUI={true}
          zoomControl={false}
          mapId="DEMO_MAP_ID"
          style={{ width: "100%", height: "100%" }}
        >
          <RouteDisplay origin={originCoords} destination={destCoords} />
          <ZoomControls origin={originCoords} destination={destCoords} />

          {/* Origin marker */}
          <AdvancedMarker position={originCoords} title={`Origin: ${shipment.loadingCity}`}>
            <div className="flex flex-col items-center">
              <span className="bg-emerald-600 border border-emerald-500 text-white font-bold text-[9px] leading-tight px-1.5 py-0.5 rounded shadow-md select-none whitespace-nowrap">
                {shipment.loadingCity}
              </span>
              <div style={{ width: "34px", height: "34px" }} className="bg-emerald-600/20 border border-emerald-500 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" />
              </div>
            </div>
          </AdvancedMarker>

          {/* Destination marker */}
          <AdvancedMarker position={destCoords} title={`Destination: ${shipment.deliveryCity}`}>
            <div className="flex flex-col items-center">
              <span className="bg-blue-600 border border-blue-500 text-white font-bold text-[9px] leading-tight px-1.5 py-0.5 rounded shadow-md select-none whitespace-nowrap">
                {shipment.deliveryCity}
              </span>
              <div style={{ width: "34px", height: "34px" }} className="bg-blue-600/20 border border-blue-500 rounded-full flex items-center justify-center animate-pulse">
                <div className="w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
              </div>
            </div>
          </AdvancedMarker>

          {/* Live truck marker — only when driver has GPS */}
          {truckPos && (
            <AdvancedMarker position={truckPos} title={assignedDriver?.truckNumber || "Truck"}>
              <div className="flex flex-col items-center">
                <span className="bg-orange-600 border border-orange-500 text-white font-bold font-mono text-[8px] leading-tight px-1.5 py-0.5 rounded shadow-md select-none whitespace-nowrap">
                  {assignedDriver?.truckNumber || "TRUCK"}
                </span>
                <div style={{ width: "34px", height: "34px" }} className="bg-orange-600 border border-white rounded-full flex items-center justify-center shadow-lg">
                  <Truck className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
            </AdvancedMarker>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
