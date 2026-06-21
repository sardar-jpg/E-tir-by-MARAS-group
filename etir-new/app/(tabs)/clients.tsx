import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useClients } from '@/hooks/useClients';
import { useShipments } from '@/hooks/useShipments';
import { useAlert } from '@/template';
import { Client } from '@/types';
import { CreateClientInput } from '@/services/clientService';
import { supabase } from '@/services/supabaseClient';
import { useLanguage } from '@/hooks/useLanguage';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

// ── Client Form Modal ──────────────────────────────────────────────────────────
interface ClientFormProps {
  visible: boolean;
  editing: Client | null;
  onClose: () => void;
}

function ClientFormModal({ visible, editing, onClose }: ClientFormProps) {
  const { addClient, editClient, refresh } = useClients();
  const { showAlert } = useAlert();
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible && editing) {
      setName(editing.name);
      setCompany(editing.company ?? '');
      setEmail(editing.email ?? '');
      setPhone(editing.phone ?? '');
      setCountry(editing.country ?? '');
      setCity(editing.city ?? '');
      setNotes(editing.notes ?? '');
    } else if (visible && !editing) {
      setName(''); setCompany(''); setEmail('');
      setPhone(''); setCountry(''); setCity(''); setNotes('');
    }
  }, [visible, editing]);

  const handleSave = async () => {
    if (!name.trim()) { showAlert('Client Name is required.'); return; }
    setSaving(true);
    const input: CreateClientInput = { name, company, email, phone, country, city, notes };
    if (editing) {
      const err = await editClient(editing.id, input);
      if (err) showAlert('Error', err);
      else { onClose(); }
    } else {
      const { error } = await addClient(input);
      if (error) {
        showAlert('Failed to Add Client', error);
      } else {
        await refresh();
        onClose();
      }
    }
    setSaving(false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={formStyles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={formStyles.header}>
          <View style={formStyles.headerLeft}>
            <View style={formStyles.headerIcon}>
              <MaterialIcons name="business" size={18} color={Colors.primary} />
            </View>
            <View>
              <Text style={formStyles.headerTitle}>{editing ? t('clients.editClient') : t('clients.newClientTitle')}</Text>
              <Text style={formStyles.headerSub}>{editing ? t('clients.updateDetails') : t('clients.addDirectory')}</Text>
            </View>
          </View>
          <Pressable style={formStyles.closeBtn} onPress={onClose}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={formStyles.form}>
            <FormSection icon="person" title="Contact Information" />
            <FF label="Client Name *" value={name} onChange={setName} placeholder="Full name of contact" icon="person" />
            <FF label="Company / Organization" value={company} onChange={setCompany} placeholder="Business or company name" icon="business" />

            <FormSection icon="contact-phone" title="Communication" />
            <FF label="Email Address" value={email} onChange={setEmail} placeholder="email@example.com" icon="email" keyboard="email-address" />
            <FF label="Phone Number" value={phone} onChange={setPhone} placeholder="+1 555 000 0000" icon="phone" keyboard="phone-pad" />

            <FormSection icon="place" title="Location" />
            <View style={formStyles.twoCol}>
              <View style={{ flex: 1 }}>
                <FF label="Country" value={country} onChange={setCountry} placeholder="e.g. Iraq" icon="flag" />
              </View>
              <View style={{ flex: 1 }}>
                <FF label="City" value={city} onChange={setCity} placeholder="e.g. Baghdad" icon="location-city" />
              </View>
            </View>

            <FormSection icon="notes" title="Notes" />
            <View style={formStyles.notesWrap}>
              <View style={formStyles.notesRow}>
                <MaterialIcons name="notes" size={14} color={Colors.textMuted} style={{ marginTop: 2 }} />
                <TextInput
                  style={formStyles.notesInput}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Any internal notes about this client..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </View>
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>

        <View style={formStyles.footer}>
          <Pressable style={formStyles.cancelBtn} onPress={onClose}>
            <Text style={formStyles.cancelText}>{t('detail.cancel')}</Text>
          </Pressable>
          <Pressable style={[formStyles.saveBtn, saving && { opacity: 0.65 }]} onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name={editing ? 'save' : 'person-add'} size={16} color="#fff" />
                <Text style={formStyles.saveBtnText}>{editing ? t('clients.saveChanges') : t('clients.addClient')}</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FormSection({ icon, title }: { icon: keyof typeof MaterialIcons.glyphMap; title: string }) {
  return (
    <View style={formStyles.sectionRow}>
      <View style={formStyles.sectionIcon}>
        <MaterialIcons name={icon} size={12} color={Colors.primary} />
      </View>
      <Text style={formStyles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={formStyles.sectionLine} />
    </View>
  );
}

function FF({
  label, value, onChange, placeholder, icon, keyboard,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; icon: keyof typeof MaterialIcons.glyphMap;
  keyboard?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
}) {
  return (
    <View style={formStyles.ffWrap}>
      <Text style={formStyles.ffLabel}>{label}</Text>
      <View style={formStyles.ffRow}>
        <MaterialIcons name={icon} size={14} color={Colors.textMuted} />
        <TextInput
          style={formStyles.ffInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          keyboardType={keyboard ?? 'default'}
          autoCapitalize="words"
        />
        {value ? (
          <Pressable onPress={() => onChange('')} hitSlop={8}>
            <MaterialIcons name="close" size={13} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const formStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  form: { padding: Spacing.xl, gap: Spacing.lg },
  twoCol: { flexDirection: 'row', gap: Spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  sectionIcon: {
    width: 22, height: 22, borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primaryGlow, alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 1 },
  sectionLine: { flex: 1, height: 1, backgroundColor: Colors.borderSubtle },
  ffWrap: { gap: 5 },
  ffLabel: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  ffRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, minHeight: 44,
  },
  ffInput: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary, paddingVertical: 10 },
  notesWrap: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  notesRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  notesInput: {
    flex: 1, fontSize: FontSize.base, color: Colors.textPrimary,
    minHeight: 72, lineHeight: 22,
  },
  footer: {
    flexDirection: 'row', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  cancelBtn: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 13, alignItems: 'center',
  },
  cancelText: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  saveBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '600' },
});

// ── Link Account Modal ───────────────────────────────────────────────────────
interface LinkAccountModalProps {
  visible: boolean;
  client: Client | null;
  onClose: () => void;
  onLinked: () => void;
}

function LinkAccountModal({ visible, client, onClose, onLinked }: LinkAccountModalProps) {
  const { showAlert } = useAlert();
  const { editClient } = useClients();
  const [linkEmail, setLinkEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [lookupResult, setLookupResult] = useState<'idle' | 'found' | 'not-found'>('idle');
  const [lookupLoading, setLookupLoading] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setLinkEmail('');
      setLookupResult('idle');
      setSaving(false);
      setUnlinking(false);
    }
  }, [visible, client?.id]);

  const isLinked = !!(client as any)?.customerUserId;

  const handleLookup = async () => {
    if (!linkEmail.trim()) return;
    setLookupLoading(true);
    setLookupResult('idle');
    const { data } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', linkEmail.trim().toLowerCase())
      .maybeSingle();
    setLookupLoading(false);
    setLookupResult(data ? 'found' : 'not-found');
  };

  const handleLink = async () => {
    if (!client || !linkEmail.trim()) return;
    setSaving(true);
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('email', linkEmail.trim().toLowerCase())
      .maybeSingle();
    if (!profile) {
      setSaving(false);
      showAlert('User Not Found', 'No registered account was found with this email address.');
      return;
    }
    const error = await editClient(client.id, { customerUserId: profile.id });
    setSaving(false);
    if (error) {
      showAlert('Error', error);
    } else {
      showAlert('Account Linked', `${client.name} is now linked to ${linkEmail.trim()}.`);
      onLinked();
      onClose();
    }
  };

  const handleUnlink = async () => {
    if (!client) return;
    showAlert(
      'Unlink Account?',
      `This will remove the customer portal access for ${client.name}. The client record will remain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink', style: 'destructive',
          onPress: async () => {
            setUnlinking(true);
            const error = await editClient(client.id, { customerUserId: null });
            setUnlinking(false);
            if (error) showAlert('Error', error);
            else { onLinked(); onClose(); }
          },
        },
      ]
    );
  };

  if (!client) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={linkStyles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={linkStyles.header}>
          <View style={linkStyles.headerLeft}>
            <View style={linkStyles.headerIcon}>
              <MaterialIcons name="link" size={18} color={Colors.primary} />
            </View>
            <View>
              <Text style={linkStyles.headerTitle}>Link Customer Account</Text>
              <Text style={linkStyles.headerSub} numberOfLines={1}>{client.name}</Text>
            </View>
          </View>
          <Pressable style={linkStyles.closeBtn} onPress={onClose}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={linkStyles.body}>
            {isLinked ? (
              <View style={linkStyles.linkedBanner}>
                <View style={linkStyles.linkedBannerIcon}>
                  <MaterialIcons name="verified-user" size={22} color={Colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={linkStyles.linkedBannerTitle}>Account Linked</Text>
                  <Text style={linkStyles.linkedBannerSub}>This client has an active customer portal account.</Text>
                </View>
                <View style={[linkStyles.linkedDot, { backgroundColor: Colors.success }]} />
              </View>
            ) : (
              <View style={linkStyles.unlinkedBanner}>
                <View style={linkStyles.unlinkedBannerIcon}>
                  <MaterialIcons name="link-off" size={22} color={Colors.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={linkStyles.unlinkedBannerTitle}>No Portal Account</Text>
                  <Text style={linkStyles.unlinkedBannerSub}>Link an email to grant this client access to the customer portal.</Text>
                </View>
              </View>
            )}

            <View style={linkStyles.howItWorks}>
              <View style={linkStyles.howHeader}>
                <View style={linkStyles.howHeaderIcon}>
                  <MaterialIcons name="info-outline" size={12} color={Colors.primary} />
                </View>
                <Text style={linkStyles.howHeaderText}>HOW IT WORKS</Text>
              </View>
              <View style={linkStyles.howSteps}>
                {[
                  { icon: 'person-add' as const, text: 'The client registers at the Customer Portal using this email' },
                  { icon: 'verified-user' as const, text: 'After linking, they can view all shipments assigned to this account' },
                  { icon: 'notifications' as const, text: 'They receive real-time status change notifications' },
                ].map((step, i) => (
                  <View key={i} style={linkStyles.howStep}>
                    <View style={linkStyles.howStepIcon}>
                      <MaterialIcons name={step.icon} size={12} color={Colors.primary} />
                    </View>
                    <Text style={linkStyles.howStepText}>{step.text}</Text>
                  </View>
                ))}
              </View>
            </View>

            {!isLinked && (
              <View style={linkStyles.section}>
                <Text style={linkStyles.sectionTitle}>ENTER CUSTOMER EMAIL</Text>
                <View style={linkStyles.emailInputRow}>
                  <View style={linkStyles.emailInput}>
                    <MaterialIcons name="alternate-email" size={15} color={Colors.textMuted} />
                    <TextInput
                      style={linkStyles.emailTextInput}
                      value={linkEmail}
                      onChangeText={v => { setLinkEmail(v); setLookupResult('idle'); }}
                      placeholder="customer@example.com"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      returnKeyType="search"
                      onSubmitEditing={handleLookup}
                    />
                    {linkEmail ? (
                      <Pressable onPress={() => { setLinkEmail(''); setLookupResult('idle'); }} hitSlop={8}>
                        <MaterialIcons name="close" size={13} color={Colors.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                  <Pressable
                    style={[linkStyles.lookupBtn, (!linkEmail.trim() || lookupLoading) && { opacity: 0.5 }]}
                    onPress={handleLookup}
                    disabled={!linkEmail.trim() || lookupLoading}
                  >
                    {lookupLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={linkStyles.lookupBtnText}>Check</Text>}
                  </Pressable>
                </View>
                {lookupResult === 'found' && (
                  <View style={linkStyles.lookupFound}>
                    <MaterialIcons name="check-circle" size={14} color={Colors.success} />
                    <Text style={linkStyles.lookupFoundText}>Account found — ready to link</Text>
                  </View>
                )}
                {lookupResult === 'not-found' && (
                  <View style={linkStyles.lookupNotFound}>
                    <MaterialIcons name="info-outline" size={14} color={Colors.warning} />
                    <Text style={linkStyles.lookupNotFoundText}>
                      No registered account found. The client must register at the Customer Portal first, then you can link them here.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {isLinked && (
              <View style={linkStyles.section}>
                <Text style={linkStyles.sectionTitle}>MANAGE ACCESS</Text>
                <View style={linkStyles.unlinkCard}>
                  <MaterialIcons name="warning-amber" size={16} color={Colors.warning} />
                  <Text style={linkStyles.unlinkCardText}>
                    Unlinking will immediately revoke this client's access to the customer portal. Their shipment data remains unchanged.
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [linkStyles.unlinkBtn, (pressed || unlinking) && { opacity: 0.8 }]}
                  onPress={handleUnlink}
                  disabled={unlinking}
                >
                  {unlinking
                    ? <ActivityIndicator size="small" color={Colors.danger} />
                    : (
                      <>
                        <MaterialIcons name="link-off" size={15} color={Colors.danger} />
                        <Text style={linkStyles.unlinkBtnText}>Unlink Account</Text>
                      </>
                    )}
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>

        {!isLinked && (
          <View style={linkStyles.footer}>
            <Pressable style={linkStyles.cancelBtn} onPress={onClose}>
              <Text style={linkStyles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[linkStyles.linkBtn, (saving || !linkEmail.trim() || lookupResult !== 'found') && { opacity: 0.5 }]}
              onPress={handleLink}
              disabled={saving || !linkEmail.trim() || lookupResult !== 'found'}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : (
                  <>
                    <MaterialIcons name="link" size={16} color="#fff" />
                    <Text style={linkStyles.linkBtnText}>Link Account</Text>
                  </>
                )}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const linkStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  body: { padding: Spacing.xl, gap: Spacing.xl },
  linkedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: `${Colors.success}30`, padding: Spacing.lg,
  },
  linkedBannerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: `${Colors.success}18`, borderWidth: 1, borderColor: `${Colors.success}35`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  linkedBannerTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.success },
  linkedBannerSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 18 },
  linkedDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  unlinkedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: `${Colors.warning}30`, padding: Spacing.lg,
  },
  unlinkedBannerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: `${Colors.warning}18`, borderWidth: 1, borderColor: `${Colors.warning}35`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  unlinkedBannerTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.warning },
  unlinkedBannerSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 18 },
  howItWorks: {
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.2)', overflow: 'hidden',
  },
  howHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(47,129,247,0.15)',
  },
  howHeaderIcon: {
    width: 18, height: 18, borderRadius: 5, backgroundColor: 'rgba(47,129,247,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  howHeaderText: { fontSize: 10, fontWeight: '700', color: Colors.primary, letterSpacing: 0.8 },
  howSteps: { padding: Spacing.lg, gap: Spacing.md },
  howStep: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  howStepIcon: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: 'rgba(47,129,247,0.15)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  howStepText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 19 },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9 },
  emailInputRow: { flexDirection: 'row', gap: Spacing.sm },
  emailInput: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  emailTextInput: { flex: 1, paddingVertical: 12, fontSize: FontSize.base, color: Colors.textPrimary },
  lookupBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center',
    minWidth: 72,
  },
  lookupBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff' },
  lookupFound: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.success}35`,
  },
  lookupFoundText: { fontSize: FontSize.sm, color: Colors.success, fontWeight: '600' },
  lookupNotFound: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.warning}30`,
  },
  lookupNotFoundText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 19 },
  unlinkCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.warning}25`,
  },
  unlinkCardText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 19 },
  unlinkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md,
    paddingVertical: 13, borderWidth: 1, borderColor: `${Colors.danger}30`,
  },
  unlinkBtnText: { fontSize: FontSize.base, fontWeight: '700', color: Colors.danger },
  footer: {
    flexDirection: 'row', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface,
  },
  cancelBtn: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 13, alignItems: 'center',
  },
  cancelText: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textSecondary },
  linkBtn: {
    flex: 2, backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  linkBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },
});

