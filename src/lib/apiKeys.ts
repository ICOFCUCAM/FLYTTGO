/**
 * API keys and the booking widget's websites for the browser (migration
 * 00018, docs/API.md, docs/WHITE_LABEL.md → Booking widget). Reads go
 * through RLS (owners and admins see the keys, never their hashes); every
 * change goes through a database function that checks the caller. The key
 * itself is returned once, by create_api_key, and never stored here.
 */
import { supabase, supabaseFunctionUrl } from './supabase';
import type { Membership } from './organizations';
import { API_SCOPES, SCOPE_LABELS, type ApiScope } from '../../supabase/functions/_shared/public-api';
import { widgetSnippet } from '../../supabase/functions/_shared/widget';

export { API_SCOPES, SCOPE_LABELS, type ApiScope };

export interface ApiKey {
  id: string; name: string; prefix: string; scopes: ApiScope[]; created_by: string; rate_limit_per_minute: number;
  last_used_at: string | null; expires_at: string | null; revoked_at: string | null; revoked_reason: string | null; created_at: string;
}
export interface NewApiKey { id: string; key: string; prefix: string; name: string; scopes: ApiScope[]; expires_at: string | null }
export interface ApiEvent { id: number; api_key_id: string | null; actor_id: string | null; action: string; details: Record<string, unknown>; created_at: string }

/** Owners and admins of an active company manage keys (create_api_key). */
export function canManageKeys(m: Membership): boolean {
  return m.organization.status === 'active' && (m.role === 'owner' || m.role === 'admin');
}

/** The API's base URL: the public-api function, version 1. */
export function apiBaseUrl(): string {
  return `${supabaseFunctionUrl('public-api')}/v1`;
}

/** The snippet for the company's website, served from this FlyttGo host. */
export function snippetFor(slug: string): string {
  return widgetSnippet(typeof window !== 'undefined' ? window.location.origin : 'https://flyttgo.no', slug);
}

export async function loadApiKeys(orgId: string): Promise<ApiKey[]> {
  const { data } = await supabase.from('api_keys')
    .select('id, name, prefix, scopes, created_by, rate_limit_per_minute, last_used_at, expires_at, revoked_at, revoked_reason, created_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false });
  return (data ?? []) as ApiKey[];
}

export async function availableScopes(orgId: string): Promise<ApiScope[]> {
  const { data } = await supabase.rpc('api_scopes_available', { p_org: orgId });
  return (data ?? []) as ApiScope[];
}

export async function createApiKey(orgId: string, name: string, scopes: ApiScope[], expiresAt: string | null)
  : Promise<{ key: NewApiKey | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_api_key', { p_org: orgId, p_name: name, p_scopes: scopes, p_expires_at: expiresAt });
  return { key: (data as NewApiKey | null) ?? null, error: error?.message ?? null };
}

export async function updateApiKey(id: string, name: string, scopes: ApiScope[]): Promise<string | null> {
  const { error } = await supabase.rpc('update_api_key', { p_key: id, p_name: name, p_scopes: scopes });
  return error?.message ?? null;
}

export async function revokeApiKey(id: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('revoke_api_key', { p_key: id, p_reason: reason || null });
  return error?.message ?? null;
}

export async function loadApiEvents(orgId: string, limit = 30): Promise<ApiEvent[]> {
  const { data } = await supabase.from('api_events').select('id, api_key_id, actor_id, action, details, created_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as ApiEvent[];
}

export async function loadWidgetOrigins(orgId: string): Promise<string[]> {
  const { data } = await supabase.from('organization_widget_origins').select('origin').eq('organization_id', orgId).order('origin');
  return (data ?? []).map((r: { origin: string }) => r.origin);
}

export async function addWidgetOrigin(orgId: string, origin: string): Promise<string | null> {
  const { error } = await supabase.rpc('add_widget_origin', { p_org: orgId, p_origin: origin });
  return error?.message ?? null;
}

export async function removeWidgetOrigin(orgId: string, origin: string): Promise<string | null> {
  const { error } = await supabase.rpc('remove_widget_origin', { p_org: orgId, p_origin: origin });
  return error?.message ?? null;
}

export const EVENT_LABELS: Record<string, string> = {
  'key.created': 'Key created', 'key.updated': 'Key changed', 'key.revoked': 'Key revoked', 'key.limit': 'Limit changed by FlyttGo',
  'booking.create': 'Move booked through the API', 'job.create': 'Job created through the API',
  'appointment.create': 'Appointment booked through the API',
  'widget.origin_added': 'Widget website added', 'widget.origin_removed': 'Widget website removed',
};
