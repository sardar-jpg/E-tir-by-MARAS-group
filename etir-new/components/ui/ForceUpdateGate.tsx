/**
 * ForceUpdateGate — Wraps app content and shows a blocking overlay when:
 *   1. The installed version is below the minimum required version, OR
 *   2. The app is in maintenance mode.
 *
 * Uses fail-open logic: if the config fetch fails or times out,
 * the app continues normally to avoid locking out users on network issues.
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, Platform,
  Linking, ActivityIndicator, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Colors, FontSize, Spacing, BorderRadius } from '@/constants/theme';
import { fetchAppConfig, compareVersions, AppConfig } from '@/services/versionService';

// Timeout to avoid blocking the app on slow networks (ms)
const CHECK_TIMEOUT_MS = 6000;

type GateState = 'checking' | 'ok' | 'update_required' | 'maintenance';

function getInstalledVersion(): string {
  // expo-constants gives us the version from app.json
  return Constants.expoConfig?.version ?? '1.0.0';
}

// ── Force Update Screen ───────────────────────────────────────────────────────
function ForceUpdateScreen({
  config,
  installedVersion,
}: {
  config: AppConfig;
  installedVersion: string;
}) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, []);

  const handleUpdate = () => {
    const url = Platform.OS === 'ios' ? config.appStoreUrl : config.playStoreUrl;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={fus.root}>
      {/* Background gradient overlay */}
      <View style={fus.bgOverlay} />

      <Animated.View style={[fus.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Icon */}
        <Animated.View style={[fus.iconRing, { transform: [{ scale: pulseAnim }] }]}>
          <View style={fus.iconInner}>
            <MaterialIcons name="system-update" size={40} color={Colors.primary} />
          </View>
        </Animated.View>

        {/* Title */}
        <Text style={fus.title}>Update Required</Text>
        <Text style={fus.subtitle}>
          A newer version of e-TIR Gateway is required to continue.
        </Text>

        {/* Version comparison */}
        <View style={fus.versionRow}>
          <View style={fus.versionItem}>
            <Text style={fus.versionLabel}>YOUR VERSION</Text>
            <Text style={[fus.versionValue, fus.versionOld]}>{installedVersion}</Text>
          </View>
          <MaterialIcons name="arrow-forward" size={18} color={Colors.textMuted} />
          <View style={fus.versionItem}>
            <Text style={fus.versionLabel}>REQUIRED</Text>
            <Text style={[fus.versionValue, fus.versionNew]}>{config.minRequiredVersion}</Text>
          </View>
        </View>

        {/* What's changed note */}
        <View style={fus.infoBox}>
          <MaterialIcons name="info-outline" size={14} color={Colors.info} />
          <Text style={fus.infoText}>
            This update contains important improvements and bug fixes required for continued operation.
          </Text>
        </View>

        {/* Update button */}
        <Pressable
          style={({ pressed }) => [fus.updateBtn, pressed && { opacity: 0.85 }]}
          onPress={handleUpdate}
        >
          <MaterialIcons name="download" size={18} color="#fff" />
          <Text style={fus.updateBtnText}>
            {Platform.OS === 'ios' ? 'Update on App Store' : 'Update on Google Play'}
          </Text>
          <MaterialIcons name="open-in-new" size={14} color="rgba(255,255,255,0.7)" />
        </Pressable>

        <Text style={fus.footer}>
          {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} · e-TIR Gateway
        </Text>
      </Animated.View>
    </View>
  );
}

// ── Maintenance Screen ────────────────────────────────────────────────────────
function MaintenanceScreen({ message }: { message: string }) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();

    const rotate = Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 3000, useNativeDriver: true })
    );
    rotate.start();
    return () => rotate.stop();
  }, []);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={ms.root}>
      <View style={ms.bgOverlay} />
      <Animated.View style={[ms.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={ms.iconWrap}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <MaterialIcons name="settings" size={44} color={Colors.warning} />
          </Animated.View>
        </View>
        <Text style={ms.title}>Under Maintenance</Text>
        <Text style={ms.subtitle}>{message}</Text>
        <View style={ms.infoBox}>
          <MaterialIcons name="access-time" size={14} color={Colors.warning} />
          <Text style={ms.infoText}>
            The app will be available again shortly. Thank you for your patience.
          </Text>
        </View>
        <View style={ms.footer}>
          <View style={ms.footerDot} />
          <Text style={ms.footerText}>e-TIR Gateway · Operations Team</Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ── Main Gate Component ───────────────────────────────────────────────────────
interface ForceUpdateGateProps {
  children: React.ReactNode;
}

export function ForceUpdateGate({ children }: ForceUpdateGateProps) {
  const [state,   setState]   = useState<GateState>('checking');
  const [config,  setConfig]  = useState<AppConfig | null>(null);
  const installedVersion = getInstalledVersion();

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      // Timeout: if fetch takes too long, allow the app through (fail-open)
      const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS));
      const fetched = fetchAppConfig();

      const result = await Promise.race([fetched, timeout]);

      if (cancelled) return;

      if (!result) {
        // Timed out or failed — let the app through
        setState('ok');
        return;
      }

      setConfig(result);

      if (result.maintenanceMode) {
        setState('maintenance');
        return;
      }

      const needsUpdate = compareVersions(installedVersion, result.minRequiredVersion) < 0;
      setState(needsUpdate ? 'update_required' : 'ok');
    };

    check();
    return () => { cancelled = true; };
  }, []);

  // Show nothing (or a brief loader) while checking
  if (state === 'checking') {
    return (
      <>
        {children}
        <Modal transparent visible statusBarTranslucent animationType="none">
          <View style={loader.overlay}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        </Modal>
      </>
    );
  }

  if (state === 'update_required' && config) {
    return (
      <>
        {children}
        <Modal transparent={false} visible statusBarTranslucent animationType="none">
          <ForceUpdateScreen config={config} installedVersion={installedVersion} />
        </Modal>
      </>
    );
  }

  if (state === 'maintenance' && config) {
    return (
      <>
        {children}
        <Modal transparent={false} visible statusBarTranslucent animationType="none">
          <MaintenanceScreen message={config.maintenanceMessage} />
        </Modal>
      </>
    );
  }

  // state === 'ok'
  return <>{children}</>;
}

// ── Force Update Screen Styles ────────────────────────────────────────────────
const fus = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xxxl,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(47,129,247,0.25)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryGlow,
    borderWidth: 1.5,
    borderColor: 'rgba(47,129,247,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    width: '100%',
    justifyContent: 'center',
  },
  versionItem: { alignItems: 'center', gap: 4 },
  versionLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  versionValue: {
    fontSize: FontSize.lg,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  versionOld: { color: Colors.danger },
  versionNew: { color: Colors.success },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: `${Colors.info}12`,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: `${Colors.info}25`,
    padding: Spacing.md,
    width: '100%',
  },
  infoText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: 15,
    paddingHorizontal: Spacing.xxl,
    width: '100%',
  },
  updateBtnText: {
    fontSize: FontSize.base,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  footer: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: -Spacing.sm,
  },
});

// ── Maintenance Screen Styles ─────────────────────────────────────────────────
const ms = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xxxl,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.warningBg,
    borderWidth: 1.5,
    borderColor: `${Colors.warning}35`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.warningBg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: `${Colors.warning}30`,
    padding: Spacing.md,
    width: '100%',
  },
  infoText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.xs,
  },
  footerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.warning,
  },
  footerText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
});

// ── Checking loader styles ────────────────────────────────────────────────────
const loader = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
