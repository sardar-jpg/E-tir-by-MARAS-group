/**
 * SeaMapModal — Full-screen admin panel for sea shipment tracking.
 * Shows all sea shipments on a multi-vessel map with a selectable list.
 * Lazy-loads SeaTrackingMap (native) to avoid bundle bloat on mobile.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView,
  Animated, Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Shipment } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

// Lazy-load SeaTrackingMap to avoid bundle bloat on mobile
let SeaTrackingMapComponent: React.ComponentType<{ shipment: Shipment }> | null = null;
function getLazySeaMap() {
  if (!SeaTrackingMapComponent) {
    try { SeaTrackingMapComponent = require('@/components/feature/SeaTrackingMap').SeaTrackingMap; }
    catch { SeaTrackingMapComponent = null; }
  }
  return SeaTrackingMapComponent;
}

// ── Sea status colours ────────────────────────────────────────────────────────
const SEA_STATUS_COLORS: Record<string, string> = {
  'Booked':               '#38BDF8',
  'At Port of Loading':   '#818CF8',
  'Vessel Departed':      '#0EA5E9',
  'At Sea':               Colors.primary,
  'At Port of Discharge': '#818CF8',
  'Port Customs':         Colors.warning,
  'Customs Pending':      Colors.warning,
  'Arrived':              Colors.success,
  'Detained':             Colors.danger,
  'Loaded':               Colors.info,
};

const SEA_FILTER_OPTIONS = [
  { key: 'all',      label: 'All Sea',    color: '#58C4DC' },
  { key: 'active',   label: 'Active',     color: Colors.primary },
  { key: 'port',     label: 'At Port',    color: '#818CF8' },
  { key: 'customs',  label: 'Customs',    color: Colors.warning },
  { key: 'arrived',  label: 'Arrived',    color: Colors.success },
  { key: 'detained', label: 'Detained',   color: Colors.danger },
];

function matchesSeaFilter(s: Shipment, filter: string): boolean {
  switch (filter) {
    case 'active':   return ['At Sea', 'Vessel Departed', 'In Transit'].includes(s.status);
    case 'port':     return ['At Port of Loading', 'At Port of Discharge', 'Booked', 'Loaded'].includes(s.status);
    case 'customs':  return ['Port Customs', 'Customs Clearance', 'Customs Pending'].includes(s.status);
    case 'arrived':  return s.status === 'Arrived';
    case 'detained': return s.status === 'Detained';
    default:         return true;
  }
}

function hasGps(s: Shipment): boolean {
  return typeof s.lat === 'number' && typeof s.lng === 'number';
}

// ── Sea Shipment Row ──────────────────────────────────────────────────────────
function SeaShipmentRow({
  shipment, isSelected, onPress,
}: { shipment: Shipment; isSelected: boolean; onPress: () => void }) {
  const accentColor = SEA_STATUS_COLORS[shipment.status] ?? '#58C4DC';
  return (
    <Pressable
      style={({ pressed }) => [
        rowSt.row,
        isSelected && rowSt.rowSelected,
        pressed && { opacity: 0.82 },
      ]}
      onPress={onPress}
    >
      <View style={[rowSt.accentBar, { backgroundColor: accentColor }]} />
      <View style={rowSt.inner}>
        {/* Header */}
        <View style={rowSt.topRow}>
          <MaterialIcons name="directions-boat" size={13} color={accentColor} />
          <Text style={rowSt.tirNum}>{shipment.tirNumber}</Text>
          <View style={{ flex: 1 }} />
          <StatusBadge status={shipment.status} size="sm" />
          {hasGps(shipment) && (
            <View style={rowSt.gpsPill}>
              <MaterialIcons name="gps-fixed" size={9} color={Colors.success} />
              <Text style={rowSt.gpsText}>LIVE</Text>
            </View>
          )}
        </View>
        {/* Port route */}
        <View style={rowSt.portRow}>
          <View style={rowSt.portItem}>
            <View style={[rowSt.portDot, { backgroundColor: Colors.primary }]} />
            <Text style={rowSt.portName} numberOfLines={1}>{shipment.portOfLoading || shipment.origin}</Text>
          </View>
          <MaterialIcons name="arrow-right-alt" size={15} color={Colors.textMuted} />
          <View style={rowSt.portItem}>
            <View style={[rowSt.portDot, { backgroundColor: Colors.success }]} />
            <Text style={rowSt.portName} numberOfLines={1}>{shipment.portOfDischarge || shipment.destination}</Text>
          </View>
        </View>
        {/* Vessel / shipping line */}
        {(shipment.vesselName || shipment.shippingLine || shipment.incoterms) && (
          <View style={rowSt.metaRow}>
            {shipment.vesselName && (
              <View style={rowSt.metaChip}>
                <MaterialIcons name="directions-boat" size={9} color="#58C4DC" />
                <Text style={rowSt.metaText} numberOfLines={1}>{shipment.vesselName}</Text>
              </View>
            )}
            {shipment.incoterms && (
              <View style={[rowSt.metaChip, rowSt.incotermsChip]}>
                <Text style={rowSt.incotermsText}>{shipment.incoterms}</Text>
              </View>
            )}
          </View>
        )}
      </View>
      <MaterialIcons name="chevron-right" size={16} color={Colors.textMuted} style={{ flexShrink: 0 }} />
    </Pressable>
  );
}

