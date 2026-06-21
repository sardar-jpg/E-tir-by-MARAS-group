import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Linking, Animated, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/hooks/useAuth';
import { useShipments } from '@/hooks/useShipments';
import { useChat } from '@/hooks/useChat';
import { useLanguage } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ShipmentStatus } from '@/types';
import { CheckpointProgress } from '@/components/ui/CheckpointProgress';
let LiveMap: typeof import('@/components/feature/LiveMap').LiveMap | null = null;
try { LiveMap = require('@/components/feature/LiveMap').LiveMap; } catch (_e) {}
import { ShipmentChat } from '@/components/feature/ShipmentChat';
import { supabase } from '@/services/supabaseClient';
import {
  startTracking, stopTracking,
  LocationCoords, TrackingState, formatSpeed, formatHeading, formatAccuracy,
} from '@/services/locationService';
import {
  registerForPushNotifications, savePushToken, saveDriverPushToken,
  sendLocalNotification, fetchAdminPushTokens, notifyAdminStatusUpdate,
  notifyDriverStatusChange, fetchDriverPushToken,
} from '@/services/notificationService';
import { fetchDriver, updateDriverStatus, updateDriverProfile } from '@/services/driverService';
import {
  CargoDocument, fetchShipmentDocuments, uploadCargoDocument, deleteCargoDocument,
} from '@/services/documentService';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';
import { ChatMessage, Driver } from '@/types';

type DriverTab = 'job' | 'chat' | 'notifications' | 'profile' | 'report';

interface NotifItem {
  id: string;
  type: 'message' | 'status' | 'price' | 'checkpoint';
  title: string;
  body: string;
  time: string;
  read: boolean;
}

function nowStr() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Animated Tab Bar ─────────────────────────────────────────────────────────
interface TabItemProps {
  id: DriverTab;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}

