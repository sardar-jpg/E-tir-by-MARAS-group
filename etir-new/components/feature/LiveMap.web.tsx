import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Shipment } from '@/types';
import { Colors, BorderRadius, FontSize, Spacing, Shadow } from '@/constants/theme';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface RouteHistoryPoint {
  lat: number;
  lng: number;
  recordedAt?: string;
}

export interface LiveMapProps {
  shipments: Shipment[];
  focusShipment?: Shipment | null;
  height?: number;
  showAllShipments?: boolean;
  onShipmentPress?: (shipment: Shipment) => void;
  routeHistory?: RouteHistoryPoint[];
}

const STATUS_COLORS: Record<string, string> = {
  'In Transit': Colors.primary,
  'Customs Clearance': Colors.warning,
  'Customs Pending': Colors.warning,
  'Dispatched': Colors.info,
  'Loaded': Colors.textSecondary,
  'Arrived': Colors.success,
  'Detained': Colors.danger,
};

const STATUS_FILTER_OPTIONS = [
  { key: 'all', label: 'All', color: Colors.textPrimary },
  { key: 'In Transit', label: 'In Transit', color: Colors.primary },
  { key: 'Customs Clearance', label: 'Customs', color: Colors.warning },
  { key: 'Arrived', label: 'Arrived', color: Colors.success },
  { key: 'Detained', label: 'Detained', color: Colors.danger },
];

const ROUTE_PATH: [number, number][] = [
  [41.0082, 28.9784], [39.9334, 32.8597], [37.9744, 40.2258],
  [37.5186, 42.4475], [37.2137, 42.2010], [36.9010, 42.6830],
  [36.3417, 43.1315], [33.3152, 44.3661],
];

function hasCoords(s: Shipment): s is Shipment & { lat: number; lng: number } {
  return typeof s.lat === 'number' && typeof s.lng === 'number';
}

