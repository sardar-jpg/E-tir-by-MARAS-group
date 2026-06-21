import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useDrivers } from '@/hooks/useDrivers';
import { useLanguage } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { useRouter } from 'expo-router';
import { Driver, TruckClass } from '@/types';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

const TRUCK_ICONS: Record<TruckClass, keyof typeof MaterialIcons.glyphMap> = {
  'Refrigerated': 'ac-unit',
  'Flatbed': 'remove',
  'Box Truck': 'local-shipping',
  'Tanker': 'opacity',
  'Container': 'inventory-2',
};

function useScreenWidth() {
  const [width, setWidth] = useState(() => Dimensions.get('window').width);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setWidth(window.width));
    return () => sub?.remove();
  }, []);
  return width;
}

export default function DriversScreen() {
  const router = useRouter();
  const { drivers, loading } = useDrivers();
  const [selected, setSelected] = useState<Driver | null>(null);
  const { t } = useLanguage();
  const screenWidth = useScreenWidth();
  const isDesktop = screenWidth >= 1024;

  const activeCount = drivers.filter(d => d.status === 'Active').length;
  const idleCount = drivers.filter(d => d.status === 'Idle').length;
  const offlineCount = drivers.filter(d => d.status === 'Offline').length;
  const unverifiedCount = drivers.filter(d => !d.emailVerified).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('drivers.title')}</Text>
          <Text style={styles.subtitle}>
            {loading ? t('drivers.loading') : `${drivers.length} ${t('drivers.registeredDrivers')}`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {!isDesktop && <LanguagePicker compact />}
          <Pressable style={styles.addBtn} onPress={() => router.push('/') }>
            <MaterialIcons name="person-add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>{t('drivers.inviteDriver')}</Text>
          </Pressable>
        </View>
      </View>

      {/* Stats strip */}
      <View style={styles.statsStrip}>
        {[
          { label: t('drivers.active'), count: activeCount, color: Colors.success, bg: Colors.successBg },
          { label: t('drivers.idle'), count: idleCount, color: Colors.warning, bg: Colors.warningBg },
          { label: t('drivers.offline'), count: offlineCount, color: Colors.textMuted, bg: Colors.card },
          { label: t('drivers.unverified'), count: unverifiedCount, color: Colors.danger, bg: Colors.dangerBg },
        ].map(stat => (
          <View key={stat.label} style={[styles.statItem, { backgroundColor: stat.bg }]}>
            <Text style={[styles.statCount, { color: stat.color }]}>{stat.count}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <View style={isDesktop ? styles.desktopBody : { flex: 1 }}>
        {/* Drivers list */}
        <ScrollView
          style={isDesktop ? styles.desktopList : styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.list, isDesktop && styles.listDesktop]}>
            {drivers.map(driver => (
              <Pressable
                key={driver.id}
                style={({ pressed }) => [
                  styles.driverCard,
                  pressed && { opacity: 0.88 },
                  Shadow.card,
                  isDesktop && selected?.id === driver.id && styles.driverCardSelected,
                ]}
                onPress={() => setSelected(selected?.id === driver.id ? null : driver)}
              >
                <View style={styles.driverHeader}>
                  <View style={[styles.avatar, {
                    borderColor: driver.status === 'Active' ? Colors.success : driver.status === 'Idle' ? Colors.warning : Colors.border,
                  }]}>
                    <Text style={styles.avatarText}>{driver.avatarInitials}</Text>
                    <View style={[styles.statusDot, {
                      backgroundColor: driver.status === 'Active' ? Colors.success : driver.status === 'Idle' ? Colors.warning : Colors.textMuted,
                    }]} />
                  </View>

                  <View style={styles.driverInfo}>
                    <View style={styles.nameRow}>
                      <Text style={styles.driverName}>{driver.fullName}</Text>
                      {!driver.emailVerified && (
                        <View style={styles.unverifiedBadge}>
                          <MaterialIcons name="warning" size={10} color={Colors.warning} />
                          <Text style={styles.unverifiedText}>Unverified</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.driverPlate}>{driver.plateNumber}</Text>
                    <View style={styles.truckRow}>
                      <MaterialIcons name={TRUCK_ICONS[driver.truckClass] ?? 'local-shipping'} size={12} color={Colors.textMuted} />
                      <Text style={styles.truckText}>{driver.truckClass}</Text>
                      <View style={[styles.statusPill, {
                        backgroundColor: driver.status === 'Active' ? Colors.successBg : driver.status === 'Idle' ? Colors.warningBg : Colors.card,
                      }]}>
                        <Text style={[styles.statusPillText, {
                          color: driver.status === 'Active' ? Colors.success : driver.status === 'Idle' ? Colors.warning : Colors.textMuted,
                        }]}>{driver.status}</Text>
                      </View>
                    </View>
                  </View>

                  {!isDesktop && (
                    <MaterialIcons
                      name={selected?.id === driver.id ? 'expand-less' : 'expand-more'}
                      size={20}
                      color={Colors.textMuted}
                    />
                  )}
                  {isDesktop && (
                    <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} />
                  )}
                </View>

                {/* Mobile expanded details */}
                {!isDesktop && selected?.id === driver.id && (
                  <View style={styles.expandedSection}>
                    <View style={styles.expandedDivider} />
                    {[
                      { icon: 'alternate-email' as const, label: t('drivers.username'), value: driver.username },
                      { icon: 'mail-outline' as const, label: t('drivers.emailLabel'), value: driver.email },
                      { icon: 'phone' as const, label: t('drivers.phoneLabel'), value: driver.phone },
                      { icon: 'verified-user' as const, label: t('drivers.emailVerified'), value: driver.emailVerified ? t('drivers.yes') : t('drivers.noPending') },
                    ].map(row => (
                      <View key={row.label} style={styles.expandedRow}>
                        <MaterialIcons name={row.icon} size={14} color={Colors.textMuted} />
                        <Text style={styles.expandedLabel}>{row.label}</Text>
                        <Text style={[styles.expandedValue, row.label === 'Email Verified' && { color: driver.emailVerified ? Colors.success : Colors.danger }]}>
                          {row.value}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.actionRow}>
                      <Pressable
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]}
                        onPress={() => router.push('/(tabs)/chat')}
                      >
                        <MaterialIcons name="chat" size={14} color={Colors.primary} />
                        <Text style={styles.actionBtnText}>{t('drivers.message')}</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]}
                        onPress={() => router.push('/(tabs)/shipments')}
                      >
                        <MaterialIcons name="local-shipping" size={14} color={Colors.primary} />
                        <Text style={styles.actionBtnText}>{t('drivers.viewShipments')}</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Desktop detail panel */}
        {isDesktop && (
          <View style={styles.detailPanel}>
            {selected ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.detailContent}>
                  {/* Driver hero */}
                  <View style={styles.detailHero}>
                    <View style={[styles.detailAvatar, {
                      borderColor: selected.status === 'Active' ? Colors.success : selected.status === 'Idle' ? Colors.warning : Colors.border,
                    }]}>
                      <Text style={styles.detailAvatarText}>{selected.avatarInitials}</Text>
                    </View>
                    <Text style={styles.detailName}>{selected.fullName}</Text>
                    <View style={[styles.statusPill, {
                      backgroundColor: selected.status === 'Active' ? Colors.successBg : selected.status === 'Idle' ? Colors.warningBg : Colors.card,
                      paddingHorizontal: 14, paddingVertical: 5,
                    }]}>
                      <Text style={[styles.statusPillText, {
                        fontSize: FontSize.sm,
                        color: selected.status === 'Active' ? Colors.success : selected.status === 'Idle' ? Colors.warning : Colors.textMuted,
                      }]}>{selected.status}</Text>
                    </View>
                  </View>

                  {/* Info rows */}
                  <View style={styles.detailCard}>
                    <Text style={styles.detailSectionLabel}>{t('drivers.driverDetails')}</Text>
                    {[
                      { icon: 'local-shipping' as const, label: t('drivers.plateNumber'), value: selected.plateNumber },
                      { icon: 'directions-car' as const, label: t('drivers.truckClass'), value: selected.truckClass },
                      { icon: 'alternate-email' as const, label: t('drivers.username'), value: selected.username || '—' },
                      { icon: 'mail-outline' as const, label: t('drivers.emailLabel'), value: selected.email || '—' },
                      { icon: 'phone' as const, label: t('drivers.phoneLabel'), value: selected.phone || '—' },
                      { icon: 'verified-user' as const, label: t('drivers.emailVerified'), value: selected.emailVerified ? t('drivers.verified') : t('drivers.notVerified') },
                    ].map((row, i, arr) => (
                      <View key={row.label} style={[styles.detailRow, i < arr.length - 1 && styles.detailRowBorder]}>
                        <View style={styles.detailRowIcon}>
                          <MaterialIcons name={row.icon} size={15} color={Colors.textMuted} />
                        </View>
                        <Text style={styles.detailRowLabel}>{row.label}</Text>
                        <Text style={[
                          styles.detailRowValue,
                          row.label === 'Email Verified' && { color: selected.emailVerified ? Colors.success : Colors.danger },
                        ]}>{row.value}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Actions */}
                  <View style={styles.detailActions}>
                    <Pressable
                      style={({ pressed }) => [styles.detailActionBtn, pressed && { opacity: 0.75 }]}
                      onPress={() => router.push('/(tabs)/chat')}
                    >
                      <MaterialIcons name="chat" size={16} color={Colors.primary} />
                      <Text style={styles.detailActionText}>{t('drivers.openChat')}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.detailActionBtn, pressed && { opacity: 0.75 }]}
                      onPress={() => router.push('/(tabs)/shipments')}
                    >
                      <MaterialIcons name="local-shipping" size={16} color={Colors.primary} />
                      <Text style={styles.detailActionText}>{t('drivers.viewShipments')}</Text>
                    </Pressable>
                    <Pressable style={[styles.detailActionBtn, { borderColor: Colors.danger, backgroundColor: Colors.dangerBg }]}>
                      <MaterialIcons name="block" size={16} color={Colors.danger} />
                      <Text style={[styles.detailActionText, { color: Colors.danger }]}>{t('drivers.suspend')}</Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.detailEmpty}>
                <MaterialIcons name="person-outline" size={52} color={Colors.border} />
                <Text style={styles.detailEmptyTitle}>{t('drivers.selectDriver')}</Text>
                <Text style={styles.detailEmptySub}>{t('drivers.selectDriverSub')}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  addBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: '#fff' },

  statsStrip: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    gap: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  statItem: {
    flex: 1, alignItems: 'center', gap: 3,
    borderRadius: BorderRadius.md, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  statCount: { fontSize: FontSize.xl, fontWeight: '700' },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },

  desktopBody: { flex: 1, flexDirection: 'row' },
  desktopList: { width: 380, borderRightWidth: 1, borderRightColor: Colors.border },
  scroll: { flex: 1 },
  list: { padding: Spacing.xl, gap: Spacing.md },
  listDesktop: { padding: Spacing.lg, gap: Spacing.sm },

  driverCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  driverCardSelected: {
    borderColor: Colors.primary, backgroundColor: Colors.primaryGlow,
  },
  driverHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.lg,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primaryGlow, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  avatarText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  statusDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.card,
  },
  driverInfo: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  driverName: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  unverifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  unverifiedText: { fontSize: 10, color: Colors.warning, fontWeight: '600' },
  driverPlate: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace' },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  truckText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  statusPill: { borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 10, fontWeight: '600' },

  expandedSection: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  expandedDivider: { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.lg },
  expandedRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm,
  },
  expandedLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  expandedValue: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500', textAlign: 'right' },
  actionRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(47,129,247,0.2)',
  },
  actionBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },

  // Desktop detail panel
  detailPanel: { flex: 1, backgroundColor: Colors.bg },
  detailContent: { padding: Spacing.xxxl, gap: Spacing.xl },
  detailHero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  detailAvatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primaryGlow, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  detailAvatarText: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.primary },
  detailName: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  detailCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  detailSectionLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
  },
  detailRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  detailRowIcon: { width: 22, alignItems: 'center' },
  detailRowLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  detailRowValue: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500' },
  detailActions: { flexDirection: 'row', gap: Spacing.md },
  detailActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  detailActionText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  detailEmpty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, padding: 60,
  },
  detailEmptyTitle: { fontSize: FontSize.xl, fontWeight: '600', color: Colors.textSecondary },
  detailEmptySub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 320 },
});
