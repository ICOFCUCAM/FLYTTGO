// ============================================================================
// FlyttGo — caller identity for Edge Functions
// ============================================================================
//
// The functions are deployed with --no-verify-jwt (the webhooks must
// accept calls without a Supabase JWT), so every function that acts for
// a signed-in user checks the caller itself: the browser sends
// `Authorization: Bearer <access token>` (see callFunction() in
// src/lib/supabase.ts) and we resolve it with the service-role client.
// ============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

/**
 * A client that acts as the caller (their token, the anon key), so the
 * database applies their row-level security and guards, and records them
 * as the actor. SUPABASE_ANON_KEY is injected into Edge Functions.
 */
export function userClient(req: Request): SupabaseClient {
  const token = bearer(req) ?? '';
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

export interface Caller {
  id:      string;
  email:   string | null;
  isAdmin: boolean;
}

function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** True when the request carries the project's service-role key. */
export function isServiceRequest(req: Request): boolean {
  const key   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const token = bearer(req);
  return !!key && !!token && token === key;
}

/**
 * The signed-in user behind the request, or null when there is no
 * valid user token (the anon key is not a user).
 */
export async function getCaller(req: Request, db: SupabaseClient): Promise<Caller | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: admin } = await db
    .from('admin_accounts')
    .select('id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  return { id: data.user.id, email: data.user.email ?? null, isAdmin: !!admin };
}

/** driver_profiles.id of the caller, or null when they are not a driver. */
export async function driverProfileIdOf(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db
    .from('driver_profiles')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })      // the oldest, as my_driver_id()
    .limit(1);
  return data?.[0]?.id ?? null;
}
