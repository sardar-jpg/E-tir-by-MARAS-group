import React, { useRef, useEffect, useState, useCallback, Component } from 'react';
import { View, Text, StyleSheet, Platform, Modal, Pressable, ScrollView, Animated } from 'react-native';

// Safely import react-native-maps — crashes if module not linked
let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
let PROVIDER_DEFAULT: any = undefined;
try {
  const RNMaps = require('react-native-maps');
  MapView = RNMaps.default ?? RNMaps.MapView;
  Marker = RNMaps.Marker;
  Polyline = RNMaps.Polyline;
  PROVIDER_DEFAULT = RNMaps.PROVIDER_DEFAULT;
} catch (e) {
  // react-native-maps not available — will show fallback
}
import { MaterialIcons } from '@expo/vector-icons';
import { Shipment } from '@/types';
import { Colors, BorderRadius, Spacing, FontSize, Shadow } from '@/constants/theme';
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

// Well-known route waypoints Turkey → Iraq
const ROUTE_PATH = [
  { latitude: 41.0082, longitude: 28.9784 },
  { latitude: 39.9334, longitude: 32.8597 },
  { latitude: 37.9744, longitude: 40.2258 },
  { latitude: 37.5186, longitude: 42.4475 },
  { latitude: 37.2137, longitude: 42.2010 },
  { latitude: 36.9010, longitude: 42.6830 },
  { latitude: 36.3417, longitude: 43.1315 },
  { latitude: 33.3152, longitude: 44.3661 },
];

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

function hasCoords(s: Shipment): s is Shipment & { lat: number; lng: number } {
  return typeof s.lat === 'number' && typeof s.lng === 'number';
}

interface Region { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number; }

function getInitialRegion(shipments: Shipment[]): Region {
  const withCoords = shipments.filter(hasCoords);
  if (withCoords.length === 0) {
    return { latitude: 37.5, longitude: 42.0, latitudeDelta: 10, longitudeDelta: 10 };
  }
  if (withCoords.length === 1) {
    return { latitude: withCoords[0].lat, longitude: withCoords[0].lng, latitudeDelta: 3, longitudeDelta: 3 };
  }
  const lats = withCoords.map(s => s.lat);
  const lngs = withCoords.map(s => s.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 3),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 3),
  };
}

// ── Map unavailable fallback ────────────────────────────────────────────────
function MapUnavailable() {
  return (
    <View style={mapFallbackStyles.root}>
      <MaterialIcons name="map" size={32} color={Colors.textMuted} />
      <Text style={mapFallbackStyles.title}>Map Unavailable</Text>
      <Text style={mapFallbackStyles.sub}>Maps require a native build.{"\n"}Use the web version or build an APK.</Text>
    </View>
  );
}

const mapFallbackStyles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0d1117', gap: 8,
  },
  title: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textMuted },
  sub: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
});

// ── Error boundary ──────────────────────────────────────────────────────────
class MapErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <MapUnavailable />;
    return this.props.children;
  }
}

