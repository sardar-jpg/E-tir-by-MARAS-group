import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView,
  Animated, Platform, Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Shipment } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';
import { isActiveStatus, isCustomsStatus } from '@/services/shipmentStatusGroups';

// Lazy-load LiveMap to avoid crashes in Expo Go
let LiveMap: typeof import('@/components/feature/LiveMap').LiveMap | null = null;
try { LiveMap = require('@/components/feature/LiveMap').LiveMap; } catch (e) {}

// ── Status colors ─────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  // Road
  'In Transit':         Colors.primary,
  'Dispatched':         '#D2A8FF',
  'Border Crossing':    '#D2A8FF',
  'Customs Clearance':  Colors.warning,
  'Customs Pending':    Colors.warning,
  'Arrived':            Colors.success,
  'Detained':           Colors.danger,
  'Loaded':             Colors.info,
  // Sea
  'Booked':                 '#38BDF8',
  'At Port of Loading':     '#818CF8',
  'Vessel Departed':        '#0EA5E9',
  'At Sea':                 Colors.primary,
  'At Port of Discharge':   '#818CF8',
  'Port Customs':           Colors.warning,
  // Air
  'Awaiting Flight':    '#7DD3FC',
  'In Flight':          '#38BDF8',
  'Arrived at Hub':     '#34D399',
};

const FILTER_OPTIONS = [
  { key: 'active',    label: 'Active',   color: Colors.primary },
  { key: 'all',       label: 'All',      color: Colors.textPrimary },
  { key: 'customs',   label: 'Customs',  color: Colors.warning },
  { key: 'arrived',   label: 'Arrived',  color: Colors.success },
  { key: 'detained',  label: 'Detained', color: Colors.danger },
];

function matchesFilter(s: Shipment, filter: string): boolean {
  switch (filter) {
    case 'active':   return isActiveStatus(s.status);
    case 'customs':  return isCustomsStatus(s.status);
    case 'arrived':  return s.status === 'Arrived' || s.status === 'Arrived at Hub';
    case 'detained': return s.status === 'Detained';
    default:         return true;
  }
}

function hasCoords(s: Shipment): boolean {
  return typeof s.lat === 'number' && typeof s.lng === 'number';
}

