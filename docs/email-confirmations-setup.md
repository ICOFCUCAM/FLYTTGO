# Email confirmations — setup

The `supabase/functions/send-booking-email/index.ts` Edge Function is
ready to deploy but needs a Resend account and three Supabase secrets
to actually send mail.

## 1. Resend account

1. Sign up at <https://resend.com> (free tier: 3 000 emails/month, 100/day).
2. **Add a domain** → enter `flyttgo.no` (or whichever you own).
3. Add the DNS records Resend gives you (TXT for SPF, CNAMEs for DKIM)
   to your DNS host. Wait for them to verify (~5 min).
4. Once the domain shows green, go to <https://resend.com/api-keys>
   and create a new API key with **Sending Access** scope. Copy the
   `re_…` value.

## 2. Supabase secrets

In Supabase Dashboard → your project → **Project Settings → Edge
Functions → Secrets**, add:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | `re_…` from step 1 |
| `FLYTTGO_FROM` | `FlyttGo <bookings@flyttgo.no>` |
| `FLYTTGO_REPLY_TO` | `support@flyttgo.no` |

## 3. Deploy the function

From a checkout of this repo (with the Supabase CLI installed and
`supabase login` done):

```bash
supabase functions deploy send-booking-email --no-verify-jwt
```

`--no-verify-jwt` is fine here because the function is called from
both signed-in browser sessions AND from Postgres triggers (which
have no JWT). Authentication is handled implicitly via the
`anon`/`service_role` key on the request.

## 4. Wire up Postgres triggers (the actual sending)

The function above is a transport — it doesn't decide *when* to send.
The cleanest way to fire it on real events is from Postgres triggers
using `pg_net.http_post`. Run this in the Supabase SQL editor once
the function is deployed:

```sql
-- One-time enable
create extension if not exists pg_net with schema extensions;

-- Helper: post to the function with a JSON body
create or replace function public.send_booking_email(
  p_template text,
  p_to       text,
  p_booking  uuid,
  p_data     jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
begin
  v_url := current_setting('app.functions_url', true)
        || '/send-booking-email';
  perform extensions.http_post(
    url := v_url,
    body := jsonb_build_object(
      'template',  p_template,
      'to',        p_to,
      'bookingId', p_booking,
      'data',      p_data
    )::text,
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
exception when others then
  -- Never let an email failure block a booking insert.
  raise warning '[send_booking_email] %', sqlerrm;
end $$;

-- Then point app.functions_url at your project URL once:
alter database postgres set app.functions_url
  = 'https://<project-ref>.supabase.co/functions/v1';
```

Then add per-event triggers:

```sql
-- Booking confirmed → email customer
create or replace function public.email_on_booking_confirmed()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if NEW.status = 'pending' and NEW.customer_email is not null then
    perform public.send_booking_email(
      'booking_confirmed',
      NEW.customer_email,
      NEW.id,
      jsonb_build_object(
        'pickupAddress',  NEW.pickup_address,
        'dropoffAddress', NEW.dropoff_address,
        'moveDate',       NEW.move_date,
        'price',          NEW.price_estimate
      )
    );
  end if;
  return NEW;
end $$;

create trigger trg_email_on_booking_confirmed
  after insert on public.bookings
  for each row execute function public.email_on_booking_confirmed();

-- Driver assigned → email customer
create or replace function public.email_on_driver_assigned()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if NEW.driver_id is not null and OLD.driver_id is null
     and NEW.customer_email is not null then
    perform public.send_booking_email(
      'driver_assigned', NEW.customer_email, NEW.id,
      '{}'::jsonb
    );
  end if;
  return NEW;
end $$;

create trigger trg_email_on_driver_assigned
  after update on public.bookings
  for each row execute function public.email_on_driver_assigned();

-- Escrow released → email driver
create or replace function public.email_on_payment_released()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_driver_email text;
begin
  if NEW.status = 'released' and OLD.status <> 'released' then
    select u.email into v_driver_email
    from auth.users u
    join public.bookings b on b.driver_id = u.id
    where b.id = NEW.booking_id;
    if v_driver_email is not null then
      perform public.send_booking_email(
        'payment_released', v_driver_email, NEW.booking_id,
        jsonb_build_object('amount', NEW.driver_earning)
      );
    end if;
  end if;
  return NEW;
end $$;

create trigger trg_email_on_payment_released
  after update on public.escrow_payments
  for each row execute function public.email_on_payment_released();
```

## 5. Test

From the Supabase SQL editor:

```sql
select public.send_booking_email(
  'booking_confirmed',
  'your-real-email@example.com',
  gen_random_uuid(),
  jsonb_build_object(
    'pickupAddress',  'Karl Johans gate 12, Oslo',
    'dropoffAddress', 'Bryggen 3, Bergen',
    'moveDate',       '2026-05-01',
    'price',          '4500'
  )
);
```

You should get the formatted email in the inbox you specified within
a few seconds. If it doesn't arrive, check Supabase Edge Functions →
**Logs** for the function output.

## Cost ballpark

Resend free tier covers ~100 bookings/day. After that it's $20/month
for 50 000 emails — still trivially cheap for a moving marketplace.

## Future templates

Add new templates by adding another `tpl<Name>()` function in
`index.ts` and a new case in `buildTemplate()`. Keep the inline HTML
small — when you outgrow it, move templates to React Email components
or to a service like Mailmodo / Loops.