function MapContent({
  shipments,
  focusShipment,
  filteredShipments,
  selectedShipment,
  onMarkerPress,
  onMapPress,
  fullScreen,
  routeHistory,
}: {
  shipments: Shipment[];
  focusShipment?: Shipment | null;
  filteredShipments: Shipment[];
  selectedShipment: Shipment | null;
  onMarkerPress: (s: Shipment) => void;
  onMapPress: () => void;
  fullScreen: boolean;
  routeHistory?: RouteHistoryPoint[];
}) {
  const mapRef = useRef<MapView>(null);
  const displayShipments = focusShipment ? [focusShipment] : filteredShipments;
  const initialRegion = getInitialRegion(displayShipments);

  useEffect(() => {
    if (!focusShipment || !hasCoords(focusShipment)) return;
    mapRef.current?.animateToRegion({
      latitude: focusShipment.lat,
      longitude: focusShipment.lng,
      latitudeDelta: 2,
      longitudeDelta: 2,
    }, 600);
  }, [focusShipment?.lat, focusShipment?.lng]);

  useEffect(() => {
    if (!selectedShipment || !hasCoords(selectedShipment)) return;
    mapRef.current?.animateToRegion({
      latitude: selectedShipment.lat,
      longitude: selectedShipment.lng,
      latitudeDelta: 2.5,
      longitudeDelta: 2.5,
    }, 600);
  }, [selectedShipment?.id]);

  if (!MapView) return <MapUnavailable />;

  return (
    <MapErrorBoundary>
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFillObject}
      provider={PROVIDER_DEFAULT}
      initialRegion={initialRegion}
      mapType="standard"
      showsUserLocation={false}
      showsCompass={fullScreen}
      showsScale={false}
      showsTraffic={false}
      pitchEnabled={fullScreen}
      onPress={onMapPress}
    >
      {/* Reference route path */}
      {Polyline && (
        <Polyline
          coordinates={ROUTE_PATH}
          strokeColor={`${Colors.primary}55`}
          strokeWidth={2.5}
          lineDashPattern={[8, 5]}
        />
      )}

      {/* Actual GPS trail from location_history */}
      {Polyline && routeHistory && routeHistory.length > 1 && (
        <Polyline
          coordinates={routeHistory.map(p => ({ latitude: p.lat, longitude: p.lng }))}
          strokeColor={Colors.success}
          strokeWidth={3}
        />
      )}

      {/* Start marker for route history */}
      {Marker && routeHistory && routeHistory.length > 0 && (
        <Marker
          coordinate={{ latitude: routeHistory[0].lat, longitude: routeHistory[0].lng }}
          tracksViewChanges={false}
        >
          <View style={historyMarkerStyles.startDot}>
            <View style={historyMarkerStyles.startDotInner} />
          </View>
        </Marker>
      )}

      {/* Shipment markers */}
      {Marker && displayShipments.filter(hasCoords).map(s => {
        const isSelected = selectedShipment?.id === s.id;
        return (
          <Marker
            key={s.id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            tracksViewChanges={false}
            onPress={() => onMarkerPress(s)}
          >
            <View style={mapInnerStyles.markerWrap}>
              <View style={[
                mapInnerStyles.markerOuter,
                { borderColor: STATUS_COLORS[s.status] ?? Colors.primary },
                isSelected && mapInnerStyles.markerOuterSelected,
              ]}>
                <View style={[mapInnerStyles.markerInner, { backgroundColor: STATUS_COLORS[s.status] ?? Colors.primary }]}>
                  <MaterialIcons name="local-shipping" size={isSelected ? 14 : 12} color="#fff" />
                </View>
              </View>
              <View style={[mapInnerStyles.markerLabel, isSelected && mapInnerStyles.markerLabelSelected]}>
                <Text style={mapInnerStyles.markerLabelText} numberOfLines={1}>{s.tirNumber.split('-').pop()}</Text>
              </View>
            </View>
          </Marker>
        );
      })}
    </MapView>
    </MapErrorBoundary>
  );
}

const mapInnerStyles = StyleSheet.create({
  markerWrap: { alignItems: 'center' },
  markerOuter: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, backgroundColor: 'rgba(10,15,30,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  markerOuterSelected: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 3,
    shadowColor: '#fff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6,
  },
  markerInner: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  markerLabel: {
    backgroundColor: 'rgba(10,15,30,0.85)',
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2,
    alignSelf: 'center', marginTop: 2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  markerLabelSelected: {
    borderColor: Colors.primary, backgroundColor: `${Colors.primary}33`,
  },
  markerLabelText: { fontSize: 9, color: '#fff', fontFamily: 'monospace', fontWeight: '700' },
});

// ── Shipment detail panel (shown when marker is tapped) ─────────────────────
function ShipmentPanel({ shipment, onClose, onNavigate }: {
  shipment: Shipment;
  onClose: () => void;
  onNavigate?: (s: Shipment) => void;
}) {
  const slideAnim = useRef(new Animated.Value(120)).current;

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
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.lg, gap: Spacing.md,
    ...Shadow.card,
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

  // Compute stats
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
            <Text style={statsStyles.utilPct}>
              {total > 0 ? Math.round((inTransit / total) * 100) : 0}%
            </Text>
          </View>
          <View style={statsStyles.utilTrack}>
            <View
              style={[
                statsStyles.utilFill,
                { flex: total > 0 ? Math.max(0.01, inTransit / total) : 0.01 },
              ]}
            />
            <View style={{ flex: total > 0 ? Math.max(0, 1 - inTransit / total) : 0.99 }} />
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
  },
  utilFill: {
    height: 5, backgroundColor: Colors.primary, borderRadius: 3,
    // width set dynamically via flex
  },
});

