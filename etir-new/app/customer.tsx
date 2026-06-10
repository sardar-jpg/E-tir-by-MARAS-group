import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Animated, Modal, RefreshControl,
  I18nManager,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { supabase } from '@/services/supabaseClient';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CheckpointProgress } from '@/components/ui/CheckpointProgress';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { useLanguage } from '@/hooks/useLanguage';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';
import { Shipment, ShipmentStatus, Client } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PortalNotification {
  id: string;
  shipmentId: string;
  tirNumber: string;
  oldStatus: ShipmentStatus;
  newStatus: ShipmentStatus;
  timestamp: number;
  read: boolean;
}

type DashTab = 'shipments' | 'notifications';

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapShipment(row: any): Shipment {
  return {
    id: row.id,
    tirNumber: row.tir_number,
    token: row.token ?? '',
    driverId: row.driver_id ?? '',
    driverName: row.driver_name ?? '',
    plateNumber: row.plate_number ?? '',
    origin: row.origin ?? '',
    destination: row.destination ?? '',
    cargoDescription: row.cargo_description ?? '',
    cargoValue: row.cargo_value ?? '',
    weight: row.weight ?? '',
    status: row.status as ShipmentStatus,
    checkpoints: Array.isArray(row.checkpoints) ? row.checkpoints : [],
    estimatedArrival: row.estimated_arrival ?? '',
    agreedPrice: row.agreed_price,
    priceAccepted: row.price_accepted ?? false,
    priceAcceptedAt: row.price_accepted_at,
    notes: row.notes,
    shipmentType: row.shipment_type ?? 'Road',
    airlineCarrier: row.airline_carrier,
    flightNumber: row.flight_number,
    mawbNumber: row.mawb_number,
    hawbNumber: row.hawb_number,
    airportOfOrigin: row.airport_of_origin,
    airportOfDestination: row.airport_of_destination,
    boardingTerminal: row.boarding_terminal,
    vesselName: row.vessel_name,
    voyageNumber: row.voyage_number,
    bolNumber: row.bol_number,
    containerNumber: row.container_number,
    portOfLoading: row.port_of_loading,
    portOfDischarge: row.port_of_discharge,
    shippingLine: row.shipping_line,
    clientId: row.client_id,
    clientName: row.client_name,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
    lat: row.lat,
    lng: row.lng,
  };
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Status meta ───────────────────────────────────────────────────────────────
const STATUS_META: Record<ShipmentStatus, { color: string; icon: keyof typeof MaterialIcons.glyphMap; label: string }> = {
  'Loaded':                  { color: '#79C0FF',        icon: 'inventory',        label: 'Loaded' },
  'Dispatched':              { color: '#D2A8FF',        icon: 'local-shipping',   label: 'Dispatched' },
  'Customs Clearance':       { color: Colors.warning,   icon: 'verified-user',    label: 'Customs' },
  'Customs Pending':         { color: Colors.warning,   icon: 'pending-actions',  label: 'Pending' },
  'Arrived':                 { color: Colors.success,   icon: 'check-circle',     label: 'Arrived' },
  'Detained':                { color: Colors.danger,    icon: 'block',            label: 'Detained' },
  'In Transit':              { color: Colors.primary,   icon: 'directions-car',   label: 'In Transit' },
  'Border Crossing':         { color: '#D2A8FF',        icon: 'swap-horiz',       label: 'Border' },
  'Booked':                  { color: '#38BDF8',        icon: 'bookmark',         label: 'Booked' },
  'At Port of Loading':      { color: '#818CF8',        icon: 'anchor',           label: 'At Port' },
  'Vessel Departed':         { color: '#0EA5E9',        icon: 'directions-boat',  label: 'Departed' },
  'At Sea':                  { color: Colors.primary,   icon: 'water',            label: 'At Sea' },
  'At Port of Discharge':    { color: '#818CF8',        icon: 'anchor',           label: 'Port Disc.' },
  'Port Customs':            { color: Colors.warning,   icon: 'verified-user',    label: 'Port Customs' },
  'Awaiting Flight':         { color: '#7DD3FC',        icon: 'schedule',         label: 'Awaiting' },
  'In Flight':               { color: '#38BDF8',        icon: 'flight',           label: 'In Flight' },
  'Arrived at Hub':          { color: '#34D399',        icon: 'flight-land',      label: 'Hub' },
};

// Status journey progressions per shipment type
const ROAD_JOURNEY: ShipmentStatus[] = ['Loaded', 'Dispatched', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived'];
const SEA_JOURNEY: ShipmentStatus[]  = ['Booked', 'Loaded', 'At Port of Loading', 'Vessel Departed', 'At Sea', 'At Port of Discharge', 'Port Customs', 'Arrived'];
const AIR_JOURNEY: ShipmentStatus[]  = ['Loaded', 'Awaiting Flight', 'Dispatched', 'In Flight', 'Arrived at Hub', 'Customs Clearance', 'Arrived'];

function getJourney(type: string): ShipmentStatus[] {
  if (type === 'Sea') return SEA_JOURNEY;
  if (type === 'Air') return AIR_JOURNEY;
  return ROAD_JOURNEY;
}

function getJourneyProgress(status: ShipmentStatus, type: string): number {
  const journey = getJourney(type);
  const idx = journey.indexOf(status);
  if (idx === -1) return 0;
  return (idx + 1) / journey.length;
}

type FilterKey = ShipmentStatus | 'All';

const FILTER_CHIPS: { key: FilterKey; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: 'All',                 label: 'All',        icon: 'layers' },
  { key: 'Arrived',             label: 'Arrived',    icon: 'check-circle' },
  { key: 'Customs Clearance',   label: 'Customs',    icon: 'verified-user' },
  { key: 'Customs Pending',     label: 'Pending',    icon: 'pending-actions' },
  { key: 'Detained',            label: 'Detained',   icon: 'block' },
  { key: 'In Transit',          label: 'Transit',    icon: 'directions-car' },
  { key: 'Border Crossing',     label: 'Border',     icon: 'swap-horiz' },
  { key: 'Booked',              label: 'Booked',     icon: 'bookmark' },
  { key: 'At Sea',              label: 'At Sea',     icon: 'water' },
  { key: 'Vessel Departed',     label: 'Vessel',     icon: 'directions-boat' },
  { key: 'At Port of Discharge', label: 'Port Disc', icon: 'anchor' },
  { key: 'Port Customs',        label: 'Port Cust',  icon: 'verified-user' },
  { key: 'In Flight',           label: 'In Flight',  icon: 'flight' },
  { key: 'Arrived at Hub',      label: 'Hub',        icon: 'flight-land' },
];

// ── Toast Banner ──────────────────────────────────────────────────────────────
function ToastBanner({ notif, onDismiss }: { notif: PortalNotification; onDismiss: () => void }) {
  const translateY = useRef(new Animated.Value(-90)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, tension: 200, friction: 15, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -90, duration: 260, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }, 4500);
    return () => clearTimeout(timer);
  }, [notif.id]);

  const newMeta = STATUS_META[notif.newStatus];
  const oldMeta = STATUS_META[notif.oldStatus];

  return (
    <Animated.View style={[toastSt.container, { transform: [{ translateY }], opacity }]}>
      <View style={[toastSt.accentBar, { backgroundColor: newMeta.color }]} />
      <View style={[toastSt.iconWrap, { backgroundColor: `${newMeta.color}20` }]}>
        <MaterialIcons name="notifications-active" size={16} color={newMeta.color} />
      </View>
      <View style={toastSt.textWrap}>
        <Text style={toastSt.title} numberOfLines={1}>
          Update · <Text style={{ color: Colors.primary, fontFamily: 'monospace' }}>{notif.tirNumber}</Text>
        </Text>
        <View style={toastSt.statusRow}>
          <Text style={[toastSt.statusOld, { color: oldMeta.color }]}>{notif.oldStatus}</Text>
          <MaterialIcons name="east" size={10} color={Colors.textMuted} />
          <View style={[toastSt.statusNewPill, { backgroundColor: `${newMeta.color}20`, borderColor: `${newMeta.color}40` }]}>
            <MaterialIcons name={newMeta.icon} size={9} color={newMeta.color} />
            <Text style={[toastSt.statusNewText, { color: newMeta.color }]}>{notif.newStatus}</Text>
          </View>
        </View>
      </View>
      <Pressable onPress={onDismiss} hitSlop={10} style={toastSt.closeBtn}>
        <MaterialIcons name="close" size={12} color={Colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

const toastSt = StyleSheet.create({
  container: {
    position: 'absolute', top: 10, left: Spacing.lg, right: Spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
    paddingRight: Spacing.md, paddingVertical: Spacing.md,
    zIndex: 999,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 12,
  },
  accentBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginLeft: -1 },
  iconWrap: {
    width: 34, height: 34, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: Spacing.sm,
  },
  textWrap: { flex: 1, gap: 3 },
  title: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusOld: { fontSize: 10, fontWeight: '500', textDecorationLine: 'line-through', opacity: 0.7 },
  statusNewPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: BorderRadius.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1,
  },
  statusNewText: { fontSize: 9, fontWeight: '700' },
  closeBtn: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
  },
});

