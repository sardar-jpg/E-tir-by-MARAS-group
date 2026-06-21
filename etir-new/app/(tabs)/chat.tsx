import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, Dimensions, ActivityIndicator, Linking, Animated, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAlert } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';
import { useLanguage } from '@/hooks/useLanguage';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { uploadChatAttachment } from '@/services/chatService';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';
import { ChatMessage, ChatThread } from '@/types';

function useScreenWidth() {
  const [width, setWidth] = useState(() => Dimensions.get('window').width);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setWidth(window.width));
    return () => sub?.remove();
  }, []);
  return width;
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function formatMessageDate(timestamp: string): string {
  // timestamp is a time string like "02:30 PM" — we use created_at ordering
  // We'll use a simple date separator based on the index group
  return timestamp;
}

// ── Date separator ────────────────────────────────────────────────────────────
function DateSeparator({ label }: { label: string }) {
  return (
    <View style={dateSt.wrap}>
      <View style={dateSt.line} />
      <View style={dateSt.pill}>
        <MaterialIcons name="schedule" size={9} color={Colors.textMuted} />
        <Text style={dateSt.text}>{label}</Text>
      </View>
      <View style={dateSt.line} />
    </View>
  );
}
const dateSt = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: Spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: Colors.borderSubtle },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  text: { fontSize: 9, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
});

// ── Attachment bubble ─────────────────────────────────────────────────────────
const AttachmentBubble = memo(({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) => {
  if (!msg.attachmentUrl) return null;
  if (msg.attachmentType === 'image') {
    return (
      <Pressable onPress={() => Linking.openURL(msg.attachmentUrl!)} style={styles.attachImgWrap}>
        <Image source={{ uri: msg.attachmentUrl }} style={styles.attachmentImage} contentFit="cover" transition={200} />
        <View style={styles.attachImgOverlay}>
          <MaterialIcons name="open-in-new" size={14} color="#fff" />
        </View>
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
      <View style={[styles.docIconWrap, isMe ? styles.docIconWrapMe : styles.docIconWrapThem]}>
        <MaterialIcons name="insert-drive-file" size={22} color={isMe ? Colors.primary : Colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.docName, isMe && styles.docNameMe]} numberOfLines={1}>{fileName}</Text>
        <Text style={styles.docTap}>Tap to open</Text>
      </View>
      <MaterialIcons name="open-in-new" size={14} color={isMe ? 'rgba(255,255,255,0.5)' : Colors.textMuted} />
    </Pressable>
  );
});

// ── Message read receipt ──────────────────────────────────────────────────────
function ReadReceipt({ read }: { read: boolean }) {
  return (
    <MaterialIcons
      name={read ? 'done-all' : 'done'}
      size={11}
      color={read ? '#58A6FF' : Colors.textMuted}
    />
  );
}

// ── Avatar circle ─────────────────────────────────────────────────────────────
function AvatarCircle({ name, size = 44, active = false }: { name: string; size?: number; active?: boolean }) {
  const initials = getInitials(name);
  const fontSize = size >= 40 ? FontSize.sm : FontSize.xs;
  return (
    <View style={[
      avatarSt.wrap,
      {
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: active ? Colors.primary : Colors.primaryGlow,
        borderColor: active ? Colors.primary : 'rgba(47,129,247,0.35)',
      },
    ]}>
      <Text style={[avatarSt.text, { fontSize, color: active ? '#fff' : Colors.primary }]}>{initials}</Text>
    </View>
  );
}
const avatarSt = StyleSheet.create({
  wrap: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  text: { fontWeight: '800' },
});

// ── Thread Card ───────────────────────────────────────────────────────────────
const ThreadCard = memo(({ thread, isActive, onPress }: {
  thread: ChatThread; isActive: boolean; onPress: () => void;
}) => {
  const hasUnread = thread.unreadCount > 0;
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.97, duration: 60, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }),
    ]).start();
    onPress();
  };

  return (
    <Pressable onPress={handlePress}>
      <Animated.View style={[
        threadSt.card,
        isActive && threadSt.cardActive,
        { transform: [{ scale }] },
      ]}>
        {hasUnread && !isActive && <View style={threadSt.unreadBar} />}

        <View style={threadSt.avatarWrap}>
          <AvatarCircle name={thread.driverName} size={46} active={isActive} />
          <View style={[threadSt.onlineDot, { backgroundColor: Colors.success }]} />
        </View>

        <View style={threadSt.content}>
          <View style={threadSt.row1}>
            <Text style={[threadSt.name, isActive && threadSt.nameActive, hasUnread && threadSt.nameUnread]} numberOfLines={1}>
              {thread.driverName}
            </Text>
            <Text style={[threadSt.time, hasUnread && threadSt.timeUnread, isActive && { color: Colors.primaryLight }]}>
              {thread.lastMessageTime}
            </Text>
          </View>

          <View style={threadSt.row2}>
            <View style={[threadSt.platePill, isActive && threadSt.platePillActive]}>
              <MaterialIcons name="local-shipping" size={9} color={isActive ? Colors.primary : Colors.textMuted} />
              <Text style={[threadSt.platePillText, isActive && { color: Colors.primaryLight }]}>{thread.driverPlate}</Text>
            </View>
            {thread.shipmentId && (
              <View style={threadSt.tirPill}>
                <MaterialIcons name="receipt" size={9} color={Colors.warning} />
                <Text style={threadSt.tirPillText}>Order Chat</Text>
              </View>
            )}
          </View>

          <View style={threadSt.row3}>
            <Text style={[threadSt.lastMsg, hasUnread && threadSt.lastMsgUnread]} numberOfLines={1}>
              {thread.lastMessage || 'No messages yet'}
            </Text>
          </View>
        </View>

        {hasUnread ? (
          <View style={threadSt.badge}>
            <Text style={threadSt.badgeText}>{thread.unreadCount > 9 ? '9+' : thread.unreadCount}</Text>
          </View>
        ) : (
          <MaterialIcons name="chevron-right" size={14} color={isActive ? Colors.primaryLight : Colors.textMuted} style={{ opacity: 0.5 }} />
        )}
      </Animated.View>
    </Pressable>
  );
});

