import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Dimensions,
  Animated, Modal, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useShipments } from '@/hooks/useShipments';
import { useLanguage } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { ShipmentCard } from '@/components/feature/ShipmentCard';
import { AddShipmentModal } from '@/components/feature/AddShipmentModal';
import { SeaMapModal } from '@/components/feature/SeaMapModal';
// ShipmentDetail is lazily loaded — avoids pulling in SeaTrackingMap/LiveMap/react-native-maps
// on the mobile Shipments tab where it is never rendered (only used on desktop)
let _ShipmentDetail: React.ComponentType<any> | null = null;
function getLazyShipmentDetail() {
  if (!_ShipmentDetail) {
    try { _ShipmentDetail = require('@/components/feature/ShipmentDetail').ShipmentDetail; }
    catch { _ShipmentDetail = null; }
  }
  return _ShipmentDetail;
}
import { Shipment, ShipmentStatus } from '@/types';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

// ── Shimmer skeleton ──────────────────────────────────────────────────────────
function SkeletonBox({ w, h, radius = 6, style }: { w?: number | string; h: number; radius?: number; style?: any }) {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const bg = shimmer.interpolate({ inputRange: [0, 1], outputRange: [Colors.surface, Colors.card] });
  return (
    <Animated.View style={[{ width: w as any, height: h, borderRadius: radius, backgroundColor: bg }, style]} />
  );
}

function ShipmentSkeleton() {
  return (
    <View style={skelSt.card}>
      <View style={skelSt.strip} />
      <View style={skelSt.inner}>
        {/* Header row */}
        <View style={skelSt.headerRow}>
          <SkeletonBox w={32} h={32} radius={8} />
          <View style={{ flex: 1, gap: 5 }}>
            <SkeletonBox w={90} h={12} />
            <SkeletonBox w={40} h={8} />
          </View>
          <SkeletonBox w={64} h={20} radius={10} />
        </View>
        {/* Route row */}
        <View style={skelSt.routeRow}>
          <SkeletonBox w={'40%' as any} h={10} />
          <SkeletonBox w={24} h={8} />
          <SkeletonBox w={'40%' as any} h={10} />
        </View>
        {/* Progress bar */}
        <SkeletonBox w={'100%' as any} h={5} radius={3} />
        {/* Footer */}
        <View style={skelSt.footerRow}>
          <SkeletonBox w={110} h={8} />
          <SkeletonBox w={60} h={18} radius={9} />
        </View>
      </View>
      {/* Quick status row */}
      <View style={skelSt.qsRow}>
        <SkeletonBox w={90} h={10} />
        <View style={{ flex: 1 }} />
        <SkeletonBox w={50} h={18} radius={9} />
        <SkeletonBox w={70} h={18} radius={9} />
      </View>
    </View>
  );
}

const skelSt = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.card,
    flexDirection: 'row',
  },
  strip: { width: 3, backgroundColor: Colors.border },
  inner: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    paddingHorizontal: Spacing.lg, paddingVertical: 9,
  },
});

// ── Status options (all types) ────────────────────────────────────────────────
const ALL_STATUS_OPTIONS: { value: ShipmentStatus; label: string; color: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  // Road
  { value: 'Loaded',                label: 'Loaded',              color: Colors.info,      icon: 'inventory' },
  { value: 'Dispatched',            label: 'Dispatched',          color: '#D2A8FF',        icon: 'local-shipping' },
  { value: 'In Transit',            label: 'In Transit',          color: Colors.primary,   icon: 'directions-car' },
  { value: 'Border Crossing',       label: 'Border Crossing',     color: '#D2A8FF',        icon: 'swap-horiz' },
  { value: 'Customs Clearance',     label: 'Customs Clearance',   color: Colors.warning,   icon: 'verified-user' },
  { value: 'Customs Pending',       label: 'Customs Pending',     color: Colors.warning,   icon: 'pending-actions' },
  { value: 'Arrived',               label: 'Arrived',             color: Colors.success,   icon: 'check-circle' },
  { value: 'Detained',              label: 'Detained',            color: Colors.danger,    icon: 'block' },
  // Sea
  { value: 'Booked',                label: 'Booked',              color: '#38BDF8',        icon: 'bookmark' },
  { value: 'At Port of Loading',    label: 'At Port of Loading',  color: '#818CF8',        icon: 'anchor' },
  { value: 'Vessel Departed',       label: 'Vessel Departed',     color: '#0EA5E9',        icon: 'directions-boat' },
  { value: 'At Sea',                label: 'At Sea',              color: Colors.primary,   icon: 'water' },
  { value: 'At Port of Discharge',  label: 'At Port of Discharge',color: '#818CF8',        icon: 'anchor' },
  { value: 'Port Customs',          label: 'Port Customs',        color: Colors.warning,   icon: 'verified-user' },
  // Air
  { value: 'Awaiting Flight',       label: 'Awaiting Flight',     color: '#7DD3FC',        icon: 'schedule' },
  { value: 'In Flight',             label: 'In Flight',           color: '#38BDF8',        icon: 'flight' },
  { value: 'Arrived at Hub',        label: 'Arrived at Hub',      color: '#34D399',        icon: 'flight-land' },
];

