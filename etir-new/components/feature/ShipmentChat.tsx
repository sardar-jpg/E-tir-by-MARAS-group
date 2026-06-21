/**
 * ShipmentChat.tsx
 *
 * Order-specific chat panel used in both the admin ShipmentDetail panel
 * and the driver Job tab. Supports text messages + image/document attachments.
 *
 * Thread is auto-created (or fetched) via `initShipmentThread` when the
 * component mounts and the shipment has an accepted price (or admin opens it).
 */
import React, {
  useState, useEffect, useCallback, useRef, memo,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Linking, Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/hooks/useAuth';
import { uploadChatAttachment } from '@/services/chatService';
import { Shipment, ChatMessage } from '@/types';
import { Colors, FontSize, Spacing, BorderRadius } from '@/constants/theme';

interface Props {
  shipment: Shipment;
  /** 'admin' panels pass onNavigate; driver panels leave it undefined */
  role: 'admin' | 'driver';
  /** compact=true renders as a card section inside a ScrollView */
  compact?: boolean;
}

// ── Message bubble ──────────────────────────────────────────────────────────
const MessageBubble = memo(function MessageBubble({
  msg,
  isMe,
}: {
  msg: ChatMessage;
  isMe: boolean;
}) {
  const renderAttachment = () => {
    if (!msg.attachmentUrl) return null;
    if (msg.attachmentType === 'image') {
      return (
        <Pressable onPress={() => Linking.openURL(msg.attachmentUrl!)}>
          <Image
            source={{ uri: msg.attachmentUrl }}
            style={styles.attachImg}
            contentFit="cover"
            transition={200}
          />
        </Pressable>
      );
    }
    const rawName = msg.attachmentUrl.split('/').pop() ?? 'Document';
    const fileName = rawName.replace(/^\d+_/, '');
    return (
      <Pressable
        style={[styles.docBubble, isMe ? styles.docBubbleMe : styles.docBubbleThem]}
        onPress={() => Linking.openURL(msg.attachmentUrl!)}
      >
        <MaterialIcons
          name="insert-drive-file"
          size={18}
          color={isMe ? Colors.primary : Colors.textSecondary}
        />
        <Text
          style={[styles.docName, isMe && { color: '#fff' }]}
          numberOfLines={1}
        >
          {fileName}
        </Text>
        <MaterialIcons name="open-in-new" size={11} color={Colors.textMuted} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowThem]}>
      {!isMe && (
        <View style={styles.msgAvatar}>
          <MaterialIcons
            name="person"
            size={13}
            color={Colors.primary}
          />
        </View>
      )}
      <View style={[styles.msgGroup, isMe && { alignItems: 'flex-end' }]}>
        {renderAttachment()}
        {msg.content && msg.content !== '📎 Attachment' && msg.content.trim() !== '' && (
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
              {msg.content}
            </Text>
          </View>
        )}
        <View style={styles.metaRow}>
          <Text style={styles.senderName}>
            {msg.senderName}
          </Text>
          <Text style={styles.bubbleTime}>{msg.timestamp}</Text>
          {isMe && (
            <MaterialIcons
              name={msg.read ? 'done-all' : 'done'}
              size={11}
              color={msg.read ? Colors.primary : Colors.textMuted}
            />
          )}
        </View>
      </View>
    </View>
  );
});

