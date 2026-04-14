// ============================================================================
// FlyttGo — send-booking-email Edge Function
// ============================================================================
//
// Sends transactional emails for booking lifecycle events using Resend.
//
// DEPLOY:
//   supabase functions deploy send-booking-email --no-verify-jwt
//
// SECRETS REQUIRED (set in Supabase dashboard → Project Settings → Edge
// Function Secrets, NOT in this file):
//   RESEND_API_KEY    — your Resend API key (re_... from resend.com/api-keys)
//   FLYTTGO_FROM      — verified sender email (e.g. "FlyttGo <bookings@flyttgo.no>")
//   FLYTTGO_REPLY_TO  — reply-to address (e.g. "support@flyttgo.no")
//
// USAGE (called from frontend):
//   await fetch(supabaseFunctionUrl('send-booking-email'), {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       template: 'booking_confirmed',  // or driver_assigned | delivery_complete | reset_password
//       to: 'customer@example.com',
//       bookingId: 'uuid',
//       data: { ... template-specific fields ... },
//     }),
//   });
//
// USAGE (called from a Postgres trigger via pg_net):
//   PERFORM net.http_post(
//     url := 'https://<project-ref>.supabase.co/functions/v1/send-booking-email',
//     body := jsonb_build_object('template','booking_confirmed','to', NEW.customer_email, ...)
//   );
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

interface EmailRequest {
  template: 'booking_confirmed' | 'driver_assigned' | 'delivery_complete' | 'payment_released' | 'reset_password';
  to: string;
  bookingId?: string;
  data?: Record<string, unknown>;
}

const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY');
const FLYTTGO_FROM     = Deno.env.get('FLYTTGO_FROM')     ?? 'FlyttGo <bookings@flyttgo.no>';
const FLYTTGO_REPLY_TO = Deno.env.get('FLYTTGO_REPLY_TO') ?? 'support@flyttgo.no';

// ─────────────────────────────────────────────────────────────────────────────
// Templates — keep these short and inline. When you outgrow this file, move
// each template to its own .ts file or to a static S3 bucket.
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateOutput { subject: string; html: string; text: string }

function tplBookingConfirmed(d: Record<string, unknown>): TemplateOutput {
  const pickup   = String(d.pickupAddress  ?? 'TBC');
  const dropoff  = String(d.dropoffAddress ?? 'TBC');
  const moveDate = String(d.moveDate       ?? 'TBC');
  const price    = String(d.price          ?? '—');
  return {
    subject: 'Your FlyttGo booking is confirmed',
    text: `Thanks for booking with FlyttGo!\n\nPickup: ${pickup}\nDelivery: ${dropoff}\nDate: ${moveDate}\nEstimated price: ${price} NOK\n\nWe'll email you again as soon as a verified driver picks up your job.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: auto; color: #1a1a1a;">
        <div style="background: linear-gradient(135deg, #1A365D, #059669); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 22px;">Booking confirmed</h1>
          <p style="margin: 4px 0 0; opacity: 0.85; font-size: 14px;">FlyttGo · Norway's #1 moving marketplace</p>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: 0; padding: 24px; border-radius: 0 0 12px 12px;">
          <p>Thanks for booking with FlyttGo. We're matching you with a verified driver now — you'll get another email the moment they accept.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px 0; color: #6b7280;">Pickup</td><td style="padding: 8px 0; font-weight: 600;">${pickup}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280;">Delivery</td><td style="padding: 8px 0; font-weight: 600;">${dropoff}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280;">Date</td><td style="padding: 8px 0; font-weight: 600;">${moveDate}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280;">Estimated price</td><td style="padding: 8px 0; font-weight: 600;">${price} NOK</td></tr>
          </table>
          <a href="https://flyttgo.no/my-bookings" style="display: inline-block; padding: 12px 24px; background: #059669; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">View your booking</a>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">FlyttGo AS · Org. nr. NO 000 000 000</p>
        </div>
      </div>
    `,
  };
}

function tplDriverAssigned(d: Record<string, unknown>): TemplateOutput {
  const driverName = String(d.driverName ?? 'A FlyttGo driver');
  return {
    subject: 'A driver has accepted your FlyttGo job',
    text: `Good news — ${driverName} has accepted your booking. You can chat with them in the FlyttGo app any time before pickup.`,
    html: `<div style="font-family: sans-serif;"><h1>Driver assigned</h1><p>${driverName} has accepted your booking. You can chat with them in the FlyttGo app any time before pickup.</p></div>`,
  };
}

function tplDeliveryComplete(_d: Record<string, unknown>): TemplateOutput {
  return {
    subject: 'Your FlyttGo delivery is complete',
    text: 'Your delivery is complete. Please confirm in the app to release payment to your driver.',
    html: '<div style="font-family: sans-serif;"><h1>Delivery complete</h1><p>Please confirm in the app to release payment to your driver.</p></div>',
  };
}

function tplPaymentReleased(d: Record<string, unknown>): TemplateOutput {
  const amount = String(d.amount ?? '—');
  return {
    subject: 'Payment released — FlyttGo',
    text: `Your wallet has been credited ${amount} NOK. Withdraw any time from the FlyttGo driver portal.`,
    html: `<div style="font-family: sans-serif;"><h1>Payment released</h1><p>Your wallet has been credited <strong>${amount} NOK</strong>.</p></div>`,
  };
}

function tplResetPassword(d: Record<string, unknown>): TemplateOutput {
  const link = String(d.resetLink ?? 'https://flyttgo.no/');
  return {
    subject: 'Reset your FlyttGo password',
    text: `Click here to reset your FlyttGo password: ${link}`,
    html: `<div style="font-family: sans-serif;"><h1>Reset your password</h1><p><a href="${link}">Click here to reset your FlyttGo password</a>. Link valid for 1 hour.</p></div>`,
  };
}

function buildTemplate(template: EmailRequest['template'], data: Record<string, unknown> = {}): TemplateOutput {
  switch (template) {
    case 'booking_confirmed': return tplBookingConfirmed(data);
    case 'driver_assigned':   return tplDriverAssigned(data);
    case 'delivery_complete': return tplDeliveryComplete(data);
    case 'payment_released':  return tplPaymentReleased(data);
    case 'reset_password':    return tplResetPassword(data);
    default: throw new Error(`Unknown template: ${template}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 });
  }

  let body: EmailRequest;
  try {
    body = await req.json() as EmailRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (!body.template || !body.to) {
    return new Response(JSON.stringify({ error: 'template and to are required' }), { status: 400 });
  }

  let tpl: TemplateOutput;
  try {
    tpl = buildTemplate(body.template, body.data ?? {});
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:     FLYTTGO_FROM,
      to:       [body.to],
      reply_to: FLYTTGO_REPLY_TO,
      subject:  tpl.subject,
      html:     tpl.html,
      text:     tpl.text,
      tags: [
        { name: 'template',   value: body.template },
        { name: 'booking_id', value: body.bookingId ?? 'none' },
      ],
    }),
  });

  if (!resendRes.ok) {
    const text = await resendRes.text();
    return new Response(JSON.stringify({ error: 'Resend API error', detail: text }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const data = await resendRes.json();
  return new Response(JSON.stringify({ ok: true, id: data.id }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
});