// ── Client Detail Sheet (kept for potential future use) ────────────────────────
function InfoRow({ icon, label, value, last }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; value: string; last?: boolean }) {
  return (
    <View style={[detailStyles.infoRow, !last && detailStyles.infoRowBorder]}>
      <View style={detailStyles.infoIconWrap}>
        <MaterialIcons name={icon} size={13} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={detailStyles.infoLabel}>{label}</Text>
        <Text style={detailStyles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.lg },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  infoIconWrap: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.primaryGlow,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  infoLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 2 },
  infoValue: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500' },
});

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function ClientsScreen() {
  const router = useRouter();
  const { clients, loading, removeClient, refreshClients } = useClients();
  const { shipments } = useShipments();
  const { showAlert } = useAlert();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [linkingClient, setLinkingClient] = useState<Client | null>(null);

  const shipmentCountMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    shipments.forEach(s => {
      if (s.clientId) map[s.clientId] = (map[s.clientId] ?? 0) + 1;
    });
    return map;
  }, [shipments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.company ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q) ||
      (c.country ?? '').toLowerCase().includes(q)
    );
  }, [clients, search]);

  const handleDelete = useCallback((client: Client) => {
    showAlert(
      `Delete ${client.name}?`,
      'This will remove the client from the directory. Existing shipments will keep the client name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const err = await removeClient(client.id);
            if (err) showAlert('Error', err);
            else if (selectedClient?.id === client.id) setSelectedClient(null);
          },
        },
      ]
    );
  }, [removeClient, selectedClient, showAlert]);

  const handleEdit = useCallback((client: Client) => {
    setEditingClient(client);
    setShowForm(true);
    setSelectedClient(null);
  }, []);

  const openAdd = () => { setEditingClient(null); setShowForm(true); };
  const openLink = useCallback((client: Client) => { setLinkingClient(client); }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('clients.title')}</Text>
          <Text style={styles.subtitle}>{clients.length} {t('clients.subtitle')}</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]} onPress={openAdd}>
          <MaterialIcons name="person-add" size={16} color="#fff" />
          <Text style={styles.addBtnText}>{t('clients.newClient')}</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={17} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t('clients.searchPlaceholder')}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <MaterialIcons name="close" size={15} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        {[
          { icon: 'people' as const,   label: t('clients.total'),     value: clients.length,                        color: Colors.primary },
          { icon: 'business' as const, label: t('clients.companies'), value: clients.filter(c => c.company).length, color: Colors.info },
          { icon: 'email' as const,    label: t('clients.withEmail'), value: clients.filter(c => c.email).length,   color: Colors.success },
        ].map((stat, i, arr) => (
          <React.Fragment key={stat.label}>
            {i > 0 && <View style={styles.statsDivider} />}
            <View style={styles.statItem}>
              <MaterialIcons name={stat.icon} size={14} color={stat.color} />
              <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>{t('clients.loading')}</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="people-outline" size={48} color={Colors.border} />
          <Text style={styles.emptyTitle}>{clients.length === 0 ? t('clients.noClients') : t('clients.noResults')}</Text>
          <Text style={styles.emptySub}>
            {clients.length === 0
              ? t('clients.noClientsSub')
              : `No clients match "${search}"`}
          </Text>
          {clients.length === 0 && (
            <Pressable style={styles.emptyAddBtn} onPress={openAdd}>
              <MaterialIcons name="person-add" size={16} color="#fff" />
              <Text style={styles.emptyAddBtnText}>{t('clients.addFirst')}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <View style={styles.list}>
            {filtered.map(client => (
              <Pressable
                key={client.id}
                style={({ pressed }) => [
                  styles.clientCard,
                  selectedClient?.id === client.id && styles.clientCardSelected,
                  pressed && { opacity: 0.82 },
                ]}
                onPress={() => setSelectedClient(prev => prev?.id === client.id ? null : client)}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {client.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </Text>
                </View>

                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.clientName} numberOfLines={1}>{client.name}</Text>
                  {client.company ? (
                    <View style={styles.companyRow}>
                      <MaterialIcons name="business" size={11} color={Colors.textMuted} />
                      <Text style={styles.clientCompany} numberOfLines={1}>{client.company}</Text>
                    </View>
                  ) : null}
                  <View style={styles.clientMeta}>
                    {client.email ? (
                      <View style={styles.metaItem}>
                        <MaterialIcons name="email" size={10} color={Colors.textMuted} />
                        <Text style={styles.metaText} numberOfLines={1}>{client.email}</Text>
                      </View>
                    ) : null}
                    {(client.city || client.country) ? (
                      <View style={styles.metaItem}>
                        <MaterialIcons name="place" size={10} color={Colors.textMuted} />
                        <Text style={styles.metaText}>{[client.city, client.country].filter(Boolean).join(', ')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.shipmentCountRow}>
                    <View style={styles.shipmentCountBadge}>
                      <MaterialIcons name="local-shipping" size={10} color={Colors.primary} />
                      <Text style={styles.shipmentCountText}>
                        {shipmentCountMap[client.id] ?? 0} {t('clients.shipments')}
                      </Text>
                    </View>
                    {(shipmentCountMap[client.id] ?? 0) > 0 && (
                      <Pressable
                        style={({ pressed }) => [styles.viewShipmentsBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => router.push({ pathname: '/(tabs)/shipments', params: { clientId: client.id, clientName: client.name } })}
                        hitSlop={4}
                      >
                        <Text style={styles.viewShipmentsBtnText}>{t('clients.viewShipments')}</Text>
                        <MaterialIcons name="arrow-forward" size={10} color={Colors.primary} />
                      </Pressable>
                    )}
                  </View>
                </View>

                <View style={styles.cardActions}>
                  <Pressable
                    style={({ pressed }) => [styles.cardActionBtn, styles.linkActionBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => openLink(client)}
                    hitSlop={6}
                  >
                    <MaterialIcons
                      name={(client as any).customerUserId ? 'verified-user' : 'link'}
                      size={15}
                      color={(client as any).customerUserId ? Colors.success : Colors.textMuted}
                    />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.cardActionBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => handleEdit(client)}
                    hitSlop={6}
                  >
                    <MaterialIcons name="edit" size={15} color={Colors.primary} />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.cardActionBtn, styles.deleteActionBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => handleDelete(client)}
                    hitSlop={6}
                  >
                    <MaterialIcons name="delete-outline" size={15} color={Colors.danger} />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      <ClientFormModal
        visible={showForm}
        editing={editingClient}
        onClose={() => { setShowForm(false); setEditingClient(null); }}
      />

      <LinkAccountModal
        visible={!!linkingClient}
        client={linkingClient}
        onClose={() => setLinkingClient(null)}
        onLinked={() => { refreshClients(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  addBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: '#fff' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    margin: Spacing.xl, marginBottom: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: FontSize.base, color: Colors.textPrimary },
  statsBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  statItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  statValue: { fontSize: FontSize.base, fontWeight: '700' },
  statLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  statsDivider: { width: 1, height: 24, backgroundColor: Colors.border, marginHorizontal: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: 40 },
  loadingText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.textPrimary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingHorizontal: 18, paddingVertical: 11, marginTop: Spacing.sm,
  },
  emptyAddBtnText: { fontSize: FontSize.base, fontWeight: '600', color: '#fff' },
  list: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xs, gap: Spacing.md },
  clientCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md,
    ...Shadow.card,
  },
  clientCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.cardHover },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: FontSize.base, fontWeight: '700', color: Colors.primary },
  clientName: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  clientCompany: { fontSize: FontSize.xs, color: Colors.textSecondary, flex: 1 },
  clientMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 10, color: Colors.textMuted, maxWidth: 120 },
  cardActions: { flexDirection: 'row', gap: 4 },
  cardActionBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteActionBtn: { backgroundColor: 'rgba(248,81,73,0.08)', borderColor: 'rgba(248,81,73,0.2)' },
  linkActionBtn: { backgroundColor: Colors.card, borderColor: Colors.border },
  shipmentCountRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  shipmentCountBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryGlow, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.2)',
  },
  shipmentCountText: { fontSize: 10, fontWeight: '600', color: Colors.primary },
  viewShipmentsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2,
    backgroundColor: 'transparent', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  viewShipmentsBtnText: { fontSize: 10, fontWeight: '600', color: Colors.primary },
});
