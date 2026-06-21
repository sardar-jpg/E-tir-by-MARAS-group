import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Checkpoint } from '@/types';
import { Colors, FontSize, Spacing } from '@/constants/theme';

interface Props {
  checkpoints: Checkpoint[];
  compact?: boolean;
}

function getCheckpointStyle(status: Checkpoint['status']) {
  switch (status) {
    case 'Cleared':
      return { iconColor: Colors.success, circleColor: Colors.successBg, borderColor: Colors.success, lineColor: Colors.success };
    case 'Current':
      return { iconColor: Colors.primary, circleColor: Colors.primaryGlow, borderColor: Colors.primary, lineColor: Colors.border };
    case 'Pending':
      return { iconColor: Colors.warning, circleColor: Colors.warningBg, borderColor: Colors.warning, lineColor: Colors.border };
    case 'Upcoming':
    default:
      return { iconColor: Colors.textMuted, circleColor: Colors.surface, borderColor: Colors.border, lineColor: Colors.border };
  }
}

export function CheckpointProgress({ checkpoints, compact = false }: Props) {
  return (
    <View style={styles.container}>
      {checkpoints.map((cp, index) => {
        const style = getCheckpointStyle(cp.status);
        const isLast = index === checkpoints.length - 1;

        return (
          <View key={cp.id} style={styles.row}>
            <View style={styles.leftCol}>
              <View style={[styles.circle, { backgroundColor: style.circleColor, borderColor: style.borderColor }]}>
                {cp.status === 'Cleared' ? (
                  <MaterialIcons name="check" size={12} color={style.iconColor} />
                ) : cp.status === 'Current' ? (
                  <View style={[styles.innerDot, { backgroundColor: style.iconColor }]} />
                ) : (
                  <View style={[styles.innerDot, { backgroundColor: style.iconColor, opacity: 0.4 }]} />
                )}
              </View>
              {!isLast && (
                <View style={[styles.line, { backgroundColor: style.lineColor }]} />
              )}
            </View>
            <View style={[styles.content, compact && styles.contentCompact]}>
              <Text style={[styles.name, cp.status === 'Current' && styles.nameCurrent, cp.status === 'Upcoming' && styles.nameUpcoming]}>
                {cp.name}
              </Text>
              <Text style={styles.location}>{cp.location}</Text>
              {cp.timestamp && !compact && (
                <Text style={styles.timestamp}>{cp.timestamp}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.md },
  leftCol: { alignItems: 'center', width: 24 },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDot: { width: 6, height: 6, borderRadius: 3 },
  line: { width: 1.5, flex: 1, minHeight: 16, marginTop: 2 },
  content: { flex: 1, paddingBottom: Spacing.lg },
  contentCompact: { paddingBottom: Spacing.sm },
  name: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  nameCurrent: { color: Colors.primary },
  nameUpcoming: { color: Colors.textSecondary },
  location: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  timestamp: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, fontFamily: 'monospace' },
});
