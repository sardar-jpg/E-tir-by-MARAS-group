import { useState, useEffect, useRef, useMemo } from "react";
import {
  Shipment,
  Language,
  Driver,
  TRUCK_TYPES
} from "../types";
import {
  Truck,
  Navigation,
  Compass,
  Info,
  Search,
  AlertTriangle,
  X,
  Activity,
  MapPin,
  Globe,
  Filter,
  Check,
  Expand,
  Minimize,
  Maximize2,
  Minimize2,
  Plus,
  Minus
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { getGpsFreshness } from "../lib/gpsFreshness";
import { resolveTrackingStatus } from "../lib/trackingMapStatus";
import {
  resolveTrackingPosition,
  projectGeoToVector,
  type TrackingState,
  type TrackingPosition,
} from "../lib/trackingPositions";
import { clusterMarkers } from "../lib/markerClustering";
import TrackingLegend from "./admin/tracking/TrackingLegend";
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

const fetch = apiFetch;

// Retrieve Maps API key safely across development, iframe, and production runtimes
const GOOGLE_MAPS_KEY_FALLBACK =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

// In-Memory/Static Coordinates Mapping for common cities
const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "istanbul": { lat: 41.0082, lng: 28.9784 },
  "bursa": { lat: 40.1885, lng: 29.0610 },
  "gaziantep": { lat: 37.0662, lng: 37.3833 },
  "erbil": { lat: 36.1912, lng: 44.0091 },
  "baghdad": { lat: 33.3152, lng: 44.3661 },
  "basra": { lat: 30.5081, lng: 47.7835 },
  "zaho": { lat: 37.1436, lng: 42.6886 },
  "dahuk": { lat: 36.8615, lng: 42.9926 },
  "mosul": { lat: 36.3489, lng: 43.1577 },
  "suleymaniye": { lat: 35.5613, lng: 45.4375 },
  "kirkuk": { lat: 35.4670, lng: 44.3920 },
  "ankara": { lat: 39.9334, lng: 32.8597 }
};

// Vector graphical positions mapping on our beautiful 850x550 grid
const VECTOR_CITIES: Record<string, { x: number; y: number; label: string; country: string }> = {
  "istanbul": { x: 100, y: 130, label: "Istanbul", country: "Turkey" },
  "bursa": { x: 115, y: 175, label: "Bursa", country: "Turkey" },
  "ankara": { x: 230, y: 205, label: "Ankara", country: "Turkey" },
  "gaziantep": { x: 390, y: 285, label: "Gaziantep", country: "Turkey" },
  "zaho": { x: 495, y: 255, label: "Zaho", country: "Iraq" },
  "erbil": { x: 555, y: 285, label: "Erbil", country: "Iraq" },
  "kirkuk": { x: 585, y: 315, label: "Kirkuk", country: "Iraq" },
  "suleymaniye": { x: 645, y: 325, label: "Suleymaniye", country: "Iraq" },
  "baghdad": { x: 605, y: 395, label: "Baghdad", country: "Iraq" },
  "basra": { x: 725, y: 465, label: "Basra", country: "Iraq" }
};

function findVectorCity(cityName: string): { x: number; y: number } {
  const norm = cityName.toLowerCase().trim();
  for (const [key, val] of Object.entries(VECTOR_CITIES)) {
    if (norm.includes(key) || key.includes(norm)) {
      return { x: val.x, y: val.y };
    }
  }
  return { x: 300, y: 300 }; // Default center placement
}

interface RouteDisplayProps {
  shipment: Shipment;
  truckLocation: google.maps.LatLngLiteral;
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
}

function RouteDisplay({ shipment, truckLocation, origin, destination }: RouteDisplayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map) return;
    
    // Clear previous routes
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    const isMoving = shipment.status === "In Transit";

    if (isMoving) {
      // Route Part A: Traversed route from Loading City (Origin) to Truck position
      routesLib.Route.computeRoutes({
        origin,
        destination: truckLocation,
        travelMode: 'DRIVING',
        fields: ['path'],
      }).then(({ routes }) => {
        if (routes?.[0] && map) {
          const completedPolylines = routes[0].createPolylines();
          completedPolylines.forEach(p => {
            p.setOptions({
              strokeColor: "#64748b", // Slate 500 representing traveled history path
              strokeOpacity: 0.6,
              strokeWeight: 4,
            });
            p.setMap(map);
            polylinesRef.current.push(p);
          });
        }
      }).catch(err => {
        console.warn("Traversed segment path rendering failed:", err);
      });

      // Route Part B: Active/Remaining route from Truck position to Delivery City (Destination)
      routesLib.Route.computeRoutes({
        origin: truckLocation,
        destination,
        travelMode: 'DRIVING',
        fields: ['path', 'viewport'],
      }).then(({ routes }) => {
        if (routes?.[0] && map) {
          const remainingPolylines = routes[0].createPolylines();
          remainingPolylines.forEach(p => {
            p.setOptions({
              strokeColor: "#f97316", // Solid bright orange for active remaining route
              strokeOpacity: 0.95,
              strokeWeight: 6,
            });
            p.setMap(map);
            polylinesRef.current.push(p);
          });
        }
      }).catch(err => {
        console.warn("Remaining route path rendering failed:", err);
      });

    } else {
      // Not currently moving or already finished/completed
      const isDelivered = ["Arrived", "Delivered", "Closed"].includes(shipment.status);
      routesLib.Route.computeRoutes({
        origin,
        destination,
        travelMode: 'DRIVING',
        fields: ['path', 'viewport'],
      }).then(({ routes }) => {
        if (routes?.[0] && map) {
          const fullPolylines = routes[0].createPolylines();
          fullPolylines.forEach(p => {
            p.setOptions({
              strokeColor: isDelivered ? "#475569" : "#3b82f6", // Slate-600 if completed, Solid blue if pending plan
              strokeOpacity: isDelivered ? 0.6 : 0.85,
              strokeWeight: 5,
            });
            p.setMap(map);
            polylinesRef.current.push(p);
          });
        }
      }).catch(err => {
        console.warn("Direct route path rendering failed:", err);
      });
    }

    // Centering bounds beautifully to include all loaded route anchors
    if (typeof google !== "undefined" && google.maps && google.maps.LatLngBounds) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(origin);
      bounds.extend(destination);
      if (isMoving) {
        bounds.extend(truckLocation);
      }
      map.fitBounds(bounds);
    }

    return () => {
      polylinesRef.current.forEach(p => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [
    routesLib, 
    map, 
    shipment.id, 
    shipment.status, 
    origin.lat, 
    origin.lng, 
    destination.lat, 
    destination.lng, 
    truckLocation.lat, 
    truckLocation.lng
  ]);

  return null;
}

interface MapCustomControlsProps {
  selectedShipment: Shipment | null;
  lang: Language;
  shipments: Shipment[];
  getShipmentLocation: (s: Shipment) => { lat: number | null; lng: number | null };
}

function MapCustomControls({ selectedShipment, lang, shipments, getShipmentLocation }: MapCustomControlsProps) {
  const map = useMap();

  const handleZoomIn = () => {
    if (map) {
      map.setZoom((map.getZoom() || 6) + 1);
    }
  };

  const handleZoomOut = () => {
    if (map) {
      map.setZoom((map.getZoom() || 6) - 1);
    }
  };

  const handleCenterRoute = () => {
    if (!map) return;
    if (typeof google === "undefined" || !google.maps) return;

    if (selectedShipment) {
      const originName = selectedShipment.loadingCity?.toLowerCase().trim();
      const destName = selectedShipment.deliveryCity?.toLowerCase().trim();
      const startLoc = CITY_COORDINATES[originName] || CITY_COORDINATES["istanbul"];
      const endLoc = CITY_COORDINATES[destName] || CITY_COORDINATES["baghdad"];
      
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(startLoc);
      bounds.extend(endLoc);
      map.fitBounds(bounds);
    } else {
      // Fit to cover region from Istanbul to Baghdad (Turkey to Iraq corridor)
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(CITY_COORDINATES["istanbul"]);
      bounds.extend(CITY_COORDINATES["baghdad"]);
      map.fitBounds(bounds);
    }
  };

  const handleFitAllRoutes = () => {
    if (!map) return;
    if (typeof google === "undefined" || !google.maps || !google.maps.LatLngBounds) return;

    // Filter shipments that are currently active (In Transit, Loading, Loaded, Accepted, Assigned)
    const activeShipments = shipments.filter(s => 
      s.status === "In Transit" || 
      s.status === "Loading" || 
      s.status === "Loaded" || 
      s.status === "Accepted" || 
      s.status === "Assigned"
    );

    // If there are no active shipments, fall back to all shipments
    const targets = activeShipments.length > 0 ? activeShipments : shipments;

    if (targets.length === 0) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(CITY_COORDINATES["istanbul"]);
      bounds.extend(CITY_COORDINATES["baghdad"]);
      map.fitBounds(bounds);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    targets.forEach(s => {
      const originName = s.loadingCity?.toLowerCase().trim();
      const destName = s.deliveryCity?.toLowerCase().trim();
      const startLoc = CITY_COORDINATES[originName] || CITY_COORDINATES["istanbul"];
      const endLoc = CITY_COORDINATES[destName] || CITY_COORDINATES["baghdad"];
      
      bounds.extend(startLoc);
      bounds.extend(endLoc);

      const loc = getShipmentLocation(s);
      // Skip shipments with no resolvable position (Location Unavailable).
      if (loc.lat != null && loc.lng != null) {
        bounds.extend({ lat: loc.lat, lng: loc.lng });
      }
    });

    map.fitBounds(bounds, 60);
  };

  return (
    <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 pointer-events-auto">
      {/* Zoom Panel */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-xl flex flex-col overflow-hidden">
        <button
          type="button"
          onClick={handleZoomIn}
          title={lang === "tr" ? "Yakınlaştır" : lang === "ar" ? "تكبير" : "Zoom In"}
          className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border-b border-slate-800/80 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          title={lang === "tr" ? "Uzaklaştır" : lang === "ar" ? "تصغير" : "Zoom Out"}
          className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* Fit All Routes Control */}
      <button
        type="button"
        onClick={handleFitAllRoutes}
        title={
          lang === "tr" ? "Tüm Rotaları Sığdır" : lang === "ar" ? "ملاءمة جميع المسارات" : "Fit All Routes"
        }
        className="w-9 h-9 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-xl flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 hover:scale-105 active:scale-95 transition-all cursor-pointer"
      >
        <Expand className="w-4 h-4 text-emerald-500" />
      </button>

      {/* Auto-Centering Control */}
      <button
        type="button"
        onClick={handleCenterRoute}
        title={
          selectedShipment
            ? lang === "tr" ? "Rotaya Odaklan" : lang === "ar" ? "التركيز على المسار" : "Focus on Route"
            : lang === "tr" ? "Varsayılan Görünüm" : lang === "ar" ? "المنظور الافتراضي" : "Default Corridor View"
        }
        className="w-9 h-9 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-xl flex items-center justify-center text-orange-400 hover:text-orange-300 hover:bg-slate-800 hover:scale-105 active:scale-95 transition-all cursor-pointer"
      >
        <Compass className="w-4 h-4 animate-pulse text-orange-500" style={{ animationDuration: "3s" }} />
      </button>
    </div>
  );
}

