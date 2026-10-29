/**
 * The platform for other industries (migrations 00010–00013,
 * docs/SERVICE_PLATFORM.md): industry and authorisations, invoices in a
 * company's own name, Jobs (trades) and Appointments. Reads go through
 * row-level security and changes through the database functions, which
 * decide every permission.
 */
import { supabase } from './supabase';
import { callJson, type InvoiceRow } from './invoicing';

export const INDUSTRIES: { id: string; label: string }[] = [
  { id: 'transport', label: 'Moving, delivery and logistics' },
  { id: 'field_service', label: 'Trades and home services (plumber, electrician, cleaning…)' },
  { id: 'appointments', label: 'Appointments (salon, fitness, pet care, tutoring, consulting…)' },
  { id: 'hospitality', label: 'Hotels, restaurants, travel and events' },
  { id: 'retail', label: 'Shops and e-commerce' },
  { id: 'software_education', label: 'Software, media and education' },
  { id: 'health', label: 'Health (website and invoicing only)' },
  { id: 'nonprofit', label: 'Nonprofit, faith and community' },
  { id: 'other', label: 'Other' },
];

export const AUTHORISATION_KINDS: Record<string, string> = {
  electrical: 'Electrical work (DSB elvirksomhetsregisteret)', plumbing: 'Plumbing (central or local approval)',
  gas: 'Gas installations', pest_control: 'Pest control', refrigerant: 'Refrigerants (F-gas certificate)',
  chimney: 'Chimney and fireplaces', other: 'Other',
};

const err = (e: { message: string } | null) => e?.message ?? null;
const rpc = async (fn: string, args: Record<string, unknown>) => err((await supabase.rpc(fn, args)).error);

/* ── Company ───────────────────────────────────────────────────────── */
export const setIndustry = (orgId: string, industry: string) => rpc('set_organization_industry', { p_org: orgId, p_industry: industry });

export async function hasModule(orgId: string,
  module: 'jobs' | 'appointments' | 'restaurant_reservations' | 'hotel_reservations' | 'sales_invoicing'): Promise<boolean> {
  const { data } = await supabase.rpc('org_has_module', { p_org: orgId, p_module: module });
  return !!data;
}

export interface Authorisation { id: string; organization_id: string; kind: string; register: string; reference: string | null;
  valid_until: string | null; status: 'valid' | 'revoked'; revoked_reason: string | null; recorded_at: string; evidence: Record<string, unknown> }
export async function loadAuthorisations(orgId: string): Promise<Authorisation[]> {
  const { data } = await supabase.from('organization_authorisations').select('*').eq('organization_id', orgId).order('recorded_at', { ascending: false });
  return (data ?? []) as Authorisation[];
}
export const recordAuthorisation = (orgId: string, kind: string, register: string, reference: string, validUntil: string | null, checked: string) =>
  rpc('record_organization_authorisation', { p_org: orgId, p_kind: kind, p_register: register, p_reference: reference,
                                             p_valid_until: validUntil || null, p_evidence: { checked } });
export const revokeAuthorisation = (id: string, reason: string) => rpc('revoke_organization_authorisation', { p_id: id, p_reason: reason });