// ── Shipment row card ─────────────────────────────────────────────────────────
function ShipmentRow({
  shipment,
  onPress,
  isSelected,
}: {
  shipment: Shipment;
  onPress: (s: Shipment) => void;
  isSelected: boolean;
}) {
  const accentColor = STATUS_COLORS[shipment.status] ?? Colors.primary;
  return (
    <Pressable
      style={({ pressed }) => [
        rowStyles.row,
        isSelected && rowStyles.rowSelected,
        pressed && { opacity: 0.82 },
      ]}
      onPress={() => onPress(shipment)}
    >
      <View style={[rowStyles.accentBar, { backgroundColor: accentColor }]} />
      <View style={rowStyles.inner}>
        <View style={rowStyles.top}>
          <View style={rowStyles.tirWrap}>
            <MaterialIcons name="confirmation-number" size={11} color={Colors.textMuted} />
            <Text style={rowStyles.tirNum}>{shipment.tirNumber}</Text>
          </View>
          <StatusBadge status={shipment.status} size="sm" />
          {hasCoords(shipment) ? (
            <View style={rowStyles.gpsPill}>
              <MaterialIcons name="gps-fixed" size={9} color={Colors.success} />
              <Text style={rowStyles.gpsText}>GPS</Text>
            </View>
          ) : null}
        </View>
        <View style={rowStyles.route}>
          <View style={rowStyles.routeEndpoint}>
            <View style={[rowStyles.dot, { backgroundColor: Colors.primary }]} />
            <Text style={rowStyles.city} numberOfLines={1}>{shipment.origin}</Text>
          </View>
          <MaterialIcons name="arrow-right-alt" size={16} color={Colors.textMuted} style={{ marginHorizontal: 2 }} />
          <View style={rowStyles.routeEndpoint}>
            <View style={[rowStyles.dot, { backgroundColor: Colors.success }]} />
            <Text style={rowStyles.city} numberOfLines={1}>{shipment.destination}</Text>
          </View>
        </View>
        <View style={rowStyles.meta}>
          <MaterialIcons name="person" size={11} color={Colors.textMuted} />
          <Text style={rowStyles.metaText}>{shipment.driverName}</Text>
          <View style={rowStyles.metaDivider} />
          <MaterialIcons name="pin" size={11} color={Colors.textMuted} />
          <Text style={rowStyles.metaText}>{shipment.plateNumber}</Text>
          {shipment.estimatedArrival ? (
            <>
              <View style={rowStyles.metaDivider} />
              <MaterialIcons name="schedule" size={11} color={Colors.textMuted} />
              <Text style={rowStyles.metaText}>{shipment.estimatedArrival}</Text>
            </>
          ) : null}
        </View>
      </View>
      <MaterialIcons name="chevron-right" size={16} color={Colors.textMuted} style={{ flexShrink: 0 }} />
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  rowSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.cardHover,
  },
  accentBar: { width: 3, alignSelf: 'stretch' },
  inner: { flex: 1, padding: Spacing.md, gap: 5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tirWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  tirNum: { fontSize: FontSize.xs, color: Colors.textSecondary, fontFamily: 'monospace', letterSpacing: 0.3 },
  gpsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: `${Colors.success}12`, borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  gpsText: { fontSize: 8, color: Colors.success, fontWeight: '700', letterSpacing: 0.5 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  routeEndpoint: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  dot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  city: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  metaDivider: { width: 1, height: 10, backgroundColor: Colors.borderSubtle },
});

// ── Live counter (seconds until next refresh) ─────────────────────────────────
function RefreshCountdown({ interval, lastRefresh }: { interval: number; lastRefresh: number }) {
  const [remaining, setRemaining] = useState(interval);

  useEffect(() => {
    setRemaining(interval);
    const timer = setInterval(() => {
      setRemaining(prev => {
        const elapsed = Math.floor((Date.now() - lastRefresh) / 1000);
        const r = interval - (elapsed % interval);
        return r;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lastRefresh, interval]);

  return (
    <View style={countdownStyles.wrap}>
      <View style={[countdownStyles.track, { opacity: 0.35 }]} />
      <View style={[countdownStyles.fill, { flex: Math.max(0.001, (interval - remaining) / interval) }]} />
      <Text style={countdownStyles.text}>refresh in {remaining}s</Text>
    </View>
  );
}

const countdownStyles = StyleSheet.create({
  wrap: {
    height: 18,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    minWidth: 90,
    flexDirection: 'row',
  },
  track: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.primary,
  },
  fill: {
    // Uses flex to represent progress — avoids '100%' string cast crash on iOS production
    position: 'absolute', left: 0, top: 0, bottom: 0, right: 0,
    backgroundColor: `${Colors.primary}30`,
  },
  text: { fontSize: 9, color: Colors.textSecondary, fontWeight: '600', letterSpacing: 0.3 },
});

// ── Main Fleet Map Modal ───────────────────────────────────────────────────────
const REFRESH_INTERVAL_S = 15;

interface FleetMapModalProps {
  visible: boolean;
  onClose: () => void;
  shipments: Shipment[];
  onShipmentPress: (s: Shipment) => void;
  onRefresh?: () => Promise<void>;
}

export function FleetMapModal({
  visible, onClose, shipments, onShipmentPress, onRefresh,
}: FleetMapModalProps) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState('active');
  const [focusShipment, setFocusShipment] = useState<Shipment | null>(null);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState(() =>
    new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  const [listExpanded, setListExpanded] = useState(true);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const listHeightAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const screenH = Dimensions.get('window').height;

  // Live pulse dot animation
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.8, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(async () => {
      if (onRefresh) {
        setRefreshing(true);
        try { await onRefresh(); } catch {}
        setRefreshing(false);
      }
      setLastRefresh(Date.now());
      setLastRefreshTime(
        new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    }, REFRESH_INTERVAL_S * 1000);
    return () => clearInterval(interval);
  }, [visible, onRefresh]);

  // Toggle list height
  useEffect(() => {
    Animated.spring(listHeightAnim, {
      toValue: listExpanded ? 1 : 0,
      useNativeDriver: false,
      tension: 200, friction: 24,
    }).start();
    Animated.timing(rotateAnim, {
      toValue: listExpanded ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [listExpanded]);

  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const listMaxHeight = listHeightAnim.interpolate({ inputRange: [0, 1], outputRange: [0, screenH * 0.38] });

  const handleManualRefresh = useCallback(async () => {
    if (onRefresh) {
      setRefreshing(true);
      try { await onRefresh(); } catch {}
      setRefreshing(false);
    }
    setLastRefresh(Date.now());
    setLastRefreshTime(
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    );
  }, [onRefresh]);

  const filteredShipments = shipments.filter(s => matchesFilter(s, filter));
  const gpsShipments = filteredShipments.filter(hasCoords);
  const totalActive = shipments.filter(s => matchesFilter(s, 'active')).length;
  const totalTracked = shipments.filter(hasCoords).length;

  const handleShipmentRowPress = useCallback((s: Shipment) => {
    if (hasCoords(s)) {
      setFocusShipment(prev => prev?.id === s.id ? null : s);
    }
  }, []);

  const handleViewDetail = useCallback((s: Shipment) => {
    onClose();
    setTimeout(() => onShipmentPress(s), 300);
  }, [onClose, onShipmentPress]);

  // Reset focus when filter changes
  useEffect(() => { setFocusShipment(null); }, [filter]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar style="light" />
      <View style={[styles.root, { paddingTop: insets.top }]}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.brandIcon}>
              <MaterialIcons name="satellite-alt" size={15} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Fleet Tracker</Text>
              <View style={styles.liveRow}>
                <View style={styles.liveDotWrap}>
                  <Animated.View style={[styles.livePulse, { transform: [{ scale: pulseAnim }] }]} />
                  <View style={styles.liveDot} />
                </View>
                <Text style={styles.liveTxt}>LIVE</Text>
                <Text style={styles.updatedTxt}>· {lastRefreshTime}</Text>
              </View>
            </View>
          </View>

          <View style={styles.headerRight}>
            {/* Stats pills */}
            <View style={styles.statsPills}>
              <View style={styles.statPill}>
                <MaterialIcons name="route" size={11} color={Colors.info} />
                <Text style={[styles.statPillTxt, { color: Colors.info }]}>{totalActive} active</Text>
              </View>
              <View style={[styles.statPill, styles.statPillGps]}>
                <MaterialIcons name="gps-fixed" size={11} color={Colors.success} />
                <Text style={[styles.statPillTxt, { color: Colors.success }]}>{totalTracked} GPS</Text>
              </View>
            </View>

            {/* Refresh */}
            <Pressable
              style={({ pressed }) => [styles.iconBtn, refreshing && styles.iconBtnSpin, pressed && { opacity: 0.7 }]}
              onPress={handleManualRefresh}
              hitSlop={8}
            >
              <MaterialIcons
                name="refresh"
                size={18}
                color={refreshing ? Colors.primary : Colors.textSecondary}
              />
            </Pressable>

            {/* Close */}
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
              hitSlop={8}
            >
              <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* ── Refresh countdown bar ── */}
        <View style={styles.refreshBar}>
          <RefreshCountdown interval={REFRESH_INTERVAL_S} lastRefresh={lastRefresh} />
          <Text style={styles.filterCountTxt}>
            {gpsShipments.length} of {filteredShipments.length} with GPS ·{' '}
            {filteredShipments.length} shown
          </Text>
        </View>

        {/* ── Status filter chips ── */}
        <View style={styles.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
            {FILTER_OPTIONS.map(opt => {
              const count = shipments.filter(s => matchesFilter(s, opt.key)).length;
              const isActive = filter === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[
                    styles.filterChip,
                    isActive && { backgroundColor: `${opt.color}22`, borderColor: opt.color },
                  ]}
                  onPress={() => setFilter(opt.key)}
                >
                  {isActive && <View style={[styles.filterChipDot, { backgroundColor: opt.color }]} />}
                  <Text style={[styles.filterChipTxt, isActive && { color: opt.color, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                  <View style={[styles.filterChipBadge, isActive && { backgroundColor: opt.color }]}>
                    <Text style={[styles.filterChipBadgeTxt, isActive && { color: '#fff' }]}>{count}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Map ── */}
        <View style={styles.mapContainer}>
          {LiveMap ? (
            <LiveMap
              shipments={filteredShipments}
              focusShipment={focusShipment}
              height={undefined as any}
              showAllShipments
              onShipmentPress={handleViewDetail}
            />
          ) : (
            <View style={styles.mapFallback}>
              <View style={styles.mapFallbackIcon}>
                <MaterialIcons name="map" size={28} color={Colors.textMuted} />
              </View>
              <Text style={styles.mapFallbackTitle}>Map requires native build</Text>
              <Text style={styles.mapFallbackSub}>Download the APK to view live fleet positions.</Text>
            </View>
          )}

          {/* Focus badge overlay */}
          {focusShipment && (
            <View style={styles.focusBadge}>
              <MaterialIcons name="my-location" size={12} color={Colors.primary} />
              <Text style={styles.focusBadgeTxt}>Focused on {focusShipment.tirNumber}</Text>
              <Pressable onPress={() => setFocusShipment(null)} hitSlop={8}>
                <MaterialIcons name="close" size={12} color={Colors.textMuted} />
              </Pressable>
            </View>
          )}
        </View>

        {/* ── Shipment list panel ── */}
        <View style={[styles.listPanel, { paddingBottom: insets.bottom + 8 }]}>
          {/* List panel header / toggle */}
          <Pressable
            style={styles.listHeader}
            onPress={() => setListExpanded(v => !v)}
          >
            <View style={styles.listHeaderLeft}>
              <View style={styles.listDragHandle} />
            </View>
            <View style={styles.listHeaderCenter}>
              <MaterialIcons name="list" size={15} color={Colors.textSecondary} />
              <Text style={styles.listHeaderTitle}>
                {filteredShipments.length} shipment{filteredShipments.length !== 1 ? 's' : ''}
              </Text>
              {focusShipment ? (
                <View style={styles.listFocusChip}>
                  <Text style={styles.listFocusChipTxt}>1 focused</Text>
                </View>
              ) : null}
            </View>
            <Animated.View style={{ transform: [{ rotate }] }}>
              <MaterialIcons name="keyboard-arrow-up" size={18} color={Colors.textMuted} />
            </Animated.View>
          </Pressable>

          {/* Animated list */}
          <Animated.View style={[styles.listBody, { maxHeight: listMaxHeight }]}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {filteredShipments.length === 0 ? (
                <View style={styles.emptyList}>
                  <MaterialIcons name="local-shipping" size={28} color={Colors.border} />
                  <Text style={styles.emptyListTxt}>No shipments in this category</Text>
                </View>
              ) : (
                filteredShipments.map(s => (
                  <View key={s.id}>
                    <ShipmentRow
                      shipment={s}
                      onPress={handleShipmentRowPress}
                      isSelected={focusShipment?.id === s.id}
                    />
                    {/* Tap-to-detail button when selected */}
                    {focusShipment?.id === s.id && (
                      <Pressable
                        style={({ pressed }) => [styles.viewDetailBtn, pressed && { opacity: 0.85 }]}
                        onPress={() => handleViewDetail(s)}
                      >
                        <MaterialIcons name="open-in-new" size={14} color="#fff" />
                        <Text style={styles.viewDetailTxt}>View Shipment Details</Text>
                        <MaterialIcons name="arrow-forward" size={14} color="#fff" />
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, flexDirection: 'column' },

  // ── Header ────────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  brandIcon: {
    width: 36, height: 36, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  liveDotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  livePulse: {
    position: 'absolute', width: 12, height: 12, borderRadius: 6,
    backgroundColor: `${Colors.success}40`,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  liveTxt: { fontSize: 10, color: Colors.success, fontWeight: '700', letterSpacing: 1 },
  updatedTxt: { fontSize: 10, color: Colors.textMuted },
  statsPills: { flexDirection: 'row', gap: 5 },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.infoBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: `${Colors.info}25`,
  },
  statPillGps: {
    backgroundColor: Colors.successBg,
    borderColor: `${Colors.success}25`,
  },
  statPillTxt: { fontSize: 10, fontWeight: '700' },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  iconBtnSpin: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // ── Refresh bar ────────────────────────────────────────────────────────────────
  refreshBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: 7,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  filterCountTxt: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' },

  // ── Filter chips ──────────────────────────────────────────────────────────────
  filterBar: {
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    minHeight: 48,
  },
  filterContent: {
    paddingHorizontal: Spacing.lg, paddingVertical: 8, gap: 7,
    flexDirection: 'row', alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 11, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border, minHeight: 32,
  },
  filterChipDot: { width: 5, height: 5, borderRadius: 3 },
  filterChipTxt: { fontSize: FontSize.xs, fontWeight: '500', color: Colors.textSecondary },
  filterChipBadge: {
    backgroundColor: Colors.border, borderRadius: 8,
    minWidth: 18, height: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  filterChipBadgeTxt: { fontSize: 9, fontWeight: '700', color: Colors.textMuted },

  // ── Map ────────────────────────────────────────────────────────────────────────
  mapContainer: {
    flex: 1, position: 'relative', overflow: 'hidden',
  },
  mapFallback: {
    flex: 1, backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  mapFallbackIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  mapFallbackTitle: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textMuted },
  mapFallbackSub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  focusBadge: {
    position: 'absolute', top: 12, left: '50%',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(13,17,23,0.9)',
    borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary,
    transform: [{ translateX: -80 }],
    zIndex: 20,
  },
  focusBadgeTxt: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },

  // ── List panel ─────────────────────────────────────────────────────────────────
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
  listHeaderLeft: { flex: 0.2 },
  listDragHandle: {
    width: 32, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center',
  },
  listHeaderCenter: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 7,
  },
  listHeaderTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  listFocusChip: {
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  listFocusChipTxt: { fontSize: 9, color: Colors.primary, fontWeight: '700' },
  listBody: { overflow: 'hidden' },
  listScrollContent: {
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm,
  },
  emptyList: {
    alignItems: 'center', gap: 10, paddingVertical: Spacing.xxl,
  },
  emptyListTxt: { fontSize: FontSize.sm, color: Colors.textMuted },

  // Tap-to-detail button
  viewDetailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 10, marginBottom: Spacing.sm, marginTop: -4,
  },
  viewDetailTxt: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center' },
});
