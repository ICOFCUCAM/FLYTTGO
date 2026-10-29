// ============================================================================
// FlyttGo — invoice-send Edge Function
// ============================================================================
//
// A FlyttGo administrator sends (or sends again) an issued invoice or
// credit note to the company's billing email: PDF with the EHF file. A
// company sends its own invoices (00011) to its customers the same way:
// its owners, admins and finance; the email carries the company's name.
//
//   POST /functions/v1/invoice-send
//   Authorization: Bearer <administrator's, or the company's, access token>
//   { "invoiceId": "<uuid>", "purpose": "invoice" | "reminder" }   (reminder: the latest recorded one)
//
// DEPLOY: supabase functions deploy invoice-send --no-verify-jwt
// Secrets: RESEND_API_KEY, FLYTTGO_FROM, FLYTTGO_REPLY_TO.
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient } from '../_shared/auth.ts';
import { emailInvoice, loadInvoice } from '../_shared/invoice-data.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const db = serviceClient();
  const caller = await getCaller(req, db);
  if (!caller)         return json({ error: 'Sign in required' }, 401);
  let body: { invoiceId?: string; purpose?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const li = body?.invoiceId ? await loadInvoice(db, body.invoiceId) : null;
  if (!li) return json({ error: 'invoice not found or not issued' }, 404);
  /* FlyttGo's invoices: its administrators. A company's own invoices
   * (00011): the company's owners, admins and finance. */
  if (li.invoice.issuer_org) {
    const { data: m } = await db.from('organization_members').select('role')
      .eq('organization_id', li.invoice.issuer_org).eq('user_id', caller.id).eq('status', 'active').maybeSingle();
    if (!['owner', 'admin', 'finance'].includes(m?.role ?? '')) return json({ error: 'the company\'s owners, admins and finance only' }, 403);
  } else if (!caller.isAdmin) {
    return json({ error: 'Administrators only' }, 403);
  }
  const err = body.purpose === 'reminder'
    ? await emailInvoice(db, li, 'reminder', { reminderLevel: li.invoice.reminder_level ?? 0 })
    : await emailInvoice(db, li, 'invoice', { resend: true });
  return err ? json({ error: err }, 502) : json({ ok: true, sentTo: li.invoice.buyer.email });
});
