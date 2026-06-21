import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Shipment, ShipmentStatus } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

interface Props {
  shipment: Shipment;
  onPress?: (s: Shipment) => void;
  compact?: boolean;
  selected?: boolean;
}

// Status → left-border accent color
const STATUS_ACCENT: Record<ShipmentStatus, string> = {
  // Road
  Loaded:                   Colors.info,
  Dispatched:               '#D2A8FF',
  'In Transit':             Colors.primary,
  'Border Crossing':        '#D2A8FF',
  'Customs Clearance':      Colors.warning,
  'Customs Pending':        Colors.warning,
  Arrived:                  Colors.success,
  Detained:                 Colors.danger,
  // Sea
  Booked:                   '#38BDF8',
  'At Port of Loading':     '#818CF8',
  'Vessel Departed':        '#0EA5E9',
  'At Sea':                 Colors.primary,
  'At Port of Discharge':   '#818CF8',
  'Port Customs':           Colors.warning,
  // Air
  'Awaiting Flight':        '#7DD3FC',
  'In Flight':              '#38BDF8',
  'Arrived at Hub':         '#34D399',
};

// Progress bar color: changes based on completion
function progressColor(ratio: number): string {
  if (ratio >= 1)   return Colors.success;
  if (ratio >= 0.6) return Colors.primary;
  if (ratio >= 0.3) return Colors.warning;
  return Colors.textMuted;
}

