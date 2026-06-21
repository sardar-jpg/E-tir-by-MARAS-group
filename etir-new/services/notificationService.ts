/**
 * Push notification service for e-tir Gateway
 * Uses expo-notifications for local + Expo Push Service for remote notifications
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Request notification permissions and return the Expo push token */
export async function registerForPushNotifications(): Promise<string | null> {
  // Web and simulators don't support push tokens
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) {
    console.log('[notifications] Running in simulator — skipping push token registration');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[notifications] Permission not granted');
    return null;
  }

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'e-tir Gateway',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2F81F7',
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('chat', {
      name: 'Dispatch Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 150, 100, 150],
      lightColor: '#2F81F7',
      sound: 'default',
      description: 'New messages from dispatch or drivers',
    });

    await Notifications.setNotificationChannelAsync('shipment', {
      name: 'Shipment Updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3FB950',
      sound: 'default',
      description: 'Shipment status changes',
    });
  }

  try {
    // Read projectId from expo-constants so it works in both EAS builds and Expo Go
    let projectId: string | undefined;
    try {
      const Constants = require('expo-constants').default;
      projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId ??
        undefined;
    } catch {}
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData.data;
  } catch (err) {
    console.log('[notifications] Could not get push token:', err);
    return null;
  }
}

/** Save push token to the user_profiles table */
export async function savePushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ push_token: token })
    .eq('id', userId);

  if (error) console.warn('[notifications] Failed to save push token:', error.message);
}

/** Save push token to driver_profiles as well (for faster admin lookup) */
export async function saveDriverPushToken(driverId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('driver_profiles')
    .update({ push_token: token })
    .eq('id', driverId);

  if (error) console.warn('[notifications] Failed to save driver push token:', error.message);
}

/** Fetch a user's Expo push token from DB */
export async function fetchPushToken(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('push_token')
    .eq('id', userId)
    .single();

  if (error || !data?.push_token) return null;
  return data.push_token;
}

/** Fetch push token from driver_profiles by driver_id */
export async function fetchDriverPushToken(driverId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('driver_profiles')
    .select('push_token')
    .eq('id', driverId)
    .single();

  if (error || !data?.push_token) return null;
  return data.push_token;
}

/** Fetch push tokens of all admin users (emails ending with @maras.iq or @marasgroup.com) */
export async function fetchAdminPushTokens(): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('push_token, email')
    .not('push_token', 'is', null);

  if (error || !data) return [];

  return data
    .filter(u => u.email?.includes('@maras.iq') || u.email?.includes('@marasgroup.com'))
    .map(u => u.push_token)
    .filter(Boolean) as string[];
}

// ── Local Notifications ────────────────────────────────────────────────────────

/** Send an immediate local notification (works when app is open/backgrounded) */
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId = 'default'
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data ?? {},
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId } : {}),
      },
      trigger: null, // immediate
    });
  } catch (err) {
    console.warn('[notifications] Failed to send local notification:', err);
  }
}

// ── Expo Push Service (remote, works when app is closed) ─────────────────────

interface ExpoPushPayload {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  sound?: 'default' | null;
  badge?: number;
}

