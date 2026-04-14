import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface Notification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link_page: string | null;
  link_id: string | null;
  read_at: string | null;
  created_at: string;
}

interface Result {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAllRead: () => Promise<void>;
}

const PAGE_SIZE = 20;

/**
 * useNotifications
 *
 * Subscribes the current user to their notifications row stream.
 *
 *   1. On mount, fetches the most recent PAGE_SIZE rows.
 *   2. Subscribes to INSERT events on public.notifications filtered
 *      by user_id = userId so new ones appear without polling.
 *   3. Exposes markAllRead() which UPDATEs read_at on every unread
 *      row in the local state (the DB triggers don't touch read_at,
 *      that's a UI concern).
 *
 * Requires:
 *   - public.notifications table (see docs/notifications-migration.sql)
 *   - public.notifications added to the supabase_realtime publication
 *   - notifications_self_select / notifications_self_update RLS
 *     policies allowing user_id = auth.uid()
 *
 * If any of those aren't applied yet, this hook silently returns an
 * empty list — it never crashes the header.
 */
export function useNotifications(userId: string | null | undefined): Result {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  /* Initial fetch + realtime subscription */
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          /* notifications table might not exist yet — that's fine,
           * the header will just show the empty state. */
          // eslint-disable-next-line no-console
          console.warn('[useNotifications] fetch failed (table not ready?):', error.message);
          setNotifications([]);
        } else {
          setNotifications((data as Notification[]) ?? []);
        }
        setLoading(false);
      });

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Notification;
          setNotifications((prev) => [row, ...prev].slice(0, PAGE_SIZE));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;

    /* Optimistic UI */
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));

    try {
      await supabase
        .from('notifications')
        .update({ read_at: now })
        .in('id', unreadIds)
        .eq('user_id', userId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[useNotifications] markAllRead failed:', err);
    }
  }, [userId, notifications]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return { notifications, unreadCount, loading, markAllRead };
}