// ── Notification Item ─────────────────────────────────────────────────────────
function NotifItem({ notif, last, alertDescText }: { notif: PortalNotification; last?: boolean; alertDescText: string }) {
  const newMeta = STATUS_META[notif.newStatus];
  const oldMeta = STATUS_META[notif.oldStatus];
  return (
    <View style={[notifSt.item, !last && notifSt.itemBorder, !notif.read && notifSt.itemUnread]}>
      {!notif.read && <View style={[notifSt.unreadStrip, { backgroundColor: newMeta.color }]} />}
      <View style={[notifSt.iconWrap, { backgroundColor: `${newMeta.color}18`, borderColor: `${newMeta.color}30` }]}>
        <MaterialIcons name={newMeta.icon} size={15} color={newMeta.color} />
      </View>
      <View style={notifSt.content}>
        <View style={notifSt.topRow}>
          <Text style={notifSt.tirText}>{notif.tirNumber}</Text>
          <Text style={notifSt.timeText}>{timeAgo(notif.timestamp)}</Text>
        </View>
        <Text style={notifSt.descText}>{alertDescText}</Text>
        <View style={notifSt.statusRow}>
          <View style={[notifSt.pill, { backgroundColor: `${oldMeta.color}12`, borderColor: `${oldMeta.color}25`, borderWidth: 1 }]}>
            <MaterialIcons name={oldMeta.icon} size={9} color={oldMeta.color} />
            <Text style={[notifSt.pillText, { color: oldMeta.color }]}>{notif.oldStatus}</Text>
          </View>
          <MaterialIcons name="east" size={10} color={Colors.textMuted} />
          <View style={[notifSt.pill, { backgroundColor: `${newMeta.color}18`, borderColor: `${newMeta.color}35`, borderWidth: 1 }]}>
            <MaterialIcons name={newMeta.icon} size={9} color={newMeta.color} />
            <Text style={[notifSt.pillText, { color: newMeta.color }]}>{notif.newStatus}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const notifSt = StyleSheet.create({
  item: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg, position: 'relative',
  },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  itemUnread: { backgroundColor: `${Colors.primary}06` },
  unreadStrip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  iconWrap: {
    width: 38, height: 38, borderRadius: BorderRadius.md,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  content: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tirText: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textPrimary, fontFamily: 'monospace' },
  timeText: { fontSize: 10, color: Colors.textMuted },
  descText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 9, fontWeight: '700' },
});

// ── Animated Filter Chip ─────────────────────────────────────────────────────
function Chip({ label, icon, color, selected, count, onPress }: {
  label: string; icon: keyof typeof MaterialIcons.glyphMap; color: string;
  selected: boolean; count?: number; onPress: () => void;
}) {
  const bg = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(bg, { toValue: selected ? 1 : 0, duration: 150, useNativeDriver: false }).start();
  }, [selected]);
  const bgColor  = bg.interpolate({ inputRange: [0, 1], outputRange: [Colors.card, `${color}1E`] });
  const bdColor  = bg.interpolate({ inputRange: [0, 1], outputRange: [Colors.border, color] });
  const txtColor = bg.interpolate({ inputRange: [0, 1], outputRange: [Colors.textSecondary, color] });
  return (
    <Pressable onPress={onPress}>
      <Animated.View style={[chipSt.chip, { backgroundColor: bgColor, borderColor: bdColor }]}>
        <MaterialIcons name={icon} size={11} color={selected ? color : Colors.textMuted} />
        <Animated.Text style={[chipSt.label, { color: txtColor }]}>{label}</Animated.Text>
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
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: BorderRadius.full, borderWidth: 1 },
  label: { fontSize: 11, fontWeight: '600' },
  badge: { borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  badgeText: { fontSize: 10, fontWeight: '700' },
});

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ShipmentProgressBar({ shipment }: { shipment: Shipment }) {
  const progress = getJourneyProgress(shipment.status, shipment.shipmentType ?? 'Road');
  const meta = STATUS_META[shipment.status];
  const isArrived = shipment.status === 'Arrived';
  const isDetained = shipment.status === 'Detained';
  const barColor = isDetained ? Colors.danger : meta.color;

  return (
    <View style={pbSt.wrap}>
      <View style={pbSt.track}>
        <View style={[pbSt.fill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: barColor }]} />
      </View>
      <Text style={[pbSt.pct, { color: barColor }]}>
        {isArrived ? '✓' : isDetained ? '!' : `${Math.round(progress * 100)}%`}
      </Text>
    </View>
  );
}
const pbSt = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  track: { flex: 1, height: 3, backgroundColor: Colors.borderSubtle, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
  pct: { fontSize: 9, fontWeight: '700', minWidth: 28, textAlign: 'right' },
});

// ── Shipment Card ────────────────────────────────────────────────────────────
function ShipmentCard({ shipment, onPress }: { shipment: Shipment; onPress: () => void }) {
  const typeIcon: keyof typeof MaterialIcons.glyphMap =
    shipment.shipmentType === 'Air' ? 'flight' : shipment.shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping';
  const typeColor = shipment.shipmentType === 'Air' ? Colors.info : shipment.shipmentType === 'Sea' ? '#58C4DC' : Colors.primary;
  const isDetained = shipment.status === 'Detained';

  return (
    <Pressable
      style={({ pressed }) => [scSt.card, pressed && { opacity: 0.92 }]}
      onPress={onPress}
    >
      <View style={[scSt.accentBar, { backgroundColor: isDetained ? Colors.danger : typeColor }]} />
      <View style={scSt.inner}>
        <View style={scSt.headerRow}>
          <View style={[scSt.typeIconWrap, { backgroundColor: `${typeColor}15`, borderColor: `${typeColor}28` }]}>
            <MaterialIcons name={typeIcon} size={14} color={typeColor} />
          </View>
          <View style={scSt.headerMid}>
            <Text style={scSt.tirNumber}>{shipment.tirNumber}</Text>
            <Text style={scSt.typeBadge}>{shipment.shipmentType ?? 'Road'}</Text>
          </View>
          <StatusBadge status={shipment.status} size="sm" />
        </View>
        <View style={scSt.routeRow}>
          <View style={scSt.routePoint}>
            <View style={[scSt.routeDot, { backgroundColor: Colors.primary }]} />
            <Text style={scSt.routeCity} numberOfLines={1}>{shipment.origin}</Text>
          </View>
          <View style={scSt.routeArrow}>
            <View style={scSt.routeLine} />
            <MaterialIcons name="arrow-forward" size={10} color={Colors.textMuted} />
            <View style={scSt.routeLine} />
          </View>
          <View style={[scSt.routePoint, { alignItems: 'flex-end' }]}>
            <View style={[scSt.routeDot, { backgroundColor: Colors.success }]} />
            <Text style={scSt.routeCity} numberOfLines={1}>{shipment.destination}</Text>
          </View>
        </View>
        <ShipmentProgressBar shipment={shipment} />
        <View style={scSt.footer}>
          <View style={scSt.footerLeft}>
            <MaterialIcons name="inventory-2" size={10} color={Colors.textMuted} />
            <Text style={scSt.footerText} numberOfLines={1}>{shipment.cargoDescription}</Text>
          </View>
          <View style={scSt.footerRight}>
            {shipment.estimatedArrival ? (
              <View style={scSt.etaPill}>
                <MaterialIcons name={shipment.shipmentType === 'Sea' ? 'directions-boat' : 'schedule'} size={9} color={Colors.primary} />
                <Text style={scSt.etaText}>{shipment.estimatedArrival}</Text>
              </View>
            ) : null}
            <MaterialIcons name="chevron-right" size={14} color={Colors.textMuted} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const scSt = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', ...Shadow.card,
  },
  accentBar: { height: 3 },
  inner: { padding: Spacing.lg, gap: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  typeIconWrap: { width: 32, height: 32, borderRadius: BorderRadius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerMid: { flex: 1, gap: 1 },
  tirNumber: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textPrimary, fontFamily: 'monospace' },
  typeBadge: { fontSize: 9, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  routePoint: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  routeDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  routeCity: { flex: 1, fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  routeArrow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  routeLine: { width: 8, height: 1, backgroundColor: Colors.borderSubtle },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { fontSize: 10, color: Colors.textMuted, flex: 1 },
  etaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  etaText: { fontSize: 9, fontWeight: '700', color: Colors.primary },
});

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon, value, label, color, sublabel }: {
  icon: keyof typeof MaterialIcons.glyphMap; value: number; label: string; color: string; sublabel?: string;
}) {
  return (
    <View style={[statSt.card, { borderTopColor: color }]}>
      <View style={[statSt.iconWrap, { backgroundColor: `${color}15` }]}>
        <MaterialIcons name={icon} size={16} color={color} />
      </View>
      <Text style={[statSt.value, { color }]}>{value}</Text>
      <Text style={statSt.label}>{label}</Text>
      {sublabel ? <Text style={statSt.sublabel}>{sublabel}</Text> : null}
    </View>
  );
}
const statSt = StyleSheet.create({
  card: {
    width: 82, alignItems: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md,
    borderTopWidth: 3,
  },
  iconWrap: { width: 32, height: 32, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: FontSize.xxl, fontWeight: '800', lineHeight: 28 },
  label: { fontSize: 10, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' },
  sublabel: { fontSize: 9, color: Colors.textMuted, textAlign: 'center', opacity: 0.7 },
});

// ── Journey Progress in Detail Modal ─────────────────────────────────────────
function JourneyTimeline({ shipment }: { shipment: Shipment }) {
  const journey = getJourney(shipment.shipmentType ?? 'Road');
  const currentIdx = journey.indexOf(shipment.status);
  const isDetained = shipment.status === 'Detained';
  if (isDetained) return null;

  return (
    <View style={jtSt.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={jtSt.scroll}>
        {journey.map((step, i) => {
          const isDone = currentIdx >= 0 ? i <= currentIdx : false;
          const isCurrent = i === currentIdx;
          const meta = STATUS_META[step];
          return (
            <React.Fragment key={step}>
              <View style={jtSt.stepWrap}>
                <View style={[jtSt.stepCircle,
                  isDone && { backgroundColor: `${meta.color}20`, borderColor: meta.color },
                  isCurrent && { borderWidth: 2 },
                ]}>
                  <MaterialIcons name={meta.icon} size={12} color={isDone ? meta.color : Colors.textMuted} />
                  {isCurrent && <View style={[jtSt.activePulse, { borderColor: meta.color }]} />}
                </View>
                <Text style={[jtSt.stepLabel, isDone && { color: meta.color }]} numberOfLines={2}>{meta.label}</Text>
              </View>
              {i < journey.length - 1 && (
                <View style={[jtSt.connector, { backgroundColor: i < currentIdx ? STATUS_META[journey[i]].color : Colors.borderSubtle }]} />
              )}
            </React.Fragment>
          );
        })}
      </ScrollView>
    </View>
  );
}

const jtSt = StyleSheet.create({
  wrap: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, paddingVertical: Spacing.lg, overflow: 'hidden' },
  scroll: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.lg, gap: 0 },
  stepWrap: { alignItems: 'center', width: 60, gap: 5 },
  stepCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  activePulse: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 19, borderWidth: 1.5, opacity: 0.4 },
  stepLabel: { fontSize: 9, fontWeight: '600', color: Colors.textMuted, textAlign: 'center', lineHeight: 12 },
  connector: { width: 18, height: 2, alignSelf: 'center', borderRadius: 1, marginBottom: 16, flexShrink: 0 },
});

