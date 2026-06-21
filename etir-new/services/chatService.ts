import { supabase } from './supabaseClient';
import { ChatThread, ChatMessage, UserRole } from '@/types';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

interface RawThread {
  id: string;
  driver_id: string | null;
  driver_name: string;
  driver_plate: string;
  shipment_id?: string | null;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number;
  chat_messages?: RawMessage[];
}

interface RawMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  timestamp: string;
  is_read: boolean;
  created_at?: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
}

function mapMessage(raw: RawMessage): ChatMessage {
  return {
    id: raw.id,
    senderId: raw.sender_id,
    senderName: raw.sender_name,
    senderRole: raw.sender_role as UserRole,
    content: raw.content,
    timestamp: raw.timestamp,
    read: raw.is_read,
    attachmentUrl: raw.attachment_url ?? undefined,
    attachmentType: (raw.attachment_type ?? undefined) as ChatMessage['attachmentType'],
  };
}

function mapThread(raw: RawThread): ChatThread {
  // Sort messages by created_at ascending
  const sorted = [...(raw.chat_messages ?? [])].sort((a, b) => {
    if (a.created_at && b.created_at) return a.created_at.localeCompare(b.created_at);
    return 0;
  });
  return {
    id: raw.id,
    driverId: raw.driver_id ?? '',
    driverName: raw.driver_name,
    driverPlate: raw.driver_plate,
    shipmentId: raw.shipment_id ?? undefined,
    messages: sorted.map(mapMessage),
    lastMessage: raw.last_message ?? '',
    lastMessageTime: raw.last_message_time ?? '',
    unreadCount: raw.unread_count,
  };
}

/** Fetch all chat threads with messages */
export async function fetchAllThreads(): Promise<{ threads: ChatThread[]; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select(`id, driver_id, driver_name, driver_plate, shipment_id, last_message, last_message_time, unread_count, updated_at, chat_messages(*, created_at)`)
    .order('updated_at', { ascending: false });

  if (error) return { threads: [], error: error.message };
  return { threads: (data as RawThread[]).map(mapThread), error: null };
}

/** Fetch thread for a specific driver (by id, name, or plate) */
export async function fetchDriverThread(driverId: string, driverName?: string, plateNumber?: string): Promise<{ thread: ChatThread | null; error: string | null }> {
  // Try by driver_id first (exclude shipment threads)
  const { data: byId, error: idErr } = await supabase
    .from('chat_threads')
    .select(`id, driver_id, driver_name, driver_plate, shipment_id, last_message, last_message_time, unread_count, updated_at, chat_messages(*, created_at)`)
    .eq('driver_id', driverId)
    .is('shipment_id', null)
    .maybeSingle();

  if (byId) return { thread: mapThread(byId as RawThread), error: null };

  // Fallback: match by plate number
  if (plateNumber) {
    const { data: byPlate } = await supabase
      .from('chat_threads')
      .select(`*, chat_messages(*, created_at)`)
      .eq('driver_plate', plateNumber)
      .maybeSingle();
    if (byPlate) return { thread: mapThread(byPlate as RawThread), error: null };
  }

  // Fallback: match by driver name
  if (driverName) {
    const { data: byName } = await supabase
      .from('chat_threads')
      .select(`*, chat_messages(*, created_at)`)
      .eq('driver_name', driverName)
      .maybeSingle();
    if (byName) return { thread: mapThread(byName as RawThread), error: null };
  }

  return { thread: null, error: idErr?.message ?? null };
}

/** Ensure a chat thread exists for this driver (creates if missing) */
export async function ensureDriverThread(driverId: string, driverName: string, plateNumber: string): Promise<{ thread: ChatThread | null; error: string | null }> {
  // Check if thread already exists
  const existing = await fetchDriverThread(driverId, driverName, plateNumber);
  if (existing.thread) {
    // If thread exists but driver_id is null/mismatched, link it
    if (!existing.thread.driverId || existing.thread.driverId !== driverId) {
      await supabase
        .from('chat_threads')
        .update({ driver_id: driverId })
        .eq('id', existing.thread.id);
    }
    return existing;
  }

  // Create new thread for this driver
  const { data, error } = await supabase
    .from('chat_threads')
    .insert({
      driver_id: driverId,
      driver_name: driverName,
      driver_plate: plateNumber,
      last_message: 'Channel opened',
      last_message_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      unread_count: 0,
    })
    .select(`*, chat_messages(*, created_at)`)
    .single();

  if (error) return { thread: null, error: error.message };
  return { thread: mapThread(data as RawThread), error: null };
}

/**
 * Upload a file to chat-attachments bucket and return the public URL.
 * - Web: pass rawFile (File object) directly
 * - Native: use expo-file-system base64 → decode to Uint8Array
 */
