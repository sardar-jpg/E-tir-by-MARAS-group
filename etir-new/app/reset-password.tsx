import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/services/supabaseClient';
import { useLanguage } from '@/hooks/useLanguage';
import { Colors, FontSize, Spacing, BorderRadius } from '@/constants/theme';

type Stage = 'checking' | 'form' | 'success' | 'invalid';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Listen for the PASSWORD_RECOVERY session from the email link
  useEffect(() => {
    let resolved = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        resolved = true;
        setStage('form');
      }
    });

    const timer = setTimeout(async () => {
      if (resolved) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setStage('form');
      } else {
        setStage('invalid');
      }
    }, 2000);

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const handleReset = async () => {
    setError('');
    if (!password.trim()) { setError(t('resetPassword.errorEnterPassword')); return; }
    if (password.length < 6) { setError(t('resetPassword.errorMinLength')); return; }
    if (password !== confirm) { setError(t('resetPassword.errorNoMatch')); return; }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setStage('success');
    await supabase.auth.signOut();
  };

  const goToLogin = () => {
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {/* Decorative grid */}
      <View style={styles.gridOverlay} pointerEvents="none">
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[styles.gridLine, { left: `${i * 33}%` as any }]} />
        ))}
      </View>

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={goToLogin} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={18} color={Colors.textSecondary} />
        </Pressable>
        <View style={styles.topBarCenter}>
          <View style={styles.topBarIcon}>
            <MaterialIcons name="lock-reset" size={14} color={Colors.primary} />
          </View>
          <Text style={styles.topBarTitle}>{t('resetPassword.pageTitle')}</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Checking stage ── */}
          {stage === 'checking' && (
            <View style={styles.centerContent}>
              <ActivityIndicator color={Colors.primary} size="large" />
              <Text style={styles.checkingText}>{t('resetPassword.verifying')}</Text>
            </View>
          )}

          {/* ── Invalid / expired ── */}
          {stage === 'invalid' && (
            <View style={styles.centerContent}>
              <View style={styles.invalidIcon}>
                <MaterialIcons name="link-off" size={36} color={Colors.danger} />
              </View>
              <Text style={styles.stateTitle}>{t('resetPassword.invalidTitle')}</Text>
              <Text style={styles.stateDesc}>{t('resetPassword.invalidDesc')}</Text>
              <Pressable
                style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]}
                onPress={goToLogin}
              >
                <MaterialIcons name="arrow-back" size={16} color="#fff" />
                <Text style={styles.submitLabel}>{t('resetPassword.backToSignIn')}</Text>
              </Pressable>
            </View>
          )}

          {/* ── Success ── */}
          {stage === 'success' && (
            <View style={styles.centerContent}>
              <View style={styles.successIcon}>
                <MaterialIcons name="check-circle" size={40} color={Colors.success} />
              </View>
              <Text style={styles.stateTitle}>{t('resetPassword.successTitle')}</Text>
              <Text style={styles.stateDesc}>{t('resetPassword.successDesc')}</Text>
              <Pressable
                style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]}
                onPress={goToLogin}
              >
                <MaterialIcons name="login" size={16} color="#fff" />
                <Text style={styles.submitLabel}>{t('resetPassword.signInNow')}</Text>
              </Pressable>
            </View>
          )}

          {/* ── Form ── */}
          {stage === 'form' && (
            <View style={styles.formContent}>
              {/* Hero */}
              <View style={styles.hero}>
                <View style={styles.heroIcon}>
                  <MaterialIcons name="lock-reset" size={32} color={Colors.primary} />
                </View>
                <View style={styles.heroBadge}>
                  <View style={styles.heroBadgeDot} />
                  <Text style={styles.heroBadgeText}>{t('resetPassword.heroBadge')}</Text>
                </View>
                <Text style={styles.heroTitle}>{t('resetPassword.heroTitle')}</Text>
                <Text style={styles.heroDesc}>{t('resetPassword.heroDesc')}</Text>
              </View>

              {/* Card */}
              <View style={styles.formCard}>
                {/* New password */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t('resetPassword.newPasswordLabel')}</Text>
                  <View style={styles.inputRow}>
                    <MaterialIcons name="lock-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={password}
                      onChangeText={setPassword}
                      placeholder={t('resetPassword.newPasswordPlaceholder')}
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry={!showPw}
                      returnKeyType="next"
                    />
                    <Pressable onPress={() => setShowPw(v => !v)} hitSlop={8}>
                      <MaterialIcons
                        name={showPw ? 'visibility' : 'visibility-off'}
                        size={16}
                        color={Colors.textMuted}
                      />
                    </Pressable>
                  </View>
                </View>

                {/* Confirm password */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t('resetPassword.confirmLabel')}</Text>
                  <View style={styles.inputRow}>
                    <MaterialIcons name="lock-outline" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={confirm}
                      onChangeText={setConfirm}
                      placeholder={t('resetPassword.confirmPlaceholder')}
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry={!showConfirm}
                      returnKeyType="done"
                      onSubmitEditing={handleReset}
                    />
                    <Pressable onPress={() => setShowConfirm(v => !v)} hitSlop={8}>
                      <MaterialIcons
                        name={showConfirm ? 'visibility' : 'visibility-off'}
                        size={16}
                        color={Colors.textMuted}
                      />
                    </Pressable>
                  </View>
                </View>

                {/* Password strength hints */}
                <View style={styles.strengthHints}>
                  {[
                    { check: password.length >= 6,   label: t('resetPassword.hint6chars') },
                    { check: /[A-Z]/.test(password),  label: t('resetPassword.hintUppercase') },
                    { check: /[0-9]/.test(password),  label: t('resetPassword.hintNumber') },
                  ].map(hint => (
                    <View key={hint.label} style={styles.hintRow}>
                      <MaterialIcons
                        name={hint.check ? 'check-circle' : 'radio-button-unchecked'}
                        size={12}
                        color={hint.check ? Colors.success : Colors.textMuted}
                      />
                      <Text style={[styles.hintText, hint.check && styles.hintTextMet]}>
                        {hint.label}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Error */}
                {error ? (
                  <View style={styles.errorBox}>
                    <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Submit */}
                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && { opacity: 0.88 },
                    (loading || password.length < 6) && { opacity: 0.6 },
                  ]}
                  onPress={handleReset}
                  disabled={loading || password.length < 6}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="lock-reset" size={16} color="#fff" />
                      <Text style={styles.submitLabel}>{t('resetPassword.updateBtn')}</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {/* Back link */}
              <Pressable style={styles.backLink} onPress={goToLogin} hitSlop={8}>
                <MaterialIcons name="arrow-back" size={13} color={Colors.textMuted} />
                <Text style={styles.backLinkText}>{t('resetPassword.backToSignIn')}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  gridOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(47,129,247,0.04)' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface, zIndex: 1,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  topBarCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topBarIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  topBarTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },

  scroll: { flexGrow: 1, zIndex: 1 },

  centerContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: Spacing.xl, gap: Spacing.xl, minHeight: 400,
  },
  checkingText: { fontSize: FontSize.sm, color: Colors.textMuted },

  invalidIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.dangerBg, borderWidth: 2, borderColor: `${Colors.danger}35`,
    alignItems: 'center', justifyContent: 'center',
  },
  successIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.successBg, borderWidth: 2, borderColor: `${Colors.success}35`,
    alignItems: 'center', justifyContent: 'center',
  },
  stateTitle: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  stateDesc: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    lineHeight: 22, textAlign: 'center', maxWidth: 300,
  },

  formContent: {
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xxxl, paddingBottom: Spacing.xl,
    gap: Spacing.xl,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },

  hero: { alignItems: 'center', gap: Spacing.md },
  heroIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  heroBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.success },
  heroBadgeText: { fontSize: 10, color: Colors.primary, fontWeight: '700', letterSpacing: 0.8 },
  heroTitle: { fontSize: FontSize.xxxl, fontWeight: '700', color: Colors.textPrimary },
  heroDesc: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    lineHeight: 21, textAlign: 'center',
  },

  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  fieldGroup: { gap: Spacing.xs },
  fieldLabel: {
    fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary,
    letterSpacing: 0.3, textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  inputIcon: { marginRight: Spacing.sm },
  input: { flex: 1, paddingVertical: 13, fontSize: FontSize.base, color: Colors.textPrimary },

  strengthHints: { gap: 6 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hintText: { fontSize: FontSize.xs, color: Colors.textMuted },
  hintTextMet: { color: Colors.success },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(248,81,73,0.2)',
  },
  errorText: { flex: 1, fontSize: FontSize.sm, color: Colors.danger },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 14,
  },
  submitLabel: { fontSize: FontSize.base, fontWeight: '700', color: '#fff' },

  backLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  backLinkText: { fontSize: FontSize.xs, color: Colors.textMuted },
});
