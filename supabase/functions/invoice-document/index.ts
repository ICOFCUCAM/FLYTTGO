// ============================================================================
// FlyttGo — invoice-document Edge Function
// ============================================================================
//
// Downloads an issued invoice or credit note as PDF or EHF (Peppol BIS
// Billing 3.0 XML). The caller must be allowed to read it: the company's
// owner, admin or finance, or a FlyttGo administrator. The check is
// row-level security on the caller's own read.
//
//   POST /functions/v1/invoice-document
//   Authorization: Bearer <access token>
//   { "invoiceId": "<uuid>", "format": "pdf" | "ehf" }
//
// DEPLOY: supabase functions deploy invoice-document --no-verify-jwt
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getCaller, serviceClient, userClient } from '../_shared/auth.ts';
import { fileName, loadInvoice, renderEhf, renderPdf } from '../_shared/invoice-data.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Headers':  'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':  'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const db = serviceClient();
  if (!(await getCaller(req, db))) return json({ error: 'Sign in required' }, 401);

  let body: { invoiceId?: string; format?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body?.invoiceId) return json({ error: 'invoiceId is required' }, 400);

  /* The caller's own read decides access (RLS: can_read_invoice). */
  const { data: visible } = await userClient(req).from('invoices').select('id').eq('id', body.invoiceId).maybeSingle();
  if (!visible) return json({ error: 'invoice not found' }, 404);

  const li = await loadInvoice(db, body.invoiceId);
  if (!li) return json({ error: 'invoice not found' }, 404);
  if (body.format === 'ehf') {
    return new Response(renderEhf(li), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName(li.invoice, 'xml')}"` } });
  }
  const pdf = await renderPdf(db, li);
  return new Response(new Blob([pdf as BlobPart]), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${fileName(li.invoice, 'pdf')}"` } });
});