const LABELS = {
  en: {
    liveMap: "Corridor Smart Tracking Radar",
    inTransitMap: "Active Transits Radar",
    subTitle: "Smart tracking of shipments currently 'In Transit' along the Turkey-Iraq highway corridor. GPS updates periodically, not every second.",
    shipmentNum: "Shipment",
    from: "From",
    to: "To",
    status: "Status",
    driver: "Driver",
    noInTransit: "No shipments are currently 'In Transit'. Update a shipment's status to 'In Transit' in the Shipment Registry to track its last known location on this radar.",
    truckPlate: "Truck Plate",
    customer: "Customer",
    cargo: "Cargo",
    activeTracking: "Active Tracing",
    viewAllTransit: "Reset View",
    searchPlaceholder: "Filter by customer, number or city...",
    currentGeoPos: "Estimated position",
    viewOnMap: "Locate on Grid",
    engineSelector: "Operational Tracking Interface",
    engineVector: "ETIR Interactive Vector Radar Grid (Smart Tracking)",
    vectorCorridorTitle: "Turkey-to-Iraq Corridor Smart Tracking Grid",
    borderCrossing: "Turkey - Iraq Border Crossing (Ibrahim Khalil)",
    truckFilterTitle: "Filter Truck Types",
    allTypes: "All Types",
    unspecifiedType: "Others / Unassigned",
    bestFitZoom: "Auto-Center Focus",
    lastUpdated: "Last Reported Shipment Status",
    gpsAcquired: "GPS Signal Acquired",
    simulatedGps: "No live GPS signal",
    trackLive: "Live GPS",
    trackReported: "Last Reported",
    trackEstimated: "Estimated Position",
    trackUnavailable: "Location Unavailable",
    estimatedNote: "Estimated from route — no GPS fix",
    noFix: "No location",
    loadedCapNotice: "Showing the first 50 loaded shipments.",
    operationalStats: "Transit Stats Overview",
    totalShipments: "Active Transits",
    totalDistance: "Estimated Route Completion",
    weatherSim: "Corridor Weather Check"
  },
  tr: {
    liveMap: "Koridor Akıllı Takip Radarı",
    inTransitMap: "Aktif Sevkıyat Radarı",
    subTitle: "Türkiye-Irak karayolu koridoru üzerinde 'Yolda' olan aktif sevkiyatların akıllı vektör takibi. GPS periyodik olarak güncellenir, saniyelik değildir.",
    shipmentNum: "Sevkiyat",
    from: "Yükleme",
    to: "Teslimat",
    status: "Durum",
    driver: "Sürücü",
    noInTransit: "Şu anda 'Yolda' olan aktif bir sevkiyat bulunmamaktadır. Son bilinen konumunu bu radarda görmek için Sevkiyat Kaydı kısmında durumunu 'Yolda' (In Transit) olarak güncelleyin.",
    truckPlate: "Plaka",
    customer: "Alıcı / Müşteri",
    cargo: "Kargo Açıklaması",
    activeTracking: "Aktif Takip",
    viewAllTransit: "Görünümü Sıfırla",
    searchPlaceholder: "Müşteri adı, no veya şehre göre filtrele...",
    currentGeoPos: "Tahmini konum",
    viewOnMap: "Izgarada Göster",
    engineSelector: "Operasyonel Takip Arayüzü",
    engineVector: "ETIR Etkileşimli Vektör Radar Izgarası (Akıllı Takip)",
    vectorCorridorTitle: "Türkiye-Irak Lojistik Koridoru Akıllı Takip Radarı",
    borderCrossing: "Türkiye - Irak Sınır Kapısı (Habur / İbrahim Halil)",
    truckFilterTitle: "Araç Kalemi Filtresi",
    allTypes: "Tüm Tipler",
    unspecifiedType: "Diğer / Tanımsız",
    bestFitZoom: "Hızlı Odaklan",
    lastUpdated: "Son Bildirilen Gönderi Durumu",
    gpsAcquired: "GPS Sinyali Alındı",
    simulatedGps: "Canlı GPS sinyali yok",
    trackLive: "Canlı GPS",
    trackReported: "Son Bildirilen",
    trackEstimated: "Tahmini Konum",
    trackUnavailable: "Konum Yok",
    estimatedNote: "Rotadan tahmin edildi — GPS yok",
    noFix: "Konum yok",
    loadedCapNotice: "İlk 50 yüklenen sevkiyat gösteriliyor.",
    operationalStats: "Operasyonel İstatistikler",
    totalShipments: "Aktif Araç",
    totalDistance: "Tahmini Rota Durumu",
    weatherSim: "Hava Durumu Bilgisi"
  },
  ar: {
    liveMap: "رادار التتبع الذكي للممر",
    inTransitMap: "رادار الشحنات النشطة",
    subTitle: "تتبع ذكي للشحنات 'قيد الانتقال' عبر مسار النقل البري الدولي بين تركيا والعراق. يتم تحديث الـ GPS بشكل دوري وليس كل ثانية.",
    shipmentNum: "شحنة",
    from: "من موقع الشحن",
    to: "إلى الوجهة",
    status: "الحالة",
    driver: "السائق",
    noInTransit: "لا توجد شحنات 'قيد الانتقال' حالياً. قم بتغيير حالة الشحنة إلى 'قيد الانتقال' في سجل الشحنات لمشاهدة آخر موقع معروف لها على الرادار.",
    truckPlate: "رقم الشاحنة",
    customer: "العميل / الشركة",
    cargo: "وصف الحمولة",
    activeTracking: "تتبع نشط",
    viewAllTransit: "إعادة ضبط",
    searchPlaceholder: "البحث بالعميل، الرقم أو المدينة...",
    currentGeoPos: "موقع تقديري",
    viewOnMap: "تحديد على الشبكة",
    engineSelector: "واجهة التتبع والعمليات",
    engineVector: "شبكة رادار رصد ومراقبة ETIR التفاعلية (تتبع ذكي)",
    vectorCorridorTitle: "شبكة التتبع الذكي التفاعلية لمسار النقل بين تركيا والعراق",
    borderCrossing: "الحدود الدولية - منفذ إبراهيم الخليل الدولي",
    truckFilterTitle: "تصنيف الشاحنات",
    allTypes: "كل الأنواع",
    unspecifiedType: "أخرى / غير محدد",
    bestFitZoom: "أوتو-فوكس للشبكة",
    lastUpdated: "آخر حالة مسجلة للشحنة",
    gpsAcquired: "إشارة الـ GPS نشطة",
    simulatedGps: "لا توجد إشارة GPS مباشرة",
    trackLive: "تتبع مباشر",
    trackReported: "آخر موقع مُبلَّغ",
    trackEstimated: "موقع تقديري",
    trackUnavailable: "الموقع غير متوفّر",
    estimatedNote: "تقديري حسب المسار — لا يوجد GPS",
    noFix: "لا يوجد موقع",
    loadedCapNotice: "يتم عرض أول 50 شحنة محمّلة.",
    operationalStats: "ملخص النقل النشط",
    totalShipments: "الشاحنات في الطريق",
    totalDistance: "مؤشر إكمال الرحلات",
    weatherSim: "حالة الطقس للممر البري"
  }
};

interface TrackingMapProps {
  shipments: Shipment[];
  lang: Language;
  drivers?: Driver[];
}

