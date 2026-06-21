import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLanguage } from '@/hooks/useLanguage';
import { Colors, FontSize, Spacing, BorderRadius } from '@/constants/theme';

interface Props {
  compact?: boolean; // show flag only
}

export function LanguagePicker({ compact = false }: Props) {
  const { language, setLanguage, languages, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [toastLang, setToastLang] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const showToast = (nativeLabel: string) => {
    setToastLang(nativeLabel);
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(toastAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start(() => setToastLang(null));
  };

  const current = languages.find(l => l.code === language)!;

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.trigger, compact && styles.triggerCompact, pressed && { opacity: 0.75 }]}
        onPress={() => setOpen(true)}
      >
        <MaterialIcons name="language" size={compact ? 18 : 15} color={Colors.textSecondary} />
        {!compact && (
          <>
            <Text style={styles.triggerText}>{current.nativeLabel}</Text>
            <MaterialIcons name="expand-more" size={14} color={Colors.textMuted} />
          </>
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
            <View style={styles.header}>
              <MaterialIcons name="language" size={18} color={Colors.primary} />
              <Text style={styles.headerTitle}>{t('nav.language')}</Text>
            </View>

            {languages.map((lang, i) => (
              <Pressable
                key={lang.code}
                style={({ pressed }) => [
                  styles.option,
                  i < languages.length - 1 && styles.optionBorder,
                  language === lang.code && styles.optionActive,
                  pressed && { backgroundColor: Colors.card },
                ]}
                onPress={async () => {
                  await setLanguage(lang.code);
                  setOpen(false);
                  if (lang.code !== language) showToast(lang.nativeLabel);
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.optionNative, language === lang.code && styles.optionNativeActive]}>
                    {lang.nativeLabel}
                  </Text>
                  <Text style={styles.optionEnglish}>{lang.label}</Text>
                </View>
                {lang.rtl && (
                  <View style={styles.rtlTag}>
                    <Text style={styles.rtlTagText}>RTL</Text>
                  </View>
                )}
                {language === lang.code && (
                  <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                )}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Language change toast */}
      {toastLang ? (
        <Animated.View
          style={[
            toastStyles.toast,
            {
              opacity: toastAnim,
              transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            },
          ]}
          pointerEvents="none"
        >
          <MaterialIcons name="check-circle" size={14} color={Colors.success} />
          <Text style={toastStyles.text}>{toastLang}</Text>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  triggerCompact: {
    width: 34, height: 34, borderRadius: 17,
    paddingHorizontal: 0, justifyContent: 'center',
  },
  triggerText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing.xl,
  },
  sheet: {
    width: '100%', maxWidth: 340,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
  },
  optionBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  optionActive: { backgroundColor: Colors.primaryGlow },
  optionNative: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  optionNativeActive: { color: Colors.primary },
  optionEnglish: { fontSize: FontSize.xs, color: Colors.textMuted },
  rtlTag: {
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.sm,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: Colors.warning,
  },
  rtlTagText: { fontSize: 9, color: Colors.warning, fontWeight: '700', letterSpacing: 0.5 },
});

const toastStyles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 44,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: `${Colors.success}40`,
    zIndex: 999,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  text: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '700' },
});
