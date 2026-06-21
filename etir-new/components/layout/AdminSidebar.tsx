import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';
import { useShipments } from '@/hooks/useShipments';
import { useLanguage } from '@/hooks/useLanguage';
import { ControlPanel } from '@/components/feature/ControlPanel';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { Colors, FontSize, Spacing, BorderRadius } from '@/constants/theme';

interface NavItem {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  route: string;
  badge?: number;
  color?: string;
}

import { DeleteAccountModal } from './DeleteAccountModal';

export function AdminSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { totalUnread } = useChat();
  const { shipments } = useShipments();
  const [controlPanelOpen, setControlPanelOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const { t } = useLanguage();

  const customsCount = shipments.filter(s =>
    s.status === 'Customs Clearance' || s.status === 'Customs Pending'
  ).length;

  const navItems: NavItem[] = [
    { label: t('nav.dashboard'),    icon: 'dashboard',       route: '/(tabs)',           color: Colors.primary },
    { label: t('nav.shipments'),    icon: 'local-shipping',  route: '/(tabs)/shipments', color: Colors.info,
      badge: customsCount > 0 ? customsCount : undefined },
    { label: t('nav.drivers'),      icon: 'people',          route: '/(tabs)/drivers',   color: Colors.success },
    { label: 'Clients',             icon: 'business',        route: '/(tabs)/clients',   color: '#D2A8FF' },
    { label: t('nav.chat'),         icon: 'chat',            route: '/(tabs)/chat',      color: Colors.warning,
      badge: totalUnread > 0 ? totalUnread : undefined },
  ];

  const isActive = (route: string) => {
    if (route === '/(tabs)') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/index';
    return pathname.includes(route.replace('/(tabs)', ''));
  };

  const initials = user?.displayName?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? 'AD';

  return (
    <>
      <View style={styles.sidebar}>
        {/* ── Brand ── */}
        <View style={styles.brand}>
          <View style={styles.brandIconWrap}>
            <MaterialIcons name="shield" size={22} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.brandName}>e-TIR Gateway</Text>
            <View style={styles.brandSubRow}>
              <View style={styles.brandVersionDot} />
              <Text style={styles.brandSub}>MARAS Group · v2.0</Text>
            </View>
          </View>
        </View>

        {/* ── User Card ── */}
        <View style={styles.userCard}>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>{initials}</Text>
            <View style={styles.userOnlineDot} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>{user?.displayName ?? 'Admin'}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user?.email ?? ''}</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
            onPress={() => setDeleteModalOpen(true)}
            hitSlop={8}
          >
            <MaterialIcons name="delete-outline" size={15} color={Colors.danger ?? '#ef4444'} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
            onPress={async () => { await logout(); router.replace('/'); }}
            hitSlop={8}
          >
            <MaterialIcons name="logout" size={15} color={Colors.textMuted} />
          </Pressable>
        </View>

        <DeleteAccountModal visible={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} />

        <View style={styles.divider} />

        {/* ── Navigation ── */}
        <View style={styles.navSection}>
          <Text style={styles.navSectionLabel}>{t('nav.adminPanel')}</Text>
          {navItems.map(item => {
            const active = isActive(item.route);
            const iconColor = active ? (item.color ?? Colors.primary) : Colors.textSecondary;
            return (
              <Pressable
                key={item.route}
                style={({ pressed }) => [
                  styles.navItem,
                  active && styles.navItemActive,
                  !active && pressed && styles.navItemPressed,
                ]}
                onPress={() => router.push(item.route as any)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                {active && (
                  <View style={[styles.navActiveBar, { backgroundColor: item.color ?? Colors.primary }]} />
                )}
                <View style={[
                  styles.navIconWrap,
                  active && { backgroundColor: `${item.color ?? Colors.primary}18`, borderColor: `${item.color ?? Colors.primary}30` },
                ]}>
                  <MaterialIcons name={item.icon} size={17} color={iconColor} />
                </View>
                <Text style={[styles.navLabel, active && { color: item.color ?? Colors.primary, fontWeight: '700' }]}>
                  {item.label}
                </Text>
                {item.badge ? (
                  <View style={[styles.navBadge, active && { backgroundColor: item.color ?? Colors.danger }]}>
                    <Text style={styles.navBadgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
                  </View>
                ) : (
                  active ? (
                    <MaterialIcons name="chevron-right" size={14} color={item.color ?? Colors.primary} />
                  ) : null
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* ── Control Panel ── */}
        <View style={styles.navSection}>
          <Text style={styles.navSectionLabel}>{t('nav.quickAccess')}</Text>
          <Pressable
            style={({ pressed }) => [styles.controlPanelBtn, pressed && { opacity: 0.85 }]}
            onPress={() => setControlPanelOpen(true)}
          >
            <View style={styles.controlPanelBtnIcon}>
              <MaterialIcons name="tune" size={16} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.controlPanelBtnLabel}>{t('nav.adminPanel')}</Text>
              <Text style={styles.controlPanelBtnSub}>Operations · Alerts · Fleet</Text>
            </View>
            <MaterialIcons name="launch" size={13} color={Colors.primary} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
            onPress={() => router.push('/tracking')}
          >
            <View style={styles.navIconWrap}>
              <MaterialIcons name="my-location" size={17} color={Colors.textSecondary} />
            </View>
            <Text style={styles.navLabel}>{t('nav.publicTracking')}</Text>
            <MaterialIcons name="open-in-new" size={12} color={Colors.textMuted} />
          </Pressable>
        </View>

        {/* ── Spacer ── */}
        <View style={{ flex: 1 }} />

        {/* ── Language ── */}
        <View style={styles.langWrap}>
          <LanguagePicker />
        </View>

        <View style={styles.divider} />

        {/* ── System Status ── */}
        <View style={styles.statusWrap}>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.statusLabel}>{t('app.allSystemsOk')}</Text>
          </View>
          <View style={styles.statusMeta}>
            <MaterialIcons name="cloud-done" size={11} color={Colors.textMuted} />
            <Text style={styles.statusSub}>{t('app.backendConnected')}</Text>
          </View>
        </View>
      </View>

      <ControlPanel visible={controlPanelOpen} onClose={() => setControlPanelOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 256,
    height: '100%',
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    flexDirection: 'column',
    paddingBottom: Spacing.lg,
  },

  // ── Brand ──────────────────────────────────────────────────────────────────
  brand: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.lg,
  },
  brandIconWrap: {
    width: 44, height: 44, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primaryGlow,
    borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  brandName: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.2 },
  brandSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  brandVersionDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.success },
  brandSub: { fontSize: 10, color: Colors.textMuted },

  // ── User Card ────────────────────────────────────────────────────────────────
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  userAvatar: {
    width: 36, height: 36, borderRadius: 18, position: 'relative',
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  userAvatarText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary },
  userOnlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: Colors.success, borderWidth: 1.5, borderColor: Colors.surface,
  },
  userName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  userEmail: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  logoutBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // ── Divider ───────────────────────────────────────────────────────────────────
  divider: {
    height: 1, backgroundColor: Colors.border,
    marginHorizontal: Spacing.xl, marginVertical: Spacing.md,
  },

  // ── Navigation ────────────────────────────────────────────────────────────────
  navSection: { paddingHorizontal: Spacing.md, gap: 2, marginBottom: Spacing.xs },
  navSectionLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, marginBottom: 6, marginLeft: Spacing.sm,
  },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 9,
    borderRadius: BorderRadius.md, position: 'relative', overflow: 'hidden',
    minHeight: 44,
  },
  navItemActive: { backgroundColor: Colors.primaryGlow },
  navItemPressed: { backgroundColor: Colors.card },
  navActiveBar: {
    position: 'absolute', left: 0, top: 8, bottom: 8,
    width: 3, borderRadius: 2,
  },
  navIconWrap: {
    width: 32, height: 32, borderRadius: BorderRadius.sm,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  navLabel: {
    flex: 1, fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary,
  },
  navBadge: {
    backgroundColor: Colors.danger, borderRadius: 10,
    minWidth: 18, height: 18, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  navBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  // ── Control Panel Btn ─────────────────────────────────────────────────────────
  controlPanelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 10,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    marginBottom: 4,
  },
  controlPanelBtnIcon: {
    width: 32, height: 32, borderRadius: BorderRadius.sm,
    backgroundColor: 'rgba(47,129,247,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlPanelBtnLabel: {
    fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary,
  },
  controlPanelBtnSub: {
    fontSize: 10, color: Colors.textMuted, marginTop: 1,
  },

  // ── Language ───────────────────────────────────────────────────────────────────
  langWrap: {
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.sm,
  },

  // ── Status ─────────────────────────────────────────────────────────────────────
  statusWrap: {
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, gap: 4,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  statusLabel: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.success },
  statusMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusSub: { fontSize: 10, color: Colors.textMuted },
});