// ── Detail Modal ─────────────────────────────────────────────────────────────
function ShipmentDetailModal({ shipment, onClose, t }: { shipment: Shipment; onClose: () => void; t: (k: any) => string }) {
  const meta = STATUS_META[shipment.status];
  const typeIcon: keyof typeof MaterialIcons.glyphMap =
    shipment.shipmentType === 'Air' ? 'flight' : shipment.shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping';
  const typeColor = shipment.shipmentType === 'Air' ? Colors.info : shipment.shipmentType === 'Sea' ? '#58C4DC' : Colors.primary;
  const isDetained = shipment.status === 'Detained';
  const isArrived = shipment.status === 'Arrived';
  const isRtl = I18nManager.getConstants().isRTL;

  const renderInfoRow = (label: string, value: string, last?: boolean, mono?: boolean) => (
    <View style={[detSt.row, !last && detSt.rowBorder]} key={label}>
      <Text style={detSt.rowLabel}>{label}</Text>
      <Text style={[detSt.rowValue, mono && detSt.rowMono]}>{value || '—'}</Text>
    </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={detSt.root}>
        {/* Header */}
        <View style={[detSt.header, isDetained && { borderBottomColor: `${Colors.danger}40` }]}>
          {isDetained && <View style={detSt.detainedBar} />}
          <View style={detSt.headerLeft}>
            <View style={[detSt.typeIconWrap, { backgroundColor: `${isDetained ? Colors.danger : typeColor}18`, borderColor: `${isDetained ? Colors.danger : typeColor}35` }]}>
              <MaterialIcons name={isDetained ? 'block' : typeIcon} size={20} color={isDetained ? Colors.danger : typeColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={detSt.tirNumber}>{shipment.tirNumber}</Text>
              <View style={detSt.headerSubRow}>
                <View style={[detSt.typePill, { backgroundColor: `${typeColor}15`, borderColor: `${typeColor}30` }]}>
                  <MaterialIcons name={typeIcon} size={9} color={typeColor} />
                  <Text style={[detSt.typePillText, { color: typeColor }]}>{shipment.shipmentType ?? 'Road'}</Text>
                </View>
                <StatusBadge status={shipment.status} size="sm" />
              </View>
            </View>
          </View>
          <Pressable style={detSt.closeBtn} onPress={onClose}>
            <MaterialIcons name="close" size={17} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Route Banner */}
          <View style={[detSt.routeBanner, isRtl && { flexDirection: 'row-reverse' }]}>
            <View style={[detSt.routeEndpoint, isRtl && { flexDirection: 'row-reverse' }]}>
              <View style={[detSt.routeDot, { backgroundColor: Colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={detSt.routeEndpointLabel}>{t('customer.originLabel')}</Text>
                <Text style={detSt.routeEndpointCity} numberOfLines={2}>{shipment.origin}</Text>
              </View>
            </View>
            <View style={detSt.routeCenter}>
              <View style={detSt.routeHalfLine} />
              <View style={[detSt.routeCenterIcon, { backgroundColor: `${typeColor}18`, borderColor: `${typeColor}35` }]}>
                <MaterialIcons name={typeIcon} size={13} color={typeColor} />
              </View>
              <View style={detSt.routeHalfLine} />
            </View>
            <View style={[detSt.routeEndpoint, { alignItems: 'flex-end' }, isRtl && { flexDirection: 'row-reverse' }]}>
              <View style={[detSt.routeDot, { backgroundColor: Colors.success }]} />
              <View style={{ flex: 1, alignItems: isRtl ? 'flex-start' : 'flex-end' }}>
                <Text style={detSt.routeEndpointLabel}>{t('customer.destinationLabel')}</Text>
                <Text style={[detSt.routeEndpointCity, { textAlign: isRtl ? 'left' : 'right' }]} numberOfLines={2}>{shipment.destination}</Text>
              </View>
            </View>
          </View>

          {/* Status section */}
          <View style={detSt.section}>
            <View style={detSt.sectionHeader}>
              <View style={detSt.sectionIconWrap}><MaterialIcons name="timeline" size={11} color={Colors.primary} /></View>
              <Text style={detSt.sectionTitle}>{t('customer.currentStatusTitle')}</Text>
            </View>
            <View style={[detSt.statusCard, { borderColor: `${meta.color}35`, borderLeftWidth: 3, borderLeftColor: meta.color }]}>
              <View style={[detSt.statusCardIcon, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}35` }]}>
                <MaterialIcons name={meta.icon} size={22} color={meta.color} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[detSt.statusCardLabel, { color: meta.color }]}>{shipment.status}</Text>
                {shipment.estimatedArrival ? (
                  <View style={detSt.etaRow}>
                    <MaterialIcons name={shipment.shipmentType === 'Sea' ? 'directions-boat' : 'schedule'} size={11} color={Colors.textMuted} />
                    <Text style={detSt.statusCardEta}>
                      {shipment.shipmentType === 'Sea' ? t('customer.portEta') : t('customer.eta')}: {shipment.estimatedArrival}
                    </Text>
                  </View>
                ) : null}
              </View>
              {isArrived && (
                <View style={detSt.arrivedBadge}>
                  <MaterialIcons name="verified" size={13} color={Colors.success} />
                  <Text style={detSt.arrivedBadgeText}>{t('customer.deliveredLabel')}</Text>
                </View>
              )}
              {isDetained && (
                <View style={[detSt.arrivedBadge, { backgroundColor: Colors.dangerBg }]}>
                  <MaterialIcons name="warning" size={13} color={Colors.danger} />
                  <Text style={[detSt.arrivedBadgeText, { color: Colors.danger }]}>{t('customer.actionReqLabel')}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Journey Timeline */}
          {!isDetained && (
            <View style={detSt.section}>
              <View style={detSt.sectionHeader}>
                <View style={detSt.sectionIconWrap}><MaterialIcons name="route" size={11} color={Colors.primary} /></View>
                <Text style={detSt.sectionTitle}>{t('customer.journeyTitle')}</Text>
                <View style={{ flex: 1 }} />
                <Text style={detSt.progressPct}>
                  {Math.round(getJourneyProgress(shipment.status, shipment.shipmentType ?? 'Road') * 100)}{t('customer.percentComplete')}
                </Text>
              </View>
              <JourneyTimeline shipment={shipment} />
            </View>
          )}

          {/* Cargo Details */}
          <View style={detSt.section}>
            <View style={detSt.sectionHeader}>
              <View style={detSt.sectionIconWrap}><MaterialIcons name="inventory" size={11} color={Colors.primary} /></View>
              <Text style={detSt.sectionTitle}>{t('customer.cargoTitle')}</Text>
            </View>
            <View style={detSt.infoCard}>
              {renderInfoRow(t('customer.cargoDesc'), shipment.cargoDescription)}
              {renderInfoRow(t('customer.weight'), shipment.weight)}
              {renderInfoRow(t('customer.cargoValue'), shipment.cargoValue)}
              {renderInfoRow(t('customer.tirNumber'), shipment.tirNumber, false, true)}
              {shipment.driverName ? renderInfoRow(t('customer.driver'), shipment.driverName) : null}
              {renderInfoRow(t('customer.created'), new Date(shipment.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), true)}
            </View>
          </View>

          {/* Air details */}
          {shipment.shipmentType === 'Air' && (shipment.airlineCarrier || shipment.flightNumber) && (
            <View style={detSt.section}>
              <View style={detSt.sectionHeader}>
                <View style={[detSt.sectionIconWrap, { backgroundColor: `${Colors.info}15`, borderColor: `${Colors.info}30` }]}><MaterialIcons name="flight" size={11} color={Colors.info} /></View>
                <Text style={detSt.sectionTitle}>{t('customer.flightTitle')}</Text>
              </View>
              <View style={detSt.infoCard}>
                {shipment.airlineCarrier ? renderInfoRow(t('customer.airline'), shipment.airlineCarrier) : null}
                {shipment.flightNumber ? renderInfoRow(t('customer.flightNo'), shipment.flightNumber, false, true) : null}
                {shipment.mawbNumber ? renderInfoRow(t('customer.mawb'), shipment.mawbNumber, false, true) : null}
                {shipment.hawbNumber ? renderInfoRow(t('customer.hawb'), shipment.hawbNumber, false, true) : null}
                {shipment.airportOfOrigin ? renderInfoRow(t('customer.airportOrigin'), shipment.airportOfOrigin) : null}
                {shipment.airportOfDestination ? renderInfoRow(t('customer.airportDest'), shipment.airportOfDestination, true) : null}
              </View>
            </View>
          )}

          {/* Sea details */}
          {shipment.shipmentType === 'Sea' && (shipment.vesselName || shipment.bolNumber) && (
            <View style={detSt.section}>
              <View style={detSt.sectionHeader}>
                <View style={[detSt.sectionIconWrap, { backgroundColor: '#58C4DC15', borderColor: '#58C4DC30' }]}><MaterialIcons name="directions-boat" size={11} color="#58C4DC" /></View>
                <Text style={detSt.sectionTitle}>{t('customer.vesselTitle')}</Text>
              </View>
              <View style={detSt.infoCard}>
                {shipment.vesselName ? renderInfoRow(t('customer.vessel'), shipment.vesselName) : null}
                {shipment.voyageNumber ? renderInfoRow(t('customer.voyageNo'), shipment.voyageNumber, false, true) : null}
                {shipment.bolNumber ? renderInfoRow(t('customer.bol'), shipment.bolNumber, false, true) : null}
                {shipment.containerNumber ? renderInfoRow(t('customer.container'), shipment.containerNumber, false, true) : null}
                {shipment.shippingLine ? renderInfoRow(t('customer.shippingLine'), shipment.shippingLine) : null}
                {shipment.portOfLoading ? renderInfoRow(t('customer.portOfLoading'), shipment.portOfLoading) : null}
                {shipment.portOfDischarge ? renderInfoRow(t('customer.portOfDischarge'), shipment.portOfDischarge, true) : null}
              </View>
            </View>
          )}

          {/* Checkpoints */}
          {shipment.checkpoints && shipment.checkpoints.length > 0 && (
            <View style={detSt.section}>
              <View style={detSt.sectionHeader}>
                <View style={detSt.sectionIconWrap}><MaterialIcons name="place" size={11} color={Colors.primary} /></View>
                <Text style={detSt.sectionTitle}>{t('customer.checkpointsTitle')}</Text>
              </View>
              <View style={detSt.checkpointsCard}>
                <CheckpointProgress checkpoints={shipment.checkpoints} compact />
              </View>
            </View>
          )}

          {/* Notes */}
          {shipment.notes ? (
            <View style={detSt.section}>
              <View style={detSt.sectionHeader}>
                <View style={detSt.sectionIconWrap}><MaterialIcons name="comment" size={11} color={Colors.primary} /></View>
                <Text style={detSt.sectionTitle}>{t('customer.notesTitle')}</Text>
              </View>
              <View style={detSt.notesCard}>
                <MaterialIcons name="format-quote" size={18} color="rgba(47,129,247,0.2)" style={{ alignSelf: 'flex-start' }} />
                <Text style={detSt.notesText}>{shipment.notes}</Text>
              </View>
            </View>
          ) : null}

          <View style={{ height: 48 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const detSt = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
    position: 'relative',
  },
  detainedBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: Colors.danger },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  typeIconWrap: { width: 46, height: 46, borderRadius: BorderRadius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tirNumber: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, fontFamily: 'monospace' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: BorderRadius.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  typePillText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  routeBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, gap: Spacing.sm,
  },
  routeEndpoint: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  routeDot: { width: 9, height: 9, borderRadius: 5, marginTop: 14, flexShrink: 0 },
  routeEndpointLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, marginBottom: 2 },
  routeEndpointCity: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, lineHeight: 19 },
  routeCenter: { alignItems: 'center', gap: 3, paddingHorizontal: Spacing.sm, flexShrink: 0 },
  routeHalfLine: { height: 1, width: 16, backgroundColor: Colors.borderSubtle },
  routeCenterIcon: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  section: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionIconWrap: { width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9 },
  progressPct: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, padding: Spacing.lg },
  statusCardIcon: { width: 48, height: 48, borderRadius: BorderRadius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statusCardLabel: { fontSize: FontSize.base, fontWeight: '800' },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusCardEta: { fontSize: FontSize.xs, color: Colors.textMuted },
  arrivedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successBg, borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 5, flexShrink: 0 },
  arrivedBadgeText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.success },
  infoCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  rowLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  rowValue: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary, flexShrink: 1, textAlign: 'right', marginLeft: Spacing.md, flex: 1.5 },
  rowMono: { fontFamily: 'monospace', color: Colors.primary },
  checkpointsCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg },
  notesCard: { backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)', padding: Spacing.lg, gap: Spacing.sm },
  notesText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
});

// ══════════════════════════════════════════════════════════════════════════════
// ── MAIN CUSTOMER PORTAL ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function CustomerPortal() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const isRtl = language === 'ar';

  // ── Auth state ────────────────────────────────────────────────────────────
  const [authLoading, setAuthLoading]     = useState(true);
  const [session, setSession]             = useState<any>(null);
  const [clientRecord, setClientRecord]   = useState<Client | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [noAccount, setNoAccount]         = useState(false);

  // ── Login form ────────────────────────────────────────────────────────────
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError]     = useState('');
  const [isRegister, setIsRegister]     = useState(false);
  const [registerName, setRegisterName] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  // ── OTP Verification ─────────────────────────────────────────────────────
  const [pendingOtp, setPendingOtp]         = useState(false);
  const [otpDigits, setOtpDigits]           = useState(['', '', '', '']);
  const [otpLoading, setOtpLoading]         = useState(false);
  const [otpError, setOtpError]             = useState('');
  const [otpResending, setOtpResending]     = useState(false);
  const [otpResendMsg, setOtpResendMsg]     = useState('');
  const otpRefs = [
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
  ];

  // ── Forgot password ───────────────────────────────────────────────────────
  const [showForgot, setShowForgot]   = useState(false);
  const [fpEmail, setFpEmail]         = useState('');
  const [fpLoading, setFpLoading]     = useState(false);
  const [fpSent, setFpSent]           = useState(false);
  const [fpError, setFpError]         = useState('');

  // ── Shipments ─────────────────────────────────────────────────────────────
  const [shipments, setShipments]               = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [filter, setFilter]                     = useState<FilterKey>('All');
  const [search, setSearch]                     = useState('');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifications, setNotifications]   = useState<PortalNotification[]>([]);
  const [activeTab, setActiveTab]           = useState<DashTab>('shipments');
  const [toastNotif, setToastNotif]         = useState<PortalNotification | null>(null);
  const prevStatusMapRef                    = useRef<Record<string, ShipmentStatus>>({});
  const pollingRef                          = useRef<ReturnType<typeof setInterval> | null>(null);
  const clientIdRef                         = useRef<string | null>(null);
  const isInitialLoadRef                    = useRef(true);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  // ── Entrance anim ─────────────────────────────────────────────────────────
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 380, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 130, friction: 16, useNativeDriver: true }),
    ]).start();
  }, [session]);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load client record after login ────────────────────────────────────────
  useEffect(() => {
    if (!session?.user?.email) return;
    setClientLoading(true);
    supabase
      .from('clients')
      .select('*')
      .eq('email', session.user.email)
      .maybeSingle()
      .then(({ data }) => {
        setClientLoading(false);
        if (data) {
          clientIdRef.current = data.id;
          setClientRecord({
            id: data.id, name: data.name, company: data.company,
            email: data.email, phone: data.phone, country: data.country,
            city: data.city, notes: data.notes,
            createdAt: data.created_at, updatedAt: data.updated_at,
          });
          setNoAccount(false);
          isInitialLoadRef.current = true;
          loadShipments(data.id);
        } else {
          setNoAccount(true);
        }
      });
  }, [session?.user?.email]);

  // ── Load shipments ────────────────────────────────────────────────────────
  const loadShipments = useCallback(async (clientId: string, isPoll = false) => {
    if (!isPoll) setShipmentsLoading(true);
    const { data } = await supabase
      .from('shipments')
      .select('*, checkpoints(id, name, location, status, sort_order, timestamp)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (!isPoll) setShipmentsLoading(false);
    if (!data) return;

    const mapped: Shipment[] = data.map(row => ({
      ...mapShipment(row),
      checkpoints: (row.checkpoints ?? [])
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((cp: any) => ({
          id: cp.id, name: cp.name, location: cp.location,
          status: cp.status as any, timestamp: cp.timestamp,
        })),
    }));

    if (isPoll && !isInitialLoadRef.current) {
      const newNotifs: PortalNotification[] = [];
      mapped.forEach(s => {
        const prev = prevStatusMapRef.current[s.id];
        if (prev && prev !== s.status) {
          newNotifs.push({
            id: `${s.id}-${Date.now()}`,
            shipmentId: s.id,
            tirNumber: s.tirNumber,
            oldStatus: prev,
            newStatus: s.status,
            timestamp: Date.now(),
            read: false,
          });
        }
      });
      if (newNotifs.length > 0) {
        setNotifications(prev => [...newNotifs, ...prev]);
        setToastNotif(newNotifs[0]);
      }
    }

    const newMap: Record<string, ShipmentStatus> = {};
    mapped.forEach(s => { newMap[s.id] = s.status; });
    prevStatusMapRef.current = newMap;
    isInitialLoadRef.current = false;
    setShipments(mapped);
  }, []);

  // ── Pull-to-refresh ──────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (!clientIdRef.current) return;
    setRefreshing(true);
    await loadShipments(clientIdRef.current);
    setRefreshing(false);
  }, [loadShipments]);

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (clientIdRef.current) {
      pollingRef.current = setInterval(() => {
        if (clientIdRef.current) loadShipments(clientIdRef.current, true);
      }, 30000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [clientRecord?.id, loadShipments]);

  // ── Mark read on tab switch ───────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'notifications' && unreadCount > 0) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    }
  }, [activeTab]);

  // ── Login ─────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setLoginError('');
    if (!email.trim() || !password.trim()) { setLoginError(t('auth.fillCredentials')); return; }
    setLoginLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
    setLoginLoading(false);
    if (error) setLoginError(error.message);
  };

  // ── Register ──────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    setRegisterError('');
    if (!registerName.trim() || !email.trim() || !password.trim()) {
      setRegisterError(t('auth.fillAll')); return;
    }
    setLoginLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(), password: password.trim(),
      options: { data: { full_name: registerName.trim() } },
    });
    setLoginLoading(false);
    if (error) { setRegisterError(error.message); return; }
    setPendingOtp(true);
    setOtpDigits(['', '', '', '']);
    setOtpError('');
    setOtpResendMsg('');
    setTimeout(() => otpRefs[0].current?.focus(), 300);
  };

  const handleOtpDigit = (index: number, value: string) => {
    const clean = value.replace(/[^0-9]/g, '').slice(-1);
    const next = [...otpDigits];
    next[index] = clean;
    setOtpDigits(next);
    setOtpError('');
    if (clean && index < 3) otpRefs[index + 1].current?.focus();
    if (clean && index === 3) {
      const code = [...next.slice(0, 3), clean].join('');
      if (code.length === 4) handleVerifyOtp(code);
    }
  };

  const handleOtpKeyDown = (index: number, key: string) => {
    if (key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };

  const handleVerifyOtp = async (code?: string) => {
    const otp = code ?? otpDigits.join('');
    if (otp.length < 4) { setOtpError('Please enter the full 4-digit code.'); return; }
    setOtpLoading(true);
    setOtpError('');
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: 'signup' });
    setOtpLoading(false);
    if (error) {
      setOtpError(error.message);
      setOtpDigits(['', '', '', '']);
      setTimeout(() => otpRefs[0].current?.focus(), 100);
    } else {
      setPendingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    setOtpResending(true);
    setOtpResendMsg('');
    setOtpError('');
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    setOtpResending(false);
    if (error) { setOtpError(error.message); return; }
    setOtpResendMsg(t('customer.otpDesc') + ' ' + email.trim());
    setOtpDigits(['', '', '', '']);
    setTimeout(() => otpRefs[0].current?.focus(), 100);
  };

  const handleLogout = async () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    await supabase.auth.signOut();
    setSession(null); setClientRecord(null); setShipments([]);
    setNotifications([]); setNoAccount(false);
    clientIdRef.current = null;
    isInitialLoadRef.current = true;
  };

  const handleForgotPassword = async () => {
    setFpError('');
    if (!fpEmail.trim()) { setFpError(t('customer.emailLabel')); return; }
    setFpLoading(true);
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/reset-password`
      : 'onspaceapp://reset-password';
    const { error } = await supabase.auth.resetPasswordForEmail(fpEmail.trim(), { redirectTo });
    setFpLoading(false);
    if (error) { setFpError(error.message); return; }
    setFpSent(true);
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments.filter(s => {
      const matchFilter = filter === 'All' || s.status === filter;
      const matchSearch = !q || s.tirNumber.toLowerCase().includes(q) ||
        s.origin.toLowerCase().includes(q) || s.destination.toLowerCase().includes(q) ||
        s.cargoDescription.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }, [shipments, filter, search]);

  const stats = useMemo(() => ({
    total:   shipments.length,
    active:  shipments.filter(s => ['In Transit', 'Dispatched', 'Loaded', 'Border Crossing', 'Booked', 'At Port of Loading', 'Vessel Departed', 'At Sea', 'At Port of Discharge', 'Awaiting Flight', 'In Flight', 'Arrived at Hub'].includes(s.status)).length,
    customs: shipments.filter(s => ['Customs Clearance', 'Customs Pending', 'Port Customs'].includes(s.status)).length,
    arrived: shipments.filter(s => s.status === 'Arrived').length,
    detained: shipments.filter(s => s.status === 'Detained').length,
  }), [shipments]);

  const filterCounts = useMemo(() => {
    const c: Record<FilterKey, number> = { All: shipments.length } as any;
    FILTER_CHIPS.forEach(chip => {
      if (chip.key !== 'All') c[chip.key] = shipments.filter(s => s.status === chip.key).length;
    });
    return c;
  }, [shipments]);

  const visibleChips = useMemo(() => {
    return FILTER_CHIPS.filter(c => c.key === 'All' || (filterCounts[c.key] ?? 0) > 0);
  }, [filterCounts]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <SafeAreaView style={styles.splashRoot}>
        <StatusBar style="light" />
        <View style={styles.splashLogoWrap}>
          <MaterialIcons name="business-center" size={28} color={Colors.primary} />
        </View>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.splashText}>{t('customer.loadingPortal')}</Text>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── NOT LOGGED IN ─────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (!session) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <View style={styles.gridOverlay} pointerEvents="none">
          {[0, 1, 2, 3].map(i => <View key={i} style={[styles.gridLine, { left: `${i * 33}%` as any }]} />)}
        </View>

        {/* Top bar */}
        <View style={[styles.topBar, isRtl && styles.rowReverse]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <MaterialIcons name={isRtl ? 'arrow-forward' : 'arrow-back'} size={18} color={Colors.textSecondary} />
          </Pressable>
          <View style={styles.topBarCenter}>
            <View style={styles.topBarIcon}><MaterialIcons name="business-center" size={13} color={Colors.primary} /></View>
            <Text style={styles.topBarTitle}>{t('customer.portalTitle')}</Text>
          </View>
          <LanguagePicker compact />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
            <Animated.View style={[styles.loginContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

              {/* Hero */}
              <View style={styles.loginHero}>
                <View style={styles.loginHeroIconWrap}>
                  <View style={styles.loginHeroIconRing} />
                  <View style={styles.loginHeroIcon}>
                    <MaterialIcons name="business-center" size={30} color={Colors.primary} />
                  </View>
                </View>
                <View style={styles.loginHeroBadge}>
                  <View style={styles.loginHeroBadgeDot} />
                  <Text style={styles.loginHeroBadgeText}>{t('customer.portalBadge')}</Text>
                </View>
                <Text style={styles.loginHeroTitle}>{t('customer.portalHeroTitle')}</Text>
                <Text style={styles.loginHeroDesc}>{t('customer.portalHeroDesc')}</Text>
                <View style={styles.featurePills}>
                  {[
                    { icon: 'local-shipping' as const, label: 'Road' },
                    { icon: 'flight' as const, label: 'Air' },
                    { icon: 'directions-boat' as const, label: 'Sea' },
                    { icon: 'notifications-active' as const, label: t('customer.alertsTab') },
                  ].map(f => (
                    <View key={f.label} style={styles.featurePill}>
                      <MaterialIcons name={f.icon} size={11} color={Colors.primary} />
                      <Text style={styles.featurePillText}>{f.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Mode tabs */}
              <View style={styles.modeRow}>
                <Pressable style={[styles.modeBtn, !isRegister && styles.modeBtnActive]} onPress={() => { setIsRegister(false); setLoginError(''); setRegisterError(''); }}>
                  <MaterialIcons name="login" size={14} color={!isRegister ? Colors.primary : Colors.textMuted} />
                  <Text style={[styles.modeBtnText, !isRegister && styles.modeBtnTextActive]}>{t('customer.signIn')}</Text>
                  {!isRegister && <View style={styles.modeBtnBar} />}
                </Pressable>
                <Pressable style={[styles.modeBtn, isRegister && styles.modeBtnActive]} onPress={() => { setIsRegister(true); setLoginError(''); setRegisterError(''); }}>
                  <MaterialIcons name="person-add" size={14} color={isRegister ? Colors.primary : Colors.textMuted} />
                  <Text style={[styles.modeBtnText, isRegister && styles.modeBtnTextActive]}>{t('customer.register')}</Text>
                  {isRegister && <View style={styles.modeBtnBar} />}
                </Pressable>
              </View>

              {/* Form card */}
              <View style={styles.formCard}>
                {pendingOtp ? (
                  <View style={styles.otpState}>
                    <View style={styles.otpHeaderIcon}>
                      <MaterialIcons name="mark-email-unread" size={30} color={Colors.primary} />
                    </View>
                    <Text style={styles.otpTitle}>{t('customer.otpTitle')}</Text>
                    <Text style={[styles.otpDesc, isRtl && styles.textRtl]}>
                      {t('customer.otpDesc')}{' '}
                      <Text style={{ color: Colors.primary, fontWeight: '700' }}>{email}</Text>
                    </Text>
                    <View style={styles.otpRow}>
                      {otpDigits.map((d, i) => (
                        <TextInput
                          key={i}
                          ref={otpRefs[i]}
                          style={[styles.otpBox, d ? styles.otpBoxFilled : null, otpError ? styles.otpBoxError : null]}
                          value={d}
                          onChangeText={v => handleOtpDigit(i, v)}
                          onKeyPress={({ nativeEvent }) => handleOtpKeyDown(i, nativeEvent.key)}
                          keyboardType="number-pad"
                          maxLength={1}
                          textAlign="center"
                          selectTextOnFocus
                          caretHidden
                        />
                      ))}
                    </View>
                    {otpError ? (
                      <View style={styles.errorBox}>
                        <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                        <Text style={styles.errorText}>{otpError}</Text>
                      </View>
                    ) : null}
                    {otpResendMsg ? (
                      <View style={styles.otpSuccessBox}>
                        <MaterialIcons name="check-circle-outline" size={14} color={Colors.success} />
                        <Text style={styles.otpSuccessText}>{otpResendMsg}</Text>
                      </View>
                    ) : null}
                    <Pressable
                      style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }, (otpLoading || otpDigits.join('').length < 4) && { opacity: 0.5 }]}
                      onPress={() => handleVerifyOtp()}
                      disabled={otpLoading || otpDigits.join('').length < 4}
                    >
                      {otpLoading ? <ActivityIndicator color="#fff" size="small" /> : (
                        <><MaterialIcons name="verified-user" size={16} color="#fff" /><Text style={styles.submitLabel}>{t('customer.otpVerifyBtn')}</Text></>
                      )}
                    </Pressable>
                    <View style={styles.otpResendRow}>
                      <Text style={styles.otpResendText}>{t('customer.otpResendPrompt')} </Text>
                      <Pressable onPress={handleResendOtp} disabled={otpResending} hitSlop={8}>
                        {otpResending ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={styles.otpResendLink}>{t('customer.otpResendLink')}</Text>}
                      </Pressable>
                    </View>
                    <Pressable style={styles.otpBackLink} onPress={() => { setPendingOtp(false); setOtpDigits(['', '', '', '']); setOtpError(''); }}>
                      <MaterialIcons name="arrow-back" size={13} color={Colors.textMuted} />
                      <Text style={styles.otpBackLinkText}>{isRegister ? t('customer.otpBackToReg') : t('customer.otpBackToSignIn')}</Text>
                    </Pressable>
                  </View>
                ) : registerSuccess ? (
                  <View style={styles.successState}>
                    <View style={styles.successIcon}><MaterialIcons name="mark-email-read" size={36} color={Colors.success} /></View>
                    <Text style={styles.successTitle}>{t('customer.otpTitle')}</Text>
                    <Text style={styles.successMsg}>{t('customer.otpDesc')} <Text style={{ color: Colors.primary, fontWeight: '700' }}>{email}</Text></Text>
                    <Pressable style={styles.switchLink} onPress={() => { setIsRegister(false); setRegisterSuccess(false); }}>
                      <MaterialIcons name="login" size={14} color={Colors.primary} />
                      <Text style={styles.switchLinkText}>{t('customer.signIn')}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    {isRegister && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>{t('customer.fullNameLabel')}</Text>
                        <View style={styles.inputRow}>
                          <MaterialIcons name="person-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                          <TextInput style={[styles.input, isRtl && styles.inputRtl]} value={registerName} onChangeText={setRegisterName} placeholder={t('customer.fullNamePlaceholder')} placeholderTextColor={Colors.textMuted} />
                        </View>
                      </View>
                    )}
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{t('customer.emailLabel')}</Text>
                      <View style={styles.inputRow}>
                        <MaterialIcons name="alternate-email" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                        <TextInput style={[styles.input, isRtl && styles.inputRtl]} value={email} onChangeText={setEmail} placeholder={t('customer.emailPlaceholder')} placeholderTextColor={Colors.textMuted} autoCapitalize="none" keyboardType="email-address" />
                      </View>
                    </View>
                    <View style={styles.fieldGroup}>
                      <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabel}>{t('customer.passwordLabel')}</Text>
                        {!isRegister && (
                          <Pressable hitSlop={8} onPress={() => { setFpEmail(email); setFpSent(false); setFpError(''); setShowForgot(true); }}>
                            <Text style={styles.forgotLink}>{t('customer.forgotPassword')}</Text>
                          </Pressable>
                        )}
                      </View>
                      <View style={styles.inputRow}>
                        <MaterialIcons name="lock-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                        <TextInput style={[styles.input, { flex: 1 }, isRtl && styles.inputRtl]} value={password} onChangeText={setPassword} placeholder={isRegister ? t('customer.passwordRegisterPlaceholder') : t('customer.passwordPlaceholder')} placeholderTextColor={Colors.textMuted} secureTextEntry={!showPassword} />
                        <Pressable onPress={() => setShowPassword(v => !v)} hitSlop={8}>
                          <MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={15} color={Colors.textMuted} />
                        </Pressable>
                      </View>
                    </View>
                    {(loginError || registerError) ? (
                      <View style={styles.errorBox}>
                        <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                        <Text style={styles.errorText}>{loginError || registerError}</Text>
                      </View>
                    ) : null}
                    {isRegister && (
                      <View style={styles.infoNote}>
                        <MaterialIcons name="info-outline" size={13} color={Colors.info} />
                        <Text style={[styles.infoNoteText, isRtl && styles.textRtl]}>{t('customer.registerNote')}</Text>
                      </View>
                    )}
                    <Pressable style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]} onPress={isRegister ? handleRegister : handleLogin} disabled={loginLoading}>
                      {loginLoading ? <ActivityIndicator color="#fff" size="small" /> : (
                        <><Text style={styles.submitLabel}>{isRegister ? t('customer.createAccountBtn') : t('customer.signInBtn')}</Text><MaterialIcons name={isRtl ? 'arrow-back' : 'arrow-forward'} size={16} color="#fff" /></>
                      )}
                    </Pressable>
                  </>
                )}
              </View>

              <View style={styles.brandFooter}>
                <View style={styles.brandFooterDot} />
                <Text style={styles.brandFooterText}>{t('customer.brandFooter')}</Text>
                <View style={styles.brandFooterDot} />
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Forgot password modal */}
        <Modal visible={showForgot} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForgot(false)}>
          <View style={styles.sheetRoot}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderLeft}>
                <View style={styles.sheetHeaderIcon}><MaterialIcons name="lock-reset" size={18} color={Colors.primary} /></View>
                <View><Text style={styles.sheetTitle}>{t('customer.resetTitle')}</Text><Text style={styles.sheetSub}>{t('customer.resetSub')}</Text></View>
              </View>
              <Pressable style={styles.sheetCloseBtn} onPress={() => { setShowForgot(false); setFpSent(false); setFpError(''); }}>
                <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.sheetBody}>
              {fpSent ? (
                <View style={styles.fpSuccess}>
                  <View style={styles.fpSuccessIcon}><MaterialIcons name="mark-email-read" size={36} color={Colors.success} /></View>
                  <Text style={styles.fpSuccessTitle}>{t('customer.resetSentTitle')}</Text>
                  <Text style={styles.fpSuccessMsg}>{t('customer.resetSentMsg')} <Text style={{ color: Colors.primary, fontWeight: '700' }}>{fpEmail}</Text></Text>
                  <Pressable style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]} onPress={() => { setShowForgot(false); setFpSent(false); }}>
                    <Text style={styles.submitLabel}>{t('customer.resetDoneBtn')}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ gap: Spacing.lg }}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>{t('customer.emailLabel')}</Text>
                    <View style={styles.inputRow}>
                      <MaterialIcons name="mail-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={[styles.input, isRtl && styles.inputRtl]} value={fpEmail} onChangeText={setFpEmail} placeholder={t('customer.emailPlaceholder')} placeholderTextColor={Colors.textMuted} autoCapitalize="none" keyboardType="email-address" autoFocus />
                    </View>
                  </View>
                  {fpError ? (<View style={styles.errorBox}><MaterialIcons name="error-outline" size={14} color={Colors.danger} /><Text style={styles.errorText}>{fpError}</Text></View>) : null}
                  <Pressable style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]} onPress={handleForgotPassword} disabled={fpLoading}>
                    {fpLoading ? <ActivityIndicator color="#fff" size="small" /> : (<><Text style={styles.submitLabel}>{t('customer.resetBtn')}</Text><MaterialIcons name="send" size={15} color="#fff" /></>)}
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  if (clientLoading) {
    return (
      <SafeAreaView style={styles.splashRoot}>
        <StatusBar style="light" />
        <View style={styles.splashLogoWrap}>
          <MaterialIcons name="business-center" size={28} color={Colors.primary} />
        </View>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.splashText}>{t('customer.loadingAccount')}</Text>
      </SafeAreaView>
    );
  }

  // ── No Account ─────────────────────────────────────────────────────────────
  if (noAccount) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <StatusBar style="light" />
        <View style={[styles.topBar, isRtl && styles.rowReverse]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}><MaterialIcons name={isRtl ? 'arrow-forward' : 'arrow-back'} size={18} color={Colors.textSecondary} /></Pressable>
          <View style={styles.topBarCenter}><View style={styles.topBarIcon}><MaterialIcons name="business-center" size={13} color={Colors.primary} /></View><Text style={styles.topBarTitle}>{t('customer.portalTitle')}</Text></View>
          <Pressable style={[styles.backBtn, { backgroundColor: Colors.dangerBg, borderColor: `${Colors.danger}30` }]} onPress={handleLogout} hitSlop={8}><MaterialIcons name="logout" size={17} color={Colors.danger} /></Pressable>
        </View>
        <View style={styles.noAccountRoot}>
          <View style={styles.noAccountIcon}>
            <MaterialIcons name="person-off" size={34} color={Colors.warning} />
          </View>
          <Text style={styles.noAccountTitle}>{t('customer.noAccountTitle')}</Text>
          <Text style={[styles.noAccountMsg, isRtl && styles.textRtl]}>
            <Text style={{ color: Colors.primary, fontWeight: '700' }}>{session?.user?.email}</Text>{' '}{t('customer.noAccountMsg')}
          </Text>
          <View style={styles.contactCard}>
            <View style={styles.contactCardIcon}><MaterialIcons name="support-agent" size={18} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactCardTitle}>{t('customer.contactTitle')}</Text>
              <Text style={styles.contactCardSub}>{t('customer.contactSub')}</Text>
            </View>
          </View>
          <Pressable style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.85 }]} onPress={handleLogout}>
            <MaterialIcons name="logout" size={16} color={Colors.danger} />
            <Text style={styles.logoutBtnText}>{t('customer.signOut')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  const displayName = clientRecord?.company || clientRecord?.name || session.user.email;
  const initials = displayName.substring(0, 2).toUpperCase();
  const activeShipmentCount = stats.active;
  const hasDetained = stats.detained > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      {/* Toast */}
      {toastNotif ? <ToastBanner notif={toastNotif} onDismiss={() => setToastNotif(null)} /> : null}

      {/* ── Header ── */}
      <View style={[styles.dashHeader, isRtl && styles.rowReverse]}>
        <View style={[styles.dashHeaderLeft, isRtl && styles.rowReverse]}>
          <View style={styles.dashAvatarWrap}>
            <View style={styles.dashAvatar}><Text style={styles.dashAvatarText}>{initials}</Text></View>
            <View style={[styles.dashAvatarOnline, { backgroundColor: hasDetained ? Colors.danger : Colors.success }]} />
          </View>
          <View style={styles.dashHeaderInfo}>
            <Text style={styles.dashHeaderName} numberOfLines={1}>{displayName}</Text>
            <View style={[styles.dashHeaderSubRow, isRtl && styles.rowReverse]}>
              <MaterialIcons name="business" size={10} color={Colors.textMuted} />
              <Text style={styles.dashHeaderEmail} numberOfLines={1}>{session.user.email}</Text>
            </View>
          </View>
        </View>
        <View style={[styles.dashHeaderRight, isRtl && styles.rowReverse]}>
          <LanguagePicker compact />
          <Pressable style={styles.refreshBtn} onPress={() => clientRecord && loadShipments(clientRecord.id)} hitSlop={8}>
            <MaterialIcons name="refresh" size={16} color={Colors.primary} />
          </Pressable>
          <Pressable style={styles.logoutIconBtn} onPress={handleLogout} hitSlop={8}>
            <MaterialIcons name="logout" size={16} color={Colors.danger} />
          </Pressable>
        </View>
      </View>

      {/* ── Detained alert banner ── */}
      {hasDetained && (
        <View style={[styles.detainedBanner, isRtl && styles.rowReverse]}>
          <MaterialIcons name="warning" size={14} color={Colors.danger} />
          <Text style={styles.detainedBannerText}>
            {stats.detained} {stats.detained > 1 ? t('customer.detainedMsgPlural') : t('customer.detainedMsg')}
          </Text>
          <Pressable onPress={() => setFilter('Detained')} hitSlop={8}>
            <Text style={styles.detainedBannerLink}>{t('customer.detainedView')}</Text>
          </Pressable>
        </View>
      )}

      {/* ── Tab Switcher ── */}
      <View style={styles.tabSwitcher}>
        <Pressable style={[styles.tabBtn, activeTab === 'shipments' && styles.tabBtnActive]} onPress={() => setActiveTab('shipments')}>
          <MaterialIcons name="local-shipping" size={15} color={activeTab === 'shipments' ? Colors.primary : Colors.textMuted} />
          <Text style={[styles.tabBtnText, activeTab === 'shipments' && styles.tabBtnTextActive]}>{t('customer.shipmentsTab')}</Text>
          {activeTab === 'shipments' && <View style={styles.tabBtnBar} />}
        </Pressable>
        <Pressable style={[styles.tabBtn, activeTab === 'notifications' && styles.tabBtnActive]} onPress={() => setActiveTab('notifications')}>
          <MaterialIcons name="notifications" size={15} color={activeTab === 'notifications' ? Colors.primary : Colors.textMuted} />
          <Text style={[styles.tabBtnText, activeTab === 'notifications' && styles.tabBtnTextActive]}>{t('customer.alertsTab')}</Text>
          {unreadCount > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
          {activeTab === 'notifications' && <View style={styles.tabBtnBar} />}
        </Pressable>
      </View>

      {/* ══ SHIPMENTS TAB ══ */}
      {activeTab === 'shipments' ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.dashScroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} colors={[Colors.primary]} progressBackgroundColor={Colors.surface} />
          }
        >
          {/* ── Stats row ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsScroll}>
            <StatCard icon="layers" value={stats.total} label={t('customer.statTotal')} color={Colors.textSecondary} />
            <StatCard icon="directions-car" value={stats.active} label={t('customer.statActive')} color={Colors.info} sublabel={t('customer.statActiveSubLabel')} />
            <StatCard icon="verified-user" value={stats.customs} label={t('customer.statCustoms')} color={Colors.warning} sublabel={t('customer.statCustomsSubLabel')} />
            <StatCard icon="check-circle" value={stats.arrived} label={t('customer.statArrived')} color={Colors.success} sublabel={t('customer.statArrivedSubLabel')} />
            {stats.detained > 0 && <StatCard icon="block" value={stats.detained} label={t('customer.statDetained')} color={Colors.danger} sublabel={t('customer.statDetainedSubLabel')} />}
          </ScrollView>

          {/* ── Welcome / summary banner ── */}
          {activeShipmentCount > 0 && (
            <View style={[styles.welcomeBanner, isRtl && styles.rowReverse]}>
              <View style={[styles.welcomeBannerLeft, isRtl && styles.rowReverse]}>
                <View style={styles.welcomePulse}>
                  <View style={styles.welcomePulseDot} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.welcomeBannerTitle}>
                    {activeShipmentCount} {activeShipmentCount > 1 ? t('customer.welcomeActive') : t('customer.welcomeActiveSingle')}
                  </Text>
                  <Text style={styles.welcomeBannerSub}>{t('customer.welcomeSub')}</Text>
                </View>
              </View>
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>{t('customer.liveLabel')}</Text>
              </View>
            </View>
          )}

          {/* ── Search ── */}
          <View style={styles.searchWrap}>
            <MaterialIcons name="search" size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.searchInput, isRtl && styles.inputRtl]}
              value={search}
              onChangeText={setSearch}
              placeholder={t('customer.searchPlaceholder')}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
            {search ? (<Pressable onPress={() => setSearch('')} hitSlop={8}><MaterialIcons name="close" size={14} color={Colors.textMuted} /></Pressable>) : null}
          </View>

          {/* ── Filter Chips ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
            {visibleChips.map(chip => {
              const col = chip.key === 'All' ? Colors.primary : STATUS_META[chip.key as ShipmentStatus]?.color ?? Colors.primary;
              return (
                <Chip key={chip.key} label={chip.label} icon={chip.icon} color={col}
                  selected={filter === chip.key} count={filterCounts[chip.key] ?? 0}
                  onPress={() => setFilter(chip.key)} />
              );
            })}
          </ScrollView>

          {/* ── Results bar ── */}
          <View style={[styles.resultsBar, isRtl && styles.rowReverse]}>
            <Text style={styles.resultsCount}>
              <Text style={{ color: Colors.primary, fontWeight: '800' }}>{filtered.length}</Text>
              {' '}{filtered.length !== 1 ? t('customer.resultsCountPlural') : t('customer.resultsCount')}
              {filter !== 'All' ? <Text style={{ color: Colors.textMuted }}> · {t('customer.filtersLabel')}</Text> : null}
            </Text>
            {filter !== 'All' && (
              <Pressable style={styles.clearFilterBtn} onPress={() => setFilter('All')} hitSlop={8}>
                <MaterialIcons name="close" size={10} color={Colors.textMuted} />
                <Text style={styles.clearFilterText}>{t('customer.clearFilter')}</Text>
              </Pressable>
            )}
          </View>

          {/* ── Shipment list ── */}
          {shipmentsLoading ? (
            <View style={styles.listLoading}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.listLoadingText}>{t('customer.loadingShipments')}</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name={shipments.length === 0 ? 'local-shipping' : 'search-off'} size={30} color={Colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>{shipments.length === 0 ? t('customer.emptyTitle') : t('customer.emptySearchTitle')}</Text>
              <Text style={[styles.emptySub, isRtl && styles.textRtl]}>
                {shipments.length === 0 ? t('customer.emptySub') : t('customer.emptySearchSub')}
              </Text>
            </View>
          ) : (
            <View style={styles.shipList}>
              {filtered.map(s => (
                <ShipmentCard key={s.id} shipment={s} onPress={() => setSelectedShipment(s)} />
              ))}
            </View>
          )}

          {/* Client info */}
          {clientRecord && (clientRecord.company || clientRecord.country || clientRecord.city) && (
            <View style={styles.clientInfoCard}>
              <View style={styles.clientInfoHeader}>
                <View style={styles.clientInfoIconWrap}><MaterialIcons name="business" size={11} color={Colors.primary} /></View>
                <Text style={styles.clientInfoHeaderText}>{t('customer.accountInfoTitle')}</Text>
              </View>
              <View style={styles.clientInfoBody}>
                {clientRecord.company ? (<View style={styles.clientInfoRow}><MaterialIcons name="business" size={11} color={Colors.textMuted} /><Text style={styles.clientInfoValue}>{clientRecord.company}</Text></View>) : null}
                {(clientRecord.city || clientRecord.country) ? (<View style={styles.clientInfoRow}><MaterialIcons name="place" size={11} color={Colors.textMuted} /><Text style={styles.clientInfoValue}>{[clientRecord.city, clientRecord.country].filter(Boolean).join(', ')}</Text></View>) : null}
                {clientRecord.phone ? (<View style={styles.clientInfoRow}><MaterialIcons name="phone" size={11} color={Colors.textMuted} /><Text style={styles.clientInfoValue}>{clientRecord.phone}</Text></View>) : null}
              </View>
            </View>
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
      ) : (
        /* ══ NOTIFICATIONS TAB ══ */
        <ScrollView showsVerticalScrollIndicator={false} style={styles.dashScroll}>
          <View style={[styles.notifHeader, isRtl && styles.rowReverse]}>
            <View style={[styles.notifHeaderLeft, isRtl && styles.rowReverse]}>
              <View style={styles.notifHeaderIcon}><MaterialIcons name="notifications-active" size={14} color={Colors.primary} /></View>
              <View>
                <Text style={styles.notifHeaderTitle}>{t('customer.alertsTitle')}</Text>
                <Text style={styles.notifHeaderSub}>{t('customer.alertsSub')}</Text>
              </View>
            </View>
            {notifications.length > 0 && (
              <Pressable style={styles.clearAllBtn} onPress={() => setNotifications([])} hitSlop={8}>
                <MaterialIcons name="delete-outline" size={13} color={Colors.textMuted} />
                <Text style={styles.clearAllText}>{t('customer.clearAllBtn')}</Text>
              </Pressable>
            )}
          </View>

          {notifications.length === 0 ? (
            <View style={styles.notifEmpty}>
              <View style={styles.notifEmptyIcon}><MaterialIcons name="notifications-none" size={32} color={Colors.primary} /></View>
              <Text style={styles.notifEmptyTitle}>{t('customer.noAlertsTitle')}</Text>
              <Text style={[styles.notifEmptySub, isRtl && styles.textRtl]}>{t('customer.noAlertsSub')}</Text>
              <View style={styles.notifEmptyPill}>
                <View style={styles.liveDot} />
                <Text style={styles.notifEmptyPillText}>
                  {t('customer.monitoringLabel')} {shipments.length} {shipments.length !== 1 ? t('customer.shipmentWordPlural') : t('customer.shipmentWord')}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.notifList}>
              {notifications.map((n, i) => (
                <NotifItem
                  key={n.id}
                  notif={n}
                  last={i === notifications.length - 1}
                  alertDescText={t('customer.alertDescText')}
                />
              ))}
            </View>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      {selectedShipment && (
        <ShipmentDetailModal shipment={selectedShipment} onClose={() => setSelectedShipment(null)} t={t} />
      )}
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  splashRoot: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  splashLogoWrap: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  splashText: { fontSize: FontSize.sm, color: Colors.textMuted },

  // RTL helpers
  rowReverse: { flexDirection: 'row-reverse' },
  inputRtl: { textAlign: 'right' },
  textRtl: { textAlign: 'right', writingDirection: 'rtl' as const },

  gridOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(47,129,247,0.04)' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface, zIndex: 1,
  },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  topBarCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topBarIcon: { width: 26, height: 26, borderRadius: 7, backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },

  loginScroll: { flexGrow: 1, padding: Spacing.xl, zIndex: 1 },
  loginContent: { flex: 1, gap: Spacing.xl, maxWidth: 480, alignSelf: 'center', width: '100%', paddingTop: Spacing.xl },

  loginHero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  loginHeroIconWrap: { position: 'relative', width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  loginHeroIconRing: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 40, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.2)',
    borderStyle: 'dashed',
  },
  loginHeroIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  loginHeroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  loginHeroBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.success },
  loginHeroBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.primary, letterSpacing: 0.7 },
  loginHeroTitle: { fontSize: FontSize.xxxl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', lineHeight: 36 },
  loginHeroDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 21, textAlign: 'center' },
  featurePills: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  featurePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.border,
  },
  featurePillText: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary },

  modeRow: { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, position: 'relative' },
  modeBtnActive: { backgroundColor: Colors.surface },
  modeBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  modeBtnTextActive: { color: Colors.primary },
  modeBtnBar: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 2, backgroundColor: Colors.primary, borderRadius: 1 },

  formCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl, gap: Spacing.lg },
  fieldGroup: { gap: Spacing.xs + 2 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.4, textTransform: 'uppercase' },
  forgotLink: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  inputIcon: { marginRight: Spacing.sm },
  input: { flex: 1, paddingVertical: 13, fontSize: FontSize.base, color: Colors.textPrimary },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(248,81,73,0.2)' },
  errorText: { flex: 1, fontSize: FontSize.sm, color: Colors.danger },
  infoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: Colors.infoBg, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.info}25` },
  infoNoteText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 15 },
  submitLabel: { fontSize: FontSize.base, fontWeight: '700', color: '#fff' },
  successState: { alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.lg },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.successBg, borderWidth: 2, borderColor: `${Colors.success}40`, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  successMsg: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22, textAlign: 'center' },
  switchLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.xl, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', marginTop: 4 },
  switchLinkText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },

  // OTP
  otpState: { alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.sm },
  otpHeaderIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.35)', alignItems: 'center', justifyContent: 'center' },
  otpTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  otpDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  otpRow: { flexDirection: 'row', gap: 12, marginVertical: Spacing.sm },
  otpBox: { width: 60, height: 68, borderRadius: BorderRadius.lg, backgroundColor: Colors.card, borderWidth: 2, borderColor: Colors.border, fontSize: 28, fontWeight: '700', color: Colors.textPrimary },
  otpBoxFilled: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  otpBoxError: { borderColor: Colors.danger, backgroundColor: Colors.dangerBg },
  otpSuccessBox: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%', backgroundColor: Colors.successBg, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.success}35` },
  otpSuccessText: { fontSize: FontSize.sm, color: Colors.success, flex: 1 },
  otpResendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  otpResendText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  otpResendLink: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  otpBackLink: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  otpBackLinkText: { fontSize: FontSize.xs, color: Colors.textMuted },

  brandFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: Spacing.md },
  brandFooterDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.textMuted, opacity: 0.4 },
  brandFooterText: { fontSize: 9, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.7, textTransform: 'uppercase' },

  sheetRoot: { flex: 1, backgroundColor: Colors.bg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  sheetHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  sheetHeaderIcon: { width: 40, height: 40, borderRadius: BorderRadius.md, backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  sheetSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  sheetCloseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  sheetBody: { flex: 1, padding: Spacing.xl },
  fpSuccess: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl },
  fpSuccessIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.successBg, borderWidth: 2, borderColor: `${Colors.success}40`, alignItems: 'center', justifyContent: 'center' },
  fpSuccessTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  fpSuccessMsg: { fontSize: FontSize.base, color: Colors.textSecondary, textAlign: 'center', lineHeight: 24 },

  noAccountRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: Spacing.xl },
  noAccountIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.warningBg, borderWidth: 2, borderColor: `${Colors.warning}40`, alignItems: 'center', justifyContent: 'center' },
  noAccountTitle: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  noAccountMsg: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22, textAlign: 'center' },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', padding: Spacing.lg, width: '100%' },
  contactCardIcon: { width: 38, height: 38, borderRadius: BorderRadius.md, backgroundColor: 'rgba(47,129,247,0.15)', alignItems: 'center', justifyContent: 'center' },
  contactCardTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  contactCardSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.lg, paddingVertical: 13, paddingHorizontal: Spacing.xxl, borderWidth: 1, borderColor: `${Colors.danger}35` },
  logoutBtnText: { fontSize: FontSize.base, fontWeight: '700', color: Colors.danger },

  // Dashboard
  dashHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  dashHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  dashAvatarWrap: { position: 'relative', flexShrink: 0 },
  dashAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primaryGlow, borderWidth: 2, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  dashAvatarText: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },
  dashAvatarOnline: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: Colors.surface },
  dashHeaderInfo: { flex: 1, gap: 2, minWidth: 0 },
  dashHeaderName: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  dashHeaderSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dashHeaderEmail: { fontSize: FontSize.xs, color: Colors.textMuted, flex: 1 },
  dashHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  refreshBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  logoutIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.dangerBg, borderWidth: 1, borderColor: `${Colors.danger}30`, alignItems: 'center', justifyContent: 'center' },

  detainedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.dangerBg, paddingHorizontal: Spacing.xl, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: `${Colors.danger}30`,
  },
  detainedBannerText: { flex: 1, fontSize: FontSize.xs, color: Colors.danger, fontWeight: '600' },
  detainedBannerLink: { fontSize: FontSize.xs, color: Colors.danger, fontWeight: '700', textDecorationLine: 'underline' },

  tabSwitcher: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, position: 'relative' },
  tabBtnActive: { backgroundColor: Colors.bg },
  tabBtnText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textMuted },
  tabBtnTextActive: { color: Colors.primary, fontWeight: '700' },
  tabBtnBar: { position: 'absolute', bottom: 0, left: 16, right: 16, height: 2, backgroundColor: Colors.primary, borderRadius: 1 },
  tabBadge: { backgroundColor: Colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

  dashScroll: { flex: 1 },

  statsScroll: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.sm },

  welcomeBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: Spacing.xl, marginBottom: Spacing.sm,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  welcomeBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  welcomePulse: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(47,129,247,0.15)', alignItems: 'center', justifyContent: 'center' },
  welcomePulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success },
  welcomeBannerTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  welcomeBannerSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  liveIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: `${Colors.success}15`, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  liveText: { fontSize: 9, fontWeight: '800', color: Colors.success, letterSpacing: 0.8 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.xl, marginBottom: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: FontSize.sm, color: Colors.textPrimary },
  filtersContent: { flexDirection: 'row', gap: 7, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xs },
  resultsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xl, paddingVertical: 6 },
  resultsCount: { fontSize: FontSize.sm, color: Colors.textMuted },
  clearFilterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.card, borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  clearFilterText: { fontSize: 10, fontWeight: '600', color: Colors.textMuted },

  listLoading: { alignItems: 'center', gap: Spacing.md, paddingVertical: 60 },
  listLoadingText: { fontSize: FontSize.sm, color: Colors.textMuted },
  emptyState: { alignItems: 'center', padding: 48, gap: Spacing.lg, marginTop: Spacing.xl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 280 },

  shipList: { paddingHorizontal: Spacing.xl, paddingTop: 4, gap: Spacing.md },

  // Client info card
  clientInfoCard: { marginHorizontal: Spacing.xl, marginTop: Spacing.xl, backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  clientInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primaryGlow, paddingHorizontal: Spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(47,129,247,0.15)' },
  clientInfoIconWrap: { width: 17, height: 17, borderRadius: 5, backgroundColor: 'rgba(47,129,247,0.2)', alignItems: 'center', justifyContent: 'center' },
  clientInfoHeaderText: { fontSize: 9, fontWeight: '700', color: Colors.primary, letterSpacing: 0.9 },
  clientInfoBody: { padding: Spacing.md, gap: Spacing.sm },
  clientInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  clientInfoValue: { fontSize: FontSize.sm, color: Colors.textSecondary },

  // Notifications tab
  notifHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
  },
  notifHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  notifHeaderIcon: { width: 38, height: 38, borderRadius: BorderRadius.md, backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  notifHeaderTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  notifHeaderSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  clearAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.card, borderRadius: BorderRadius.md, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border },
  clearAllText: { fontSize: 11, fontWeight: '600', color: Colors.textMuted },
  notifList: { marginHorizontal: Spacing.xl, backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  notifEmpty: { alignItems: 'center', padding: 52, gap: Spacing.lg, marginTop: Spacing.xl },
  notifEmptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  notifEmptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  notifEmptySub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  notifEmptyPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${Colors.success}12`, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: `${Colors.success}25` },
  notifEmptyPillText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.success },
});
