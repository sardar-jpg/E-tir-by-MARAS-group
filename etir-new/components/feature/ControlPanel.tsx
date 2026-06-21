/**
 * Admin Control Panel — full-screen overlay accessible from the desktop sidebar.
 * Tabs: Operations · Broadcast · Fleet Monitor · Alerts · App Config
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Modal,
  TextInput, ActivityIndicator, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useShipments } from '@/hooks/useShipments';
import { useDrivers } from '@/hooks/useDrivers';
import { useAlert } from '@/template';
import {
  fetchAdminPushTokens, sendExpoPush, sendLocalNotification,
  fetchDriverPushToken, notifyDriverApproved,
} from '@/services/notificationService';
import { updateDriverStatus } from '@/services/driverService';
import { fetchAppConfig, compareVersions } from '@/services/versionService';
import { getSupabaseClient } from '@/template';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';
import { Shipment, ShipmentStatus } from '@/types';

type PanelTab = 'operations' | 'broadcast' | 'fleet' | 'alerts' | 'config' | 'approvals';

const STATUSES: ShipmentStatus[] = [
  'Loaded', 'Dispatched', 'In Transit', 'Border Crossing',
  'Customs Clearance', 'Customs Pending', 'Arrived', 'Detained',
];

const STATUS_COLOR: Record<ShipmentStatus, string> = {
  'Loaded':             Colors.info,
  'Dispatched':         '#D2A8FF',
  'In Transit':         Colors.primary,
  'Border Crossing':    '#D2A8FF',
  'Customs Clearance':  Colors.warning,
  'Customs Pending':    Colors.warning,
  'Arrived':            Colors.success,
  'Detained':           Colors.danger,
};

interface ControlPanelProps {
  visible: boolean;
  onClose: () => void;
}

// ── Tab button ─────────────────────────────────────────────────────────────────
function TabBtn({
  id, icon, label, active, badge, onPress,
}: {
  id: PanelTab;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [tabS.btn, active && tabS.btnActive, pressed && !active && { opacity: 0.75 }]}
      onPress={onPress}
    >
      <MaterialIcons name={icon} size={16} color={active ? Colors.primary : Colors.textSecondary} />
      <Text style={[tabS.label, active && tabS.labelActive]}>{label}</Text>
      {badge ? (
        <View style={tabS.badge}><Text style={tabS.badgeText}>{badge}</Text></View>
      ) : null}
      {active && <View style={tabS.underline} />}
    </Pressable>
  );
}

const tabS = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.lg, paddingVertical: 12, position: 'relative',
  },
  btnActive: {},
  label: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  labelActive: { color: Colors.primary, fontWeight: '700' },
  badge: {
    backgroundColor: Colors.danger, borderRadius: 8,
    minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  underline: {
    position: 'absolute', bottom: 0, left: Spacing.lg, right: Spacing.lg,
    height: 2, borderRadius: 1, backgroundColor: Colors.primary,
  },
});

// ── Section title ──────────────────────────────────────────────────────────────
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 2, marginBottom: Spacing.md }}>
      <Text style={{ fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase' }}>{title}</Text>
      {subtitle && <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>{subtitle}</Text>}
    </View>
  );
}

// ── Quick stat pill ────────────────────────────────────────────────────────────
function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[spS.pill, { backgroundColor: `${color}12`, borderColor: `${color}30` }]}>
      <Text style={[spS.value, { color }]}>{value}</Text>
      <Text style={spS.label}>{label}</Text>
    </View>
  );
}

const spS = StyleSheet.create({
  pill: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    borderRadius: BorderRadius.lg, borderWidth: 1, gap: 3,
  },
  value: { fontSize: 22, fontWeight: '800' },
  label: { fontSize: 10, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' },
});

// ── Audit log types ────────────────────────────────────────────────────────────
interface ConfigHistoryEntry {
  id: string;
  key: string;
  old_value: string | null;
  new_value: string;
  changed_by: string;
  changed_at: string;
}

// Human-readable key labels
const KEY_LABELS: Record<string, string> = {
  min_required_version: 'Min Required Version',
  maintenance_mode:     'Maintenance Mode',
  maintenance_message:  'Maintenance Message',
  app_store_url:        'App Store URL',
  play_store_url:       'Play Store URL',
};

// ── Pending Driver Approval types ────────────────────────────────────────────
interface PendingDriver {
  id: string;
  full_name: string;
  username: string | null;
  phone: string | null;
  plate_number: string;
  truck_class: string;
  created_at: string;
  approval_status: string;
}

// ── Driver Approval Tab ────────────────────────────────────────────────────────
function DriverApprovalTab() {
  const { showAlert } = useAlert();
  const [pending, setPending] = useState<PendingDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('driver_profiles')
      .select('id, full_name, username, phone, plate_number, truck_class, created_at, approval_status')
      .eq('approval_status', 'pending')
      .order('created_at', { ascending: false });
    setPending((data as PendingDriver[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (driver: PendingDriver) => {
    setActionLoading(prev => ({ ...prev, [driver.id]: true }));
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('driver_profiles')
      .update({ approval_status: 'approved' })
      .eq('id', driver.id);
    setActionLoading(prev => ({ ...prev, [driver.id]: false }));
    if (error) { showAlert('Error', error.message); return; }
    setPending(prev => prev.filter(d => d.id !== driver.id));
    // Notify the driver via push so they know they can now log in
    fetchDriverPushToken(driver.id)
      .then(token => notifyDriverApproved(token))
      .catch(() => {});
    showAlert('Driver Approved', `${driver.full_name} (${driver.plate_number}) can now sign in.`);
  };

  const handleReject = async (driver: PendingDriver) => {
    showAlert(
      'Reject Driver',
      `Reject registration for ${driver.full_name}? They will not be able to sign in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject', style: 'destructive', onPress: async () => {
            setActionLoading(prev => ({ ...prev, [driver.id]: true }));
            const supabase = getSupabaseClient();
            await supabase.from('driver_profiles').update({ approval_status: 'rejected' }).eq('id', driver.id);
            setActionLoading(prev => ({ ...prev, [driver.id]: false }));
            setPending(prev => prev.filter(d => d.id !== driver.id));
          },
        },
      ]
    );
  };

  return (
    <View style={apSt.root}>
      <View style={apSt.header}>
        <View style={apSt.headerLeft}>
          <View style={apSt.headerIcon}>
            <MaterialIcons name="person-add" size={16} color={Colors.warning} />
          </View>
          <View>
            <Text style={apSt.headerTitle}>Driver Approvals</Text>
            <Text style={apSt.headerSub}>New driver registrations awaiting review</Text>
          </View>
        </View>
        <Pressable style={({ pressed }) => [apSt.refreshBtn, pressed && { opacity: 0.7 }]} onPress={load}>
          {loading
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <MaterialIcons name="refresh" size={16} color={Colors.primary} />}
        </Pressable>
      </View>

      {loading && pending.length === 0 ? (
        <View style={apSt.loaderWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={apSt.loaderText}>Loading pending drivers...</Text>
        </View>
      ) : pending.length === 0 ? (
        <View style={apSt.emptyWrap}>
          <View style={apSt.emptyIcon}><MaterialIcons name="verified-user" size={40} color={Colors.success} /></View>
          <Text style={apSt.emptyTitle}>No Pending Approvals</Text>
          <Text style={apSt.emptySub}>All driver registrations have been reviewed. New requests will appear here automatically.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={apSt.list}>
            {pending.map(driver => {
              const isLoadingItem = actionLoading[driver.id];
              const dt = new Date(driver.created_at);
              const dateStr = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
              const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              const initials = driver.full_name.substring(0, 2).toUpperCase();
              return (
                <View key={driver.id} style={apSt.card}>
                  <View style={apSt.cardAccent} />
                  <View style={apSt.cardBody}>
                    <View style={apSt.identityRow}>
                      <View style={apSt.avatar}><Text style={apSt.avatarText}>{initials}</Text></View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={apSt.driverName}>{driver.full_name}</Text>
                        {driver.username ? <Text style={apSt.driverUsername}>@{driver.username}</Text> : null}
                        <View style={apSt.pendingPill}>
                          <View style={apSt.pendingPillDot} />
                          <Text style={apSt.pendingPillText}>AWAITING APPROVAL</Text>
                        </View>
                      </View>
                      <View style={apSt.dateWrap}>
                        <Text style={apSt.dateStr}>{dateStr}</Text>
                        <Text style={apSt.timeStr}>{timeStr}</Text>
                      </View>
                    </View>
                    <View style={apSt.detailsGrid}>
                      {[
                        { icon: 'local-shipping' as const, label: 'Plate',   value: driver.plate_number },
                        { icon: 'category' as const,       label: 'Class',   value: driver.truck_class },
                        { icon: 'phone' as const,          label: 'Phone',   value: driver.phone || '\u2014' },
                      ].map(item => (
                        <View key={item.label} style={apSt.detailItem}>
                          <MaterialIcons name={item.icon} size={12} color={Colors.primary} />
                          <View>
                            <Text style={apSt.detailLabel}>{item.label}</Text>
                            <Text style={apSt.detailValue}>{item.value}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                    <View style={apSt.actions}>
                      <Pressable
                        style={({ pressed }) => [apSt.rejectBtn, pressed && { opacity: 0.8 }, isLoadingItem && { opacity: 0.5 }]}
                        onPress={() => handleReject(driver)}
                        disabled={isLoadingItem}
                      >
                        <MaterialIcons name="close" size={15} color={Colors.danger} />
                        <Text style={apSt.rejectBtnText}>Reject</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [apSt.approveBtn, pressed && { opacity: 0.88 }, isLoadingItem && { opacity: 0.6 }]}
                        onPress={() => handleApprove(driver)}
                        disabled={isLoadingItem}
                      >
                        {isLoadingItem
                          ? <ActivityIndicator size="small" color="#fff" />
                          : (<><MaterialIcons name="check" size={15} color="#fff" /><Text style={apSt.approveBtnText}>Approve</Text></>)
                        }
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </View>
  );
}

const apSt = StyleSheet.create({
  root: { flex: 1, padding: Spacing.xl, gap: Spacing.lg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerIcon: {
    width: 38, height: 38, borderRadius: BorderRadius.md,
    backgroundColor: Colors.warningBg, borderWidth: 1, borderColor: `${Colors.warning}35`,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loaderText: { fontSize: FontSize.sm, color: Colors.textMuted },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingVertical: 60 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.successBg, borderWidth: 2, borderColor: `${Colors.success}35`,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', maxWidth: 340, lineHeight: 20 },
  list: { gap: Spacing.lg },
  card: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.card,
  },
  cardAccent: { height: 3, backgroundColor: Colors.warning },
  cardBody: { padding: Spacing.xl, gap: Spacing.lg },
  identityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.warningBg, borderWidth: 2, borderColor: Colors.warning,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.warning },
  driverName: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  driverUsername: { fontSize: FontSize.xs, color: Colors.textMuted },
  pendingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: `${Colors.warning}35`,
  },
  pendingPillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.warning },
  pendingPillText: { fontSize: 9, fontWeight: '700', color: Colors.warning, letterSpacing: 0.5 },
  dateWrap: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  dateStr: { fontSize: FontSize.xs, color: Colors.textSecondary, fontFamily: 'monospace' },
  timeStr: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace' },
  detailsGrid: {
    flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md,
  },
  detailItem: {
    flex: 1, minWidth: 110, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
  },
  detailLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  detailValue: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'monospace', marginTop: 1 },
  actions: { flexDirection: 'row', gap: Spacing.md },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.lg,
    paddingVertical: 12, borderWidth: 1, borderColor: `${Colors.danger}35`,
  },
  rejectBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.danger },
  approveBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.success, borderRadius: BorderRadius.lg, paddingVertical: 12,
  },
  approveBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff' },
});

// ── App Config Tab ────────────────────────────────────────────────────────────
function AppConfigTab() {
  const { showAlert } = useAlert();

  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState<string | null>(null);
  const [minVersion,    setMinVersion]    = useState('');
  const [maintenanceOn, setMaintenanceOn] = useState(false);
  const [maintMsg,      setMaintMsg]      = useState('');
  const [appStoreUrl,   setAppStoreUrl]   = useState('');
  const [playStoreUrl,  setPlayStoreUrl]  = useState('');

  // Audit log state
  const [history,        setHistory]        = useState<ConfigHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen,    setHistoryOpen]    = useState(false);

  // Cache current DB values so we can record old_value on every save
  const currentValues = useRef<Record<string, string>>({});

  const [installedVer] = useState(() => {
    try {
      const Constants = require('expo-constants').default;
      return Constants.expoConfig?.version ?? '1.0.0';
    } catch { return '1.0.0'; }
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const cfg = await fetchAppConfig();
        setMinVersion(cfg.minRequiredVersion);
        setMaintenanceOn(cfg.maintenanceMode);
        setMaintMsg(cfg.maintenanceMessage);
        setAppStoreUrl(cfg.appStoreUrl);
        setPlayStoreUrl(cfg.playStoreUrl);
        // Cache initial values for old_value tracking
        currentValues.current = {
          min_required_version: cfg.minRequiredVersion,
          maintenance_mode:     cfg.maintenanceMode ? 'true' : 'false',
          maintenance_message:  cfg.maintenanceMessage,
          app_store_url:        cfg.appStoreUrl,
          play_store_url:       cfg.playStoreUrl,
        };
      } catch {}
      setLoading(false);
    })();
  }, []);

  // Load audit history from DB
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('app_config_history')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(20);
    if (data) setHistory(data as ConfigHistoryEntry[]);
    setHistoryLoading(false);
  }, []);

  // Write one audit entry (skips if value unchanged)
  const writeAudit = useCallback(async (key: string, newValue: string) => {
    const oldVal = currentValues.current[key] ?? null;
    if (oldVal === newValue) return;
    const supabase = getSupabaseClient();
    await supabase.from('app_config_history').insert({
      key,
      old_value: oldVal,
      new_value: newValue,
      changed_by: 'admin',
    });
    currentValues.current[key] = newValue;
    // Refresh timeline if panel is open
    setHistory(prev => [{
      id: Math.random().toString(36).slice(2),
      key,
      old_value: oldVal,
      new_value: newValue,
      changed_by: 'admin',
      changed_at: new Date().toISOString(),
    }, ...prev.slice(0, 19)]);
  }, []);

  const upsertKey = async (key: string, value: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('app_config')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return error;
  };

  const handleSaveVersion = async () => {
    const trimmed = minVersion.trim();
    if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
      showAlert('Invalid Version', 'Use semantic versioning format: X.Y.Z (e.g. 1.2.0)');
      return;
    }
    setSaving('version');
    const err = await upsertKey('min_required_version', trimmed);
    if (!err) await writeAudit('min_required_version', trimmed);
    setSaving(null);
    if (err) showAlert('Save Failed', err.message);
    else showAlert('Version Updated', `Min required version is now ${trimmed}. Users below this will see the force-update screen.`);
  };

  const handleToggleMaintenance = async (next: boolean) => {
    setSaving('maintenance');
    const val = next ? 'true' : 'false';
    const err = await upsertKey('maintenance_mode', val);
    if (!err) await writeAudit('maintenance_mode', val);
    setSaving(null);
    if (err) { showAlert('Save Failed', err.message); return; }
    setMaintenanceOn(next);
    showAlert(
      next ? 'Maintenance Mode ON' : 'Maintenance Mode OFF',
      next
        ? 'All users will see the maintenance screen until you turn this off.'
        : 'The app is now accessible to all users.'
    );
  };

  const handleSaveMaintMsg = async () => {
    const val = maintMsg.trim() || 'We are performing scheduled maintenance. Please try again shortly.';
    setSaving('maintMsg');
    const err = await upsertKey('maintenance_message', val);
    if (!err) await writeAudit('maintenance_message', val);
    setSaving(null);
    if (err) showAlert('Save Failed', err.message);
    else showAlert('Message Saved', 'Maintenance message updated.');
  };

  const handleSaveUrls = async () => {
    const urlA = appStoreUrl.trim();
    const urlP = playStoreUrl.trim();
    setSaving('urls');
    const e1 = await upsertKey('app_store_url', urlA);
    const e2 = await upsertKey('play_store_url', urlP);
    if (!e1) await writeAudit('app_store_url', urlA);
    if (!e2) await writeAudit('play_store_url', urlP);
    setSaving(null);
    if (e1 || e2) showAlert('Save Failed', (e1 ?? e2)?.message ?? 'Unknown error');
    else showAlert('Store URLs Saved', 'Force-update buttons will now open these URLs.');
  };

  const versionState: 'ok' | 'force' | 'invalid' = (() => {
    if (!/^\d+\.\d+\.\d+$/.test(minVersion.trim())) return 'invalid';
    return compareVersions(installedVer, minVersion.trim()) < 0 ? 'force' : 'ok';
  })();

  if (loading) {
    return (
      <View style={cfgSt.loaderWrap}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={cfgSt.loaderText}>Loading app configuration...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={cfgSt.root} showsVerticalScrollIndicator={false}>
      <View style={cfgSt.inner}>

        {/* ── Version Gate ── */}
        <View style={cfgSt.card}>
          <View style={cfgSt.cardHeader}>
            <View style={cfgSt.cardIconWrap}>
              <MaterialIcons name="system-update" size={16} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={cfgSt.cardTitle}>Force Update Gate</Text>
              <Text style={cfgSt.cardSub}>Users below this version see the mandatory update screen</Text>
            </View>
          </View>

          {/* Version comparison */}
          <View style={cfgSt.versionCompareRow}>
            <View style={cfgSt.versionCompareItem}>
              <Text style={cfgSt.versionCompareLabel}>THIS DEVICE</Text>
              <Text style={[cfgSt.versionCompareValue, { color: Colors.success }]}>{installedVer}</Text>
            </View>
            <MaterialIcons name="compare-arrows" size={18} color={Colors.textMuted} />
            <View style={cfgSt.versionCompareItem}>
              <Text style={cfgSt.versionCompareLabel}>MIN REQUIRED</Text>
              <Text style={[
                cfgSt.versionCompareValue,
                {
                  color: versionState === 'force' ? Colors.danger
                       : versionState === 'ok'    ? Colors.success
                       : Colors.warning,
                },
              ]}>{minVersion || '—'}</Text>
            </View>
            <View style={[
              cfgSt.versionStatePill,
              {
                backgroundColor: versionState === 'force' ? `${Colors.danger}15`
                                : versionState === 'ok'    ? `${Colors.success}15`
                                : `${Colors.warning}15`,
                borderColor: versionState === 'force' ? `${Colors.danger}35`
                           : versionState === 'ok'    ? `${Colors.success}35`
                           : `${Colors.warning}35`,
              },
            ]}>
              <MaterialIcons
                name={versionState === 'force' ? 'warning' : versionState === 'ok' ? 'check-circle' : 'help-outline'}
                size={12}
                color={versionState === 'force' ? Colors.danger : versionState === 'ok' ? Colors.success : Colors.warning}
              />
              <Text style={[
                cfgSt.versionStatePillText,
                {
                  color: versionState === 'force' ? Colors.danger
                       : versionState === 'ok'    ? Colors.success
                       : Colors.warning,
                },
              ]}>
                {versionState === 'force' ? 'THIS DEVICE BELOW MIN' : versionState === 'ok' ? 'ALL CLEAR' : 'INVALID FORMAT'}
              </Text>
            </View>
          </View>

          <View style={cfgSt.fieldWrap}>
            <Text style={cfgSt.fieldLabel}>Minimum Required Version</Text>
            <View style={cfgSt.inputRow}>
              <View style={cfgSt.inputBox}>
                <MaterialIcons name="tag" size={14} color={Colors.textMuted} />
                <TextInput
                  style={cfgSt.input}
                  value={minVersion}
                  onChangeText={setMinVersion}
                  placeholder="e.g. 1.2.0"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                />
              </View>
              <Pressable
                style={[cfgSt.saveBtn, saving === 'version' && { opacity: 0.6 }]}
                onPress={handleSaveVersion}
                disabled={saving === 'version'}
              >
                {saving === 'version'
                  ? <ActivityIndicator size="small" color="#fff" />
                  : (
                    <>
                      <MaterialIcons name="save" size={14} color="#fff" />
                      <Text style={cfgSt.saveBtnText}>Save</Text>
                    </>
                  )
                }
              </Pressable>
            </View>
            <Text style={cfgSt.fieldHint}>
              To force an update: set this higher than currently installed versions (e.g. bump 1.0.0 to 1.1.0). Use X.Y.Z format only.
            </Text>
          </View>

          {/* Quick version presets */}
          <View style={cfgSt.quickVersionRow}>
            {['1.0.0', '1.1.0', '1.1.1', '1.2.0', '2.0.0'].map(v => (
              <Pressable
                key={v}
                style={[cfgSt.quickVersionChip, minVersion === v && cfgSt.quickVersionChipActive]}
                onPress={() => setMinVersion(v)}
              >
                <Text style={[cfgSt.quickVersionChipText, minVersion === v && { color: Colors.primary }]}>{v}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Maintenance Mode ── */}
        <View style={cfgSt.card}>
          <View style={cfgSt.cardHeader}>
            <View style={[
              cfgSt.cardIconWrap,
              maintenanceOn
                ? { backgroundColor: `${Colors.warning}18`, borderColor: `${Colors.warning}30` }
                : {},
            ]}>
              <MaterialIcons name="settings" size={16} color={maintenanceOn ? Colors.warning : Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={cfgSt.cardTitle}>Maintenance Mode</Text>
              <Text style={cfgSt.cardSub}>Blocks all users with a maintenance screen until disabled</Text>
            </View>
            {/* Toggle */}
            <Pressable
              style={[
                cfgSt.toggle,
                maintenanceOn ? cfgSt.toggleOn : cfgSt.toggleOff,
                saving === 'maintenance' && { opacity: 0.5 },
              ]}
              onPress={() => { if (!saving) handleToggleMaintenance(!maintenanceOn); }}
              disabled={saving === 'maintenance'}
            >
              {saving === 'maintenance'
                ? <ActivityIndicator size="small" color="#fff" style={{ position: 'absolute', alignSelf: 'center' }} />
                : <View style={[cfgSt.toggleThumb, maintenanceOn && cfgSt.toggleThumbOn]} />
              }
            </Pressable>
          </View>

          {maintenanceOn && (
            <View style={cfgSt.warningBanner}>
              <MaterialIcons name="warning" size={14} color={Colors.warning} />
              <Text style={cfgSt.warningBannerText}>
                Maintenance mode is <Text style={{ fontWeight: '700' }}>ACTIVE</Text>. All users — including drivers and customers — see the maintenance screen right now.
              </Text>
            </View>
          )}

          <View style={cfgSt.fieldWrap}>
            <Text style={cfgSt.fieldLabel}>Maintenance Message</Text>
            <TextInput
              style={cfgSt.textarea}
              value={maintMsg}
              onChangeText={setMaintMsg}
              placeholder="Message shown to users during maintenance..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <Pressable
              style={[cfgSt.saveBtnWide, saving === 'maintMsg' && { opacity: 0.6 }]}
              onPress={handleSaveMaintMsg}
              disabled={saving === 'maintMsg'}
            >
              {saving === 'maintMsg'
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <>
                    <MaterialIcons name="save" size={14} color="#fff" />
                    <Text style={cfgSt.saveBtnText}>Save Message</Text>
                  </>
                )
              }
            </Pressable>
          </View>
        </View>

        {/* ── Store URLs ── */}
        <View style={cfgSt.card}>
          <View style={cfgSt.cardHeader}>
            <View style={cfgSt.cardIconWrap}>
              <MaterialIcons name="store" size={16} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={cfgSt.cardTitle}>App Store URLs</Text>
              <Text style={cfgSt.cardSub}>Used in the force-update screen "Update Now" button</Text>
            </View>
          </View>

          <View style={cfgSt.fieldWrap}>
            <Text style={cfgSt.fieldLabel}>Apple App Store URL</Text>
            <View style={cfgSt.inputBox}>
              <MaterialIcons name="phone-iphone" size={14} color={Colors.textMuted} />
              <TextInput
                style={cfgSt.input}
                value={appStoreUrl}
                onChangeText={setAppStoreUrl}
                placeholder="https://apps.apple.com/app/id..."
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
          </View>

          <View style={cfgSt.fieldWrap}>
            <Text style={cfgSt.fieldLabel}>Google Play Store URL</Text>
            <View style={cfgSt.inputBox}>
              <MaterialIcons name="android" size={14} color={Colors.textMuted} />
              <TextInput
                style={cfgSt.input}
                value={playStoreUrl}
                onChangeText={setPlayStoreUrl}
                placeholder="https://play.google.com/store/apps/details?id=..."
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
          </View>

          <Pressable
            style={[cfgSt.saveBtnWide, saving === 'urls' && { opacity: 0.6 }]}
            onPress={handleSaveUrls}
            disabled={saving === 'urls'}
          >
            {saving === 'urls'
              ? <ActivityIndicator size="small" color="#fff" />
              : (
                <>
                  <MaterialIcons name="save" size={14} color="#fff" />
                  <Text style={cfgSt.saveBtnText}>Save Store URLs</Text>
                </>
              )
            }
          </Pressable>
        </View>

        {/* ── Change History Audit Log ── */}
        <View style={cfgSt.card}>
          <Pressable
            style={cfgSt.auditHeader}
            onPress={() => {
              const next = !historyOpen;
              setHistoryOpen(next);
              if (next && history.length === 0) loadHistory();
            }}
          >
            <View style={[cfgSt.cardIconWrap, { backgroundColor: `${Colors.info}12`, borderColor: `${Colors.info}25` }]}>
              <MaterialIcons name="history" size={16} color={Colors.info} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={cfgSt.cardTitle}>Change History</Text>
              <Text style={cfgSt.cardSub}>Last 20 config changes — who changed what and when</Text>
            </View>
            {history.length > 0 && (
              <View style={cfgSt.auditCountBadge}>
                <Text style={cfgSt.auditCountText}>{history.length}</Text>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [cfgSt.auditRefreshBtn, pressed && { opacity: 0.7 }]}
              onPress={(e) => { e.stopPropagation?.(); loadHistory(); }}
              hitSlop={8}
            >
              {historyLoading
                ? <ActivityIndicator size="small" color={Colors.info} />
                : <MaterialIcons name="refresh" size={15} color={Colors.info} />}
            </Pressable>
            <MaterialIcons
              name={historyOpen ? 'expand-less' : 'expand-more'}
              size={18} color={Colors.textMuted}
            />
          </Pressable>

          {historyOpen && (
            <View style={cfgSt.auditBody}>
              {historyLoading && history.length === 0 ? (
                <View style={cfgSt.auditLoadingRow}>
                  <ActivityIndicator size="small" color={Colors.info} />
                  <Text style={cfgSt.auditLoadingText}>Loading history...</Text>
                </View>
              ) : history.length === 0 ? (
                <View style={cfgSt.auditEmptyBox}>
                  <MaterialIcons name="history" size={26} color={Colors.border} />
                  <Text style={cfgSt.auditEmptyTitle}>No changes recorded yet</Text>
                  <Text style={cfgSt.auditEmptySub}>Changes will appear here after you save any config value.</Text>
                </View>
              ) : (
                <ScrollView
                  style={cfgSt.auditScroll}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {history.map((entry, idx) => {
                    const label = KEY_LABELS[entry.key] ?? entry.key;
                    const isFirst = idx === 0;
                    const dt = new Date(entry.changed_at);
                    const dateStr = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    const keyColor =
                      entry.key === 'maintenance_mode'
                        ? (entry.new_value === 'true' ? Colors.warning : Colors.success)
                        : entry.key === 'min_required_version'
                          ? Colors.primary
                          : Colors.info;
                    return (
                      <View key={entry.id} style={[cfgSt.auditRow, idx < history.length - 1 && cfgSt.auditRowBorder]}>
                        {/* Timeline dot + connector line */}
                        <View style={cfgSt.auditTimeline}>
                          <View style={[cfgSt.auditDot, { borderColor: isFirst ? keyColor : Colors.border, backgroundColor: isFirst ? keyColor : Colors.surface }]} />
                          {idx < history.length - 1 && <View style={cfgSt.auditLine} />}
                        </View>

                        {/* Content */}
                        <View style={cfgSt.auditContent}>
                          <View style={cfgSt.auditContentTop}>
                            <View style={[cfgSt.auditKeyBadge, { backgroundColor: `${keyColor}12`, borderColor: `${keyColor}25` }]}>
                              <Text style={[cfgSt.auditKeyText, { color: keyColor }]}>{label}</Text>
                            </View>
                            {isFirst && (
                              <View style={cfgSt.auditLatestBadge}>
                                <Text style={cfgSt.auditLatestText}>LATEST</Text>
                              </View>
                            )}
                          </View>

                          {/* Value change: old → new */}
                          <View style={cfgSt.auditValueRow}>
                            {entry.old_value != null ? (
                              <>
                                <Text style={cfgSt.auditOldValue} numberOfLines={1}>{entry.old_value || '(empty)'}</Text>
                                <MaterialIcons name="arrow-forward" size={11} color={Colors.textMuted} />
                              </>
                            ) : (
                              <View style={cfgSt.auditNewBadge}>
                                <Text style={cfgSt.auditNewBadgeText}>NEW</Text>
                              </View>
                            )}
                            <Text style={[cfgSt.auditNewValue, { color: keyColor }]} numberOfLines={1}>
                              {entry.new_value || '(empty)'}
                            </Text>
                          </View>

                          {/* Meta: who + when */}
                          <View style={cfgSt.auditMeta}>
                            <MaterialIcons name="person" size={10} color={Colors.textMuted} />
                            <Text style={cfgSt.auditMetaText}>{entry.changed_by}</Text>
                            <View style={cfgSt.auditMetaDot} />
                            <MaterialIcons name="schedule" size={10} color={Colors.textMuted} />
                            <Text style={cfgSt.auditMetaText}>{dateStr} · {timeStr}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {history.length === 20 && (
                    <View style={cfgSt.auditMoreNote}>
                      <MaterialIcons name="info-outline" size={11} color={Colors.textMuted} />
                      <Text style={cfgSt.auditMoreText}>Showing latest 20 entries</Text>
                    </View>
                  )}
                  <View style={{ height: 8 }} />
                </ScrollView>
              )}
            </View>
          )}
        </View>

        {/* ── How-to guide ── */}
        <View style={cfgSt.guideCard}>
          <View style={cfgSt.guideHeader}>
            <MaterialIcons name="info-outline" size={14} color={Colors.info} />
            <Text style={cfgSt.guideTitle}>How Force Update Works</Text>
          </View>
          {[
            { step: '1', text: 'Set "Minimum Required Version" to a version higher than what users currently have installed.' },
            { step: '2', text: 'On every app launch, the app fetches this value and compares it against the installed version.' },
            { step: '3', text: 'If the installed version is lower, a blocking update screen appears and the app is unusable until updated.' },
            { step: '4', text: 'Once users update from the store, the block is lifted automatically — no config changes needed.' },
            { step: '5', text: 'To disable the force-update, set the minimum version back to 1.0.0 or lower than all installed versions.' },
          ].map(item => (
            <View key={item.step} style={cfgSt.guideStep}>
              <View style={cfgSt.guideStepNum}>
                <Text style={cfgSt.guideStepNumText}>{item.step}</Text>
              </View>
              <Text style={cfgSt.guideStepText}>{item.text}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  );
}

// ── App Config Tab Styles ──────────────────────────────────────────────────────
const cfgSt = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  inner: { padding: Spacing.xl, gap: Spacing.xl, maxWidth: 720, alignSelf: 'center', width: '100%' },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loaderText: { fontSize: FontSize.sm, color: Colors.textMuted },

  card: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.xl, gap: Spacing.lg,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  cardIconWrap: {
    width: 38, height: 38, borderRadius: BorderRadius.md,
    backgroundColor: `${Colors.primary}12`, borderWidth: 1, borderColor: `${Colors.primary}20`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  cardSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },

  versionCompareRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
  },
  versionCompareItem: { flex: 1, alignItems: 'center', gap: 4 },
  versionCompareLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8 },
  versionCompareValue: { fontSize: FontSize.xl, fontWeight: '800', fontFamily: 'monospace' },
  versionStatePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: BorderRadius.full, paddingHorizontal: 9, paddingVertical: 4,
    borderWidth: 1,
  },
  versionStatePillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },

  fieldWrap: { gap: Spacing.sm },
  fieldLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  fieldHint: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17, fontStyle: 'italic' },
  inputRow: { flexDirection: 'row', gap: Spacing.sm },
  inputBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 46,
  },
  input: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary, fontFamily: 'monospace' },
  textarea: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    fontSize: FontSize.sm, color: Colors.textPrimary, minHeight: 80, lineHeight: 22,
  },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl, height: 46,
  },
  saveBtnWide: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 13, width: '100%',
  },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff' },

  quickVersionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  quickVersionChip: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  quickVersionChipActive: { backgroundColor: Colors.primaryGlow, borderColor: Colors.primary },
  quickVersionChipText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted, fontFamily: 'monospace' },

  toggle: {
    width: 50, height: 28, borderRadius: 14,
    justifyContent: 'center', flexShrink: 0,
  },
  toggleOn: { backgroundColor: Colors.warning },
  toggleOff: { backgroundColor: Colors.border },
  toggleThumb: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff', marginLeft: 3,
  },
  toggleThumbOn: { marginLeft: 25 },

  warningBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.warning}35`,
  },
  warningBannerText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },

  guideCard: {
    backgroundColor: `${Colors.info}0A`, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: `${Colors.info}25`,
    padding: Spacing.xl, gap: Spacing.md,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  guideTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.info },
  guideStep: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  guideStepNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: `${Colors.info}18`, borderWidth: 1, borderColor: `${Colors.info}30`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  guideStepNumText: { fontSize: 10, fontWeight: '800', color: Colors.info },
  guideStepText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 19 },

  // ── Audit log ──────────────────────────────────────────────────────────────
  auditHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  auditCountBadge: {
    backgroundColor: `${Colors.info}18`, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.info}30`,
  },
  auditCountText: { fontSize: 10, fontWeight: '700', color: Colors.info },
  auditRefreshBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: `${Colors.info}10`, borderWidth: 1, borderColor: `${Colors.info}25`,
    alignItems: 'center', justifyContent: 'center',
  },
  auditBody: {
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    marginTop: Spacing.sm, paddingTop: Spacing.md,
  },
  auditLoadingRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    justifyContent: 'center', paddingVertical: Spacing.xl,
  },
  auditLoadingText: { fontSize: FontSize.sm, color: Colors.textMuted },
  auditEmptyBox: {
    alignItems: 'center', gap: 6, paddingVertical: Spacing.xl,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  auditEmptyTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  auditEmptySub: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', paddingHorizontal: Spacing.lg },
  auditScroll: { maxHeight: 400 },
  auditRow: { flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.md },
  auditRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  auditTimeline: { alignItems: 'center', width: 14, paddingTop: 3 },
  auditDot: {
    width: 10, height: 10, borderRadius: 5, borderWidth: 2,
  },
  auditLine: {
    flex: 1, width: 1.5, backgroundColor: Colors.borderSubtle, marginTop: 4,
  },
  auditContent: { flex: 1, gap: 5 },
  auditContentTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  auditKeyBadge: {
    borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
  },
  auditKeyText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  auditLatestBadge: {
    backgroundColor: `${Colors.success}15`, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  auditLatestText: { fontSize: 9, fontWeight: '700', color: Colors.success, letterSpacing: 0.5 },
  auditValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  auditOldValue: {
    fontSize: FontSize.xs, color: Colors.textMuted,
    fontFamily: 'monospace', textDecorationLine: 'line-through', maxWidth: 140,
  },
  auditNewValue: { fontSize: FontSize.xs, fontWeight: '700', fontFamily: 'monospace', flex: 1 },
  auditNewBadge: {
    backgroundColor: `${Colors.success}15`, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  auditNewBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.success },
  auditMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  auditMetaText: { fontSize: 10, color: Colors.textMuted, fontFamily: 'monospace' },
  auditMetaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.border },
  auditMoreNote: {
    flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center',
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  auditMoreText: { fontSize: FontSize.xs, color: Colors.textMuted },
});

