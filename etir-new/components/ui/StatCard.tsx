import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

interface Props {
  label: string;
  value: string | number;
  icon: keyof typeof MaterialIcons.glyphMap;
  accentColor: string;
  subtitle?: string;
  onPress?: () => void;
}

export function StatCard({ label, value, icon, accentColor, subtitle, onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, Shadow.card, pressed && { opacity: 0.88 }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={[styles.accentLine, { backgroundColor: accentColor }]} />
      <View style={styles.inner}>
        <View style={[styles.iconWrap, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}30` }]}>
          <MaterialIcons name={icon} size={18} color={accentColor} />
        </View>
        <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
        <Text style={styles.label}>{label}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: accentColor }]}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    minWidth: 130,
  },
  accentLine: { height: 3, width: '100%' },
  inner: {
    padding: Spacing.lg,
    gap: 4,
  },
  iconWrap: {
    width: 36, height: 36,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  value: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  label: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  subtitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    marginTop: 1,
  },
});