export function ShipmentCard({ shipment, onPress, compact = false, selected = false }: Props) {
  const checkpoints = shipment.checkpoints ?? [];
  const total      = checkpoints.length;
  const cleared    = checkpoints.filter(c => c.status === 'Cleared').length;
  const ratio      = total > 0 ? cleared / total : 0;
  const pct        = Math.round(ratio * 100);
  const accentColor = STATUS_ACCENT[shipment.status] ?? Colors.primary;
  const barColor    = progressColor(ratio);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && styles.pressed,
      ]}
      onPress={() => onPress?.(shipment)}
      accessibilityRole="button"
      accessibilityLabel={`Shipment ${shipment.tirNumber}`}
    >
      {/* ── Colored left-border accent ── */}
      <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

      <View style={styles.inner}>
        {/* ── Top row: TIR + status badge ── */}
        <View style={styles.topRow}>
          <View style={styles.tirChip}>
            <MaterialIcons name="confirmation-number" size={11} color={Colors.textMuted} />
            <Text style={styles.tirNumber} numberOfLines={1}>{shipment.tirNumber}</Text>
          </View>
          <StatusBadge status={shipment.status} size="sm" />
        </View>

        {/* ── Horizontal route line ── */}
        <View style={styles.routeWrap}>
          {/* Origin */}
          <View style={styles.routeEndpoint}>
            <View style={[styles.routeDot, { backgroundColor: Colors.primary, borderColor: `${Colors.primary}40` }]} />
            <Text style={styles.routeCity} numberOfLines={1}>{shipment.origin}</Text>
          </View>

          {/* Dashed line with truck */}
          <View style={styles.routeMid}>
            <View style={[styles.routeDash, { backgroundColor: `${accentColor}30` }]} />
            <View style={[styles.truckIconWrap, { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}35` }]}>
              <MaterialIcons
                name={shipment.shipmentType === 'Air' ? 'flight' : shipment.shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping'}
                size={11}
                color={accentColor}
              />
            </View>
            <View style={[styles.routeDash, { backgroundColor: `${accentColor}30` }]} />
          </View>

          {/* Destination */}
          <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
            <Text style={[styles.routeCity, styles.routeCityRight]} numberOfLines={1}>{shipment.destination}</Text>
            <View style={[styles.routeDot, { backgroundColor: Colors.success, borderColor: `${Colors.success}40` }]} />
          </View>
        </View>

        {/* ── Mini checkpoint progress bar ── */}
        <View style={styles.progressSection}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: barColor }]} />
            {/* Checkpoint ticks — rendered at fixed intervals using flex */}
          </View>
          <View style={styles.progressMeta}>
            <Text style={styles.progressLabel}>
              <Text style={{ color: barColor, fontWeight: '600' }}>{cleared}</Text>
              <Text style={styles.progressSlash}>/{total}</Text>
              {' checkpoints'}
            </Text>
            <Text style={[styles.progressPct, { color: barColor }]}>{pct}%</Text>
          </View>
        </View>

        {/* ── Footer meta ── */}
        {!compact && (
          <View style={styles.footer}>
            <View style={styles.metaItem}>
              <MaterialIcons name="person" size={11} color={Colors.textMuted} />
              <Text style={styles.metaText} numberOfLines={1}>{shipment.driverName}</Text>
            </View>

            {/* Fleet badge — shown when multi-truck road order */}
            {(shipment.shipmentType === 'Road' || !shipment.shipmentType) &&
             shipment.additionalDrivers && shipment.additionalDrivers.length > 0 ? (
              <View style={styles.fleetBadge}>
                <MaterialIcons name="local-shipping" size={10} color={Colors.primary} />
                <Text style={styles.fleetBadgeText}>
                  {shipment.additionalDrivers.length + 1} trucks
                </Text>
              </View>
            ) : null}

            <View style={styles.metaDivider} />

            <View style={styles.metaItem}>
              <MaterialIcons name="pin" size={11} color={Colors.textMuted} />
              <Text style={styles.metaText}>{shipment.plateNumber}</Text>
            </View>

            <View style={styles.metaDivider} />

            <View style={styles.metaItem}>
              <MaterialIcons
                name={shipment.shipmentType === 'Sea' ? 'directions-boat' : 'schedule'}
                size={11}
                color={shipment.shipmentType === 'Sea' ? Colors.primary : Colors.textMuted}
              />
              <Text style={[styles.metaText, shipment.shipmentType === 'Sea' && { color: Colors.primary, fontWeight: '600' }]}>
                {shipment.shipmentType === 'Sea' ? `Port ETA: ${shipment.estimatedArrival}` : shipment.estimatedArrival}
              </Text>
            </View>

            {/* Agreed price badge — right-aligned */}
            {shipment.agreedPrice ? (
              <View style={[
                styles.priceBadge,
                shipment.priceAccepted ? styles.priceBadgeAccepted : styles.priceBadgePending,
              ]}>
                <MaterialIcons
                  name={shipment.priceAccepted ? 'verified' : 'handshake'}
                  size={10}
                  color={shipment.priceAccepted ? Colors.success : Colors.warning}
                />
                <Text style={[
                  styles.priceBadgeText,
                  { color: shipment.priceAccepted ? Colors.success : Colors.warning },
                ]}>
                  {shipment.agreedPrice}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    overflow: 'hidden',
    ...Shadow.card,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.cardHover,
  },
  pressed: { opacity: 0.82 },

  // Left accent stripe
  accentBar: {
    width: 3,
    borderTopLeftRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.lg,
  },

  inner: {
    flex: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },

  // Top row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  tirChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  tirNumber: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    letterSpacing: 0.4,
    flex: 1,
  },

  // Horizontal route line
  routeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  routeEndpoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  routeEndpointRight: {
    justifyContent: 'flex-end',
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    flexShrink: 0,
  },
  routeCity: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
    flex: 1,
  },
  routeCityRight: {
    textAlign: 'right',
  },
  routeMid: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 4,
  },
  routeDash: {
    flex: 1,
    height: 1.5,
    borderRadius: 1,
  },
  truckIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
  },

  // Progress bar
  progressSection: {
    gap: 5,
  },
  progressTrack: {
    height: 5,
    backgroundColor: Colors.surface,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 5,
    borderRadius: 3,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  progressTick: {
    position: 'absolute',
    top: -1,
    width: 1,
    height: 7,
    backgroundColor: Colors.bg,
    transform: [{ translateX: -0.5 }],
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  progressSlash: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  progressPct: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    maxWidth: 90,
  },
  metaDivider: {
    width: 1,
    height: 10,
    backgroundColor: Colors.borderSubtle,
  },

  // Fleet badge
  fleetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    backgroundColor: Colors.primaryGlow,
    borderColor: 'rgba(47,129,247,0.3)',
  },
  fleetBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },

  // Agreed price badge
  priceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    marginLeft: 'auto',
  },
  priceBadgeAccepted: {
    backgroundColor: Colors.successBg,
    borderColor: `${Colors.success}40`,
  },
  priceBadgePending: {
    backgroundColor: Colors.warningBg,
    borderColor: `${Colors.warning}40`,
  },
  priceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