const rowSt = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', marginBottom: Spacing.sm,
  },
  rowSelected: { borderColor: '#58C4DC', backgroundColor: 'rgba(88,196,220,0.06)' },
  accentBar: { width: 3, alignSelf: 'stretch' },
  inner: { flex: 1, padding: Spacing.md, gap: 5 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tirNum: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'monospace' },
  gpsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: `${Colors.success}12`, borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  gpsText: { fontSize: 8, color: Colors.success, fontWeight: '700', letterSpacing: 0.5 },
  portRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  portItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  portDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  portName: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, flex: 1 },
  metaRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(88,196,220,0.08)', borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.2)',
  },
  metaText: { fontSize: 9, color: '#58C4DC', fontWeight: '600' },
  incotermsChip: {
    backgroundColor: Colors.primaryGlow, borderColor: 'rgba(47,129,247,0.3)',
  },
  incotermsText: { fontSize: 9, fontWeight: '800', color: Colors.primary },
});

// ── Map pane — shows SeaTrackingMap for selected shipment ─────────────────────
function SeaMapPane({ shipment, onClear }: { shipment: Shipment; onClear: () => void }) {
  const SeaMap = getLazySeaMap();
  return (
    <View style={mapPaneSt.root}>
      {/* Selected ship header */}
      <View style={mapPaneSt.header}>
        <View style={mapPaneSt.headerLeft}>
          <View style={mapPaneSt.vesselIcon}>
            <MaterialIcons name="directions-boat" size={14} color="#58C4DC" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={mapPaneSt.tirNum}>{shipment.tirNumber}</Text>
            <Text style={mapPaneSt.routeText} numberOfLines={1}>
              {shipment.portOfLoading || shipment.origin} → {shipment.portOfDischarge || shipment.destination}
            </Text>
          </View>
        </View>
        <StatusBadge status={shipment.status} size="sm" />
        <Pressable style={mapPaneSt.clearBtn} onPress={onClear} hitSlop={8}>
          <MaterialIcons name="close" size={14} color={Colors.textMuted} />
        </Pressable>
      </View>
      {/* Map */}
      {SeaMap ? (
        <SeaMap shipment={shipment} />
      ) : (
        <View style={mapPaneSt.fallback}>
          <MaterialIcons name="directions-boat" size={28} color={Colors.textMuted} />
          <Text style={mapPaneSt.fallbackTitle}>Map requires native build</Text>
          <Text style={mapPaneSt.fallbackSub}>Download the APK to view sea tracking on device.</Text>
        </View>
      )}
    </View>
  );
}