/** Send a push notification via Expo Push Service to one or more devices */
export async function sendExpoPush(payload: ExpoPushPayload): Promise<void> {
  const tokens = Array.isArray(payload.to) ? payload.to : [payload.to];
  const validTokens = tokens.filter(t => t && t.startsWith('ExponentPushToken['));

  if (validTokens.length === 0) return;

  const messages = validTokens.map(token => ({
    to: token,
    sound: payload.sound ?? 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    channelId: payload.channelId ?? 'default',
    badge: payload.badge,
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn('[notifications] Expo push failed:', text);
    }
  } catch (err) {
    console.warn('[notifications] Failed to reach Expo push service:', err);
  }
}

// ── High-level Notification Helpers ──────────────────────────────────────────

/**
 * Notify admin(s) that a driver sent a new message.
 * Sends both a local notification (if admin has app open) and
 * an Expo push (if admin device has a registered token).
 */
export async function notifyAdminNewMessage(
  driverName: string,
  messagePreview: string,
  adminPushTokens: string[]
): Promise<void> {
  const title = `💬 ${driverName}`;
  const body = messagePreview.length > 80 ? messagePreview.substring(0, 80) + '…' : messagePreview;

  // Local notification (shown if admin app is in foreground/background)
  await sendLocalNotification(title, body, { type: 'chat', driverName }, 'chat');

  // Remote push (shown even if admin app is closed)
  if (adminPushTokens.length > 0) {
    await sendExpoPush({
      to: adminPushTokens,
      title,
      body,
      data: { type: 'chat', driverName },
      channelId: 'chat',
    });
  }
}

/**
 * Notify a driver that their shipment status was updated.
 * Sends a local notification on the driver device + Expo push.
 */
export async function notifyDriverStatusChange(
  tirNumber: string,
  newStatus: string,
  driverPushToken: string | null
): Promise<void> {
  const title = `📦 Shipment Status Updated`;
  const body = `${tirNumber} is now: ${newStatus}`;

  // Local notification (if driver has app open)
  await sendLocalNotification(title, body, { type: 'shipment', tirNumber, status: newStatus }, 'shipment');

  // Remote push
  if (driverPushToken && driverPushToken.startsWith('ExponentPushToken[')) {
    await sendExpoPush({
      to: driverPushToken,
      title,
      body,
      data: { type: 'shipment', tirNumber, status: newStatus },
      channelId: 'shipment',
    });
  }
}

/**
 * Notify a driver that the admin sent them a new dispatch message.
 */
export async function notifyDriverNewMessage(
  messagePreview: string,
  driverPushToken: string | null
): Promise<void> {
  const title = `📡 MARAS Dispatch`;
  const body = messagePreview.length > 80 ? messagePreview.substring(0, 80) + '…' : messagePreview;

  if (driverPushToken && driverPushToken.startsWith('ExponentPushToken[')) {
    await sendExpoPush({
      to: driverPushToken,
      title,
      body,
      data: { type: 'chat' },
      channelId: 'chat',
    });
  }
}

/**
 * Notify admin(s) that a driver submitted a transit status update.
 * Sends a local notification + Expo push to all admin devices.
 */
export async function notifyAdminStatusUpdate(
  tirNumber: string,
  newStatus: string,
  driverName: string,
  remarks: string,
  adminPushTokens: string[]
): Promise<void> {
  const title = `🚛 Status Update — ${tirNumber}`;
  const bodyParts = [`${driverName}: ${newStatus}`];
  if (remarks) bodyParts.push(remarks);
  const body = bodyParts.join(' · ');

  // Local notification (if admin app is open)
  await sendLocalNotification(title, body, { type: 'shipment', tirNumber, status: newStatus }, 'shipment');

  // Remote push (if admin app is closed)
  if (adminPushTokens.length > 0) {
    await sendExpoPush({
      to: adminPushTokens,
      title,
      body,
      data: { type: 'shipment', tirNumber, status: newStatus },
      channelId: 'shipment',
    });
  }
}

/**
 * Notify a driver that their account has been approved and they can now sign in.
 */
export async function notifyDriverApproved(
  driverPushToken: string | null
): Promise<void> {
  const title = `✅ Account Approved`;
  const body = `Your MARAS driver account has been approved. You can now sign in to the app.`;

  if (driverPushToken && driverPushToken.startsWith('ExponentPushToken[')) {
    await sendExpoPush({
      to: driverPushToken,
      title,
      body,
      data: { type: 'account_approved' },
      channelId: 'default',
    });
  }
}

/**
 * Notify admin(s) that a new driver has registered and is awaiting approval.
 */
export async function notifyAdminNewDriverRegistration(
  driverName: string,
  driverEmail: string,
  plateNumber: string,
  adminPushTokens: string[]
): Promise<void> {
  const title = `🆕 New Driver Registration`;
  const body = `${driverName} (${plateNumber}) has registered and is awaiting approval.`;

  await sendLocalNotification(title, body, { type: 'driver_registration', driverName }, 'default');

  if (adminPushTokens.length > 0) {
    await sendExpoPush({
      to: adminPushTokens,
      title,
      body,
      data: { type: 'driver_registration', driverName, driverEmail, plateNumber },
      channelId: 'default',
    });
  }
}

/** Set the app's badge count (iOS only) */
export async function setBadgeCount(count: number): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {}
}

/** Clear badge on app focus */
export async function clearBadge(): Promise<void> {
  await setBadgeCount(0);
}
