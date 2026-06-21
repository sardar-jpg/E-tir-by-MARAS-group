import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Platform, Share, Clipboard,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useShipments } from '@/hooks/useShipments';
import { useLanguage } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CheckpointProgress } from '@/components/ui/CheckpointProgress';
import { Shipment } from '@/types';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

// LiveMap lazy-require (not available in Expo Go)
let LiveMap: typeof import('@/components/feature/LiveMap').LiveMap | null = null;
try {
  LiveMap = require('@/components/feature/LiveMap').LiveMap;
} catch (_e) {}

export default function PublicTracking() {
  const router = useRouter();
  const params = useLocalSearchParams<{ number?: string; id?: string }>();
  const { getByTirNumber, getById } = useShipments();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-load shipment if number or id is in URL params
  useEffect(() => {
    const num = params.number ?? params.id;
    if (num) {
      setQuery(num);
      handleSearchWithQuery(num);
    }
  }, [params.number, params.id]);

  // 15-second polling when a shipment is loaded
  useEffect(() => {
    if (!shipment) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const poll = async () => {
      setRefreshing(true);
      try {
        const { fetchShipmentByTirNumber } = await import('@/services/shipmentService');
        const { shipment: updated } = await fetchShipmentByTirNumber(shipment.tirNumber);
        if (updated) { setShipment(updated); setLastRefresh(new Date()); }
      } finally {
        setRefreshing(false);
      }
    };
    pollRef.current = setInterval(poll, 15000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [shipment?.tirNumber]);

  const getTrackingUrl = (tirNumber: string) => {
    const encoded = encodeURIComponent(tirNumber);
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/tracking?number=${encoded}`;
    }
    return `/tracking?number=${encoded}`;
  };

  const handleShare = async () => {
    if (!shipment) return;
    const url = getTrackingUrl(shipment.tirNumber);
    const message = `Track your MARAS shipment ${shipment.tirNumber}:\n${url}`;
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        Clipboard.setString(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } else {
      await Share.share({ message, url });
    }
  };

  const handleSearchWithQuery = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearching(true);
    // Try local context first (fast) — by ETR number
    let result = getByTirNumber(trimmed);
    if (!result) {
      // Fall back to DB fetch by tir_number
      const { fetchShipmentByTirNumber } = await import('@/services/shipmentService');
      const { shipment: fetched } = await fetchShipmentByTirNumber(trimmed);
      result = fetched;
    }
    if (result) { setShipment(result); setNotFound(false); }
    else { setShipment(null); setNotFound(true); }
    setSearching(false);
  };

  const handleSearch = async () => {
    await handleSearchWithQuery(query);
  };

  const cleared = shipment ? shipment.checkpoints.filter(c => c.status === 'Cleared').length : 0;
  const total = shipment ? shipment.checkpoints.length : 1;
  const progress = cleared / total;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('tracking.shipmentTracker')}</Text>
          <Text style={styles.headerSub}>{t('tracking.noLoginRequired')}</Text>
        </View>
        <LanguagePicker compact />
        <View style={styles.publicBadge}>
          <MaterialIcons name="public" size={14} color={Colors.success} />
          <Text style={styles.publicText}>{t('tracking.open')}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={styles.searchSection}>
          <Text style={styles.searchTitle}>{t('tracking.trackYourShipment')}</Text>
          <Text style={styles.searchSub}>{t('tracking.searchSub')}</Text>
          <View style={styles.searchRow}>
            <View style={styles.inputWrap}>
              <MaterialIcons name="search" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder={t('tracking.tokenPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                onSubmitEditing={handleSearch}
              />
              {query ? (
                <Pressable onPress={() => { setQuery(''); setShipment(null); setNotFound(false); }} hitSlop={8}>
                  <MaterialIcons name="close" size={15} color={Colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              style={({ pressed }) => [styles.searchBtn, pressed && { opacity: 0.85 }, searching && { opacity: 0.6 }]}
              onPress={handleSearch}
              disabled={searching}
            >
              {searching
                ? <MaterialIcons name="hourglass-empty" size={20} color="#fff" />
                : <MaterialIcons name="search" size={20} color="#fff" />}
            </Pressable>
          </View>

          {/* Info chip */}
          <View style={styles.infoChip}>
            <MaterialIcons name="info-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.infoChipText}>{t('tracking.searchSub')}</Text>
          </View>
        </View>

        {notFound && (
          <View style={styles.notFound}>
            <MaterialIcons name="search-off" size={36} color={Colors.textMuted} />
            <Text style={styles.notFoundTitle}>{t('tracking.noShipmentFound')}</Text>
            <Text style={styles.notFoundSub}>
              {t('tracking.noShipmentSub').replace('%s', query)}
            </Text>
          </View>
        )}

        {shipment && (
          <View style={styles.resultSection}>
            {/* Status Header */}
            <View style={styles.resultHeader}>
              <View style={styles.resultTirRow}>
                <MaterialIcons name="local-shipping" size={18} color={Colors.primary} />
                <Text style={styles.resultTir}>{shipment.tirNumber}</Text>
              </View>
              <StatusBadge status={shipment.status} />
            </View>

            {/* Shipment Number display */}
            <View style={styles.shipmentIdCard}>
              <View style={styles.shipmentIdLeft}>
                <MaterialIcons name="confirmation-number" size={13} color={Colors.primary} />
                <Text style={styles.shipmentIdLabel}>{t('tracking.title')}</Text>
              </View>
              <Text style={styles.shipmentIdValue}>{shipment.tirNumber}</Text>
            </View>

            {/* Auto-refresh status bar */}
            <View style={styles.refreshBar}>
              <View style={styles.refreshLeft}>
                <View style={[styles.refreshDot, refreshing && styles.refreshDotActive]} />
                <Text style={styles.refreshText}>
                  {refreshing ? t('tracking.refreshing') : t('tracking.autoRefresh')}
                </Text>
              </View>
              {lastRefresh && (
                <Text style={styles.refreshTime}>
                  {t('tracking.updated')} {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Text>
              )}
            </View>

            {/* Share link button */}
            <Pressable
              style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.8 }]}
              onPress={handleShare}
            >
              <MaterialIcons
                name={copied ? 'check-circle' : 'share'}
                size={16}
                color={copied ? Colors.success : Colors.primary}
              />
              <Text style={[styles.shareBtnText, copied && { color: Colors.success }]}>
                {copied
                  ? t('tracking.linkCopied')
                  : Platform.OS === 'web'
                    ? t('tracking.copyLink')
                    : t('tracking.shareLink')}
              </Text>
              {!copied && (
                <View style={styles.shareLinkPreview}>
                  <Text style={styles.shareLinkText} numberOfLines={1}>/tracking?number={shipment.tirNumber}</Text>
                </View>
              )}
            </Pressable>

            {/* Progress */}
            <View style={styles.progressCard}>
              <View style={styles.progressLabelRow}>
                <Text style={styles.progressLabel}>{t('tracking.journeyProgress')}</Text>
                <Text style={styles.progressPct}>{Math.round(progress * 100)}%</Text>
              </View>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
              </View>
              <View style={styles.progressInfo}>
                <Text style={styles.progressInfoText}>
                  {cleared} {t('tracking.checkpointsCleared').replace('%t', String(total))}
                </Text>
                <Text style={styles.progressInfoText}>{t('tracking.eta')} {shipment.estimatedArrival}</Text>
              </View>
            </View>

            {/* Live Location Map */}
            <View style={styles.mapCard}>
              <View style={styles.mapCardHeader}>
                <MaterialIcons name="map" size={14} color={Colors.primary} />
                <Text style={styles.mapCardTitle}>{t('tracking.currentLocation')}</Text>
                {(shipment.lat && shipment.lng) ? (
                  <View style={styles.gpsActiveBadge}>
                    <View style={styles.gpsActiveDot} />
                    <Text style={styles.gpsActiveText}>{t('tracking.gpsActive')}</Text>
                  </View>
                ) : (
                  <View style={styles.gpsOffBadge}>
                    <MaterialIcons name="gps-off" size={10} color={Colors.textMuted} />
                    <Text style={styles.gpsOffText}>{t('tracking.noSignal')}</Text>
                  </View>
                )}
              </View>
              {LiveMap ? (
                <LiveMap
                  shipments={[shipment]}
                  focusShipment={shipment}
                  height={200}
                  showAllShipments={false}
                />
              ) : (
                <View style={styles.mapUnavailable}>
                  <MaterialIcons name="map" size={28} color={Colors.border} />
                  <Text style={styles.mapUnavailableText}>{t('tracking.noLoginRequired')}</Text>
                </View>
              )}
            </View>

            {/* Route */}
            <View style={styles.routeCard}>
              <View style={styles.routeItem}>
                <MaterialIcons name="trip-origin" size={20} color={Colors.primary} />
                <View>
                  <Text style={styles.routeLabel}>{t('tracking.origin')}</Text>
                  <Text style={styles.routeValue}>{shipment.origin}</Text>
                </View>
              </View>
              <View style={styles.routeDivider} />
              <View style={styles.routeItem}>
                <MaterialIcons name="place" size={20} color={Colors.success} />
                <View>
                  <Text style={styles.routeLabel}>{t('tracking.destination')}</Text>
                  <Text style={styles.routeValue}>{shipment.destination}</Text>
                </View>
              </View>
            </View>

            {/* Cargo Info */}
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('tracking.cargo')}</Text>
                <Text style={styles.infoValue}>{shipment.cargoDescription}</Text>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('tracking.weight')}</Text>
                <Text style={styles.infoValue}>{shipment.weight}</Text>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('tracking.driver')}</Text>
                <Text style={styles.infoValue}>{shipment.driverName}</Text>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('tracking.lastUpdated')}</Text>
                <Text style={[styles.infoValue, { fontFamily: 'monospace', fontSize: FontSize.xs }]}>{shipment.updatedAt}</Text>
              </View>
            </View>

            {/* Checkpoints */}
            <View style={styles.checkpointsCard}>
              <Text style={styles.checkpointsTitle}>{t('tracking.transitCheckpoints')}</Text>
              <CheckpointProgress checkpoints={shipment.checkpoints} />
            </View>

            {/* Footer note */}
            <View style={styles.footerNote}>
              <MaterialIcons name="info-outline" size={14} color={Colors.textMuted} />
              <Text style={styles.footerNoteText}>{t('tracking.footerNote')}</Text>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textMuted },
  publicBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.success,
  },
  publicText: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '600' },

  scroll: { flex: 1 },
  searchSection: { padding: Spacing.xl, gap: Spacing.md },
  searchTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  searchSub: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  searchRow: { flexDirection: 'row', gap: Spacing.sm },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: FontSize.sm, color: Colors.textPrimary, fontFamily: 'monospace' },
  searchBtn: {
    width: 48, height: 48, backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center',
  },

  infoChip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  infoChipText: { fontSize: FontSize.xs, color: Colors.textMuted, flex: 1, lineHeight: 18 },

  notFound: { alignItems: 'center', padding: 40, gap: Spacing.md },
  notFoundTitle: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.textPrimary },
  notFoundSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },

  resultSection: { padding: Spacing.xl, gap: Spacing.lg },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultTirRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultTir: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary, fontFamily: 'monospace' },

  shipmentIdCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
    paddingHorizontal: Spacing.md, paddingVertical: 10,
  },
  shipmentIdLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  shipmentIdLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.8 },
  shipmentIdValue: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, fontFamily: 'monospace', textAlign: 'right' },

  progressCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
    ...Shadow.card,
  },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  progressPct: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary },
  progressBg: { height: 8, backgroundColor: Colors.surface, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: Colors.primary, borderRadius: 4 },
  progressInfo: { flexDirection: 'row', justifyContent: 'space-between' },
  progressInfoText: { fontSize: FontSize.xs, color: Colors.textSecondary },

  routeCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  routeItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  routeDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  routeLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  routeValue: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },

  infoCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.lg,
  },
  infoDivider: { height: 1, backgroundColor: Colors.borderSubtle },
  infoLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  infoValue: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textPrimary, flex: 1, textAlign: 'right' },

  checkpointsCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  checkpointsTitle: {
    fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },

  footerNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  footerNoteText: { fontSize: FontSize.xs, color: Colors.textMuted, flex: 1, lineHeight: 18 },

  refreshBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  refreshLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  refreshDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.textMuted },
  refreshDotActive: { backgroundColor: Colors.success },
  refreshText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  refreshTime: { fontSize: 10, color: Colors.textMuted, fontFamily: 'monospace' },

  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.35)',
    padding: Spacing.md,
  },
  shareBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary, flex: 1 },
  shareLinkPreview: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.sm,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.border, maxWidth: 160,
  },
  shareLinkText: { fontSize: 10, color: Colors.textMuted, fontFamily: 'monospace' },

  mapCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  mapCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  mapCardTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  gpsActiveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.success,
  },
  gpsActiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  gpsActiveText: { fontSize: 10, color: Colors.success, fontWeight: '600' },
  gpsOffBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.border,
  },
  gpsOffText: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' },
  mapUnavailable: {
    height: 200, backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    borderStyle: 'dashed', borderWidth: 1, borderColor: Colors.border,
  },
  mapUnavailableText: { fontSize: FontSize.xs, color: Colors.textMuted },
});
