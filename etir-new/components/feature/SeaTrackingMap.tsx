/**
 * SeaTrackingMap — Native implementation (iOS / Android).
 * Uses react-native-maps for port markers and vessel tracking.
 * Web uses SeaTrackingMap.web.tsx (Leaflet) via Metro platform extensions.
 */
import React, { useRef, useEffect, useState, Component } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Shipment } from '@/types';
import { Colors, FontSize, Spacing, BorderRadius } from '@/constants/theme';

// ── Port coordinate database ─────────────────────────────────────────────────
const PORT_COORDS: Record<string, [number, number]> = {
  'mersin':        [36.7998, 34.6417],
  'istanbul':      [41.0082, 28.9784],
  'iskenderun':    [36.5853, 36.1649],
  'izmir':         [38.4192, 27.1287],
  'gemlik':        [40.4314, 29.1598],
  'derince':       [40.7648, 29.8157],
  'bandirma':      [40.3517, 27.9775],
  'umm qasr':      [29.9744, 48.1875],
  'khor al-zubair': [30.0833, 47.9167],
  'maqal':         [30.5178, 47.8294],
  'abu flus':      [30.4833, 47.8667],
  'basra':         [30.5085, 47.7835],
  'jebel ali':     [24.9976, 55.0521],
  'abu dhabi':     [24.4814, 54.3705],
  'salalah':       [17.0027, 54.0920],
  'hamad':         [24.9576, 51.5581],
  'king abdullah': [22.7440, 38.9786],
  'beirut':        [33.8981, 35.5028],
  'aqaba':         [29.5108, 35.0160],
  'bandar abbas':  [27.1832, 56.2666],
  'shuwaikh':      [29.3608, 47.9352],
  'shuaiba':       [29.0839, 48.1592],
  'khalifa':       [24.8029, 54.5342],
  'rotterdam':     [51.9061, 4.0600],
  'hamburg':       [53.5456, 9.9680],
  'antwerp':       [51.2598, 4.4000],
  'piraeus':       [37.9478, 23.6438],
  'genoa':         [44.4056, 8.9340],
  'valencia':      [39.4442, -0.3315],
  'shanghai':      [31.2304, 121.4737],
  'guangzhou':     [22.3193, 113.9070],
  'ningbo':        [29.8683, 121.5440],
  'singapore':     [1.2897, 103.8501],
  'busan':         [35.1796, 129.0756],
  'new york':      [40.6892, -74.0445],
  'houston':       [29.7463, -95.0848],
};

function lookupPortCoords(portName: string): [number, number] | null {
  if (!portName) return null;
  const lower = portName.toLowerCase();
  for (const [key, coords] of Object.entries(PORT_COORDS)) {
    if (lower.includes(key)) return coords;
  }
  return null;
}

function seaRouteWaypoints(from: [number, number], to: [number, number], steps = 8): [number, number][] {
  const points: [number, number][] = [from];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const lat = from[0] + (to[0] - from[0]) * t;
    const lng = from[1] + (to[1] - from[1]) * t;
    const arc = Math.sin(t * Math.PI) * 1.5;
    points.push([lat + arc * 0.3, lng + arc * 0.1]);
  }
  points.push(to);
  return points;
}

// ── Lazy-load react-native-maps (safe — avoids crash in Expo Go) ─────────────
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
} catch {}

// ── Error boundary ───────────────────────────────────────────────────────────
class MapErrorBoundary extends Component<{ children: React.ReactNode }, { err: boolean }> {
  constructor(props: any) { super(props); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) return <MapFallback />;
    return this.props.children;
  }
}

function MapFallback() {
  return (
    <View style={st.fallback}>
      <MaterialIcons name="directions-boat" size={24} color={Colors.textMuted} />
      <Text style={st.fallbackTitle}>Map unavailable</Text>
      <Text style={st.fallbackSub}>Requires a native build (APK/IPA)</Text>
    </View>
  );
}

