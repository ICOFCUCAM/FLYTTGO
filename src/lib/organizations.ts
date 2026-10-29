/**
 * Companies (organisations) for the browser: reads through RLS, changes
 * through the database functions of migrations 00005 and 00006, emails
 * through send-organization-invitation. The database decides every
 * permission; canManage() and friends only decide which buttons to show,
 * using the same rules (00005 change_member_role / remove_member /
 * invite_member).
 */
import { callFunction, supabase } from './supabase';

export type OrgRole = 'owner' | 'admin' | 'booker' | 'finance' | 'viewer';
export type OrgStatus = 'pending' | 'active' | 'suspended' | 'closed';

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'booker', 'finance', 'viewer'];
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner', admin: 'Administrator', booker: 'Booker', finance: 'Finance', viewer: 'Viewer',
};
export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  pending: 'Awaiting verification', active: 'Active', suspended: 'Suspended', closed: 'Closed',
};

export interface Organization {
  id: string; name: string; slug: string; country: string; org_number: string | null;
  vat_registered: boolean; billing_email: string | null; billing_address: string | null;
  status: OrgStatus; status_reason: string | null; created_at: string;
}
export interface Membership { organization: Organization; role: OrgRole }
export interface TeamMember {
  user_id: string; role: OrgRole; status: string; first_name: string | null; last_name: string | null;
  email: string | null; joined_at: string;
}
export interface Invitation { id: string; email: string; role: OrgRole; status: string; expires_at: string; created_at: string }

/** Roles a member may give or take away (owners: all; admins: below admin). */
export function assignableRoles(myRole: OrgRole | null): OrgRole[] {
  if (myRole === 'owner') return ORG_ROLES;
  if (myRole === 'admin') return ['booker', 'finance', 'viewer'];
  return [];
}

/** May myRole change or remove a member who has targetRole? */
export function canManage(myRole: OrgRole | null, targetRole: OrgRole): boolean {
  return assignableRoles(myRole).includes(targetRole);
}

export function canInvite(myRole: OrgRole | null, status: OrgStatus): boolean {
  return (myRole === 'owner' || myRole === 'admin') && (status === 'pending' || status === 'active');
}

export function canEditCompany(myRole: OrgRole | null): boolean {
  return myRole === 'owner' || myRole === 'admin';
}

/** Lower case, letters, digits and dashes, as the database's slug rule. */
export function suggestSlug(name: string): string {
  return name.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(asa|as|ans|da|enk)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

/** The signed-in user's companies with their role in each (RLS: own memberships). */
export async function myMemberships(userId: string): Promise<Membership[]> {
  const { data: rows, error } = await supabase
    .from('organization_members')
    .select('role, status, organization_id')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error || !rows?.length) return [];
  const { data: orgs } = await supabase
    .from('organizations')
    .select('*')
    .in('id', rows.map(r => r.organization_id));
  return (orgs ?? []).map(o => ({
    organization: o as Organization,
    role: rows.find(r => r.organization_id === o.id)!.role as OrgRole,
  })).sort((a, b) => a.organization.name.localeCompare(b.organization.name));
}

export async function loadTeam(orgId: string): Promise<TeamMember[]> {
  const { data } = await supabase.rpc('organization_team', { p_org: orgId });
  return (data ?? []) as TeamMember[];
}

/** Open invitations (RLS: owners and admins only; others get none). */
export async function loadInvitations(orgId: string): Promise<Invitation[]> {
  const { data } = await supabase
    .from('organization_invitations')
    .select('id, email, role, status, expires_at, created_at')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return (data ?? []) as Invitation[];
}

async function rpc(name: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(name, args);
  return error ? error.message : null;
}

export const createOrganization = (name: string, slug: string, orgNumber: string | null, billingEmail: string | null) =>
  supabase.rpc('create_organization', { p_name: name, p_slug: slug, p_org_number: orgNumber, p_billing_email: billingEmail });
export const updateOrganization = (orgId: string, changes: Record<string, unknown>) =>
  rpc('update_organization', { p_org: orgId, p_changes: changes });
export const changeMemberRole = (orgId: string, userId: string, role: OrgRole) =>
  rpc('change_member_role', { p_org: orgId, p_user: userId, p_role: role });
export const removeMember = (orgId: string, userId: string) =>
  rpc('remove_member', { p_org: orgId, p_user: userId });
export const revokeInvitation = (invitationId: string) =>
  rpc('revoke_invitation', { p_invitation: invitationId });

/** Invite by email (the server sends it). Null on success, else the reason. */
export async function inviteByEmail(orgId: string, email: string, role: OrgRole): Promise<string | null> {
  try {
    const res = await callFunction('send-organization-invitation', { organizationId: orgId, email, role });
    if (res.ok) return null;
    const out = await res.json().catch(() => ({}));
    return out.error ?? `invitation failed (${res.status})`;
  } catch {
    return 'the invitation could not be sent; try again';
  }
}