// ── Full-screen Modal ────────────────────────────────────────────────────────
function FullScreenMap({
  visible,
  onClose,
  shipments,
  onShipmentPress,
}: {
  visible: boolean;
  onClose: () => void;
  shipments: Shipment[];
  onShipmentPress?: (s: Shipment) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const [showStats, setShowStats] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for live dot
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.6, duration: 900, useNativeDriver: true }),
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

  const handleRefresh = () => {
    setLastUpdated(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  };

  const trackedCount = shipments.filter(hasCoords).length;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={fsStyles.root}>
        {/* Header bar */}
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
            <Pressable
              style={({ pressed }) => [fsStyles.iconBtn, pressed && { opacity: 0.7 }]}
              onPress={handleRefresh}
              hitSlop={8}
            >
              <MaterialIcons name="refresh" size={18} color={Colors.textSecondary} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [fsStyles.iconBtn, showStats && fsStyles.iconBtnActive, pressed && { opacity: 0.7 }]}
              onPress={() => setShowStats(v => !v)}
              hitSlop={8}
            >
              <MaterialIcons name="bar-chart" size={18} color={showStats ? Colors.primary : Colors.textSecondary} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [fsStyles.closeBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
              hitSlop={8}
            >
              <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Status filter chips */}
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
                  style={[
                    fsStyles.chip,
                    isActive && { backgroundColor: `${opt.color}22`, borderColor: opt.color },
                  ]}
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
          <MapContent
            shipments={shipments}
            filteredShipments={filteredShipments}
            selectedShipment={selectedShipment}
            onMarkerPress={s => setSelectedShipment(prev => prev?.id === s.id ? null : s)}
            onMapPress={() => { setSelectedShipment(null); }}
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

        {/* Shipment info panel */}
        {selectedShipment && (
          <ShipmentPanel
            shipment={selectedShipment}
            onClose={() => setSelectedShipment(null)}
            onNavigate={onShipmentPress}
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
    paddingHorizontal: Spacing.xl, paddingTop: 52, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    gap: Spacing.sm,
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
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
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
  filterOuter: {
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    minHeight: 50,
  },
  filterContent: {
    paddingHorizontal: Spacing.lg, paddingVertical: 8, gap: 8,
    flexDirection: 'row', alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  chipBadge: {
    backgroundColor: Colors.border, borderRadius: 8,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  chipBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.textMuted },
  noGpsBox: {
    position: 'absolute', bottom: 20, left: 0, right: 0,
    alignItems: 'center', gap: 6, flexDirection: 'row', justifyContent: 'center',
  },
  noGpsTxt: { fontSize: FontSize.sm, color: Colors.textMuted },
});

const historyMarkerStyles = StyleSheet.create({
  startDot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.success,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  startDotInner: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#fff',
  },
});

// ── Main exported component ─────────────────────────────────────────────────
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
        <MapContent
          shipments={shipments}
          focusShipment={focusShipment}
          filteredShipments={displayShipments}
          selectedShipment={selectedShipment}
          onMarkerPress={s => setSelectedShipment(prev => prev?.id === s.id ? null : s)}
          onMapPress={() => setSelectedShipment(null)}
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

        {/* No GPS notice */}
        {trackedCount === 0 && (
          <View style={styles.noGpsOverlay} pointerEvents="none">
            <MaterialIcons name="gps-off" size={18} color={Colors.textMuted} />
            <Text style={styles.noGpsText}>GPS data not yet available</Text>
          </View>
        )}

        {/* Mini shipment panel when marker selected */}
        {selectedShipment && (
          <ShipmentPanel
            shipment={selectedShipment}
            onClose={() => setSelectedShipment(null)}
            onNavigate={onShipmentPress}
          />
        )}
      </View>

      {/* Full-screen modal */}
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
    backgroundColor: '#1a2035',
    position: 'relative',
  },
  liveTag: {
    position: 'absolute', top: 10, left: 10,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 10,
  },
  livePulseRing: {
    position: 'absolute',
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: `${Colors.success}55`,
    left: 10,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  liveText: { fontSize: 10, color: Colors.success, fontWeight: '700', letterSpacing: 1 },
  countTag: {
    position: 'absolute', top: 10, right: 46,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 10,
  },
  countText: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' },
  expandBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(10,15,30,0.88)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 10,
  },
  noGpsOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(13,17,23,0.75)',
  },
  noGpsText: { fontSize: FontSize.sm, color: Colors.textMuted },
});