// ── Leaflet map renderer ────────────────────────────────────────────────────
function LeafletMap({
  shipments,
  filteredShipments,
  focusShipment,
  selectedShipment,
  onMarkerPress,
  fullScreen,
  routeHistory,
}: {
  shipments: Shipment[];
  filteredShipments: Shipment[];
  focusShipment?: Shipment | null;
  selectedShipment: Shipment | null;
  onMarkerPress: (s: Shipment) => void;
  fullScreen: boolean;
  routeHistory?: RouteHistoryPoint[];
}) {
  const mapContainerId = useRef(`leaflet-map-${Math.random().toString(36).slice(2)}`).current;
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const historyLayersRef = useRef<any[]>([]);

  const displayShipments = focusShipment ? [focusShipment] : filteredShipments;
  const tracked = displayShipments.filter(hasCoords);

  const defaultCenter: [number, number] = tracked.length > 0
    ? [
        tracked.reduce((s, x) => s + x.lat, 0) / tracked.length,
        tracked.reduce((s, x) => s + x.lng, 0) / tracked.length,
      ]
    : [37.5, 42.0];

  useEffect(() => {
    let map: any = null;
    let L: any = null;

    const init = async () => {
      if (typeof window === 'undefined') return;

      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (!(window as any).L) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => resolve();
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      L = (window as any).L;
      if (!L) return;

      const container = document.getElementById(mapContainerId);
      if (!container) return;

      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      map = L.map(container, {
        center: defaultCenter,
        zoom: tracked.length > 0 ? 6 : 5,
        zoomControl: fullScreen,
        attributionControl: false,
      });
      mapInstance.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd',
      }).addTo(map);

      L.polyline(ROUTE_PATH, {
        color: Colors.primary, weight: 2.5, opacity: 0.45, dashArray: '8 5',
      }).addTo(map);

      buildMarkers(L, map, tracked, selectedShipment, onMarkerPress);
      buildHistoryTrail(L, map, routeHistory ?? []);

      if (tracked.length > 1) {
        const bounds = L.latLngBounds(tracked.map(s => [s.lat, s.lng]));
        map.fitBounds(bounds.pad(0.3));
      }

      injectPopupStyles();
    };

    init();
    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, []);

  // Update markers when list changes
  useEffect(() => {
    const L = (window as any).L;
    const map = mapInstance.current;
    if (!L || !map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    buildMarkers(L, map, tracked, selectedShipment, onMarkerPress);
  }, [shipments, focusShipment, filteredShipments, selectedShipment]);

  // Update history trail when data changes
  useEffect(() => {
    const L = (window as any).L;
    const map = mapInstance.current;
    if (!L || !map) return;
    historyLayersRef.current.forEach(l => l.remove());
    historyLayersRef.current = [];
    buildHistoryTrail(L, map, routeHistory ?? []);
  }, [routeHistory]);

  // Pan to focused shipment
  useEffect(() => {
    if (!focusShipment || !hasCoords(focusShipment) || !mapInstance.current) return;
    mapInstance.current.flyTo([focusShipment.lat, focusShipment.lng], 7, { animate: true, duration: 0.8 });
  }, [focusShipment?.id]);

  // Pan to selected shipment
  useEffect(() => {
    if (!selectedShipment || !hasCoords(selectedShipment) || !mapInstance.current) return;
    mapInstance.current.flyTo([selectedShipment.lat, selectedShipment.lng], 7, { animate: true, duration: 0.6 });
  }, [selectedShipment?.id]);

  function buildHistoryTrail(L: any, map: any, points: RouteHistoryPoint[]) {
    if (!points || points.length < 2) return;
    const latlngs: [number, number][] = points.map(p => [p.lat, p.lng]);
    const trail = L.polyline(latlngs, {
      color: Colors.success,
      weight: 3,
      opacity: 0.85,
    }).addTo(map);
    historyLayersRef.current.push(trail);

    // Start marker (green circle)
    if (points[0]) {
      const startIcon = L.divIcon({
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${Colors.success};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const startM = L.marker([points[0].lat, points[0].lng], { icon: startIcon }).addTo(map);
      historyLayersRef.current.push(startM);
    }
  }

  function buildMarkers(L: any, map: any, list: (Shipment & { lat: number; lng: number })[], selected: Shipment | null, onPress: (s: Shipment) => void) {
    list.forEach(s => {
      const color = STATUS_COLORS[s.status] ?? Colors.primary;
      const isSelected = selected?.id === s.id;
      const size = isSelected ? 38 : 32;
      const borderWidth = isSelected ? 3 : 2;

      const iconHtml = `
        <div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:${isSelected ? `drop-shadow(0 0 8px ${color})` : 'none'}">
          <div style="
            width:${size}px;height:${size}px;border-radius:50%;
            border:${borderWidth}px solid ${color};
            background:rgba(10,15,30,0.92);
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 2px 8px rgba(0,0,0,0.5);
            transition:all 0.2s
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${color}">
              <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zm-.5 1.5l1.96 2.5H17V9.5h2.5zM6 18c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm11 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
            </svg>
          </div>
          <div style="
            background:${isSelected ? color : 'rgba(10,15,30,0.88)'};
            border-radius:4px;padding:2px 6px;margin-top:2px;
            border:1px solid ${isSelected ? color : 'rgba(255,255,255,0.12)'};
            font-size:9px;color:${isSelected ? '#000' : '#fff'};font-family:monospace;font-weight:700;white-space:nowrap
          ">${s.tirNumber.split('-').pop()}</div>
        </div>`;

      const icon = L.divIcon({ html: iconHtml, className: '', iconSize: [40, 56], iconAnchor: [20, 56] });

      const marker = L.marker([s.lat, s.lng], { icon })
        .addTo(map)
        .on('click', () => onPress(s))
        .bindPopup(`
          <div style="background:#1C2333;color:#E6EDF3;border-radius:8px;padding:10px 12px;min-width:180px;font-family:sans-serif">
            <div style="font-size:12px;font-weight:700;color:#2F81F7;margin-bottom:6px">${s.tirNumber}</div>
            <div style="font-size:11px;color:#8B949E;margin-bottom:4px">${s.origin} → ${s.destination}</div>
            <div style="margin-bottom:4px">
              <span style="background:${color}22;color:${color};border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">${s.status}</span>
            </div>
            <div style="font-size:10px;color:#8B949E">Driver: ${s.driverName}</div>
            <div style="font-size:10px;color:#8B949E">Plate: ${s.plateNumber}</div>
          </div>
        `, { className: 'leaflet-dark-popup' });

      markersRef.current.push(marker);
    });
  }

  function injectPopupStyles() {
    if (!document.getElementById('leaflet-dark-popup-style')) {
      const style = document.createElement('style');
      style.id = 'leaflet-dark-popup-style';
      style.textContent = `
        .leaflet-dark-popup .leaflet-popup-content-wrapper {
          background:#1C2333;border:1px solid #30363D;border-radius:8px;padding:0;box-shadow:0 4px 16px rgba(0,0,0,0.6);
        }
        .leaflet-dark-popup .leaflet-popup-tip { background:#1C2333; }
        .leaflet-dark-popup .leaflet-popup-content { margin:0; }
        .leaflet-popup-close-button { color:#8B949E !important; }
      `;
      document.head.appendChild(style);
    }
  }

  return (
    <div id={mapContainerId} style={{ width: '100%', height: '100%', borderRadius: BorderRadius.lg }} />
  );
}

// ── Shipment info panel ─────────────────────────────────────────────────────
function ShipmentPanel({ shipment, onClose, onNavigate }: {
  shipment: Shipment; onClose: () => void; onNavigate?: (s: Shipment) => void;
}) {
  const slideAnim = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 200, friction: 20 }).start();
  }, [shipment.id]);

  const statusColor = STATUS_COLORS[shipment.status] ?? Colors.primary;

  return (
    <Animated.View style={[panelStyles.panel, { transform: [{ translateY: slideAnim }] }]}>
      <View style={panelStyles.header}>
        <View style={[panelStyles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={panelStyles.tirNum}>{shipment.tirNumber}</Text>
        <View style={{ flex: 1 }} />
        <StatusBadge status={shipment.status} size="sm" />
        <Pressable style={panelStyles.closeBtn} onPress={onClose} hitSlop={8}>
          <MaterialIcons name="close" size={16} color={Colors.textMuted} />
        </Pressable>
      </View>
      <View style={panelStyles.routeRow}>
        <View style={panelStyles.routePt}>
          <View style={[panelStyles.dot, { backgroundColor: Colors.primary }]} />
          <Text style={panelStyles.routeText} numberOfLines={1}>{shipment.origin}</Text>
        </View>
        <MaterialIcons name="arrow-forward" size={14} color={Colors.textMuted} />
        <View style={panelStyles.routePt}>
          <View style={[panelStyles.dot, { backgroundColor: Colors.success }]} />
          <Text style={panelStyles.routeText} numberOfLines={1}>{shipment.destination}</Text>
        </View>
      </View>
      <View style={panelStyles.metaRow}>
        {[
          { icon: 'person' as const, label: shipment.driverName },
          { icon: 'local-shipping' as const, label: shipment.plateNumber },
          { icon: 'schedule' as const, label: shipment.estimatedArrival || '—' },
        ].map(item => (
          <View key={item.icon} style={panelStyles.metaItem}>
            <MaterialIcons name={item.icon} size={12} color={Colors.textMuted} />
            <Text style={panelStyles.metaText} numberOfLines={1}>{item.label}</Text>
          </View>
        ))}
      </View>
      {onNavigate && (
        <Pressable
          style={({ pressed }) => [panelStyles.viewBtn, pressed && { opacity: 0.8 }]}
          onPress={() => onNavigate(shipment)}
        >
          <MaterialIcons name="open-in-new" size={13} color="#fff" />
          <Text style={panelStyles.viewBtnText}>View Details</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const panelStyles = StyleSheet.create({
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(13,17,23,0.97)',
    borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  tirNum: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary, fontFamily: 'monospace' },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routePt: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  routeText: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500', flex: 1 },
  metaRow: { flexDirection: 'row', gap: Spacing.lg, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  viewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 10,
  },
  viewBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff' },
});

// ── Fleet Statistics Panel ──────────────────────────────────────────────────
function FleetStatsPanel({ shipments, visible, onToggle }: {
  shipments: Shipment[];
  visible: boolean;
  onToggle: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 180,
      friction: 18,
    }).start();
  }, [visible]);

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [220, 0],
  });

  const total = shipments.length;
  const inTransit = shipments.filter(s => s.status === 'In Transit' || s.status === 'Dispatched').length;
  const customsQueue = shipments.filter(s => s.status === 'Customs Clearance' || s.status === 'Customs Pending').length;
  const arrived = shipments.filter(s => s.status === 'Arrived').length;
  const detained = shipments.filter(s => s.status === 'Detained').length;
  const tracked = shipments.filter(hasCoords).length;
  const driversOnRoad = new Set(
    shipments
      .filter(s => s.status === 'In Transit' || s.status === 'Dispatched' || s.status === 'Loaded')
      .map(s => s.driverId)
      .filter(Boolean)
  ).size;

  const statRows = [
    { icon: 'local-shipping' as const, label: 'Total Shipments', value: total, color: Colors.textSecondary },
    { icon: 'route' as const, label: 'On Road', value: inTransit, color: Colors.primary },
    { icon: 'person' as const, label: 'Drivers Active', value: driversOnRoad, color: Colors.info },
    { icon: 'gavel' as const, label: 'Customs Queue', value: customsQueue, color: Colors.warning },
    { icon: 'check-circle' as const, label: 'Arrived', value: arrived, color: Colors.success },
    { icon: 'block' as const, label: 'Detained', value: detained, color: Colors.danger },
    { icon: 'gps-fixed' as const, label: 'GPS Tracked', value: tracked, color: Colors.primary },
  ];

  const utilPct = total > 0 ? Math.round((inTransit / total) * 100) : 0;

  return (
    <View style={statsStyles.wrapper} pointerEvents="box-none">
      {/* Toggle tab */}
      <Pressable
        style={({ pressed }) => [statsStyles.toggleTab, pressed && { opacity: 0.8 }]}
        onPress={onToggle}
      >
        <MaterialIcons
          name={visible ? 'chevron-right' : 'bar-chart'}
          size={18}
          color={Colors.primary}
        />
        {!visible && (
          <Text style={statsStyles.toggleLabel}>Stats</Text>
        )}
      </Pressable>

      {/* Sliding panel */}
      <Animated.View style={[statsStyles.panel, { transform: [{ translateX }] }]}>
        <View style={statsStyles.panelHeader}>
          <MaterialIcons name="bar-chart" size={14} color={Colors.primary} />
          <Text style={statsStyles.panelTitle}>Fleet Stats</Text>
          <Pressable onPress={onToggle} hitSlop={8} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="close" size={15} color={Colors.textMuted} />
          </Pressable>
        </View>

        {statRows.map((row, i) => (
          <View
            key={row.label}
            style={[statsStyles.statRow, i < statRows.length - 1 && statsStyles.statRowBorder]}
          >
            <View style={[statsStyles.statIcon, { backgroundColor: `${row.color}18` }]}>
              <MaterialIcons name={row.icon} size={13} color={row.color} />
            </View>
            <Text style={statsStyles.statLabel} numberOfLines={1}>{row.label}</Text>
            <Text style={[statsStyles.statValue, { color: row.color }]}>{row.value}</Text>
          </View>
        ))}

        {/* Utilisation bar */}
        <View style={statsStyles.utilSection}>
          <View style={statsStyles.utilHeader}>
            <Text style={statsStyles.utilLabel}>Fleet Utilisation</Text>
            <Text style={statsStyles.utilPct}>{utilPct}%</Text>
          </View>
          <View style={statsStyles.utilTrack}>
            <View
              style={[statsStyles.utilFill, { flex: Math.max(0.01, utilPct / 100) }]}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const statsStyles = StyleSheet.create({
  wrapper: {
    position: 'absolute', top: 60, right: 0,
    flexDirection: 'row', alignItems: 'flex-start',
    zIndex: 20,
  },
  toggleTab: {
    backgroundColor: 'rgba(13,17,23,0.92)',
    borderTopLeftRadius: BorderRadius.md, borderBottomLeftRadius: BorderRadius.md,
    borderWidth: 1, borderRightWidth: 0, borderColor: Colors.border,
    paddingVertical: 10, paddingHorizontal: 7,
    alignItems: 'center', gap: 4,
  },
  toggleLabel: {
    fontSize: 9, fontWeight: '700', color: Colors.primary,
    letterSpacing: 0.8, textTransform: 'uppercase',
    writingDirection: 'ltr',
  },
  panel: {
    width: 200,
    backgroundColor: 'rgba(13,17,23,0.96)',
    borderTopLeftRadius: BorderRadius.lg, borderBottomLeftRadius: BorderRadius.lg,
    borderWidth: 1, borderRightWidth: 0, borderColor: Colors.border,
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: 'rgba(47,129,247,0.06)',
  },
  panelTitle: { flex: 1, fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary, letterSpacing: 0.8, textTransform: 'uppercase' },
  statRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: 9,
  },
  statRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  statIcon: {
    width: 24, height: 24, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  statLabel: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary },
  statValue: { fontSize: FontSize.base, fontWeight: '800', minWidth: 24, textAlign: 'right' },
  utilSection: {
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle, gap: 6,
  },
  utilHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  utilLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  utilPct: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary },
  utilTrack: {
    height: 5, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden',
    flexDirection: 'row',
  },
  utilFill: {
    height: 5, backgroundColor: Colors.primary, borderRadius: 3,
  },
});