// Road-only quick status options (for the Quick Status bottom sheet)
const ROAD_STATUS_OPTIONS = ALL_STATUS_OPTIONS.filter(o =>
  ['Loaded','Dispatched','In Transit','Border Crossing','Customs Clearance','Customs Pending','Arrived','Detained'].includes(o.value)
);
const SEA_STATUS_OPTIONS = ALL_STATUS_OPTIONS.filter(o =>
  ['Booked','Loaded','At Port of Loading','Vessel Departed','At Sea','At Port of Discharge','Port Customs','Customs Pending','Arrived','Detained'].includes(o.value)
);
const AIR_STATUS_OPTIONS = ALL_STATUS_OPTIONS.filter(o =>
  ['Loaded','Awaiting Flight','Dispatched','In Flight','Arrived at Hub','Customs Clearance','Customs Pending','Arrived','Detained'].includes(o.value)
);

function getStatusOptionsForType(type?: string) {
  if (type === 'Sea') return SEA_STATUS_OPTIONS;
  if (type === 'Air') return AIR_STATUS_OPTIONS;
  return ROAD_STATUS_OPTIONS;
}

// Safe lookup: always returns a valid option object
function findStatusOption(status: ShipmentStatus) {
  return ALL_STATUS_OPTIONS.find(o => o.value === status) ?? { value: status, label: status, color: Colors.textMuted, icon: 'circle' as keyof typeof MaterialIcons.glyphMap };
}

// ── Status filter chips (all types) ───────────────────────────────────────────
type FilterKey = ShipmentStatus | 'All';
type TypeFilter = 'All' | 'Road' | 'Air' | 'Sea';
type SortOrder = 'newest' | 'oldest';

interface ChipDef {
  key: FilterKey;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
}

const STATUS_CHIPS: ChipDef[] = [
  { key: 'All',                  label: 'All',         icon: 'layers',           color: Colors.textSecondary },
  // Road
  { key: 'Loaded',               label: 'Loaded',      icon: 'inventory',        color: Colors.info },
  { key: 'Dispatched',           label: 'Dispatched',  icon: 'local-shipping',   color: '#D2A8FF' },
  { key: 'In Transit',           label: 'In Transit',  icon: 'directions-car',   color: Colors.primary },
  { key: 'Border Crossing',      label: 'Border',      icon: 'swap-horiz',       color: '#D2A8FF' },
  { key: 'Customs Clearance',    label: 'Customs',     icon: 'verified-user',    color: Colors.warning },
  { key: 'Customs Pending',      label: 'Pending',     icon: 'pending-actions',  color: Colors.warning },
  { key: 'Arrived',              label: 'Arrived',     icon: 'check-circle',     color: Colors.success },
  { key: 'Detained',             label: 'Detained',    icon: 'block',            color: Colors.danger },
  // Sea
  { key: 'Booked',               label: 'Booked',      icon: 'bookmark',         color: '#38BDF8' },
  { key: 'At Port of Loading',   label: 'Port Load',   icon: 'anchor',           color: '#818CF8' },
  { key: 'Vessel Departed',      label: 'Departed',    icon: 'directions-boat',  color: '#0EA5E9' },
  { key: 'At Sea',               label: 'At Sea',      icon: 'water',            color: Colors.primary },
  { key: 'At Port of Discharge', label: 'Port Disch',  icon: 'anchor',           color: '#818CF8' },
  { key: 'Port Customs',         label: 'Port Customs',icon: 'verified-user',    color: Colors.warning },
  // Air
  { key: 'Awaiting Flight',      label: 'Awaiting',    icon: 'schedule',         color: '#7DD3FC' },
  { key: 'In Flight',            label: 'In Flight',   icon: 'flight',           color: '#38BDF8' },
  { key: 'Arrived at Hub',       label: 'At Hub',      icon: 'flight-land',      color: '#34D399' },
];

const TYPE_CHIPS: { key: TypeFilter; label: string; icon: keyof typeof MaterialIcons.glyphMap; color: string }[] = [
  { key: 'All',  label: 'All Types', icon: 'apps',            color: Colors.textSecondary },
  { key: 'Road', label: 'Road',      icon: 'local-shipping',  color: Colors.primary },
  { key: 'Air',  label: 'Air',       icon: 'flight',          color: Colors.info },
  { key: 'Sea',  label: 'Sea',       icon: 'directions-boat', color: '#58C4DC' },
];

function useScreenWidth() {
  const [width, setWidth] = useState(() => Dimensions.get('window').width);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setWidth(window.width));
    return () => sub?.remove();
  }, []);
  return width;
}

