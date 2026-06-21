import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useShipments } from '@/hooks/useShipments';
import { ShipmentDetail } from '@/components/feature/ShipmentDetail';
import { Colors, FontSize, Spacing } from '@/constants/theme';

export default function ShipmentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipments, updateStatus, assignDriver, updateETA } = useShipments();

  const shipment = shipments.find(s => s.id === id);

  if (!shipment) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.errorState}>
          <MaterialIcons name="error-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.errorTitle}>Shipment Not Found</Text>
          <Text style={styles.errorSub}>The shipment with ID "{id}" could not be located.</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <ShipmentDetail
        shipment={shipment}
        onClose={() => router.back()}
        onStatusChange={updateStatus}
        onDriverAssign={assignDriver}
        onETAChange={updateETA}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: Spacing.lg },
  errorTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  errorSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  backBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 24, paddingVertical: 12,
  },
  backBtnText: { color: '#fff', fontWeight: '600' },
});
