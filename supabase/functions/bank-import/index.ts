// ============================================================================
// FlyttGo — bank-import Edge Function
// ============================================================================
//
// Bank files on the server (migration 00016, docs/INVOICING.md → Bank
// import). Takes a Nets OCR giro file or a camt.054 / camt.053 file, checks
// it with the same parser as the browser (_shared/bank-files.ts), and
// previews or imports it through the database functions, which decide who
// may import for which series and count each bank transaction once.
//
//   POST /functions/v1/bank-import
//   Authorization: Bearer <access token>       a FlyttGo administrator (its own
//                                              invoices) or a company's owner,
//                                              admin or finance (its series),
//                  or Bearer <service role key> (the server, e.g. a relay
//                                              that collects files from the bank)
//   { "organizationId": null | "<uuid>", "fileName": "OCR.D311026.txt",
//     "content": "<the file as text>" | "contentBase64": "<the bytes>",
//     "dryRun": true }                         → the preview, nothing recorded
//
//   { "action": "fetch" }                      service role key only: for each
//                                              series whose settings switch the
//                                              automatic fetch on, ask its
//                                              provider's adapter for new files
//                                              and import them.
//
// No bank or Nets agreement exists yet, so no adapter is connected: a fetch
// records "not connected" on the settings and imports nothing. An adapter
// plugs in below (ADAPTERS); docs/INVOICING.md lists what the agreement
// must provide. Nothing here calls a bank.
//
// DEPLOY: supabase functions deploy bank-import --no-verify-jwt
// Secrets: none until an adapter is connected (then its own, e.g.
// BANK_IMPORT_SFTP_KEY or BANK_IMPORT_API_KEY).
// ============================================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isServiceRequest, serviceClient, userClient } from '../_shared/auth.ts';
import { BankFileError, decodeBankFile, parseBankFile, rowsForDatabase, sha256Hex } from '../_shared/bank-files.ts';

interface Settings { series: string; issuer_org: string | null; provider: string; agreement_id: string | null; account: string | null }
interface FetchedFile { name: string; bytes: Uint8Array }
/** A provider's adapter: the files it has not delivered before (re-delivered files are refused by their SHA-256). */
type Adapter = (s: Settings) => Promise<FetchedFile[] | { error: string }>;

/* Adapters by provider (bank_import_settings.provider). 'nets_sftp' would
 * list and download the OCR files from Nets' SFTP server for the agreement;
 * 'bank_api' would ask the bank's API for camt.054 notifications for the
 * account. None is connected until there is an agreement. */
const ADAPTERS: Record<string, Adapter> = {};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
const MAX_BYTES = 10 * 1024 * 1024;

function bytesOf(body: { content?: string; contentBase64?: string }): Uint8Array | null {
  if (typeof body.contentBase64 === 'string') {
    const bin = atob(body.contentBase64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  return typeof body.content === 'string' ? new TextEncoder().encode(body.content) : null;
}

/** Parse, then preview or import, as the given client (the caller, or the server). */
async function handleFile(db: SupabaseClient, org: string | null, name: string | null, bytes: Uint8Array,
                          source: 'upload' | 'fetch', dryRun: boolean) {
  if (bytes.length > MAX_BYTES) return { status: 413, body: { error: 'the file is larger than 10 MB' } };
  let file;
  try { file = parseBankFile(decodeBankFile(bytes)); }
  catch (e) { return { status: 422, body: { error: e instanceof BankFileError ? e.message : 'the file could not be read' } }; }
  const sha256 = await sha256Hex(bytes);
  if (dryRun) {
    const { data, error } = await db.rpc('preview_bank_import', { p_org: org, p_format: file.format, p_sha256: sha256, p_rows: rowsForDatabase(file) });
    return error ? { status: error.code === '42501' ? 403 : 400, body: { error: error.message } }
                 : { status: 200, body: { format: file.format, sha256, details: file.details, preview: data } };
  }
  const { data, error } = await db.rpc('import_bank_file', {
    p_org: org, p_format: file.format, p_source: source, p_file_name: name, p_sha256: sha256,
    p_rows: rowsForDatabase(file), p_details: file.details,
  });
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400;
    return { status, body: { error: error.message, alreadyImported: error.code === '23505' } };
  }
  return { status: 200, body: { format: file.format, sha256, import: data } };
}

async function fetchAll(db: SupabaseClient) {
  const { data: targets, error } = await db.from('bank_import_settings')
    .select('series, issuer_org, provider, agreement_id, account').eq('fetch_enabled', true);
  if (error) return json({ error: error.message }, 500);
  const results: unknown[] = [];
  for (const s of (targets ?? []) as Settings[]) {
    const adapter = ADAPTERS[s.provider];
    let note: string | null = null;
    const imported: unknown[] = [];
    if (!adapter) note = `no adapter is connected for provider ${s.provider} (needs a bank or Nets agreement)`;
    else {
      const files = await adapter(s).catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'the provider failed' }));
      if ('error' in files) note = files.error;
      else for (const f of files) {
        const r = await handleFile(db, s.issuer_org, f.name, f.bytes, 'fetch', false);
        imported.push({ file: f.name, status: r.status, ...r.body });
        if (r.status !== 200 && r.status !== 409 && !note) note = `${f.name}: ${(r.body as { error?: string }).error}`;
      }
    }
    await db.from('bank_import_settings').update({ last_fetch_at: new Date().toISOString(), last_fetch_error: note }).eq('series', s.series);
    results.push({ series: s.series, provider: s.provider, error: note, files: imported });
  }
  return json({ ok: true, series: results });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
  const server = isServiceRequest(req);
  let body: { action?: string; organizationId?: string | null; fileName?: string; content?: string; contentBase64?: string; dryRun?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (body?.action === 'fetch') {
    if (!server) return json({ error: 'service role only' }, 403);
    return await fetchAll(serviceClient());
  }
  if (!server && !/^Bearer\s+\S+/i.test(req.headers.get('Authorization') ?? '')) return json({ error: 'Sign in required' }, 401);
  let bytes: Uint8Array | null;
  try { bytes = bytesOf(body ?? {}); } catch { return json({ error: 'contentBase64 is not base64' }, 400); }
  if (!bytes) return json({ error: 'send the file as content (text) or contentBase64' }, 400);
  const org = body.organizationId ?? null;
  if (org !== null && !/^[0-9a-f-]{36}$/i.test(org)) return json({ error: 'organizationId must be a company id or null' }, 400);
  // The caller's own token, so the database checks who they are; the
  // service key acts as the server.
  const db = server ? serviceClient() : userClient(req);
  const r = await handleFile(db, org, body.fileName ?? null, bytes, server ? 'fetch' : 'upload', !!body.dryRun);
  return json(r.body, r.status);
});
