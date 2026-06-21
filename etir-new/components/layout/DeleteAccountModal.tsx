import React, { useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { Colors, Spacing, FontSize, BorderRadius } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function DeleteAccountModal({ visible, onClose }: Props) {
  const { deleteAccount } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<'confirm' | 'final'>('confirm');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setStep('confirm');
    setError(null);
    onClose();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    const result = await deleteAccount();
    setIsDeleting(false);
    if (!result.success) {
      setError(result.error ?? 'Failed to delete account. Please try again.');
      return;
    }
    handleClose();
    router.replace('/');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <MaterialIcons name="warning-amber" size={28} color={Colors.danger ?? '#ef4444'} />
          </View>

          {step === 'confirm' ? (
            <>
              <Text style={styles.title}>Delete Account</Text>
              <Text style={styles.body}>
                This will permanently delete your account, including your profile, shipment history access,
                and all associated data. This action cannot be undone.
              </Text>
              <View style={styles.btnRow}>
                <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleClose}>
                  <Text style={styles.btnSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnDanger]} onPress={() => setStep('final')}>
                  <Text style={styles.btnDangerText}>Continue</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Are you absolutely sure?</Text>
              <Text style={styles.body}>
                Type confirmation below. Once deleted, your account and data cannot be recovered.
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.btnRow}>
                <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleClose} disabled={isDeleting}>
                  <Text style={styles.btnSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnDanger, isDeleting && { opacity: 0.6 }]}
                  onPress={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.btnDangerText}>Delete My Account</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  error: {
    fontSize: FontSize.xs,
    color: Colors.danger ?? '#ef4444',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  btn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondary: {
    backgroundColor: Colors.surface ?? '#1a2332',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnSecondaryText: {
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },
  btnDanger: {
    backgroundColor: Colors.danger ?? '#ef4444',
  },
  btnDangerText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: FontSize.sm,
  },
});
