/**
 * Invoicing for the browser (migration 00008, docs/INVOICING.md): reads
 * through row-level security, changes through the database functions,
 * documents (PDF, EHF) and emails through the edge functions. The
 * database decides every permission.
 */
import { callFunction, supabase } from './supabase';

export interface InvoiceRow {
  id: string; kind: 'invoice' | 'credit_note'; number: number | null; status: string; organization_id: string;
  issue_date: string | null; due_date: string | null; total: number; net_total: number; vat_total: number;
  amount_paid: number; amount_credited: number; fees_total: number; kid: string | null; reference: string | null;
  buyer: { name?: string; org_number?: string; email?: string } | null; sent_at: string | null; reminder_level: number;
  credits_invoice_id: string | null; created_at: string;
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', issued: 'Unpaid', partially_paid: 'Part paid', paid: 'Paid', credited: 'Credited',
};

const num = (v: unknown) => Number(v ?? 0);

export function outstanding(i: Pick<InvoiceRow, 'total' | 'fees_total' | 'amount_paid' | 'amount_credited'>): number {
  return Math.round((num(i.total) + num(i.fees_total) - num(i.amount_paid) - num(i.amount_credited)) * 100) / 100;
}

/** Unpaid and past its due date (Oslo calendar day). */
export function isOverdue(i: Pick<InvoiceRow, 'kind' | 'status' | 'due_date'>, today = new Date()): boolean {
  if (i.kind !== 'invoice' || !['issued', 'partially_paid'].includes(i.status) || !i.due_date) return false;
  const oslo = today.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });   // YYYY-MM-DD
  return i.due_date < oslo;
}

export function termsLabel(o: { payment_terms_type?: string; payment_terms_days?: number; payment_terms_day?: number | null }): string {
  return o.payment_terms_type === 'day_of_month'
    ? `Due on day ${o.payment_terms_day} of the following month`
    : `${o.payment_terms_days ?? 14} days`;
}

