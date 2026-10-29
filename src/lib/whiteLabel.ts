/**
 * White label: plans and prices, a company's set-up, its public page and
 * the template library (migration 00009, docs/WHITE_LABEL.md).
 *
 * Model A (the default): FlyttGo sells under the company's brand.
 * Model B (plan Own seller): the company sells; its customers pay into its
 * own Stripe account at its own price.
 *
 * Every change goes through a database function or an Edge Function that
 * checks who may make it; this file only calls them.
 */
import { supabase } from './supabase';
import { callJson } from './invoicing';
import { isFlyttgoHost } from './hosts';

export type SellerModel = 'flyttgo' | 'company';
export type WhiteLabelStatus = 'requested' | 'active' | 'suspended' | 'ended' | 'declined';

export interface WhiteLabelPlan {
  code: string; name: string; seller_model: SellerModel; summary: string; for_whom: string | null;
  setup_fee: number; monthly_fee: number; platform_fee_pct: number; platform_fee_min: number; own_domain: boolean;
  features: string[]; flyttgo_does: string[]; company_does: string[]; requirements: string[];
  is_default: boolean; sort: number; active: boolean; price_status: 'proposed' | 'confirmed';
  prices_confirmed_at: string | null;
}

export interface OrgWhiteLabel {
  organization_id: string; plan_code: string; status: WhiteLabelStatus; requested_plan_code: string | null;
  requested_at: string; decided_at: string | null; decision_reason: string | null; started_at: string | null; ended_at: string | null;
  display_name: string | null; tagline: string | null; primary_color: string | null; accent_color: string | null;
  support_email: string | null; support_phone: string | null; terms_url: string | null; privacy_url: string | null;
  price_markup_pct: number; template_id: string | null; city: string | null;
  custom_domain: string | null; domain_token: string | null; domain_verified_at: string | null;
  stripe_account_id: string | null; stripe_charges_enabled: boolean;
  dpa_version: string | null; dpa_accepted_at: string | null;
}

export interface SiteTemplate {
  id: string; name: string; industry: string[]; style: string | null;
  pages: { path: string; html: string }[]; assets: { key: string; url: string }[];
  content_flags: { kind: string; page: string; sample: string }[];
  status: 'imported' | 'approved' | 'retired'; review_note: string | null; reviewed_at: string | null;
}

export interface PublicSite {
  organization_id: string; slug: string; display_name: string; tagline: string | null;
  primary_color: string | null; accent_color: string | null; logo_url: string | null;
  plan: string; seller_model: SellerModel; domain: string | null; city: string | null; template_id: string | null;
  pricing: { markup_pct: number; platform_fee_pct: number; platform_fee_min: number } | null;
  payments_ready: boolean;
  seller: { name: string | null; org_number: string | null; vat_registered?: boolean; address?: string | null; email?: string | null; phone?: string | null };
  support: { email: string | null; phone: string | null };
  terms_url: string | null; privacy_url: string | null;
  seller_notice: string;
  /** What the page books: FlyttGo's moves, or the company's Jobs or Appointments. */
  booking: 'moves' | 'jobs' | 'appointments' | 'none';
  /** The page has a shop (module 'shop', 00020): /b/<slug>/shop. */
  shop?: boolean;
  modules: string[];
  pages: string[];
  page: { path: string; html: string } | null;
}

export const DPA_VERSION = '2026-10-draft';

export const STATUS_LABELS: Record<WhiteLabelStatus, string> = {
  requested: 'Waiting for FlyttGo', active: 'Active', suspended: 'Suspended', ended: 'Ended', declined: 'Declined',
};

export const SELLER_LABELS: Record<SellerModel, string> = {
  flyttgo: 'FlyttGo sells (Model A)', company: 'Your company sells (Model B)',
};

const err = (e: { message: string } | null) => e?.message ?? null;

