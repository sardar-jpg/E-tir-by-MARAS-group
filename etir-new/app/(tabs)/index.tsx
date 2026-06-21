import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Dimensions, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/hooks/useAuth';
import { useShipments } from '@/hooks/useShipments';
import { useChat } from '@/hooks/useChat';
import { useLanguage } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { StatusBadge } from '@/components/ui/StatusBadge';
let LiveMap: typeof import('@/components/feature/LiveMap').LiveMap | null = null;
try { LiveMap = require('@/components/feature/LiveMap').LiveMap; } catch (e) {}
import { useDrivers } from '@/hooks/useDrivers';
import { Shipment } from '@/types';
import { ControlPanel } from '@/components/feature/ControlPanel';
import { FleetMapModal } from '@/components/feature/FleetMapModal';
import { SeaMapModal } from '@/components/feature/SeaMapModal';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

function useScreenWidth() {
  const [width, setWidth] = useState(() => Dimensions.get('window').width);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setWidth(window.width));
    return () => sub?.remove();
  }, []);
  return width;
}

// ── Animated Stat Card ────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number;
  prevValue?: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  accentColor: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  onPress?: () => void;
  wide?: boolean;
}

function StatCard({ label, value, prevValue, icon, accentColor, subtitle, trend, trendLabel, onPress, wide }: StatCardProps) {
  const scaleAnim  = useRef(new Animated.Value(1)).current;
  const countAnim  = useRef(new Animated.Value(0)).current;
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    countAnim.setValue(0);
    Animated.timing(countAnim, {
      toValue: value, duration: 700, useNativeDriver: false,
    }).start();
    const id = countAnim.addListener(({ value: v }) => setDisplayed(Math.round(v)));
    return () => countAnim.removeListener(id);
  }, [value]);

  const handlePressIn  = () => Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const handlePressOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 10 }).start();

  const trendColor = trend === 'up' ? Colors.success : trend === 'down' ? Colors.danger : Colors.textMuted;
  const trendIcon: keyof typeof MaterialIcons.glyphMap =
    trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'remove';

  return (
    <Pressable
      style={[{ flex: wide ? 2 : 1 }]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
    >
      <Animated.View style={[styles.statCard, { transform: [{ scale: scaleAnim }] }]}>
        {/* Left accent bar */}
        <View style={[styles.statAccentBar, { backgroundColor: accentColor }]} />

        <View style={styles.statCardInner}>
          {/* Top row: icon + trend */}
          <View style={styles.statTopRow}>
            <View style={[styles.statIconWrap, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}30` }]}>
              <MaterialIcons name={icon} size={16} color={accentColor} />
            </View>
            {trend && trend !== 'neutral' && (
              <View style={[styles.trendPill, { backgroundColor: `${trendColor}14`, borderColor: `${trendColor}30` }]}>
                <MaterialIcons name={trendIcon} size={10} color={trendColor} />
                {trendLabel ? <Text style={[styles.trendPillText, { color: trendColor }]}>{trendLabel}</Text> : null}
              </View>
            )}
          </View>

          {/* Value */}
          <Text style={[styles.statValue, { color: accentColor }]}>{displayed}</Text>

          {/* Label + subtitle */}
          <Text style={styles.statLabel}>{label}</Text>
          {subtitle ? <Text style={styles.statSubtitle}>{subtitle}</Text> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ── Quick Action Button ────────────────────────────────────────────────────────
function QuickAction({
  icon, label, color, onPress, badge,
}: { icon: keyof typeof MaterialIcons.glyphMap; label: string; color: string; onPress: () => void; badge?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 70, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 280, friction: 12 }),
    ]).start();
    onPress();
  };
  return (
    <Pressable style={styles.quickAction} onPress={handlePress}>
      <Animated.View style={[styles.quickActionIconWrap, { backgroundColor: `${color}15`, borderColor: `${color}28` }, { transform: [{ scale }] }]}>
        <MaterialIcons name={icon} size={18} color={color} />
        {badge && badge > 0 ? (
          <View style={styles.quickActionBadge}>
            <Text style={styles.quickActionBadgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </Animated.View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </Pressable>
  );
}

// ── Fleet Distribution ────────────────────────────────────────────────────────
interface DistSeg { color: string; count: number; label: string; icon: keyof typeof MaterialIcons.glyphMap }

function FleetDistribution({ segments, total }: { segments: DistSeg[]; total: number }) {
  const active = segments.filter(s => s.count > 0);
  return (
    <View style={styles.fleetDist}>
      {/* Bar */}
      <View style={styles.distBar}>
        {active.map((seg, i) => (
          <View
            key={seg.label}
            style={[
              styles.distBarSeg,
              {
                flex: seg.count,
                backgroundColor: seg.color,
                borderTopLeftRadius: i === 0 ? 4 : 0,
                borderBottomLeftRadius: i === 0 ? 4 : 0,
                borderTopRightRadius: i === active.length - 1 ? 4 : 0,
                borderBottomRightRadius: i === active.length - 1 ? 4 : 0,
              },
            ]}
          />
        ))}
        {total === 0 && <View style={[styles.distBarSeg, { flex: 1, backgroundColor: Colors.border, borderRadius: 4 }]} />}
      </View>

      {/* Legend grid */}
      <View style={styles.distLegendGrid}>
        {segments.map(seg => (
          <View key={seg.label} style={styles.distLegendItem}>
            <View style={[styles.distLegendIcon, { backgroundColor: `${seg.color}18`, borderColor: `${seg.color}30` }]}>
              <MaterialIcons name={seg.icon} size={10} color={seg.color} />
            </View>
            <View style={styles.distLegendText}>
              <Text style={[styles.distLegendCount, { color: seg.color }]}>{seg.count}</Text>
              <Text style={styles.distLegendLabel}>{seg.label}</Text>
            </View>
            {total > 0 && (
              <Text style={styles.distLegendPct}>{Math.round((seg.count / total) * 100)}%</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Recent Shipment Row ───────────────────────────────────────────────────────
function RecentShipmentRow({ shipment, onPress, last }: { shipment: Shipment; onPress: () => void; last?: boolean }) {
  const typeColor = shipment.shipmentType === 'Air' ? Colors.info : shipment.shipmentType === 'Sea' ? '#58C4DC' : Colors.primary;
  const typeIcon: keyof typeof MaterialIcons.glyphMap =
    shipment.shipmentType === 'Air' ? 'flight' : shipment.shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping';

  return (
    <Pressable
      style={({ pressed }) => [styles.recentRow, !last && styles.recentRowBorder, pressed && { backgroundColor: Colors.cardHover }]}
      onPress={onPress}
    >
      {/* Type icon */}
      <View style={[styles.recentTypeIcon, { backgroundColor: `${typeColor}15`, borderColor: `${typeColor}28` }]}>
        <MaterialIcons name={typeIcon} size={13} color={typeColor} />
      </View>

      {/* Info */}
      <View style={styles.recentInfo}>
        <View style={styles.recentTopRow}>
          <Text style={styles.recentTir}>{shipment.tirNumber}</Text>
          <StatusBadge status={shipment.status} size="sm" />
        </View>
        <View style={styles.recentRouteRow}>
          <Text style={styles.recentRoute} numberOfLines={1}>{shipment.origin}</Text>
          <MaterialIcons name="arrow-forward" size={9} color={Colors.textMuted} />
          <Text style={styles.recentRoute} numberOfLines={1}>{shipment.destination}</Text>
        </View>
      </View>

      <MaterialIcons name="chevron-right" size={14} color={Colors.textMuted} />
    </Pressable>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
function SectionLabel({ icon, title, badge, action, onAction }: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  badge?: number;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={styles.sectionLabelLeft}>
        <View style={styles.sectionLabelIconWrap}>
          <MaterialIcons name={icon} size={11} color={Colors.primary} />
        </View>
        <Text style={styles.sectionLabelText}>{title.toUpperCase()}</Text>
        {typeof badge === 'number' && (
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>{badge}</Text>
          </View>
        )}
      </View>
      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { shipments, getStats, loading: shipmentsLoading } = useShipments();
  const { totalUnread } = useChat();
  const { drivers } = useDrivers();
  const { t } = useLanguage();
  const stats = getStats();
  const screenWidth = useScreenWidth();
  const isDesktop = screenWidth >= 1024;
  const [controlPanelOpen, setControlPanelOpen] = useState(false);
  const [fleetMapOpen,     setFleetMapOpen]     = useState(false);
  const [seaMapOpen,       setSeaMapOpen]       = useState(false);

  // ── Sea fleet stats ────────────────────────────────────────────────────────
  const seaShipments = useMemo(() => shipments.filter(s => s.shipmentType === 'Sea'), [shipments]);
  const seaStats = useMemo(() => ({
    total:    seaShipments.length,
    atSea:    seaShipments.filter(s => ['At Sea', 'Vessel Departed'].includes(s.status)).length,
    atPort:   seaShipments.filter(s => ['At Port of Loading', 'At Port of Discharge', 'Booked', 'Loaded'].includes(s.status)).length,
    customs:  seaShipments.filter(s => ['Port Customs', 'Customs Clearance', 'Customs Pending'].includes(s.status)).length,
    arrived:  seaShipments.filter(s => s.status === 'Arrived').length,
    detained: seaShipments.filter(s => s.status === 'Detained').length,
  }), [seaShipments]);

  const activeShipments = useMemo(() => shipments.filter(s =>
    ['In Transit', 'Customs Clearance', 'Dispatched', 'Customs Pending', 'Border Crossing'].includes(s.status)
  ), [shipments]);

  // Sort by createdAt (ISO string) — updatedAt is a locale string and cannot be parsed reliably
  const recentShipments = useMemo(() =>
    [...shipments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
  [shipments]);

  const activeDrivers  = useMemo(() => drivers.filter(d => d.status === 'Active'), [drivers]);
  const idleDrivers    = useMemo(() => drivers.filter(d => d.status === 'Idle'), [drivers]);
  const offlineDrivers = useMemo(() => drivers.filter(d => d.status === 'Offline'), [drivers]);

  const distSegments: DistSeg[] = useMemo(() => [
    { label: t('common.inTransitLabel'), icon: 'directions-car',  color: Colors.primary,  count: shipments.filter(s => ['In Transit','Dispatched','Border Crossing'].includes(s.status)).length },
    { label: t('common.customsLabel'),   icon: 'verified-user',   color: Colors.warning,  count: shipments.filter(s => ['Customs Clearance','Customs Pending'].includes(s.status)).length },
    { label: t('common.arrivedLabel'),   icon: 'check-circle',    color: Colors.success,  count: shipments.filter(s => s.status === 'Arrived').length },
    { label: t('common.loadedLabel'),    icon: 'inventory',       color: Colors.info,     count: shipments.filter(s => s.status === 'Loaded').length },
    { label: 'Detained',                 icon: 'block',           color: Colors.danger,   count: shipments.filter(s => s.status === 'Detained').length },
  ], [shipments, t]);

  const recentActivity = useMemo(() => {
    const sorted = [...shipments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sorted.slice(0, 5).map(s => {
      let icon: keyof typeof MaterialIcons.glyphMap = 'local-shipping';
      let color = Colors.primary;
      if (s.status === 'Arrived')            { icon = 'check-circle'; color = Colors.success; }
      else if (s.status === 'Detained')      { icon = 'block'; color = Colors.danger; }
      else if (['Customs Clearance','Customs Pending'].includes(s.status)) { icon = 'verified-user'; color = Colors.warning; }
      else if (s.status === 'Border Crossing') { icon = 'swap-horiz'; color = '#D2A8FF'; }
      else if (['In Transit','Dispatched'].includes(s.status)) { icon = 'directions-car'; color = Colors.info; }
      return { icon, color, tir: s.tirNumber, status: s.status, time: s.updatedAt.split(',')[1]?.trim() ?? '' };
    });
  }, [shipments]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      {/* ── Mobile Header ── */}
      {!isDesktop && (
        <View style={styles.mobileHeader}>
          <View style={styles.mobileHeaderLeft}>
            <View style={styles.mobileLogoWrap}>
              <MaterialIcons name="swap-horiz" size={15} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.mobileLogoText}>e-TIR</Text>
              <Text style={styles.mobileLogoSub}>by MARAS GROUP</Text>
            </View>
          </View>
          <View style={styles.mobileHeaderActions}>
            {shipmentsLoading && (
              <View style={styles.livePill}>
                <View style={styles.livePulseDot} />
                <Text style={styles.livePillText}>LIVE</Text>
              </View>
            )}
            <LanguagePicker compact />
            <Pressable
              style={[styles.headerIconBtn, styles.headerIconBtnHighlight]}
              onPress={() => setControlPanelOpen(true)}
            >
              <MaterialIcons name="tune" size={18} color={Colors.primary} />
            </Pressable>
            <Pressable
              style={styles.headerIconBtn}
              onPress={async () => { await logout(); router.replace('/'); }}
            >
              <MaterialIcons name="logout" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Desktop Page Header ── */}
      {isDesktop && (
        <View style={styles.desktopHeader}>
          <View style={styles.desktopHeaderLeft}>
            <View style={styles.desktopHeaderIcon}>
              <MaterialIcons name="dashboard" size={18} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.desktopHeaderTitle}>{t('nav.dashboard')}</Text>
              <View style={styles.desktopHeaderSubRow}>
                <Text style={styles.desktopHeaderSub}>{t('dashboard.welcome')}, {user?.displayName}</Text>
                {shipmentsLoading && (
                  <View style={styles.livePill}>
                    <View style={styles.livePulseDot} />
                    <Text style={styles.livePillText}>LIVE</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          <View style={styles.desktopHeaderRight}>
            <Pressable
              style={({ pressed }) => [styles.desktopHeaderBtn, pressed && { opacity: 0.8 }]}
              onPress={() => router.push('/tracking')}
            >
              <MaterialIcons name="open-in-new" size={14} color={Colors.primary} />
              <Text style={styles.desktopHeaderBtnText}>{t('nav.publicTracking')}</Text>
            </Pressable>
          </View>
        </View>
      )}

      <ControlPanel visible={controlPanelOpen} onClose={() => setControlPanelOpen(false)} />
      <SeaMapModal
        visible={seaMapOpen}
        onClose={() => setSeaMapOpen(false)}
        shipments={shipments}
        onViewDetail={(s) => {
          setSeaMapOpen(false);
          setTimeout(() => router.push({ pathname: '/shipment-detail', params: { id: s.id } }), 350);
        }}
      />
      <FleetMapModal
        visible={fleetMapOpen}
        onClose={() => setFleetMapOpen(false)}
        shipments={shipments}
        onShipmentPress={(s) => { setFleetMapOpen(false); router.push({ pathname: '/shipment-detail', params: { id: s.id } }); }}
      />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>

        {/* ── Alert Banner ── */}
        {stats.pending > 0 && (
          <View style={[styles.alertBanner, isDesktop && styles.alertBannerDesktop]}>
            <View style={styles.alertIconWrap}>
              <MaterialIcons name="warning" size={14} color={Colors.warning} />
            </View>
            <Text style={styles.alertText}>
              <Text style={{ fontWeight: '700', color: Colors.warning }}>{stats.pending}</Text>
              {' '}{stats.pending > 1 ? t('dashboard.customsAlertPlural') : t('dashboard.customsAlert')}
            </Text>
            <Pressable style={styles.alertActionBtn} onPress={() => router.push('/(tabs)/shipments')}>
              <Text style={styles.alertActionText}>{t('dashboard.view')}</Text>
              <MaterialIcons name="arrow-forward" size={11} color={Colors.warning} />
            </Pressable>
          </View>
        )}

        {/* ── Stat Cards ── */}
        <View style={[styles.statsGrid, isDesktop && styles.statsGridDesktop]}>
          <StatCard
            label={t('dashboard.totalShipments')}
            value={stats.total}
            icon="local-shipping"
            accentColor={Colors.primary}
            subtitle={t('shipments.totalManifests')}
            trend="neutral"
            onPress={() => router.push('/(tabs)/shipments')}
          />
          <StatCard
            label={t('dashboard.activeTransitStat')}
            value={stats.active}
            icon="route"
            accentColor={Colors.info}
            subtitle={t('dashboard.inMotion')}
            trend={stats.active > 0 ? 'up' : 'neutral'}
            trendLabel={stats.active > 0 ? t('drivers.active') : undefined}
            onPress={() => router.push('/(tabs)/shipments')}
          />
          <StatCard
            label={t('dashboard.customsQueue')}
            value={stats.pending}
            icon="verified-user"
            accentColor={Colors.warning}
            subtitle={t('dashboard.needsAttention')}
            trend={stats.pending > 0 ? 'down' : 'neutral'}
            trendLabel={stats.pending > 0 ? t('drivers.idle') : undefined}
            onPress={() => router.push('/(tabs)/shipments')}
          />
          <StatCard
            label={t('dashboard.delivered')}
            value={stats.arrived}
            icon="check-circle"
            accentColor={Colors.success}
            subtitle={t('dashboard.arrived')}
            trend={stats.arrived > 0 ? 'up' : 'neutral'}
            trendLabel={stats.arrived > 0 ? t('dashboard.arrived') : undefined}
            onPress={() => router.push('/(tabs)/shipments')}
          />
        </View>

        {/* ── Sea Fleet Mini Card ── */}
        {seaShipments.length > 0 && (
          <Pressable
            style={({ pressed }) => [
              seaSt.card,
              isDesktop ? seaSt.cardDesktop : seaSt.cardMobile,
              pressed && { opacity: 0.88 },
            ]}
            onPress={() => setSeaMapOpen(true)}
          >
            {/* Left teal accent */}
            <View style={seaSt.accentBar} />
            <View style={seaSt.inner}>
              {/* Header row */}
              <View style={seaSt.headerRow}>
                <View style={seaSt.iconWrap}>
                  <MaterialIcons name="directions-boat" size={16} color="#58C4DC" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={seaSt.title}>Sea Fleet</Text>
                  <Text style={seaSt.sub}>{seaShipments.length} sea shipment{seaShipments.length !== 1 ? 's' : ''}</Text>
                </View>
                <View style={seaSt.openBtn}>
                  <MaterialIcons name="open-in-new" size={13} color="#58C4DC" />
                  <Text style={seaSt.openBtnText}>{t('tracking.track')}</Text>
                </View>
              </View>
              {/* Stats row */}
              <View style={seaSt.statsRow}>
                {[
                  { icon: 'water' as const,         label: 'At Sea',   value: seaStats.atSea,   color: Colors.primary },
                  { icon: 'anchor' as const,        label: 'At Port',  value: seaStats.atPort,  color: '#818CF8' },
                  { icon: 'verified-user' as const, label: t('dashboard.customsQueue'),  value: seaStats.customs, color: Colors.warning },
                  { icon: 'check-circle' as const,  label: t('dashboard.arrived'),  value: seaStats.arrived, color: Colors.success },
                  ...(seaStats.detained > 0
                    ? [{ icon: 'block' as const, label: 'Detained', value: seaStats.detained, color: Colors.danger }]
                    : []),
                ].map((item, i, arr) => (
                  <React.Fragment key={item.label}>
                    <View style={seaSt.statItem}>
                      <View style={[seaSt.statIcon, { backgroundColor: `${item.color}15` }]}>
                        <MaterialIcons name={item.icon} size={11} color={item.color} />
                      </View>
                      <Text style={[seaSt.statValue, { color: item.color }]}>{item.value}</Text>
                      <Text style={seaSt.statLabel}>{item.label}</Text>
                    </View>
                    {i < arr.length - 1 && <View style={seaSt.statSep} />}
                  </React.Fragment>
                ))}
              </View>
            </View>
          </Pressable>
        )}

        {/* ═══════════════════════════════════════════════════════════
            DESKTOP LAYOUT
        ═══════════════════════════════════════════════════════════ */}
        {isDesktop ? (
          <View style={styles.desktopGrid}>

            {/* ── LEFT COLUMN ── */}
            <View style={styles.desktopCol}>

              {/* Fleet Distribution */}
              {shipments.length > 0 && (
                <View style={styles.desktopSection}>
                  <SectionLabel icon="pie-chart" title={t('dashboard.fleetSummary')} badge={shipments.length} />
                  <View style={styles.distCard}>
                    <FleetDistribution segments={distSegments} total={shipments.length} />
                  </View>
                </View>
              )}

              {/* Fleet Map */}
              <View style={styles.desktopSection}>
                <View style={styles.sectionHeaderRow}>
                  <SectionLabel icon="satellite-alt" title={t('dashboard.fleetTracking')} />
                  <View style={styles.sectionHeaderRight}>
                    <View style={styles.liveIndicator}>
                      <View style={styles.livePulseDot} />
                      <Text style={styles.liveLabel}>{t('dashboard.live')}</Text>
                    </View>
                    <Pressable
                      style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.8 }]}
                      onPress={() => setFleetMapOpen(true)}
                    >
                      <MaterialIcons name="fullscreen" size={12} color={Colors.primary} />
                      <Text style={styles.mapBtnText}>{t('tracking.track')}</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.mapCard}>
                  {LiveMap ? (
                    <LiveMap
                      shipments={shipments}
                      height={300}
                      showAllShipments
                      onShipmentPress={(s) => router.push({ pathname: '/shipment-detail', params: { id: s.id } })}
                    />
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.mapFallback, pressed && { opacity: 0.9 }]}
                      onPress={() => setFleetMapOpen(true)}
                    >
                      <View style={styles.mapFallbackIcon}>
                        <MaterialIcons name="satellite-alt" size={28} color={Colors.primary} />
                      </View>
                      <Text style={styles.mapFallbackTitle}>{t('dashboard.fleetTracking')}</Text>
                      <Text style={styles.mapFallbackSub}>Tap to view live fleet positions and filter by status.</Text>
                      <View style={styles.mapFallbackBtn}>
                        <MaterialIcons name="fullscreen" size={14} color="#fff" />
                        <Text style={styles.mapFallbackBtnTxt}>{t('dashboard.fleetTracking')}</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
                {/* Map legend */}
                <View style={styles.mapLegend}>
                  {[
                    { color: Colors.primary,  label: t('common.inTransitLabel') },
                    { color: Colors.warning,  label: t('common.customsLabel') },
                    { color: Colors.success,  label: t('common.arrivedLabel') },
                    { color: Colors.info,     label: t('common.loadedLabel') },
                    { color: Colors.danger,   label: 'Detained' },
                  ].map(item => (
                    <View key={item.label} style={styles.mapLegendItem}>
                      <View style={[styles.mapLegendDot, { backgroundColor: item.color }]} />
                      <Text style={styles.mapLegendText}>{item.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Recent Shipments */}
              <View style={styles.desktopSection}>
                <SectionLabel
                  icon="schedule"
                  title={t('dashboard.recentActivity')}
                  badge={recentShipments.length}
                  action={t('dashboard.seeAll')}
                  onAction={() => router.push('/(tabs)/shipments')}
                />
                <View style={styles.listCard}>
                  {recentShipments.length === 0 ? (
                    <View style={styles.listCardEmpty}>
                      <MaterialIcons name="local-shipping" size={24} color={Colors.border} />
                      <Text style={styles.listCardEmptyText}>{t('shipments.noShipmentsFound')}</Text>
                    </View>
                  ) : recentShipments.map((s, i) => (
                    <RecentShipmentRow
                      key={s.id}
                      shipment={s}
                      last={i === recentShipments.length - 1}
                      onPress={() => router.push({ pathname: '/shipment-detail', params: { id: s.id } })}
                    />
                  ))}
                </View>
              </View>
            </View>

            {/* ── RIGHT COLUMN ── */}
            <View style={styles.desktopColNarrow}>

              {/* Quick Actions */}
              <View style={styles.desktopSection}>
                <SectionLabel icon="bolt" title={t('nav.quickAccess')} />
                <View style={styles.quickActionsGrid}>
                  <QuickAction icon="add-circle"      label={t('shipments.newShipment')}  color={Colors.primary}       onPress={() => router.push('/(tabs)/shipments')} />
                  <QuickAction icon="my-location"     label={t('nav.publicTracking')}     color={Colors.info}          onPress={() => router.push('/tracking')} />
                  <QuickAction icon="people"          label={t('nav.drivers')}             color={Colors.success}       onPress={() => router.push('/(tabs)/drivers')} />
                  <QuickAction icon="business"        label="Clients"                      color="#D2A8FF"              onPress={() => router.push('/(tabs)/clients')} />
                  <QuickAction icon="chat"            label={t('nav.chat')}                color={Colors.warning}       onPress={() => router.push('/(tabs)/chat')} badge={totalUnread} />
                  {seaShipments.length > 0 && (
                    <QuickAction icon="directions-boat" label="Sea Fleet"  color="#58C4DC"              onPress={() => setSeaMapOpen(true)} badge={seaStats.detained > 0 ? seaStats.detained : undefined} />
                  )}
                  <QuickAction icon="tune"            label="Control"      color={Colors.textSecondary} onPress={() => setControlPanelOpen(true)} />
                </View>
              </View>

              {/* Fleet Summary */}
              <View style={styles.desktopSection}>
                <SectionLabel icon="directions-car" title={t('dashboard.fleetSummary')} />
                <View style={styles.listCard}>
                  {[
                    { label: t('dashboard.totalDrivers'), value: drivers.length,        icon: 'people' as const,           color: Colors.textPrimary },
                    { label: t('dashboard.activeNow'),    value: activeDrivers.length,  icon: 'check-circle' as const,     color: Colors.success },
                    { label: t('dashboard.idle'),          value: idleDrivers.length,    icon: 'pause-circle' as const,     color: Colors.warning },
                    { label: t('dashboard.offline'),       value: offlineDrivers.length, icon: 'radio-button-off' as const, color: Colors.textMuted },
                  ].map((row, i, arr) => (
                    <View key={row.label} style={[styles.fleetSummaryRow, i < arr.length - 1 && styles.rowBorder]}>
                      <View style={[styles.fleetSummaryIcon, { backgroundColor: `${row.color}12` }]}>
                        <MaterialIcons name={row.icon} size={13} color={row.color} />
                      </View>
                      <Text style={styles.fleetSummaryLabel}>{row.label}</Text>
                      <Text style={[styles.fleetSummaryValue, { color: row.color }]}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Active Drivers list */}
              <View style={styles.desktopSection}>
                <SectionLabel
                  icon="people"
                  title={t('dashboard.activeDrivers')}
                  badge={activeDrivers.length}
                  action={t('dashboard.seeAll')}
                  onAction={() => router.push('/(tabs)/drivers')}
                />
                <View style={styles.listCard}>
                  {activeDrivers.length + idleDrivers.length === 0 ? (
                    <View style={styles.listCardEmpty}>
                      <MaterialIcons name="people-outline" size={24} color={Colors.border} />
                      <Text style={styles.listCardEmptyText}>{t('dashboard.noActiveDrivers')}</Text>
                    </View>
                  ) : (
                    [...activeDrivers, ...idleDrivers].slice(0, 6).map((d, i, arr) => (
                      <View key={d.id} style={[styles.driverRow, i < arr.length - 1 && styles.rowBorder]}>
                        <View style={styles.driverAvatar}>
                          <Text style={styles.driverAvatarText}>{d.avatarInitials}</Text>
                          <View style={[styles.driverStatusDot, {
                            backgroundColor: d.status === 'Active' ? Colors.success : d.status === 'Idle' ? Colors.warning : Colors.textMuted,
                          }]} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.driverName}>{d.fullName}</Text>
                          <Text style={styles.driverPlate}>{d.plateNumber}</Text>
                        </View>
                        <View style={[styles.driverStatusPill, {
                          backgroundColor: d.status === 'Active' ? Colors.successBg : Colors.warningBg,
                        }]}>
                          <Text style={[styles.driverStatusText, {
                            color: d.status === 'Active' ? Colors.success : Colors.warning,
                          }]}>{d.status}</Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </View>

              {/* Recent Activity */}
              <View style={styles.desktopSection}>
                <SectionLabel icon="history" title={t('dashboard.recentActivity')} />
                <View style={styles.listCard}>
                  {recentActivity.length === 0 ? (
                    <View style={styles.listCardEmpty}>
                      <Text style={styles.listCardEmptyText}>{t('dashboard.noActiveDrivers')}</Text>
                    </View>
                  ) : recentActivity.map((item, i) => (
                    <View key={i} style={[styles.activityRow, i < recentActivity.length - 1 && styles.rowBorder]}>
                      <View style={[styles.activityIconWrap, { backgroundColor: `${item.color}15`, borderColor: `${item.color}28` }]}>
                        <MaterialIcons name={item.icon} size={12} color={item.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.activityTir}>{item.tir}</Text>
                        <Text style={styles.activityStatus}>{item.status}</Text>
                      </View>
                      <Text style={styles.activityTime}>{item.time}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>

        ) : (
          /* ═══════════════════════════════════════════════════════════
              MOBILE LAYOUT
          ═══════════════════════════════════════════════════════════ */
          <View>

            {/* Quick Actions */}
            <View style={styles.mobileSection}>
              <SectionLabel icon="bolt" title={t('nav.quickAccess')} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActionsRow}>
                <QuickAction icon="add-circle"      label={t('shipments.newShipment')}  color={Colors.primary}       onPress={() => router.push('/(tabs)/shipments')} />
                <QuickAction icon="my-location"     label={t('nav.publicTracking')}     color={Colors.info}          onPress={() => router.push('/tracking')} />
                <QuickAction icon="people"          label={t('nav.drivers')}             color={Colors.success}       onPress={() => router.push('/(tabs)/drivers')} />
                <QuickAction icon="business"        label="Clients"                      color="#D2A8FF"              onPress={() => router.push('/(tabs)/clients')} />
                <QuickAction icon="chat"            label={t('nav.chat')}                color={Colors.warning}       onPress={() => router.push('/(tabs)/chat')} badge={totalUnread} />
                {seaShipments.length > 0 && (
                  <QuickAction icon="directions-boat" label="Sea Fleet"   color="#58C4DC"              onPress={() => setSeaMapOpen(true)} badge={seaStats.detained > 0 ? seaStats.detained : undefined} />
                )}
                <QuickAction icon="tune"            label="Control"      color={Colors.textSecondary} onPress={() => setControlPanelOpen(true)} />
              </ScrollView>
            </View>

            {/* Fleet Distribution */}
            {shipments.length > 0 && (
              <View style={styles.mobileSection}>
                <SectionLabel icon="pie-chart" title={t('dashboard.fleetSummary')} badge={shipments.length} />
                <View style={styles.distCard}>
                  <FleetDistribution segments={distSegments} total={shipments.length} />
                </View>
              </View>
            )}

            {/* Fleet Map */}
            <View style={styles.mobileSection}>
              <View style={styles.sectionHeaderRow}>
                <SectionLabel icon="satellite-alt" title={t('dashboard.fleetTracking')} />
                <View style={styles.sectionHeaderRight}>
                  <View style={styles.liveIndicator}>
                    <View style={styles.livePulseDot} />
                    <Text style={styles.liveLabel}>{t('dashboard.live')}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.8 }]}
                    onPress={() => setFleetMapOpen(true)}
                  >
                    <MaterialIcons name="fullscreen" size={12} color={Colors.primary} />
                    <Text style={styles.mapBtnText}>{t('tracking.track')}</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.mapCard}>
                {LiveMap ? (
                  <LiveMap
                    shipments={shipments}
                    height={220}
                    showAllShipments
                    onShipmentPress={(s) => router.push({ pathname: '/shipment-detail', params: { id: s.id } })}
                  />
                ) : (
                  <Pressable
                    style={({ pressed }) => [styles.mapFallback, { height: 220 }, pressed && { opacity: 0.9 }]}
                    onPress={() => setFleetMapOpen(true)}
                  >
                    <View style={styles.mapFallbackIcon}>
                      <MaterialIcons name="satellite-alt" size={24} color={Colors.primary} />
                    </View>
                    <Text style={styles.mapFallbackTitle}>{t('dashboard.fleetTracking')}</Text>
                    <Text style={styles.mapFallbackSub}>Tap to open the full fleet map.</Text>
                    <View style={styles.mapFallbackBtn}>
                      <MaterialIcons name="fullscreen" size={13} color="#fff" />
                      <Text style={styles.mapFallbackBtnTxt}>{t('dashboard.fleetTracking')}</Text>
                    </View>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Recent Shipments mini-list */}
            <View style={styles.mobileSection}>
              <SectionLabel
                icon="schedule"
                title={t('dashboard.recentActivity')}
                badge={recentShipments.length}
                action={t('dashboard.seeAll')}
                onAction={() => router.push('/(tabs)/shipments')}
              />
              <View style={styles.listCard}>
                {recentShipments.length === 0 ? (
                  <View style={styles.listCardEmpty}>
                    <MaterialIcons name="local-shipping" size={24} color={Colors.border} />
                    <Text style={styles.listCardEmptyText}>{t('shipments.noShipmentsFound')}</Text>
                  </View>
                ) : recentShipments.map((s, i) => (
                  <RecentShipmentRow
                    key={s.id}
                    shipment={s}
                    last={i === recentShipments.length - 1}
                    onPress={() => router.push({ pathname: '/shipment-detail', params: { id: s.id } })}
                  />
                ))}
              </View>
            </View>

            {/* Drivers strip */}
            <View style={styles.mobileSection}>
              <SectionLabel
                icon="people"
                title={t('dashboard.activeDrivers')}
                badge={activeDrivers.length}
                action={t('dashboard.seeAll')}
                onAction={() => router.push('/(tabs)/drivers')}
              />
              {activeDrivers.length + idleDrivers.length === 0 ? (
                <View style={[styles.listCard, styles.listCardEmpty]}>
                  <MaterialIcons name="people-outline" size={24} color={Colors.border} />
                  <Text style={styles.listCardEmptyText}>{t('dashboard.noActiveDrivers')}</Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.driverScrollRow}>
                  {[...activeDrivers, ...idleDrivers].slice(0, 8).map(d => (
                    <View key={d.id} style={styles.driverChip}>
                      <View style={styles.driverAvatar}>
                        <Text style={styles.driverAvatarText}>{d.avatarInitials}</Text>
                        <View style={[styles.driverStatusDot, {
                          backgroundColor: d.status === 'Active' ? Colors.success : d.status === 'Idle' ? Colors.warning : Colors.textMuted,
                        }]} />
                      </View>
                      <View>
                        <Text style={styles.driverName}>{d.fullName.split(' ')[0]}</Text>
                        <Text style={styles.driverPlate}>{d.plateNumber}</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Recent Activity */}
            <View style={[styles.mobileSection, { paddingBottom: 100 }]}>
              <SectionLabel icon="history" title={t('dashboard.recentActivity')} />
              <View style={styles.listCard}>
                {recentActivity.length === 0 ? (
                  <View style={styles.listCardEmpty}>
                    <Text style={styles.listCardEmptyText}>{t('dashboard.noActiveDrivers')}</Text>
                  </View>
                ) : recentActivity.map((item, i) => (
                  <View key={i} style={[styles.activityRow, i < recentActivity.length - 1 && styles.rowBorder]}>
                    <View style={[styles.activityIconWrap, { backgroundColor: `${item.color}15`, borderColor: `${item.color}28` }]}>
                      <MaterialIcons name={item.icon} size={12} color={item.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityTir}>{item.tir}</Text>
                      <Text style={styles.activityStatus}>{item.status}</Text>
                    </View>
                    <Text style={styles.activityTime}>{item.time}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        <View style={{ height: isDesktop ? 40 : 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },

  // ── Mobile Header ────────────────────────────────────────────────────────────
  mobileHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  mobileHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mobileLogoWrap: {
    width: 32, height: 32, borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  mobileLogoText: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary, letterSpacing: 0.5 },
  mobileLogoSub: { fontSize: 9, fontWeight: '600', color: Colors.textMuted, letterSpacing: 0.8, marginTop: 1 },
  mobileHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  headerIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  headerIconBtnHighlight: {
    backgroundColor: Colors.primaryGlow,
    borderColor: 'rgba(47,129,247,0.35)',
  },

  // ── Desktop Header ───────────────────────────────────────────────────────────
  desktopHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xxxl, paddingVertical: Spacing.xl,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  desktopHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  desktopHeaderIcon: {
    width: 44, height: 44, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  desktopHeaderTitle: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  desktopHeaderSubRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  desktopHeaderSub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  desktopHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  desktopHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  desktopHeaderBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },

  // ── Live Pill ────────────────────────────────────────────────────────────────
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: `${Colors.success}15`, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  livePulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  livePillText: { fontSize: 9, color: Colors.success, fontWeight: '700', letterSpacing: 0.8 },

  // ── Alert Banner ─────────────────────────────────────────────────────────────
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.warningBg,
    marginHorizontal: Spacing.xl, marginTop: Spacing.lg,
    borderRadius: BorderRadius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(210,153,34,0.3)',
  },
  alertBannerDesktop: { marginHorizontal: Spacing.xxxl },
  alertIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(210,153,34,0.15)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(210,153,34,0.3)',
  },
  alertText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  alertActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(210,153,34,0.15)', borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(210,153,34,0.4)',
  },
  alertActionText: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '700' },

  // ── Stat Cards ───────────────────────────────────────────────────────────────
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.xs,
  },
  statsGridDesktop: {
    paddingHorizontal: Spacing.xxxl, flexWrap: 'nowrap', paddingTop: Spacing.xl,
  },
  statCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
    flex: 1, minWidth: 140,
    flexDirection: 'row',
    ...Shadow.card,
  },
  statAccentBar: { width: 3, alignSelf: 'stretch' },
  statCardInner: { flex: 1, padding: Spacing.lg, gap: 5 },
  statTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  statIconWrap: {
    width: 32, height: 32, borderRadius: BorderRadius.sm,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  trendPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: BorderRadius.full, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1,
  },
  trendPillText: { fontSize: 9, fontWeight: '700' },
  statValue: { fontSize: FontSize.xxl, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  statSubtitle: { fontSize: 10, color: Colors.textMuted },

  // ── Section Label ────────────────────────────────────────────────────────────
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabelLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionLabelIconWrap: {
    width: 20, height: 20, borderRadius: 6,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  sectionLabelText: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9 },
  sectionBadge: {
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  sectionBadgeText: { fontSize: 9, color: Colors.primary, fontWeight: '700' },
  sectionAction: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  // ── Quick Actions ────────────────────────────────────────────────────────────
  quickActionsRow: { flexDirection: 'row', gap: Spacing.md, paddingVertical: 4 },
  quickActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  quickAction: { alignItems: 'center', gap: 5, width: 66 },
  quickActionIconWrap: {
    width: 52, height: 52, borderRadius: BorderRadius.lg,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, position: 'relative',
  },
  quickActionBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: Colors.danger, borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.bg,
  },
  quickActionBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff' },
  quickActionLabel: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },

  // ── Fleet Distribution ───────────────────────────────────────────────────────
  distCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
  },
  fleetDist: { gap: Spacing.lg },
  distBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 1 },
  distBarSeg: { height: '100%' },
  distLegendGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, rowGap: Spacing.sm,
  },
  distLegendItem: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, minWidth: 100,
    flex: 1,
  },
  distLegendIcon: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  distLegendText: { flex: 1, gap: 1 },
  distLegendCount: { fontSize: FontSize.base, fontWeight: '800' },
  distLegendLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '600' },
  distLegendPct: { fontSize: 9, color: Colors.textMuted, fontFamily: 'monospace', fontWeight: '600' },

  // ── Recent Shipment Row ──────────────────────────────────────────────────────
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 11,
  },
  recentRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  recentTypeIcon: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  recentInfo: { flex: 1, gap: 3 },
  recentTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  recentTir: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'monospace' },
  recentRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  recentRoute: { fontSize: FontSize.xs, color: Colors.textMuted, flex: 1 },

  // ── Map ──────────────────────────────────────────────────────────────────────
  mapCard: {
    borderRadius: BorderRadius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  mapFallback: {
    height: 280, backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, padding: Spacing.xl,
  },
  mapFallbackIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  mapFallbackTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  mapFallbackSub: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  mapFallbackBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 6,
  },
  mapFallbackBtnTxt: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff' },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  mapBtnText: { fontSize: 10, color: Colors.primary, fontWeight: '700', letterSpacing: 0.2 },
  mapLegend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  mapLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mapLegendDot: { width: 8, height: 8, borderRadius: 4 },
  mapLegendText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveLabel: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '700' },

  // ── List Card ────────────────────────────────────────────────────────────────
  listCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  listCardEmpty: { padding: Spacing.xl, alignItems: 'center', gap: 8 },
  listCardEmptyText: { fontSize: FontSize.sm, color: Colors.textMuted },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },

  // ── Fleet Summary ────────────────────────────────────────────────────────────
  fleetSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 11,
  },
  fleetSummaryIcon: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  fleetSummaryLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  fleetSummaryValue: { fontSize: FontSize.base, fontWeight: '800' },

  // ── Driver Rows ──────────────────────────────────────────────────────────────
  driverScrollRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 4 },
  driverChip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  driverRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  driverAvatar: {
    width: 36, height: 36, borderRadius: 18, position: 'relative',
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  driverAvatarText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary },
  driverStatusDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: Colors.card,
  },
  driverName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  driverPlate: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', marginTop: 1 },
  driverStatusPill: { borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 3 },
  driverStatusText: { fontSize: 10, fontWeight: '700' },

  // ── Activity ──────────────────────────────────────────────────────────────────
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  activityIconWrap: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  activityTir: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary, fontFamily: 'monospace' },
  activityStatus: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  activityTime: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', flexShrink: 0 },

  // ── Mobile Sections ───────────────────────────────────────────────────────────
  mobileSection: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, gap: Spacing.md },

  // ── Desktop Grid ──────────────────────────────────────────────────────────────
  desktopGrid: {
    flexDirection: 'row', paddingHorizontal: Spacing.xxxl,
    paddingTop: Spacing.xl, gap: Spacing.xl, alignItems: 'flex-start',
  },
  desktopCol: { flex: 1.4, gap: Spacing.xl },
  desktopColNarrow: { flex: 1, gap: Spacing.xl },
  desktopSection: { gap: Spacing.md },
});

// ── Sea Fleet Card styles ────────────────────────────────────────────────────────────
const seaSt = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)',
    overflow: 'hidden',
    ...Shadow.card,
  },
  cardMobile: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.lg,
  },
  cardDesktop: {
    marginHorizontal: Spacing.xxxl,
    marginTop: Spacing.lg,
  },
  accentBar: {
    width: 3,
    backgroundColor: '#58C4DC',
    alignSelf: 'stretch',
  },
  inner: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconWrap: {
    width: 36, height: 36, borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(88,196,220,0.12)',
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  sub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(88,196,220,0.1)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)',
  },
  openBtnText: { fontSize: FontSize.xs, fontWeight: '700', color: '#58C4DC' },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
    paddingVertical: 10, paddingHorizontal: Spacing.md,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 3 },
  statIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { fontSize: FontSize.lg, fontWeight: '800' },
  statLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '600' },
  statSep: { width: 1, height: 32, backgroundColor: Colors.borderSubtle },
});
