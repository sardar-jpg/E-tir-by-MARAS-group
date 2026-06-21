import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Dimensions, Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { Colors, FontSize, BorderRadius } from '@/constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const LOADING_STEPS = [
  'Connecting to MARAS Network...',
  'Loading fleet data...',
  'Restoring session...',
  'Almost ready...',
];

interface SplashScreenProps {
  message?: string;
}

export function SplashScreen({ message }: SplashScreenProps) {
  // ── Entrance animations ────────────────────────────────────────────────────
  const fadeAnim       = useRef(new Animated.Value(0)).current;
  const logoScaleAnim  = useRef(new Animated.Value(0.7)).current;
  const logoOpacity    = useRef(new Animated.Value(0)).current;
  const contentSlide   = useRef(new Animated.Value(24)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // ── Pulse rings ────────────────────────────────────────────────────────────
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;

  // ── Progress bar ──────────────────────────────────────────────────────────
  const progressAnim = useRef(new Animated.Value(0)).current;

  // ── Loading step text ──────────────────────────────────────────────────────
  const [stepIndex, setStepIndex] = useState(0);
  const stepOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Fade in background
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 400, useNativeDriver: true,
    }).start();

    // 2. Logo entrance: scale + fade
    Animated.parallel([
      Animated.spring(logoScaleAnim, {
        toValue: 1, tension: 80, friction: 10, useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1, duration: 500, delay: 150, useNativeDriver: true,
      }),
    ]).start();

    // 3. Content slide up
    Animated.parallel([
      Animated.spring(contentSlide, {
        toValue: 0, tension: 80, friction: 12, delay: 300, useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1, duration: 400, delay: 300, useNativeDriver: true,
      }),
    ]).start();

    // 4. Progress bar (simulated: 0 → 0.85 over 2.5s, then stalls)
    Animated.timing(progressAnim, {
      toValue: 0.85,
      duration: 2500,
      delay: 400,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: false,
    }).start();

    // 5. Pulse ring loops (staggered)
    const createPulseLoop = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(200),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );

    const loop1 = createPulseLoop(pulse1, 0);
    const loop2 = createPulseLoop(pulse2, 500);
    const loop3 = createPulseLoop(pulse3, 1000);
    loop1.start();
    loop2.start();
    loop3.start();

    // 6. Cycle loading step messages
    const stepInterval = setInterval(() => {
      Animated.sequence([
        Animated.timing(stepOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(stepOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setStepIndex(i => (i + 1) % LOADING_STEPS.length);
    }, 1000);

    return () => {
      clearInterval(stepInterval);
      loop1.stop();
      loop2.stop();
      loop3.stop();
    };
  }, []);

  // ── Progress bar width ─────────────────────────────────────────────────────
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCREEN_WIDTH * 0.72],
  });

  // ── Pulse ring transforms ──────────────────────────────────────────────────
  const makePulseStyle = (anim: Animated.Value) => ({
    opacity: anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.35, 0] }),
    transform: [{
      scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.9] }),
    }],
  });

  return (
    <Animated.View style={[styles.root, { opacity: fadeAnim }]}>
      <StatusBar style="light" />

      {/* Background image */}
      <Image
        source={require('@/assets/images/login-bg.png')}
        style={styles.bgImage}
        contentFit="cover"
        transition={0}
      />
      <View style={styles.bgOverlay} />

      {/* Radial glow beneath logo */}
      <View style={styles.glowCenter} pointerEvents="none">
        <View style={styles.glowCircle} />
      </View>

      {/* ── Logo area ── */}
      <Animated.View
        style={[
          styles.logoArea,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScaleAnim }],
          },
        ]}
      >
        {/* Pulse rings */}
        <Animated.View style={[styles.pulseRing, makePulseStyle(pulse1)]} />
        <Animated.View style={[styles.pulseRing, makePulseStyle(pulse2)]} />
        <Animated.View style={[styles.pulseRing, makePulseStyle(pulse3)]} />

        {/* Logo card */}
        <View style={styles.logoCard}>
          <Image
            source={require('@/assets/images/etir-logo.jpg')}
            style={styles.logoImage}
            contentFit="contain"
            transition={0}
          />
        </View>
      </Animated.View>

      {/* ── Bottom content ── */}
      <Animated.View
        style={[
          styles.bottomContent,
          {
            opacity: contentOpacity,
            transform: [{ translateY: contentSlide }],
          },
        ]}
      >
        {/* Tagline */}
        <Text style={styles.tagline}>by MARAS Logistics</Text>

        {/* Status pills */}
        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <View style={styles.pillDot} />
            <Text style={styles.pillText}>TIR GATEWAY</Text>
          </View>
          <View style={[styles.pill, styles.pillLive]}>
            <View style={[styles.pillDot, styles.pillDotLive]} />
            <Text style={[styles.pillText, styles.pillTextLive]}>LIVE TRACKING</Text>
          </View>
        </View>

        {/* Progress track */}
        <View style={styles.progressSection}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            {/* Shimmer overlay */}
            <Animated.View style={[styles.progressShimmer, { left: progressWidth }]} />
          </View>

          {/* Loading message */}
          <Animated.Text style={[styles.loadingMsg, { opacity: stepOpacity }]}>
            {message ?? LOADING_STEPS[stepIndex]}
          </Animated.Text>
        </View>

        {/* Bottom brand */}
        <View style={styles.brandFooter}>
          <View style={styles.brandFooterDot} />
          <Text style={styles.brandFooterText}>MARAS GROUP · e-TIR Platform</Text>
          <View style={styles.brandFooterDot} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const LOGO_CARD_SIZE = 200;