export default function TrackingMap({ shipments, lang, drivers }: TrackingMapProps) {
  const t = LABELS[lang] || LABELS.en;

  const filterTabsLabels = {
    en: { all: "All", active: "Active", inTransit: "In Transit" },
    tr: { all: "Tümü", active: "Aktif", inTransit: "Yolda" },
    ar: { all: "الكل", active: "النشط", inTransit: "قيد النقل" }
  };
  const fLabels = filterTabsLabels[lang] || filterTabsLabels.en;

  const [activeMapsKey, setActiveMapsKey] = useState<string>(GOOGLE_MAPS_KEY_FALLBACK);
  const hasValidMapsKey = Boolean(activeMapsKey) && activeMapsKey !== "YOUR_API_KEY";

  useEffect(() => {
    fetch("/api/maps-key")
      .then(async res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return res.json();
        } else {
          const text = await res.text();
          throw new Error(`Non-JSON response: ${text.slice(0, 50)}`);
        }
      })
      .then(data => {
        if (data && data.key) {
          setActiveMapsKey(data.key);
        }
      })
      .catch(err => console.warn("Could not retrieve map configuration gracefully:", err.message));
  }, []);

  const [localDrivers, setLocalDrivers] = useState<Driver[]>(drivers || []);
  const [selectedTruckTypes, setSelectedTruckTypes] = useState<string[]>([...TRUCK_TYPES.map(tk => tk.id), "unspecified"]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [mapStatusFilter, setMapStatusFilter] = useState<"all" | "active" | "in_transit">("all");
  
  // Custom Zoom and Pan for the Vector Grid
  const [viewScale, setViewScale] = useState<number>(1);
  const [viewPan, setViewPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Driver Session and Geolocation Status
  const [currentDriverId, setCurrentDriverId] = useState<string | null>(null);
  const [currentDriverName, setCurrentDriverName] = useState<string | null>(null);
  const [locationStatusMessage, setLocationStatusMessage] = useState<string | null>(null);
  // feature/admin-mobile-ui correction pass: the legend used to always
  // default open, covering a large share of a phone's map area. Closed
  // by default under the same 1024px breakpoint AdminPanel's own mobile
  // mode uses; desktop is unaffected (defaults open, same as before).
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(() => (typeof window === "undefined" ? true : window.innerWidth >= 1024));
  const [mapViewMode, setMapViewMode] = useState<'vector' | 'google_map'>('google_map');
  const [googleMapLoading, setGoogleMapLoading] = useState<boolean>(true);
  const [mapsAuthError, setMapsAuthError] = useState<boolean>(() => {
    return Boolean((window as any).googleMapsAuthFailed);
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  // feature/admin-mobile-ui: on narrow viewports the sidebar (filters +
  // shipment list) and the map can't reasonably sit side-by-side, so
  // mobile shows one at a time full-height with a small toggle — desktop
  // (lg:) ignores this and always shows both via the existing grid.
  const [mobileListOpen, setMobileListOpen] = useState<boolean>(false);
  // Operations Center redesign: on desktop the shipment panel is collapsible
  // so the map can go full-width (map-dominant). Ignored on mobile, which
  // already shows one pane at a time via mobileListOpen.
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(false);

  // On-demand ETA & Distance (details drawer). Never auto-called and never
  // persisted client-side: the result is tied to etaForId and cleared whenever
  // the selection changes, so a stale ETA never leaks onto another shipment.
  const [etaData, setEtaData] = useState<any | null>(null);
  const [etaLoading, setEtaLoading] = useState<boolean>(false);
  const [etaError, setEtaError] = useState<string | null>(null);
  const [etaForId, setEtaForId] = useState<string | null>(null);

  // feature/admin-mobile-ui correction pass: single source of truth
  // (src/lib/trackingMapStatus.ts, unit tested) for whether the UI is
  // allowed to say "Live"/"Active" about Google Maps GPS tracking right
  // now. Google Map mode with no configured key, or with an auth
  // failure, is NOT live even though the admin selected that mode.
  const trackingStatus = resolveTrackingStatus({ mapViewMode, hasValidMapsKey, mapsAuthError });
  const isGoogleMapsLive = trackingStatus === "live";

  useEffect(() => {
    const handleMapsFailure = () => {
      setMapsAuthError(true);
    };
    window.addEventListener("google-maps-auth-failure", handleMapsFailure);
    return () => {
      window.removeEventListener("google-maps-auth-failure", handleMapsFailure);
    };
  }, []);

  useEffect(() => {
    if (mapViewMode === 'google_map') {
      setGoogleMapLoading(true);
    }
  }, [mapViewMode]);

  useEffect(() => {
    if (!isFullscreen) return;
    document.body.style.overflow = "hidden";
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isFullscreen]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("etir_session");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.role === "driver" && parsed.driver) {
          setCurrentDriverId(parsed.driver.id);
          setCurrentDriverName(parsed.driver.name);
        }
      }
    } catch (e) {
      console.error("Error reading session for current driver location:", e);
    }
  }, []);

  const handleGoToMyLocation = () => {
    // Determine which driver ID to track (detected logged-in driver or fallback to first coordinator-capable driver for Admin testing)
    let targetDriverId = currentDriverId;
    if (!targetDriverId && localDrivers.length > 0) {
      const driverWithGps = localDrivers.find(d => typeof d.latitude === "number" && d.latitude !== 0);
      targetDriverId = driverWithGps ? driverWithGps.id : localDrivers[0].id;
    }

    if (!targetDriverId) {
      setLocationStatusMessage(lang === "ar" ? "لم يتم العثور على أي سائقين" : lang === "tr" ? "Aktif sürücü bulunamadı" : "No active drivers found");
      setTimeout(() => setLocationStatusMessage(null), 4000);
      return;
    }

    const driver = localDrivers.find(d => d.id === targetDriverId);
    if (!driver) {
      setLocationStatusMessage(lang === "ar" ? "تعذر العثور على ملف السائق" : lang === "tr" ? "Sürücü profili bulunamadı" : "Driver profile not found");
      setTimeout(() => setLocationStatusMessage(null), 4000);
      return;
    }

    const hasGps = typeof driver.latitude === "number" && typeof driver.longitude === "number" && driver.latitude !== 0 && driver.longitude !== 0;

    if (hasGps) {
      const latMin = 30.0;
      const latMax = 42.0;
      const lngMin = 28.0;
      const lngMax = 48.0;

      const pctX = (driver.longitude! - lngMin) / (lngMax - lngMin);
      const x = 100 + pctX * 625;

      const pctY = (driver.latitude! - latMin) / (latMax - latMin);
      const y = 465 - pctY * 335;

      // Center viewport (850x550) on coordinate
      setViewScale(1.6);
      setViewPan({
        x: (425 - x * 1.6),
        y: (275 - y * 1.6)
      });

      // Highlight corresponding shipment if exists
      const matchingShipment = shipments.find(s => s.assignedDriverId === driver.id && s.status === "In Transit");
      if (matchingShipment) {
        setSelectedShipment(matchingShipment);
      }

      setLocationStatusMessage(
        lang === "ar" 
          ? `تم تحديد موقع السائق: ${driver.name}` 
          : lang === "tr" 
            ? `Sürücü konumuna gidildi: ${driver.name}` 
            : `Centered on driver location: ${driver.name}`
      );
      setTimeout(() => setLocationStatusMessage(null), 4000);
    } else {
      // Fallback: search if we have a shipment to focus on
      const matchingShipment = shipments.find(s => s.assignedDriverId === driver.id);
      if (matchingShipment) {
        handleSelectShipment(matchingShipment);
        setLocationStatusMessage(
          lang === "ar"
            ? `تتبع تقديري للشحنة #${matchingShipment.shipmentNumber}`
            : lang === "tr"
              ? `Sevkiyat #${matchingShipment.shipmentNumber} için yaklaşık konum odaklandı`
              : `Focused on estimated position for Shipment #${matchingShipment.shipmentNumber}`
        );
        setTimeout(() => setLocationStatusMessage(null), 4000);
      } else {
        setLocationStatusMessage(
          lang === "ar"
            ? `لا توجد إحداثيات GPS مسجلة للسائق: ${driver.name}`
            : lang === "tr"
              ? `${driver.name} için aktif GPS koordinatı bulunmamaktadır`
              : `No active GPS coordinate found for driver: ${driver.name}`
        );
        setTimeout(() => setLocationStatusMessage(null), 4000);
      }
    }
  };

  useEffect(() => {
    if (drivers) {
      setLocalDrivers(drivers);
    } else {
      fetch("/api/drivers")
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setLocalDrivers(data);
          }
        })
        .catch(err => console.error("Error loading drivers for TrackingMap:", err));
    }
  }, [drivers]);

  // Perf Phase 2: O(1) driver lookups. This component re-renders on every
  // search keystroke / filter toggle and whenever driver/shipment data is
  // refetched; the map/filter passes below used to run `localDrivers.find(...)`
  // per shipment (O(shipments × drivers)) on each of those renders. A driver-by-id
  // index makes every lookup O(1) and only rebuilds when the drivers change.
  // NB: `Map` here would resolve to the @vis.gl/react-google-maps <Map>
  // component (imported above), so we use a plain Record as the O(1) index.
  const driversById = useMemo(() => {
    const idx: Record<string, Driver> = {};
    for (const d of localDrivers) idx[d.id] = d;
    return idx;
  }, [localDrivers]);

  // Dynamically filter shipments based on state.
  // Perf Phase 2: memoized so the status filter only re-runs when the
  // shipment list or the status filter change.
  const inTransitShipments = useMemo(() => shipments.filter(s => {
    if (mapStatusFilter === "in_transit") {
      return s.status === "In Transit";
    }
    if (mapStatusFilter === "active") {
      // Show operational segments (not completed/closed/new)
      return s.status !== "Closed" && s.status !== "Delivered";
    }
    return true; // "all" shows all statuses
  }), [shipments, mapStatusFilter]);

  // Filter by dynamic search query AND active truck filter selections.
  // Perf Phase 2: memoized (was recomputed on every unrelated re-render) and
  // driver lookups are now O(1) via driversById.
  const filteredTransit = useMemo(() => inTransitShipments.filter(s => {
    // 1. Truck Type Filter
    const driver = driversById[s.assignedDriverId || ""];
    const tType = driver?.truckType || "unspecified";
    if (!selectedTruckTypes.includes(tType)) {
      return false;
    }

    // 2. Search Text Query Filter
    const q = searchQuery.toLowerCase();
    return (
      s.shipmentNumber.toLowerCase().includes(q) ||
      s.companyName.toLowerCase().includes(q) ||
      s.loadingCity.toLowerCase().includes(q) ||
      s.deliveryCity.toLowerCase().includes(q) ||
      (s.assignedDriverName && s.assignedDriverName.toLowerCase().includes(q))
    );
  }), [inTransitShipments, driversById, selectedTruckTypes, searchQuery]);

  // Perf Phase 2: precompute per-truck-type counts once per render pass
  // (was O(types × shipments × drivers) via a getTruckTypeCount() called
  // inside the truck-type filter's .map on every render — now O(shipments)).
  const truckTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of inTransitShipments) {
      const driver = driversById[s.assignedDriverId || ""];
      const tType = driver?.truckType || "unspecified";
      counts[tType] = (counts[tType] || 0) + 1;
    }
    return counts;
  }, [inTransitShipments, driversById]);
  const getTruckTypeCount = (typeId: string): number => truckTypeCounts[typeId] || 0;

  /**
   * Tracking honesty (Operations Center redesign): the single source of
   * truth for every shipment's map placement and honesty state, computed by
   * the pure resolveTrackingPosition lib. No more 4-second "crawl" ticker
   * and no more silent Istanbul/Baghdad fallback — a shipment we cannot
   * place is honestly "unavailable" (no marker) rather than a fabricated one.
   * Recomputes only when the shipment or driver data changes (Date.now() is
   * re-read on each real data refetch, keeping freshness reasonably current
   * without animating fake movement).
   */
  const trackingById = useMemo(() => {
    const now = Date.now();
    const map: Record<string, TrackingPosition> = {};
    for (const s of shipments) {
      map[s.id] = resolveTrackingPosition(s, driversById[s.assignedDriverId || ""], now);
    }
    return map;
  }, [shipments, driversById]);

  const resolvePos = (s: Shipment): TrackingPosition =>
    trackingById[s.id] ?? resolveTrackingPosition(s, driversById[s.assignedDriverId || ""], Date.now());

  const getShipmentGpsState = (s: Shipment): TrackingState => resolvePos(s).state;

  // Vector/geo placement for a shipment. `available` is false ONLY for the
  // "unavailable" state (no coordinate); render code must skip those markers
  // instead of pinning them to a default location. For every other state the
  // coordinate is real (driver GPS) or a clearly-labeled city estimate, and
  // is projected onto the Vector Radar grid with the shared projection.
  const getShipmentVectorLocation = (
    s: Shipment
  ): { x: number; y: number; lat: number | null; lng: number | null; isActualGps: boolean; state: TrackingState; available: boolean } => {
    const pos = resolvePos(s);
    if (pos.lat == null || pos.lng == null) {
      return { x: 0, y: 0, lat: null, lng: null, isActualGps: false, state: pos.state, available: false };
    }
    const v = projectGeoToVector(pos.lat, pos.lng);
    return { x: v.x, y: v.y, lat: pos.lat, lng: pos.lng, isActualGps: pos.isReal, state: pos.state, available: true };
  };

  // Marker colour tokens per honesty state — one source of truth shared by
  // the Vector Radar and Google Map markers so the same state always reads
  // the same way (green = live, amber = last reported, orange = estimated).
  const stateColors = (state: TrackingState) => {
    switch (state) {
      case "live_gps":
        return { ring: "rgba(34,197,94,0.18)", stroke: "#22c55e", bg: "bg-emerald-700 border-emerald-400", text: "text-emerald-400", chip: "● GPS" };
      case "last_reported":
        return { ring: "rgba(245,158,11,0.16)", stroke: "#f59e0b", bg: "bg-amber-700 border-amber-400", text: "text-amber-400", chip: "◐ LAST" };
      case "estimated":
        return { ring: "rgba(249,115,22,0.12)", stroke: "rgba(249,115,22,0.4)", bg: "bg-slate-900 border-orange-500", text: "text-orange-400", chip: "◌ EST" };
      default:
        return { ring: "rgba(100,116,139,0.12)", stroke: "#475569", bg: "bg-slate-800 border-slate-600", text: "text-slate-500", chip: "◯" };
    }
  };

  const anyLiveGps = filteredTransit.some(s => getShipmentGpsState(s) === "live_gps");

  // Real-data status strip: honest counts of the four tracking states across
  // the currently filtered shipments. Never fabricated — derived directly
  // from resolveTrackingPosition via getShipmentGpsState.
  const trackingCounts = useMemo(() => {
    const c: Record<TrackingState, number> = { live_gps: 0, last_reported: 0, estimated: 0, unavailable: 0 };
    for (const s of filteredTransit) c[getShipmentGpsState(s)] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTransit, trackingById]);

  // Vector Radar marker clustering: group placeable markers that sit within a
  // scale-dependent radius so overlapping trucks read as one "N here" bubble
  // (unavailable shipments have no coordinate, so they are never clustered or
  // shown on the grid). Radius shrinks as the operator zooms in.
  const vectorClusters = useMemo(() => {
    const pts = filteredTransit
      .map(s => {
        const loc = getShipmentVectorLocation(s);
        return loc.available ? { x: loc.x, y: loc.y, shipment: s, state: loc.state } : null;
      })
      .filter((p): p is { x: number; y: number; shipment: Shipment; state: TrackingState } => p !== null);
    return clusterMarkers(pts, 34 / Math.max(viewScale, 0.1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTransit, trackingById, viewScale]);


  const getNearestCity = (x: number, y: number): string => {
    let nearestCityName = "Transit Route";
    let minDistance = Infinity;
    for (const [, val] of Object.entries(VECTOR_CITIES)) {
      const dist = Math.hypot(val.x - x, val.y - y);
      if (dist < minDistance) {
        minDistance = dist;
        nearestCityName = val.label;
      }
    }
    return minDistance < 35 ? nearestCityName : `${nearestCityName} Area`;
  };

  const handleShowAll = () => {
    setSelectedShipment(null);
    setEtaData(null);
    setEtaError(null);
    setEtaForId(null);
    setViewScale(1);
    setViewPan({ x: 0, y: 0 });
  };

  // On-demand only: fetch ETA & distance for the given shipment. Called solely
  // from the details drawer's button — never on selection, render, or refresh.
  const handleCalculateEta = async (s: Shipment) => {
    setEtaLoading(true);
    setEtaError(null);
    try {
      const res = await fetch(`/api/shipments/${s.id}/distance-matrix`);
      if (res.ok) {
        const data = await res.json();
        setEtaData(data);
        setEtaForId(s.id);
      } else {
        setEtaError(lang === "ar" ? "تعذّر حساب المسافة والوقت" : lang === "tr" ? "Mesafe/süre hesaplanamadı" : "Could not calculate ETA & distance");
      }
    } catch {
      setEtaError(lang === "ar" ? "تعذّر الاتصال بخدمة الحساب" : lang === "tr" ? "Hesaplama servisine ulaşılamadı" : "Could not reach the calculation service");
    } finally {
      setEtaLoading(false);
    }
  };

  const handleSelectShipment = (s: Shipment) => {
    setSelectedShipment(s);
    // Clear any prior on-demand ETA so it never carries over to a new selection.
    setEtaData(null);
    setEtaError(null);
    setEtaForId(null);
    const loc = getShipmentVectorLocation(s);
    // When the shipment has no placeable position (Location Unavailable),
    // frame the route corridor (origin/destination dots) instead of panning
    // to (0,0).
    const start = findVectorCity(s.loadingCity);
    const end = findVectorCity(s.deliveryCity);
    const cx = loc.available ? loc.x : (start.x + end.x) / 2;
    const cy = loc.available ? loc.y : (start.y + end.y) / 2;

    // Zoom in on target truck
    setViewScale(1.4);
    // Center viewport (850x550) on coordinate
    setViewPan({
      x: (425 - cx * 1.4),
      y: (275 - cy * 1.4)
    });
  };

  const handleAutoFocusRoute = (s: Shipment) => {
    const start = findVectorCity(s.loadingCity);
    const end = findVectorCity(s.deliveryCity);
    const loc = getShipmentVectorLocation(s);

    // Only include the truck position in the bounding box when it is placeable.
    const xs = loc.available ? [start.x, end.x, loc.x] : [start.x, end.x];
    const ys = loc.available ? [start.y, end.y, loc.y] : [start.y, end.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const boxWidth = Math.max(20, maxX - minX);
    const boxHeight = Math.max(20, maxY - minY);

    // Bounding box of the route to occupy up to 70% of the map viewport
    const scaleX = (850 * 0.7) / boxWidth;
    const scaleY = (550 * 0.7) / boxHeight;
    const targetScale = Math.max(1.0, Math.min(2.1, Math.min(scaleX, scaleY)));

    const centerX = minX + boxWidth / 2;
    const centerY = minY + boxHeight / 2;

    setViewScale(targetScale);
    setViewPan({
      x: 425 - centerX * targetScale,
      y: 275 - centerY * targetScale
    });

    setLocationStatusMessage(
      lang === "ar"
        ? `تم ضبط التركيز على كامل المسار للشحنة #${s.shipmentNumber}`
        : lang === "tr"
          ? `#${s.shipmentNumber} numaralı sevkiyatın tüm rotasına odaklanıldı`
          : `Auto-focused view on full route for Shipment #${s.shipmentNumber}`
    );
    setTimeout(() => setLocationStatusMessage(null), 4000);
  };

  const increaseZoom = () => {
    setViewScale(prev => Math.min(3, prev + 0.2));
  };

  const decreaseZoom = () => {
    setViewScale(prev => {
      const next = Math.max(1, prev - 0.2);
      if (next === 1) setViewPan({ x: 0, y: 0 });
      return next;
    });
  };

  return (
    <div className={isFullscreen
      ? "fixed inset-0 z-50 bg-slate-950 overflow-hidden flex flex-col gap-4 p-4"
      : "space-y-4"
    }>
      {/* feature/admin-mobile-ui correction pass: compact mobile-only
          header — icon, honest runtime-derived status text (same
          isGoogleMapsLive logic as the desktop deck below), a small
          Vector/Google Map toggle, and Fullscreen. Replaces the full
          desktop deck (hidden below via lg:flex) plus the amber
          "operational stats" paragraph drawer, which is redundant with
          the status text and was pure vertical space on a phone. */}
      <div className="lg:hidden bg-slate-900 border border-slate-800 text-white rounded-2xl px-3 py-2.5 flex items-center gap-2">
        <Compass className="w-4 h-4 text-orange-500 shrink-0 animate-spin" style={{ animationDuration: '10s' }} />
        <p className={`flex-1 min-w-0 truncate text-[11px] font-bold flex items-center gap-1.5 ${mapViewMode === 'vector' || isGoogleMapsLive ? 'text-orange-400' : 'text-slate-400'}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${mapViewMode === 'vector' || isGoogleMapsLive ? 'bg-emerald-500 animate-ping' : 'bg-slate-600'}`}></span>
          <span className="truncate">
            {mapViewMode === 'vector'
              ? (lang === 'tr' ? "Vektör Radar" : lang === 'ar' ? "رادار متجه" : "Vector Radar")
              : isGoogleMapsLive
                ? (lang === 'tr' ? "Canlı Google Harita" : lang === 'ar' ? "غوغل ماب مباشر" : "Live Google Map")
                : !hasValidMapsKey
                  ? (lang === 'tr' ? "Harita hizmeti yapılandırılmamış" : lang === 'ar' ? "خدمة الخريطة غير مهيأة" : "Map service not configured")
                  : (lang === 'tr' ? "Demo / Manuel Takip" : lang === 'ar' ? "وضع تجريبي / يدوي" : "Demo / Manual Mode")}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setMapViewMode(mapViewMode === 'vector' ? 'google_map' : 'vector')}
          className="shrink-0 w-8 h-8 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-lg text-slate-300 cursor-pointer"
          title={mapViewMode === 'vector' ? 'Google Map' : 'Vector Radar'}
        >
          {mapViewMode === 'vector' ? '📍' : '🗺️'}
        </button>
        <button
          type="button"
          onClick={() => setIsFullscreen(f => !f)}
          className="shrink-0 w-8 h-8 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-lg text-slate-300 cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ⚠️ HIGH-DENSITY RADAR OVERVIEW DECK — desktop only, see the
          compact mobile replacement immediately above. */}
      <div className="hidden lg:flex bg-slate-900 border border-slate-800 text-white p-4 rounded-2xl shadow-md flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-orange-500/10 text-orange-500 rounded-xl border border-orange-500/20 shrink-0">
            <Compass className="w-5 h-5 animate-spin" style={{ animationDuration: '10s' }} />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-100">{t.engineSelector}</h3>
            {/* feature/admin-mobile-ui correction pass: this used to say
                "Live Google Maps GIS Tracking Active" any time google_map
                mode was selected, even with no configured key or an auth
                failure — directly contradicting the "Key Required"/error
                fallback panel shown in the same view. Wording is now
                derived from isGoogleMapsLive (mapViewMode === 'google_map'
                && hasValidMapsKey && !mapsAuthError), the single runtime
                source of truth for whether this is actually connected. */}
            <p className={`text-[11px] font-medium flex items-center gap-1.5 mt-0.5 ${mapViewMode === 'vector' || isGoogleMapsLive ? 'text-orange-400' : 'text-slate-400'}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${mapViewMode === 'vector' || isGoogleMapsLive ? 'bg-emerald-500 animate-ping' : 'bg-slate-600'}`}></span>
              {mapViewMode === 'vector'
                ? t.engineVector
                : isGoogleMapsLive
                  ? (lang === 'tr' ? "Canlı Google Harita Modu Aktif" : lang === 'ar' ? "تتبع غوغل ماب المباشر نشط" : "Live Google Maps GIS Tracking Active")
                  : !hasValidMapsKey
                    ? (lang === 'tr' ? "Harita hizmeti yapılandırılmamış" : lang === 'ar' ? "خدمة الخريطة غير مهيأة" : "Map service not configured")
                    : (lang === 'tr' ? "Demo / Manuel Takip Modu" : lang === 'ar' ? "وضع التتبع التجريبي / اليدوي" : "Demo / Manual Tracking Mode")}
            </p>
          </div>
        </div>

        {/* Telemetry Indicator Tags */}
        <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto">
          {/* Segmented control for toggling between Vector and Google Map views */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMapViewMode('vector')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border-0 ${
                mapViewMode === 'vector'
                  ? 'bg-orange-600 text-white shadow-xs font-black'
                  : 'text-slate-400 hover:text-slate-200 bg-transparent'
              }`}
            >
              🗺️ {lang === 'tr' ? "Vektör Radar" : lang === 'ar' ? "رادار متجه" : "Vector Radar"}
            </button>
            <button
              type="button"
              onClick={() => setMapViewMode('google_map')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border-0 ${
                mapViewMode === 'google_map'
                  ? 'bg-orange-600 text-white shadow-xs font-black'
                  : 'text-slate-400 hover:text-slate-200 bg-transparent'
              }`}
            >
              📍 {lang === 'tr' ? "Google Harita" : lang === 'ar' ? "خرائط غوغل" : "Google Map"}
            </button>
          </div>

          <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-[10px] font-mono text-slate-400 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span>{t.lastUpdated}</span>
          </div>

          <button
            type="button"
            onClick={() => setIsFullscreen(f => !f)}
            title={isFullscreen
              ? (lang === "tr" ? "Tam Ekrandan Çık" : lang === "ar" ? "الخروج من ملء الشاشة" : "Exit Fullscreen")
              : (lang === "tr" ? "Tam Ekran" : lang === "ar" ? "ملء الشاشة" : "Fullscreen")}
            className="w-8 h-8 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer shrink-0"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Operations Center status strip — desktop only. Replaces the tall
          amber "action drawer" (pure vertical space that restated the header)
          with a compact, real-data strip: honest live counts of the four
          tracking states, plus Reset View and a panel collapse toggle. */}
      <div className="hidden lg:flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-2 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { key: "live_gps" as const, label: t.trackLive, dot: "bg-emerald-500", text: "text-emerald-700" },
            { key: "last_reported" as const, label: t.trackReported, dot: "bg-amber-500", text: "text-amber-700" },
            { key: "estimated" as const, label: t.trackEstimated, dot: "bg-orange-500", text: "text-orange-700" },
            { key: "unavailable" as const, label: t.trackUnavailable, dot: "bg-slate-400", text: "text-slate-500" },
          ]).map(item => (
            <span
              key={item.key}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold"
              title={item.label}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${item.dot}`}></span>
              <span className="text-slate-500 uppercase tracking-wide">{item.label}</span>
              <span className={`tabular-nums font-black ${item.text}`}>{trackingCounts[item.key]}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleShowAll}
            className="inline-flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-xl font-black tracking-tight text-[11px] shadow-sm transition-all uppercase cursor-pointer"
          >
            <span>{t.viewAllTransit}</span>
          </button>
          <button
            onClick={() => setPanelCollapsed(c => !c)}
            title={panelCollapsed
              ? (lang === "ar" ? "إظهار لوحة الشحنات" : lang === "tr" ? "Sevkiyat panelini göster" : "Show shipment panel")
              : (lang === "ar" ? "إخفاء لوحة الشحنات" : lang === "tr" ? "Sevkiyat panelini gizle" : "Hide shipment panel")}
            className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 px-3 py-1.5 rounded-xl font-bold text-[11px] transition-all cursor-pointer"
          >
            {panelCollapsed ? <Expand className="w-3.5 h-3.5" /> : <Minimize className="w-3.5 h-3.5" />}
            <span>{panelCollapsed
              ? (lang === "ar" ? "اللوحة" : lang === "tr" ? "Panel" : "Panel")
              : (lang === "ar" ? "طي" : lang === "tr" ? "Daralt" : "Collapse")}</span>
          </button>
        </div>
      </div>

      {/* feature/admin-mobile-ui: mobile-only List/Map toggle — the
          sidebar and map below render one at a time on narrow viewports
          (see mobileListOpen), so this pill is the way to switch between
          them. Hidden at lg: where both already show side-by-side. */}
      <div className="lg:hidden bg-slate-100 p-1 rounded-xl border border-slate-200 flex gap-1 text-xs font-bold">
        <button
          type="button"
          onClick={() => setMobileListOpen(false)}
          className={`flex-1 py-2 rounded-lg transition-all cursor-pointer border-0 ${!mobileListOpen ? "bg-slate-900 text-white shadow-xs" : "text-slate-500 bg-transparent"}`}
        >
          {lang === "tr" ? "Harita" : lang === "ar" ? "الخريطة" : "Map"}
        </button>
        <button
          type="button"
          onClick={() => setMobileListOpen(true)}
          className={`flex-1 py-2 rounded-lg transition-all cursor-pointer border-0 ${mobileListOpen ? "bg-slate-900 text-white shadow-xs" : "text-slate-500 bg-transparent"}`}
        >
          {lang === "tr" ? "Liste" : lang === "ar" ? "القائمة" : "List"} ({inTransitShipments.length})
        </button>
      </div>

      {/* MAIN CONTAINER LAYOUT */}
      <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12 max-w-full ${isFullscreen ? "flex-1 min-h-0" : "min-h-[620px]"}`}>

        {/* LEFT SIDEBAR: ACTIVE TRACKS STATUS CARD */}
        <div className={`${mobileListOpen ? "flex" : "hidden"} ${panelCollapsed ? "lg:hidden" : "lg:flex lg:col-span-3"} border-r border-slate-200 flex-col bg-slate-50/50 ${isFullscreen ? "min-h-0 overflow-hidden" : ""}`}>
          
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-100 bg-white space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-orange-500 shrink-0" />
                <h2 className="font-black text-slate-900 tracking-tight text-[11px] uppercase">{t.activeTracking}</h2>
              </div>
              <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full text-[10px] font-black font-mono">
                {inTransitShipments.length}
              </span>
            </div>
            
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {t.subTitle}
            </p>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full pl-8 pr-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[11px] outline-none text-slate-800 placeholder-slate-400 focus:bg-white focus:border-slate-400 transition-all font-medium"
              />
            </div>

            {/* Segmented Map Status Filter Control */}
            <div className="bg-slate-100 p-1 rounded-xl text-[10px] font-bold border border-slate-200 flex gap-1">
              <button
                type="button"
                onClick={() => setMapStatusFilter("all")}
                className={`flex-1 py-1.5 px-1.5 rounded-lg transition-all text-center cursor-pointer ${
                  mapStatusFilter === "all"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                🌍 {fLabels.all} ({shipments.length})
              </button>
              <button
                type="button"
                onClick={() => setMapStatusFilter("active")}
                className={`flex-1 py-1.5 px-1.5 rounded-lg transition-all text-center cursor-pointer ${
                  mapStatusFilter === "active"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                📡 {fLabels.active} ({shipments.filter(s => s.status !== "Closed" && s.status !== "Delivered").length})
              </button>
              <button
                type="button"
                onClick={() => setMapStatusFilter("in_transit")}
                className={`flex-1 py-1.5 px-1.5 rounded-lg transition-all text-center cursor-pointer ${
                  mapStatusFilter === "in_transit"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                🚚 {fLabels.inTransit} ({shipments.filter(s => s.status === "In Transit").length})
              </button>
            </div>

            {/* Truck Type Filter Panel */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-700">
                <span className="flex items-center gap-1">
                  <Filter className="w-3 h-3 text-orange-500" />
                  {t.truckFilterTitle}
                </span>
                
                {/* Select All / Deselect All Toggles */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedTruckTypes([...TRUCK_TYPES.map(tk => tk.id), "unspecified"])}
                    className="text-[9px] font-bold text-orange-600 hover:text-orange-800 transition-colors uppercase font-mono cursor-pointer"
                  >
                    {t.allTypes.split(" ")[0]}
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={() => setSelectedTruckTypes([])}
                    className="text-[9px] font-bold text-slate-500 hover:text-slate-800 transition-colors uppercase font-mono cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Grid of Checkboxes */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {TRUCK_TYPES.map(type => {
                  const isChecked = selectedTruckTypes.includes(type.id);
                  const count = getTruckTypeCount(type.id);
                  const label = (type as any)[lang] || type.en;

                  return (
                    <button
                      key={type.id}
                      onClick={() => {
                        if (isChecked) {
                          setSelectedTruckTypes(prev => prev.filter(id => id !== type.id));
                        } else {
                          setSelectedTruckTypes(prev => [...prev, type.id]);
                        }
                      }}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-[9px] font-medium transition-all text-left cursor-pointer ${
                        isChecked
                          ? "bg-orange-50/70 text-slate-800 border-orange-500/30"
                          : "bg-white text-slate-400 border-slate-100 hover:bg-slate-100"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 truncate max-w-[130px]">
                        <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                          isChecked 
                            ? "bg-orange-500 border-orange-500 text-white" 
                            : "border-slate-300 bg-white"
                        }`}>
                          {isChecked && <Check className="w-2.5 h-2.5 stroke-[3.5]" />}
                        </span>
                        <span className="truncate">{label}</span>
                      </span>
                      <span className={`font-mono text-[8.5px] px-1 rounded-sm font-bold ${
                        isChecked 
                          ? "bg-orange-100 text-orange-800" 
                          : "bg-slate-100 text-slate-400"
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}

                {/* Unspecified/unassigned driver truck types check button */}
                {(() => {
                  const isChecked = selectedTruckTypes.includes("unspecified");
                  const count = getTruckTypeCount("unspecified");
                  const label = t.unspecifiedType;

                  return (
                    <button
                      onClick={() => {
                        if (isChecked) {
                          setSelectedTruckTypes(prev => prev.filter(id => id !== "unspecified"));
                        } else {
                          setSelectedTruckTypes(prev => [...prev, "unspecified"]);
                        }
                      }}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-[9px] font-medium transition-all text-left col-span-2 cursor-pointer ${
                        isChecked
                          ? "bg-orange-50/70 text-slate-800 border-orange-500/30"
                          : "bg-white text-slate-400 border-slate-100 hover:bg-slate-100"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                          isChecked 
                            ? "bg-orange-500 border-orange-500 text-white" 
                            : "border-slate-300 bg-white"
                        }`}>
                          {isChecked && <Check className="w-2.5 h-2.5 stroke-[3.5]" />}
                        </span>
                        <span>{label}</span>
                      </span>
                      <span className={`font-mono text-[8.5px] px-1 rounded-sm font-bold ${
                        isChecked 
                          ? "bg-orange-100 text-orange-800" 
                          : "bg-slate-100 text-slate-400"
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* Sidebar Controls buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={handleShowAll}
                className="py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-[10px] rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase font-mono"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{t.viewAllTransit}</span>
              </button>
              <button 
                onClick={() => {
                  if (filteredTransit.length > 0) {
                    handleSelectShipment(filteredTransit[0]);
                  } else {
                    handleShowAll();
                  }
                }}
                className="py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-[10px] rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase font-mono"
                title="Odaklan"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>{t.bestFitZoom}</span>
              </button>
            </div>

            {/* Focus on Driver GPS: pans the map to the assigned driver's last
                reported GPS fix. Renamed from the misleading "My Current
                Location" — this never used the browser's geolocation; it has
                always focused a driver's reported position. */}
            <button
              onClick={handleGoToMyLocation}
              className="w-full mt-2 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-extrabold text-[10px] rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase font-mono"
              title={lang === "ar" ? "التركيز على موقع GPS للسائق" : lang === "tr" ? "Sürücü GPS'ine Odaklan" : "Focus on the assigned driver's GPS"}
            >
              <Navigation className="w-3.5 h-3.5 text-orange-600" />
              <span>{lang === "ar" ? "التركيز على GPS السائق" : lang === "tr" ? "Sürücü GPS'ine Odaklan" : "Focus on Driver GPS"}</span>
            </button>
          </div>

          {/* Sidebar Body: Shipment Cards List */}
          <div className={`flex-1 overflow-y-auto p-2 space-y-2 ${isFullscreen ? "min-h-0" : "h-[65vh] lg:h-[480px]"}`}>
            {inTransitShipments.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <AlertTriangle className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-[11px] text-slate-400 font-semibold italic">
                  {t.noInTransit}
                </p>
              </div>
            ) : filteredTransit.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs italic">
                No matches found
              </div>
            ) : (
              filteredTransit.map(s => {
                const isSelected = selectedShipment?.id === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectShipment(s)}
                    className={`rounded-xl border transition-all cursor-pointer flex flex-col relative overflow-hidden ${isFullscreen ? "p-2 gap-1" : "p-3 gap-2"} ${
                      isSelected
                        ? "bg-slate-100 border-slate-300 shadow-xs"
                        : "bg-white border-slate-100 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs font-extrabold text-blue-600 selectable">#{s.shipmentNumber}</p>
                        <h4 className="font-black text-[11px] text-slate-800 truncate max-w-[155px]">{s.companyName}</h4>
                      </div>
                      <span className="inline-flex items-center gap-0.5 text-[8.5px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md uppercase font-mono">
                        <Activity className="w-2.5 h-2.5" />
                        <span>{t.activeTracking}</span>
                      </span>
                    </div>

                    <div className={`text-[10px] text-slate-500 font-medium grid grid-cols-2 gap-1 bg-slate-50 rounded-lg border border-slate-100 ${isFullscreen ? "p-1" : "p-1.5"}`}>
                      <div>
                        <span className="block text-[8px] text-slate-400 uppercase font-bold">{t.from}</span>
                        <span className="truncate block font-semibold text-slate-700">{s.loadingCity}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] text-slate-400 uppercase font-bold">{t.to}</span>
                        <span className="truncate block font-semibold text-slate-700">{s.deliveryCity}</span>
                      </div>
                    </div>

                    {/* Honest per-shipment location badge — labels the 4-state
                        tracking model instead of always claiming a precise fix. */}
                    {(() => {
                      const loc = getShipmentVectorLocation(s);
                      const state = loc.state;
                      const toneCls =
                        state === "live_gps" ? "bg-emerald-50/80 text-emerald-800 border-emerald-100"
                        : state === "last_reported" ? "bg-amber-50/80 text-amber-800 border-amber-100"
                        : "bg-slate-100 text-slate-500 border-slate-200";
                      const label =
                        state === "live_gps" ? t.trackLive
                        : state === "last_reported" ? t.trackReported
                        : state === "estimated" ? t.trackEstimated
                        : t.trackUnavailable;
                      return (
                        <div className={`text-[10.5px] font-mono rounded-xl border flex items-center justify-between gap-1.5 ${toneCls} ${isFullscreen ? "p-1" : "p-1.5"}`}>
                          <span className="flex items-center gap-1 font-extrabold truncate">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{loc.available ? getNearestCity(loc.x, loc.y) : t.noFix}</span>
                          </span>
                          <span className="text-[8.5px] font-black shrink-0">
                            {loc.available && loc.isActualGps
                              ? `${loc.lat!.toFixed(4)}°, ${loc.lng!.toFixed(4)}°`
                              : label}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Driver line. The whole card is the click target
                        (onClick above selects + focuses the shipment on the
                        map), so the redundant "Locate on Grid" button was
                        removed — a chevron affordance signals the row action. */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                      <p className="flex items-center gap-1 truncate max-w-[160px]">
                        <Truck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="font-semibold text-slate-600 truncate">{s.assignedDriverName || "Unknown"}</span>
                      </p>
                      <span className={`font-bold text-[9.5px] uppercase transition-all ${isSelected ? "text-orange-600" : "text-slate-300"}`}>➔</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Loaded-page notice: AdminPanel fetches shipments with a server
              limit of 50. When the list is at that cap we say so honestly,
              rather than implying the whole fleet is shown. No backend change. */}
          {shipments.length >= 50 && (
            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-500 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{t.loadedCapNotice}</span>
            </div>
          )}
        </div>

        {/* RIGHT CONTAINER: PRISTINE LIVE VECTOR RADAR GRACEFULLY HANDLING INTERPOLATED POSITIONS WITH TRANSITIONS */}
        <div className={`${mobileListOpen ? "hidden" : "flex"} lg:flex ${panelCollapsed ? "lg:col-span-12" : "lg:col-span-9"} relative w-full min-w-[200px] bg-slate-950 flex-col justify-between overflow-hidden ${isFullscreen ? "h-full" : "h-[65vh] lg:h-[620px]"}`}>
          
          {/* Radar Ambient Weather Overlay */}
          <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-xs text-white px-2.5 py-1 rounded-lg shadow-md text-[9.5px] font-bold font-mono tracking-tight flex items-center gap-1.5 border border-slate-800 z-10">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="text-slate-300">{t.lastUpdated}</span>
          </div>

          <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur-xs text-slate-300 px-2 rounded-lg shadow-md text-[9.5px] font-bold font-mono tracking-tight flex items-center gap-1.5 border border-slate-800 z-10">
            <span>Grid Scale: {viewScale.toFixed(1)}x</span>
          </div>

          {/* Graphical Interactive Map Grid with zoom navigation and smooth translation transitions */}
          <div className="relative w-full h-full flex flex-col justify-between p-4 select-none">
            
            {/* Background Control Panel for scaling */}
            <div className="absolute bottom-5 right-5 flex flex-col gap-1.5 z-25">
              <button 
                onClick={handleGoToMyLocation} 
                className="bg-white hover:bg-orange-50 text-slate-900 border border-slate-200 p-2 rounded-xl shadow-md cursor-pointer flex items-center justify-center font-bold relative group"
                title={lang === "ar" ? "الذهاب إلى موقعي الحالي" : lang === "tr" ? "Koordinatlarıma Odaklan" : "Go to my current location"}
              >
                <Navigation className="w-3.5 h-3.5 text-orange-600 animate-pulse" />
                {currentDriverId && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
                )}
              </button>
              <button 
                onClick={increaseZoom} 
                className="bg-white hover:bg-slate-100 text-slate-900 border border-slate-200 p-2 rounded-xl shadow-md cursor-pointer flex items-center justify-center font-bold"
                title="Zoom In Grid"
              >
                <Expand className="w-3.5 h-3.5 text-slate-700" />
              </button>
              <button 
                onClick={decreaseZoom} 
                className="bg-white hover:bg-slate-100 text-slate-900 border border-slate-200 p-2 rounded-xl shadow-md cursor-pointer flex items-center justify-center font-bold"
                title="Zoom Out Grid"
              >
                <Minimize className="w-3.5 h-3.5 text-slate-700" />
              </button>
            </div>

            {/* Title description bar */}
            <div className="flex items-center justify-between z-10 bg-slate-900/85 backdrop-blur-xs p-3 rounded-xl border border-slate-800 text-white font-mono text-[10px] leading-none mt-8 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>
                <span className="font-extrabold text-slate-200 tracking-wider uppercase">{t.vectorCorridorTitle}</span>
              </div>
              <span className="text-slate-400">ETIR Core Gateway</span>
            </div>

            {/* Grid Map Box */}
            <div className="flex-1 relative my-2 overflow-hidden bg-slate-950/40 rounded-2xl border border-slate-900/80 flex items-center justify-center" id="vector-map-frame">
              
              {/* Location acquisition feedback alert banner overlay */}
              {locationStatusMessage && (
                <div className="absolute top-4 left-4 right-4 bg-slate-900/95 text-white text-[11px] py-2.5 px-3.5 rounded-xl border border-orange-500/40 shadow-2xl flex items-center gap-2 z-30 transition-all font-mono animate-pulse">
                  <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
                  <span className="font-semibold text-slate-100">{locationStatusMessage}</span>
                </div>
              )}

              {/* Compact, honest map legend — extracted to admin/tracking.
                  Documents the 4-state tracking-confidence colours (which is
                  what markers now encode) plus the clustering hint. */}
              <div className="absolute bottom-4 left-4 z-20 font-mono text-[10px] select-none text-left flex flex-col pointer-events-auto transition-all duration-300">
                <TrackingLegend lang={lang} isOpen={isLegendOpen} onToggle={setIsLegendOpen} />
              </div>

              {/* CONDITIONAL MAP VIEWS UNDERLAY */}
              {mapViewMode === "vector" ? (
                /* Responsive SVG Grid container with dynamic Transform Matrix applied seamlessly */
                <div 
                  className="w-full h-full absolute inset-0 transition-transform duration-1000 ease-out"
                  style={{ 
                    transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewScale})`,
                    transformOrigin: "center center"
                  }}
                >
                  <svg
                    viewBox="0 0 850 550"
                    className="w-full h-full"
                    style={{ 
                      backgroundImage: 'radial-gradient(rgba(244,63,94,0.02) 1.5px, transparent 1.5px), radial-gradient(rgba(249,115,22,0.03) 1px, transparent 1px)', 
                      backgroundSize: '48px 48px, 24px 24px' 
                    }}
                  >
                    {/* Outer Frame Borders */}
                    <rect x="5" y="5" width="840" height="540" fill="none" stroke="rgba(249,115,22,0.1)" strokeWidth="1" rx="8" />

                    {/* Parallel & Meridian Dash Grid lines representing real geography */}
                    <g stroke="rgba(148, 163, 184, 0.08)" strokeWidth="1" strokeDasharray="3 6">
                      <line x1="5" y1="100" x2="845" y2="100" />
                      <line x1="5" y1="200" x2="845" y2="200" />
                      <line x1="5" y1="300" x2="845" y2="300" />
                      <line x1="5" y1="400" x2="845" y2="400" />
                      <line x1="5" y1="500" x2="845" y2="500" />
                      
                      <line x1="150" y1="5" x2="150" y2="545" />
                      <line x1="300" y1="5" x2="300" y2="545" />
                      <line x1="450" y1="5" x2="450" y2="545" />
                      <line x1="600" y1="5" x2="600" y2="545" />
                      <line x1="750" y1="5" x2="750" y2="545" />
                    </g>
                    
                    {/* Geographic Axis Reference Texts */}
                    <g fill="rgba(148, 163, 184, 0.35)" className="font-mono text-[8px] select-none pointer-events-none font-bold">
                      <text x="15" y="94">41°N (Lat)</text>
                      <text x="15" y="194">38°N (Lat)</text>
                      <text x="15" y="294">36°N (Lat)</text>
                      <text x="15" y="394">33°N (Lat)</text>
                      <text x="15" y="494">31°N (Lat)</text>
                      
                      <text x="155" y="22">29°E (Lng)</text>
                      <text x="305" y="22">33°E (Lng)</text>
                      <text x="455" y="22">37°E (Lng)</text>
                      <text x="605" y="22">41°E (Lng)</text>
                      <text x="755" y="22">45°E (Lng)</text>
                    </g>

                    {/* Boundary Demarcation (Border) Line between Turkey and Iraq */}
                    <g className="opacity-70">
                      <line x1="470" y1="50" x2="470" y2="500" stroke="#f43f5e" strokeWidth="2.5" strokeDasharray="6 6" />
                      <text x="478" y="70" fill="#f43f5e" className="font-mono text-[9px] uppercase font-black tracking-wider fill-rose-400">{t.borderCrossing}</text>
                      <text x="400" y="525" fill="#94a3b8" className="font-mono text-[10px] uppercase font-black tracking-widest">Turkey 🌿</text>
                      <text x="510" y="525" fill="#94a3b8" className="font-mono text-[10px] uppercase font-black tracking-widest">🌴 Iraq</text>
                    </g>

                    {/* Main Corridor Highway underlay vector paths representing transit corridors */}
                    {/* Istanbul to Bursa to Ankara to Gaziantep */}
                    <path d="M 100 130 L 115 175 L 230 205 L 390 285" fill="none" stroke="#1e293b" strokeWidth="6" strokeLinecap="round" />
                    <path d="M 100 130 L 115 175 L 230 205 L 390 285" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
                    
                    {/* Gaziantep to Zaho (Border) to Erbil to Kirkuk to Baghdad to Basra */}
                    <path d="M 390 285 L 495 255 L 555 285 L 585 315 L 605 395 L 725 465" fill="none" stroke="#1e293b" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M 390 285 L 495 255 L 555 285 L 585 315 L 605 395 L 725 465" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                    {/* Draw selected path highlighted dynamically */}
                    {selectedShipment && (
                      <g>
                        {(() => {
                          const start = findVectorCity(selectedShipment.loadingCity);
                          const end = findVectorCity(selectedShipment.deliveryCity);
                          return (
                            <line 
                              x1={start.x} 
                              y1={start.y} 
                              x2={end.x} 
                              y2={end.y} 
                              stroke="#f97316" 
                              strokeWidth="3.5" 
                              strokeDasharray="5 5" 
                              className="animate-[dash_2s_linear_infinite]"
                            />
                          );
                        })()}
                      </g>
                    )}

                    {/* Cities Radar Hotspots Grid */}
                    {Object.entries(VECTOR_CITIES).map(([key, c]) => {
                      const isOrigin = selectedShipment && selectedShipment.loadingCity.toLowerCase().includes(key);
                      const isDest = selectedShipment && selectedShipment.deliveryCity.toLowerCase().includes(key);

                      return (
                        <g 
                          key={key} 
                          transform={`translate(${c.x}, ${c.y})`} 
                          className="cursor-pointer"
                          onClick={() => {
                            // Find any shipment loaded in this city
                            const found = inTransitShipments.find(s => s.loadingCity.toLowerCase().includes(key) || s.deliveryCity.toLowerCase().includes(key));
                            if (found) handleSelectShipment(found);
                          }}
                        >
                          {/* Interactive hotspot pulsing rings */}
                          <circle 
                            r={isOrigin || isDest ? "16" : "8"} 
                            fill={isOrigin ? "rgba(249,115,22,0.22)" : isDest ? "rgba(59,130,246,0.22)" : "transparent"} 
                            className="animate-ping" 
                          />
                          <circle 
                            r="6.5" 
                            fill={isOrigin ? "#f97316" : isDest ? "#3b82f6" : "#475569"} 
                            stroke="#0f172a" 
                            strokeWidth="2" 
                          />
                          <text 
                            y="-13" 
                            textAnchor="middle" 
                            fill={isOrigin ? "#f97316" : isDest ? "#60a5fa" : "#94a3b8"} 
                            className="font-mono text-[9.5px] font-black tracking-tight select-none pointer-events-none drop-shadow-md"
                          >
                            {c.label}
                          </text>
                          <text 
                            y="18" 
                            textAnchor="middle" 
                            fill="#475569" 
                            className="font-mono text-[7px] font-black tracking-widest select-none pointer-events-none"
                          >
                            {c.country === "Turkey" ? "TR" : "IQ"}
                          </text>
                        </g>
                      );
                    })}

                    {/* Moving Trucks on SVG Corridor Grid. Nearby markers are
                        grouped into cluster bubbles (pure clusterMarkers); a
                        cluster shows "N" and zooms in on click to separate. */}
                    {vectorClusters.map(cluster => {
                      if (cluster.count > 1) {
                        const target = Math.min(2.6, viewScale + 0.8);
                        return (
                          <g
                            key={`cluster-${cluster.items[0].shipment.id}-${cluster.count}`}
                            className="cursor-pointer select-none"
                            onClick={() => { setViewScale(target); setViewPan({ x: 425 - cluster.x * target, y: 275 - cluster.y * target }); }}
                            style={{ transform: `translate(${cluster.x}px, ${cluster.y}px)`, transition: "transform 1.8s cubic-bezier(0.25, 1, 0.5, 1)" }}
                          >
                            <circle r="19" fill="rgba(249,115,22,0.18)" stroke="#f97316" strokeWidth="1.5" className="animate-pulse" />
                            <circle r="13" fill="#1e293b" stroke="#f97316" strokeWidth="1.5" />
                            <text textAnchor="middle" dy="3.5" fill="#f8fafc" className="font-mono text-[10px] font-black">{cluster.count}</text>
                          </g>
                        );
                      }

                      const s = cluster.items[0].shipment;
                      const activeLoc = { x: cluster.x, y: cluster.y };
                      const isSelected = selectedShipment?.id === s.id;
                      const gpsState = cluster.items[0].state;
                      const colors = stateColors(gpsState);

                      return (
                        <g
                          key={s.id}
                          className="cursor-pointer group select-none"
                          onClick={() => handleSelectShipment(s)}
                          // CSS coordinate transition applied directly to translation matrix.
                          // Positions change only on real data refresh — no simulated crawl.
                          style={{
                            transform: `translate(${activeLoc.x}px, ${activeLoc.y}px)`,
                            transition: "transform 1.8s cubic-bezier(0.25, 1, 0.5, 1)",
                          }}
                        >
                          {/* Shimmer pulse rings on the truck – colour by tracking state */}
                          <circle
                            r={isSelected ? "22" : "15"}
                            fill={isSelected ? "rgba(249,115,22,0.28)" : colors.ring}
                            stroke={isSelected ? "#ea580c" : colors.stroke}
                            strokeWidth="1.5"
                            className="animate-pulse"
                          />

                          {/* Truck bubble badge */}
                          <g transform="translate(-11, -11)">
                            <rect 
                              width="22" 
                              height="22" 
                              rx="6" 
                              fill={isSelected ? "#ea580c" : "#1e293b"} 
                              stroke={isSelected ? "#ffffff" : "#f97316"} 
                              strokeWidth="1.5" 
                              className="transition-colors duration-300 shadow-xl"
                            />
                            <foreignObject width="22" height="22" className="flex items-center justify-center pointer-events-none">
                              <div className="w-full h-full flex items-center justify-center">
                                <Truck className="w-3.5 h-3.5 text-white animate-bounce" style={{ animationDuration: '3s' }} />
                              </div>
                            </foreignObject>
                          </g>

                           {/* Plate marker text */}
                           <text
                             y="24"
                             textAnchor="middle"
                             fill={isSelected ? "#ea580c" : "#e2e8f0"}
                             className="font-mono text-[9px] font-black tracking-tight"
                           >
                             #{s.shipmentNumber}
                           </text>
                           {isSelected && (
                             <g transform="translate(0, 36)">
                               {/* Background tooltip */}
                               <rect
                                 x="-55"
                                 y="-10"
                                 width="110"
                                 height="14"
                                 rx="3"
                                 fill="#0f172a"
                                 stroke="#ea580c"
                                 strokeWidth="1"
                               />
                               <text
                                 textAnchor="middle"
                                 fill="#34d399"
                                 className="font-mono text-[8.5px] font-bold"
                               >
                                 In {getNearestCity(activeLoc.x, activeLoc.y)}
                               </text>
                             </g>
                           )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              ) : (
                /* Google Map underlay */
                <div className="w-full h-full absolute inset-0 bg-slate-950 z-0 rounded-2xl">
                  {mapsAuthError && (
                    <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center rounded-2xl p-6 text-center select-text z-20">
                      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 mb-2 animate-bounce">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      
                      <div className="max-w-md space-y-3 text-left bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
                        <div className="space-y-1 text-center">
                          <span className="inline-block bg-red-500/15 text-red-400 font-mono font-black text-[9px] tracking-widest px-2 py-0.5 rounded border border-red-500/25 uppercase">
                            Google Maps API Error
                          </span>
                          <h4 className="font-sans font-black text-sm text-slate-100 tracking-tight leading-normal mt-1">
                            {lang === 'tr' ? "Harita Yetkilendirme Hatası" : lang === 'ar' ? "فشل ترخيص الخريطة" : "RefererNotAllowedMapError"}
                          </h4>
                        </div>
                        
                        <p className="text-[11px] text-slate-400 leading-relaxed text-center">
                          Your active Google Maps API key has HTTP referrer policies configured in Google Cloud, but your current preview URL is not authorized.
                        </p>

                        <div className="space-y-2">
                          <div className="border-t border-slate-800 pt-2 space-y-0.5">
                            <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest block">Authorization Target URL:</span>
                            <div className="bg-slate-950 p-2 rounded-xl border border-slate-800 text-[10.5px] font-mono font-bold text-orange-400 select-all break-all leading-normal">
                              {window.location.origin}/*
                            </div>
                          </div>

                          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/60 text-[9.5px]/normal text-slate-400">
                            <p className="font-bold text-slate-300 uppercase tracking-wider text-[8px] font-mono">🔧 How To Resolve in 1 Minute:</p>
                            <ol className="list-decimal list-inside space-y-0.5 pl-1">
                              <li>Go to <strong className="text-white">Google Cloud Console &gt; Credentials</strong></li>
                              <li>Select &amp; Edit your active API Key</li>
                              <li>Scroll to <strong className="text-white">Website restrictions</strong></li>
                              <li>Add the URL shown above and click <strong className="text-white">Save</strong></li>
                            </ol>
                          </div>
                        </div>

                        <div className="flex justify-center pt-0.5">
                          <button 
                            type="button" 
                            onClick={() => window.location.reload()} 
                            className="px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-xs rounded-xl tracking-wider transition-colors shadow-md shadow-orange-500/10 cursor-pointer"
                          >
                            🔄 RE-EVALUATE CONNECTION
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {hasValidMapsKey ? (
                    <APIProvider apiKey={activeMapsKey}>
                      {googleMapLoading && (
                        <div className="absolute inset-0 z-10 bg-slate-950 flex flex-col items-center justify-center rounded-2xl pointer-events-none p-6 select-none overflow-hidden">
                          {/* Pulsing Grid Mesh Backdrop */}
                          <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#f97316_1px,transparent_1px),linear-gradient(to_bottom,#f97316_1px,transparent_1px)] bg-[size:32px_32px]"></div>
                          
                          {/* Outer Pulsing Circular Telemetry radar scan */}
                          <div className="relative w-28 h-28 flex items-center justify-center">
                            <div className="absolute inset-0 w-full h-full rounded-full border border-orange-500/30 animate-[ping_2s_infinite]"></div>
                            <div className="absolute inset-2 w-24 h-24 rounded-full border-2 border-orange-500/10 animate-pulse bg-orange-500/5"></div>
                            <div className="absolute inset-6 w-16 h-16 rounded-full border border-orange-500/40 animate-spin bg-slate-900 flex items-center justify-center">
                              <MapPin className="w-6 h-6 text-orange-500 animate-bounce" />
                            </div>
                          </div>

                          {/* Loading Status Block */}
                          <div className="mt-6 text-center space-y-2 relative z-10 max-w-sm">
                            <span className="inline-block bg-orange-500/15 text-orange-400 font-mono font-black text-[9px] tracking-widest px-3 py-1 rounded border border-orange-500/25 animate-pulse">
                              {lang === 'tr' ? "EŞİTLENİYOR..." : lang === 'ar' ? "مزامنة الأنظمة..." : "SYNCHRONIZING..."}
                            </span>
                            <h4 className="font-sans font-extrabold text-sm text-slate-100 tracking-tight leading-none mt-1">
                              {lang === 'tr' ? "Google Harita Başlatılıyor" : lang === 'ar' ? "جاري تهيئة الخريطة..." : "Initializing Google Map"}
                            </h4>
                            <p className="text-[10px]/normal text-slate-500 font-mono">
                              {lang === 'tr' ? "Yüksek çözünürlüklü GIS verileri ve uydu telemetrisi yükleniyor..." : lang === 'ar' ? "تحميل معلومات شبكة النقل الدولية عبر الأقمار الصناعية..." : "Securing satcom GIS telemetry & transport corridor vectors..."}
                            </p>
                          </div>

                          {/* Elegant skeleton cards/bars simulating real-time coordinates layout */}
                          <div className="absolute bottom-6 right-6 left-6 grid grid-cols-2 gap-3 max-w-xs mx-auto opacity-40">
                            <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl space-y-1.5 animate-pulse">
                              <div className="h-2 w-12 bg-slate-800 rounded"></div>
                              <div className="h-3 w-20 bg-slate-700 rounded"></div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl space-y-1.5 animate-pulse text-right">
                              <div className="h-2 w-16 bg-slate-800 rounded ml-auto"></div>
                              <div className="h-3 w-14 bg-slate-700 rounded ml-auto"></div>
                            </div>
                          </div>
                        </div>
                      )}
                      <Map
                        id="corridor_main_network_google_map"
                        defaultCenter={{ lat: 36.5, lng: 38.5 }} // Centered in region between TR & IQ
                        defaultZoom={6}
                        gestureHandling={"cooperative"}
                        disableDefaultUI={true}
                        zoomControl={false}
                        mapId="DEMO_MAP_ID"
                        style={{ width: "100%", height: "100%", borderRadius: "1rem" }}
                        internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
                        onIdle={() => setGoogleMapLoading(false)}
                      >
                        {/* Custom Map Controls (Zoom Panel and Auto-Center) */}
                        <MapCustomControls selectedShipment={selectedShipment} lang={lang} shipments={shipments} getShipmentLocation={getShipmentVectorLocation} />

                        {/* Selected Shipment Route rendering dynamic polylines */}
                        {selectedShipment && (() => {
                          const activeLoc = getShipmentVectorLocation(selectedShipment);
                          // No route line when the selected shipment has no placeable position.
                          if (!activeLoc.available || activeLoc.lat == null || activeLoc.lng == null) return null;
                          const truckLoc = { lat: activeLoc.lat, lng: activeLoc.lng };
                          return (
                            <RouteDisplay
                              shipment={selectedShipment}
                              truckLocation={truckLoc}
                              origin={CITY_COORDINATES[selectedShipment.loadingCity?.toLowerCase().trim()] || CITY_COORDINATES["istanbul"]}
                              destination={CITY_COORDINATES[selectedShipment.deliveryCity?.toLowerCase().trim()] || CITY_COORDINATES["baghdad"]}
                            />
                          );
                        })()}

                        {/* Rendering Origin & Destination for selected shipment with pins */}
                        {selectedShipment && (() => {
                          const startLoc = CITY_COORDINATES[selectedShipment.loadingCity?.toLowerCase().trim()] || CITY_COORDINATES["istanbul"];
                          const endLoc = CITY_COORDINATES[selectedShipment.deliveryCity?.toLowerCase().trim()] || CITY_COORDINATES["baghdad"];
                          return (
                            <>
                              {/* Origin Marker */}
                              <AdvancedMarker position={startLoc} title={`Origin: ${selectedShipment.loadingCity}`}>
                                <div className="flex flex-col items-center justify-center">
                                  <span className="bg-emerald-600 border border-emerald-500 text-white font-bold text-[9px]/tight px-1.5 py-0.5 rounded shadow-md z-10 select-none whitespace-nowrap">
                                    {selectedShipment.loadingCity}
                                  </span>
                                  <div style={{ width: "32px", height: "32px" }} className="w-8 h-8 bg-emerald-600/20 border border-emerald-500 rounded-full flex items-center justify-center">
                                    <div className="w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"></div>
                                  </div>
                                </div>
                              </AdvancedMarker>

                              {/* Destination Marker */}
                              <AdvancedMarker position={endLoc} title={`Destination: ${selectedShipment.deliveryCity}`}>
                                <div className="flex flex-col items-center justify-center">
                                  <span className="bg-blue-600 border border-blue-500 text-white font-bold text-[9px]/tight px-1.5 py-0.5 rounded shadow-md z-10 select-none whitespace-nowrap">
                                    {selectedShipment.deliveryCity}
                                  </span>
                                  <div style={{ width: "32px", height: "32px" }} className="w-8 h-8 bg-blue-600/20 border border-blue-500 rounded-full flex items-center justify-center animate-pulse">
                                    <div className="w-3 h-3 bg-blue-500 rounded-full border-2 border-white"></div>
                                  </div>
                                </div>
                              </AdvancedMarker>
                            </>
                          );
                        })()}

                        {/* All moving trucks markers */}
                        {filteredTransit.map(s => {
                          const activeLoc = getShipmentVectorLocation(s);
                          // Location Unavailable: no coordinate, so no map marker.
                          if (!activeLoc.available || activeLoc.lat == null || activeLoc.lng == null) return null;
                          const isSelected = selectedShipment?.id === s.id;
                          const truckCoords = { lat: activeLoc.lat, lng: activeLoc.lng };
                          const gpsState = getShipmentGpsState(s);
                          const colors = stateColors(gpsState);

                          return (
                            <AdvancedMarker
                              key={s.id}
                              position={truckCoords}
                              title={`Shipment #${s.shipmentNumber}`}
                              onClick={() => handleSelectShipment(s)}
                            >
                              <div className={`flex flex-col items-center justify-center cursor-pointer transform transition-all hover:scale-110 active:scale-95 ${isSelected ? "scale-110 z-20" : "z-10"}`}>
                                {/* Interactive bubble badge */}
                                <span className={`shadow-md font-bold font-mono text-[9px]/tight px-1.5 py-0.5 rounded text-white whitespace-nowrap ${
                                  isSelected ? "bg-orange-600 border border-white" : "bg-slate-900 border border-slate-700"
                                }`}>
                                  #{s.shipmentNumber}
                                </span>

                                <div
                                  style={{ width: "36px", height: "36px" }}
                                  className={`w-9 h-9 rounded-full flex items-center justify-center border-2 shadow-lg transition-transform ${
                                    isSelected ? "bg-orange-600 border-white" : colors.bg
                                  }`}
                                >
                                  <Truck className="w-4 h-4 text-white" />
                                </div>

                                {!isSelected && (
                                  <span className={`text-[7px] font-mono font-black px-1 rounded mt-0.5 ${colors.text}`}>
                                    {colors.chip}
                                  </span>
                                )}
                              </div>
                            </AdvancedMarker>
                          );
                        })}
                      </Map>
                    </APIProvider>
                  ) : (
                    /* BUG-26 (PR #63 GPS QA review): this used to tell admins to open
                       "Settings > Secrets" in "AI Studio" — leftover prototype
                       boilerplate that doesn't exist in this deployed app, so
                       following it would just dead-end. Rewritten to state plainly
                       that this is a fallback/setup state (not a live map, and not a
                       bug) and point at the real mechanism: an environment variable,
                       set outside the repo, never a hardcoded key. */
                    <div className="w-full h-full flex flex-col justify-center items-center text-center p-6 space-y-4">
                      <div className="w-12 h-12 rounded-full bg-orange-950/40 border border-orange-800 flex items-center justify-center shrink-0">
                        <MapPin className="w-6 h-6 text-orange-400 animate-bounce" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-bold text-sm text-slate-100">
                          {lang === 'tr' ? "Harita hizmeti yapılandırılmamış" : lang === 'ar' ? "خدمة الخريطة غير مهيأة" : "Map service not configured"}
                        </h4>
                        <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-normal">
                          {lang === 'tr'
                            ? "Bu dağıtım için bir Google Haritalar Platformu anahtarı yapılandırılmamış, bu yüzden etkileşimli harita yüklenemiyor. Bu bir kurulum adımıdır, canlı bir harita değildir — aşağıdaki sevkiyat listesi, arama ve filtreler etkilenmez."
                            : lang === 'ar'
                              ? "لم يتم تهيئة مفتاح خدمة خرائط غوغل لهذا النشر، لذا لا يمكن تحميل الخريطة التفاعلية. هذه خطوة إعداد وليست خريطة مباشرة — قائمة الشحنات والبحث والفلاتر أدناه تعمل بشكل طبيعي."
                              : "No Google Maps Platform key is configured for this deployment, so the interactive map can't load. This is a setup step, not a live map — shipment list, search, and filters below are unaffected."}
                        </p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-left text-[11px]/normal text-slate-400 space-y-1.5 max-w-sm w-full font-mono">
                        <p className="text-[10px] font-bold text-slate-200 uppercase tracking-wider">Setup Instructions:</p>
                        <p>1. Get a Google Maps Platform API key from <strong className="text-white">Google Cloud Console &gt; Credentials</strong>.</p>
                        <p>2. Restrict it by HTTP referrer — <strong className="text-white">localhost</strong> for local dev, <strong className="text-white">etir.app</strong> for production.</p>
                        <p>3. Set it as the <strong className="text-orange-400">GOOGLE_MAPS_PLATFORM_KEY</strong> environment variable for this deployment (e.g. a Cloud Run secret/env var) — never commit it to the repository.</p>
                        <p>4. Redeploy or restart the dev server to pick it up.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Selected shipment overlay detailed visual card */}
              {selectedShipment && (
                <div className="absolute bottom-4 right-4 left-4 sm:left-auto bg-slate-900/95 backdrop-blur-md border border-slate-800 p-4 rounded-xl text-white max-w-xs z-15 space-y-2.5 text-left shadow-2xl animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-ping"></span>
                      <span className="font-mono font-black text-orange-400 text-xs selectable">#{selectedShipment.shipmentNumber}</span>
                    </div>
                    <button
                      onClick={() => { setSelectedShipment(null); setEtaData(null); setEtaError(null); setEtaForId(null); }}
                      className="text-slate-400 hover:text-white transition-all cursor-pointer p-0.5 rounded-full hover:bg-slate-800"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="space-y-1.5 font-mono text-[10px] text-slate-300">
                    <p><span className="text-slate-500 uppercase font-black">{t.customer}:</span> <strong className="text-white font-sans text-xs">{selectedShipment.companyName}</strong></p>
                    <p><span className="text-slate-500 uppercase font-black">{t.driver}:</span> <strong className="text-orange-400 font-sans">{selectedShipment.assignedDriverName || "—"}</strong></p>
                    <p><span className="text-slate-500 uppercase font-black">{t.truckPlate}:</span> <strong className="text-slate-100">{selectedShipment.truckNumber || "—"}</strong></p>
                    <p className="truncate"><span className="text-slate-500 uppercase font-black">{t.cargo}:</span> <span className="font-sans text-[10px] italic text-slate-400">{selectedShipment.cargoDescription}</span></p>
                  </div>

                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1 font-mono text-[9px]">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 uppercase tracking-wider">{t.from}</span>
                      <span className="font-extrabold text-slate-200">{selectedShipment.loadingCity}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 uppercase tracking-wider">{t.to}</span>
                      <span className="font-extrabold text-slate-200">{selectedShipment.deliveryCity}</span>
                    </div>
                    {(() => {
                      const loc = getShipmentVectorLocation(selectedShipment);
                      const city = loc.available ? getNearestCity(loc.x, loc.y) : t.noFix;
                      const gpsState = getShipmentGpsState(selectedShipment);
                      const driver = localDrivers.find(d => d.id === selectedShipment.assignedDriverId);
                      const freshness = getGpsFreshness(driver?.lastUpdated, Date.now());
                      const stateLabel =
                        gpsState === "live_gps" ? t.trackLive
                        : gpsState === "last_reported" ? t.trackReported
                        : gpsState === "estimated" ? t.trackEstimated
                        : t.trackUnavailable;
                      const stateTone =
                        gpsState === "live_gps" ? "text-emerald-400"
                        : gpsState === "last_reported" ? "text-amber-400"
                        : gpsState === "estimated" ? "text-orange-400"
                        : "text-slate-500";
                      const stateChip = stateColors(gpsState).chip;
                      return (
                        <>
                          <div className="flex justify-between items-center border-t border-slate-800 pt-1 mt-1 font-extrabold">
                            <span className={`uppercase tracking-wider ${gpsState === "estimated" ? "text-orange-400" : "text-emerald-500"}`}>
                              {gpsState === "estimated" ? "NEAR:" : "LOCATION:"}
                            </span>
                            <span className={gpsState === "estimated" ? "text-orange-300" : "text-emerald-400"}>{city}</span>
                          </div>
                          {loc.available && loc.isActualGps && loc.lat != null && loc.lng != null ? (
                            <div className="flex justify-between items-center text-[7.5px] text-slate-400">
                              <span>COORDINATES:</span>
                              <span>{loc.lat.toFixed(5)}°N, {loc.lng.toFixed(5)}°E</span>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center text-[7.5px] text-slate-500 italic">
                              <span>COORDINATES:</span>
                              <span>{gpsState === "estimated" ? t.estimatedNote : t.noFix}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-[7.5px] font-extrabold">
                            <span className="text-slate-500 uppercase">TRACKING:</span>
                            <span className={stateTone}>{stateChip} {stateLabel}</span>
                          </div>
                          <div className="flex justify-between items-center text-[7.5px] font-extrabold">
                            <span className="text-slate-500 uppercase">LAST UPDATE:</span>
                            <span className={freshness.status === "stale" ? "text-amber-400" : freshness.status === "fresh" ? "text-slate-300" : "text-slate-500"}>
                              {freshness.status === "none"
                                ? "No GPS update yet"
                                : freshness.minutesAgo === 0
                                  ? "Just now"
                                  : `${freshness.minutesAgo}m ago${freshness.status === "stale" ? " · signal may be stale" : ""}`}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                    <div className="pt-1.5 mt-1 border-t border-dashed border-slate-800 text-[8.5px] text-orange-400 flex items-center justify-between font-extrabold">
                      <span>STATUS FEED:</span>
                      <span>{selectedShipment.status}</span>
                    </div>
                  </div>

                  {/* On-demand ETA & Distance — 5 states (idle / loading /
                      error / unavailable / success). Never auto-called; the
                      result is cleared whenever the selection changes. */}
                  {(() => {
                    const eta = etaForId === selectedShipment.id ? etaData : null;
                    const calcLabel = lang === "ar" ? "حساب الوقت والمسافة" : lang === "tr" ? "Süre ve Mesafeyi Hesapla" : "Calculate ETA & Distance";
                    if (etaLoading) {
                      return (
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-center gap-2 text-[9px] font-mono text-slate-400">
                          <Navigation className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                          <span className="animate-pulse">{lang === "ar" ? "جارٍ الحساب..." : lang === "tr" ? "Hesaplanıyor..." : "Calculating..."}</span>
                        </div>
                      );
                    }
                    if (etaError) {
                      return (
                        <div className="bg-red-500/10 border border-red-500/30 p-2.5 rounded-lg text-[9px] font-mono text-red-300 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p>{etaError}</p>
                            <button onClick={() => handleCalculateEta(selectedShipment)} className="underline font-bold cursor-pointer">
                              {lang === "ar" ? "إعادة المحاولة" : lang === "tr" ? "Tekrar dene" : "Retry"}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (eta && eta.status === "UNAVAILABLE") {
                      return (
                        <div className="bg-orange-500/10 border border-orange-500/30 p-2.5 rounded-lg text-[9px] font-mono text-orange-300 flex items-start gap-1.5">
                          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{lang === "ar" ? "المسافة غير متوفرة لهذا المسار" : lang === "tr" ? "Bu rota için mesafe yok" : "Route distance unavailable for this shipment."}</span>
                        </div>
                      );
                    }
                    if (eta) {
                      return (
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1 font-mono text-[9px]">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500 uppercase tracking-wider">{lang === "ar" ? "المسافة" : lang === "tr" ? "Mesafe" : "Distance"}</span>
                            <span className="font-extrabold text-slate-100">{eta.distance?.text || "—"}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500 uppercase tracking-wider">{lang === "ar" ? "المدة" : lang === "tr" ? "Süre" : "Duration"}</span>
                            <span className="font-extrabold text-slate-100">{eta.durationInTraffic?.text || eta.duration?.text || "—"}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-emerald-500 uppercase tracking-wider font-extrabold">ETA</span>
                            <span className="text-emerald-400 font-extrabold">{eta.estimatedArrivalTime ? new Date(eta.estimatedArrivalTime).toLocaleString() : "—"}</span>
                          </div>
                          <div className="flex justify-between items-center text-[7.5px] pt-0.5">
                            <span className="text-slate-600">{eta.status === "OK" ? (lang === "ar" ? "من غوغل ماب" : lang === "tr" ? "Google Haritalar" : "Google Maps") : (lang === "ar" ? "تقدير حسابي" : lang === "tr" ? "Tahmini hesap" : "Estimated")}</span>
                            <button onClick={() => handleCalculateEta(selectedShipment)} className="text-orange-400 underline font-bold cursor-pointer">
                              {lang === "ar" ? "تحديث" : lang === "tr" ? "Yenile" : "Recalculate"}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    // idle
                    return (
                      <button
                        onClick={() => handleCalculateEta(selectedShipment)}
                        className="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-sans text-[11px] font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{calcLabel}</span>
                      </button>
                    );
                  })()}

                  <button
                    onClick={() => handleAutoFocusRoute(selectedShipment)}
                    className="w-full py-1.5 px-3 bg-orange-600 hover:bg-orange-500 text-white font-sans text-[11px] font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                  >
                    <Expand className="w-3.5 h-3.5 animate-pulse" />
                    <span>
                      {lang === "ar"
                        ? "ملاءمة المسار بالكامل"
                        : lang === "tr"
                          ? "Rotayı Odakla"
                          : "Auto-Focus Route"}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* In-map footer stats — real counts, honest live-signal label. */}
            <div className="text-[10px] text-slate-400 font-mono flex flex-col sm:flex-row items-center justify-between shrink-0 bg-slate-900/60 p-3 rounded-xl border border-slate-900 gap-1 mt-1">
              <span>{t.operationalStats}: <strong>{inTransitShipments.length} {t.totalShipments}</strong></span>
              <span className="flex items-center gap-2">
                <span className="text-emerald-400">{t.trackLive}: <strong className="tabular-nums">{trackingCounts.live_gps}</strong></span>
                <span className={`flex items-center gap-1 ${anyLiveGps ? "text-emerald-400" : "text-slate-500"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${anyLiveGps ? "bg-emerald-500 animate-ping" : "bg-slate-600"}`}></span>
                  {anyLiveGps ? t.gpsAcquired : t.simulatedGps}
                </span>
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