const mapPaneSt = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  vesselIcon: {
    width: 32, height: 32, borderRadius: BorderRadius.sm,
    backgroundColor: 'rgba(88,196,220,0.12)', borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  tirNum: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'monospace' },
  routeText: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  clearBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  fallback: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
    backgroundColor: '#0d1520',
  },
  fallbackTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  fallbackSub: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', lineHeight: 18, paddingHorizontal: 32 },
});

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptySelectState() {
  return (
    <View style={emptySt.root}>
      <View style={emptySt.iconRing}>
        <View style={emptySt.icon}>
          <MaterialIcons name="directions-boat" size={32} color="#58C4DC" />
        </View>
      </View>
      <Text style={emptySt.title}>Select a Shipment</Text>
      <Text style={emptySt.sub}>
        Tap any sea shipment from the list to view its port-to-port route, vessel position, and tracking details on the map.
      </Text>
      <View style={emptySt.hint}>
        <MaterialIcons name="touch-app" size={13} color={Colors.textMuted} />
        <Text style={emptySt.hintText}>Shipments with live GPS show a vessel marker</Text>
      </View>
    </View>
  );
}

const emptySt = StyleSheet.create({
  root: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.lg, padding: 40, backgroundColor: '#0d1520',
  },
  iconRing: {
    width: 90, height: 90, borderRadius: 45,
    borderWidth: 1.5, borderColor: 'rgba(88,196,220,0.2)',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
  },
  icon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(88,196,220,0.08)', borderWidth: 1.5, borderColor: 'rgba(88,196,220,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(88,196,220,0.06)', borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.15)',
  },
  hintText: { fontSize: FontSize.xs, color: Colors.textMuted },
});

// ── Main export ───────────────────────────────────────────────────────────────
interface SeaMapModalProps {
  visible: boolean;
  onClose: () => void;
  shipments: Shipment[];
  onViewDetail?: (s: Shipment) => void;
}