// ── Main Component ─────────────────────────────────────────────────────────────
export function ControlPanel({ visible, onClose }: ControlPanelProps) {
  const { shipments, updateStatus, getStats } = useShipments();
  const { drivers, refresh: refreshDrivers } = useDrivers();
  const { showAlert } = useAlert();

  const [activeTab, setActiveTab] = useState<PanelTab>('operations');
  const [pendingDriverCount, setPendingDriverCount] = useState(0);

  // Refresh pending driver badge count whenever panel opens
  useEffect(() => {
    if (!visible) return;
    const supabase = getSupabaseClient();
    supabase
      .from('driver_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending')
      .then(({ count }) => setPendingDriverCount(count ?? 0))
      .catch(() => {});
  }, [visible]);

  // ── Operations tab state ───────────────────────────────────────────────────
  const [selectedShipments, setSelectedShipments] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ShipmentStatus | ''>('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [opSearch, setOpSearch] = useState('');

  // ── Broadcast tab state ────────────────────────────────────────────────────
  const [bcTitle, setBcTitle] = useState('');
  const [bcBody, setBcBody] = useState('');
  const [bcTarget, setBcTarget] = useState<'all' | 'active' | 'custom'>('all');
  const [bcLoading, setBcLoading] = useState(false);
  const [bcSent, setBcSent] = useState(false);

  // ── Driver force-status state ──────────────────────────────────────────────
  const [driverStatusLoading, setDriverStatusLoading] = useState<Set<string>>(new Set());

  const stats = getStats();

  const alertShipments = shipments.filter(s =>
    s.status === 'Detained' || s.status === 'Customs Pending'
  );

  // Filtered shipments for Operations
  const filteredShipments = opSearch.trim()
    ? shipments.filter(s =>
        s.tirNumber.toLowerCase().includes(opSearch.toLowerCase()) ||
        s.driverName.toLowerCase().includes(opSearch.toLowerCase())
      )
    : shipments;

  // ── Bulk update ────────────────────────────────────────────────────────────
  const handleBulkUpdate = useCallback(async () => {
    if (!bulkStatus || selectedShipments.size === 0) return;
    setBulkLoading(true);
    let done = 0;
    for (const id of selectedShipments) {
      await updateStatus(id, bulkStatus as ShipmentStatus);
      done++;
    }
    setBulkLoading(false);
    setSelectedShipments(new Set());
    setBulkStatus('');
    showAlert('Bulk Update Complete', `${done} shipment${done > 1 ? 's' : ''} updated to "${bulkStatus}".`);
  }, [bulkStatus, selectedShipments, updateStatus, showAlert]);

  const toggleShipment = useCallback((id: string) => {
    setSelectedShipments(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedShipments(new Set(filteredShipments.map(s => s.id)));
  }, [filteredShipments]);

  const clearAll = useCallback(() => setSelectedShipments(new Set()), []);

  // ── Broadcast push ─────────────────────────────────────────────────────────
  const handleBroadcast = useCallback(async () => {
    if (!bcTitle.trim() || !bcBody.trim()) return;
    setBcLoading(true);

    const adminTokens = await fetchAdminPushTokens();
    let driverTokens: (string | null)[] = [];

    if (bcTarget === 'all' || bcTarget === 'active') {
      const targetDrivers = bcTarget === 'active'
        ? drivers.filter(d => d.status === 'Active')
        : drivers;
      driverTokens = targetDrivers.map(d => (d as any).pushToken ?? null).filter(Boolean);
    }

    const allTokens = [...adminTokens, ...driverTokens as string[]].filter(
      t => t && t.startsWith('ExponentPushToken[')
    );

    if (allTokens.length > 0) {
      await sendExpoPush({
        to: allTokens,
        title: bcTitle.trim(),
        body: bcBody.trim(),
        data: { type: 'broadcast' },
        channelId: 'default',
      });
    }

    await sendLocalNotification(bcTitle.trim(), bcBody.trim(), { type: 'broadcast' });

    setBcLoading(false);
    setBcSent(true);
    setTimeout(() => setBcSent(false), 3500);
    setBcTitle('');
    setBcBody('');
  }, [bcTitle, bcBody, bcTarget, drivers]);

  // ── Force driver status ────────────────────────────────────────────────────
  const handleForceDriverStatus = useCallback(async (
    driverId: string,
    status: 'Active' | 'Idle' | 'Offline'
  ) => {
    setDriverStatusLoading(prev => new Set(prev).add(driverId));
    await updateDriverStatus(driverId, status);
    await refreshDrivers();
    setDriverStatusLoading(prev => {
      const next = new Set(prev);
      next.delete(driverId);
      return next;
    });
  }, [refreshDrivers]);

  // Reset when closed
  useEffect(() => {
    if (!visible) {
      setSelectedShipments(new Set());
      setBulkStatus('');
      setOpSearch('');
      setBcTitle('');
      setBcBody('');
      setBcSent(false);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.panel}>

          {/* ── Header ──────────────────────────────────────────────── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconWrap}>
                <MaterialIcons name="tune" size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.headerTitle}>Admin Control Panel</Text>
                <Text style={styles.headerSub}>MARAS Group · e-tir Gateway</Text>
              </View>
            </View>

            {/* Quick stats */}
            <View style={styles.headerStats}>
              <View style={styles.headerStatItem}>
                <Text style={[styles.headerStatValue, { color: Colors.primary }]}>{stats.total}</Text>
                <Text style={styles.headerStatLabel}>Total</Text>
              </View>
              <View style={styles.headerStatDivider} />
              <View style={styles.headerStatItem}>
                <Text style={[styles.headerStatValue, { color: Colors.info }]}>{stats.active}</Text>
                <Text style={styles.headerStatLabel}>Active</Text>
              </View>
              <View style={styles.headerStatDivider} />
              <View style={styles.headerStatItem}>
                <Text style={[styles.headerStatValue, { color: Colors.warning }]}>{stats.pending}</Text>
                <Text style={styles.headerStatLabel}>Pending</Text>
              </View>
              <View style={styles.headerStatDivider} />
              <View style={styles.headerStatItem}>
                <Text style={[styles.headerStatValue, { color: Colors.success }]}>{stats.arrived}</Text>
                <Text style={styles.headerStatLabel}>Arrived</Text>
              </View>
            </View>

            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {/* ── Tab bar ─────────────────────────────────────────────── */}
          <View style={styles.tabBar}>
            <TabBtn id="operations" icon="edit-note"    label="Operations"    active={activeTab === 'operations'} onPress={() => setActiveTab('operations')} />
            <TabBtn id="broadcast"  icon="campaign"     label="Broadcast"     active={activeTab === 'broadcast'}  onPress={() => setActiveTab('broadcast')} />
            <TabBtn id="fleet"      icon="people"       label="Fleet Monitor" active={activeTab === 'fleet'}      onPress={() => setActiveTab('fleet')} />
            <TabBtn id="approvals"  icon="how-to-reg"   label="Approvals"     active={activeTab === 'approvals'}  badge={pendingDriverCount || undefined} onPress={() => setActiveTab('approvals')} />
            <TabBtn id="alerts"     icon="warning"      label="Alerts"        active={activeTab === 'alerts'}     badge={alertShipments.length || undefined} onPress={() => setActiveTab('alerts')} />
            <TabBtn id="config"     icon="settings"     label="App Config"    active={activeTab === 'config'}     onPress={() => setActiveTab('config')} />
          </View>

          {/* ── Content ─────────────────────────────────────────────── */}
          <View style={styles.body}>

            {/* ══ OPERATIONS ══════════════════════════════════════════ */}
            {activeTab === 'operations' && (
              <View style={styles.twoCol}>
                {/* Left — shipment selector */}
                <View style={styles.colLeft}>
                  <SectionTitle
                    title="Select Shipments"
                    subtitle={`${selectedShipments.size} of ${filteredShipments.length} selected`}
                  />

                  <View style={styles.searchRow}>
                    <View style={styles.searchBox}>
                      <MaterialIcons name="search" size={15} color={Colors.textMuted} />
                      <TextInput
                        style={styles.searchInput}
                        value={opSearch}
                        onChangeText={setOpSearch}
                        placeholder="Filter by TIR or driver..."
                        placeholderTextColor={Colors.textMuted}
                      />
                      {opSearch ? (
                        <Pressable onPress={() => setOpSearch('')} hitSlop={6}>
                          <MaterialIcons name="close" size={13} color={Colors.textMuted} />
                        </Pressable>
                      ) : null}
                    </View>
                    <Pressable style={styles.selectAllBtn} onPress={selectedShipments.size > 0 ? clearAll : selectAll}>
                      <MaterialIcons name={selectedShipments.size > 0 ? 'deselect' : 'select-all'} size={14} color={Colors.primary} />
                      <Text style={styles.selectAllText}>{selectedShipments.size > 0 ? 'Clear' : 'All'}</Text>
                    </Pressable>
                  </View>

                  <ScrollView style={styles.shipmentList} showsVerticalScrollIndicator={false}>
                    {filteredShipments.map(s => {
                      const sel = selectedShipments.has(s.id);
                      const accent = STATUS_COLOR[s.status] ?? Colors.primary;
                      return (
                        <Pressable
                          key={s.id}
                          style={[styles.opShipmentRow, sel && styles.opShipmentRowSelected]}
                          onPress={() => toggleShipment(s.id)}
                        >
                          <View style={[styles.opCheckbox, sel && { backgroundColor: Colors.primary, borderColor: Colors.primary }]}>
                            {sel && <MaterialIcons name="check" size={12} color="#fff" />}
                          </View>
                          <View style={[styles.opAccent, { backgroundColor: accent }]} />
                          <View style={styles.opShipmentInfo}>
                            <Text style={styles.opTirNum}>{s.tirNumber}</Text>
                            <Text style={styles.opDriverName} numberOfLines={1}>{s.driverName}</Text>
                          </View>
                          <View style={[styles.opStatusChip, { backgroundColor: `${accent}18`, borderColor: `${accent}30` }]}>
                            <Text style={[styles.opStatusText, { color: accent }]}>{s.status}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    <View style={{ height: 20 }} />
                  </ScrollView>
                </View>

                {/* Right — action panel */}
                <View style={styles.colRight}>
                  <SectionTitle title="Bulk Action" subtitle="Apply to selected shipments" />

                  <View style={styles.actionCard}>
                    <View style={styles.actionCardHeader}>
                      <MaterialIcons name="update" size={16} color={Colors.primary} />
                      <Text style={styles.actionCardTitle}>Set Status</Text>
                    </View>

                    <View style={styles.statusGrid}>
                      {STATUSES.map(s => {
                        const color = STATUS_COLOR[s];
                        const selected = bulkStatus === s;
                        return (
                          <Pressable
                            key={s}
                            style={[
                              styles.statusChipBtn,
                              selected && { backgroundColor: `${color}18`, borderColor: color },
                            ]}
                            onPress={() => setBulkStatus(selected ? '' : s)}
                          >
                            <View style={[styles.statusChipDot, { backgroundColor: color }]} />
                            <Text style={[styles.statusChipLabel, selected && { color }]}>{s}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <View style={styles.actionSummary}>
                      <Text style={styles.actionSummaryText}>
                        {selectedShipments.size > 0
                          ? `Will update ${selectedShipments.size} shipment${selectedShipments.size > 1 ? 's' : ''}`
                          : 'Select shipments from the left panel'}
                        {bulkStatus ? ` → "${bulkStatus}"` : ''}
                      </Text>
                    </View>

                    <Pressable
                      style={[
                        styles.applyBtn,
                        (!bulkStatus || selectedShipments.size === 0) && styles.applyBtnDisabled,
                        bulkLoading && { opacity: 0.6 },
                      ]}
                      onPress={handleBulkUpdate}
                      disabled={!bulkStatus || selectedShipments.size === 0 || bulkLoading}
                    >
                      {bulkLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <MaterialIcons name="bolt" size={16} color="#fff" />
                          <Text style={styles.applyBtnText}>Apply Bulk Update</Text>
                        </>
                      )}
                    </Pressable>
                  </View>

                  <View style={styles.actionCard}>
                    <View style={styles.actionCardHeader}>
                      <MaterialIcons name="bar-chart" size={16} color={Colors.primary} />
                      <Text style={styles.actionCardTitle}>Status Breakdown</Text>
                    </View>
                    <View style={styles.breakdownList}>
                      {STATUSES.map(s => {
                        const count = shipments.filter(sh => sh.status === s).length;
                        if (count === 0) return null;
                        const color = STATUS_COLOR[s];
                        const pct = shipments.length > 0 ? (count / shipments.length) * 100 : 0;
                        return (
                          <View key={s} style={styles.breakdownRow}>
                            <View style={[styles.breakdownDot, { backgroundColor: color }]} />
                            <Text style={styles.breakdownLabel}>{s}</Text>
                            <View style={styles.breakdownBarWrap}>
                              <View style={[styles.breakdownBar, { width: `${pct}%` as any, backgroundColor: color }]} />
                            </View>
                            <Text style={[styles.breakdownCount, { color }]}>{count}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* ══ BROADCAST ══════════════════════════════════════════ */}
            {activeTab === 'broadcast' && (
              <View style={styles.centeredTab}>
                <View style={styles.broadcastCard}>
                  <View style={styles.actionCardHeader}>
                    <MaterialIcons name="campaign" size={18} color={Colors.primary} />
                    <Text style={styles.actionCardTitle}>Push Broadcast</Text>
                    <Text style={styles.actionCardSub}>Sends to all registered devices instantly</Text>
                  </View>

                  <View style={styles.bcTargetRow}>
                    {([
                      { key: 'all' as const,    label: 'All Users',      icon: 'groups' as const },
                      { key: 'active' as const, label: 'Active Drivers', icon: 'directions-car' as const },
                    ]).map(opt => (
                      <Pressable
                        key={opt.key}
                        style={[styles.bcTargetBtn, bcTarget === opt.key && styles.bcTargetBtnActive]}
                        onPress={() => setBcTarget(opt.key)}
                      >
                        <MaterialIcons name={opt.icon} size={15} color={bcTarget === opt.key ? Colors.primary : Colors.textSecondary} />
                        <Text style={[styles.bcTargetLabel, bcTarget === opt.key && { color: Colors.primary }]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.bcField}>
                    <Text style={styles.bcFieldLabel}>Notification Title</Text>
                    <TextInput
                      style={styles.bcInput}
                      value={bcTitle}
                      onChangeText={setBcTitle}
                      placeholder="e.g. Customs checkpoint open at Habur"
                      placeholderTextColor={Colors.textMuted}
                      maxLength={80}
                    />
                  </View>

                  <View style={styles.bcField}>
                    <Text style={styles.bcFieldLabel}>Message Body</Text>
                    <TextInput
                      style={[styles.bcInput, { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }]}
                      value={bcBody}
                      onChangeText={setBcBody}
                      placeholder="Enter the message to send to drivers and/or admins..."
                      placeholderTextColor={Colors.textMuted}
                      multiline
                      maxLength={250}
                    />
                    <Text style={styles.bcCharCount}>{bcBody.length}/250</Text>
                  </View>

                  {bcSent && (
                    <View style={styles.bcSuccess}>
                      <MaterialIcons name="check-circle" size={16} color={Colors.success} />
                      <Text style={styles.bcSuccessText}>Broadcast sent successfully!</Text>
                    </View>
                  )}

                  <Pressable
                    style={[
                      styles.applyBtn,
                      (!bcTitle.trim() || !bcBody.trim()) && styles.applyBtnDisabled,
                      bcLoading && { opacity: 0.6 },
                    ]}
                    onPress={handleBroadcast}
                    disabled={!bcTitle.trim() || !bcBody.trim() || bcLoading}
                  >
                    {bcLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <MaterialIcons name="send" size={16} color="#fff" />
                        <Text style={styles.applyBtnText}>Send Broadcast</Text>
                      </>
                    )}
                  </Pressable>

                  <View style={{ marginTop: Spacing.lg }}>
                    <Text style={styles.bcFieldLabel}>Quick Templates</Text>
                    <View style={styles.templateGrid}>
                      {[
                        { title: 'Border Open',       body: 'Habur border crossing is now operational. Proceed as scheduled.' },
                        { title: 'Customs Alert',     body: 'Extended customs inspection in effect. Allow additional time at the border.' },
                        { title: 'Weather Advisory',  body: 'Adverse weather conditions reported on the route. Drive safely.' },
                        { title: 'Checkpoint Cleared',body: 'TIR corridor checkpoint is clear. Normal transit time expected.' },
                      ].map(tpl => (
                        <Pressable
                          key={tpl.title}
                          style={({ pressed }) => [styles.templateBtn, pressed && { opacity: 0.8 }]}
                          onPress={() => { setBcTitle(tpl.title); setBcBody(tpl.body); }}
                        >
                          <MaterialIcons name="bolt" size={13} color={Colors.primary} />
                          <Text style={styles.templateLabel}>{tpl.title}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* ══ FLEET MONITOR ══════════════════════════════════════ */}
            {activeTab === 'fleet' && (
              <View style={styles.fleetTab}>
                <View style={styles.fleetStatsRow}>
                  <StatPill label="Total Drivers" value={drivers.length} color={Colors.primary} />
                  <StatPill label="Active" value={drivers.filter(d => d.status === 'Active').length} color={Colors.success} />
                  <StatPill label="Idle" value={drivers.filter(d => d.status === 'Idle').length} color={Colors.warning} />
                  <StatPill label="Offline" value={drivers.filter(d => d.status === 'Offline').length} color={Colors.textMuted} />
                </View>

                <SectionTitle title="Driver Status Control" subtitle="Force-update driver availability" />
                <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                  <View style={styles.driverGrid}>
                    {drivers.map(driver => {
                      const statusColor = driver.status === 'Active' ? Colors.success
                        : driver.status === 'Idle' ? Colors.warning : Colors.textMuted;
                      const isLoading = driverStatusLoading.has(driver.id);
                      const assignedShipment = shipments.find(s => s.driverId === driver.id);
                      return (
                        <View key={driver.id} style={styles.driverCard}>
                          <View style={styles.driverCardHeader}>
                            <View style={styles.driverAvatarWrap}>
                              <View style={styles.driverAvatar}>
                                <Text style={styles.driverAvatarText}>{driver.avatarInitials}</Text>
                              </View>
                              <View style={[styles.driverStatusDot, { backgroundColor: statusColor }]} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.driverName} numberOfLines={1}>{driver.fullName}</Text>
                              <Text style={styles.driverPlate}>{driver.plateNumber}</Text>
                            </View>
                            <View style={[styles.driverStatusBadge, { backgroundColor: `${statusColor}15`, borderColor: `${statusColor}30` }]}>
                              <Text style={[styles.driverStatusText, { color: statusColor }]}>{driver.status}</Text>
                            </View>
                          </View>

                          {assignedShipment ? (
                            <View style={styles.driverShipmentRow}>
                              <MaterialIcons name="local-shipping" size={11} color={Colors.textMuted} />
                              <Text style={styles.driverShipmentTir}>{assignedShipment.tirNumber}</Text>
                              <View style={[styles.driverShipmentStatus, { backgroundColor: `${STATUS_COLOR[assignedShipment.status] ?? Colors.primary}18` }]}>
                                <Text style={{ fontSize: 9, color: STATUS_COLOR[assignedShipment.status] ?? Colors.primary, fontWeight: '600' }}>
                                  {assignedShipment.status}
                                </Text>
                              </View>
                            </View>
                          ) : (
                            <Text style={styles.driverNoJob}>No active shipment</Text>
                          )}

                          <View style={styles.driverActions}>
                            {(['Active', 'Idle', 'Offline'] as const).map(s => (
                              <Pressable
                                key={s}
                                style={[
                                  styles.driverActionBtn,
                                  driver.status === s && {
                                    backgroundColor: `${s === 'Active' ? Colors.success : s === 'Idle' ? Colors.warning : Colors.textMuted}18`,
                                    borderColor: s === 'Active' ? Colors.success : s === 'Idle' ? Colors.warning : Colors.textMuted,
                                  },
                                  isLoading && { opacity: 0.4 },
                                ]}
                                onPress={() => handleForceDriverStatus(driver.id, s)}
                                disabled={isLoading || driver.status === s}
                              >
                                {isLoading && driver.status !== s ? (
                                  <ActivityIndicator size="small" color={Colors.primary} style={{ width: 10, height: 10 }} />
                                ) : (
                                  <Text style={[
                                    styles.driverActionText,
                                    driver.status === s && { color: s === 'Active' ? Colors.success : s === 'Idle' ? Colors.warning : Colors.textMuted },
                                  ]}>{s}</Text>
                                )}
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      );
                    })}
                    {drivers.length === 0 && (
                      <View style={styles.emptyState}>
                        <MaterialIcons name="people-outline" size={40} color={Colors.border} />
                        <Text style={styles.emptyText}>No drivers registered yet</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ height: 30 }} />
                </ScrollView>
              </View>
            )}

            {/* ══ ALERTS ═════════════════════════════════════════════ */}
            {activeTab === 'alerts' && (
              <View style={styles.alertsTab}>
                <View style={styles.alertStatsRow}>
                  <StatPill label="Detained" value={shipments.filter(s => s.status === 'Detained').length} color={Colors.danger} />
                  <StatPill label="Customs Pending" value={shipments.filter(s => s.status === 'Customs Pending').length} color={Colors.warning} />
                  <StatPill label="Customs Clearance" value={shipments.filter(s => s.status === 'Customs Clearance').length} color={Colors.warning} />
                  <StatPill label="Needs Attention" value={alertShipments.length} color={Colors.danger} />
                </View>

                {alertShipments.length === 0 ? (
                  <View style={styles.allClearCard}>
                    <MaterialIcons name="verified" size={52} color={Colors.success} />
                    <Text style={styles.allClearTitle}>All Clear</Text>
                    <Text style={styles.allClearSub}>No shipments require immediate attention.</Text>
                  </View>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                    <SectionTitle title="Requires Attention" subtitle={`${alertShipments.length} shipment${alertShipments.length > 1 ? 's' : ''} need action`} />
                    <View style={styles.alertList}>
                      {alertShipments.map(s => {
                        const isDetained = s.status === 'Detained';
                        const accent = isDetained ? Colors.danger : Colors.warning;
                        return (
                          <View key={s.id} style={[styles.alertItem, { borderLeftColor: accent }]}>
                            <View style={styles.alertItemTop}>
                              <View style={[styles.alertIcon, { backgroundColor: `${accent}18` }]}>
                                <MaterialIcons name={isDetained ? 'block' : 'pending-actions'} size={18} color={accent} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.alertTirNum}>{s.tirNumber}</Text>
                                <Text style={styles.alertDriver}>{s.driverName} · {s.plateNumber}</Text>
                              </View>
                              <View style={[styles.alertStatusBadge, { backgroundColor: `${accent}18`, borderColor: `${accent}35` }]}>
                                <Text style={[styles.alertStatusText, { color: accent }]}>{s.status}</Text>
                              </View>
                            </View>
                            <View style={styles.alertItemMeta}>
                              <MaterialIcons name="route" size={12} color={Colors.textMuted} />
                              <Text style={styles.alertRoute}>{s.origin} → {s.destination}</Text>
                            </View>
                            <View style={styles.alertActions}>
                              {(['In Transit', 'Customs Clearance', 'Arrived'] as ShipmentStatus[]).map(action => (
                                <Pressable
                                  key={action}
                                  style={({ pressed }) => [styles.alertActionBtn, pressed && { opacity: 0.8 }]}
                                  onPress={() => updateStatus(s.id, action)}
                                >
                                  <Text style={styles.alertActionText}>→ {action}</Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                    <View style={{ height: 30 }} />
                  </ScrollView>
                )}
              </View>
            )}

            {/* ══ APP CONFIG ═════════════════════════════════════════ */}
            {activeTab === 'config' && <AppConfigTab />}

            {/* ══ DRIVER APPROVALS ══════════════════════════════════ */}
            {activeTab === 'approvals' && (
              <DriverApprovalTab key={visible ? 'open' : 'closed'} />
            )}

          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: '92%',
    maxWidth: 1100,
    height: '88%',
    backgroundColor: Colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.modal,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: Spacing.lg,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  headerStats: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  headerStatItem: { alignItems: 'center', paddingHorizontal: 16, gap: 2 },
  headerStatValue: { fontSize: 18, fontWeight: '800' },
  headerStatLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  headerStatDivider: { width: 1, height: 28, backgroundColor: Colors.border },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },

  // Body
  body: { flex: 1 },

  // ── Operations ─────────────────────────────────────────────────────────────
  twoCol: { flex: 1, flexDirection: 'row' },
  colLeft: {
    width: 340, borderRightWidth: 1, borderRightColor: Colors.border,
    padding: Spacing.xl, gap: Spacing.sm,
  },
  colRight: {
    flex: 1, padding: Spacing.xl, gap: Spacing.lg, overflow: 'hidden',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, height: 36,
  },
  searchInput: { flex: 1, fontSize: FontSize.sm, color: Colors.textPrimary },
  selectAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  selectAllText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  shipmentList: { flex: 1 },
  opShipmentRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 10, paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md, marginBottom: 3,
  },
  opShipmentRowSelected: { backgroundColor: Colors.cardHover },
  opCheckbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card,
  },
  opAccent: { width: 3, height: 28, borderRadius: 2 },
  opShipmentInfo: { flex: 1, gap: 1 },
  opTirNum: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textPrimary, fontFamily: 'monospace' },
  opDriverName: { fontSize: 10, color: Colors.textMuted },
  opStatusChip: {
    borderRadius: BorderRadius.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1,
  },
  opStatusText: { fontSize: 10, fontWeight: '600' },

  actionCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  actionCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCardTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  actionCardSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginLeft: 'auto' as any },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  statusChipDot: { width: 7, height: 7, borderRadius: 4 },
  statusChipLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },

  actionSummary: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  actionSummaryText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontStyle: 'italic' },

  applyBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  applyBtnDisabled: { backgroundColor: Colors.border },
  applyBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },

  breakdownList: { gap: 6 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownDot: { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, width: 120 },
  breakdownBarWrap: {
    flex: 1, height: 5, backgroundColor: Colors.surface, borderRadius: 3, overflow: 'hidden',
  },
  breakdownBar: { height: '100%', borderRadius: 3 },
  breakdownCount: { fontSize: FontSize.xs, fontWeight: '700', fontFamily: 'monospace', width: 20, textAlign: 'right' },

  // ── Broadcast ──────────────────────────────────────────────────────────────
  centeredTab: { flex: 1, alignItems: 'center', padding: Spacing.xl, overflow: 'hidden' },
  broadcastCard: {
    width: '100%', maxWidth: 620,
    backgroundColor: Colors.card, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl, gap: Spacing.lg,
  },
  bcTargetRow: { flexDirection: 'row', gap: Spacing.md },
  bcTargetBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.border,
  },
  bcTargetBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  bcTargetLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  bcField: { gap: 6 },
  bcFieldLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  bcInput: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
    paddingVertical: 11, fontSize: FontSize.base, color: Colors.textPrimary,
  },
  bcCharCount: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'right' },
  bcSuccess: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.success,
  },
  bcSuccessText: { fontSize: FontSize.sm, color: Colors.success, fontWeight: '600' },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 6 },
  templateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border,
  },
  templateLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },

  // ── Fleet Monitor ──────────────────────────────────────────────────────────
  fleetTab: { flex: 1, padding: Spacing.xl, gap: Spacing.lg },
  fleetStatsRow: { flexDirection: 'row', gap: Spacing.md },
  driverGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  driverCard: {
    width: 280, backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.sm,
  },
  driverCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  driverAvatarWrap: { position: 'relative' },
  driverAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  driverAvatarText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  driverStatusDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 1.5, borderColor: Colors.card,
  },
  driverName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  driverPlate: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace' },
  driverStatusBadge: {
    borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1,
  },
  driverStatusText: { fontSize: 11, fontWeight: '700' },
  driverShipmentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.sm,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  driverShipmentTir: { fontSize: FontSize.xs, color: Colors.textSecondary, fontFamily: 'monospace', flex: 1 },
  driverShipmentStatus: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  driverNoJob: { fontSize: FontSize.xs, color: Colors.textMuted, fontStyle: 'italic' },
  driverActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  driverActionBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 6,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  driverActionText: { fontSize: 11, fontWeight: '600', color: Colors.textMuted },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 60, gap: Spacing.md },
  emptyText: { fontSize: FontSize.sm, color: Colors.textMuted },

  // ── Alerts ─────────────────────────────────────────────────────────────────
  alertsTab: { flex: 1, padding: Spacing.xl, gap: Spacing.lg },
  alertStatsRow: { flexDirection: 'row', gap: Spacing.md },
  allClearCard: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  allClearTitle: { fontSize: 24, fontWeight: '700', color: Colors.success },
  allClearSub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  alertList: { gap: Spacing.md },
  alertItem: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, padding: Spacing.lg, gap: Spacing.md,
  },
  alertItemTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  alertIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  alertTirNum: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'monospace' },
  alertDriver: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  alertStatusBadge: {
    borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1,
  },
  alertStatusText: { fontSize: 11, fontWeight: '700' },
  alertItemMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  alertRoute: { fontSize: FontSize.xs, color: Colors.textSecondary },
  alertActions: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  alertActionBtn: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  alertActionText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
});