// ── Native map ───────────────────────────────────────────────────────────────
function NativeSeaMap({ shipment, loadingPort, dischargePort, vesselPos }: {
  shipment: Shipment;
  loadingPort: [number, number] | null;
  dischargePort: [number, number] | null;
  vesselPos: { lat: number; lng: number } | null;
}) {
  if (!MapView) return <MapFallback />;

  const coordsList: [number, number][] = [
    ...(loadingPort ? [loadingPort] : []),
    ...(vesselPos ? [[vesselPos.lat, vesselPos.lng] as [number, number]] : []),
    ...(dischargePort ? [dischargePort] : []),
  ];

  const center: [number, number] = coordsList.length > 0
    ? [
        coordsList.reduce((s, c) => s + c[0], 0) / coordsList.length,
        coordsList.reduce((s, c) => s + c[1], 0) / coordsList.length,
      ]
    : [30.0, 48.0];

  const routePath = loadingPort && dischargePort ? seaRouteWaypoints(loadingPort, dischargePort) : [];

  const region = {
    latitude: center[0],
    longitude: center[1],
    latitudeDelta: Math.max(
      coordsList.length > 1 ? (Math.max(...coordsList.map(c => c[0])) - Math.min(...coordsList.map(c => c[0]))) * 2.5 : 10,
      4
    ),
    longitudeDelta: Math.max(
      coordsList.length > 1 ? (Math.max(...coordsList.map(c => c[1])) - Math.min(...coordsList.map(c => c[1]))) * 2.5 : 10,
      8
    ),
  };

  return (
    <MapErrorBoundary>
      <MapView
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        mapType="standard"
        showsUserLocation={false}
        showsCompass={false}
        pitchEnabled={false}
      >
        {Polyline && routePath.length > 1 && (
          <Polyline
            coordinates={routePath.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
            strokeColor="rgba(88,196,220,0.55)"
            strokeWidth={2}
            lineDashPattern={[10, 6]}
          />
        )}
        {Marker && loadingPort && (
          <Marker coordinate={{ latitude: loadingPort[0], longitude: loadingPort[1] }} tracksViewChanges={false}>
            <View style={st.portMarkerWrap}>
              <View style={[st.portMarker, { borderColor: Colors.primary }]}>
                <MaterialIcons name="anchor" size={10} color={Colors.primary} />
              </View>
              <View style={[st.portLabel, { borderColor: Colors.primary }]}>
                <Text style={[st.portLabelText, { color: Colors.primary }]}>LOADING</Text>
              </View>
            </View>
          </Marker>
        )}
        {Marker && dischargePort && (
          <Marker coordinate={{ latitude: dischargePort[0], longitude: dischargePort[1] }} tracksViewChanges={false}>
            <View style={st.portMarkerWrap}>
              <View style={[st.portMarker, { borderColor: Colors.success }]}>
                <MaterialIcons name="anchor" size={10} color={Colors.success} />
              </View>
              <View style={[st.portLabel, { borderColor: Colors.success }]}>
                <Text style={[st.portLabelText, { color: Colors.success }]}>DISCHARGE</Text>
              </View>
            </View>
          </Marker>
        )}
        {Marker && vesselPos && (
          <Marker coordinate={{ latitude: vesselPos.lat, longitude: vesselPos.lng }} tracksViewChanges={false}>
            <View style={st.vesselMarkerWrap}>
              <View style={st.vesselMarkerOuter}>
                <MaterialIcons name="directions-boat" size={16} color="#58C4DC" />
              </View>
              <View style={st.vesselLabel}>
                <Text style={st.vesselLabelText} numberOfLines={1}>{shipment.tirNumber}</Text>
              </View>
            </View>
          </Marker>
        )}
      </MapView>
    </MapErrorBoundary>
  );
}

// ── Info card when no ports known ────────────────────────────────────────────
function NoVesselGPSCard({ shipment }: { shipment: Shipment }) {
  return (
    <View style={st.noGpsCard}>
      <View style={st.noGpsIconRow}>
        <View style={st.noGpsIcon}>
          <MaterialIcons name="gps-off" size={18} color={Colors.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.noGpsTitle}>No Live Vessel GPS</Text>
          <Text style={st.noGpsSub}>Vessel position not yet available</Text>
        </View>
      </View>
      <View style={st.portRowPair}>
        <View style={st.portInfoItem}>
          <View style={[st.portDot, { backgroundColor: Colors.primary }]} />
          <View style={{ flex: 1 }}>
            <Text style={st.portInfoLabel}>Port of Loading</Text>
            <Text style={st.portInfoValue} numberOfLines={2}>{shipment.portOfLoading || '—'}</Text>
          </View>
        </View>
        <View style={st.portRowDivider} />
        <View style={st.portInfoItem}>
          <View style={[st.portDot, { backgroundColor: Colors.success }]} />
          <View style={{ flex: 1 }}>
            <Text style={st.portInfoLabel}>Port of Discharge</Text>
            <Text style={st.portInfoValue} numberOfLines={2}>{shipment.portOfDischarge || '—'}</Text>
          </View>
        </View>
      </View>
      {(shipment.vesselName || shipment.shippingLine) && (
        <View style={st.vesselInfoRow}>
          <MaterialIcons name="directions-boat" size={12} color={Colors.textMuted} />
          <Text style={st.vesselInfoText}>{[shipment.vesselName, shipment.shippingLine].filter(Boolean).join(' · ')}</Text>
          {shipment.voyageNumber && (
            <>
              <Text style={st.vesselInfoDot}>·</Text>
              <Text style={st.vesselInfoMono}>{shipment.voyageNumber}</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function PortInfoStrip({ shipment, vesselPos }: {
  shipment: Shipment;
  vesselPos: { lat: number; lng: number } | null;
}) {
  return (
    <View style={st.portStrip} pointerEvents="none">
      <View style={st.portStripItem}>
        <View style={[st.portStripDot, { backgroundColor: Colors.primary }]} />
        <View style={{ flex: 1 }}>
          <Text style={st.portStripLabel}>Loading</Text>
          <Text style={st.portStripValue} numberOfLines={1}>{shipment.portOfLoading?.split(',')[0] ?? '—'}</Text>
        </View>
      </View>
      <MaterialIcons name="arrow-forward" size={12} color={Colors.textMuted} />
      {vesselPos && (
        <>
          <View style={st.portStripItem}>
            <View style={[st.portStripDot, { backgroundColor: '#58C4DC' }]} />
            <View style={{ flex: 1 }}>
              <Text style={st.portStripLabel}>Vessel</Text>
              <Text style={st.portStripValue} numberOfLines={1}>{shipment.status}</Text>
            </View>
          </View>
          <MaterialIcons name="arrow-forward" size={12} color={Colors.textMuted} />
        </>
      )}
      <View style={st.portStripItem}>
        <View style={[st.portStripDot, { backgroundColor: Colors.success }]} />
        <View style={{ flex: 1 }}>
          <Text style={st.portStripLabel}>Discharge</Text>
          <Text style={st.portStripValue} numberOfLines={1}>{shipment.portOfDischarge?.split(',')[0] ?? '—'}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export function SeaTrackingMap({ shipment }: { shipment: Shipment }) {
  const [fullMap, setFullMap] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const loadingPort   = lookupPortCoords(shipment.portOfLoading ?? '');
  const dischargePort = lookupPortCoords(shipment.portOfDischarge ?? '');
  const vesselPos = (typeof shipment.lat === 'number' && typeof shipment.lng === 'number')
    ? { lat: shipment.lat, lng: shipment.lng }
    : null;

  const hasMap = loadingPort !== null || dischargePort !== null || vesselPos !== null;

  useEffect(() => {
    if (!vesselPos) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.9, duration: 1100, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 1100, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [!!vesselPos]);

  if (!hasMap) return <NoVesselGPSCard shipment={shipment} />;

  return (
    <View style={st.root}>
      <View style={st.mapWrap}>
        <NativeSeaMap
          shipment={shipment}
          loadingPort={loadingPort}
          dischargePort={dischargePort}
          vesselPos={vesselPos}
        />
        <View style={st.seaBadge} pointerEvents="none">
          <MaterialIcons name="directions-boat" size={11} color="#58C4DC" />
          <Text style={st.seaBadgeText}>SEA ROUTE</Text>
        </View>
        {vesselPos && (
          <View style={st.vesselLiveTag} pointerEvents="none">
            <Animated.View style={[st.vesselPulse, { transform: [{ scale: pulseAnim }] }]} />
            <View style={st.vesselLiveDot} />
            <Text style={st.vesselLiveTagText}>VESSEL TRACKED</Text>
          </View>
        )}
        <Pressable
          style={({ pressed }) => [st.expandBtn, pressed && { opacity: 0.8 }]}
          onPress={() => setFullMap(v => !v)}
          hitSlop={8}
        >
          <MaterialIcons name={fullMap ? 'fullscreen-exit' : 'fullscreen'} size={17} color="#E6EDF3" />
        </Pressable>
      </View>

      <PortInfoStrip shipment={shipment} vesselPos={vesselPos} />

      {(shipment.vesselName || shipment.bolNumber || shipment.incoterms) && (
        <View style={st.metaRow}>
          {shipment.vesselName && (
            <View style={st.metaItem}>
              <MaterialIcons name="directions-boat" size={10} color={Colors.textMuted} />
              <Text style={st.metaLabel}>Vessel</Text>
              <Text style={st.metaValue} numberOfLines={1}>{shipment.vesselName}</Text>
            </View>
          )}
          {shipment.bolNumber && (
            <View style={st.metaItem}>
              <MaterialIcons name="article" size={10} color={Colors.textMuted} />
              <Text style={st.metaLabel}>B/L</Text>
              <Text style={[st.metaValue, st.mono]} numberOfLines={1}>{shipment.bolNumber}</Text>
            </View>
          )}
          {shipment.incoterms && (
            <View style={[st.metaItem, { backgroundColor: Colors.primaryGlow, borderColor: 'rgba(47,129,247,0.3)' }]}>
              <MaterialIcons name="handshake" size={10} color={Colors.primary} />
              <Text style={[st.metaLabel, { color: Colors.primary }]}>Terms</Text>
              <Text style={[st.metaValue, { color: Colors.primary, fontWeight: '800' }]}>{shipment.incoterms}</Text>
            </View>
          )}
        </View>
      )}

      {fullMap && (
        <View style={st.fullMapWrap}>
          <NativeSeaMap
            shipment={shipment}
            loadingPort={loadingPort}
            dischargePort={dischargePort}
            vesselPos={vesselPos}
          />
          <Pressable style={[st.expandBtn, { top: 8, right: 8 }]} onPress={() => setFullMap(false)}>
            <MaterialIcons name="fullscreen-exit" size={17} color="#E6EDF3" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  mapWrap: { height: 240, backgroundColor: '#0d1520', position: 'relative', overflow: 'hidden' },
  fullMapWrap: { height: 400, backgroundColor: '#0d1520', position: 'relative', overflow: 'hidden', borderTopWidth: 1, borderTopColor: Colors.border },
  seaBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)', zIndex: 20 },
  seaBadgeText: { fontSize: 9, color: '#58C4DC', fontWeight: '800', letterSpacing: 1 },
  vesselLiveTag: { position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(88,196,220,0.25)', zIndex: 20 },
  vesselPulse: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(88,196,220,0.45)', left: 9 },
  vesselLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#58C4DC' },
  vesselLiveTagText: { fontSize: 9, color: '#58C4DC', fontWeight: '700', letterSpacing: 0.8 },
  expandBtn: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 7, backgroundColor: 'rgba(10,15,30,0.88)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', zIndex: 20 },
  portStrip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle, backgroundColor: Colors.surface },
  portStripItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  portStripDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  portStripLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.6 },
  portStripValue: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textPrimary },
  metaRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.surface, borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border },
  metaLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  metaValue: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  mono: { fontFamily: 'monospace', color: Colors.primary },
  noGpsCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md },
  noGpsIconRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  noGpsIcon: { width: 38, height: 38, borderRadius: BorderRadius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  noGpsTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  noGpsSub: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17, marginTop: 2 },
  portRowPair: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  portInfoItem: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: Spacing.md },
  portRowDivider: { width: 1, height: 40, backgroundColor: Colors.border, alignSelf: 'center' },
  portDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  portInfoLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.6 },
  portInfoValue: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textPrimary, marginTop: 2, lineHeight: 17 },
  vesselInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  vesselInfoText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  vesselInfoDot: { color: Colors.textMuted, fontSize: FontSize.xs },
  vesselInfoMono: { fontSize: FontSize.xs, color: Colors.primary, fontFamily: 'monospace', fontWeight: '600' },
  portMarkerWrap: { alignItems: 'center' },
  portMarker: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(10,15,30,0.92)', borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  portLabel: { backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2, borderWidth: 1 },
  portLabelText: { fontSize: 7, fontWeight: '800', letterSpacing: 0.5 },
  vesselMarkerWrap: { alignItems: 'center' },
  vesselMarkerOuter: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(10,15,30,0.92)', borderWidth: 2.5, borderColor: '#58C4DC', alignItems: 'center', justifyContent: 'center' },
  vesselLabel: { backgroundColor: 'rgba(10,15,30,0.88)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2, borderWidth: 1, borderColor: '#58C4DC' },
  vesselLabelText: { fontSize: 8, fontWeight: '700', color: '#58C4DC', fontFamily: 'monospace' },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117', gap: 8 },
  fallbackTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted },
  fallbackSub: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
});