export function SeaMapModal({ visible, onClose, shipments, onViewDetail }: SeaMapModalProps) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState('all');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [listExpanded, setListExpanded] = useState(true);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const listHeightAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const screenH = Dimensions.get('window').height;

  // Sea-only shipments
  const seaShipments = useMemo(() =>
    shipments.filter(s => s.shipmentType === 'Sea'),
  [shipments]);

  const filtered = useMemo(() =>
    seaShipments.filter(s => matchesSeaFilter(s, filter)),
  [seaShipments, filter]);

  // Stats
  const stats = useMemo(() => ({
    total:   seaShipments.length,
    atSea:   seaShipments.filter(s => ['At Sea', 'Vessel Departed'].includes(s.status)).length,
    atPort:  seaShipments.filter(s => ['At Port of Loading', 'At Port of Discharge', 'Booked', 'Loaded'].includes(s.status)).length,
    customs: seaShipments.filter(s => ['Port Customs', 'Customs Clearance', 'Customs Pending'].includes(s.status)).length,
    arrived: seaShipments.filter(s => s.status === 'Arrived').length,
    gps:     seaShipments.filter(hasGps).length,
  }), [seaShipments]);

  // Pulse animation
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.8, duration: 1000, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [visible]);

  // List toggle animation — JS driver only (no mixing with useNativeDriver)
  useEffect(() => {
    Animated.spring(listHeightAnim, {
      toValue: listExpanded ? 1 : 0,
      useNativeDriver: false, tension: 220, friction: 26,
    }).start();
    Animated.timing(rotateAnim, {
      toValue: listExpanded ? 0 : 1, duration: 200, useNativeDriver: true,
    }).start();
  }, [listExpanded]);

  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const listMaxHeight = listHeightAnim.interpolate({
    inputRange: [0, 1], outputRange: [0, screenH * 0.40],
  });

  // Reset selection when filter changes
  useEffect(() => { setSelectedShipment(null); }, [filter]);

  const handleViewDetail = useCallback((s: Shipment) => {
    onClose();
    setTimeout(() => onViewDetail?.(s), 300);
  }, [onClose, onViewDetail]);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar style="light" />
      <View style={[styles.root, { paddingTop: insets.top }]}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.brandIcon}>
              <MaterialIcons name="directions-boat" size={16} color="#58C4DC" />
            </View>
            <View>
              <Text style={styles.headerTitle}>Sea Fleet Tracker</Text>
              <View style={styles.liveRow}>
                <View style={styles.liveDotWrap}>
                  <Animated.View style={[styles.livePulse, { transform: [{ scale: pulseAnim }] }]} />
                  <View style={styles.liveDot} />
                </View>
                <Text style={styles.liveTxt}>LIVE</Text>
                <Text style={styles.subTxt}> · {seaShipments.length} sea shipment{seaShipments.length !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose} hitSlop={8}
            >
              <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* ── Stats strip ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.statsStrip}
          contentContainerStyle={styles.statsStripContent}
        >
          {[
            { icon: 'layers' as const,          label: 'Total',   value: stats.total,   color: '#58C4DC' },
            { icon: 'water' as const,            label: 'At Sea',  value: stats.atSea,   color: Colors.primary },
            { icon: 'anchor' as const,           label: 'At Port', value: stats.atPort,  color: '#818CF8' },
            { icon: 'verified-user' as const,    label: 'Customs', value: stats.customs, color: Colors.warning },
            { icon: 'check-circle' as const,     label: 'Arrived', value: stats.arrived, color: Colors.success },
            { icon: 'gps-fixed' as const,        label: 'GPS',     value: stats.gps,     color: Colors.success },
          ].map(item => (
            <View key={item.label} style={styles.statPill}>
              <View style={[styles.statPillIcon, { backgroundColor: `${item.color}15` }]}>
                <MaterialIcons name={item.icon} size={11} color={item.color} />
              </View>
              <Text style={[styles.statPillValue, { color: item.color }]}>{item.value}</Text>
              <Text style={styles.statPillLabel}>{item.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* ── Filter chips ── */}
        <View style={styles.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
            {SEA_FILTER_OPTIONS.map(opt => {
              const count = seaShipments.filter(s => matchesSeaFilter(s, opt.key)).length;
              const isActive = filter === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[styles.chip, isActive && { backgroundColor: `${opt.color}20`, borderColor: opt.color }]}
                  onPress={() => setFilter(opt.key)}
                >
                  {isActive && <View style={[styles.chipDot, { backgroundColor: opt.color }]} />}
                  <Text style={[styles.chipText, isActive && { color: opt.color, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                  <View style={[styles.chipBadge, isActive && { backgroundColor: opt.color }]}>
                    <Text style={[styles.chipBadgeText, isActive && { color: '#fff' }]}>{count}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Map area ── */}
        <View style={styles.mapArea}>
          {selectedShipment ? (
            <SeaMapPane
              shipment={selectedShipment}
              onClear={() => setSelectedShipment(null)}
            />
          ) : (
            <EmptySelectState />
          )}

          {/* View Detail CTA when shipment selected */}
          {selectedShipment && onViewDetail && (
            <Pressable
              style={({ pressed }) => [styles.viewDetailBtn, pressed && { opacity: 0.85 }]}
              onPress={() => handleViewDetail(selectedShipment)}
            >
              <MaterialIcons name="open-in-new" size={14} color="#fff" />
              <Text style={styles.viewDetailText}>View Full Shipment Details</Text>
              <MaterialIcons name="arrow-forward" size={14} color="#fff" />
            </Pressable>
          )}
        </View>

        {/* ── Shipment list panel ── */}
        <View style={[styles.listPanel, { paddingBottom: insets.bottom + 8 }]}>
          {/* Toggle header */}
          <Pressable style={styles.listHeader} onPress={() => setListExpanded(v => !v)}>
            <View style={styles.listDragHandle} />
            <View style={styles.listHeaderCenter}>
              <MaterialIcons name="directions-boat" size={14} color="#58C4DC" />
              <Text style={styles.listHeaderTitle}>
                {filtered.length} sea shipment{filtered.length !== 1 ? 's' : ''}
              </Text>
              {selectedShipment && (
                <View style={styles.focusChip}>
                  <Text style={styles.focusChipText}>1 selected</Text>
                </View>
              )}
            </View>
            <Animated.View style={{ transform: [{ rotate }] }}>
              <MaterialIcons name="keyboard-arrow-up" size={18} color={Colors.textMuted} />
            </Animated.View>
          </Pressable>

          {/* Animated list */}
          <Animated.View style={[styles.listBody, { maxHeight: listMaxHeight }]}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            >
              {seaShipments.length === 0 ? (
                <View style={styles.emptyList}>
                  <MaterialIcons name="directions-boat" size={28} color={Colors.border} />
                  <Text style={styles.emptyListTitle}>No Sea Shipments</Text>
                  <Text style={styles.emptyListSub}>Create a sea shipment to track it here.</Text>
                </View>
              ) : filtered.length === 0 ? (
                <View style={styles.emptyList}>
                  <MaterialIcons name="filter-list" size={28} color={Colors.border} />
                  <Text style={styles.emptyListTitle}>No Results</Text>
                  <Text style={styles.emptyListSub}>No sea shipments match this filter.</Text>
                </View>
              ) : (
                filtered.map(s => (
                  <SeaShipmentRow
                    key={s.id}
                    shipment={s}
                    isSelected={selectedShipment?.id === s.id}
                    onPress={() => setSelectedShipment(prev => prev?.id === s.id ? null : s)}
                  />
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  brandIcon: {
    width: 38, height: 38, borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(88,196,220,0.12)', borderWidth: 1.5, borderColor: 'rgba(88,196,220,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  liveDotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  livePulse: {
    position: 'absolute', width: 12, height: 12, borderRadius: 6,
    backgroundColor: 'rgba(88,196,220,0.35)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#58C4DC' },
  liveTxt: { fontSize: 10, color: '#58C4DC', fontWeight: '700', letterSpacing: 1 },
  subTxt: { fontSize: 10, color: Colors.textMuted },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // Stats strip
  statsStrip: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, maxHeight: 52 },
  statsStripContent: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingVertical: 10,
  },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  statPillIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statPillValue: { fontSize: FontSize.sm, fontWeight: '800' },
  statPillLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },

  // Filter chips
  filterBar: {
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, minHeight: 48,
  },
  filterContent: {
    paddingHorizontal: Spacing.lg, paddingVertical: 8, gap: 7,
    flexDirection: 'row', alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 11, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border, minHeight: 32,
  },
  chipDot: { width: 5, height: 5, borderRadius: 3 },
  chipText: { fontSize: FontSize.xs, fontWeight: '500', color: Colors.textSecondary },
  chipBadge: {
    backgroundColor: Colors.border, borderRadius: 8,
    minWidth: 18, height: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  chipBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.textMuted },

  // Map area
  mapArea: { flex: 1, position: 'relative', overflow: 'hidden' },

  // View detail CTA
  viewDetailBtn: {
    position: 'absolute', bottom: 12, left: Spacing.xl, right: Spacing.xl,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: 'rgba(88,196,220,0.9)', borderRadius: BorderRadius.md,
    paddingVertical: 11,
    borderWidth: 1, borderColor: '#58C4DC',
    ...Shadow.elevated,
  },
  viewDetailText: { fontSize: FontSize.sm, fontWeight: '700', color: '#0d1520', flex: 1, textAlign: 'center' },

  // List panel
  listPanel: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
    borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    ...Shadow.elevated,
  },
  listHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  listDragHandle: {
    width: 32, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginRight: Spacing.md,
  },
  listHeaderCenter: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  listHeaderTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  focusChip: {
    backgroundColor: 'rgba(88,196,220,0.12)', borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)',
  },
  focusChipText: { fontSize: 9, color: '#58C4DC', fontWeight: '700' },
  listBody: { overflow: 'hidden' },
  listContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  emptyList: { alignItems: 'center', gap: 8, paddingVertical: Spacing.xxl },
  emptyListTitle: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textMuted },
  emptyListSub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
});