export function formatNok(n: number): string {
  return `${num(n).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

/** FlyttGo's own invoices (to one company, or all for administrators).
 *  Companies' own sales invoices (00011) are loaded by lib/services.ts. */
export async function loadInvoices(orgId?: string): Promise<InvoiceRow[]> {
  let q = supabase.from('invoices').select('*').eq('series', 'main').order('created_at', { ascending: false }).limit(500);
  if (orgId) q = q.eq('organization_id', orgId);
  const { data } = await q;
  return (data ?? []) as InvoiceRow[];
}

/** Open the PDF in a new tab, or save the EHF file. */
export async function openInvoiceDocument(invoiceId: string, format: 'pdf' | 'ehf'): Promise<string | null> {
  const tab = format === 'pdf' ? window.open('', '_blank') : null;
  try {
    const res = await callFunction('invoice-document', { invoiceId, format });
    if (!res.ok) { tab?.close(); return (await res.json().catch(() => ({}))).error ?? `download failed (${res.status})`; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `invoice.${format === 'pdf' ? 'pdf' : 'xml'}`;
    if (tab) { tab.opener = null; tab.location.href = url; }
    else {
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return null;
  } catch {
    tab?.close();
    return 'the document could not be downloaded';
  }
}

export async function setBillingPreferences(orgId: string, p: {
  termsType: 'days' | 'day_of_month'; termsDays: number; termsDay: number | null; cycle: 'per_booking' | 'monthly'; reference: string;
}): Promise<string | null> {
  const { error } = await supabase.rpc('set_billing_preferences', {
    p_org: orgId, p_terms_type: p.termsType, p_terms_days: p.termsDays, p_terms_day: p.termsDay,
    p_cycle: p.cycle, p_reference: p.reference,
  });
  return error?.message ?? null;
}

/** Upload the company logo (PNG or JPEG, max 1 MB) into its own folder. */
export async function uploadLogo(orgId: string, file: File): Promise<string | null> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) return 'the logo must be a PNG or JPEG image';
  if (file.size > 1_048_576) return 'the logo must be at most 1 MB';
  const path = `${orgId}/logo.${file.type === 'image/png' ? 'png' : 'jpg'}`;
  const { error: upErr } = await supabase.storage.from('organization-logos').upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return upErr.message;
  const { error } = await supabase.rpc('set_organization_logo', { p_org: orgId, p_path: path });
  return error?.message ?? null;
}

export async function logoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from('organization-logos').createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/* ── FlyttGo administrators ─────────────────────────────────────── */

export const INVOICE_SETTING_KEYS = [
  'invoice_seller_name', 'invoice_seller_org_number', 'invoice_seller_vat_registered', 'invoice_seller_address',
  'invoice_seller_postcode_city', 'invoice_seller_email', 'invoice_seller_phone', 'invoice_seller_bank_account',
  'invoice_seller_iban', 'invoice_seller_bic', 'invoice_reminder_after_days', 'invoice_reminder_fee',
  'invoice_late_interest_pct', 'credit_check_enabled', 'credit_check_max_age_days', 'credit_check_provider',
] as const;
export type InvoiceSettings = Record<(typeof INVOICE_SETTING_KEYS)[number], string>;

export async function loadInvoiceSettings(): Promise<InvoiceSettings> {
  const { data } = await supabase.from('platform_config').select('config_key, config_value').in('config_key', INVOICE_SETTING_KEYS as unknown as string[]);
  const out = Object.fromEntries(INVOICE_SETTING_KEYS.map(k => [k, ''])) as InvoiceSettings;
  for (const r of data ?? []) (out as Record<string, string>)[r.config_key] = r.config_value ?? '';
  return out;
}

export async function saveInvoiceSettings(s: Partial<InvoiceSettings>): Promise<string | null> {
  for (const [k, v] of Object.entries(s)) {
    const { error } = await supabase.from('platform_config').update({ config_value: v ?? '' }).eq('config_key', k);
    if (error) return `${k}: ${error.message}`;
  }
  return null;
}

async function rpc(name: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(name, args);
  return error?.message ?? null;
}

export const adminSetInvoicing = (orgId: string, enabled: boolean, creditLimit: number | null, plan: 'standard' | 'special') =>
  rpc('admin_set_invoicing', { p_org: orgId, p_enabled: enabled, p_credit_limit: creditLimit, p_plan: plan });
export const recordManualCreditCheck = (orgId: string, passed: boolean, score: string, limit: number | null, evidence: string) =>
  rpc('record_credit_check', { p_org: orgId, p_provider: 'manual', p_passed: passed, p_score: score || null,
                               p_recommended_limit: limit, p_findings: { evidence } });
export const issueInvoice = (id: string) => rpc('issue_invoice', { p_invoice: id });
export const deleteDraft = (id: string) => rpc('delete_invoice_draft', { p_invoice: id });
export const creditInvoice = (id: string, amount: number | null, reason: string) =>
  rpc('create_credit_note', { p_invoice: id, p_amount: amount, p_reason: reason });
export const recordPayment = (id: string, amount: number, paidOn: string, method: string, reference: string) =>
  rpc('record_invoice_payment', { p_invoice: id, p_amount: amount, p_paid_on: paidOn, p_method: method, p_reference: reference });
export const sendReminder = (id: string) => rpc('record_invoice_reminder', { p_invoice: id });

export async function recordPaymentByKid(kid: string, amount: number, paidOn: string, ref: string): Promise<{ invoiceId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('record_payment_by_kid', { p_kid: kid, p_amount: amount, p_paid_on: paidOn, p_bank_reference: ref });
  return { invoiceId: (data as string | null) ?? null, error: error?.message ?? null };
}

export async function callJson(fn: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await callFunction(fn, body);
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: 'the request failed' } };
  }
}