function TabItem({ icon, label, active, badge, onPress }: TabItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.86, duration: 70, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 320, friction: 12 }),
    ]).start();
    onPress();
  };
  return (
    <Pressable style={tabStyles.item} onPress={handlePress} accessibilityRole="tab">
      <Animated.View style={[tabStyles.iconWrap, active && tabStyles.iconWrapActive, { transform: [{ scale: scaleAnim }] }]}>
        <MaterialIcons name={icon} size={20} color={active ? Colors.primary : Colors.textMuted} />
        {badge && badge > 0 ? (
          <View style={tabStyles.badge}>
            <Text style={tabStyles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </Animated.View>
      <Text style={[tabStyles.label, active && tabStyles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const tabStyles = StyleSheet.create({
  item: { flex: 1, alignItems: 'center', paddingVertical: 7, gap: 2 },
  iconWrap: {
    width: 42, height: 34, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapActive: { backgroundColor: Colors.primaryGlow },
  badge: {
    position: 'absolute', top: -4, right: -2,
    backgroundColor: Colors.danger, borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.bg, paddingHorizontal: 2,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  label: { fontSize: 9, fontWeight: '600', color: Colors.textMuted, letterSpacing: 0.2 },
  labelActive: { color: Colors.primary, fontWeight: '700' },
});

// ── Section Header Helper ─────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: keyof typeof MaterialIcons.glyphMap; title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.iconWrap}>
        <MaterialIcons name={icon} size={11} color={Colors.primary} />
      </View>
      <Text style={sh.title}>{title.toUpperCase()}</Text>
      <View style={sh.line} />
    </View>
  );
}

const sh = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconWrap: {
    width: 20, height: 20, borderRadius: 6,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1 },
  line: { flex: 1, height: 1, backgroundColor: Colors.borderSubtle },
});

// ── Info Row Component ────────────────────────────────────────────────────────
function InfoRow({ label, value, last, mono, accent }: { label: string; value: string; last?: boolean; mono?: boolean; accent?: boolean }) {
  return (
    <View style={[infoRowStyles.row, !last && infoRowStyles.border]}>
      <Text style={infoRowStyles.label}>{label}</Text>
      <Text style={[infoRowStyles.value, mono && infoRowStyles.mono, accent && { color: Colors.primary }]}>
        {value}
      </Text>
    </View>
  );
}

const infoRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: 13 },
  border: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  value: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  mono: { fontFamily: 'monospace' },
});

// ── Main Component ────────────────────────────────────────────────────────────
export default function DriverCompanion() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const driverId = user?.driverId ?? '';
  const { shipments: allShipments, acceptPrice, updateStatus } = useShipments();
  const { myThread, threads, sendMessage, initDriverThread } = useChat(driverId || undefined);
  const { t, language } = useLanguage();
  const isRtl = language === 'ar';

  const [activeTab, setActiveTab] = useState<DriverTab>('job');
  const [message, setMessage] = useState('');

  // ── Report tab ────────────────────────────────────────────────────────────
  const [selectedStatus, setSelectedStatus] = useState<ShipmentStatus | ''>('');
  const [statusRemark, setStatusRemark] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [statusSuccess, setStatusSuccess] = useState(false);

  // ── GPS state ─────────────────────────────────────────────────────────────
  const [gpsTracking, setGpsTracking] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [liveCoords, setLiveCoords] = useState<LocationCoords | null>(null);
  const [gpsStarting, setGpsStarting] = useState(false);
  const [backgroundTracking, setBackgroundTracking] = useState(false);
  const [trackingState, setTrackingState] = useState<TrackingState | null>(null);
  const [nextUpdateIn, setNextUpdateIn] = useState(15);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Price state ───────────────────────────────────────────────────────────
  const [priceAccepting, setPriceAccepting] = useState(false);

  // ── Chat thread ───────────────────────────────────────────────────────────
  const [myThreadId, setMyThreadId] = useState<string | null>(null);
  const [threadReady, setThreadReady] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const prevAdminMsgCountRef = useRef<number>(0);

  // ── Documents ─────────────────────────────────────────────────────────────
  const [documents, setDocuments] = useState<CargoDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showUploadOptions, setShowUploadOptions] = useState(false);

  // ── Profile ───────────────────────────────────────────────────────────────
  const [driverProfile, setDriverProfile] = useState<Driver | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPlate, setEditPlate] = useState('');
  const [editTruckClass, setEditTruckClass] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [driverAvailability, setDriverAvailability] = useState<'Active' | 'Idle' | 'Offline'>('Idle');
  const [availUpdating, setAvailUpdating] = useState(false);
  // ── Change Password ──────────────────────────────────────────────────────
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordMsgType, setPasswordMsgType] = useState<'success' | 'error'>('success');

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const unreadCount = notifications.filter(n => !n.read).length;

  const addNotif = useCallback((item: Omit<NotifItem, 'id' | 'time' | 'read'>) => {
    setNotifications(prev => [{
      ...item,
      id: Math.random().toString(36).substring(2, 10),
      time: nowStr(),
      read: false,
    }, ...prev.slice(0, 49)]);
  }, []);

  const plateNumber = allShipments.find(s => s.driverId === driverId)?.plateNumber
    ?? threads.find(t => t.driverId === driverId)?.driverPlate ?? '';

  const shipments = allShipments.filter(s =>
    (driverId && s.driverId === driverId) ||
    (plateNumber && s.plateNumber === plateNumber) ||
    (driverId && Array.isArray(s.additionalDrivers) && s.additionalDrivers.some(ad => ad.driver_id === driverId))
  );
  const activeShipment = shipments[0] ?? null;
  const completedShipments = shipments.filter(s => s.status === 'Arrived').length;

  const DRIVER_STATUS_OPTIONS: {
    value: ShipmentStatus;
    label: string;
    sublabel: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    color: string;
  }[] = activeShipment?.shipmentType === 'Sea' ? [
    { value: 'Booked',               label: 'Booked',               sublabel: 'Booking confirmed with shipping line',        icon: 'bookmark',         color: '#38BDF8' },
    { value: 'Loaded',               label: 'Loaded / Stuffed',     sublabel: 'Cargo loaded into container / vessel',        icon: 'inventory',        color: '#79C0FF' },
    { value: 'At Port of Loading',   label: 'At Port of Loading',   sublabel: 'Vessel at origin port, awaiting departure',   icon: 'anchor',           color: '#818CF8' },
    { value: 'Vessel Departed',      label: 'Vessel Departed',      sublabel: 'Vessel has left the port of loading',         icon: 'directions-boat',  color: '#0EA5E9' },
    { value: 'At Sea',               label: 'At Sea',               sublabel: 'In transit across the sea, on schedule',      icon: 'water',            color: Colors.primary },
    { value: 'At Port of Discharge', label: 'At Port of Discharge', sublabel: 'Arrived at destination port, awaiting berth', icon: 'anchor',           color: '#818CF8' },
    { value: 'Port Customs',         label: 'Port Customs',         sublabel: 'Under port customs inspection process',       icon: 'verified-user',    color: Colors.warning },
    { value: 'Customs Pending',      label: 'Customs Pending',      sublabel: 'Waiting for customs release approval',         icon: 'pending-actions',  color: Colors.warning },
    { value: 'Arrived',              label: 'Arrived / Delivered',  sublabel: 'Cargo cleared and delivered to consignee',    icon: 'check-circle',     color: Colors.success },
    { value: 'Detained',             label: 'Detained',             sublabel: 'Shipment held, issue requires attention',     icon: 'block',            color: Colors.danger },
  ] : activeShipment?.shipmentType === 'Air' ? [
    { value: 'Loaded',           label: 'Loaded / Ready',        sublabel: 'Cargo packed and ready at origin',              icon: 'inventory',      color: '#79C0FF' },
    { value: 'Awaiting Flight',  label: 'Awaiting Flight',       sublabel: 'At airport, waiting for scheduled flight',      icon: 'schedule',       color: '#7DD3FC' },
    { value: 'Dispatched',       label: 'Dispatched to Airport', sublabel: 'En route to departure airport',                 icon: 'local-shipping', color: '#D2A8FF' },
    { value: 'In Flight',        label: 'In Flight',             sublabel: 'Airborne and heading to destination',           icon: 'flight',         color: '#38BDF8' },
    { value: 'Arrived at Hub',   label: 'Arrived at Hub',        sublabel: 'Landed at destination / transit hub airport',   icon: 'flight-land',    color: '#34D399' },
    { value: 'Customs Clearance', label: 'Customs Clearance',    sublabel: 'Under airport customs inspection process',      icon: 'verified-user',  color: Colors.warning },
    { value: 'Customs Pending',  label: 'Customs Pending',       sublabel: 'Waiting for customs approval',                  icon: 'pending-actions', color: Colors.warning },
    { value: 'Arrived',          label: 'Arrived / Delivered',   sublabel: 'Cleared and delivered to consignee',            icon: 'check-circle',   color: Colors.success },
    { value: 'Detained',         label: 'Detained',              sublabel: 'Shipment held, issue requires attention',       icon: 'block',          color: Colors.danger },
  ] : [
    { value: 'Loaded',            label: 'Loaded',            sublabel: 'Cargo loaded, ready to depart',          icon: 'inventory',        color: Colors.primary },
    { value: 'Dispatched',        label: 'Dispatched',        sublabel: 'Left origin, heading to destination',    icon: 'local-shipping',   color: Colors.info },
    { value: 'In Transit',        label: 'In Transit',        sublabel: 'En route, moving normally',              icon: 'directions-car',   color: Colors.info },
    { value: 'Border Crossing',   label: 'Border Crossing',   sublabel: 'Approaching or at border crossing',      icon: 'swap-horiz',       color: '#D2A8FF' },
    { value: 'Customs Clearance', label: 'Customs Clearance', sublabel: 'Under customs inspection process',       icon: 'verified-user',    color: Colors.warning },
    { value: 'Customs Pending',   label: 'Customs Pending',   sublabel: 'Waiting for customs approval',           icon: 'pending-actions',  color: Colors.warning },
    { value: 'Arrived',           label: 'Arrived',           sublabel: 'Reached destination, delivery complete', icon: 'check-circle',     color: Colors.success },
    { value: 'Detained',          label: 'Detained',          sublabel: 'Shipment held, issue requires attention',icon: 'block',            color: Colors.danger },
  ];

  useEffect(() => {
    if (!driverId) return;
    registerForPushNotifications().then(async token => {
      if (!token) return;
      await savePushToken(driverId, token);
      await saveDriverPushToken(driverId, token);
    }).catch(() => {});
  }, [driverId]);

  useEffect(() => {
    if (!driverId || threadReady) return;
    const driverName = user?.displayName ?? 'Driver';
    const plate = activeShipment?.plateNumber ?? plateNumber ?? '—';
    initDriverThread(driverId, driverName, plate).then(tid => {
      if (tid) setMyThreadId(tid);
      setThreadReady(true);
    });
  }, [driverId, user?.displayName, activeShipment?.plateNumber, threadReady]);

  useEffect(() => {
    if (!driverId) return;
    setProfileLoading(true);
    fetchDriver(driverId).then(({ driver }) => {
      if (driver) {
        setDriverProfile(driver);
        setEditName(driver.fullName);
        setEditPhone(driver.phone);
        setEditUsername(driver.username);
        setEditPlate(driver.plateNumber);
        setEditTruckClass(driver.truckClass);
        setDriverAvailability(driver.status);
      }
      setProfileLoading(false);
    });
  }, [driverId]);

  const resolvedThread = myThread ?? (myThreadId ? threads.find(t => t.id === myThreadId) ?? null : null);
  const threadId = resolvedThread?.id ?? myThreadId;

  useEffect(() => {
    const msgs = resolvedThread?.messages ?? [];
    const adminMsgs = msgs.filter(m => m.senderRole === 'admin');
    const current = adminMsgs.length;
    if (current > prevAdminMsgCountRef.current && prevAdminMsgCountRef.current > 0) {
      const latestMsg = adminMsgs[adminMsgs.length - 1];
      const preview = latestMsg?.content || '📎 Attachment';
      sendLocalNotification('📡 MARAS Dispatch', preview, { type: 'chat' }, 'chat');
      addNotif({ type: 'message', title: t('driverApp.notifNewMsg'), body: preview });
    }
    prevAdminMsgCountRef.current = current;
  }, [resolvedThread?.messages?.length]);

  const prevStatusRef = useRef<string>('');
  useEffect(() => {
    if (!activeShipment) return;
    if (prevStatusRef.current && prevStatusRef.current !== activeShipment.status) {
      addNotif({ type: 'status', title: t('driverApp.notifStatusChange'), body: `${activeShipment.tirNumber}: ${activeShipment.status}` });
      if (driverId) {
        fetchDriverPushToken(driverId)
          .then(token => notifyDriverStatusChange(activeShipment.tirNumber, activeShipment.status, token))
          .catch(() => {});
      }
    }
    prevStatusRef.current = activeShipment.status;
  }, [activeShipment?.status]);

  const prevPriceRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeShipment?.agreedPrice) return;
    if (prevPriceRef.current !== undefined && prevPriceRef.current !== activeShipment.agreedPrice) {
      addNotif({ type: 'price', title: t('driverApp.notifPriceSet'), body: `${activeShipment.tirNumber}: ${activeShipment.agreedPrice}` });
    }
    prevPriceRef.current = activeShipment.agreedPrice;
  }, [activeShipment?.agreedPrice]);

  useEffect(() => {
    if (resolvedThread?.messages.length) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [resolvedThread?.messages.length]);

  const resetCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setNextUpdateIn(15);
    countdownRef.current = setInterval(() => {
      setNextUpdateIn(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    if (!activeShipment) return;
    const activeStatuses = ['In Transit', 'Customs Clearance', 'Dispatched', 'Loaded', 'Customs Pending', 'Border Crossing'];
    if (!activeStatuses.includes(activeShipment.status)) return;
    setGpsStarting(true);
    setGpsError('');
    startTracking(activeShipment.id,
      (coords) => { setLiveCoords(coords); setGpsTracking(true); },
      (state) => { setTrackingState(state); resetCountdown(); },
    ).then(({ ok, backgroundEnabled }) => {
      setGpsStarting(false);
      if (!ok) setGpsError(t('driverApp.gpsPermissionDenied'));
      else { setGpsTracking(true); setBackgroundTracking(backgroundEnabled); resetCountdown(); }
    });
    return () => {
      stopTracking();
      setGpsTracking(false);
      setBackgroundTracking(false);
      setTrackingState(null);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [activeShipment?.id]);

  const handleToggleGps = useCallback(async () => {
    if (gpsTracking) {
      stopTracking();
      setGpsTracking(false);
      setBackgroundTracking(false);
      setLiveCoords(null);
      setTrackingState(null);
      setNextUpdateIn(15);
      if (countdownRef.current) clearInterval(countdownRef.current);
    } else if (activeShipment) {
      setGpsStarting(true);
      setGpsError('');
      const { ok, backgroundEnabled } = await startTracking(activeShipment.id,
        (coords) => { setLiveCoords(coords); },
        (state) => { setTrackingState(state); resetCountdown(); },
      );
      setGpsStarting(false);
      if (ok) { setGpsTracking(true); setBackgroundTracking(backgroundEnabled); resetCountdown(); }
      else setGpsError(t('driverApp.gpsPermissionDenied'));
    }
  }, [gpsTracking, activeShipment, t, resetCountdown]);

  const handleSend = useCallback(() => {
    if (!message.trim() || !threadId) return;
    sendMessage(message, driverId, user?.displayName ?? 'Driver', 'driver', threadId);
    setMessage('');
  }, [message, threadId, driverId, user?.displayName, sendMessage]);

  const handleSaveProfile = async () => {
    if (!driverId) { setProfileMsg('No driver ID found.'); return; }
    if (!editName.trim()) { setProfileMsg('Full name cannot be empty.'); return; }
    if (!editPlate.trim()) { setProfileMsg('Plate number cannot be empty.'); return; }
    setSavingProfile(true);
    const err = await updateDriverProfile(driverId, {
      fullName: editName.trim(),
      phone: editPhone.trim(),
      username: editUsername.trim(),
      plateNumber: editPlate.trim(),
      truckClass: editTruckClass.trim(),
    });
    setSavingProfile(false);
    if (err) {
      setProfileMsg(`Update failed: ${err}`);
    } else {
      setProfileMsg(t('driverApp.profileUpdated'));
      setDriverProfile(prev => prev ? {
        ...prev,
        fullName: editName.trim(),
        phone: editPhone.trim(),
        username: editUsername.trim(),
        plateNumber: editPlate.trim(),
        truckClass: editTruckClass.trim() as any,
        avatarInitials: editName.trim().substring(0, 2).toUpperCase(),
      } : prev);
      setEditMode(false);
    }
    setTimeout(() => setProfileMsg(''), 3000);
  };

  const handleChangePassword = async () => {
    setPasswordMsg('');
    if (!newPassword || !confirmPassword) {
      setPasswordMsg('Please fill in both password fields.');
      setPasswordMsgType('error');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg('Password must be at least 6 characters.');
      setPasswordMsgType('error');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg('Passwords do not match.');
      setPasswordMsgType('error');
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) {
      setPasswordMsg(`Failed: ${error.message}`);
      setPasswordMsgType('error');
    } else {
      setPasswordMsg('Password changed successfully.');
      setPasswordMsgType('success');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => { setShowChangePassword(false); setPasswordMsg(''); }, 2500);
    }
  };

  const handleSetAvailability = async (status: 'Active' | 'Idle' | 'Offline') => {
    if (!driverId) return;
    setAvailUpdating(true);
    await updateDriverStatus(driverId, status);
    setDriverAvailability(status);
    setDriverProfile(prev => prev ? { ...prev, status } : prev);
    setAvailUpdating(false);
  };

  const renderMessageBubble = (msg: ChatMessage) => {
    const isMe = msg.senderRole === 'driver';
    const renderAttachment = () => {
      if (!msg.attachmentUrl) return null;
      if (msg.attachmentType === 'image') {
        return (
          <Pressable onPress={() => Linking.openURL(msg.attachmentUrl!)}>
            <Image source={{ uri: msg.attachmentUrl }} style={styles.attachmentImage} contentFit="cover" transition={200} />
          </Pressable>
        );
      }
      const rawName = msg.attachmentUrl.split('/').pop() ?? 'Document';
      const fileName = rawName.replace(/^\d+_/, '');
      return (
        <Pressable style={[styles.docBubble, isMe ? styles.docBubbleMe : styles.docBubbleThem]} onPress={() => Linking.openURL(msg.attachmentUrl!)}>
          <MaterialIcons name="insert-drive-file" size={20} color={isMe ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.docName, isMe && { color: '#fff' }]} numberOfLines={1}>{fileName}</Text>
          <MaterialIcons name="open-in-new" size={12} color={Colors.textMuted} />
        </Pressable>
      );
    };
    return (
      <View key={msg.id} style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowThem]}>
        {!isMe && (
          <View style={styles.msgAvatar}>
            <MaterialIcons name="headset-mic" size={13} color={Colors.primary} />
          </View>
        )}
        <View style={[styles.msgGroup, isMe && { alignItems: 'flex-end' }]}>
          {renderAttachment()}
          {msg.content && msg.content !== '📎 Attachment' && msg.content.trim() !== '' && (
            <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
              <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.content}</Text>
            </View>
          )}
          <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{msg.timestamp}</Text>
        </View>
      </View>
    );
  };

  useEffect(() => {
    if (!activeShipment?.id) { setDocuments([]); return; }
    setDocsLoading(true);
    fetchShipmentDocuments(activeShipment.id).then(({ docs }) => { setDocuments(docs); setDocsLoading(false); });
  }, [activeShipment?.id]);

  const handlePickAndUpload = useCallback(async (source: 'camera' | 'gallery') => {
    if (!activeShipment || !driverId) return;
    setShowUploadOptions(false);
    setUploadError('');
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { setUploadError('Camera permission denied.'); return; }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { setUploadError('Gallery permission denied.'); return; }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsMultipleSelection: false });
      }
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const ext = mimeType.split('/')[1] ?? 'jpg';
      const fileName = `cargo_${activeShipment.tirNumber}_${Date.now()}.${ext}`;
      setUploading(true);
      const { doc, error } = await uploadCargoDocument({ uri: asset.uri, name: fileName, mimeType }, activeShipment.id, driverId);
      setUploading(false);
      if (error) { setUploadError(`Upload failed: ${error}`); }
      else if (doc) { setDocuments(prev => [doc, ...prev]); addNotif({ type: 'checkpoint', title: 'Document uploaded', body: `${fileName} added to ${activeShipment.tirNumber}` }); }
    } catch (e) {
      setUploading(false);
      setUploadError(`Unexpected error: ${String(e)}`);
    }
  }, [activeShipment, driverId, addNotif]);

  const handleDeleteDocument = useCallback((docId: string) => {
    Alert.alert('Delete Document', 'Remove this document from the shipment?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCargoDocument(docId); setDocuments(prev => prev.filter(d => d.id !== docId)); } },
    ]);
  }, []);

  const availColor = driverAvailability === 'Active' ? Colors.success : driverAvailability === 'Idle' ? Colors.warning : Colors.textMuted;
  const initials = driverProfile?.avatarInitials ?? user?.displayName?.substring(0, 2).toUpperCase() ?? 'DR';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={[styles.header, isRtl && styles.rowReverse]}>
        <View style={[styles.headerLeft, isRtl && styles.rowReverse]}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={[styles.availDot, { backgroundColor: availColor }]} />
          </View>
          <View style={styles.headerIdentity}>
            <View style={[styles.headerNameRow, isRtl && styles.rowReverse]}>
              <Text style={styles.headerName} numberOfLines={1}>{user?.displayName ?? 'Driver'}</Text>
              <View style={[styles.availPill, { backgroundColor: `${availColor}18`, borderColor: `${availColor}35` }]}>
                <View style={[styles.availPillDot, { backgroundColor: availColor }]} />
                <Text style={[styles.availPillText, { color: availColor }]}>{driverAvailability}</Text>
              </View>
            </View>
            <View style={[styles.headerSubRow, isRtl && styles.rowReverse]}>
              <MaterialIcons name="local-shipping" size={10} color={Colors.textMuted} />
              <Text style={styles.headerPlate}>{activeShipment?.plateNumber ?? plateNumber ?? '—'}</Text>
              {gpsTracking && (
                <View style={styles.gpsPill}>
                  <View style={styles.gpsPillDot} />
                  <Text style={styles.gpsPillText}>GPS LIVE</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={styles.headerRight}>
          <LanguagePicker compact />
        </View>
      </View>

      {/* ── Tab Bar ── */}
      <View style={[styles.tabBar, isRtl && styles.rowReverse]}>
        <TabItem id="job" icon="assignment" label={t('driverApp.myJob')} active={activeTab === 'job'} onPress={() => setActiveTab('job')} />
        <TabItem id="chat" icon="chat" label={t('driverApp.dispatch')} active={activeTab === 'chat'} badge={resolvedThread?.unreadCount} onPress={() => setActiveTab('chat')} />
        <TabItem id="notifications" icon="notifications" label={t('driverApp.notifications')} active={activeTab === 'notifications'} badge={unreadCount} onPress={() => setActiveTab('notifications')} />
        <TabItem id="profile" icon="person" label={t('driverApp.profile')} active={activeTab === 'profile'} onPress={() => setActiveTab('profile')} />
        <TabItem id="report" icon="update" label={t('driverApp.report')} active={activeTab === 'report'} onPress={() => setActiveTab('report')} />
      </View>

      {/* ── JOB TAB ── */}
      {activeTab === 'job' && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {activeShipment ? (
            <View style={styles.section}>

              <View style={[styles.jobBanner, isRtl && styles.rowReverse]}>
                <View style={[styles.jobBannerLeft, isRtl && styles.rowReverse]}>
                  <View style={styles.jobBannerIcon}>
                    <MaterialIcons name="assignment" size={16} color={Colors.primary} />
                  </View>
                  <View>
                    <Text style={styles.jobBannerLabel}>{t('driverApp.activeManifest')}</Text>
                    <Text style={styles.jobBannerTir}>{activeShipment.tirNumber}</Text>
                  </View>
                </View>
                <StatusBadge status={activeShipment.status} size="sm" />
              </View>

              <View style={styles.routeCard}>
                <View style={[styles.routeCardRow, isRtl && styles.rowReverse]}>
                  <View style={styles.routeEndpoint}>
                    <View style={[styles.routeEndpointDot, { backgroundColor: Colors.primary }]} />
                    <View style={styles.routeEndpointInfo}>
                      <Text style={styles.routeEndpointLabel}>ORIGIN</Text>
                      <Text style={styles.routeEndpointCity}>{activeShipment.origin}</Text>
                    </View>
                  </View>
                  <View style={styles.routeArrowWrap}>
                    <View style={styles.routeArrowLine} />
                    <View style={styles.routeArrowIcon}>
                      <MaterialIcons name="local-shipping" size={14} color={Colors.primary} />
                    </View>
                  </View>
                  <View style={[styles.routeEndpoint, { alignItems: 'flex-end' }]}>
                    <View style={[styles.routeEndpointDot, { backgroundColor: Colors.success }]} />
                    <View style={[styles.routeEndpointInfo, { alignItems: 'flex-end' }]}>
                      <Text style={styles.routeEndpointLabel}>DESTINATION</Text>
                      <Text style={styles.routeEndpointCity}>{activeShipment.destination}</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.routeCardMeta, isRtl && styles.rowReverse]}>
                  {[
                    { icon: 'inventory' as const, label: 'Cargo', value: activeShipment.cargoDescription },
                    { icon: 'scale' as const, label: 'Weight', value: activeShipment.weight },
                    { icon: 'schedule' as const, label: 'ETA', value: activeShipment.estimatedArrival || 'TBD' },
                  ].map((item, i) => (
                    <View key={item.label} style={[styles.routeMetaItem, isRtl && styles.rowReverse]}>
                      <MaterialIcons name={item.icon} size={12} color={Colors.textMuted} />
                      <View>
                        <Text style={styles.routeMetaLabel}>{item.label}</Text>
                        <Text style={styles.routeMetaValue} numberOfLines={1}>{item.value}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              {activeShipment.notes ? (
                <View style={styles.notesCard}>
                  <View style={[styles.notesCardHeader, isRtl && styles.rowReverse]}>
                    <MaterialIcons name="comment" size={12} color={Colors.primary} />
                    <Text style={styles.notesCardTitle}>DISPATCHER NOTES</Text>
                  </View>
                  <Text style={[styles.notesCardText, isRtl && styles.textRtl]}>{activeShipment.notes}</Text>
                </View>
              ) : null}

              <View style={styles.gpsCard}>
                <View style={[styles.gpsCardHeader, isRtl && styles.rowReverse]}>
                  <View style={[styles.gpsCardHeaderLeft, isRtl && styles.rowReverse]}>
                    <View style={[styles.gpsStatusDot, { backgroundColor: gpsTracking ? Colors.success : Colors.border }]} />
                    <Text style={styles.gpsCardTitle}>Live Location</Text>
                    {gpsTracking && (
                      <View style={[styles.gpsBadge, isRtl && styles.rowReverse]}>
                        <MaterialIcons name={backgroundTracking ? 'phonelink-lock' : 'smartphone'} size={9} color={backgroundTracking ? Colors.success : Colors.warning} />
                        <Text style={[styles.gpsBadgeText, { color: backgroundTracking ? Colors.success : Colors.warning }]}>
                          {backgroundTracking ? 'BG' : 'FG'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Pressable
                    style={[styles.gpsToggleBtn, gpsTracking && styles.gpsToggleBtnActive]}
                    onPress={handleToggleGps}
                    disabled={gpsStarting}
                  >
                    {gpsStarting ? <ActivityIndicator size="small" color={Colors.primary} /> : (
                      <>
                        <MaterialIcons name={gpsTracking ? 'pause' : 'play-arrow'} size={13} color={gpsTracking ? Colors.success : Colors.textSecondary} />
                        <Text style={[styles.gpsToggleText, gpsTracking && { color: Colors.success }]}>
                          {gpsTracking ? 'Tracking' : 'Start GPS'}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>

                {LiveMap ? (
                  <LiveMap
                    shipments={liveCoords ? [{ ...activeShipment, lat: liveCoords.lat, lng: liveCoords.lng }] : [activeShipment]}
                    focusShipment={liveCoords ? { ...activeShipment, lat: liveCoords.lat, lng: liveCoords.lng } : activeShipment}
                    height={180} showAllShipments={false}
                  />
                ) : (
                  <View style={styles.mapFallbackMini}>
                    <MaterialIcons name="map" size={20} color={Colors.border} />
                    <Text style={styles.mapFallbackMiniText}>Map requires native build</Text>
                  </View>
                )}

                {liveCoords ? (
                  <>
                    <View style={[styles.telemetryRow, isRtl && styles.rowReverse]}>
                      {[
                        { icon: 'speed' as const, value: formatSpeed(liveCoords.speed), label: 'Speed' },
                        { icon: 'navigation' as const, value: formatHeading(liveCoords.heading), label: 'Heading' },
                        { icon: 'place' as const, value: liveCoords.lat.toFixed(4), label: 'Lat' },
                        { icon: 'place' as const, value: liveCoords.lng.toFixed(4), label: 'Lng' },
                      ].map((item, i) => (
                        <React.Fragment key={item.label}>
                          {i > 0 && <View style={styles.telemetrySep} />}
                          <View style={styles.telemetryItem}>
                            <MaterialIcons name={item.icon} size={11} color={Colors.primary} />
                            <Text style={styles.telemetryValue}>{item.value}</Text>
                            <Text style={styles.telemetryLabel}>{item.label}</Text>
                          </View>
                        </React.Fragment>
                      ))}
                    </View>
                    <View style={[styles.gpsStatusBar, isRtl && styles.rowReverse]}>
                      <View style={[styles.gpsStatusLeft, isRtl && styles.rowReverse]}>
                        <View style={[styles.gpsStatusIndicator, { backgroundColor: trackingState?.lastPersistOk !== false ? Colors.success : Colors.danger }]} />
                        <Text style={styles.gpsStatusText}>
                          {trackingState ? `Synced ${trackingState.updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Sending first fix...'}
                        </Text>
                        {trackingState && (
                          <View style={styles.updateBadge}>
                            <Text style={styles.updateBadgeText}>{trackingState.updateCount} updates</Text>
                          </View>
                        )}
                      </View>
                      <View style={[styles.nextUpdatePill, isRtl && styles.rowReverse]}>
                        <MaterialIcons name="schedule" size={9} color={Colors.primary} />
                        <Text style={styles.nextUpdateText}>{nextUpdateIn > 0 ? `${nextUpdateIn}s` : 'Now...'}</Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={[styles.noGpsRow, isRtl && styles.rowReverse]}>
                    <MaterialIcons name="gps-not-fixed" size={13} color={Colors.textMuted} />
                    <Text style={styles.noGpsText}>{gpsError || (gpsStarting ? 'Acquiring GPS signal...' : 'Tap Start GPS to begin tracking')}</Text>
                  </View>
                )}
              </View>

              <SectionHeader icon="place" title={t('driverApp.checkpoints')} />
              <View style={styles.checkpointsCard}>
                <CheckpointProgress checkpoints={activeShipment.checkpoints} compact />
              </View>

              <View style={[styles.docHeader, isRtl && styles.rowReverse]}>
                <SectionHeader icon="folder" title={t('driverApp.cargo').toUpperCase() + ' DOCUMENTS'} />
                <Pressable
                  style={({ pressed }) => [styles.docAddBtn, pressed && { opacity: 0.8 }, uploading && { opacity: 0.5 }]}
                  onPress={() => setShowUploadOptions(v => !v)}
                  disabled={uploading}
                >
                  {uploading ? <ActivityIndicator size="small" color="#fff" style={{ width: 12, height: 12 }} /> : <MaterialIcons name="add" size={12} color="#fff" />}
                  <Text style={styles.docAddBtnText}>{uploading ? 'Uploading...' : 'Add'}</Text>
                </Pressable>
              </View>

              {uploadError ? (
                <View style={[styles.errorBox, isRtl && styles.rowReverse]}>
                  <MaterialIcons name="error-outline" size={13} color={Colors.danger} />
                  <Text style={styles.errorBoxText} numberOfLines={2}>{uploadError}</Text>
                  <Pressable onPress={() => setUploadError('')} hitSlop={8}><MaterialIcons name="close" size={13} color={Colors.danger} /></Pressable>
                </View>
              ) : null}

              {showUploadOptions && (
                <View style={styles.uploadCard}>
                  {[
                    { source: 'camera' as const, icon: 'camera-alt' as const, label: 'Take Photo', sub: 'Use device camera', color: Colors.primary },
                    { source: 'gallery' as const, icon: 'photo-library' as const, label: 'From Gallery', sub: 'Pick existing photo', color: Colors.success },
                  ].map((opt, i) => (
                    <React.Fragment key={opt.source}>
                      {i > 0 && <View style={{ height: 1, backgroundColor: Colors.borderSubtle, marginHorizontal: Spacing.lg }} />}
                      <Pressable style={({ pressed }) => [styles.uploadOption, isRtl && styles.rowReverse, pressed && { opacity: 0.8 }]} onPress={() => handlePickAndUpload(opt.source)}>
                        <View style={[styles.uploadOptionIcon, { backgroundColor: `${opt.color}15` }]}>
                          <MaterialIcons name={opt.icon} size={20} color={opt.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.uploadOptionLabel}>{opt.label}</Text>
                          <Text style={styles.uploadOptionSub}>{opt.sub}</Text>
                        </View>
                        <MaterialIcons name={isRtl ? 'chevron-left' : 'chevron-right'} size={16} color={Colors.textMuted} />
                      </Pressable>
                    </React.Fragment>
                  ))}
                </View>
              )}

              {docsLoading ? (
                <View style={styles.docsLoading}><ActivityIndicator size="small" color={Colors.primary} /><Text style={styles.docsLoadingText}>Loading documents...</Text></View>
              ) : documents.length === 0 ? (
                <View style={styles.docsEmpty}>
                  <MaterialIcons name="photo-camera" size={28} color={Colors.border} />
                  <Text style={styles.docsEmptyText}>No documents yet</Text>
                </View>
              ) : (
                <View style={styles.docsScrollOuter}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.docsScrollContent}>
                    {documents.map(doc => (
                      <View key={doc.id} style={styles.docThumbCard}>
                        <Pressable onPress={() => Linking.openURL(doc.fileUrl)} style={{ flex: 1 }}>
                          <Image source={{ uri: doc.fileUrl }} style={styles.docThumbImage} contentFit="cover" transition={200} />
                        </Pressable>
                        <View style={styles.docThumbFooter}>
                          <Text style={styles.docThumbTime}>{new Date(doc.uploadedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</Text>
                          <Pressable onPress={() => Linking.openURL(doc.fileUrl)} hitSlop={6}><MaterialIcons name="open-in-new" size={11} color={Colors.primary} /></Pressable>
                        </View>
                        <Pressable style={styles.docDeleteBtn} onPress={() => handleDeleteDocument(doc.id)} hitSlop={6}>
                          <MaterialIcons name="close" size={10} color="#fff" />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {(activeShipment.priceAccepted || activeShipment.agreedPrice) && (
                <View style={styles.orderChatCard}>
                  <View style={[styles.orderChatCardHeader, isRtl && styles.rowReverse]}>
                    <View style={styles.orderChatHeaderIcon}><MaterialIcons name="chat" size={11} color={Colors.primary} /></View>
                    <Text style={styles.orderChatHeaderTitle}>ORDER CHAT</Text>
                    <View style={styles.orderChatLine} />
                    <View style={styles.privateBadge}>
                      <MaterialIcons name="lock" size={9} color={Colors.success} />
                      <Text style={styles.privateBadgeText}>Private</Text>
                    </View>
                  </View>
                  <Text style={styles.orderChatSub}>This chat is for {activeShipment.tirNumber} only.</Text>
                  <ShipmentChat shipment={activeShipment} role="driver" compact />
                </View>
              )}

              {activeShipment.agreedPrice ? (
                <View style={[styles.priceCard, activeShipment.priceAccepted && styles.priceCardAccepted]}>
                  <View style={[styles.priceCardTop, isRtl && styles.rowReverse]}>
                    <View style={[styles.priceCardHeaderLeft, isRtl && styles.rowReverse]}>
                      <MaterialIcons name={activeShipment.priceAccepted ? 'verified' : 'handshake'} size={18} color={activeShipment.priceAccepted ? Colors.success : Colors.warning} />
                      <Text style={styles.priceCardTitle}>{t('driverApp.agreedPriceTitle').toUpperCase()}</Text>
                    </View>
                    {activeShipment.priceAccepted && (
                      <View style={[styles.priceAcceptedBadge, isRtl && styles.rowReverse]}>
                        <MaterialIcons name="check" size={10} color={Colors.success} />
                        <Text style={styles.priceAcceptedText}>{t('driverApp.priceAccepted')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.priceAmount}>{activeShipment.agreedPrice}</Text>
                  {activeShipment.priceAccepted ? (
                    <Text style={styles.priceAcceptedAt}>{t('driverApp.priceAcceptedAt')} {activeShipment.priceAcceptedAt ?? ''}</Text>
                  ) : (
                    <>
                      <Text style={[styles.priceSub, isRtl && styles.textRtl]}>{t('driverApp.priceAcceptSub')}</Text>
                      <Pressable
                        style={({ pressed }) => [styles.priceAcceptBtn, pressed && { opacity: 0.85 }, priceAccepting && { opacity: 0.6 }]}
                        onPress={async () => { setPriceAccepting(true); await acceptPrice(activeShipment.id); addNotif({ type: 'price', title: 'Price Accepted', body: `${activeShipment.agreedPrice}` }); setPriceAccepting(false); }}
                        disabled={priceAccepting}
                      >
                        {priceAccepting ? <ActivityIndicator size="small" color="#fff" /> : (
                          <><MaterialIcons name="check-circle" size={16} color="#fff" /><Text style={styles.priceAcceptBtnText}>Accept Price</Text></>
                        )}
                      </Pressable>
                    </>
                  )}
                </View>
              ) : null}

            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyStateIcon}><MaterialIcons name="inbox" size={32} color={Colors.primary} /></View>
              <Text style={styles.emptyStateTitle}>{t('driverApp.noJob')}</Text>
              <Text style={[styles.emptyStateSub, isRtl && styles.textRtl]}>{t('driverApp.noJobSub')}</Text>
            </View>
          )}
          <View style={{ height: 48 }} />
        </ScrollView>
      )}

      {/* ── CHAT TAB ── */}
      {activeTab === 'chat' && (
        <KeyboardAvoidingView style={styles.chatWrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
          <View style={[styles.chatInfoBar, isRtl && styles.rowReverse]}>
            <View style={styles.dispatchAvatar}><MaterialIcons name="headset-mic" size={15} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.chatInfoTitle, isRtl && styles.textRtl]}>{t('driverApp.dispatchCenter')}</Text>
              <Text style={[styles.chatInfoSub, isRtl && styles.textRtl]}>{t('driverApp.dispatchOperational')}</Text>
            </View>
            <View style={styles.onlineDot} />
          </View>
          <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false}>
            {!threadReady ? (
              <View style={styles.chatPlaceholder}><ActivityIndicator color={Colors.primary} /><Text style={styles.chatPlaceholderText}>Opening secure channel...</Text></View>
            ) : (resolvedThread?.messages ?? []).length === 0 ? (
              <View style={styles.chatPlaceholder}><MaterialIcons name="chat-bubble-outline" size={32} color={Colors.border} /><Text style={styles.chatPlaceholderText}>{t('driverApp.noMessages')}</Text></View>
            ) : (
              <View style={styles.messages}>{(resolvedThread?.messages ?? []).map(msg => renderMessageBubble(msg))}</View>
            )}
          </ScrollView>
          <View style={[styles.inputBar, isRtl && styles.rowReverse]}>
            <TextInput
              style={styles.chatInput}
              value={message}
              onChangeText={setMessage}
              placeholder={t('driverApp.messagePlaceholder')}
              placeholderTextColor={Colors.textMuted}
              multiline
              blurOnSubmit={false}
              onSubmitEditing={handleSend}
              textAlign={isRtl ? 'right' : 'left'}
            />
            <Pressable style={[styles.sendBtn, !message.trim() && styles.sendBtnOff]} onPress={handleSend} disabled={!message.trim()}>
              <MaterialIcons name="send" size={17} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {activeTab === 'notifications' && (
        <View style={{ flex: 1 }}>
          <View style={[styles.subHeader, isRtl && styles.rowReverse]}>
            <Text style={styles.subHeaderTitle}>{t('driverApp.notifCenter')}</Text>
            <View style={[styles.subHeaderActions, isRtl && styles.rowReverse]}>
              {unreadCount > 0 && (
                <Pressable style={({ pressed }) => [styles.subHeaderBtn, isRtl && styles.rowReverse, pressed && { opacity: 0.7 }]} onPress={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}>
                  <MaterialIcons name="done-all" size={13} color={Colors.primary} />
                  <Text style={styles.subHeaderBtnText}>{t('driverApp.markAllRead')}</Text>
                </Pressable>
              )}
              {notifications.length > 0 && (
                <Pressable style={({ pressed }) => [styles.subHeaderBtn, isRtl && styles.rowReverse, pressed && { opacity: 0.7 }]} onPress={() => setNotifications([])}>
                  <MaterialIcons name="clear-all" size={13} color={Colors.danger} />
                  <Text style={[styles.subHeaderBtnText, { color: Colors.danger }]}>{t('driverApp.notifClearAll')}</Text>
                </Pressable>
              )}
            </View>
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {notifications.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyStateIcon}><MaterialIcons name="notifications-none" size={28} color={Colors.primary} /></View>
                <Text style={styles.emptyStateTitle}>{t('driverApp.notifEmpty')}</Text>
                <Text style={[styles.emptyStateSub, isRtl && styles.textRtl]}>{t('driverApp.notifEmptySub')}</Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, gap: Spacing.sm }}>
                {notifications.map(notif => {
                  const icons: Record<NotifItem['type'], keyof typeof MaterialIcons.glyphMap> = { message: 'chat', status: 'local-shipping', price: 'handshake', checkpoint: 'place' };
                  const cols: Record<NotifItem['type'], string> = { message: Colors.primary, status: Colors.warning, price: Colors.success, checkpoint: Colors.info };
                  return (
                    <Pressable
                      key={notif.id}
                      style={[styles.notifItem, isRtl && styles.rowReverse, !notif.read && styles.notifItemUnread]}
                      onPress={() => setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n))}
                    >
                      <View style={[styles.notifItemIcon, { backgroundColor: `${cols[notif.type]}15`, borderColor: `${cols[notif.type]}30` }]}>
                        <MaterialIcons name={icons[notif.type]} size={15} color={cols[notif.type]} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={[styles.notifItemTitleRow, isRtl && styles.rowReverse]}>
                          <Text style={styles.notifItemTitle}>{notif.title}</Text>
                          {!notif.read && <View style={styles.unreadDot} />}
                        </View>
                        <Text style={[styles.notifItemBody, isRtl && styles.textRtl]} numberOfLines={2}>{notif.body}</Text>
                        <Text style={styles.notifItemTime}>{notif.time}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}

      {/* ── PROFILE TAB ── */}
      {activeTab === 'profile' && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {profileLoading ? (
            <View style={styles.emptyState}><ActivityIndicator color={Colors.primary} size="large" /></View>
          ) : (
            <View style={styles.section}>

              <View style={styles.profileHero}>
                <View style={styles.profileHeroAccent} />
                <View style={styles.profileHeroContent}>
                  <View style={styles.profileAvatarWrap}>
                    <View style={styles.profileAvatar}>
                      <Text style={styles.profileAvatarText}>{initials}</Text>
                    </View>
                    <View style={[styles.profileAvailDot, { backgroundColor: availColor, borderColor: Colors.surface }]} />
                  </View>
                  <Text style={styles.profileName}>{driverProfile?.fullName ?? user?.displayName ?? ''}</Text>
                  <Text style={styles.profileEmail}>{user?.email ?? ''}</Text>
                  <View style={[styles.profileRolePill, isRtl && styles.rowReverse]}>
                    <MaterialIcons name="local-shipping" size={11} color={Colors.primary} />
                    <Text style={styles.profileRoleText}>MARAS Driver</Text>
                  </View>
                  <View style={[styles.profileStats, isRtl && styles.rowReverse]}>
                    {[
                      { value: String(shipments.length), label: t('driverApp.totalShipments'), color: Colors.textPrimary },
                      { value: String(completedShipments), label: t('driverApp.completedShipments'), color: Colors.success },
                      { value: String(shipments.filter(s => s.status !== 'Arrived' && s.status !== 'Detained').length), label: t('driverApp.activeShipments'), color: Colors.primary },
                    ].map((stat, i, arr) => (
                      <React.Fragment key={stat.label}>
                        <View style={styles.profileStat}>
                          <Text style={[styles.profileStatVal, { color: stat.color }]}>{stat.value}</Text>
                          <Text style={styles.profileStatLabel}>{stat.label}</Text>
                        </View>
                        {i < arr.length - 1 && <View style={styles.profileStatDiv} />}
                      </React.Fragment>
                    ))}
                  </View>
                </View>
              </View>

              <SectionHeader icon="wifi-tethering" title={t('driverApp.availability')} />
              <View style={[styles.availRow, isRtl && styles.rowReverse]}>
                {([
                  { status: 'Active' as const, label: t('drivers.active'), color: Colors.success, icon: 'check-circle' as const },
                  { status: 'Idle' as const, label: t('drivers.idle'), color: Colors.warning, icon: 'pause-circle-outline' as const },
                  { status: 'Offline' as const, label: t('drivers.offline'), color: Colors.textMuted, icon: 'radio-button-unchecked' as const },
                ]).map(opt => {
                  const isActive = driverAvailability === opt.status;
                  return (
                    <Pressable
                      key={opt.status}
                      style={({ pressed }) => [styles.availBtn, isActive && { borderColor: opt.color, backgroundColor: `${opt.color}12` }, pressed && { opacity: 0.8 }, availUpdating && { opacity: 0.5 }]}
                      onPress={() => handleSetAvailability(opt.status)}
                      disabled={availUpdating}
                    >
                      <MaterialIcons name={opt.icon} size={18} color={isActive ? opt.color : Colors.textMuted} />
                      <Text style={[styles.availBtnText, isActive && { color: opt.color }]}>{opt.label}</Text>
                      {isActive && <View style={[styles.availBtnActiveDot, { backgroundColor: opt.color }]} />}
                    </Pressable>
                  );
                })}
              </View>

              <SectionHeader icon="local-shipping" title={t('driverApp.plateNumber') + ' & ' + t('driverApp.truckClass')} />
              <View style={styles.infoCard}>
                <InfoRow label={t('driverApp.plateNumber')} value={driverProfile?.plateNumber ?? '—'} mono accent />
                <InfoRow label={t('driverApp.truckClass')} value={driverProfile?.truckClass ?? '—'} last />
              </View>

              <View style={[styles.sectionHeaderRow, isRtl && styles.rowReverse]}>
                <SectionHeader icon="person" title={t('driverApp.driverProfile')} />
                {!editMode && (
                  <Pressable style={({ pressed }) => [styles.editPill, isRtl && styles.rowReverse, pressed && { opacity: 0.7 }]} onPress={() => setEditMode(true)}>
                    <MaterialIcons name="edit" size={12} color={Colors.primary} />
                    <Text style={styles.editPillText}>Edit</Text>
                  </Pressable>
                )}
              </View>

              {profileMsg ? (
                <View style={[styles.profileMsgBox, isRtl && styles.rowReverse, profileMsg.toLowerCase().includes('fail') ? styles.profileMsgError : styles.profileMsgSuccess]}>
                  <MaterialIcons name={profileMsg.toLowerCase().includes('fail') ? 'error-outline' : 'check-circle'} size={14} color={profileMsg.toLowerCase().includes('fail') ? Colors.danger : Colors.success} />
                  <Text style={[styles.profileMsgText, { color: profileMsg.toLowerCase().includes('fail') ? Colors.danger : Colors.success }]}>{profileMsg}</Text>
                </View>
              ) : null}

              {editMode ? (
                <View style={styles.editCard}>
                  {[
                    { label: t('driverApp.fullName'),    value: editName,     setter: setEditName,     icon: 'person' as const,          keyboard: 'default' as const,    autoCapitalize: 'words' as const },
                    { label: t('driverApp.phone'), value: editPhone,    setter: setEditPhone,    icon: 'phone' as const,           keyboard: 'phone-pad' as const,  autoCapitalize: 'none' as const },
                    { label: t('driverApp.username'),     value: editUsername, setter: setEditUsername, icon: 'alternate-email' as const,  keyboard: 'default' as const,    autoCapitalize: 'none' as const },
                    { label: t('driverApp.plateNumber'), value: editPlate,    setter: setEditPlate,    icon: 'directions-car' as const,  keyboard: 'default' as const,    autoCapitalize: 'characters' as const },
                  ].map((field, i) => (
                    <View key={field.label} style={[styles.editField, { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle }]}>
                      <Text style={[styles.editFieldLabel, isRtl && styles.textRtl]}>{field.label}</Text>
                      <View style={[styles.editFieldRow, isRtl && styles.rowReverse]}>
                        <MaterialIcons name={field.icon} size={14} color={Colors.textMuted} />
                        <TextInput
                          style={styles.editInput}
                          value={field.value}
                          onChangeText={field.setter}
                          keyboardType={field.keyboard}
                          autoCapitalize={field.autoCapitalize}
                          placeholderTextColor={Colors.textMuted}
                          textAlign={isRtl ? 'right' : 'left'}
                        />
                      </View>
                    </View>
                  ))}

                  <View style={[styles.editField, { borderBottomWidth: 0 }]}>
                    <Text style={[styles.editFieldLabel, isRtl && styles.textRtl]}>{t('driverApp.truckClass').toUpperCase()}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', gap: Spacing.sm, paddingTop: 6 }}>
                        {(['Refrigerated', 'Flatbed', 'Box Truck', 'Tanker', 'Container'] as const).map(tc => {
                          const isSelected = editTruckClass === tc;
                          return (
                            <Pressable
                              key={tc}
                              style={[styles.truckClassChip, isSelected && styles.truckClassChipActive]}
                              onPress={() => setEditTruckClass(tc)}
                            >
                              <Text style={[styles.truckClassChipText, isSelected && styles.truckClassChipTextActive]}>{tc}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>

                  <View style={[styles.editActions, isRtl && styles.rowReverse]}>
                    <Pressable style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]} onPress={() => {
                      setEditName(driverProfile?.fullName ?? '');
                      setEditPhone(driverProfile?.phone ?? '');
                      setEditUsername(driverProfile?.username ?? '');
                      setEditPlate(driverProfile?.plateNumber ?? '');
                      setEditTruckClass(driverProfile?.truckClass ?? '');
                      setEditMode(false);
                      setProfileMsg('');
                    }}>
                      <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                    </Pressable>
                    <Pressable style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, savingProfile && { opacity: 0.6 }]} onPress={handleSaveProfile} disabled={savingProfile}>
                      {savingProfile ? <ActivityIndicator size="small" color="#fff" /> : (<><MaterialIcons name="save" size={14} color="#fff" /><Text style={styles.saveBtnText}>{t('driverApp.saveProfile')}</Text></>)}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.infoCard}>
                  <InfoRow label={t('driverApp.fullName')} value={driverProfile?.fullName ?? user?.displayName ?? '—'} />
                  <InfoRow label={t('driverApp.phone')} value={driverProfile?.phone || '—'} />
                  <InfoRow label={t('driverApp.username')} value={driverProfile?.username || '—'} last />
                </View>
              )}

              <View style={[styles.sectionHeaderRow, isRtl && styles.rowReverse]}>
                <SectionHeader icon="lock" title="Security" />
                <Pressable
                  style={({ pressed }) => [styles.editPill, isRtl && styles.rowReverse, pressed && { opacity: 0.7 }]}
                  onPress={() => { setShowChangePassword(v => !v); setPasswordMsg(''); setNewPassword(''); setConfirmPassword(''); }}
                >
                  <MaterialIcons name={showChangePassword ? 'expand-less' : 'lock-reset'} size={12} color={Colors.primary} />
                  <Text style={styles.editPillText}>{showChangePassword ? 'Cancel' : 'Change Password'}</Text>
                </Pressable>
              </View>

              {showChangePassword && (
                <View style={styles.editCard}>
                  <View style={[styles.editField, { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle }]}>
                    <Text style={[styles.editFieldLabel, isRtl && styles.textRtl]}>New Password</Text>
                    <View style={[styles.editFieldRow, isRtl && styles.rowReverse]}>
                      <MaterialIcons name="lock-outline" size={14} color={Colors.textMuted} />
                      <TextInput
                        style={[styles.editInput, { flex: 1 }]}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        placeholder="Min. 6 characters"
                        placeholderTextColor={Colors.textMuted}
                        secureTextEntry={!showNewPw}
                        autoCapitalize="none"
                        textAlign={isRtl ? 'right' : 'left'}
                      />
                      <Pressable onPress={() => setShowNewPw(v => !v)} hitSlop={8}>
                        <MaterialIcons name={showNewPw ? 'visibility' : 'visibility-off'} size={14} color={Colors.textMuted} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={[styles.editField, { borderBottomWidth: 0 }]}>
                    <Text style={[styles.editFieldLabel, isRtl && styles.textRtl]}>Confirm Password</Text>
                    <View style={[styles.editFieldRow, isRtl && styles.rowReverse]}>
                      <MaterialIcons name="lock-outline" size={14} color={Colors.textMuted} />
                      <TextInput
                        style={[styles.editInput, { flex: 1 }]}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Re-enter new password"
                        placeholderTextColor={Colors.textMuted}
                        secureTextEntry={!showConfirmPw}
                        autoCapitalize="none"
                        textAlign={isRtl ? 'right' : 'left'}
                      />
                      <Pressable onPress={() => setShowConfirmPw(v => !v)} hitSlop={8}>
                        <MaterialIcons name={showConfirmPw ? 'visibility' : 'visibility-off'} size={14} color={Colors.textMuted} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.pwHints}>
                    {[
                      { label: 'At least 6 characters', ok: newPassword.length >= 6 },
                      { label: 'Passwords match', ok: newPassword.length > 0 && newPassword === confirmPassword },
                    ].map(hint => (
                      <View key={hint.label} style={[styles.pwHintRow, isRtl && styles.rowReverse]}>
                        <MaterialIcons
                          name={hint.ok ? 'check-circle' : 'radio-button-unchecked'}
                          size={12}
                          color={hint.ok ? Colors.success : Colors.textMuted}
                        />
                        <Text style={[styles.pwHintText, hint.ok && { color: Colors.success }]}>{hint.label}</Text>
                      </View>
                    ))}
                  </View>
                  {passwordMsg ? (
                    <View style={[styles.profileMsgBox, isRtl && styles.rowReverse, passwordMsgType === 'success' ? styles.profileMsgSuccess : styles.profileMsgError, { margin: Spacing.lg, marginTop: 0 }]}>
                      <MaterialIcons name={passwordMsgType === 'success' ? 'check-circle' : 'error-outline'} size={14} color={passwordMsgType === 'success' ? Colors.success : Colors.danger} />
                      <Text style={[styles.profileMsgText, { color: passwordMsgType === 'success' ? Colors.success : Colors.danger }]}>{passwordMsg}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.editActions, isRtl && styles.rowReverse]}>
                    <Pressable
                      style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                      onPress={() => { setShowChangePassword(false); setPasswordMsg(''); setNewPassword(''); setConfirmPassword(''); }}
                    >
                      <Text style={styles.cancelBtnText}>{t('common.close')}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, changingPassword && { opacity: 0.6 }]}
                      onPress={handleChangePassword}
                      disabled={changingPassword}
                    >
                      {changingPassword
                        ? <ActivityIndicator size="small" color="#fff" />
                        : (<><MaterialIcons name="lock" size={14} color="#fff" /><Text style={styles.saveBtnText}>Update Password</Text></>)}
                    </Pressable>
                  </View>
                </View>
              )}

              <SectionHeader icon="settings" title={t('driverApp.appSettings')} />
              <View style={styles.infoCard}>
                <View style={[styles.settingsRow, isRtl && styles.rowReverse, { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle }]}>
                  <Text style={styles.settingsRowLabel}>{t('driverApp.language')}</Text>
                  <LanguagePicker compact />
                </View>
                <View style={[styles.settingsRow, isRtl && styles.rowReverse]}>
                  <Text style={styles.settingsRowLabel}>{t('driverApp.appVersion')}</Text>
                  <Text style={styles.settingsRowValue}>
                    {(() => { try { const C = require('expo-constants').default; return `v${C.expoConfig?.version ?? '1.0.0'}`; } catch { return 'v1.0.0'; } })()}
                  </Text>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [styles.signOutBtn, isRtl && styles.rowReverse, pressed && { opacity: 0.85 }]}
                onPress={async () => { await logout(); router.replace('/'); }}
              >
                <MaterialIcons name="logout" size={17} color={Colors.danger} />
                <Text style={styles.signOutBtnText}>{t('driverApp.signOut')}</Text>
              </Pressable>

            </View>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      {/* ── REPORT TAB ── */}
      {activeTab === 'report' && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>

            <View style={[styles.reportHeader, isRtl && styles.rowReverse]}>
              <View style={styles.reportHeaderIcon}>
                <MaterialIcons name="update" size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reportHeaderTitle, isRtl && styles.textRtl]}>{t('driverApp.statusUpdate')}</Text>
                <Text style={[styles.reportHeaderSub, isRtl && styles.textRtl]}>{t('driverApp.statusSub')}</Text>
              </View>
            </View>

            {activeShipment ? (
              <View style={styles.reportShipmentCard}>
                <View style={[styles.reportShipmentTop, isRtl && styles.rowReverse]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.reportTirNumber}>{activeShipment.tirNumber}</Text>
                    <Text style={[styles.reportCargoDesc, isRtl && styles.textRtl]} numberOfLines={1}>{activeShipment.cargoDescription}</Text>
                  </View>
                  <StatusBadge status={activeShipment.status} size="sm" />
                </View>
                <View style={[styles.reportRouteRow, isRtl && styles.rowReverse]}>
                  <View style={[styles.reportRouteDot, { backgroundColor: Colors.primary }]} />
                  <Text style={styles.reportRouteText} numberOfLines={1}>{activeShipment.origin}</Text>
                  <MaterialIcons name={isRtl ? 'arrow-back' : 'arrow-forward'} size={11} color={Colors.textMuted} />
                  <View style={[styles.reportRouteDot, { backgroundColor: Colors.success }]} />
                  <Text style={styles.reportRouteText} numberOfLines={1}>{activeShipment.destination}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.reportNoShipment}>
                <MaterialIcons name="inbox" size={28} color={Colors.border} />
                <Text style={styles.reportNoShipmentText}>No active shipment assigned</Text>
              </View>
            )}

            <SectionHeader icon="swap-horiz" title={t('driverApp.statusUpdate')} />
            <View style={styles.statusList}>
              {DRIVER_STATUS_OPTIONS.map((opt, i) => {
                const isSelected = selectedStatus === opt.value;
                const isCurrent = activeShipment?.status === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={({ pressed }) => [
                      styles.statusItem,
                      isRtl && styles.rowReverse,
                      i < DRIVER_STATUS_OPTIONS.length - 1 && styles.statusItemBorder,
                      isSelected && { backgroundColor: `${opt.color}10` },
                      pressed && !isSelected && { backgroundColor: Colors.cardHover },
                    ]}
                    onPress={() => setSelectedStatus(isSelected ? '' : opt.value)}
                  >
                    {isSelected && <View style={[styles.statusAccentBar, isRtl ? { right: 0, left: undefined } : {}, { backgroundColor: opt.color }]} />}

                    <View style={[styles.statusItemIcon, { backgroundColor: `${opt.color}15`, borderColor: `${opt.color}30` }]}>
                      <MaterialIcons name={opt.icon} size={17} color={opt.color} />
                    </View>

                    <View style={styles.statusItemBody}>
                      <View style={[styles.statusItemLabelRow, isRtl && styles.rowReverse]}>
                        <Text style={[styles.statusItemLabel, isSelected && { color: opt.color, fontWeight: '700' }]}>
                          {opt.label}
                        </Text>
                        {isCurrent && !isSelected && (
                          <View style={[styles.currentBadge, { backgroundColor: `${opt.color}15`, borderColor: `${opt.color}30` }]}>
                            <Text style={[styles.currentBadgeText, { color: opt.color }]}>CURRENT</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.statusItemSub, isRtl && styles.textRtl]}>{opt.sublabel}</Text>
                    </View>

                    <View style={[styles.radioCircle, isSelected && { backgroundColor: opt.color, borderColor: opt.color }]}>
                      {isSelected && <MaterialIcons name="check" size={13} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.remarksCard}>
              <View style={[styles.remarksCardHeader, isRtl && styles.rowReverse]}>
                <MaterialIcons name="comment" size={12} color={Colors.textMuted} />
                <Text style={styles.remarksCardLabel}>REMARKS (Optional)</Text>
              </View>
              <TextInput
                style={styles.remarksInput}
                value={statusRemark}
                onChangeText={setStatusRemark}
                placeholder="Add context or remarks for this status update..."
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                textAlign={isRtl ? 'right' : 'left'}
              />
            </View>

            {statusSuccess && (
              <View style={[styles.successBox, isRtl && styles.rowReverse]}>
                <MaterialIcons name="check-circle" size={16} color={Colors.success} />
                <Text style={styles.successBoxText}>Status updated and dispatch notified.</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.updateBtn,
                isRtl && styles.rowReverse,
                (!selectedStatus || !activeShipment) && styles.updateBtnDisabled,
                pressed && selectedStatus && activeShipment ? { opacity: 0.88 } : {},
              ]}
              disabled={!selectedStatus || !activeShipment || statusSubmitting}
              onPress={async () => {
                if (!selectedStatus || !activeShipment) return;
                setStatusSubmitting(true);
                setStatusSuccess(false);
                await updateStatus(activeShipment.id, selectedStatus as ShipmentStatus);
                if (threadId) {
                  const body = statusRemark.trim()
                    ? `[STATUS UPDATE] ${selectedStatus} — ${statusRemark.trim()}`
                    : `[STATUS UPDATE] ${selectedStatus}`;
                  sendMessage(body, driverId, user?.displayName ?? 'Driver', 'driver', threadId);
                }
                fetchAdminPushTokens().then(tokens => {
                  notifyAdminStatusUpdate(activeShipment.tirNumber, selectedStatus, user?.displayName ?? 'Driver', statusRemark.trim(), tokens);
                }).catch(() => {});
                addNotif({ type: 'status', title: 'Status Updated', body: `${activeShipment.tirNumber}: ${selectedStatus}${statusRemark.trim() ? ` — ${statusRemark.trim()}` : ''}` });
                setStatusSubmitting(false);
                setStatusSuccess(true);
                setSelectedStatus('');
                setStatusRemark('');
                setTimeout(() => setStatusSuccess(false), 4000);
              }}
            >
              {statusSubmitting ? <ActivityIndicator size="small" color="#fff" /> : (
                <><MaterialIcons name="send" size={17} color="#fff" /><Text style={styles.updateBtnText}>{t('driverApp.sendUpdate')}</Text></>
              )}
            </Pressable>

          </View>
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  // RTL helpers
  rowReverse: { flexDirection: 'row-reverse' },
  textRtl: { textAlign: 'right', writingDirection: 'rtl' as const },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatarWrap: { position: 'relative', flexShrink: 0 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryGlow,
    borderWidth: 2, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.base, fontWeight: '800', color: Colors.primary },
  availDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.surface,
  },
  headerIdentity: { flex: 1, gap: 3, minWidth: 0 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerName: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1 },
  availPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: BorderRadius.full, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1,
  },
  availPillDot: { width: 5, height: 5, borderRadius: 3 },
  availPillText: { fontSize: 9, fontWeight: '700' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerPlate: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace' },
  gpsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: `${Colors.success}15`, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2, marginLeft: 3,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  gpsPillDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.success },
  gpsPillText: { fontSize: 8, fontWeight: '800', color: Colors.success, letterSpacing: 0.6 },

  // ── Tab Bar ──────────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.xs, paddingTop: 4, paddingBottom: 2,
  },

  scroll: { flex: 1 },
  section: { padding: Spacing.xl, gap: Spacing.lg },

  // ── Job Banner ───────────────────────────────────────────────────────────────
  jobBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primaryGlow,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  jobBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  jobBannerIcon: {
    width: 34, height: 34, borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(47,129,247,0.15)', borderWidth: 1, borderColor: 'rgba(47,129,247,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  jobBannerLabel: { fontSize: 9, fontWeight: '700', color: Colors.primary, letterSpacing: 1 },
  jobBannerTir: { fontSize: FontSize.base, fontWeight: '800', color: Colors.textPrimary, fontFamily: 'monospace', marginTop: 1 },

  // ── Route Card ───────────────────────────────────────────────────────────────
  routeCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  routeCardRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg, gap: Spacing.sm,
  },
  routeEndpoint: { flex: 1, alignItems: 'flex-start', gap: 6 },
  routeEndpointDot: { width: 9, height: 9, borderRadius: 5 },
  routeEndpointInfo: { gap: 2 },
  routeEndpointLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8 },
  routeEndpointCity: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  routeArrowWrap: { alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm },
  routeArrowLine: { height: 1, width: 32, backgroundColor: Colors.borderSubtle },
  routeArrowIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  routeCardMeta: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  routeMetaItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRightWidth: 1, borderRightColor: Colors.borderSubtle,
  },
  routeMetaLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  routeMetaValue: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textPrimary },

  // ── Notes Card ───────────────────────────────────────────────────────────────
  notesCard: {
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
    padding: Spacing.lg, gap: Spacing.sm,
  },
  notesCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  notesCardTitle: { fontSize: 10, fontWeight: '700', color: Colors.primary, letterSpacing: 0.8 },
  notesCardText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },

  // ── GPS Card ─────────────────────────────────────────────────────────────────
  gpsCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  gpsCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  gpsCardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  gpsStatusDot: { width: 8, height: 8, borderRadius: 4 },
  gpsCardTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  gpsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: BorderRadius.full, paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: Colors.surface,
  },
  gpsBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  gpsToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border, minWidth: 86, justifyContent: 'center',
  },
  gpsToggleBtnActive: { borderColor: Colors.success, backgroundColor: `${Colors.success}10` },
  gpsToggleText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  telemetryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  telemetryItem: { flex: 1, alignItems: 'center', gap: 2 },
  telemetrySep: { width: 1, height: 26, backgroundColor: Colors.borderSubtle },
  telemetryValue: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'monospace' },
  telemetryLabel: { fontSize: 8, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  gpsStatusBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    backgroundColor: 'rgba(46,160,67,0.04)',
  },
  gpsStatusLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  gpsStatusIndicator: { width: 6, height: 6, borderRadius: 3 },
  gpsStatusText: { fontSize: 10, color: Colors.textSecondary, fontFamily: 'monospace' },
  updateBadge: {
    backgroundColor: Colors.primaryGlow, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  updateBadgeText: { fontSize: 9, color: Colors.primary, fontWeight: '700' },
  nextUpdatePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  nextUpdateText: { fontSize: 9, color: Colors.primary, fontWeight: '700' },
  noGpsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  noGpsText: { fontSize: FontSize.xs, color: Colors.textMuted, flex: 1 },
  mapFallbackMini: {
    height: 180, backgroundColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  mapFallbackMiniText: { fontSize: FontSize.xs, color: Colors.textMuted },

  // ── Checkpoints ──────────────────────────────────────────────────────────────
  checkpointsCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
  },

  // ── Documents ────────────────────────────────────────────────────────────────
  docHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  docAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  docAddBtnText: { fontSize: FontSize.xs, color: '#fff', fontWeight: '600' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.danger}30`,
  },
  errorBoxText: { flex: 1, fontSize: FontSize.xs, color: Colors.danger },
  uploadCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  uploadOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg,
  },
  uploadOptionIcon: {
    width: 38, height: 38, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadOptionLabel: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  uploadOptionSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  docsLoading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center', paddingVertical: Spacing.lg },
  docsLoadingText: { fontSize: FontSize.sm, color: Colors.textMuted },
  docsEmpty: {
    alignItems: 'center', gap: 6, backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    paddingVertical: Spacing.xl,
  },
  docsEmptyText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  docsScrollOuter: { marginHorizontal: -Spacing.xl, minHeight: 128 },
  docsScrollContent: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, gap: Spacing.md, flexDirection: 'row' },
  docThumbCard: { width: 110, borderRadius: BorderRadius.lg, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.card },
  docThumbImage: { width: 110, height: 88 },
  docThumbFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 5 },
  docThumbTime: { fontSize: 9, color: Colors.textMuted, fontWeight: '500' },
  docDeleteBtn: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  // ── Order Chat ───────────────────────────────────────────────────────────────
  orderChatCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  orderChatCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
  orderChatHeaderIcon: { width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', alignItems: 'center', justifyContent: 'center' },
  orderChatHeaderTitle: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1 },
  orderChatLine: { flex: 1, height: 1, backgroundColor: Colors.borderSubtle },
  privateBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${Colors.success}12`, borderRadius: BorderRadius.full, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: `${Colors.success}28` },
  privateBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.success },
  orderChatSub: { fontSize: FontSize.xs, color: Colors.textMuted, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, lineHeight: 17 },

  // ── Price Card ───────────────────────────────────────────────────────────────
  priceCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.warning, padding: Spacing.xl, gap: Spacing.md },
  priceCardAccepted: { borderColor: Colors.success, backgroundColor: `${Colors.success}08` },
  priceCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceCardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  priceCardTitle: { fontSize: 10, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.8 },
  priceAcceptedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successBg, borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 3 },
  priceAcceptedText: { fontSize: 10, fontWeight: '700', color: Colors.success },
  priceAmount: { fontSize: 30, fontWeight: '800', color: Colors.success, letterSpacing: 0.3 },
  priceAcceptedAt: { fontSize: FontSize.xs, color: Colors.textMuted },
  priceSub: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  priceAcceptBtn: { backgroundColor: Colors.success, borderRadius: BorderRadius.md, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  priceAcceptBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },

  // ── Empty States ─────────────────────────────────────────────────────────────
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, gap: Spacing.lg, minHeight: 280 },
  emptyStateIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyStateTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  emptyStateSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },

  // ── Chat Tab ─────────────────────────────────────────────────────────────────
  chatWrap: { flex: 1 },
  chatInfoBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  dispatchAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  chatInfoTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  chatInfoSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  chatPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingVertical: 56, paddingHorizontal: 32 },
  chatPlaceholderText: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  messages: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.md },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowThem: { justifyContent: 'flex-start' },
  msgAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  msgGroup: { gap: 4, maxWidth: '75%' },
  bubble: { borderRadius: BorderRadius.lg, padding: Spacing.md },
  bubbleMe: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: FontSize.sm, color: Colors.textPrimary, lineHeight: 20 },
  bubbleTextMe: { color: '#fff' },
  bubbleTime: { fontSize: 9, color: Colors.textMuted },
  bubbleTimeMe: { color: Colors.textMuted, textAlign: 'right' },
  attachmentImage: { width: 200, height: 150, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border },
  docBubble: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: BorderRadius.lg, padding: Spacing.md, borderWidth: 1, minWidth: 180 },
  docBubbleMe: { backgroundColor: 'rgba(47,129,247,0.16)', borderColor: 'rgba(47,129,247,0.35)' },
  docBubbleThem: { backgroundColor: Colors.card, borderColor: Colors.border },
  docName: { flex: 1, fontSize: FontSize.sm, fontWeight: '500', color: Colors.textPrimary },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface,
  },
  chatInput: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: FontSize.base, color: Colors.textPrimary, maxHeight: 100,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: Colors.border },

  // ── Notifications Tab ─────────────────────────────────────────────────────────
  subHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  subHeaderTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  subHeaderActions: { flexDirection: 'row', gap: Spacing.sm },
  subHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border,
  },
  subHeaderBtnText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  notifItem: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start',
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
  },
  notifItemUnread: { borderColor: Colors.primary, backgroundColor: Colors.cardHover },
  notifItemIcon: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  notifItemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifItemTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary },
  notifItemBody: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },
  notifItemTime: { fontSize: 9, color: Colors.textMuted, marginTop: 2 },

  // ── Profile Tab ───────────────────────────────────────────────────────────────
  profileHero: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  profileHeroAccent: { height: 4, backgroundColor: Colors.primary, width: '100%' },
  profileHeroContent: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  profileAvatarWrap: { position: 'relative', marginBottom: 4 },
  profileAvatar: {
    width: 86, height: 86, borderRadius: 43,
    backgroundColor: Colors.primaryGlow, borderWidth: 3, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.elevated,
  },
  profileAvatarText: { fontSize: 30, fontWeight: '800', color: Colors.primary },
  profileAvailDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 17, height: 17, borderRadius: 9, borderWidth: 2.5,
  },
  profileName: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  profileEmail: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  profileRolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', marginTop: 2,
  },
  profileRoleText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary },
  profileStats: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    paddingTop: Spacing.lg, marginTop: Spacing.sm,
    width: '100%',
  },
  profileStat: { flex: 1, alignItems: 'center', gap: 3 },
  profileStatDiv: { width: 1, height: 34, backgroundColor: Colors.borderSubtle },
  profileStatVal: { fontSize: FontSize.xl, fontWeight: '800' },
  profileStatLabel: { fontSize: 10, color: Colors.textMuted, textAlign: 'center' },

  availRow: { flexDirection: 'row', gap: Spacing.sm },
  availBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, position: 'relative',
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.border, paddingVertical: 13,
  },
  availBtnText: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },
  availBtnActiveDot: { width: 5, height: 5, borderRadius: 3, marginTop: 1 },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  editPillText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },

  infoCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: 13 },
  settingsRowLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  settingsRowValue: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textMuted, fontFamily: 'monospace' },

  profileMsgBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1 },
  profileMsgSuccess: { backgroundColor: Colors.successBg, borderColor: `${Colors.success}40` },
  profileMsgError: { backgroundColor: Colors.dangerBg, borderColor: `${Colors.danger}40` },
  profileMsgText: { fontSize: FontSize.sm, flex: 1, fontWeight: '500' },

  editCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.primary, overflow: 'hidden' },
  editField: { paddingHorizontal: Spacing.lg, paddingVertical: 10 },
  editFieldLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 5, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  editFieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, minHeight: 44,
  },
  editInput: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary, paddingVertical: 8 },
  editActions: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  cancelBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 12 },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: '#fff' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.lg, paddingVertical: 15,
    borderWidth: 1, borderColor: `${Colors.danger}35`, marginTop: 2,
  },
  signOutBtnText: { fontSize: FontSize.base, fontWeight: '700', color: Colors.danger },

  // Truck class chips
  truckClassChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.full, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.card,
  },
  truckClassChipActive: { backgroundColor: Colors.primaryGlow, borderColor: Colors.primary },
  truckClassChipText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  truckClassChipTextActive: { color: Colors.primaryLight, fontWeight: '700' },

  // Password hints
  pwHints: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: 6 },
  pwHintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pwHintText: { fontSize: FontSize.xs, color: Colors.textMuted },

  // ── Report Tab ────────────────────────────────────────────────────────────────
  reportHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    padding: Spacing.lg,
  },
  reportHeaderIcon: {
    width: 36, height: 36, borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(47,129,247,0.15)', borderWidth: 1, borderColor: 'rgba(47,129,247,0.35)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  reportHeaderTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  reportHeaderSub: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18, marginTop: 2 },

  reportShipmentCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  reportShipmentTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  reportTirNumber: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary, fontFamily: 'monospace', letterSpacing: 0.5 },
  reportCargoDesc: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500' },
  reportRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reportRouteDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  reportRouteText: { fontSize: FontSize.xs, color: Colors.textSecondary, flex: 1 },
  reportNoShipment: {
    alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', paddingVertical: Spacing.xl,
  },
  reportNoShipmentText: { fontSize: FontSize.sm, color: Colors.textMuted },

  statusList: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  statusItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 13, position: 'relative',
  },
  statusItemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  statusAccentBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: 2 },
  statusItemIcon: {
    width: 38, height: 38, borderRadius: 11, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  statusItemBody: { flex: 1, gap: 3 },
  statusItemLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusItemLabel: { fontSize: FontSize.base, color: Colors.textPrimary, fontWeight: '500' },
  currentBadge: {
    borderRadius: BorderRadius.full, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1,
  },
  currentBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  statusItemSub: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17 },
  radioCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  remarksCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  remarksCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  remarksCardLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1 },
  remarksInput: {
    fontSize: FontSize.sm, color: Colors.textPrimary,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    minHeight: 80, lineHeight: 22,
  },

  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.success}40`,
  },
  successBoxText: { fontSize: FontSize.sm, color: Colors.success, flex: 1, fontWeight: '500' },

  updateBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
  },
  updateBtnDisabled: { backgroundColor: Colors.border },
  updateBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700', letterSpacing: 0.3 },
});
