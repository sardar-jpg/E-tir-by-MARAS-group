/**
 * SeaTrackingMap — Web-only Leaflet implementation.
 * This file is ONLY loaded on web (Metro platform extensions).
 * Native uses SeaTrackingMap.tsx which imports react-native-maps.
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

// ── Leaflet map container ────────────────────────────────────────────────────
function LeafletMap({ shipment, loadingPort, dischargePort, vesselPos }: {
  shipment: Shipment;
  loadingPort: [number, number] | null;
  dischargePort: [number, number] | null;
  vesselPos: { lat: number; lng: number } | null;
}) {
  const containerId = useRef(`sea-map-${Math.random().toString(36).slice(2)}`).current;
  const mapRef = useRef<any>(null);

  useEffect(() => {
    const init = async () => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      if (!(window as any).L) {
        await new Promise<void>((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          s.onload = () => res(); s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const L = (window as any).L;
      if (!L) return;
      const el = document.getElementById(containerId);
      if (!el) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const allPts: [number, number][] = [
        ...(loadingPort ? [loadingPort] : []),
        ...(vesselPos ? [[vesselPos.lat, vesselPos.lng] as [number, number]] : []),
        ...(dischargePort ? [dischargePort] : []),
      ];
      const center: [number, number] = allPts.length > 0
        ? [allPts.reduce((s, c) => s + c[0], 0) / allPts.length, allPts.reduce((s, c) => s + c[1], 0) / allPts.length]
        : [30.0, 48.0];

      const map = L.map(el, { center, zoom: 5, zoomControl: true, attributionControl: false });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18, subdomains: 'abcd' }).addTo(map);

      const routePath = loadingPort && dischargePort ? seaRouteWaypoints(loadingPort, dischargePort) : [];
      if (routePath.length > 1) {
        L.polyline(routePath, { color: '#58C4DC', weight: 2.5, opacity: 0.6, dashArray: '10 7' }).addTo(map);
      }

      if (loadingPort) {
        const icon = L.divIcon({
          html: `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:28px;height:28px;border-radius:50%;border:2px solid ${Colors.primary};background:rgba(10,15,30,0.9);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="${Colors.primary}"><path d="M17,6H7L4,12v2h1c0,1.1,0.9,2,2,2s2-0.9,2-2h6c0,1.1,0.9,2,2,2s2-0.9,2-2h1v-2L17,6z"/></svg></div><div style="background:rgba(10,15,30,0.88);border:1px solid ${Colors.primary};border-radius:3px;padding:1px 5px;margin-top:2px;font-size:8px;font-weight:700;color:${Colors.primary};white-space:nowrap">LOADING</div></div>`,
          className: '', iconSize: [44, 44], iconAnchor: [22, 44],
        });
        L.marker(loadingPort, { icon }).addTo(map).bindPopup(`<div style="background:#1C2333;color:#E6EDF3;border-radius:6px;padding:8px 10px;font-size:11px"><b style="color:${Colors.primary}">Port of Loading</b><br>${shipment.portOfLoading || '—'}</div>`, { className: 'leaflet-dark-popup' });
      }

      if (dischargePort) {
        const icon = L.divIcon({
          html: `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:28px;height:28px;border-radius:50%;border:2px solid ${Colors.success};background:rgba(10,15,30,0.9);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="${Colors.success}"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></div><div style="background:rgba(10,15,30,0.88);border:1px solid ${Colors.success};border-radius:3px;padding:1px 5px;margin-top:2px;font-size:8px;font-weight:700;color:${Colors.success};white-space:nowrap">DISCHARGE</div></div>`,
          className: '', iconSize: [44, 44], iconAnchor: [22, 44],
        });
        L.marker(dischargePort, { icon }).addTo(map).bindPopup(`<div style="background:#1C2333;color:#E6EDF3;border-radius:6px;padding:8px 10px;font-size:11px"><b style="color:${Colors.success}">Port of Discharge</b><br>${shipment.portOfDischarge || '—'}</div>`, { className: 'leaflet-dark-popup' });
      }

      if (vesselPos) {
        const vesselIcon = L.divIcon({
          html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 0 6px #58C4DC88)"><div style="width:34px;height:34px;border-radius:50%;border:2.5px solid #58C4DC;background:rgba(10,15,30,0.92);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="#58C4DC"><path d="M20,21c-1.39,0-2.78-0.47-4-1.32c-2.44,1.71-5.56,1.71-8,0C6.78,20.53,5.39,21,4,21H2v2h2c1.38,0,2.74-0.35,4-0.99c2.52,1.29,5.48,1.29,8,0c1.26,0.65,2.62,0.99,4,0.99h2v-2H20z M3.95,19H4c1.06,0,2.06-0.27,3-0.78c0.94,0.51,1.94,0.78,3,0.78s2.06-0.27,3-0.78c0.94,0.51,1.94,0.78,3,0.78h0.05l1.9-6.68c0.06-0.21-0.08-0.42-0.3-0.42H19v-2h-3V7h-4V3H9v4H6v4H4.35c-0.22,0-0.36,0.21-0.3,0.42L3.95,19z"/></svg></div><div style="background:rgba(10,15,30,0.88);border:1px solid #58C4DC;border-radius:3px;padding:1px 5px;margin-top:2px;font-size:8px;font-weight:700;color:#58C4DC;font-family:monospace;white-space:nowrap">${shipment.tirNumber}</div></div>`,
          className: '', iconSize: [50, 52], iconAnchor: [25, 52],
        });
        L.marker([vesselPos.lat, vesselPos.lng], { icon: vesselIcon }).addTo(map).bindPopup(`<div style="background:#1C2333;color:#E6EDF3;border-radius:6px;padding:8px 10px;font-size:11px;min-width:160px"><b style="color:#58C4DC">${shipment.tirNumber}</b><br><span style="color:#8B949E">${shipment.vesselName || 'Vessel'}</span><br><span style="background:#58C4DC22;color:#58C4DC;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600">${shipment.status}</span></div>`, { className: 'leaflet-dark-popup' });
      }

      if (!document.getElementById('sea-map-popup-style')) {
        const style = document.createElement('style');
        style.id = 'sea-map-popup-style';
        style.textContent = `.leaflet-dark-popup .leaflet-popup-content-wrapper{background:#1C2333;border:1px solid #30363D;border-radius:8px;padding:0;box-shadow:0 4px 16px rgba(0,0,0,0.6)}.leaflet-dark-popup .leaflet-popup-tip{background:#1C2333}.leaflet-dark-popup .leaflet-popup-content{margin:0}.leaflet-popup-close-button{color:#8B949E!important}`;
        document.head.appendChild(style);
      }

      if (allPts.length > 1) map.fitBounds(L.latLngBounds(allPts).pad(0.35));
    };

    init();
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  return (
    <div id={containerId} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
  );
}

// ── Info card when no GPS available ─────────────────────────────────────────
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
    </View>
  );
}

// ── Port strip ───────────────────────────────────────────────────────────────
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
        <LeafletMap shipment={shipment} loadingPort={loadingPort} dischargePort={dischargePort} vesselPos={vesselPos} />
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
        <Pressable style={({ pressed }) => [st.expandBtn, pressed && { opacity: 0.8 }]} onPress={() => setFullMap(v => !v)} hitSlop={8}>
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
          <LeafletMap shipment={shipment} loadingPort={loadingPort} dischargePort={dischargePort} vesselPos={vesselPos} />
          <Pressable style={[st.expandBtn, { top: 8, right: 8 }]} onPress={() => setFullMap(false)}>
            <MaterialIcons name="fullscreen-exit" size={17} color="#E6EDF3" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

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
});
