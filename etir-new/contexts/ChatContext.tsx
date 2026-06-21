import React, { createContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { ChatThread, UserRole } from '@/types';
import {
  fetchAllThreads, sendChatMessage, markThreadRead, ensureDriverThread,
  ensureShipmentThread, fetchShipmentThread,
} from '@/services/chatService';
import {
  sendLocalNotification, fetchAdminPushTokens, notifyAdminNewMessage,
  fetchDriverPushToken, notifyDriverNewMessage,
} from '@/services/notificationService';
import { supabase } from '@/services/supabaseClient';

function isAdminEmail(email: string | null | undefined): boolean {
  const e = email ?? '';
  return e.endsWith('@marasgroup.com') || e.endsWith('@maras.iq');
}

interface ChatContextType {
  threads: ChatThread[];
  loading: boolean;
  activeThreadId: string | null;
  activeThread: ChatThread | null;
  totalUnread: number;
  setActiveThreadId: (id: string | null) => void;
  sendMessage: (
    content: string,
    senderId: string,
    senderName: string,
    senderRole: UserRole,
    threadId?: string,
    attachmentUrl?: string,
    attachmentType?: 'image' | 'document'
  ) => Promise<void>;
  markRead: (threadId: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Ensure a thread exists for the logged-in driver, returns the thread id */
  initDriverThread: (driverId: string, driverName: string, plateNumber: string) => Promise<string | null>;
  /** Ensure an order-specific thread exists for a shipment, returns the thread id */
  initShipmentThread: (shipmentId: string, tirNumber: string, driverId: string, driverName: string, plateNumber: string) => Promise<string | null>;
  /** Fetch messages for a specific shipment thread (by shipmentId) */
  getShipmentThread: (shipmentId: string) => Promise<void>;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Track previous unread counts to detect new messages for admin notification.
  // Initialised to null so the FIRST poll never fires stale notifications.
  const prevUnreadRef = useRef<Record<string, number> | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { threads: data } = await fetchAllThreads();
    setThreads(data);
    // Seed ref on first load so the initial poll baseline is correct
    if (prevUnreadRef.current === null) {
      prevUnreadRef.current = Object.fromEntries(data.map(t => [t.id, t.unreadCount]));
    }
    setLoading(false);
  }, []);

  // fetchAllThreads() returns every driver's conversation with dispatch —
  // only an admin session should trigger that bulk fetch. Driver sessions
  // populate `threads` via the targeted initDriverThread/getShipmentThread
  // calls below instead (each driver only ever fetches their own thread(s)).
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      const admin = isAdminEmail(session?.user?.email);
      setIsAdmin(admin);
      if (admin) load();
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && isAdminEmail(session?.user?.email)) {
        setIsAdmin(true);
        load();
      } else if (event === 'SIGNED_OUT') {
        setIsAdmin(false);
        setThreads([]);
        prevUnreadRef.current = null;
        setLoading(false);
      }
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [load]);

  // Poll every 10 seconds for new messages + notify admin only when thread is not active
  // (admin sessions only — see gating above).
  useEffect(() => {
    if (!isAdmin) return;
    const interval = setInterval(async () => {
      const { threads: freshThreads } = await fetchAllThreads();

      // Detect new messages arriving for the admin.
      // Only fire a push notification when:
      //   1. The unread count actually increased (new message arrived), AND
      //   2. The admin is NOT currently viewing that thread (activeThreadId !== thread.id)
      // This prevents spamming notifications while the admin is actively reading.
      // prevUnreadRef starts as null — skip notification check until baseline is seeded
      const prev = prevUnreadRef.current;
      const notifyThreads = prev === null ? [] : freshThreads.filter(thread => {
        const prevCount = prev[thread.id] ?? 0;
        return thread.unreadCount > prevCount && thread.id !== activeThreadId;
      });

      if (notifyThreads.length > 0) {
        // Fetch admin tokens once, then fire notifications for each new-message thread
        const adminTokens = await fetchAdminPushTokens();
        for (const thread of notifyThreads) {
          const preview = thread.lastMessage || 'New message';
          await notifyAdminNewMessage(thread.driverName, preview, adminTokens);
        }
      }

      // Update the ref with latest unread counts (never reset back to null)
      prevUnreadRef.current = Object.fromEntries(freshThreads.map(t => [t.id, t.unreadCount]));

      setThreads(freshThreads);
      setLoading(false);
    }, 10000);
    return () => clearInterval(interval);
  }, [activeThreadId, isAdmin]);

  const activeThread = activeThreadId
    ? threads.find(t => t.id === activeThreadId) ?? null
    : null;

  const totalUnread = threads.reduce((acc, t) => acc + t.unreadCount, 0);

  const sendMessage = useCallback(async (
    content: string,
    senderId: string,
    senderName: string,
    senderRole: UserRole,
    threadId?: string,
    attachmentUrl?: string,
    attachmentType?: 'image' | 'document'
  ) => {
    const targetId = threadId ?? activeThreadId;
    if (!targetId || (!content.trim() && !attachmentUrl)) return;

    // Optimistic update — starts unread; flips to read once the recipient
    // actually opens the thread (see markRead), matching the DB default.
    const newMsg = {
      id: `msg-${Date.now()}`,
      senderId,
      senderName,
      senderRole,
      content: content.trim() || (attachmentUrl ? '📎 Attachment' : ''),
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      read: false,
      attachmentUrl,
      attachmentType,
    };

    setThreads(prev =>
      prev.map(t =>
        t.id === targetId
          ? { ...t, messages: [...t.messages, newMsg], lastMessage: newMsg.content, lastMessageTime: newMsg.timestamp }
          : t
      )
    );

    // Persist to DB
    await sendChatMessage(targetId, senderId, senderName, senderRole, content, attachmentUrl, attachmentType);

    // Notify the driver when admin sends a message
    if (senderRole === 'admin') {
      const thread = threads.find(t => t.id === targetId);
      if (thread?.driverId) {
        const preview = content.trim() || (attachmentUrl ? '📎 Attachment' : '');
        fetchDriverPushToken(thread.driverId)
          .then(token => notifyDriverNewMessage(preview, token))
          .catch(() => {});
      }
    }
  }, [activeThreadId, threads]);

  const markRead = useCallback(async (threadId: string) => {
    setThreads(prev =>
      prev.map(t =>
        t.id === threadId
          ? { ...t, unreadCount: 0, messages: t.messages.map(m => ({ ...m, read: true })) }
          : t
      )
    );
    await markThreadRead(threadId);
  }, []);

  const initShipmentThread = useCallback(async (
    shipmentId: string,
    tirNumber: string,
    driverId: string,
    driverName: string,
    plateNumber: string,
  ): Promise<string | null> => {
    const { thread, error } = await ensureShipmentThread(shipmentId, tirNumber, driverId, driverName, plateNumber);
    if (error) console.warn('[chat] ensureShipmentThread error:', error);
    if (thread) {
      setThreads(prev => {
        const exists = prev.find(t => t.id === thread.id);
        if (exists) return prev.map(t => t.id === thread.id ? { ...thread } : t);
        return [thread, ...prev];
      });
      return thread.id;
    }
    return null;
  }, []);

  const getShipmentThread = useCallback(async (shipmentId: string): Promise<void> => {
    const { thread } = await fetchShipmentThread(shipmentId);
    if (thread) {
      setThreads(prev => {
        const exists = prev.find(t => t.id === thread.id);
        if (exists) return prev.map(t => t.id === thread.id ? { ...thread } : t);
        return [thread, ...prev];
      });
    }
  }, []);

  const initDriverThread = useCallback(async (driverId: string, driverName: string, plateNumber: string): Promise<string | null> => {
    const { thread, error } = await ensureDriverThread(driverId, driverName, plateNumber);
    if (error) console.warn('[chat] ensureDriverThread error:', error);
    if (thread) {
      // Merge into threads state if not already present
      setThreads(prev => {
        const exists = prev.find(t => t.id === thread.id);
        if (exists) {
          // Update it with linked driver_id
          return prev.map(t => t.id === thread.id ? { ...thread } : t);
        }
        return [thread, ...prev];
      });
      return thread.id;
    }
    return null;
  }, []);

  return (
    <ChatContext.Provider value={{
      threads, loading, activeThreadId, activeThread, totalUnread,
      setActiveThreadId, sendMessage, markRead, refresh: load, initDriverThread,
      initShipmentThread, getShipmentThread,
    }}>
      {children}
    </ChatContext.Provider>
  );
}