export interface Member { user_id: string; role: string; first_name: string | null; last_name: string | null; email: string | null }
export async function loadMembers(orgId: string): Promise<Member[]> {
  const { data } = await supabase.rpc('organization_team', { p_org: orgId });
  return (data ?? []) as Member[];
}
export const memberName = (m: Member | undefined) => m ? ([m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member') : '';

/* ── Invoices in the company's own name ────────────────────────────── */
export interface SalesInvoice extends InvoiceRow { issuer_org: string; customer_user_id: string | null; seller: any; source_type: string | null }
export interface InvoiceSettings { legal_name: string | null; address: string | null; postcode_city: string | null; email: string | null;
  phone: string | null; bank_account: string | null; iban: string | null; bic: string | null; terms_days: number; reminder_fee: number;
  late_interest_pct: number | null; logo_on_invoices: boolean }

export async function loadSalesInvoices(orgId: string): Promise<SalesInvoice[]> {
  const { data } = await supabase.from('invoices').select('*').eq('issuer_org', orgId).order('created_at', { ascending: false }).limit(500);
  return (data ?? []) as SalesInvoice[];
}
/** The invoices a customer has received from companies. */
export async function loadMyInvoices(userId: string): Promise<SalesInvoice[]> {
  const { data } = await supabase.from('invoices').select('*').eq('customer_user_id', userId).neq('status', 'draft')
    .order('issue_date', { ascending: false });
  return (data ?? []) as SalesInvoice[];
}
export async function loadInvoiceSettings(orgId: string): Promise<InvoiceSettings | null> {
  const { data } = await supabase.from('organization_invoice_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return (data ?? null) as InvoiceSettings | null;
}
export const saveInvoiceSettings = (orgId: string, s: Partial<InvoiceSettings>) => rpc('set_invoice_settings', { p_org: orgId, p: s });
export async function createSalesInvoice(orgId: string, customer: Record<string, unknown>,
  lines: { description: string; quantity: number; unit_price: number; vat_rate: number }[], reference: string): Promise<{ id?: string; error: string | null }> {
  const { data, error } = await supabase.rpc('create_sales_invoice', { p_org: orgId, p_customer: customer, p_customer_user: null,
                                                                       p_lines: lines, p_reference: reference, p_notes: null });
  return { id: (data as any)?.id, error: err(error) };
}
export const issueInvoice = (id: string) => rpc('issue_invoice', { p_invoice: id });
export const deleteDraft = (id: string) => rpc('delete_invoice_draft', { p_invoice: id });
export const recordPayment = (id: string, amount: number, paidOn: string, method: string, reference: string) =>
  rpc('record_invoice_payment', { p_invoice: id, p_amount: amount, p_paid_on: paidOn, p_method: method, p_reference: reference });
export const sendReminder = (id: string) => rpc('record_invoice_reminder', { p_invoice: id });
export const creditInvoice = (id: string, amount: number | null, reason: string) =>
  rpc('create_credit_note', { p_invoice: id, p_amount: amount, p_reason: reason });
export const sendInvoice = (id: string, purpose: 'invoice' | 'reminder' = 'invoice') => callJson('invoice-send', { invoiceId: id, purpose });
export const payInvoiceByCard = (id: string) => callJson('pay-sales-invoice', { invoiceId: id });

/* ── Jobs ──────────────────────────────────────────────────────────── */
export type PriceType = 'fixed' | 'hourly' | 'quote';
export interface JobService { id: string; organization_id: string; name: string; description: string | null; price_type: PriceType;
  price: number | null; vat_rate: number; call_out_fee: number | null; requires_authorisation: string | null; active: boolean; sort: number }
export interface Job { id: string; organization_id: string; number: number; service_id: string; customer_user_id: string | null;
  customer: { name: string; phone: string; email: string | null }; address: string; postcode: string | null; city: string | null;
  description: string | null; preferred_time: string | null; status: string; price_type: PriceType; agreed_price: number | null;
  quote_amount: number | null; quote_note: string | null; quote_valid_until: string | null; window_start: string | null;
  window_end: string | null; assigned_to: string | null; report: string | null; invoice_id: string | null; created_at: string;
  cancel_reason: string | null }
export interface JobItem { id: string; job_id: string; kind: string; description: string; quantity: number; unit_price: number; vat_rate: number }

export const JOB_STATUS: Record<string, string> = {
  requested: 'Waiting for quote', quoted: 'Quote sent', accepted: 'To schedule', declined: 'Quote declined', scheduled: 'Scheduled',
  in_progress: 'In progress', completed: 'Completed', invoiced: 'Invoiced', cancelled: 'Cancelled',
};
export const PRICE_TYPE: Record<PriceType, string> = { fixed: 'Fixed price', hourly: 'Per hour', quote: 'On quote' };

export async function loadJobServices(orgId: string): Promise<JobService[]> {
  const { data } = await supabase.from('job_services').select('*').eq('organization_id', orgId).order('sort');
  return (data ?? []) as JobService[];
}
export const saveJobService = (orgId: string, id: string | null, s: Partial<JobService>) => rpc('save_job_service', { p_org: orgId, p_id: id, p: s });
export async function loadJobs(filter: { orgId?: string; customer?: string }): Promise<Job[]> {
  let q = supabase.from('jobs').select('*').order('created_at', { ascending: false }).limit(300);
  if (filter.orgId) q = q.eq('organization_id', filter.orgId);
  if (filter.customer) q = q.eq('customer_user_id', filter.customer);
  const { data } = await q;
  return (data ?? []) as Job[];
}
export async function loadJobItems(jobId: string): Promise<JobItem[]> {
  const { data } = await supabase.from('job_items').select('*').eq('job_id', jobId).order('created_at');
  return (data ?? []) as JobItem[];
}
export async function requestJob(orgId: string, serviceId: string, contact: object, place: object, description: string, preferred: string) {
  const { data, error } = await supabase.rpc('request_job', { p_org: orgId, p_service: serviceId, p_contact: contact, p_place: place,
                                                               p_description: description, p_preferred: preferred });
  return { job: data as Job | null, error: err(error) };
}
export const createJob = (orgId: string, serviceId: string, contact: object, place: object, description: string) =>
  rpc('create_job', { p_org: orgId, p_service: serviceId, p_contact: contact, p_place: place, p_description: description, p_preferred: null });
export const quoteJob = (id: string, amount: number, note: string, validDays: number) =>
  rpc('quote_job', { p_job: id, p_amount: amount, p_note: note, p_valid_days: validDays });
export const respondToQuote = (id: string, accept: boolean) => rpc('respond_to_quote', { p_job: id, p_accept: accept });
export const scheduleJob = (id: string, start: string, end: string, assignee: string | null) =>
  rpc('schedule_job', { p_job: id, p_start: start, p_end: end, p_assignee: assignee });
export const startJob = (id: string) => rpc('start_job', { p_job: id });
export const addJobItem = (id: string, kind: string, description: string, quantity: number, unitPrice: number, vat = 25) =>
  rpc('add_job_item', { p_job: id, p_kind: kind, p_description: description, p_quantity: quantity, p_unit_price: unitPrice, p_vat_rate: vat });
export const removeJobItem = (itemId: string) => rpc('remove_job_item', { p_item: itemId });
export const completeJob = (id: string, report: string) => rpc('complete_job', { p_job: id, p_report: report });
export const invoiceJob = (id: string) => rpc('invoice_job', { p_job: id });
export const cancelJob = (id: string, reason: string) => rpc('cancel_job', { p_job: id, p_reason: reason });

/* ── Appointments ──────────────────────────────────────────────────── */
export interface AppointmentService { id: string; organization_id: string; name: string; description: string | null;
  duration_minutes: number; buffer_minutes: number; price: number; vat_rate: number; active: boolean; sort: number }
export interface Resource { id: string; organization_id: string; name: string; user_id: string | null; active: boolean; sort: number }
export interface Hours { resource_id: string; weekday: number; start_time: string; end_time: string }
export interface AppointmentSettings { cancel_hours: number; slot_step_minutes: number; horizon_days: number; min_notice_minutes: number; no_show_fee: number | null }
export interface Appointment { id: string; organization_id: string; number: number; service_id: string; resource_id: string;
  customer_user_id: string | null; customer: { name: string; phone: string; email: string | null }; starts_at: string; ends_at: string;
  price: number; status: 'booked' | 'cancelled' | 'completed' | 'no_show'; notes: string | null; invoice_id: string | null; cancel_reason: string | null }

export const APPOINTMENT_STATUS: Record<string, string> = { booked: 'Booked', cancelled: 'Cancelled', completed: 'Completed', no_show: 'No-show' };
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export async function loadAppointmentSetup(orgId: string) {
  const [{ data: services }, { data: resources }, { data: settings }] = await Promise.all([
    supabase.from('appointment_services').select('*').eq('organization_id', orgId).order('sort'),
    supabase.from('appointment_resources').select('*').eq('organization_id', orgId).order('sort'),
    supabase.from('appointment_settings').select('*').eq('organization_id', orgId).maybeSingle(),
  ]);
  const ids = (resources ?? []).map((r: Resource) => r.id);
  const [{ data: hours }, { data: links }] = ids.length
    ? await Promise.all([
        supabase.from('appointment_hours').select('*').in('resource_id', ids),
        supabase.from('appointment_resource_services').select('*').in('resource_id', ids),
      ])
    : [{ data: [] }, { data: [] }];
  return {
    services: (services ?? []) as AppointmentService[], resources: (resources ?? []) as Resource[],
    settings: (settings ?? null) as AppointmentSettings | null, hours: (hours ?? []) as Hours[],
    links: (links ?? []) as { resource_id: string; service_id: string }[],
  };
}
export const saveAppointmentSettings = (orgId: string, s: Partial<AppointmentSettings>) => rpc('save_appointment_settings', { p_org: orgId, p: s });
export const saveAppointmentService = (orgId: string, id: string | null, s: Partial<AppointmentService>) =>
  rpc('save_appointment_service', { p_org: orgId, p_id: id, p: s });
export const saveResource = (orgId: string, id: string | null, r: { name: string; user_id: string | null; active?: boolean;
  service_ids: string[]; hours: { weekday: number; start: string; end: string }[] }) => rpc('save_appointment_resource', { p_org: orgId, p_id: id, p: r });
export const addTimeOff = (resourceId: string, from: string, to: string, reason: string) =>
  rpc('add_appointment_time_off', { p_resource: resourceId, p_from: from, p_to: to, p_reason: reason });
export async function freeSlots(orgId: string, serviceId: string, day: string, resourceId: string | null) {
  const { data } = await supabase.rpc('available_slots', { p_org: orgId, p_service: serviceId, p_day: day, p_resource: resourceId });
  return (data ?? []) as { resource_id: string; resource_name: string; starts_at: string }[];
}
export async function bookAppointment(orgId: string, serviceId: string, resourceId: string | null, start: string, contact: object, notes: string) {
  const { data, error } = await supabase.rpc('book_appointment', { p_org: orgId, p_service: serviceId, p_resource: resourceId,
                                                                    p_start: start, p_contact: contact, p_notes: notes });
  return { appointment: data as Appointment | null, error: err(error) };
}
export const createAppointment = (orgId: string, serviceId: string, resourceId: string | null, start: string, contact: object, notes: string) =>
  rpc('create_appointment', { p_org: orgId, p_service: serviceId, p_resource: resourceId, p_start: start, p_contact: contact, p_notes: notes });
export async function loadAppointments(filter: { orgId?: string; customer?: string; from?: string; to?: string }): Promise<Appointment[]> {
  let q = supabase.from('appointments').select('*').order('starts_at').limit(500);
  if (filter.orgId) q = q.eq('organization_id', filter.orgId);
  if (filter.customer) q = q.eq('customer_user_id', filter.customer);
  if (filter.from) q = q.gte('starts_at', filter.from);
  if (filter.to) q = q.lt('starts_at', filter.to);
  const { data } = await q;
  return (data ?? []) as Appointment[];
}
export const cancelAppointment = (id: string, reason: string) => rpc('cancel_appointment', { p_id: id, p_reason: reason });
export const closeAppointment = (id: string, outcome: 'completed' | 'no_show') => rpc('close_appointment', { p_id: id, p_outcome: outcome });
export const invoiceAppointment = (id: string) => rpc('invoice_appointment', { p_id: id });

/* ── Dates (Europe/Oslo) ───────────────────────────────────────────── */
export const osloTime = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });
export const osloDateTime = (iso: string) => new Date(iso).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'medium', timeStyle: 'short' });
export const osloToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });          // YYYY-MM-DD
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** A local Oslo date and time (from inputs) as an ISO instant. */
export function osloInstant(day: string, time: string): string {
  const guess = new Date(`${day}T${time}:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime())).toISOString();
}