const threadSt = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
    position: 'relative',
  },
  cardActive: { backgroundColor: 'rgba(47,129,247,0.08)', borderLeftWidth: 3, borderLeftColor: Colors.primary, paddingLeft: Spacing.lg - 3 },
  unreadBar: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: Colors.primary },
  avatarWrap: { position: 'relative', flexShrink: 0 },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: Colors.surface },
  content: { flex: 1, gap: 4, minWidth: 0 },
  row1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  name: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  nameActive: { color: Colors.primary, fontWeight: '700' },
  nameUnread: { fontWeight: '800', color: Colors.textPrimary },
  time: { fontSize: 9, color: Colors.textMuted, fontFamily: 'monospace', flexShrink: 0 },
  timeUnread: { color: Colors.primary, fontWeight: '700' },
  row2: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  platePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.border,
  },
  platePillActive: { backgroundColor: Colors.primaryGlow, borderColor: 'rgba(47,129,247,0.3)' },
  platePillText: { fontSize: 9, color: Colors.textMuted, fontFamily: 'monospace', fontWeight: '600' },
  tirPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: `${Colors.warning}12`, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.warning}30`,
  },
  tirPillText: { fontSize: 9, color: Colors.warning, fontWeight: '700' },
  row3: {},
  lastMsg: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 16 },
  lastMsgUnread: { color: Colors.textSecondary, fontWeight: '600' },
  badge: {
    backgroundColor: Colors.danger, borderRadius: 12, minWidth: 20, height: 20,
    paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
});

// ── Thread List Panel ─────────────────────────────────────────────────────────
const ThreadList = memo(({ threads, activeThreadId, totalUnread, onSelect, onRefresh, refreshing }: {
  threads: ChatThread[];
  activeThreadId: string | null;
  totalUnread: number;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(t =>
      t.driverName.toLowerCase().includes(q) ||
      t.driverPlate.toLowerCase().includes(q) ||
      (t.lastMessage ?? '').toLowerCase().includes(q)
    );
  }, [threads, search]);

  return (
    <View style={tlSt.root}>
      {/* Panel header */}
      <View style={tlSt.header}>
        <View style={tlSt.headerTop}>
          <View style={tlSt.headerLeft}>
            <View style={tlSt.headerIcon}>
              <MaterialIcons name="forum" size={12} color={Colors.primary} />
            </View>
            <Text style={tlSt.headerTitle}>CHANNELS</Text>
            <View style={tlSt.countPill}>
              <Text style={tlSt.countText}>{threads.length}</Text>
            </View>
          </View>
          {totalUnread > 0 && (
            <View style={tlSt.unreadSummary}>
              <View style={tlSt.unreadDot} />
              <Text style={tlSt.unreadSummaryText}>{totalUnread} new</Text>
            </View>
          )}
        </View>
        {/* Search */}
        <View style={tlSt.searchRow}>
          <MaterialIcons name="search" size={15} color={Colors.textMuted} />
          <TextInput
            style={tlSt.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search drivers..."
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={6}>
              <MaterialIcons name="close" size={14} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={tlSt.scroll}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          ) : undefined
        }
      >
        {threads.length === 0 ? (
          <View style={tlSt.empty}>
            <View style={tlSt.emptyIcon}>
              <MaterialIcons name="chat-bubble-outline" size={28} color={Colors.primary} />
            </View>
            <Text style={tlSt.emptyTitle}>No Conversations</Text>
            <Text style={tlSt.emptySub}>Chat channels open automatically when drivers are assigned to shipments.</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={tlSt.empty}>
            <MaterialIcons name="search-off" size={28} color={Colors.border} />
            <Text style={tlSt.emptyTitle}>No results</Text>
            <Text style={tlSt.emptySub}>No drivers match "{search}"</Text>
          </View>
        ) : (
          filtered.map(thread => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onPress={() => onSelect(thread.id)}
            />
          ))
        )}
        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
});

const tlSt = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  header: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingTop: Spacing.md, gap: Spacing.sm,
  },
  headerTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerIcon: {
    width: 20, height: 20, borderRadius: 6,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9 },
  countPill: {
    backgroundColor: Colors.primaryGlow, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  countText: { fontSize: 9, fontWeight: '700', color: Colors.primary },
  unreadSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: `${Colors.danger}35`,
  },
  unreadDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.danger },
  unreadSummaryText: { fontSize: 10, fontWeight: '700', color: Colors.danger },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 8, fontSize: FontSize.xs, color: Colors.textPrimary },
  scroll: { flex: 1 },
  empty: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 28, gap: Spacing.md },
  emptyIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  emptySub: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18, textAlign: 'center' },
});

// ── Quick replies ─────────────────────────────────────────────────────────────
const QUICK_REPLIES = [
  'Acknowledged ✓',
  'Proceed to destination',
  'Please update your location',
  'Contact customs office',
  'Await further instructions',
  'Call dispatch immediately',
  'Document required',
  'Shipment cleared',
];

// ── Main Chat Screen ───────────────────────────────────────────────────────────
export default function ChatScreen() {
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const { threads, activeThread, activeThreadId, setActiveThreadId, sendMessage, markRead, totalUnread, refresh } = useChat();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);
  const generalThreads = threads.filter(t => !t.shipmentId);
  const { t } = useLanguage();
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{
    url: string; type: 'image' | 'document'; name: string
  } | null>(null);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const screenWidth = useScreenWidth();
  const isDesktop = screenWidth >= 1024;

  const senderName = user?.displayName ?? 'Dispatch (MARAS)';
  const senderId = user?.id ?? 'admin-001';

  // Auto-select first thread on desktop
  useEffect(() => {
    if (isDesktop && !activeThreadId && generalThreads.length > 0) {
      setActiveThreadId(generalThreads[0].id);
      markRead(generalThreads[0].id);
    }
  }, [isDesktop, threads.length]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (activeThread?.messages.length) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [activeThread?.messages.length]);

  // Close menus on thread change
  useEffect(() => {
    setShowQuickReplies(false);
    setShowAttachMenu(false);
    setPendingAttachment(null);
  }, [activeThreadId]);

  const handleSelectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    markRead(threadId);
  }, [setActiveThreadId, markRead]);

  const handleSend = useCallback(async () => {
    if ((!message.trim() && !pendingAttachment) || !activeThreadId) return;
    const msgContent = message.trim();
    setMessage('');
    setPendingAttachment(null);
    setShowQuickReplies(false);
    // Note: sendMessage (ChatContext) already notifies the driver via push
    // when senderRole is 'admin' — do not duplicate that call here.
    await sendMessage(msgContent, senderId, senderName, 'admin', activeThreadId, pendingAttachment?.url, pendingAttachment?.type);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [message, pendingAttachment, activeThreadId, sendMessage, senderId, senderName]);

  const handlePickImage = useCallback(async () => {
    setShowAttachMenu(false);
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        setUploading(true);
        try {
          const { url, type, error } = await uploadChatAttachment({ uri: '', name: file.name, mimeType: file.type, rawFile: file }, senderId);
          if (error) { showAlert('Upload Failed', error); return; }
          if (url) setPendingAttachment({ url, type, name: file.name });
        } finally { setUploading(false); }
      };
      input.click(); return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permission Denied', 'Media library access is required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const { url, type, error } = await uploadChatAttachment({ uri: asset.uri, name: asset.fileName ?? `photo_${Date.now()}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg' }, senderId);
      if (error) { showAlert('Upload Failed', error); return; }
      if (url) setPendingAttachment({ url, type, name: asset.fileName ?? 'photo.jpg' });
    } finally { setUploading(false); }
  }, [senderId, showAlert]);

  const handlePickDocument = useCallback(async () => {
    setShowAttachMenu(false);
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        setUploading(true);
        try {
          const { url, type, error } = await uploadChatAttachment({ uri: '', name: file.name, mimeType: file.type, rawFile: file }, senderId);
          if (error) { showAlert('Upload Failed', error); return; }
          if (url) setPendingAttachment({ url, type, name: file.name });
        } finally { setUploading(false); }
      };
      input.click(); return;
    }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const { url, type, error } = await uploadChatAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' }, senderId);
      if (error) { showAlert('Upload Failed', error); return; }
      if (url) setPendingAttachment({ url, type, name: asset.name });
    } finally { setUploading(false); }
  }, [senderId, showAlert]);

  // ── Message grouping — add date separators ────────────────────────────────
  const groupedMessages = useMemo(() => {
    if (!activeThread) return [];
    const msgs = activeThread.messages;
    const result: Array<{ type: 'separator'; label: string } | { type: 'message'; msg: ChatMessage }> = [];
    if (msgs.length > 0) {
      result.push({ type: 'separator', label: 'Today' });
    }
    msgs.forEach(msg => result.push({ type: 'message', msg }));
    return result;
  }, [activeThread?.messages.length, activeThread?.id]);

  // ── Chat content ──────────────────────────────────────────────────────────
  const renderChatContent = () => {
    if (!activeThread) {
      return (
        <View style={styles.noChatSelected}>
          <View style={styles.noChatBg}>
            <View style={styles.noChatIcon}>
              <MaterialIcons name="forum" size={32} color={Colors.primary} />
            </View>
          </View>
          <Text style={styles.noChatTitle}>Select a Conversation</Text>
          <Text style={styles.noChatSub}>
            Choose a driver channel from the left panel to view and send messages.
          </Text>
          {generalThreads.length > 0 && (
            <View style={styles.noChatStats}>
              <View style={styles.noChatStatItem}>
                <Text style={styles.noChatStatVal}>{generalThreads.length}</Text>
                <Text style={styles.noChatStatLabel}>Channels</Text>
              </View>
              <View style={styles.noChatStatDiv} />
              <View style={styles.noChatStatItem}>
                <Text style={[styles.noChatStatVal, totalUnread > 0 && { color: Colors.danger }]}>{totalUnread}</Text>
                <Text style={styles.noChatStatLabel}>Unread</Text>
              </View>
            </View>
          )}
        </View>
      );
    }

    const msgCount = activeThread.messages.length;
    const adminMsgCount = activeThread.messages.filter(m => m.senderRole === 'admin').length;

    return (
      <>
        {/* ── Chat Header — desktop only; mobile uses mobileHeader ── */}
        {isDesktop && <View style={styles.chatHeader}>
          {!isDesktop && (
            <Pressable style={styles.backBtn} onPress={() => setActiveThreadId(null)}>
              <MaterialIcons name="arrow-back" size={18} color={Colors.textSecondary} />
            </Pressable>
          )}
          <View style={styles.chatHeaderAvatarWrap}>
            <AvatarCircle name={activeThread.driverName} size={40} active />
            <View style={styles.chatHeaderOnlineDot} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.chatHeaderName}>{activeThread.driverName}</Text>
            <View style={styles.chatHeaderMeta}>
              <View style={styles.chatHeaderPlatePill}>
                <MaterialIcons name="local-shipping" size={9} color={Colors.textMuted} />
                <Text style={styles.chatHeaderPlateText}>{activeThread.driverPlate}</Text>
              </View>
              <Text style={styles.chatHeaderDot}>·</Text>
              <Text style={styles.chatHeaderMsgCount}>
                {msgCount} message{msgCount !== 1 ? 's' : ''}
              </Text>
              {activeThread.shipmentId && (
                <>
                  <Text style={styles.chatHeaderDot}>·</Text>
                  <View style={styles.orderTag}>
                    <MaterialIcons name="receipt" size={9} color={Colors.warning} />
                    <Text style={styles.orderTagText}>Order Chat</Text>
                  </View>
                </>
              )}
            </View>
          </View>
          {/* Actions */}
          <View style={styles.chatHeaderActions}>
            <Pressable
              style={({ pressed }) => [styles.chatActionBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { setShowQuickReplies(v => !v); setShowAttachMenu(false); }}
            >
              <MaterialIcons name="bolt" size={16} color={showQuickReplies ? Colors.primary : Colors.textSecondary} />
            </Pressable>
            <Pressable style={({ pressed }) => [styles.chatActionBtn, pressed && { opacity: 0.7 }]}>
              <MaterialIcons name="more-vert" size={16} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </View>}


        {/* ── Driver info strip ── */}
        <View style={styles.driverInfoStrip}>
          {[
            { icon: 'chat' as const, label: 'Messages', value: String(msgCount), color: Colors.primary },
            { icon: 'reply' as const, label: 'From Dispatch', value: String(adminMsgCount), color: Colors.info },
            { icon: 'notifications-active' as const, label: 'Unread', value: String(activeThread.unreadCount), color: activeThread.unreadCount > 0 ? Colors.danger : Colors.success },
          ].map((item, i, arr) => (
            <React.Fragment key={item.label}>
              <View style={styles.driverInfoItem}>
                <MaterialIcons name={item.icon} size={11} color={item.color} />
                <Text style={[styles.driverInfoVal, { color: item.color }]}>{item.value}</Text>
                <Text style={styles.driverInfoLabel}>{item.label}</Text>
              </View>
              {i < arr.length - 1 && <View style={styles.driverInfoSep} />}
            </React.Fragment>
          ))}
        </View>

        {/* ── Quick Replies Drawer ── */}
        {showQuickReplies && (
          <View style={styles.quickRepliesDrawer}>
            <View style={styles.quickRepliesHeader}>
              <MaterialIcons name="bolt" size={11} color={Colors.primary} />
              <Text style={styles.quickRepliesTitle}>QUICK REPLIES</Text>
              <Pressable onPress={() => setShowQuickReplies(false)} hitSlop={8}>
                <MaterialIcons name="close" size={14} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRepliesRow}>
              {QUICK_REPLIES.map(qr => (
                <Pressable
                  key={qr}
                  style={({ pressed }) => [styles.quickReplyChip, pressed && { opacity: 0.75 }]}
                  onPress={() => {
                    setMessage(qr);
                    setShowQuickReplies(false);
                    setTimeout(() => inputRef.current?.focus(), 100);
                  }}
                >
                  <Text style={styles.quickReplyChipText}>{qr}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Messages ── */}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={styles.messagesList}>
            {msgCount === 0 && (
              <View style={styles.emptyConversation}>
                <View style={styles.emptyConvIcon}>
                  <MaterialIcons name="waving-hand" size={22} color={Colors.primary} />
                </View>
                <Text style={styles.emptyConvTitle}>Start the conversation</Text>
                <Text style={styles.emptyConvSub}>
                  Send the first message to {activeThread.driverName}.{'\n'}Use quick replies for common dispatch messages.
                </Text>
              </View>
            )}

            {groupedMessages.map((item, i) => {
              if (item.type === 'separator') {
                return <DateSeparator key={`sep-${i}`} label={item.label} />;
              }
              const msg = item.msg;
              const isMe = msg.senderRole === 'admin';
              const isLastFromSender = (() => {
                const nextItem = groupedMessages[i + 1];
                if (!nextItem || nextItem.type === 'separator') return true;
                return nextItem.msg.senderRole !== msg.senderRole;
              })();

              return (
                <View key={msg.id} style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowThem]}>
                  {!isMe && isLastFromSender && (
                    <View style={styles.msgAvatar}>
                      <Text style={styles.msgAvatarText}>{getInitials(msg.senderName)}</Text>
                    </View>
                  )}
                  {!isMe && !isLastFromSender && <View style={{ width: 28 }} />}

                  <View style={[styles.msgGroup, isMe && { alignItems: 'flex-end' }]}>
                    {msg.attachmentUrl ? <AttachmentBubble msg={msg} isMe={isMe} /> : null}
                    {msg.content && msg.content !== '📎 Attachment' && msg.content.trim() !== '' && (
                      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.content}</Text>
                      </View>
                    )}
                    <View style={[styles.bubbleMeta, isMe && { flexDirection: 'row-reverse' }]}>
                      <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{msg.timestamp}</Text>
                      {isMe && <ReadReceipt read={msg.read} />}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* ── Attach menu overlay ── */}
        {showAttachMenu && (
          <View style={styles.attachMenu}>
            {[
              { icon: 'photo-library' as const, label: 'Photo / Image', sub: 'From gallery', color: Colors.primary, onPress: handlePickImage },
              { icon: 'insert-drive-file' as const, label: 'Document', sub: 'PDF, Word, Excel…', color: Colors.info, onPress: handlePickDocument },
            ].map((opt, i) => (
              <React.Fragment key={opt.label}>
                {i > 0 && <View style={{ height: 1, backgroundColor: Colors.borderSubtle, marginHorizontal: Spacing.lg }} />}
                <Pressable style={({ pressed }) => [styles.attachMenuItem, pressed && { opacity: 0.8 }]} onPress={opt.onPress}>
                  <View style={[styles.attachMenuIcon, { backgroundColor: `${opt.color}15` }]}>
                    <MaterialIcons name={opt.icon} size={20} color={opt.color} />
                  </View>
                  <View>
                    <Text style={styles.attachMenuLabel}>{opt.label}</Text>
                    <Text style={styles.attachMenuSub}>{opt.sub}</Text>
                  </View>
                </Pressable>
              </React.Fragment>
            ))}
          </View>
        )}

        {/* ── Input Bar ── */}
        <View style={styles.inputBar}>
          {/* Pending attachment preview */}
          {pendingAttachment ? (
            <View style={styles.pendingAttachment}>
              {pendingAttachment.type === 'image' ? (
                <View style={styles.pendingImgThumb}>
                  <Image source={{ uri: pendingAttachment.url }} style={styles.pendingImg} contentFit="cover" transition={100} />
                </View>
              ) : (
                <MaterialIcons name="insert-drive-file" size={16} color={Colors.primary} />
              )}
              <Text style={styles.pendingAttachmentName} numberOfLines={1}>{pendingAttachment.name}</Text>
              <Pressable onPress={() => setPendingAttachment(null)} hitSlop={8}>
                <MaterialIcons name="close" size={16} color={Colors.textMuted} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.inputRow}>
            {/* Attach button */}
            <Pressable
              style={({ pressed }) => [styles.attachBtn, showAttachMenu && styles.attachBtnActive, pressed && { opacity: 0.7 }]}
              onPress={() => { setShowAttachMenu(v => !v); setShowQuickReplies(false); }}
              disabled={uploading}
            >
              {uploading
                ? <ActivityIndicator size={16} color={Colors.primary} />
                : <MaterialIcons name={showAttachMenu ? 'close' : 'attach-file'} size={20} color={showAttachMenu ? Colors.primary : Colors.textSecondary} />}
            </Pressable>

            {/* Quick replies toggle */}
            <Pressable
              style={({ pressed }) => [styles.attachBtn, showQuickReplies && styles.attachBtnActive, pressed && { opacity: 0.7 }]}
              onPress={() => { setShowQuickReplies(v => !v); setShowAttachMenu(false); }}
            >
              <MaterialIcons name="bolt" size={20} color={showQuickReplies ? Colors.primary : Colors.textSecondary} />
            </Pressable>

            <TextInput
              ref={inputRef}
              style={styles.chatInput}
              value={message}
              onChangeText={setMessage}
              placeholder={pendingAttachment ? 'Add a caption...' : 'Message driver...'}
              placeholderTextColor={Colors.textMuted}
              multiline
              blurOnSubmit={false}
              onSubmitEditing={handleSend}
            />

            <Pressable
              style={[styles.sendBtn, (!message.trim() && !pendingAttachment) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!message.trim() && !pendingAttachment}
            >
              <MaterialIcons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </>
    );
  };

  // ── Desktop layout ────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <StatusBar style="light" />

        <View style={styles.desktopHeader}>
          <View style={styles.desktopHeaderLeft}>
            <View style={styles.desktopHeaderIcon}>
              <MaterialIcons name="forum" size={18} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.desktopHeaderTitle}>{t('chat.title')}</Text>
              <Text style={styles.desktopHeaderSub}>
                {generalThreads.length} {t('chat.driverChannels')}
              </Text>
            </View>
          </View>
          <View style={styles.desktopHeaderRight}>
            {totalUnread > 0 && (
              <View style={styles.totalUnreadPill}>
                <View style={styles.totalUnreadDot} />
                <Text style={styles.totalUnreadText}>{totalUnread} unread</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.desktopBody}>
          <View style={styles.desktopThreadPanel}>
            <ThreadList
              threads={generalThreads}
              activeThreadId={activeThreadId}
              totalUnread={totalUnread}
              onSelect={handleSelectThread}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
          </View>
          <KeyboardAvoidingView style={styles.desktopChatPanel} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            {renderChatContent()}
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    );
  }

  // ── Mobile layout ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" />

      <View style={styles.mobileHeader}>
        <View style={styles.mobileHeaderLeft}>
          {activeThread ? (
            <Pressable style={styles.backBtn} onPress={() => setActiveThreadId(null)} hitSlop={8}>
              <MaterialIcons name="arrow-back" size={18} color={Colors.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.mobileHeaderIcon}>
              <MaterialIcons name="forum" size={16} color={Colors.primary} />
            </View>
          )}
          <View style={{ gap: 3 }}>
            <Text style={styles.mobileHeaderTitle} numberOfLines={1}>
              {activeThread ? activeThread.driverName : t('chat.title')}
            </Text>
            {activeThread ? (
              <View style={styles.mobileHeaderPlatePill}>
                <MaterialIcons name="local-shipping" size={10} color={Colors.primary} />
                <Text style={styles.mobileHeaderPlateText}>{activeThread.driverPlate}</Text>
              </View>
            ) : (
              <Text style={styles.mobileHeaderSub}>
                {`${generalThreads.length} ${t('chat.driverChannels')}`}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.mobileHeaderRight}>
          {totalUnread > 0 && !activeThread && (
            <View style={styles.totalUnreadPill}>
              <View style={styles.totalUnreadDot} />
              <Text style={styles.totalUnreadText}>{totalUnread} unread</Text>
            </View>
          )}
          {activeThread && (
            <Pressable
              style={({ pressed }) => [styles.chatActionBtn, showQuickReplies && styles.attachBtnActive, pressed && { opacity: 0.7 }]}
              onPress={() => { setShowQuickReplies(v => !v); setShowAttachMenu(false); }}
            >
              <MaterialIcons name="bolt" size={16} color={showQuickReplies ? Colors.primary : Colors.textSecondary} />
            </Pressable>
          )}
          {!activeThread && <LanguagePicker compact />}
        </View>
      </View>

      {!activeThread ? (
        <ThreadList
          threads={generalThreads}
          activeThreadId={activeThreadId}
          totalUnread={totalUnread}
          onSelect={handleSelectThread}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      ) : (
        <KeyboardAvoidingView style={styles.chatWrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
          {renderChatContent()}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  // ── Desktop ───────────────────────────────────────────────────────────────────
  desktopHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  desktopHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  desktopHeaderIcon: {
    width: 44, height: 44, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  desktopHeaderTitle: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  desktopHeaderSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  desktopHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  totalUnreadPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: `${Colors.danger}35`,
  },
  totalUnreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.danger },
  totalUnreadText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.danger },
  desktopBody: { flex: 1, flexDirection: 'row' },
  desktopThreadPanel: { width: 300, borderRightWidth: 1, borderRightColor: Colors.border },
  desktopChatPanel: { flex: 1, backgroundColor: Colors.bg },

  // ── Mobile ────────────────────────────────────────────────────────────────────
  mobileHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  mobileHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1, minWidth: 0 },
  mobileHeaderIcon: {
    width: 34, height: 34, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  mobileHeaderTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  mobileHeaderSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  mobileHeaderPlatePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignSelf: 'flex-start',
  },
  mobileHeaderPlateText: { fontSize: 9, color: Colors.primary, fontWeight: '700', fontFamily: 'monospace' },
  mobileHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 0 },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border, flexShrink: 0,
  },
  chatWrap: { flex: 1 },

  // ── Chat Header ───────────────────────────────────────────────────────────────
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chatHeaderAvatarWrap: { position: 'relative', flexShrink: 0 },
  chatHeaderOnlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.success, borderWidth: 1.5, borderColor: Colors.surface,
  },
  chatHeaderName: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  chatHeaderMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chatHeaderPlatePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.border,
  },
  chatHeaderPlateText: { fontSize: 9, color: Colors.textMuted, fontFamily: 'monospace', fontWeight: '600' },
  chatHeaderDot: { fontSize: 9, color: Colors.textMuted },
  chatHeaderMsgCount: { fontSize: FontSize.xs, color: Colors.textMuted },
  orderTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: `${Colors.warning}12`, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.warning}30`,
  },
  orderTagText: { fontSize: 9, color: Colors.warning, fontWeight: '700' },
  chatHeaderActions: { flexDirection: 'row', gap: Spacing.xs },
  chatActionBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // ── Driver info strip ─────────────────────────────────────────────────────────
  driverInfoStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingVertical: 9, paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  driverInfoItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  driverInfoVal: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textPrimary },
  driverInfoLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '600' },
  driverInfoSep: { width: 1, height: 18, backgroundColor: Colors.borderSubtle },

  // ── Quick Replies Drawer ──────────────────────────────────────────────────────
  quickRepliesDrawer: {
    backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  quickRepliesHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.lg, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  quickRepliesTitle: { flex: 1, fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9 },
  quickRepliesRow: {
    flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  quickReplyChip: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border,
    flexShrink: 0,
  },
  quickReplyChipText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },

  // ── Messages ──────────────────────────────────────────────────────────────────
  messages: { flex: 1, backgroundColor: Colors.bg },
  messagesList: { padding: Spacing.xl, gap: Spacing.sm, paddingBottom: Spacing.xl },

  // Empty conversation
  emptyConversation: {
    alignItems: 'center', gap: Spacing.md, paddingVertical: 48, paddingHorizontal: 32,
  },
  emptyConvIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyConvTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  emptyConvSub: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  // Message rows
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowThem: { justifyContent: 'flex-start' },
  msgAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  msgAvatarText: { fontSize: FontSize.xs, fontWeight: '800', color: Colors.primary },
  msgGroup: { gap: 3, maxWidth: 320 },
  msgSenderName: { fontSize: 10, color: Colors.textMuted, marginBottom: 1 },
  bubble: { borderRadius: BorderRadius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: FontSize.sm, color: Colors.textPrimary, lineHeight: 20 },
  bubbleTextMe: { color: '#fff' },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bubbleTime: { fontSize: 9, color: Colors.textMuted },
  bubbleTimeMe: { color: Colors.textMuted, textAlign: 'right' },

  // Attachments
  attachImgWrap: { position: 'relative', borderRadius: BorderRadius.lg, overflow: 'hidden' },
  attachmentImage: { width: 220, height: 160, borderRadius: BorderRadius.lg },
  attachImgOverlay: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14,
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
  },
  docBubble: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderRadius: BorderRadius.lg, padding: Spacing.md, borderWidth: 1, minWidth: 200,
  },
  docBubbleMe: { backgroundColor: 'rgba(47,129,247,0.18)', borderColor: 'rgba(47,129,247,0.35)' },
  docBubbleThem: { backgroundColor: Colors.card, borderColor: Colors.border },
  docIconWrap: { width: 40, height: 40, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center' },
  docIconWrapMe: { backgroundColor: 'rgba(47,129,247,0.15)' },
  docIconWrapThem: { backgroundColor: Colors.surface },
  docName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  docNameMe: { color: '#fff' },
  docTap: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },

  // ── Attach menu ───────────────────────────────────────────────────────────────
  attachMenu: {
    backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.border,
    ...Shadow.elevated,
  },
  attachMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: 13,
  },
  attachMenuIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  attachMenuLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  attachMenuSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  // ── Input bar ─────────────────────────────────────────────────────────────────
  inputBar: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface, paddingTop: Spacing.sm,
  },
  pendingAttachment: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.md, marginBottom: Spacing.sm,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  pendingImgThumb: {
    width: 36, height: 36, borderRadius: BorderRadius.sm, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  pendingImg: { width: 36, height: 36 },
  pendingAttachmentName: { flex: 1, fontSize: FontSize.xs, color: Colors.primary, fontWeight: '500' },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
  },
  attachBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  attachBtnActive: { backgroundColor: Colors.primaryGlow, borderColor: 'rgba(47,129,247,0.4)' },
  chatInput: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: FontSize.sm, color: Colors.textPrimary, maxHeight: 110,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: Colors.border },

  // ── No chat selected ──────────────────────────────────────────────────────────
  noChatSelected: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, padding: 60 },
  noChatBg: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  noChatIcon: {},
  noChatTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  noChatSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  noChatStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.xxl, paddingVertical: Spacing.lg,
    gap: Spacing.xxl,
  },
  noChatStatItem: { alignItems: 'center', gap: 4 },
  noChatStatVal: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.primary },
  noChatStatLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  noChatStatDiv: { width: 1, height: 32, backgroundColor: Colors.borderSubtle },
});