/* ── Plans ─────────────────────────────────────────────────────────── */
export async function loadPlans(): Promise<WhiteLabelPlan[]> {
  const { data } = await supabase.from('white_label_plans').select('*').order('sort');
  return (data ?? []) as WhiteLabelPlan[];
}

/* ── A company's set-up ────────────────────────────────────────────── */
export async function loadOrgWhiteLabel(orgId: string): Promise<OrgWhiteLabel | null> {
  const { data } = await supabase.from('organization_white_label').select('*').eq('organization_id', orgId).maybeSingle();
  return (data ?? null) as OrgWhiteLabel | null;
}

export async function missingFor(orgId: string, plan?: string | null): Promise<string[]> {
  const { data } = await supabase.rpc('white_label_missing', { p_org: orgId, p_plan: plan ?? null });
  return (data ?? []) as string[];
}

export async function requestPlan(orgId: string, plan: string | null): Promise<string | null> {
  return err((await supabase.rpc('request_white_label', { p_org: orgId, p_plan: plan })).error);
}

export async function saveBrand(orgId: string, b: {
  display_name: string; primary_color: string; accent_color: string; tagline: string;
  support_email: string; support_phone: string; terms_url: string; privacy_url: string; markup_pct: number;
}): Promise<string | null> {
  return err((await supabase.rpc('set_white_label_brand', {
    p_org: orgId, p_display_name: b.display_name, p_primary_color: b.primary_color, p_accent_color: b.accent_color,
    p_tagline: b.tagline, p_support_email: b.support_email, p_support_phone: b.support_phone,
    p_terms_url: b.terms_url, p_privacy_url: b.privacy_url, p_markup_pct: b.markup_pct,
  })).error);
}

export async function setDomain(orgId: string, domain: string): Promise<string | null> {
  return err((await supabase.rpc('set_white_label_domain', { p_org: orgId, p_domain: domain })).error);
}

export async function verifyDomain(orgId: string) {
  return callJson('white-label-domain', { organizationId: orgId });
}

export async function acceptDpa(orgId: string): Promise<string | null> {
  return err((await supabase.rpc('accept_white_label_dpa', { p_org: orgId, p_version: DPA_VERSION })).error);
}

export async function stripeConnect(orgId: string, action: 'onboard' | 'status') {
  return callJson('stripe-connect', { organizationId: orgId, action });
}

export async function setSite(orgId: string, templateId: string | null, city: string): Promise<string | null> {
  return err((await supabase.rpc('set_white_label_site', { p_org: orgId, p_template: templateId, p_city: city })).error);
}

export async function endPlan(orgId: string, reason: string): Promise<string | null> {
  return err((await supabase.rpc('end_white_label', { p_org: orgId, p_reason: reason })).error);
}

export async function loadStats(orgId: string) {
  const { data } = await supabase.rpc('white_label_stats', { p_org: orgId });
  return (data ?? []) as { month: string; bookings: number; completed: number; cancelled: number; customer_revenue: number | null }[];
}

/** A template as the catalogue lists it: no pages (they are loaded when one is opened). */
export type SiteTemplateSummary = Omit<SiteTemplate, 'pages' | 'content_flags'> & { content_flags?: SiteTemplate['content_flags'] };

/** The catalogue: approved templates (companies) or every template (FlyttGo administrators), without their pages. */
export async function loadTemplateList(withFlags = false): Promise<SiteTemplateSummary[]> {
  const { data } = await supabase.from('site_templates')
    .select(`id, name, industry, style, assets, status, review_note, reviewed_at${withFlags ? ', content_flags' : ''}`).order('name');
  return (data ?? []) as unknown as SiteTemplateSummary[];
}

/** One template with its pages (for a preview or a review). */
export async function loadTemplate(id: string): Promise<SiteTemplate | null> {
  const { data } = await supabase.from('site_templates')
    .select('id, name, industry, style, pages, assets, content_flags, status, review_note, reviewed_at').eq('id', id).maybeSingle();
  return (data ?? null) as SiteTemplate | null;
}

