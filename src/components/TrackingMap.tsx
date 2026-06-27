import React, { useState, useEffect, useRef } from "react";
import { 
  Shipment, 
  Language,
  Driver,
  TRUCK_TYPES
} from "../types";
import { 
  Map as MapIcon, 
  Truck, 
  User, 
  Navigation, 
  Compass, 
  Info, 
  Search, 
  AlertTriangle, 
  X, 
  Activity, 
  MapPin, 
  ChevronRight,
  Globe,
  Filter,
  Check,
  Expand,
  Minimize,
  Plus,
  Minus
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

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
  getShipmentLocation: (s: Shipment) => { lat: number; lng: number };
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
      bounds.extend({ lat: loc.lat, lng: loc.lng });
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
    liveMap: "Corridor Live Radar tracking",
    inTransitMap: "Active Transits Radar",
    subTitle: "Real-time vector tracking of shipments currently 'In Transit' along the Turkey-Iraq highway corridor.",
    shipmentNum: "Shipment",
    from: "From",
    to: "To",
    status: "Status",
    driver: "Driver",
    noInTransit: "No shipments are currently 'In Transit'. Update a shipment's status to 'In Transit' in the Shipment Registry to track its live geolocation on this radar.",
    truckPlate: "Truck Plate",
    customer: "Customer",
    cargo: "Cargo",
    activeTracking: "Active Tracing",
    viewAllTransit: "Reset View",
    searchPlaceholder: "Filter by customer, number or city...",
    currentGeoPos: "Simulated position",
    viewOnMap: "Locate on Grid",
    engineSelector: "Operational Tracking Interface",
    engineVector: "ETIR Interactive Vector Radar Grid (Always Live)",
    vectorCorridorTitle: "Turkey-to-Iraq Corridor Live Vector Grid",
    borderCrossing: "Turkey - Iraq Border Crossing (Ibrahim Khalil)",
    truckFilterTitle: "Filter Truck Types",
    allTypes: "All Types",
    unspecifiedType: "Others / Unassigned",
    bestFitZoom: "Auto-Center Focus",
    lastUpdated: "Telemetry Feed Active",
    gpsAcquired: "GPS Signal Acquired",
    simulatedGps: "Simulated Dead-Reckoning",
    operationalStats: "Transit Stats Overview",
    totalShipments: "Active Transits",
    totalDistance: "Estimated Route Completion",
    weatherSim: "Corridor Weather Check"
  },
  tr: {
    liveMap: "Koridor Canlı İzleme Radarı",
    inTransitMap: "Aktif Sevkıyat Radarı",
    subTitle: "Türkiye-Irak karayolu koridoru üzerinde 'Yolda' olan aktif sevkiyatların gerçek zamanlı vektör takibi.",
    shipmentNum: "Sevkiyat",
    from: "Yükleme",
    to: "Teslimat",
    status: "Durum",
    driver: "Sürücü",
    noInTransit: "Şu anda 'Yolda' olan aktif bir sevkiyat bulunmamaktadır. Haritada canlı izlemek için Sevkiyat Kaydı kısmında durumlarını 'Yolda' (In Transit) olarak güncelleyin.",
    truckPlate: "Plaka",
    customer: "Alıcı / Müşteri",
    cargo: "Kargo Açıklaması",
    activeTracking: "Aktif Takip",
    viewAllTransit: "Görünümü Sıfırla",
    searchPlaceholder: "Müşteri adı, no veya şehre göre filtrele...",
    currentGeoPos: "Simüle edilen konum",
    viewOnMap: "Izgarada Göster",
    engineSelector: "Operasyonel Takip Arayüzü",
    engineVector: "ETIR Etkileşimli Vektör Radar Izgarası (Kesintisiz Canlı)",
    vectorCorridorTitle: "Türkiye-Irak Lojistik Koridoru Canlı Vektör Radarı",
    borderCrossing: "Türkiye - Irak Sınır Kapısı (Habur / İbrahim Halil)",
    truckFilterTitle: "Araç Kalemi Filtresi",
    allTypes: "Tüm Tipler",
    unspecifiedType: "Diğer / Tanımsız",
    bestFitZoom: "Hızlı Odaklan",
    lastUpdated: "Telemetri Akışı Aktif",
    gpsAcquired: "GPS Sinyali Alındı",
    simulatedGps: "Simüle Edilmiş Rota Verisi",
    operationalStats: "Operasyonel İstatistikler",
    totalShipments: "Aktif Araç",
    totalDistance: "Tahmini Rota Durumu",
    weatherSim: "Hava Durumu Bilgisi"
  },
  ar: {
    liveMap: "بث رادار تتبع المسار المباشر",
    inTransitMap: "رادار الشحنات النشطة",
    subTitle: "تتبع نشط فوري للشحنات 'قيد الانتقال' عبر مسار النقل البري الدولي بين تركيا والعراق.",
    shipmentNum: "شحنة",
    from: "من موقع الشحن",
    to: "إلى الوجهة",
    status: "الحالة",
    driver: "السائق",
    noInTransit: "لا توجد شحنات 'قيد الانتقال' حالياً. قم بتغيير حالة الشحنة إلى 'قيد الانتقال' في سجل الشحنات لمشاهدة موقعها المباشر على الرادار.",
    truckPlate: "رقم الشاحنة",
    customer: "العميل / الشركة",
    cargo: "وصف الحمولة",
    activeTracking: "تتبع نشط",
    viewAllTransit: "إعادة ضبط",
    searchPlaceholder: "البحث بالعميل، الرقم أو المدينة...",
    currentGeoPos: "موقع تقديري محاكى",
    viewOnMap: "تحديد على الشبكة",
    engineSelector: "واجهة التتبع والعمليات",
    engineVector: "شبكة رادار رصد ومراقبة ETIR التفاعلية (مستمر دائماً)",
    vectorCorridorTitle: "البث التفاعلي لمسار النقل بين تركيا والعراق",
    borderCrossing: "الحدود الدولية - منفذ إبراهيم الخليل الدولي",
    truckFilterTitle: "تصنيف الشاحنات",
    allTypes: "كل الأنواع",
    unspecifiedType: "أخرى / غير محدد",
    bestFitZoom: "أوتو-فوكس للشبكة",
    lastUpdated: "موجز البث الفوري نشط",
    gpsAcquired: "إشارة الـ GPS نشطة",
    simulatedGps: "عبر نظام الملاحة التقديري",
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
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(true);
  const [mapViewMode, setMapViewMode] = useState<'vector' | 'google_map'>('google_map');
  const [googleMapLoading, setGoogleMapLoading] = useState<boolean>(true);
  const [mapsAuthError, setMapsAuthError] = useState<boolean>(() => {
    return Boolean((window as any).googleMapsAuthFailed);
  });

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

  // Dynamically filter shipments based on state
  const inTransitShipments = shipments.filter(s => {
    if (mapStatusFilter === "in_transit") {
      return s.status === "In Transit";
    }
    if (mapStatusFilter === "active") {
      // Show operational segments (not completed/closed/new)
      return s.status !== "Closed" && s.status !== "Delivered";
    }
    return true; // "all" shows all statuses
  });

  // Simple state count for a ticking timer that slightly alters the position of transit trucks
  const [ticker, setTicker] = useState<number>(0);

  // Auto-ticks every 4 seconds to animate simulated truck crawling
  useEffect(() => {
    const interval = setInterval(() => {
      setTicker(prev => prev + 1);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Filter by dynamic search query AND active truck filter selections
  const filteredTransit = inTransitShipments.filter(s => {
    // 1. Truck Type Filter
    const driver = localDrivers.find(d => d.id === s.assignedDriverId);
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
  });

  // Calculate the count of active trucks matching each type
  const getTruckTypeCount = (typeId: string): number => {
    return inTransitShipments.filter(s => {
      const driver = localDrivers.find(d => d.id === s.assignedDriverId);
      const tType = driver?.truckType || "unspecified";
      return tType === typeId;
    }).length;
  };

  const getShipmentGpsState = (s: Shipment): "live_gps" | "dead_reckoning" | "static" => {
    const driver = localDrivers.find(d => d.id === s.assignedDriverId);
    if (
      driver &&
      typeof driver.latitude === "number" &&
      typeof driver.longitude === "number" &&
      driver.latitude !== 0 &&
      driver.longitude !== 0
    ) {
      return "live_gps";
    }
    return s.status === "In Transit" ? "dead_reckoning" : "static";
  };

  // Get vector graphical SVG coordinates and real GPS coordinates
  const getShipmentVectorLocation = (s: Shipment): { x: number; y: number; percentage: number; isActualGps?: boolean; lat: number; lng: number } => {
    const driver = localDrivers.find(d => d.id === s.assignedDriverId);
    if (driver && typeof driver.latitude === 'number' && typeof driver.longitude === 'number' && driver.latitude !== 0 && driver.longitude !== 0) {
      // Map Lat/Lng to Vector 850x550 coordinate space
      const latMin = 30.0;
      const latMax = 42.0;
      const lngMin = 28.0;
      const lngMax = 48.0;

      const pctX = (driver.longitude - lngMin) / (lngMax - lngMin);
      const x = 100 + pctX * 625;

      const pctY = (driver.latitude - latMin) / (latMax - latMin);
      const y = 465 - pctY * 335;

      return {
        x: Math.min(800, Math.max(50, x)),
        y: Math.min(500, Math.max(50, y)),
        percentage: 0.5,
        isActualGps: true,
        lat: driver.latitude,
        lng: driver.longitude
      };
    }

    const startLoc = CITY_COORDINATES[s.loadingCity.toLowerCase().trim()] || CITY_COORDINATES["istanbul"];
    const endLoc = CITY_COORDINATES[s.deliveryCity.toLowerCase().trim()] || CITY_COORDINATES["baghdad"];

    const startVec = findVectorCity(s.loadingCity);
    const endVec = findVectorCity(s.deliveryCity);

    // If shipment is not in transit yet, it is still at loadingCity
    if (["New", "Assigned", "Accepted", "Loading", "Loaded"].includes(s.status)) {
      return { 
        x: startVec.x, 
        y: startVec.y, 
        percentage: 0, 
        isActualGps: false,
        lat: startLoc.lat,
        lng: startLoc.lng
      };
    }

    // If shipment has arrived or is delivered, it is at deliveryCity
    if (["Arrived", "Delivered", "Closed"].includes(s.status)) {
      return { 
        x: endVec.x, 
        y: endVec.y, 
        percentage: 1, 
        isActualGps: false,
        lat: endLoc.lat,
        lng: endLoc.lng
      };
    }

    // Otherwise, simulate a position on the highway
    let hash = 0;
    for (let i = 0; i < s.id.length; i++) {
      hash += s.id.charCodeAt(i);
    }
    const basePct = 0.15 + ((hash % 60) / 100); 

    const drift = ((ticker + (hash % 10)) % 100) / 1200; 
    const percentage = Math.min(0.92, Math.max(0.08, basePct + drift));

    const x = startVec.x + (endVec.x - startVec.x) * percentage;
    const y = startVec.y + (endVec.y - startVec.y) * percentage;

    const lat = startLoc.lat + (endLoc.lat - startLoc.lat) * percentage;
    const lng = startLoc.lng + (endLoc.lng - startLoc.lng) * percentage;

    return { 
      x, 
      y, 
      percentage, 
      isActualGps: false,
      lat,
      lng
    };
  };

  const anyLiveGps = filteredTransit.some(s => getShipmentGpsState(s) === "live_gps");

  const getNearestCity = (x: number, y: number): string => {
    let nearestCityName = "Transit Route";
    let minDistance = Infinity;
    for (const [key, val] of Object.entries(VECTOR_CITIES)) {
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
    setViewScale(1);
    setViewPan({ x: 0, y: 0 });
  };

  const handleSelectShipment = (s: Shipment) => {
    setSelectedShipment(s);
    const loc = getShipmentVectorLocation(s);
    
    // Zoom in on target truck
    setViewScale(1.4);
    // Center viewport (850x550) on coordinate
    setViewPan({
      x: (425 - loc.x * 1.4),
      y: (275 - loc.y * 1.4)
    });
  };

  const handleAutoFocusRoute = (s: Shipment) => {
    const start = findVectorCity(s.loadingCity);
    const end = findVectorCity(s.deliveryCity);
    const loc = getShipmentVectorLocation(s);

    const minX = Math.min(start.x, end.x, loc.x);
    const maxX = Math.max(start.x, end.x, loc.x);
    const minY = Math.min(start.y, end.y, loc.y);
    const maxY = Math.max(start.y, end.y, loc.y);

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
    <div className="space-y-4">
      {/* ⚠️ HIGH-DENSITY RADAR OVERVIEW DECK */}
      <div className="bg-slate-900 border border-slate-800 text-white p-4 rounded-2xl shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-orange-500/10 text-orange-500 rounded-xl border border-orange-500/20 shrink-0">
            <Compass className="w-5 h-5 animate-spin" style={{ animationDuration: '10s' }} />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-100">{t.engineSelector}</h3>
            <p className="text-[11px] text-orange-400 font-medium flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
              {mapViewMode === 'vector' 
                ? t.engineVector 
                : (lang === 'tr' ? "Canlı Google Harita Modu Aktif" : lang === 'ar' ? "تتبع غوغل ماب المباشر نشط" : "Live Google Maps GIS Tracking Active")}
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
              📍 {lang === 'tr' ? "Canlı Google Harita" : lang === 'ar' ? "غوغل ماب مباشر" : "Live Google Map"}
            </button>
          </div>

          <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-[10px] font-mono text-slate-400 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span>{t.lastUpdated}</span>
          </div>
        </div>
      </div>

      {/* THREE LANGUAGE ACTION DRAWER */}
      <div className="bg-amber-50/70 border border-amber-100 rounded-2xl p-4 text-xs text-amber-950 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        <div className="md:col-span-10 space-y-1">
          <h4 className="font-extrabold flex items-center gap-1.5 text-amber-900">
            <Info className="w-4 h-4 text-orange-600" />
            <span>{t.operationalStats}</span>
          </h4>
          <div className="text-amber-800 leading-relaxed text-[11px] space-y-1">
            <p>
              Integrated transit telemetry monitoring for the Turkey-to-Iraq highway network. Auto-center, filter parameters, and interactive nodes are calibrated live with no third-party keys required.
            </p>
          </div>
        </div>
        <div className="md:col-span-2 text-right">
          <button
            onClick={handleShowAll}
            className="w-full text-center inline-flex justify-center items-center gap-1 bg-amber-900 hover:bg-amber-950 text-white px-3 py-2 rounded-xl font-black tracking-tight text-[11px] shadow-sm transition-all uppercase cursor-pointer"
          >
            <span>{t.viewAllTransit}</span>
          </button>
        </div>
      </div>

      {/* MAIN CONTAINER LAYOUT */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[620px] max-w-full">
        
        {/* LEFT SIDEBAR: ACTIVE TRACKS STATUS CARD */}
        <div className="lg:col-span-4 border-r border-slate-200 flex flex-col bg-slate-50/50">
          
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

            {/* Go to my current location button */}
            <button 
              onClick={handleGoToMyLocation}
              className="w-full mt-2 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-extrabold text-[10px] rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase font-mono"
              title={lang === "ar" ? "الذهاب إلى موقعي الحالي" : lang === "tr" ? "Koordinatlarıma Git" : "Go to my current location"}
            >
              <MapPin className="w-3.5 h-3.5 text-orange-600 animate-pulse" />
              <span>{lang === "ar" ? "موقعي الحالي" : lang === "tr" ? "Mevcut Konumum" : "My Current Location"}</span>
            </button>
          </div>

          {/* Sidebar Body: Shipment Cards List */}
          <div className="flex-1 overflow-y-auto h-[480px] p-2 space-y-2">
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
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 relative overflow-hidden ${
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

                    <div className="text-[10px] text-slate-500 font-medium grid grid-cols-2 gap-1 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                      <div>
                        <span className="block text-[8px] text-slate-400 uppercase font-bold">{t.from}</span>
                        <span className="truncate block font-semibold text-slate-700">{s.loadingCity}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] text-slate-400 uppercase font-bold">{t.to}</span>
                        <span className="truncate block font-semibold text-slate-700">{s.deliveryCity}</span>
                      </div>
                    </div>

                    {/* Highly interactive Dynamic Location Coordinate Badge */}
                    {(() => {
                      const loc = getShipmentVectorLocation(s);
                      const city = getNearestCity(loc.x, loc.y);
                      return (
                        <div className="text-[10.5px] bg-emerald-50/80 text-emerald-800 font-mono p-1.5 rounded-xl border border-emerald-100 flex items-center justify-between gap-1.5">
                          <span className="flex items-center gap-1 font-extrabold truncate">
                            <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{city}</span>
                          </span>
                          <span className="text-emerald-700 text-[8.5px] font-black shrink-0">
                            {loc.lat.toFixed(4)}°, {loc.lng.toFixed(4)}°
                          </span>
                        </div>
                      );
                    })()}

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                      <p className="flex items-center gap-1 truncate max-w-[160px]">
                        <Truck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="font-semibold text-slate-600 truncate">{s.assignedDriverName || "Unknown"}</span>
                      </p>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectShipment(s);
                        }}
                        className="text-orange-600 hover:text-orange-800 font-bold transition-all text-[9.5px] uppercase cursor-pointer"
                      >
                        {t.viewOnMap} ➔
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT CONTAINER: PRISTINE LIVE VECTOR RADAR GRACEFULLY HANDLING INTERPOLATED POSITIONS WITH TRANSITIONS */}
        <div className="lg:col-span-8 relative h-[620px] w-full min-w-[200px] bg-slate-950 flex flex-col justify-between overflow-hidden">
          
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

              {/* Collapsible Legend Panel inside the map frame */}
              <div className="absolute bottom-4 left-4 z-20 font-mono text-[10px] select-none text-left flex flex-col pointer-events-auto transition-all duration-300">
                {isLegendOpen ? (
                  <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 w-[230px] rounded-xl shadow-2xl p-3 text-white space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <div className="flex items-center gap-1.5 font-sans font-bold text-orange-400">
                        <Compass className="w-3.5 h-3.5 text-orange-500 animate-spin" style={{ animationDuration: "6s" }} />
                        <span>{lang === "ar" ? "رموز الخريطة" : lang === "tr" ? "Harita Göstergeleri" : "Map Legend"}</span>
                      </div>
                      <button 
                        onClick={() => setIsLegendOpen(false)}
                        className="text-slate-400 hover:text-white transition-all cursor-pointer p-0.5 hover:bg-slate-800/85 rounded"
                        title="Collapse"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Status Sections */}
                    <div className="space-y-1.5">
                      <h4 className="text-[8.5px] uppercase tracking-wider font-extrabold text-slate-400 font-mono">
                        {lang === "ar" ? "مراحل الشحنات" : lang === "tr" ? "Sevkiyat Aşamaları" : "Shipment Milestones"}
                      </h4>
                      <div className="space-y-1 text-[9px]">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 border border-slate-950 shadow-xs shrink-0 animate-pulse"></span>
                          <span className="text-slate-300 font-sans">
                            {lang === "ar" ? "قيد الانتقال والعبور" : lang === "tr" ? "Yolda (Canlı Takip)" : "En-Route (Active GPS)"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-slate-950 shadow-xs shrink-0"></span>
                          <span className="text-slate-300 font-sans">
                            {lang === "ar" ? "وصلت / تم التسليم" : lang === "tr" ? "Ar vardı / Teslim Edildi" : "Arrived / Delivered"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-500 border border-slate-950 shadow-xs shrink-0"></span>
                          <span className="text-slate-300 font-sans">
                            {lang === "ar" ? "معينة / قيد التحميل" : lang === "tr" ? "Atandı / Yükleniyor" : "Loading / Assigned / Setup"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Truck classification identifiers */}
                    <div className="space-y-1.5 border-t border-slate-800/60 pt-2">
                      <h4 className="text-[8.5px] uppercase tracking-wider font-extrabold text-slate-400 font-mono">
                        {lang === "ar" ? "أنواع الشاحنات والتغطية" : lang === "tr" ? "Araç Sınıf Simgeleri" : "Truck Categorization"}
                      </h4>
                      <div className="grid grid-cols-1 gap-1 text-[9px] font-sans">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0 select-none">
                            ❄️
                          </span>
                          <span className="text-slate-300 truncate">
                            {lang === "ar" ? "مبردة (Reefer)" : lang === "tr" ? "Frigorifik (Frigo)" : "Refrigerated (Reefer)"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 select-none">
                            ⚓
                          </span>
                          <span className="text-slate-300 truncate">
                            {lang === "ar" ? "Tenteli" : lang === "tr" ? "Tenteli Dorse" : "Curtainsider / Tilt"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0 select-none">
                            🛹
                          </span>
                          <span className="text-slate-300 truncate">
                            {lang === "ar" ? "مسطحة" : lang === "tr" ? "Açık Kasa (Sal)" : "Flatbed Platform"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 select-none">
                            🏗️
                          </span>
                          <span className="text-slate-300 truncate">
                            {lang === "ar" ? "منخفضة للحمولات" : lang === "tr" ? "Alçak Şasi (Lowbed)" : "Lowboy (Heavy Haul)"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 select-none">
                            📦
                          </span>
                          <span className="text-slate-300 truncate">
                            {lang === "ar" ? "صندوق مغلق" : lang === "tr" ? "Kapalı Kasa" : "Box / Dry Van"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 select-none">
                            🧪
                          </span>
                          <span className="text-slate-300 truncate">
                            {lang === "ar" ? "ناقلة سوائل" : lang === "tr" ? "Tanker" : "Liquid Tanker"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-800/60 pt-1 flex items-center justify-between text-[7.5px] text-slate-500 font-mono uppercase">
                      <span>RADAR GRID</span>
                      <span>ACTIVE</span>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={() => setIsLegendOpen(true)}
                    className="bg-slate-900/95 backdrop-blur-md border border-slate-800 hover:border-orange-500/40 text-white font-sans text-[9px] font-bold py-1.5 px-2.5 rounded-lg shadow-xl flex items-center gap-1.5 cursor-pointer z-20 group transition-all"
                  >
                    <Compass className="w-3.5 h-3.5 text-orange-500 group-hover:animate-spin" />
                    <span>{lang === "ar" ? "عرض الرموز" : lang === "tr" ? "Göstergeleri Göster" : "Show Legend"}</span>
                  </button>
                )}
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

                    {/* Moving Trucks on SVG Corridor Grid - Animated Smoothly using transform with CSS Transitions */}
                    {filteredTransit.map(s => {
                      const activeLoc = getShipmentVectorLocation(s);
                      const isSelected = selectedShipment?.id === s.id;
                      const gpsState = getShipmentGpsState(s);

                      return (
                        <g
                          key={s.id}
                          className="cursor-pointer group select-none"
                          onClick={() => handleSelectShipment(s)}
                          // Beautiful CSS coordinate transition applied directly to translation matrix
                          style={{
                            transform: `translate(${activeLoc.x}px, ${activeLoc.y}px)`,
                            transition: "transform 1.8s cubic-bezier(0.25, 1, 0.5, 1)",
                          }}
                        >
                          {/* Shimmer pulse rings on the truck – colour by GPS state */}
                          <circle
                            r={isSelected ? "22" : "15"}
                            fill={
                              isSelected ? "rgba(249,115,22,0.28)"
                              : gpsState === "live_gps" ? "rgba(34,197,94,0.18)"
                              : gpsState === "dead_reckoning" ? "rgba(249,115,22,0.12)"
                              : "rgba(100,116,139,0.12)"
                            }
                            stroke={
                              isSelected ? "#ea580c"
                              : gpsState === "live_gps" ? "#22c55e"
                              : gpsState === "dead_reckoning" ? "rgba(249,115,22,0.3)"
                              : "#475569"
                            }
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
                              {lang === 'tr' ? "Google Harita Başlatılıyor" : lang === 'ar' ? "جاري تهيئة الخريطة..." : "Initializing Live Google Map"}
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
                          const isSelected = selectedShipment?.id === s.id;
                          const truckCoords = { lat: activeLoc.lat, lng: activeLoc.lng };
                          const gpsState = getShipmentGpsState(s);

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
                                    isSelected           ? "bg-orange-600 border-white"
                                    : gpsState === "live_gps"       ? "bg-emerald-700 border-emerald-400"
                                    : gpsState === "dead_reckoning" ? "bg-slate-900 border-orange-500"
                                    :                                  "bg-slate-800 border-slate-600"
                                  }`}
                                >
                                  <Truck className="w-4 h-4 text-white" />
                                </div>

                                {!isSelected && (
                                  <span className={`text-[7px] font-mono font-black px-1 rounded mt-0.5 ${
                                    gpsState === "live_gps"       ? "text-emerald-400"
                                    : gpsState === "dead_reckoning" ? "text-orange-400"
                                    :                               "text-slate-500"
                                  }`}>
                                    {gpsState === "live_gps" ? "● GPS" : gpsState === "dead_reckoning" ? "◌ EST" : "◯"}
                                  </span>
                                )}
                              </div>
                            </AdvancedMarker>
                          );
                        })}
                      </Map>
                    </APIProvider>
                  ) : (
                    /* Elegant Google Map API Instructions if keys aren't found */
                    <div className="w-full h-full flex flex-col justify-center items-center text-center p-6 space-y-4">
                      <div className="w-12 h-12 rounded-full bg-orange-950/40 border border-orange-800 flex items-center justify-center shrink-0">
                        <MapPin className="w-6 h-6 text-orange-400 animate-bounce" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-bold text-sm text-slate-100">Google Maps Platform Key Required</h4>
                        <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-normal">
                          Provide your Google Cloud API key to trace active highway corridor units with high-definition GIS mapping.
                        </p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-left text-[11px]/normal text-slate-400 space-y-1.5 max-w-sm w-full font-mono">
                        <p className="text-[10px] font-bold text-slate-200 uppercase tracking-wider">Setup Instructions:</p>
                        <p>1. Open <strong className="text-white">Settings</strong> (⚙️ gear icon, top-right) in AI Studio.</p>
                        <p>2. Choose <strong className="text-white">Secrets</strong>.</p>
                        <p>3. Create/Edit <strong className="text-orange-400">GOOGLE_MAPS_PLATFORM_KEY</strong> and paste your key.</p>
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
                      onClick={() => setSelectedShipment(null)}
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
                      const city = getNearestCity(loc.x, loc.y);
                      const gpsState = getShipmentGpsState(selectedShipment);
                      return (
                        <>
                          <div className="flex justify-between items-center border-t border-slate-800 pt-1 mt-1 font-extrabold">
                            <span className="text-emerald-500 uppercase tracking-wider">CURRENT CITY:</span>
                            <span className="text-emerald-400">{city}</span>
                          </div>
                          <div className="flex justify-between items-center text-[7.5px] text-slate-400">
                            <span>COORDINATES:</span>
                            <span>{loc.lat.toFixed(5)}°N, {loc.lng.toFixed(5)}°E</span>
                          </div>
                          <div className="flex justify-between items-center text-[7.5px] font-extrabold">
                            <span className="text-slate-500 uppercase">GPS MODE:</span>
                            <span className={
                              gpsState === "live_gps"       ? "text-emerald-400"
                              : gpsState === "dead_reckoning" ? "text-orange-400"
                              :                               "text-slate-500"
                            }>
                              {gpsState === "live_gps"       ? "● LIVE GPS"
                              : gpsState === "dead_reckoning" ? "◌ DEAD RECKONING"
                              :                               "◯ STATIC"}
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

            {/* Simulated Live Grid Stats */}
            <div className="text-[10px] text-slate-400 font-mono flex flex-col sm:flex-row items-center justify-between shrink-0 bg-slate-900/60 p-3 rounded-xl border border-slate-900 gap-1 mt-1">
              <span>{t.operationalStats}: <strong>{inTransitShipments.length} {t.totalShipments}</strong></span>
              <span className={`flex items-center gap-1 ${anyLiveGps ? "text-emerald-400" : "text-orange-400"}`}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block animate-ping ${anyLiveGps ? "bg-emerald-500" : "bg-orange-500"}`}></span>
                {anyLiveGps ? t.gpsAcquired : t.simulatedGps}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
