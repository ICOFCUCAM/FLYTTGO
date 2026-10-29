/**
 * Companies (organisations) for the browser: reads through RLS, changes
 * through the database functions of migrations 00005, 00006 and 00017
 * (spending limits and approval), emails through
 * send-organization-invitation. The database decides every
 * permission; canManage() and friends only decide which buttons to show,
 * using the same rules (00005 change_member_role / remove_member /
 * invite_member).
 */
import { callFunction, supabase } from './supabase';
import type { ApprovalReason, ApprovalStatus } from '../../supabase/functions/_shared/spending';

export type OrgRole = 'owner' | 'admin' | 'booker' | 'finance' | 'viewer' | 'staff';
export type OrgStatus = 'pending' | 'active' | 'suspended' | 'closed';

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'booker', 'finance', 'viewer', 'staff'];
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner', admin: 'Administrator', booker: 'Booker', finance: 'Finance', viewer: 'Viewer',
  staff: 'Staff (works jobs and appointments)',
};
export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  pending: 'Awaiting verification', active: 'Active', suspended: 'Suspended', closed: 'Closed',
};

export interface Organization {
  id: string; name: string; slug: string; country: string; org_number: string | null;
  vat_registered: boolean; billing_email: string | null; billing_address: string | null;
  status: OrgStatus; status_reason: string | null; created_at: string; industry?: string | null;
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
  if (myRole === 'admin') return ['booker', 'finance', 'viewer', 'staff'];
  return [];
}

/** May this member book for the company? (00007: owner, admin or booker of an active company.) */
export function canBookFor(m: Membership): boolean {
  return m.organization.status === 'active' && ['owner', 'admin', 'booker'].includes(m.role);
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

/** The company's bookings (RLS: members of the company). */
export async function loadCompanyBookings(orgId: string) {
  const { data } = await supabase
    .from('bookings')
    .select('id, customer_id, status, payment_status, pickup_city, dropoff_city, move_date, move_time, price_estimate, customer_name, customer_email, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200);
  return data ?? [];
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

/* ── Spending limits and approval (00017) ────────────────────────────────── */

export interface MemberSpending {
  user_id: string; role: OrgRole; per_booking_limit: number | null; monthly_limit: number | null; month_spend: number;
}
export interface SpendingRules { approval_above: number | null; approval_roles: OrgRole[]; approval_expiry_hours: number }
export interface BookingApproval {
  booking_id: string; organization_id: string; requested_by: string; amount: number; reasons: ApprovalReason[];
  month_spend: number | null; status: ApprovalStatus; requested_at: string; expires_at: string | null;
  decided_by: string | null; decided_at: string | null; decision_reason: string | null;
}

/** Limits and this month's spend (owners, admins, finance: everyone; others: themselves). */
export async function loadSpending(orgId: string): Promise<MemberSpending[]> {
  const { data } = await supabase.rpc('organization_spending', { p_org: orgId });
  return ((data ?? []) as MemberSpending[]).map(r => ({ ...r, month_spend: Number(r.month_spend ?? 0) }));
}

export async function loadSpendingRules(orgId: string): Promise<SpendingRules | null> {
  const { data } = await supabase.from('organization_spending_rules')
    .select('approval_above, approval_roles, approval_expiry_hours').eq('organization_id', orgId).maybeSingle();
  return (data as SpendingRules | null) ?? null;
}

export const setMemberLimits = (orgId: string, userId: string, perBooking: number | null, monthly: number | null) =>
  rpc('set_member_spending_limits', { p_org: orgId, p_user: userId, p_per_booking: perBooking, p_monthly: monthly });
export const setSpendingRules = (orgId: string, approvalAbove: number | null, roles: OrgRole[], expiryHours: number) =>
  rpc('set_spending_rules', { p_org: orgId, p_approval_above: approvalAbove, p_approval_roles: roles, p_expiry_hours: expiryHours });
/** With the amount the approver saw: refused if the request has changed since (00022). */
export const decideApproval = (bookingId: string, approve: boolean, reason: string | null, amount?: number | null) =>
  rpc('decide_booking_approval', { p_booking: bookingId, p_approve: approve, p_reason: reason, p_amount: amount ?? null });

/** The company's approval requests (RLS: owners, admins, finance; a booker their own). Ends expired ones first. */
export async function loadApprovals(orgId: string): Promise<BookingApproval[]> {
  await supabase.rpc('expire_booking_approvals', { p_org: orgId });
  const { data } = await supabase.from('company_booking_approvals')
    .select('*').eq('organization_id', orgId).neq('status', 'not_required')
    .order('requested_at', { ascending: false }).limit(200);
  return (data ?? []) as BookingApproval[];
}

/** Approval of the signed-in person's own bookings, by booking id. */
export async function loadMyApprovals(bookingIds: string[]): Promise<Record<string, BookingApproval>> {
  if (!bookingIds.length) return {};
  const { data } = await supabase.from('company_booking_approvals').select('*').in('booking_id', bookingIds);
  return Object.fromEntries(((data ?? []) as BookingApproval[]).map(a => [a.booking_id, a]));
}