/** Approved templates (companies) or every template (FlyttGo administrators), with every page. Prefer loadTemplateList. */
export async function loadTemplates(): Promise<SiteTemplate[]> {
  const { data } = await supabase.from('site_templates')
    .select('id, name, industry, style, pages, assets, content_flags, status, review_note, reviewed_at').order('id');
  return (data ?? []) as SiteTemplate[];
}

/* ── FlyttGo administrators ────────────────────────────────────────── */
export async function loadAllWhiteLabels() {
  const { data } = await supabase.from('organization_white_label')
    .select('*, organizations(name, slug, status, org_number, vat_registered)').order('requested_at', { ascending: false });
  return (data ?? []) as (OrgWhiteLabel & { organizations: { name: string; slug: string; status: string; org_number: string | null; vat_registered: boolean } | null })[];
}

export async function decide(orgId: string, approve: boolean, reason: string | null): Promise<string | null> {
  return err((await supabase.rpc('admin_decide_white_label', { p_org: orgId, p_approve: approve, p_reason: reason })).error);
}

export async function setStatus(orgId: string, status: 'active' | 'suspended' | 'ended', reason: string): Promise<string | null> {
  return err((await supabase.rpc('admin_set_white_label_status', { p_org: orgId, p_status: status, p_reason: reason })).error);
}

export async function updatePlan(code: string, p: {
  setup_fee?: number | null; monthly_fee?: number | null; platform_fee_pct?: number | null; platform_fee_min?: number | null;
  active?: boolean | null; confirm: boolean;
}): Promise<string | null> {
  return err((await supabase.rpc('admin_update_white_label_plan', {
    p_code: code, p_setup_fee: p.setup_fee ?? null, p_monthly_fee: p.monthly_fee ?? null,
    p_platform_fee_pct: p.platform_fee_pct ?? null, p_platform_fee_min: p.platform_fee_min ?? null,
    p_active: p.active ?? null, p_confirm: p.confirm,
  })).error);
}

export async function updateTemplatePage(id: string, path: string, html: string): Promise<string | null> {
  return err((await supabase.rpc('admin_update_site_template_page', { p_id: id, p_path: path, p_html: html })).error);
}

export async function reviewTemplate(id: string, approve: boolean, contentChecked: boolean, note: string): Promise<string | null> {
  return err((await supabase.rpc('admin_review_site_template', {
    p_id: id, p_approve: approve, p_content_checked: contentChecked, p_note: note,
  })).error);
}

/* ── The public page ───────────────────────────────────────────────── */
const BRAND_KEY = 'flyttgo.brand';

/** Which company's page this visit is on: /b/<slug>, a company's own
 *  domain or subdomain, or the page the visitor came from in this tab. */
export function brandTarget(): { slug?: string; host?: string } | null {
  if (typeof window === 'undefined') return null;
  const { pathname, hostname } = window.location;
  const m = /^\/b\/([a-z0-9-]{3,63})(?:\/|$)/.exec(pathname);
  const store = (v: string | null) => {
    try {
      if (v) sessionStorage.setItem(BRAND_KEY, v); else sessionStorage.removeItem(BRAND_KEY);
    } catch { /* private mode */ }
  };
  if (m) { store(m[1]); return { slug: m[1] }; }
  if (!isFlyttgoHost(hostname)) return { host: hostname };
  if (pathname === '/') { store(null); return null; }             // back on FlyttGo's own front page
  try {
    const kept = sessionStorage.getItem(BRAND_KEY);
    return kept ? { slug: kept } : null;
  } catch { return null; }
}

export async function loadSite(target: { slug?: string; host?: string }, page?: string | null): Promise<PublicSite | null> {
  const r = await callJson('white-label-site', { ...target, page: page ?? '/' });
  return r.ok ? (r.data as PublicSite) : null;
}

/** Text colour readable on a background colour (black or white). */
export function textOn(hex: string | null | undefined): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return '#ffffff';
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111827' : '#ffffff';
}