// ── Main component ──────────────────────────────────────────────────────────
export function ShipmentChat({ shipment, role, compact = false }: Props) {
  const { user } = useAuth();
  const {
    threads, sendMessage, markRead,
    initShipmentThread, getShipmentChatThread,
  } = useChat();

  const [threadId, setThreadId] = useState<string | null>(null);
  const [initialising, setInitialising] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Resolve live thread from context
  const thread = threadId ? threads.find(t => t.id === threadId) ?? null : null;
  const messages = thread?.messages ?? [];

  // Ensure/fetch the shipment thread on mount
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      // Check if already in context
      const existing = getShipmentChatThread(shipment.id);
      if (existing) {
        setThreadId(existing.id);
        return;
      }
      setInitialising(true);
      const tid = await initShipmentThread(
        shipment.id,
        shipment.tirNumber,
        shipment.driverId ?? '',
        shipment.driverName,
        shipment.plateNumber,
      );
      if (!cancelled) {
        setThreadId(tid);
        setInitialising(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [shipment.id]);

  // Mark read when thread is opened
  useEffect(() => {
    if (threadId && thread && thread.unreadCount > 0) {
      markRead(threadId);
    }
  }, [threadId, thread?.unreadCount]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || !threadId || !user) return;
    setSending(true);
    await sendMessage(
      message.trim(),
      user.id,
      user.displayName ?? (role === 'admin' ? 'MARAS Dispatch' : 'Driver'),
      role,
      threadId,
    );
    setMessage('');
    setSending(false);
  }, [message, threadId, user, role, sendMessage]);

  const handlePickImage = useCallback(async (source: 'camera' | 'gallery') => {
    if (!threadId || !user) return;
    setShowAttachMenu(false);
    setUploadError('');

    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { setUploadError('Camera permission denied.'); return; }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { setUploadError('Gallery permission denied.'); return; }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsMultipleSelection: false,
        });
      }
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const ext = mimeType.split('/')[1] ?? 'jpg';
      const fileName = `ship_${shipment.tirNumber}_${Date.now()}.${ext}`;

      setSending(true);
      const { url, type, error } = await uploadChatAttachment(
        { uri: asset.uri, name: fileName, mimeType },
        user.id,
      );
      if (error || !url) { setUploadError(`Upload failed: ${error}`); setSending(false); return; }
      await sendMessage('', user.id, user.displayName ?? role, role, threadId, url, type);
      setSending(false);
    } catch (e) {
      setUploadError(String(e));
      setSending(false);
    }
  }, [threadId, user, role, sendMessage, shipment.tirNumber]);

  const handlePickDocument = useCallback(async () => {
    if (!threadId || !user) return;
    setShowAttachMenu(false);
    setUploadError('');

    try {
      // Web: use HTML input
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';
        input.onchange = async (e: any) => {
          const file: File = e.target.files?.[0];
          if (!file) return;
          setSending(true);
          const { url, type, error } = await uploadChatAttachment(
            { uri: '', name: file.name, mimeType: file.type, rawFile: file },
            user.id,
          );
          if (error || !url) { setUploadError(`Upload failed: ${error}`); setSending(false); return; }
          await sendMessage('', user.id, user.displayName ?? role, role, threadId, url, type);
          setSending(false);
        };
        input.click();
        return;
      }

      // Native: expo-document-picker
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*', copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const doc = res.assets[0];
      setSending(true);
      const { url, type, error } = await uploadChatAttachment(
        { uri: doc.uri, name: doc.name, mimeType: doc.mimeType ?? 'application/octet-stream' },
        user.id,
      );
      if (error || !url) { setUploadError(`Upload failed: ${error}`); setSending(false); return; }
      await sendMessage('', user.id, user.displayName ?? role, role, threadId, url, type);
      setSending(false);
    } catch (e) {
      setUploadError(String(e));
      setSending(false);
    }
  }, [threadId, user, role, sendMessage]);

  // ── Empty state / loading ─────────────────────────────────────────────────
  if (initialising) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={Colors.primary} />
        <Text style={styles.centredText}>Opening order chat...</Text>
      </View>
    );
  }

  if (!threadId) {
    return (
      <View style={styles.centred}>
        <MaterialIcons name="chat-bubble-outline" size={28} color={Colors.textMuted} />
        <Text style={styles.centredText}>Chat unavailable</Text>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={compact ? styles.compactRoot : styles.fullRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={compact ? 0 : 90}
    >
      {/* Chat header bar */}
      <View style={styles.chatHeader}>
        <View style={styles.chatHeaderIcon}>
          <MaterialIcons name="chat" size={13} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatHeaderTitle}>Order Chat — {shipment.tirNumber}</Text>
          <Text style={styles.chatHeaderSub}>
            {shipment.origin} → {shipment.destination}
          </Text>
        </View>
        {thread && thread.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{thread.unreadCount}</Text>
          </View>
        )}
        <View style={styles.onlineDot} />
      </View>

      {/* Message list */}
      <ScrollView
        ref={scrollRef}
        style={compact ? styles.compactScroll : styles.fullScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.msgList}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyChat}>
            <MaterialIcons name="forum" size={32} color={Colors.border} />
            <Text style={styles.emptyChatTitle}>No messages yet</Text>
            <Text style={styles.emptyChatSub}>
              {role === 'admin'
                ? 'Send the first message to the driver for this order.'
                : 'Send a message to dispatch about this shipment.'}
            </Text>
          </View>
        ) : (
          messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isMe={msg.senderRole === role}
            />
          ))
        )}
      </ScrollView>

      {/* Upload error */}
      {uploadError ? (
        <View style={styles.errorBar}>
          <MaterialIcons name="error-outline" size={13} color={Colors.danger} />
          <Text style={styles.errorText} numberOfLines={2}>{uploadError}</Text>
          <Pressable onPress={() => setUploadError('')} hitSlop={8}>
            <MaterialIcons name="close" size={13} color={Colors.danger} />
          </Pressable>
        </View>
      ) : null}

      {/* Attachment options menu */}
      {showAttachMenu && (
        <View style={styles.attachMenu}>
          <Pressable
            style={({ pressed }) => [styles.attachOption, pressed && { opacity: 0.8 }]}
            onPress={() => handlePickImage('camera')}
          >
            <View style={[styles.attachOptionIcon, { backgroundColor: `${Colors.primary}18` }]}>
              <MaterialIcons name="camera-alt" size={20} color={Colors.primary} />
            </View>
            <Text style={styles.attachOptionLabel}>Take Photo</Text>
          </Pressable>
          <View style={styles.attachOptionDivider} />
          <Pressable
            style={({ pressed }) => [styles.attachOption, pressed && { opacity: 0.8 }]}
            onPress={() => handlePickImage('gallery')}
          >
            <View style={[styles.attachOptionIcon, { backgroundColor: `${Colors.info}18` }]}>
              <MaterialIcons name="photo-library" size={20} color={Colors.info} />
            </View>
            <Text style={styles.attachOptionLabel}>From Gallery</Text>
          </Pressable>
          <View style={styles.attachOptionDivider} />
          <Pressable
            style={({ pressed }) => [styles.attachOption, pressed && { opacity: 0.8 }]}
            onPress={handlePickDocument}
          >
            <View style={[styles.attachOptionIcon, { backgroundColor: `${Colors.warning}18` }]}>
              <MaterialIcons name="attach-file" size={20} color={Colors.warning} />
            </View>
            <Text style={styles.attachOptionLabel}>Attach Document</Text>
          </Pressable>
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        <Pressable
          style={({ pressed }) => [
            styles.attachBtn,
            showAttachMenu && styles.attachBtnActive,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setShowAttachMenu(v => !v)}
          disabled={sending}
          hitSlop={6}
        >
          {sending ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <MaterialIcons
              name={showAttachMenu ? 'close' : 'attach-file'}
              size={20}
              color={showAttachMenu ? Colors.danger : Colors.textSecondary}
            />
          )}
        </Pressable>
        <TextInput
          style={styles.textInput}
          value={message}
          onChangeText={setMessage}
          placeholder="Message about this order..."
          placeholderTextColor={Colors.textMuted}
          multiline
          blurOnSubmit={false}
          onSubmitEditing={handleSend}
        />
        <Pressable
          style={[styles.sendBtn, (!message.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!message.trim() || sending}
        >
          <MaterialIcons name="send" size={17} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fullRoot: { flex: 1, backgroundColor: Colors.bg },
  compactRoot: { backgroundColor: Colors.bg },

  centred: {
    paddingVertical: Spacing.xl, alignItems: 'center', gap: 8,
  },
  centredText: { fontSize: FontSize.sm, color: Colors.textMuted },

  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  chatHeaderIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  chatHeaderTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  chatHeaderSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  unreadBadge: {
    backgroundColor: Colors.primary, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  unreadBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  onlineDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success,
  },

  compactScroll: { maxHeight: 320 },
  fullScroll: { flex: 1 },
  msgList: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl },

  emptyChat: {
    alignItems: 'center', gap: 8, paddingVertical: Spacing.xl,
  },
  emptyChatTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  emptyChatSub: {
    fontSize: FontSize.xs, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 18, paddingHorizontal: Spacing.xl,
  },

  // Message rows
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowThem: { justifyContent: 'flex-start' },
  msgAvatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  msgGroup: { gap: 3, maxWidth: '75%' },
  bubble: { borderRadius: BorderRadius.lg, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMe: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleThem: {
    backgroundColor: Colors.card, borderWidth: 1,
    borderColor: Colors.border, borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: FontSize.sm, color: Colors.textPrimary, lineHeight: 20 },
  bubbleTextMe: { color: '#fff' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  senderName: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' },
  bubbleTime: { fontSize: 10, color: Colors.textMuted },

  attachImg: {
    width: 200, height: 150, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  docBubble: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderRadius: BorderRadius.lg, padding: Spacing.md,
    borderWidth: 1, minWidth: 180,
  },
  docBubbleMe: {
    backgroundColor: 'rgba(47,129,247,0.15)',
    borderColor: 'rgba(47,129,247,0.35)',
  },
  docBubbleThem: { backgroundColor: Colors.card, borderColor: Colors.border },
  docName: { flex: 1, fontSize: FontSize.sm, fontWeight: '500', color: Colors.textPrimary },

  errorBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.dangerBg, borderTopWidth: 1, borderTopColor: `${Colors.danger}35`,
    paddingHorizontal: Spacing.lg, paddingVertical: 8,
  },
  errorText: { flex: 1, fontSize: FontSize.xs, color: Colors.danger },

  // Attachment menu
  attachMenu: {
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
    overflow: 'hidden',
  },
  attachOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  attachOptionIcon: {
    width: 36, height: 36, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  attachOptionLabel: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textPrimary },
  attachOptionDivider: { height: 1, backgroundColor: Colors.borderSubtle },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  attachBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  attachBtnActive: {
    backgroundColor: Colors.dangerBg, borderColor: `${Colors.danger}40`,
  },
  textInput: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: FontSize.base, color: Colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.border },
});