// ── Full-screen overlay (web uses Modal for full coverage) ──────────────────
function FullScreenMap({ visible, onClose, shipments, onShipmentPress }: {
  visible: boolean; onClose: () => void; shipments: Shipment[]; onShipmentPress?: (s: Shipment) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const [showStats, setShowStats] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.7, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const filteredShipments = shipments.filter(s => {
    if (!hasCoords(s)) return false;
    if (statusFilter === 'all') return true;
    if (statusFilter === 'Customs Clearance') return s.status === 'Customs Clearance' || s.status === 'Customs Pending';
    return s.status === statusFilter;
  });

  const trackedCount = shipments.filter(hasCoords).length;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={fsStyles.root}>
        {/* Header */}
        <View style={fsStyles.header}>
          <View style={fsStyles.headerLeft}>
            <View style={fsStyles.brandIcon}>
              <MaterialIcons name="map" size={14} color={Colors.primary} />
            </View>
            <View>
              <Text style={fsStyles.title}>Fleet Tracker</Text>
              <View style={fsStyles.liveRow}>
                <Animated.View style={[fsStyles.pulseDot, { transform: [{ scale: pulseAnim }] }]} />
                <Text style={fsStyles.liveTxt}>LIVE</Text>
                <Text style={fsStyles.updatedTxt}>· {lastUpdated}</Text>
              </View>
            </View>
          </View>
          <View style={fsStyles.headerRight}>
            <View style={fsStyles.countPill}>
              <MaterialIcons name="local-shipping" size={12} color={Colors.primary} />
              <Text style={fsStyles.countTxt}>{trackedCount} tracked</Text>
            </View>
            <Pressable style={({ pressed }) => [fsStyles.iconBtn, pressed && { opacity: 0.7 }]} onPress={() => setLastUpdated(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}>
              <MaterialIcons name="refresh" size={18} color={Colors.textSecondary} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [fsStyles.iconBtn, showStats && fsStyles.iconBtnActive, pressed && { opacity: 0.7 }]}
              onPress={() => setShowStats(v => !v)}
            >
              <MaterialIcons name="bar-chart" size={18} color={showStats ? Colors.primary : Colors.textSecondary} />
            </Pressable>
            <Pressable style={({ pressed }) => [fsStyles.closeBtn, pressed && { opacity: 0.7 }]} onPress={onClose}>
              <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Filter chips */}
        <View style={fsStyles.filterOuter}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fsStyles.filterContent}>
            {STATUS_FILTER_OPTIONS.map(opt => {
              const isActive = statusFilter === opt.key;
              const count = opt.key === 'all'
                ? shipments.filter(hasCoords).length
                : opt.key === 'Customs Clearance'
                  ? shipments.filter(s => hasCoords(s) && (s.status === 'Customs Clearance' || s.status === 'Customs Pending')).length
                  : shipments.filter(s => hasCoords(s) && s.status === opt.key).length;
              return (
                <Pressable
                  key={opt.key}
                  style={[fsStyles.chip, isActive && { backgroundColor: `${opt.color}22`, borderColor: opt.color }]}
                  onPress={() => { setStatusFilter(opt.key); setSelectedShipment(null); }}
                >
                  <Text style={[fsStyles.chipText, isActive && { color: opt.color }]}>{opt.label}</Text>
                  {count > 0 && (
                    <View style={[fsStyles.chipBadge, isActive && { backgroundColor: opt.color }]}>
                      <Text style={[fsStyles.chipBadgeText, isActive && { color: '#fff' }]}>{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Map + Stats overlay */}
        <View style={{ flex: 1, position: 'relative' }}>
          <LeafletMap
            shipments={shipments}
            filteredShipments={filteredShipments}
            selectedShipment={selectedShipment}
            onMarkerPress={s => setSelectedShipment(prev => prev?.id === s.id ? null : s)}
            fullScreen
          />
          {filteredShipments.length === 0 && (
            <View style={fsStyles.noGpsBox} pointerEvents="none">
              <MaterialIcons name="gps-off" size={20} color={Colors.textMuted} />
              <Text style={fsStyles.noGpsTxt}>No shipments in this category with GPS data</Text>
            </View>
          )}

          {/* Fleet stats side panel */}
          <FleetStatsPanel
            shipments={shipments}
            visible={showStats}
            onToggle={() => setShowStats(v => !v)}
          />
        </View>

        {/* Info panel */}
        {selectedShipment && (
          <ShipmentPanel
            shipment={selectedShipment}
            onClose={() => setSelectedShipment(null)}
            onNavigate={ship => { onClose(); onShipmentPress?.(ship); }}
          />
        )}
      </View>
    </Modal>
  );
}

const fsStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: 48, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  brandIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  pulseDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  liveTxt: { fontSize: 10, color: Colors.success, fontWeight: '700', letterSpacing: 0.8 },
  updatedTxt: { fontSize: 10, color: Colors.textMuted },
  countPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  countTxt: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  iconBtnActive: {
    backgroundColor: Colors.primaryGlow, borderColor: 'rgba(47,129,247,0.4)',
  },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  filterOuter: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, minHeight: 50 },
  filterContent: { paddingHorizontal: Spacing.lg, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border,
  },
  chipText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  chipBadge: { backgroundColor: Colors.border, borderRadius: 8, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  chipBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.textMuted },
  noGpsBox: { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center', gap: 6, flexDirection: 'row', justifyContent: 'center' },
  noGpsTxt: { fontSize: FontSize.sm, color: Colors.textMuted },
});

// ── Main export ─────────────────────────────────────────────────────────────
export function LiveMap({ shipments, focusShipment, height = 260, showAllShipments = true, onShipmentPress, routeHistory }: LiveMapProps) {
  const [fullScreen, setFullScreen] = useState(false);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.8, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const displayShipments = focusShipment
    ? [focusShipment]
    : (showAllShipments ? shipments : shipments.filter(hasCoords));

  const trackedCount = displayShipments.filter(hasCoords).length;

  return (
    <>
      <View style={[styles.container, { height }]}>
        <LeafletMap
          shipments={shipments}
          filteredShipments={displayShipments}
          focusShipment={focusShipment}
          selectedShipment={selectedShipment}
          onMarkerPress={s => setSelectedShipment(prev => prev?.id === s.id ? null : s)}
          fullScreen={false}
          routeHistory={routeHistory}
        />

        {/* Live badge */}
        <View style={styles.liveTag} pointerEvents="none">
          <Animated.View style={[styles.livePulseRing, { transform: [{ scale: pulseAnim }] }]} />
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>

        {/* Count badge */}
        {showAllShipments && !focusShipment && (
          <View style={styles.countTag} pointerEvents="none">
            <MaterialIcons name="local-shipping" size={10} color={Colors.primary} />
            <Text style={styles.countText}>{trackedCount} tracked</Text>
          </View>
        )}

        {/* Expand button */}
        <Pressable
          style={({ pressed }) => [styles.expandBtn, pressed && { opacity: 0.8 }]}
          onPress={() => setFullScreen(true)}
        >
          <MaterialIcons name="fullscreen" size={17} color={Colors.textPrimary} />
        </Pressable>

        {trackedCount === 0 && (
          <View style={styles.noGpsOverlay} pointerEvents="none">
            <MaterialIcons name="gps-off" size={18} color={Colors.textMuted} />
            <Text style={styles.noGpsText}>No live GPS data — route shown</Text>
          </View>
        )}

        {/* Mini info panel */}
        {selectedShipment && (
          <ShipmentPanel
            shipment={selectedShipment}
            onClose={() => setSelectedShipment(null)}
            onNavigate={onShipmentPress}
          />
        )}
      </View>

      <FullScreenMap
        visible={fullScreen}
        onClose={() => setFullScreen(false)}
        shipments={shipments}
        onShipmentPress={ship => {
          setFullScreen(false);
          onShipmentPress?.(ship);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    backgroundColor: '#0d1520',
    position: 'relative',
  },
  liveTag: {
    position: 'absolute', top: 10, left: 10,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', zIndex: 1000,
  },
  livePulseRing: {
    position: 'absolute', width: 7, height: 7, borderRadius: 4,
    backgroundColor: `${Colors.success}55`, left: 10,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  liveText: { fontSize: 10, color: Colors.success, fontWeight: '700', letterSpacing: 1 },
  countTag: {
    position: 'absolute', top: 10, right: 46,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', zIndex: 1000,
  },
  countText: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' },
  expandBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(10,15,30,0.88)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', zIndex: 1000,
  },
  noGpsOverlay: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    flexDirection: 'row', zIndex: 1000,
  },
  noGpsText: { fontSize: FontSize.xs, color: Colors.textMuted },
});
