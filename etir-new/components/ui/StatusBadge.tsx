import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShipmentStatus } from '@/types';
import { Colors, FontSize, BorderRadius, Spacing } from '@/constants/theme';

interface Props {
  status: ShipmentStatus | string;
  size?: 'sm' | 'md';
}

function getStatusColors(status: string) {
  switch (status) {
    // ── Universal ────────────────────────────────────────
    case 'Loaded':
      return { bg: Colors.infoBg, text: '#79C0FF', dot: '#79C0FF' };
    case 'Dispatched':
      return { bg: 'rgba(210, 168, 255, 0.1)', text: '#D2A8FF', dot: '#D2A8FF' };
    case 'Customs Clearance':
      return { bg: Colors.warningBg, text: Colors.warning, dot: Colors.warning };
    case 'Customs Pending':
      return { bg: 'rgba(227, 179, 65, 0.12)', text: '#E3B341', dot: '#E3B341' };
    case 'Arrived':
      return { bg: Colors.successBg, text: Colors.success, dot: Colors.success };
    case 'Detained':
      return { bg: Colors.dangerBg, text: Colors.danger, dot: Colors.danger };
    // ── Road-specific ────────────────────────────────────
    case 'In Transit':
      return { bg: Colors.infoBg, text: Colors.info, dot: Colors.info };
    case 'Border Crossing':
      return { bg: 'rgba(210, 168, 255, 0.12)', text: '#D2A8FF', dot: '#D2A8FF' };
    // ── Sea-specific ─────────────────────────────────────
    case 'Booked':
      return { bg: 'rgba(56, 189, 248, 0.1)', text: '#38BDF8', dot: '#38BDF8' };
    case 'At Port of Loading':
      return { bg: 'rgba(99, 102, 241, 0.12)', text: '#818CF8', dot: '#818CF8' };
    case 'Vessel Departed':
      return { bg: 'rgba(14, 165, 233, 0.12)', text: '#0EA5E9', dot: '#0EA5E9' };
    case 'At Sea':
      return { bg: 'rgba(47, 129, 247, 0.12)', text: '#2F81F7', dot: '#2F81F7' };
    case 'At Port of Discharge':
      return { bg: 'rgba(99, 102, 241, 0.12)', text: '#818CF8', dot: '#818CF8' };
    case 'Port Customs':
      return { bg: Colors.warningBg, text: Colors.warning, dot: Colors.warning };
    // ── Air-specific ─────────────────────────────────────
    case 'Awaiting Flight':
      return { bg: 'rgba(125, 211, 252, 0.1)', text: '#7DD3FC', dot: '#7DD3FC' };
    case 'In Flight':
      return { bg: 'rgba(56, 189, 248, 0.12)', text: '#38BDF8', dot: '#38BDF8' };
    case 'Arrived at Hub':
      return { bg: 'rgba(52, 211, 153, 0.12)', text: '#34D399', dot: '#34D399' };
    default:
      return { bg: Colors.card, text: Colors.textSecondary, dot: Colors.textSecondary };
  }
}

export function StatusBadge({ status, size = 'md' }: Props) {
  const { bg, text, dot } = getStatusColors(status);
  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: bg }, isSmall && styles.badgeSm]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.text, { color: text }, isSmall && styles.textSm]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    gap: 6,
  },
  badgeSm: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  textSm: {
    fontSize: FontSize.xs,
  },
});