export async function uploadChatAttachment(
  file: { uri: string; name: string; mimeType: string; rawFile?: File },
  senderId: string
): Promise<{ url: string | null; type: 'image' | 'document'; error: string | null }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${senderId}/${Date.now()}_${safeName}`;
  const isImage = file.mimeType.startsWith('image/');

  try {
    let uploadData: File | Blob | Uint8Array;

    if (file.rawFile) {
      // Web: use the raw File object directly
      uploadData = file.rawFile;
    } else if (Platform.OS !== 'web') {
      // Native: read as base64 via expo-file-system, then decode to Uint8Array
      // This avoids the blob.arrayBuffer() issue on React Native
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Decode base64 to binary Uint8Array
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      uploadData = bytes;
    } else {
      // Web fallback: fetch as blob
      const response = await fetch(file.uri);
      if (!response.ok) throw new Error(`Failed to read file: ${response.status}`);
      uploadData = await response.blob();
    }

    const { error: upErr } = await supabase.storage
      .from('chat-attachments')
      .upload(path, uploadData, { contentType: file.mimeType, upsert: false });

    if (upErr) {
      console.warn('[chatService] storage upload error:', upErr.message);
      return { url: null, type: isImage ? 'image' : 'document', error: upErr.message };
    }

    const { data: urlData } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(path);

    return { url: urlData.publicUrl, type: isImage ? 'image' : 'document', error: null };
  } catch (e) {
    console.warn('[chatService] upload exception:', String(e));
    return { url: null, type: isImage ? 'image' : 'document', error: String(e) };
  }
}

/** Send a chat message and update thread summary */
export async function sendChatMessage(
  threadId: string,
  senderId: string,
  senderName: string,
  senderRole: UserRole,
  content: string,
  attachmentUrl?: string,
  attachmentType?: 'image' | 'document'
): Promise<{ message: ChatMessage | null; error: string | null }> {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  // Ensure content is never empty (NOT NULL constraint)
  const safeContent = content.trim() || (attachmentUrl ? '📎 Attachment' : ' ');

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      thread_id: threadId,
      sender_id: senderId,
      sender_name: senderName,
      sender_role: senderRole,
      content: safeContent,
      timestamp,
      // New messages always start unread — is_read reflects whether the
      // *recipient* has opened this thread (see markThreadRead below), not
      // who sent it. Marking admin messages read-on-send made the read
      // receipt checkmark always show "read" even before the driver had
      // seen it.
      is_read: false,
      attachment_url: attachmentUrl ?? null,
      attachment_type: attachmentType ?? null,
    })
    .select()
    .single();

  if (error) {
    console.warn('[chatService] sendMessage error:', error.message);
    return { message: null, error: error.message };
  }

  // Update thread summary
  const lastMsg = content.trim() || (attachmentUrl ? '📎 Attachment' : '');
  if (senderRole === 'driver') {
    const { data: threadData } = await supabase
      .from('chat_threads')
      .select('unread_count')
      .eq('id', threadId)
      .single();
    const currentUnread = (threadData as { unread_count: number } | null)?.unread_count ?? 0;
    await supabase
      .from('chat_threads')
      .update({
        last_message: lastMsg,
        last_message_time: timestamp,
        unread_count: currentUnread + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);
  } else {
    await supabase
      .from('chat_threads')
      .update({
        last_message: lastMsg,
        last_message_time: timestamp,
        unread_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);
  }

  return { message: mapMessage(data as RawMessage), error: null };
}

// ── Shipment-specific thread helpers ─────────────────────────────────────

/**
 * Fetch the order-specific chat thread for a shipment (if it exists).
 * Returns null if not yet created.
 */
export async function fetchShipmentThread(
  shipmentId: string,
): Promise<{ thread: ChatThread | null; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*, chat_messages(*, created_at)')
    .eq('shipment_id', shipmentId)
    .maybeSingle();

  if (error) return { thread: null, error: error.message };
  if (!data) return { thread: null, error: null };
  return { thread: mapThread(data as RawThread), error: null };
}

/**
 * Ensure an order-specific chat thread exists for this shipment.
 * Creates one if it does not exist yet.
 */
export async function ensureShipmentThread(
  shipmentId: string,
  tirNumber: string,
  driverId: string,
  driverName: string,
  plateNumber: string,
): Promise<{ thread: ChatThread | null; error: string | null }> {
  const existing = await fetchShipmentThread(shipmentId);
  if (existing.thread) return existing;

  const { data, error } = await supabase
    .from('chat_threads')
    .insert({
      shipment_id: shipmentId,
      driver_id: driverId || null,
      driver_name: driverName,
      driver_plate: plateNumber,
      last_message: `Order chat opened for ${tirNumber}`,
      last_message_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      unread_count: 0,
    })
    .select('*, chat_messages(*, created_at)')
    .single();

  if (error) return { thread: null, error: error.message };
  return { thread: mapThread(data as RawThread), error: null };
}

/** Mark all messages in thread as read */
export async function markThreadRead(threadId: string): Promise<void> {
  await supabase
    .from('chat_messages')
    .update({ is_read: true })
    .eq('thread_id', threadId);

  await supabase
    .from('chat_threads')
    .update({ unread_count: 0 })
    .eq('id', threadId);
}