const PULSE_RING_SIZE = LOGO_CARD_SIZE + 60;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Background ──────────────────────────────────────────────────────────────
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13,17,23,0.78)',
  },

  // ── Radial glow ────────────────────────────────────────────────────────────
  glowCenter: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.25,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCircle: {
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(47,129,247,0.07)',
  },

  // ── Logo area ──────────────────────────────────────────────────────────────
  logoArea: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.22,
    alignItems: 'center',
    justifyContent: 'center',
    width: PULSE_RING_SIZE + 80,
    height: PULSE_RING_SIZE + 80,
  },
  pulseRing: {
    position: 'absolute',
    width: PULSE_RING_SIZE,
    height: PULSE_RING_SIZE,
    borderRadius: PULSE_RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  logoCard: {
    width: LOGO_CARD_SIZE,
    height: 76,
    borderRadius: BorderRadius.xl,
    backgroundColor: 'rgba(255,255,255,0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(47,129,247,0.45)',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  logoImage: {
    width: 164,
    height: 52,
  },

  // ── Bottom content ─────────────────────────────────────────────────────────
  bottomContent: {
    position: 'absolute',
    bottom: SCREEN_HEIGHT * 0.12,
    left: 0, right: 0,
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 32,
  },
  tagline: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  // Pill row
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(13,17,23,0.7)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pillLive: {
    borderColor: 'rgba(63,185,80,0.3)',
    backgroundColor: 'rgba(63,185,80,0.08)',
  },
  pillDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  pillDotLive: {
    backgroundColor: Colors.success,
  },
  pillText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.9,
  },
  pillTextLive: {
    color: Colors.success,
  },

  // Progress
  progressSection: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    width: '72%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: Colors.primary,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  progressShimmer: {
    position: 'absolute',
    top: 0,
    width: 32,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2,
    transform: [{ skewX: '-20deg' }],
  },
  loadingMsg: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // Brand footer
  brandFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  brandFooterDot: {
    width: 3, height: 3, borderRadius: 2,
    backgroundColor: Colors.textMuted,
    opacity: 0.5,
  },
  brandFooterText: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
});