// ── Filter Chip ────────────────────────────────────────────────────────────────
// NOTE: Do NOT mix useNativeDriver:true and useNativeDriver:false on the same
// Animated.View — it crashes on iOS production. All animations here use JS driver only.
function FilterChip({
  label, icon, color, selected, count, onPress,
}: {
  label: string; icon: keyof typeof MaterialIcons.glyphMap; color: string;
  selected: boolean; count?: number; onPress: () => void;
}) {
  const bg = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(bg, { toValue: selected ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [selected]);

  const bgColor     = bg.interpolate({ inputRange: [0, 1], outputRange: [Colors.card, `${color}1E`] });
  const borderColor = bg.interpolate({ inputRange: [0, 1], outputRange: [Colors.border, color] });
  const labelColor  = bg.interpolate({ inputRange: [0, 1], outputRange: [Colors.textSecondary, color] });

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <Animated.View style={[chipSt.chip, { backgroundColor: bgColor, borderColor }]}>
        <MaterialIcons name={icon} size={12} color={selected ? color : Colors.textMuted} />
        <Animated.Text style={[chipSt.label, { color: labelColor }]}>{label}</Animated.Text>
        {typeof count === 'number' && count > 0 && (
          <View style={[chipSt.badge, { backgroundColor: selected ? `${color}28` : Colors.surface }]}>
            <Text style={[chipSt.badgeText, { color: selected ? color : Colors.textMuted }]}>{count}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const chipSt = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: BorderRadius.full, borderWidth: 1, minHeight: 34 },
  label: { fontSize: 12, fontWeight: '600' },
  badge: { borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  badgeText: { fontSize: 10, fontWeight: '700' },
});

// ── Type Pill (Road / Air / Sea) ───────────────────────────────────────────────
function TypePill({
  item, selected, onPress,
}: {
  item: typeof TYPE_CHIPS[number]; selected: boolean; onPress: () => void;
}) {
  const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: selected ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [selected]);
  const bg     = progress.interpolate({ inputRange: [0, 1], outputRange: [Colors.surface, `${item.color}1E`] });
  const border = progress.interpolate({ inputRange: [0, 1], outputRange: [Colors.border, item.color] });
  const label  = progress.interpolate({ inputRange: [0, 1], outputRange: [Colors.textSecondary, item.color] });
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <Animated.View style={[typeSt.pill, { backgroundColor: bg, borderColor: border }]}>
        <MaterialIcons name={item.icon} size={13} color={selected ? item.color : Colors.textMuted} />
        <Animated.Text style={[typeSt.label, { color: label }]}>{item.label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const typeSt = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: BorderRadius.md, borderWidth: 1 },
  label: { fontSize: FontSize.xs, fontWeight: '700', letterSpacing: 0.2 },
});

