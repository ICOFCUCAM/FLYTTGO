# Notifications — spec and wiring plan

The notifications bell in the header currently renders an empty state
("You're all caught up") because there's no backing table. This doc
sketches a minimal implementation you can run in Supabase and then a
short checklist for wiring the frontend to it.

## 1. Schema

```sql
CREATE TABLE public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,  -- 'booking_status' | 'payment' | 'chat' | 'admin' | 'system'
  title      text not null,
  body       text,
  link_page  text,            -- Page enum value from store.tsx, optional
  link_id    uuid,            -- contextual id (booking_id, chat_room_id, etc)
  read_at    timestamptz,     -- null = unread
  created_at timestamptz default now()
);

CREATE INDEX ON public.notifications (user_id, created_at desc);
CREATE INDEX ON public.notifications (user_id, read_at);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_self_select ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admins can see/write everything (relies on public.is_admin() from
-- admin-rls-policies.sql).
CREATE POLICY notifications_admin_all ON public.notifications
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
```

## 2. Event sources (what produces notifications)

Build these as Postgres triggers so the frontend doesn't have to
remember to fire them. One trigger per event type:

- **`bookings` status change** → insert a `booking_status` notification
  for the customer (and, if `driver_id` is set, the driver).
- **`escrow_payments.status` → 'released'** → insert a `payment`
  notification for the driver.
- **`driver_applications.status` → 'approved' | 'rejected'** → insert
  a notification for the applicant.
- **`chat_messages` insert** → insert a `chat` notification for the
  other participant(s) of the room.

All of these can live in a single `SECURITY DEFINER` function per
source table, following the pattern of the existing
`release_booking_escrow_after_confirmation` trigger.

## 3. Realtime

Add `public.notifications` to the Supabase realtime publication:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
```

Then the frontend can subscribe to `postgres_changes` filtered by
`user_id = auth.uid()` and push rows into React state without polling.

## 4. Frontend wiring (what changes in `Header.tsx`)

The current bell is a UI stub. Replace the empty state with:

```tsx
// In Header.tsx, alongside the other state hooks
const [notifs, setNotifs] = useState<Notif[]>([]);
const unreadCount = notifs.filter(n => !n.read_at).length;

useEffect(() => {
  if (!user) return;
  let cancelled = false;
  supabase.from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
    .then(({ data }) => { if (!cancelled && data) setNotifs(data); });
  const channel = supabase.channel(`notif-${user.id}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}` },
      (payload) => setNotifs(prev => [payload.new as Notif, ...prev]))
    .subscribe();
  return () => { cancelled = true; supabase.removeChannel(channel); };
}, [user]);
```

Then:

- On bell click: mark all visible notifications as read
  (`update({ read_at: new Date().toISOString() })` where `read_at is
  null`).
- On list item click: `handleNav(notif.link_page)` if set.
- Badge: red dot on the bell when `unreadCount > 0`.

## 5. Cleanup

- Cron (Supabase scheduled function) that deletes notifications older
  than 30 days to keep the table small.
- Respect the user's `profiles.language` to localize `title` / `body`
  (store keys + args, render in the client).

## Why this is blocked right now

You don't yet have a `notifications` table in the DB, and the four
trigger functions above haven't been written. Once you decide the
schema above works for you, I can write all of it (SQL for the table
+ triggers, and the frontend wiring) in one pass.
