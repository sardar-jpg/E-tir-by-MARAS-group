import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Animated,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabaseClient';
import { useLanguage } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { Colors, FontSize, Spacing, BorderRadius } from '@/constants/theme';
import { SplashScreen } from '@/components/ui/SplashScreen';

type TabMode = 'admin' | 'driver' | 'customer' | 'register';

const TRUCK_CLASSES = ['Refrigerated', 'Flatbed', 'Box Truck', 'Tanker', 'Container'];

// ── Shared OTP Step ───────────────────────────────────────────────────────────
interface OtpStepProps {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  digits: string[];
  loading: boolean;
  error: string;
  resendMsg: string;
  resending: boolean;
  otpRefs: React.RefObject<TextInput>[];
  onDigit: (index: number, value: string) => void;
  onKeyDown: (index: number, key: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
}

function OtpStep({
  title, description, confirmLabel,
  digits, loading, error, resendMsg, resending,
  otpRefs, onDigit, onKeyDown, onVerify, onResend, onBack,
}: OtpStepProps) {
  const complete = digits.join('').length === 4;
  return (
    <View style={otpSt.wrap}>
      <View style={otpSt.icon}>
        <MaterialIcons name="mark-email-unread" size={28} color={Colors.primary} />
      </View>
      <Text style={otpSt.title}>{title}</Text>
      <Text style={otpSt.desc}>{description}</Text>

      <View style={otpSt.row}>
        {digits.map((d, i) => (
          <TextInput
            key={i}
            ref={otpRefs[i]}
            style={[otpSt.box, d ? otpSt.boxFilled : null, error ? otpSt.boxError : null]}
            value={d}
            onChangeText={v => onDigit(i, v)}
            onKeyPress={({ nativeEvent }) => onKeyDown(i, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={1}
            textAlign="center"
            selectTextOnFocus
            caretHidden
          />
        ))}
      </View>

      {error ? (
        <View style={otpSt.errorBox}>
          <MaterialIcons name="error-outline" size={13} color={Colors.danger} />
          <Text style={otpSt.errorText}>{error}</Text>
        </View>
      ) : null}

      {resendMsg ? (
        <View style={otpSt.successBox}>
          <MaterialIcons name="check-circle-outline" size={13} color={Colors.success} />
          <Text style={otpSt.successText}>{resendMsg}</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [otpSt.btn, pressed && { opacity: 0.88 }, (!complete || loading) && { opacity: 0.5 }]}
        onPress={onVerify}
        disabled={!complete || loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" size="small" />
          : (<><MaterialIcons name="verified-user" size={15} color="#fff" /><Text style={otpSt.btnLabel}>{confirmLabel}</Text></>)}
      </Pressable>

      <View style={otpSt.resendRow}>
        <Text style={otpSt.resendText}>Did not receive it? </Text>
        <Pressable onPress={onResend} disabled={resending} hitSlop={8}>
          {resending
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Text style={otpSt.resendLink}>Resend code</Text>}
        </Pressable>
      </View>

      <Pressable style={otpSt.backLink} onPress={onBack}>
        <MaterialIcons name="arrow-back" size={13} color={Colors.textMuted} />
        <Text style={otpSt.backLinkText}>Go back</Text>
      </Pressable>
    </View>
  );
}

const otpSt = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.sm },
  icon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  desc: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, marginVertical: Spacing.sm },
  box: {
    width: 58, height: 66, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.card, borderWidth: 2, borderColor: Colors.border,
    fontSize: 26, fontWeight: '700', color: Colors.textPrimary,
  },
  boxFilled: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  boxError: { borderColor: Colors.danger, backgroundColor: Colors.dangerBg },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%',
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(248,81,73,0.2)',
  },
  errorText: { flex: 1, fontSize: FontSize.sm, color: Colors.danger },
  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%',
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.success}35`,
  },
  successText: { fontSize: FontSize.sm, color: Colors.success, flex: 1 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 14, width: '100%',
  },
  btnLabel: { fontSize: FontSize.base, fontWeight: '700', color: '#fff' },
  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  resendText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  resendLink: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  backLinkText: { fontSize: FontSize.xs, color: Colors.textMuted },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const router = useRouter();
  const { login, loginWithGoogle, register, verifyOtp, resendVerification, isLoading, user, isPendingApproval } = useAuth();
  const { t } = useLanguage();
  const pathname = usePathname();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 480, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 120, friction: 16, useNativeDriver: true }),
    ]).start();
  }, []);

  const [tab, setTab] = useState<TabMode>('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  // Register fields
  const [regName,       setRegName]       = useState('');
  const [regUsername,   setRegUsername]   = useState('');
  const [regEmail,      setRegEmail]      = useState('');
  const [regPhone,      setRegPhone]      = useState('');
  const [regPlate,      setRegPlate]      = useState('');
  const [regTruckClass, setRegTruckClass] = useState('Box Truck');
  const [regPassword,   setRegPassword]   = useState('');
  const [showRegPw,     setShowRegPw]     = useState(false);

  // Modals
  const [showPrivacy,   setShowPrivacy]   = useState(false);
  const [showToS,       setShowToS]       = useState(false);

  // OTP — shared state for both login + register flows
  const [pendingOtp,       setPendingOtp]       = useState(false);   // register
  const [loginOtpPending,  setLoginOtpPending]  = useState(false);   // login
  const [otpDigits,        setOtpDigits]        = useState(['', '', '', '']);
  const [otpLoading,       setOtpLoading]       = useState(false);
  const [otpError,         setOtpError]         = useState('');
  const [otpResending,     setOtpResending]     = useState(false);
  const [otpResendMsg,     setOtpResendMsg]     = useState('');
  const otpRefs = [
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
  ];

  // Forgot password
  const [showForgotPw, setShowForgotPw] = useState(false);
  const [fpEmail,      setFpEmail]      = useState('');
  const [fpLoading,    setFpLoading]    = useState(false);
  const [fpSent,       setFpSent]       = useState(false);
  const [fpError,      setFpError]      = useState('');

  useEffect(() => {
    if (user && (pathname === '/' || pathname === '/index')) {
      if (user.role === 'admin') router.replace('/(tabs)');
      else router.replace('/driver');
    }
  }, [user, pathname]);

  if (isLoading && !user) return <SplashScreen />;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const resetOtp = () => {
    setOtpDigits(['', '', '', '']);
    setOtpError('');
    setOtpResendMsg('');
  };

  const focusFirstOtp = () => setTimeout(() => otpRefs[0].current?.focus(), 350);

  const handleLogin = async () => {
    setError('');
    if (!email.trim() || !password.trim()) { setError(t('auth.fillCredentials')); return; }
    const res = await login(email.trim(), password.trim());
    if (!res.success) {
      if (res.needsVerification) {
        resetOtp();
        setLoginOtpPending(true);
        focusFirstOtp();
        return;
      }
      if ((res as any).pendingApproval) {
        // isPendingApproval state is set in AuthContext, UI reacts automatically
        return;
      }
      setError(res.error ?? t('auth.fillCredentials'));
    }
  };

  const handleRegister = async () => {
    setError('');
    if (!regName || !regEmail || !regPhone || !regPlate || !regPassword) {
      setError(t('auth.fillAll')); return;
    }
    const res = await register({ fullName: regName, username: regUsername, email: regEmail, phone: regPhone, plateNumber: regPlate, truckClass: regTruckClass, password: regPassword });
    if (res.success) {
      resetOtp();
      setPendingOtp(true);
      focusFirstOtp();
    } else {
      setError(res.error ?? t('auth.fillAll'));
    }
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
    const result = await verifyOtp(otp);
    setOtpLoading(false);
    if (!result.success) {
      setOtpError(result.error ?? 'Invalid code. Please try again.');
      setOtpDigits(['', '', '', '']);
      setTimeout(() => otpRefs[0].current?.focus(), 100);
    } else {
      setPendingOtp(false);
      setLoginOtpPending(false);
    }
  };

  const handleResendOtp = async () => {
    setOtpResending(true);
    setOtpResendMsg('');
    setOtpError('');
    const result = await resendVerification();
    setOtpResending(false);
    if (!result.success) { setOtpError(result.error ?? 'Failed to resend. Try again shortly.'); return; }
    setOtpResendMsg('A new code has been sent to your email.');
    setOtpDigits(['', '', '', '']);
    setTimeout(() => otpRefs[0].current?.focus(), 100);
  };

  const handleForgotPassword = async () => {
    setFpError('');
    if (!fpEmail.trim()) { setFpError('Please enter your email address.'); return; }
    setFpLoading(true);
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/reset-password`
      : 'onspaceapp://reset-password';
    const { error: fpErr } = await supabase.auth.resetPasswordForEmail(fpEmail.trim(), { redirectTo });
    setFpLoading(false);
    if (fpErr) { setFpError(fpErr.message); return; }
    setFpSent(true);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {/* Subtle grid overlay */}
      <View style={styles.gridOverlay} pointerEvents="none">
        {[0, 1, 2, 3, 4].map(i => (
          <View key={i} style={[styles.gridLine, { left: `${i * 25}%` as any }]} />
        ))}
      </View>

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandIconBox}>
            <MaterialIcons name="swap-horiz" size={16} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.brandName}>e-TIR</Text>
            <Text style={styles.brandSub}>by MARAS GROUP</Text>
          </View>
        </View>
        <View style={styles.topBarRight}>
          <Pressable style={styles.topPill} onPress={() => router.push('/tracking')}>
            <MaterialIcons name="my-location" size={12} color={Colors.primary} />
            <Text style={styles.topPillText}>Track</Text>
          </Pressable>
          <LanguagePicker compact />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={[styles.centerContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* ── Role Tabs ── */}
            <View style={styles.tabRow}>
              {(['admin', 'driver', 'customer'] as TabMode[]).map(tabId => {
                const isActive = tab === tabId;
                const icons: Record<TabMode, keyof typeof MaterialIcons.glyphMap> = {
                  admin: 'admin-panel-settings',
                  driver: 'local-shipping',
                  customer: 'business-center',
                };
                const labels: Record<TabMode, string> = {
                  admin: t('auth.admin'), driver: t('auth.driver'), customer: t('customer.portalTitle'),
                };
                return (
                  <Pressable
                    key={tabId}
                    style={[styles.tabBtn, isActive && styles.tabBtnActive]}
                    onPress={() => {
                      if (tabId === 'customer') { router.push('/customer'); return; }
                      setTab(tabId); setError('');
                    }}
                  >
                    <View style={[styles.tabIconWrap, isActive && styles.tabIconWrapActive, tabId === 'customer' && { backgroundColor: tab === 'customer' ? `${Colors.success}18` : undefined }]}>
                      <MaterialIcons name={icons[tabId]} size={15} color={tabId === 'customer' ? Colors.success : isActive ? Colors.primary : Colors.textMuted} />
                    </View>
                    <Text style={[styles.tabLabel, isActive && styles.tabLabelActive, tabId === 'customer' && { color: Colors.success }]}>{labels[tabId]}</Text>
                    {isActive && <View style={[styles.tabActiveBar, tabId === 'customer' && { backgroundColor: Colors.success }]} />}
                  </Pressable>
                );
              })}
            </View>

            {/* ── Form Card ── */}
            <View style={styles.formCard}>

              {/* Top accent line */}
              <View style={[
                styles.formCardAccent,
                tab === 'driver'
                  ? { backgroundColor: Colors.primary }
                  : { backgroundColor: '#D2A8FF' },
              ]} />

              {/* Form title row */}
              {!(pendingOtp || loginOtpPending) && (
                <View style={styles.formTitleRow}>
                  <MaterialIcons
                    name={tab === 'driver' ? 'local-shipping' : 'admin-panel-settings'}
                    size={16}
                    color={tab === 'driver' ? Colors.primary : '#D2A8FF'}
                  />
                  <Text style={styles.formTitle}>
                    {tab === 'admin' ? t('auth.adminLogin') : t('auth.driverLogin')}
                  </Text>
                </View>
              )}

              {/* ── Driver Pending Approval State ── */}
              {tab === 'driver' && isPendingApproval && !loginOtpPending && (
                <View style={styles.pendingApprovalBox}>
                  <View style={styles.pendingApprovalIconWrap}>
                    <MaterialIcons name="hourglass-top" size={32} color={Colors.warning} />
                  </View>
                  <Text style={styles.pendingApprovalTitle}>Account Pending Approval</Text>
                  <Text style={styles.pendingApprovalDesc}>
                    Your driver account has been registered successfully and is awaiting admin approval. You will be able to sign in once MARAS dispatch approves your account.
                  </Text>
                  <View style={styles.pendingApprovalInfo}>
                    <MaterialIcons name="info-outline" size={13} color={Colors.textMuted} />
                    <Text style={styles.pendingApprovalInfoText}>This process usually takes less than 24 hours.</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.pendingApprovalBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => { setEmail(''); setPassword(''); setError(''); }}
                  >
                    <MaterialIcons name="arrow-back" size={15} color={Colors.textMuted} />
                    <Text style={styles.pendingApprovalBtnText}>Try Another Account</Text>
                  </Pressable>
                </View>
              )}

              {/* ── Admin / Driver Sign-In ── */}
              {tab !== 'customer' && !isPendingApproval ? (
                loginOtpPending ? (
                  <OtpStep
                    title="Verify Your Email"
                    description={
                      <Text>
                        Your account needs verification. A 4-digit code was sent to{' '}
                        <Text style={{ color: Colors.primary, fontWeight: '700' }}>{email}</Text>
                      </Text>
                    }
                    confirmLabel="Verify & Sign In"
                    digits={otpDigits}
                    loading={otpLoading}
                    error={otpError}
                    resendMsg={otpResendMsg}
                    resending={otpResending}
                    otpRefs={otpRefs}
                    onDigit={handleOtpDigit}
                    onKeyDown={handleOtpKeyDown}
                    onVerify={handleVerifyOtp}
                    onResend={handleResendOtp}
                    onBack={() => { setLoginOtpPending(false); resetOtp(); }}
                  />
                ) : (
                  <>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>
                        {tab === 'driver' ? t('auth.email') : t('auth.emailAddress')}
                      </Text>
                      <View style={styles.inputRow}>
                        <MaterialIcons name="alternate-email" size={16} color={Colors.textMuted} style={styles.inputLeadIcon} />
                        <TextInput
                          style={styles.input}
                          value={email}
                          onChangeText={setEmail}
                          placeholder={tab === 'driver' ? t('auth.emailPlaceholder') : 'your@email.com'}
                          placeholderTextColor={Colors.textMuted}
                          autoCapitalize="none"
                          keyboardType={tab === 'driver' ? 'default' : 'email-address'}
                          returnKeyType="next"
                        />
                      </View>
                    </View>

                    <View style={styles.fieldGroup}>
                      <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabel}>{t('auth.password')}</Text>
                        <Pressable onPress={() => { setFpEmail(email); setFpSent(false); setFpError(''); setShowForgotPw(true); }} hitSlop={8}>
                          <Text style={styles.forgotLink}>{t('customer.forgotPassword')}</Text>
                        </Pressable>
                      </View>
                      <View style={styles.inputRow}>
                        <MaterialIcons name="lock-outline" size={16} color={Colors.textMuted} style={styles.inputLeadIcon} />
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          value={password}
                          onChangeText={setPassword}
                          placeholder="••••••••"
                          placeholderTextColor={Colors.textMuted}
                          secureTextEntry={!showPassword}
                          returnKeyType="done"
                          onSubmitEditing={handleLogin}
                        />
                        <Pressable onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn} hitSlop={8}>
                          <MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={16} color={Colors.textMuted} />
                        </Pressable>
                      </View>
                    </View>

                    {error ? (
                      <View style={styles.errorBox}>
                        <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                        <Text style={styles.errorText}>{error}</Text>
                      </View>
                    ) : null}

                    <Pressable
                      style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]}
                      onPress={handleLogin}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Text style={styles.submitLabel}>{t('auth.signIn')}</Text>
                          <MaterialIcons name="arrow-forward" size={16} color="#fff" />
                        </>
                      )}
                    </Pressable>

                    {/* Google — admin only */}
                    {tab === 'admin' && (
                      <>
                        <View style={styles.orRow}>
                          <View style={styles.orLine} />
                          <Text style={styles.orText}>{t('auth.orContinueWith')}</Text>
                          <View style={styles.orLine} />
                        </View>
                        <Pressable
                          style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}
                          onPress={async () => {
                            setError('');
                            const res = await loginWithGoogle();
                            if (!res.success) setError(res.error ?? 'Google sign-in failed.');
                          }}
                          disabled={isLoading}
                        >
                          <View style={styles.googleIconCircle}><Text style={styles.googleIconText}>G</Text></View>
                          <Text style={styles.googleBtnText}>{t('auth.signInWithGoogle')}</Text>
                        </Pressable>
                      </>
                    )}

                    {/* Register CTA — driver only */}
                    {tab === 'driver' && (
                      <>
                        <View style={styles.orRow}>
                          <View style={styles.orLine} />
                          <Text style={styles.orText}>{t('auth.driverRegister')}</Text>
                          <View style={styles.orLine} />
                        </View>
                        <Pressable
                          style={({ pressed }) => [styles.registerDriverBtn, pressed && { opacity: 0.85 }]}
                          onPress={() => { setTab('register'); setError(''); }}
                        >
                          <View style={styles.registerDriverIconWrap}>
                            <MaterialIcons name="person-add" size={16} color={Colors.primary} />
                          </View>
                          <View style={styles.registerDriverText}>
                            <Text style={styles.registerDriverTitle}>{t('auth.driverRegister')}</Text>
                            <Text style={styles.registerDriverSub}>{t('auth.driverRegisterSub')}</Text>
                          </View>
                          <MaterialIcons name="arrow-forward" size={14} color={Colors.primary} />
                        </Pressable>
                      </>
                    )}
                  </>
                )
              ) : null}
            </View>

            {/* ── Bottom utility row: Legal links ── */}
            <View style={styles.bottomRow}>
              <View style={styles.legalRow}>
                <Pressable style={styles.legalLink} onPress={() => setShowPrivacy(true)} hitSlop={6}>
                  <MaterialIcons name="privacy-tip" size={10} color={Colors.textMuted} />
                  <Text style={styles.legalLinkText}>Privacy Policy</Text>
                </Pressable>
                <View style={styles.legalDot} />
                <Pressable style={styles.legalLink} onPress={() => setShowToS(true)} hitSlop={6}>
                  <MaterialIcons name="gavel" size={10} color={Colors.textMuted} />
                  <Text style={styles.legalLinkText}>Terms of Service</Text>
                </Pressable>
              </View>
            </View>

            {/* Platform badge */}
            <View style={styles.platformBadge}>
              <View style={styles.platformBadgeDot} />
              <Text style={styles.platformBadgeText}>MARAS GROUP · Logistics &amp; Supply Chain · Iraq</Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ─── Forgot Password Modal ─── */}
      <Modal visible={showForgotPw} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForgotPw(false)}>
        <View style={styles.sheetRoot}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderLeft}>
              <View style={styles.sheetHeaderIcon}><MaterialIcons name="lock-reset" size={18} color={Colors.primary} /></View>
              <View>
                <Text style={styles.sheetTitle}>Reset Password</Text>
                <Text style={styles.sheetSub}>We will send a link to your email</Text>
              </View>
            </View>
            <Pressable style={styles.sheetCloseBtn} onPress={() => { setShowForgotPw(false); setFpSent(false); setFpError(''); }}>
              <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.sheetBody}>
            {fpSent ? (
              <View style={styles.fpSuccess}>
                <View style={styles.fpSuccessIcon}><MaterialIcons name="mark-email-read" size={40} color={Colors.success} /></View>
                <Text style={styles.fpSuccessTitle}>Check your inbox</Text>
                <Text style={styles.fpSuccessMsg}>A reset link was sent to <Text style={{ color: Colors.primary, fontWeight: '700' }}>{fpEmail}</Text>.</Text>
                <View style={styles.infoNote}>
                  <MaterialIcons name="info-outline" size={13} color={Colors.textMuted} />
                  <Text style={styles.infoNoteText}>Didn't receive it? Check your spam or try again.</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.outlineBtn, pressed && { opacity: 0.8 }]} onPress={() => { setFpSent(false); setFpError(''); }}>
                  <MaterialIcons name="refresh" size={15} color={Colors.primary} />
                  <Text style={styles.outlineBtnText}>Send again</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: Spacing.lg }}>
                <Text style={styles.sheetDesc}>Enter the email address on your account and we will send a password reset link.</Text>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Email Address</Text>
                  <View style={styles.inputRow}>
                    <MaterialIcons name="mail-outline" size={16} color={Colors.textMuted} style={styles.inputLeadIcon} />
                    <TextInput
                      style={styles.input}
                      value={fpEmail}
                      onChangeText={setFpEmail}
                      placeholder="your@email.com"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      autoFocus
                    />
                  </View>
                </View>
                {fpError ? (
                  <View style={styles.errorBox}>
                    <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                    <Text style={styles.errorText}>{fpError}</Text>
                  </View>
                ) : null}
                <Pressable style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]} onPress={handleForgotPassword} disabled={fpLoading}>
                  {fpLoading ? <ActivityIndicator color="#fff" size="small" /> : (
                    <><Text style={styles.submitLabel}>Send Reset Link</Text><MaterialIcons name="send" size={15} color="#fff" /></>
                  )}
                </Pressable>
                <Pressable style={styles.backLink} onPress={() => setShowForgotPw(false)}>
                  <MaterialIcons name="arrow-back" size={14} color={Colors.textMuted} />
                  <Text style={styles.backLinkText}>Back to sign in</Text>
                </Pressable>
              </View>
            )}
          </View>
          {fpSent && (
            <View style={styles.sheetFooter}>
              <Pressable style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]} onPress={() => { setShowForgotPw(false); setFpSent(false); }}>
                <Text style={styles.submitLabel}>Done</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* ─── Terms of Service Modal ─── */}
      <Modal visible={showToS} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowToS(false)}>
        <View style={styles.sheetRoot}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderLeft}>
              <View style={styles.sheetHeaderIcon}><MaterialIcons name="gavel" size={18} color={Colors.primary} /></View>
              <View>
                <Text style={styles.sheetTitle}>Terms of Service</Text>
                <Text style={styles.sheetSub}>e-TIR by MARAS · June 2026</Text>
              </View>
            </View>
            <Pressable style={styles.sheetCloseBtn} onPress={() => setShowToS(false)}>
              <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetContent}>
              <PPSection title="Acceptance of Terms"><Text style={styles.ppBody}>By accessing or using the e-TIR by MARAS application, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the application.</Text></PPSection>
              <PPSection title="Description of Service"><Text style={styles.ppBody}>e-TIR by MARAS is a logistics management platform operated by MARAS Logistics providing tools for electronic TIR management, real-time GPS tracking, fleet monitoring, driver assignment, customs clearance workflows, document storage, and dispatcher-driver communication.</Text></PPSection>
              <PPSection title="User Accounts and Access">
                <Text style={styles.ppBody}>Access is granted exclusively to authorized MARAS personnel and registered drivers. You are responsible for:</Text>
                {['Maintaining the confidentiality of your login credentials', 'All activities that occur under your account', 'Notifying MARAS immediately of any unauthorized use', 'Ensuring your account information is accurate and up to date'].map(item => <PPItem key={item} text={item} />)}
              </PPSection>
              <PPSection title="Acceptable Use">
                <Text style={styles.ppBody}>The following activities are strictly prohibited:</Text>
                {['Unauthorized access to or tampering with any part of the system', 'Uploading malicious content, viruses, or harmful code', 'Using the platform to conduct fraudulent or illegal activities', 'Sharing login credentials with unauthorized third parties', 'Submitting false shipment data, locations, or documents'].map(item => <PPItem key={item} text={item} />)}
              </PPSection>
              <PPSection title="Driver Responsibilities">
                <Text style={styles.ppBody}>Registered drivers must:</Text>
                {['Provide accurate vehicle, license, and personal information', 'Enable GPS location tracking during active shipments', 'Upload only genuine cargo documents for assigned shipments', 'Respond to dispatch messages in a timely manner', 'Comply with all applicable traffic laws and transit regulations'].map(item => <PPItem key={item} text={item} />)}
              </PPSection>
              <PPSection title="Service Limitations"><Text style={styles.ppBody}>MARAS endeavors to maintain continuous availability but does not guarantee uninterrupted access. MARAS shall not be liable for any losses resulting from service interruptions due to maintenance, network failures, or force majeure events.</Text></PPSection>
              <PPSection title="Intellectual Property"><Text style={styles.ppBody}>All content, features, and functionality of the e-TIR by MARAS application are the exclusive property of MARAS Logistics and are protected by applicable intellectual property laws.</Text></PPSection>
              <PPSection title="Governing Law"><Text style={styles.ppBody}>These Terms of Service shall be governed by and construed in accordance with the laws of the Republic of Iraq.</Text></PPSection>
              <PPSection title="Contact Us">
                <View style={styles.contactCard}>
                  <Text style={styles.contactTitle}>MARAS Logistics &amp; Supply Chain</Text>
                  {[{ icon: 'language' as const, label: 'Website', value: 'www.maras.iq' }, { icon: 'email' as const, label: 'Email', value: 'info@maras.iq' }].map(row => (
                    <View key={row.label} style={styles.contactRow}>
                      <MaterialIcons name={row.icon} size={13} color={Colors.primary} />
                      <Text style={styles.contactLabel}>{row.label}</Text>
                      <Text style={styles.contactValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              </PPSection>
              <View style={styles.ackBox}>
                <MaterialIcons name="gavel" size={15} color={Colors.primary} />
                <Text style={styles.ackText}>By using e-TIR by MARAS, you acknowledge that you have read and agree to be bound by these Terms of Service.</Text>
              </View>
              <View style={{ height: 24 }} />
            </View>
          </ScrollView>
          <View style={styles.sheetFooter}>
            <Pressable style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]} onPress={() => setShowToS(false)}>
              <Text style={styles.submitLabel}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ─── Privacy Policy Modal ─── */}
      <Modal visible={showPrivacy} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPrivacy(false)}>
        <View style={styles.sheetRoot}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderLeft}>
              <View style={styles.sheetHeaderIcon}><MaterialIcons name="privacy-tip" size={18} color={Colors.primary} /></View>
              <View>
                <Text style={styles.sheetTitle}>Privacy Policy</Text>
                <Text style={styles.sheetSub}>e-TIR by MARAS · June 2026</Text>
              </View>
            </View>
            <Pressable style={styles.sheetCloseBtn} onPress={() => setShowPrivacy(false)}>
              <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetContent}>
              <PPSection title="Introduction"><Text style={styles.ppBody}>MARAS Logistics respects your privacy and is committed to protecting your personal information. This Privacy Policy explains how we collect, use, store, and protect information when you use the e-TIR by MARAS application.</Text></PPSection>
              <PPSection title="Information We Collect">
                <Text style={styles.ppBody}>The application may collect the following information:</Text>
                {['Full name, phone number, and email address', 'Driver and vehicle information', 'Shipment information', 'GPS location data during active shipments', 'Photos and uploaded documents', 'Communication records between drivers and administrators'].map(item => <PPItem key={item} text={item} />)}
              </PPSection>
              <PPSection title="How We Use Your Information">
                <Text style={styles.ppBody}>We use collected information to:</Text>
                {['Manage logistics operations and create shipments', 'Track shipment progress in real-time', 'Facilitate driver-admin communication', 'Store shipment-related documents', 'Improve application performance and security', 'Comply with legal and regulatory requirements'].map(item => <PPItem key={item} text={item} />)}
              </PPSection>
              <PPSection title="Location Data"><Text style={styles.ppBody}>The application may access and collect location information only while shipment tracking is active. Location data is used exclusively for transportation monitoring, shipment visibility, and operational purposes.</Text></PPSection>
              <PPSection title="Information Sharing">
                <Text style={styles.ppBody}>MARAS does not sell, rent, or trade user information. Information may be shared only with:</Text>
                {['Authorized MARAS personnel', 'Assigned drivers', 'Customers receiving shipment updates', 'Government authorities when required by law'].map(item => <PPItem key={item} text={item} />)}
              </PPSection>
              <PPSection title="Data Security"><Text style={styles.ppBody}>We implement appropriate technical and organizational measures to protect personal information from unauthorized access, disclosure, alteration, or destruction.</Text></PPSection>
              <PPSection title="User Rights"><Text style={styles.ppBody}>Users may request access to, correction of, or deletion of their personal information by contacting MARAS.</Text></PPSection>
              <PPSection title="Contact Us">
                <View style={styles.contactCard}>
                  <Text style={styles.contactTitle}>MARAS Logistics &amp; Supply Chain</Text>
                  {[{ icon: 'language' as const, label: 'Website', value: 'www.maras.iq' }, { icon: 'email' as const, label: 'Email', value: 'info@maras.iq' }].map(row => (
                    <View key={row.label} style={styles.contactRow}>
                      <MaterialIcons name={row.icon} size={13} color={Colors.primary} />
                      <Text style={styles.contactLabel}>{row.label}</Text>
                      <Text style={styles.contactValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              </PPSection>
              <View style={styles.ackBox}>
                <MaterialIcons name="verified" size={15} color={Colors.primary} />
                <Text style={styles.ackText}>By using e-TIR by MARAS, you acknowledge and agree to this Privacy Policy.</Text>
              </View>
              <View style={{ height: 24 }} />
            </View>
          </ScrollView>
          <View style={styles.sheetFooter}>
            <Pressable style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]} onPress={() => setShowPrivacy(false)}>
              <Text style={styles.submitLabel}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Legal document helpers ─────────────────────────────────────────────────────
function PPSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={ppSec.titleRow}>
        <View style={ppSec.bar} />
        <Text style={ppSec.title}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function PPItem({ text }: { text: string }) {
  return (
    <View style={ppSec.item}>
      <View style={ppSec.bullet} />
      <Text style={ppSec.itemText}>{text}</Text>
    </View>
  );
}

const ppSec = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { width: 3, height: 15, borderRadius: 2, backgroundColor: Colors.primary },
  title: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 4 },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary, marginTop: 8, flexShrink: 0 },
  itemText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
});

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  gridOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  gridLine: {
    position: 'absolute', top: 0, bottom: 0,
    width: 1, backgroundColor: 'rgba(47,129,247,0.04)',
  },

  // ── Top bar ──────────────────────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface, zIndex: 1,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  brandIconBox: {
    width: 32, height: 32, borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  brandName: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary, letterSpacing: 0.3 },
  brandSub:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  topPillText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },

  // ── Scroll + layout ──────────────────────────────────────────────────────────
  scroll: { flexGrow: 1, zIndex: 1 },
  centerContent: {
    flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xxl, paddingBottom: Spacing.xl,
    gap: Spacing.lg,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },

  // ── Role tabs ─────────────────────────────────────────────────────────────────
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, position: 'relative',
  },
  tabBtnActive: { backgroundColor: Colors.surface },
  tabIconWrap: {
    width: 26, height: 26, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  tabIconWrapActive: { backgroundColor: Colors.primaryGlow },
  tabLabel: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textMuted },
  tabLabelActive: { color: Colors.primary },
  tabActiveBar: {
    position: 'absolute', bottom: 0, left: 12, right: 12,
    height: 2, backgroundColor: Colors.primary, borderRadius: 1,
  },

  // ── Form card ─────────────────────────────────────────────────────────────────
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  formCardAccent: { height: 3, width: '100%' },
  // kept for layout compatibility
  agreeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: Spacing.xl },
  agreeText: { fontSize: FontSize.xs, color: Colors.textMuted },
  agreeLink: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  chipRow: { flexDirection: 'row', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  chipActive: { backgroundColor: Colors.primaryGlow, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: Colors.primaryLight, fontWeight: '700' },
  formTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md,
  },
  formTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },

  // ── Fields ───────────────────────────────────────────────────────────────────
  fieldGroup: { gap: Spacing.xs, paddingHorizontal: Spacing.xl },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.3, textTransform: 'uppercase' },
  forgotLink: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  inputLeadIcon: { marginRight: Spacing.sm },
  input: { flex: 1, paddingVertical: 13, fontSize: FontSize.base, color: Colors.textPrimary },
  eyeBtn: { padding: Spacing.xs },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(248,81,73,0.2)',
    marginHorizontal: Spacing.xl,
  },
  errorText: { flex: 1, fontSize: FontSize.sm, color: Colors.danger },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 14, marginHorizontal: Spacing.xl,
  },
  submitLabel: { fontSize: FontSize.base, fontWeight: '700', color: '#fff' },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  orLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  orText: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '500' },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingVertical: 13, borderWidth: 1, borderColor: Colors.border,
    marginHorizontal: Spacing.xl,
  },
  googleIconCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  googleIconText: { fontSize: 13, fontWeight: '800', color: '#4285F4' },
  googleBtnText: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },

  pendingApprovalBox: {
    alignItems: 'center', gap: Spacing.lg,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl,
  },
  pendingApprovalIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.warningBg, borderWidth: 2, borderColor: `${Colors.warning}40`,
    alignItems: 'center', justifyContent: 'center',
  },
  pendingApprovalTitle: {
    fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center',
  },
  pendingApprovalDesc: {
    fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22,
  },
  pendingApprovalInfo: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, width: '100%',
  },
  pendingApprovalInfoText: {
    flex: 1, fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 18,
  },
  pendingApprovalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: 10, backgroundColor: Colors.card,
  },
  pendingApprovalBtnText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },

  registerDriverBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryGlow,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    marginHorizontal: Spacing.xl,
  },
  registerDriverIconWrap: {
    width: 38, height: 38, borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(47,129,247,0.15)',
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  registerDriverText: { flex: 1, gap: 2 },
  registerDriverTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  registerDriverSub: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 16 },

  // ── Bottom row: legal ───────────────────────────────────────────────────────
  bottomRow: { gap: Spacing.md },
  legalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  legalLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legalLinkText: { fontSize: FontSize.xs, color: Colors.textMuted },
  legalDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.textMuted },

  // Platform badge
  platformBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingBottom: Spacing.sm,
  },
  platformBadgeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.textMuted, opacity: 0.4 },
  platformBadgeText: { fontSize: 9, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },

  // ── Sheet (Modal) ─────────────────────────────────────────────────────────────
  sheetRoot: { flex: 1, backgroundColor: Colors.bg },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sheetHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  sheetHeaderIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  sheetSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  sheetCloseBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  sheetBody: { flex: 1, padding: Spacing.xl },
  sheetScroll: { flex: 1 },
  sheetContent: { padding: Spacing.xl, gap: Spacing.xl },
  sheetDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 21 },
  sheetFooter: {
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },

  fpSuccess: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, paddingVertical: Spacing.xxxl,
  },
  fpSuccessIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.successBg, borderWidth: 2, borderColor: `${Colors.success}40`,
    alignItems: 'center', justifyContent: 'center',
  },
  fpSuccessTitle: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  fpSuccessMsg: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 24, textAlign: 'center' },
  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: Colors.infoBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.info}25`,
  },
  infoNoteText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: 10,
  },
  outlineBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  backLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  backLinkText: { fontSize: FontSize.sm, color: Colors.textMuted },

  ppBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
  contactCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.lg, gap: Spacing.md,
  },
  contactTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  contactLabel: { fontSize: FontSize.sm, color: Colors.textMuted, width: 54 },
  contactValue: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500' },
  ackBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  ackText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
});