// ── Animated card wrapper ─────────────────────────────────────────────────────
function AnimatedCard({ children, index }: { children: React.ReactNode; index: number }) {
  const fade  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    const delay = Math.min(index * 30, 240);
    // Use Animated.timing for both — spring with delay+useNativeDriver is unreliable on iOS
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 200, delay, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 240, delay, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>{children}</Animated.View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function ShipmentsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ clientId?: string; clientName?: string }>();
  const { shipments, loading: shipmentsLoading, updateStatus, assignDriver, updateETA, setContainersLocal } = useShipments();
  const { t } = useLanguage();

  const [statusFilter, setStatusFilter] = useState<FilterKey>('All');
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('All');
  const [sortOrder,    setSortOrder]    = useState<SortOrder>('newest');
  const [search,       setSearch]       = useState('');
  const [clientFilter, setClientFilter] = useState<{ id: string; name: string } | null>(
    params.clientId ? { id: params.clientId, name: params.clientName ?? '' } : null
  );
  const [showAddModal,          setShowAddModal]          = useState(false);
  const [selectedShipment,      setSelectedShipment]      = useState<Shipment | null>(null);
  const [quickStatusShipment,   setQuickStatusShipment]   = useState<Shipment | null>(null);
  const [quickStatusUpdating,   setQuickStatusUpdating]   = useState(false);
  const [seaMapOpen,            setSeaMapOpen]            = useState(false);

  const seaShipmentCount = useMemo(() => shipments.filter(s => s.shipmentType === 'Sea').length, [shipments]);

  const screenWidth = useScreenWidth();
  const isDesktop   = screenWidth >= 1024;

  React.useEffect(() => {
    if (params.clientId) setClientFilter({ id: params.clientId, name: params.clientName ?? '' });
  }, [params.clientId, params.clientName]);

  // ── Counts ──────────────────────────────────────────────────────────────────
  const statusCounts = useMemo<Record<FilterKey, number>>(() => {
    const counts = { All: shipments.length } as Record<FilterKey, number>;
    // Pre-fill every possible key with 0 so no lookup ever returns undefined
    STATUS_CHIPS.forEach(c => { counts[c.key] = 0; });
    counts['All'] = shipments.length;
    shipments.forEach(s => {
      if (s.status in counts) counts[s.status] = (counts[s.status] ?? 0) + 1;
    });
    return counts;
  }, [shipments]);

  const typeCounts = useMemo<Record<TypeFilter, number>>(() => ({
    All:  shipments.length,
    Road: shipments.filter(s => (s.shipmentType ?? 'Road') === 'Road').length,
    Air:  shipments.filter(s => s.shipmentType === 'Air').length,
    Sea:  shipments.filter(s => s.shipmentType === 'Sea').length,
  }), [shipments]);

  // Active / in-customs / arrived summary — includes Sea + Air in-progress statuses
  const summary = useMemo(() => ({
    active:   shipments.filter(s => ['Dispatched','In Transit','Border Crossing','Loaded',
                                     'Booked','At Port of Loading','Vessel Departed','At Sea','At Port of Discharge',
                                     'Awaiting Flight','In Flight'].includes(s.status)).length,
    customs:  shipments.filter(s => ['Customs Clearance','Customs Pending','Port Customs'].includes(s.status)).length,
    arrived:  shipments.filter(s => ['Arrived','Arrived at Hub'].includes(s.status)).length,
    detained: shipments.filter(s => s.status === 'Detained').length,
  }), [shipments]);

  // ── Filtered + sorted list ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = shipments.filter(s => {
      const matchStatus = statusFilter === 'All' || s.status === statusFilter;
      const matchType   = typeFilter   === 'All' || (s.shipmentType ?? 'Road') === typeFilter;
      const matchClient = !clientFilter || s.clientId === clientFilter.id;
      const matchSearch = !q ||
        s.tirNumber.toLowerCase().includes(q) ||
        s.driverName.toLowerCase().includes(q) ||
        s.origin.toLowerCase().includes(q) ||
        s.destination.toLowerCase().includes(q) ||
        (s.clientName ?? '').toLowerCase().includes(q);
      return matchStatus && matchType && matchClient && matchSearch;
    });
    list = [...list].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sortOrder === 'newest' ? tb - ta : ta - tb;
    });
    return list;
  }, [shipments, statusFilter, typeFilter, search, sortOrder, clientFilter]);

  // Bump key to retrigger card animations on filter change
  const [listKey, setListKey] = useState(0);
  const prevKey = useRef({ statusFilter, typeFilter, sortOrder, search });
  useEffect(() => {
    const p = prevKey.current;
    if (p.statusFilter !== statusFilter || p.typeFilter !== typeFilter || p.sortOrder !== sortOrder || p.search !== search) {
      setListKey(k => k + 1);
      prevKey.current = { statusFilter, typeFilter, sortOrder, search };
    }
  }, [statusFilter, typeFilter, sortOrder, search]);

  const handleSelect = useCallback((s: Shipment) => {
    if (isDesktop) setSelectedShipment(s);
    else router.push({ pathname: '/shipment-detail', params: { id: s.id } });
  }, [isDesktop, router]);

  const hasActiveFilters = statusFilter !== 'All' || typeFilter !== 'All' || search.trim() !== '' || clientFilter !== null;

  const clearAllFilters = useCallback(() => {
    setStatusFilter('All');
    setTypeFilter('All');
    setSearch('');
    setClientFilter(null);
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      {/* ══════════ HEADER ══════════ */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconBox}>
            <MaterialIcons name="local-shipping" size={16} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('shipments.title')}</Text>
            <Text style={styles.headerSub}>{shipments.length} {t('shipments.totalManifests')}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {!isDesktop && <LanguagePicker compact />}
          {seaShipmentCount > 0 && (
            <Pressable
              style={({ pressed }) => [styles.seaMapBtn, pressed && { opacity: 0.85 }]}
              onPress={() => setSeaMapOpen(true)}
            >
              <MaterialIcons name="directions-boat" size={14} color="#58C4DC" />
              {!isDesktop && <Text style={styles.seaMapBtnText}>Sea</Text>}
              {seaShipmentCount > 0 && (
                <View style={styles.seaMapBadge}>
                  <Text style={styles.seaMapBadgeText}>{seaShipmentCount}</Text>
                </View>
              )}
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
            onPress={() => setShowAddModal(true)}
          >
            <MaterialIcons name="add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>{t('shipments.newShipment')}</Text>
          </Pressable>
        </View>
      </View>

      {/* ══════════ SUMMARY BAR ══════════ */}
      <View style={styles.summaryBar}>
        {[
          { label: 'Active',   value: summary.active,   color: Colors.primary,  icon: 'directions-car' as const },
          { label: 'Customs',  value: summary.customs,  color: Colors.warning,  icon: 'verified-user' as const },
          { label: 'Arrived',  value: summary.arrived,  color: Colors.success,  icon: 'check-circle' as const },
          { label: 'Detained', value: summary.detained, color: Colors.danger,   icon: 'block' as const },
        ].map((item, i, arr) => (
          <React.Fragment key={item.label}>
            <View style={styles.summaryItem}>
              <MaterialIcons name={item.icon} size={13} color={item.color} />
              <Text style={[styles.summaryValue, { color: item.color }]}>{item.value}</Text>
              <Text style={styles.summaryLabel}>{item.label}</Text>
            </View>
            {i < arr.length - 1 && <View style={styles.summarySep} />}
          </React.Fragment>
        ))}
      </View>

      <View style={styles.body}>
        {/* ══════════ LIST PANEL ══════════ */}
        <View style={[styles.listPanel, isDesktop && selectedShipment && styles.listPanelNarrow]}>

          {/* ── Search ── */}
          <View style={styles.searchWrap}>
            <MaterialIcons name="search" size={17} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t('shipments.searchPlaceholder')}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <MaterialIcons name="close" size={15} color={Colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* ── Type filter row ── */}
          <View style={styles.typeRow}>
            <View style={styles.typeRowLabel}>
              <MaterialIcons name="filter-list" size={12} color={Colors.textMuted} />
              <Text style={styles.typeRowLabelText}>TYPE</Text>
            </View>
            <View style={styles.typePills}>
              {TYPE_CHIPS.map(item => (
                <TypePill
                  key={item.key}
                  item={item}
                  selected={typeFilter === item.key}
                  onPress={() => setTypeFilter(item.key)}
                />
              ))}
            </View>
          </View>

          {/* ── Status filter chips + sort ── */}
          <View style={styles.filterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsContent}
            >
              {STATUS_CHIPS.map(chip => (
                <FilterChip
                  key={chip.key}
                  label={chip.label}
                  icon={chip.icon}
                  color={chip.color}
                  selected={statusFilter === chip.key}
                  count={statusCounts[chip.key] ?? 0}
                  onPress={() => setStatusFilter(chip.key)}
                />
              ))}
            </ScrollView>
            <Pressable
              style={({ pressed }) => [styles.sortBtn, pressed && { opacity: 0.75 }]}
              onPress={() => setSortOrder(o => o === 'newest' ? 'oldest' : 'newest')}
            >
              <MaterialIcons name="swap-vert" size={14} color={Colors.primary} />
              <Text style={styles.sortBtnText}>{sortOrder === 'newest' ? t('shipments.sortNewest') : t('shipments.sortOldest')}</Text>
            </Pressable>
          </View>

          {/* ── Active filter banner ── */}
          {(clientFilter || statusFilter !== 'All' || typeFilter !== 'All') && (
            <View style={styles.filterBanner}>
              <MaterialIcons name="filter-alt" size={13} color={Colors.primary} />
              <View style={styles.filterBannerChips}>
                {clientFilter && (
                  <View style={styles.activePill}>
                    <MaterialIcons name="business" size={10} color={Colors.primary} />
                    <Text style={styles.activePillText} numberOfLines={1}>{clientFilter.name}</Text>
                    <Pressable onPress={() => setClientFilter(null)} hitSlop={8}>
                      <MaterialIcons name="close" size={10} color={Colors.primary} />
                    </Pressable>
                  </View>
                )}
                {statusFilter !== 'All' && (
                  <View style={styles.activePill}>
                    <Text style={styles.activePillText}>{statusFilter}</Text>
                    <Pressable onPress={() => setStatusFilter('All')} hitSlop={8}>
                      <MaterialIcons name="close" size={10} color={Colors.primary} />
                    </Pressable>
                  </View>
                )}
                {typeFilter !== 'All' && (
                  <View style={styles.activePill}>
                    <Text style={styles.activePillText}>{typeFilter}</Text>
                    <Pressable onPress={() => setTypeFilter('All')} hitSlop={8}>
                      <MaterialIcons name="close" size={10} color={Colors.primary} />
                    </Pressable>
                  </View>
                )}
              </View>
              <Pressable style={styles.clearAllBtn} onPress={clearAllFilters} hitSlop={6}>
                <Text style={styles.clearAllText}>{t('common.clearAll')}</Text>
              </Pressable>
            </View>
          )}

          {/* ── Results bar ── */}
          <View style={styles.resultsBar}>
            <View style={styles.resultsLeft}>
              <Text style={styles.resultsCount}>{filtered.length}</Text>
              <Text style={styles.resultsLabel}>{filtered.length === 1 ? t('customer.resultsCount') : t('customer.resultsCountPlural')}</Text>
              {hasActiveFilters && <View style={styles.resultsDot} />}
              {hasActiveFilters && <Text style={styles.resultsFiltered}>{t('customer.filtersLabel')}</Text>}
            </View>
            {hasActiveFilters && (
              <Pressable style={styles.clearBtn} onPress={clearAllFilters} hitSlop={8}>
                <MaterialIcons name="close" size={10} color={Colors.textMuted} />
                <Text style={styles.clearBtnText}>{t('common.clearAll')}</Text>
              </Pressable>
            )}
          </View>

          {/* ── Cards ── */}
          <ScrollView key={listKey} style={styles.scroll} showsVerticalScrollIndicator={false}>
            {shipmentsLoading && shipments.length === 0 ? (
              <View style={styles.list}>
                {[0, 1, 2, 3].map(i => (
                  <AnimatedCard key={i} index={i}>
                    <ShipmentSkeleton />
                  </AnimatedCard>
                ))}
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <MaterialIcons name="local-shipping" size={30} color={Colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {shipments.length === 0 ? t('customer.emptyTitle') : t('customer.emptySearchTitle')}
                </Text>
                <Text style={styles.emptySub}>
                  {shipments.length === 0
                    ? t('shipments.noShipmentsSub')
                    : t('customer.emptySearchSub')}
                </Text>
                {hasActiveFilters ? (
                  <Pressable style={styles.emptyAction} onPress={clearAllFilters}>
                    <MaterialIcons name="filter-alt-off" size={14} color={Colors.primary} />
                    <Text style={styles.emptyActionText}>{t('common.clearAll')}</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.emptyAction} onPress={() => setShowAddModal(true)}>
                    <MaterialIcons name="add" size={14} color={Colors.primary} />
                    <Text style={styles.emptyActionText}>{t('shipments.newShipment')}</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={styles.list}>
                {filtered.map((s, i) => (
                  <AnimatedCard key={s.id} index={i}>
                    {/* Shipment type badge strip */}
                    <View style={styles.cardWrapper}>
                      <View style={[
                        styles.cardTypeStrip,
                        { backgroundColor: s.shipmentType === 'Air' ? Colors.info : s.shipmentType === 'Sea' ? '#58C4DC' : Colors.primary },
                      ]} />
                      <View style={styles.cardInner}>
                        <ShipmentCard
                          shipment={s}
                          onPress={handleSelect}
                          selected={isDesktop && selectedShipment?.id === s.id}
                        />
                        {/* Quick status row */}
                        <Pressable
                          style={({ pressed }) => [styles.quickStatusRow, pressed && { backgroundColor: Colors.cardHover }]}
                          onPress={() => setQuickStatusShipment(s)}
                        >
                          <MaterialIcons name="update" size={11} color={Colors.primary} />
                          <Text style={styles.quickStatusText}>{t('detail.updateStatus')}</Text>
                          <View style={styles.quickStatusSep} />
                          {/* Type pill */}
                          <View style={[
                            styles.typeBadge,
                            { backgroundColor: s.shipmentType === 'Air' ? `${Colors.info}18` : s.shipmentType === 'Sea' ? 'rgba(88,196,220,0.12)' : Colors.primaryGlow },
                          ]}>
                            <MaterialIcons
                              name={s.shipmentType === 'Air' ? 'flight' : s.shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping'}
                              size={10}
                              color={s.shipmentType === 'Air' ? Colors.info : s.shipmentType === 'Sea' ? '#58C4DC' : Colors.primary}
                            />
                            <Text style={[
                              styles.typeBadgeText,
                              { color: s.shipmentType === 'Air' ? Colors.info : s.shipmentType === 'Sea' ? '#58C4DC' : Colors.primary },
                            ]}>
                              {s.shipmentType ?? 'Road'}
                            </Text>
                          </View>
                          {/* Current status — safe lookup via findStatusOption */}
                          {(() => { const opt = findStatusOption(s.status); return (
                          <View style={[styles.statusMini, { backgroundColor: `${opt.color}14` }]}>
                            <Text style={[styles.statusMiniText, { color: opt.color }]}>
                              {s.status}
                            </Text>
                          </View>
                          ); })()}
                          <MaterialIcons name="chevron-right" size={13} color={Colors.textMuted} />
                        </Pressable>
                      </View>
                    </View>
                  </AnimatedCard>
                ))}
              </View>
            )}
            <View style={{ height: 100 }} />
          </ScrollView>
        </View>

        {/* ══════════ DETAIL PANEL (desktop) ══════════ */}
        {isDesktop && (
          <View style={styles.detailPanel}>
            {selectedShipment ? (
              (() => {
                const Detail = getLazyShipmentDetail();
                if (!Detail) return null;
                return (
                  <Detail
                    key={selectedShipment.id}
                    shipment={selectedShipment}
                    onClose={() => setSelectedShipment(null)}
                    onStatusChange={async (id: string, status: any) => {
                      await updateStatus(id, status);
                      setSelectedShipment((prev: any) => prev ? { ...prev, status } : prev);
                    }}
                    onDriverAssign={async (id: string, driverId: string | null, driverName: string, plateNumber: string) => {
                      await assignDriver(id, driverId, driverName, plateNumber);
                      setSelectedShipment((prev: any) => prev ? { ...prev, driverId: driverId ?? '', driverName, plateNumber } : prev);
                    }}
                    onETAChange={async (id: string, estimatedArrival: string) => {
                      await updateETA(id, estimatedArrival);
                      setSelectedShipment((prev: any) => prev ? { ...prev, estimatedArrival } : prev);
                    }}
                    onContainersChange={(id: string, containers: any) => {
                      setContainersLocal(id, containers);
                      setSelectedShipment((prev: any) => prev?.id === id ? { ...prev, containers } : prev);
                    }}
                  />
                );
              })()
            ) : (
              <View style={styles.detailEmpty}>
                <View style={styles.detailEmptyIcon}>
                  <MaterialIcons name="local-shipping" size={32} color={Colors.primary} />
                </View>
                <Text style={styles.detailEmptyTitle}>{t('shipments.selectShipment')}</Text>
                <Text style={styles.detailEmptySub}>{t('shipments.selectShipmentSub')}</Text>
                <Pressable style={styles.detailEmptyAction} onPress={() => setShowAddModal(true)}>
                  <MaterialIcons name="add" size={14} color={Colors.primary} />
                  <Text style={styles.detailEmptyActionText}>{t('shipments.newShipment')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>

      <AddShipmentModal visible={showAddModal} onClose={() => setShowAddModal(false)} />

      <SeaMapModal
        visible={seaMapOpen}
        onClose={() => setSeaMapOpen(false)}
        shipments={shipments}
        onViewDetail={(s) => {
          setSeaMapOpen(false);
          setTimeout(() => handleSelect(s), 350);
        }}
      />

      {/* ══════════ QUICK STATUS MODAL ══════════ */}
      <Modal visible={quickStatusShipment !== null} transparent animationType="slide" onRequestClose={() => setQuickStatusShipment(null)}>
        <Pressable style={styles.qsOverlay} onPress={() => !quickStatusUpdating && setQuickStatusShipment(null)}>
          <Pressable style={styles.qsSheet} onPress={e => e.stopPropagation()}>

            {/* Sheet handle */}
            <View style={styles.sheetHandle} />

            {/* Header */}
            <View style={styles.qsHeader}>
              <View style={styles.qsHeaderLeft}>
                <View style={styles.qsHeaderIcon}>
                  <MaterialIcons name="update" size={15} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.qsTitle}>{t('detail.updateStatus')}</Text>
                  <Text style={styles.qsSub} numberOfLines={1}>
                    {quickStatusShipment?.tirNumber}
                    {quickStatusShipment?.shipmentType ? (
                      <Text style={{ color: Colors.textMuted }}>{` · ${quickStatusShipment.shipmentType}`}</Text>
                    ) : null}
                  </Text>
                </View>
              </View>
              <Pressable style={styles.qsCloseBtn} onPress={() => setQuickStatusShipment(null)} disabled={quickStatusUpdating}>
                <MaterialIcons name="close" size={17} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {/* Current status strip — safe via findStatusOption */}
            {quickStatusShipment && (() => {
              const cur = findStatusOption(quickStatusShipment.status);
              return (
                <View style={[styles.qsCurrentStrip, { borderColor: `${cur.color}30` }]}>
                  <Text style={styles.qsCurrentStripLabel}>CURRENT</Text>
                  <View style={[styles.qsCurrentBadge, { backgroundColor: `${cur.color}18`, borderColor: `${cur.color}40` }]}>
                    <MaterialIcons name={cur.icon} size={12} color={cur.color} />
                    <Text style={[styles.qsCurrentBadgeText, { color: cur.color }]}>{quickStatusShipment.status}</Text>
                  </View>
                </View>
              );
            })()}

            {/* Options — type-aware list */}
            {(() => {
              const STATUS_OPTIONS = getStatusOptionsForType(quickStatusShipment?.shipmentType);
              return (
                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
                  {STATUS_OPTIONS.map((opt, i) => {
                    const isCurrent = quickStatusShipment?.status === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        style={({ pressed }) => [
                          styles.qsOption,
                          i < STATUS_OPTIONS.length - 1 && styles.qsOptionBorder,
                          isCurrent  && { backgroundColor: `${opt.color}08` },
                          pressed && !isCurrent && !quickStatusUpdating && { backgroundColor: `${opt.color}08` },
                        ]}
                        onPress={async () => {
                          if (isCurrent || !quickStatusShipment || quickStatusUpdating) return;
                          setQuickStatusUpdating(true);
                          await updateStatus(quickStatusShipment.id, opt.value);
                          setSelectedShipment(prev => prev?.id === quickStatusShipment.id ? { ...prev, status: opt.value } : prev);
                          setQuickStatusUpdating(false);
                          setQuickStatusShipment(null);
                        }}
                        disabled={isCurrent || quickStatusUpdating}
                      >
                        {isCurrent && <View style={[styles.qsActiveBar, { backgroundColor: opt.color }]} />}
                        <View style={[styles.qsOptIcon, { backgroundColor: `${opt.color}18`, borderColor: `${opt.color}35` }]}>
                          {quickStatusUpdating && !isCurrent
                            ? <ActivityIndicator size="small" color={opt.color} />
                            : <MaterialIcons name={opt.icon} size={16} color={opt.color} />}
                        </View>
                        <Text style={[styles.qsOptLabel, isCurrent && { color: opt.color, fontWeight: '700' }]}>
                          {opt.label}
                        </Text>
                        {isCurrent
                          ? <View style={[styles.qsCurrentPill, { backgroundColor: `${opt.color}18`, borderColor: `${opt.color}40` }]}>
                              <Text style={[styles.qsCurrentPillText, { color: opt.color }]}>CURRENT</Text>
                            </View>
                          : <MaterialIcons name="chevron-right" size={15} color={Colors.textMuted} />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              );
            })()}

            <View style={styles.qsFooter}>
              <Pressable style={styles.qsCancelBtn} onPress={() => setQuickStatusShipment(null)} disabled={quickStatusUpdating}>
                <Text style={styles.qsCancelText}>{t('detail.cancel')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerIconBox: {
    width: 36, height: 36, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  headerSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: 13, paddingVertical: 9,
  },
  addBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff' },

  // Sea Map button
  seaMapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(88,196,220,0.1)', borderRadius: BorderRadius.md,
    paddingHorizontal: 11, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.35)',
    position: 'relative',
  },
  seaMapBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: '#58C4DC' },
  seaMapBadge: {
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#58C4DC', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  seaMapBadgeText: { fontSize: 9, fontWeight: '800', color: '#0d1520' },

  // ── Summary bar ──────────────────────────────────────────────────────────────
  summaryBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingVertical: 10, paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  summaryItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  summaryValue: { fontSize: FontSize.base, fontWeight: '800' },
  summaryLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  summarySep: { width: 1, height: 20, backgroundColor: Colors.borderSubtle },

  body: { flex: 1, flexDirection: 'row' },
  listPanel:       { flex: 1 },
  listPanelNarrow: { flex: 0, width: 420, borderRightWidth: 1, borderRightColor: Colors.border },

  // ── Search ───────────────────────────────────────────────────────────────────
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    margin: Spacing.xl, marginBottom: 10,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: FontSize.sm, color: Colors.textPrimary },

  // ── Type row ─────────────────────────────────────────────────────────────────
  typeRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingBottom: 10,
  },
  typeRowLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  typeRowLabelText: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8 },
  typePills: { flexDirection: 'row', gap: Spacing.sm, flex: 1 },

  // ── Filter row ───────────────────────────────────────────────────────────────
  filterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 8,
  },
  chipsContent: {
    flexDirection: 'row', alignItems: 'center',
    gap: 7, paddingLeft: Spacing.xl, paddingRight: Spacing.sm,
  },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    marginRight: Spacing.xl,
  },
  sortBtnText: { fontSize: 11, fontWeight: '600', color: Colors.primary },

  // ── Active filter banner ──────────────────────────────────────────────────────
  filterBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.xl, marginBottom: 8,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  filterBannerChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  activePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(47,129,247,0.18)', borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  activePillText: { fontSize: 10, fontWeight: '600', color: Colors.primary },
  clearAllBtn: {
    backgroundColor: 'rgba(47,129,247,0.18)', borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  clearAllText: { fontSize: 10, fontWeight: '700', color: Colors.primary },

  // ── Results bar ───────────────────────────────────────────────────────────────
  resultsBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.sm,
  },
  resultsLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  resultsCount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  resultsLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  resultsDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.border },
  resultsFiltered: { fontSize: FontSize.xs, color: Colors.textMuted, fontStyle: 'italic' },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  clearBtnText: { fontSize: 10, fontWeight: '600', color: Colors.textMuted },

  scroll: { flex: 1 },
  list:   { paddingHorizontal: Spacing.xl, paddingTop: 4, gap: Spacing.md },

  // ── Card wrapper ──────────────────────────────────────────────────────────────
  cardWrapper: { flexDirection: 'row', borderRadius: BorderRadius.lg, overflow: 'hidden', ...Shadow.card },
  cardTypeStrip: { width: 3 },
  cardInner: { flex: 1 },

  // Quick status row
  quickStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    paddingHorizontal: Spacing.lg, paddingVertical: 9,
  },
  quickStatusText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary },
  quickStatusSep: { flex: 1 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: BorderRadius.full, paddingHorizontal: 7, paddingVertical: 3,
  },
  typeBadgeText: { fontSize: 9, fontWeight: '700' },
  statusMini: { borderRadius: BorderRadius.full, paddingHorizontal: 7, paddingVertical: 3 },
  statusMiniText: { fontSize: 9, fontWeight: '700' },

  // ── Empty state ───────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center', padding: 48, gap: Spacing.lg, marginTop: Spacing.xxxl,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  emptySub:   { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  emptyAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  emptyActionText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },

  // ── Detail panel ──────────────────────────────────────────────────────────────
  detailPanel: { flex: 1, backgroundColor: Colors.bg, overflow: 'hidden' },
  detailEmpty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.lg, padding: 60,
  },
  detailEmptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  detailEmptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  detailEmptySub: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22, maxWidth: 320,
  },
  detailEmptyAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  detailEmptyActionText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },

  // ── Quick status modal ────────────────────────────────────────────────────────
  qsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  qsSheet: {
    width: '100%', maxWidth: 520, alignSelf: 'center',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxl, borderTopRightRadius: BorderRadius.xxl,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  qsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  qsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  qsHeaderIcon: {
    width: 38, height: 38, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  qsTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  qsSub:   { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', marginTop: 2 },
  qsCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  qsCurrentStrip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: 10,
    backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  qsCurrentStripLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1 },
  qsCurrentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1,
  },
  qsCurrentBadgeText: { fontSize: FontSize.xs, fontWeight: '700' },
  qsOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: 13, position: 'relative',
  },
  qsOptionBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  qsActiveBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  qsOptIcon: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  qsOptLabel: { flex: 1, fontSize: FontSize.base, fontWeight: '500', color: Colors.textPrimary },
  qsCurrentPill: {
    borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
  },
  qsCurrentPillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  qsFooter: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border },
  qsCancelBtn: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingVertical: 13, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  qsCancelText: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textSecondary },
});
