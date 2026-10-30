/**
 * Inbound messages from the public forms (migration 00026): the contact
 * page, the corporate quote form and the newsletter sign-up in the footer.
 * Visitors write only through submit_contact_message(), which checks the
 * fields and the rate limit; FlyttGo administrators read and mark them
 * under Admin → Inbox. A form says "sent" only when this returns ok.
 */
import { supabase } from './supabase';

export type ContactSource = 'contact' | 'corporate' | 'newsletter';

export interface ContactMessageInput {
  source: ContactSource;
  email: string;
  name?: string;
  phone?: string;
  company?: string;
  topic?: string;
  message?: string;
}

export interface ContactMessage {
  id: string; source: ContactSource; topic: string | null; name: string | null; email: string;
  phone: string | null; company: string | null; message: string | null;
  status: 'new' | 'handled'; handled_by: string | null; handled_at: string | null; created_at: string;
}

/** error is empty when ok. */
export interface SubmitResult { ok: boolean; error: string }

export const CONTACT_LIMITS = { name: 120, email: 254, phone: 40, company: 200, topic: 200, message: 5000 } as const;

/** The database's own wording for the checks of 00026 (without its
 * "contact: " prefix); any other failure gets a general message. */
export function contactErrorText(message: string | undefined | null): string {
  const raw = String(message ?? '');
  const text = /^contact:/i.test(raw) ? raw.replace(/^contact:\s*/i, '').trim() : '';
  if (!text) return 'Your message could not be sent. Please try again later.';
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
}

export async function submitContactMessage(input: ContactMessageInput): Promise<SubmitResult> {
  try {
    const { error } = await supabase.rpc('submit_contact_message', {
      p_source: input.source, p_name: input.name ?? null, p_email: input.email, p_phone: input.phone ?? null,
      p_company: input.company ?? null, p_topic: input.topic ?? null, p_message: input.message ?? null,
    });
    if (error) return { ok: false, error: contactErrorText(error.message) };
    return { ok: true, error: '' };
  } catch {
    return { ok: false, error: 'Your message could not be sent. Check your connection and try again.' };
  }
}

/**
 * What a form does on submit: the required fields are checked first (no
 * call when one is empty), then the message is stored. The form shows its
 * "sent" view only when this returns ok, and the error otherwise.
 */
export async function sendContactForm(
  input: ContactMessageInput,
  required: (keyof ContactMessageInput)[],
  requiredMessage: string,
  submit: (i: ContactMessageInput) => Promise<SubmitResult> = submitContactMessage,
): Promise<SubmitResult> {
  if (required.some(k => !String(input[k] ?? '').trim())) return { ok: false, error: requiredMessage };
  return submit(input);
}

/** Admin → Inbox: newest first; RLS returns rows only to FlyttGo administrators. */
export async function loadContactMessages(status: 'new' | 'handled' | 'all'): Promise<{ rows: ContactMessage[]; error: string | null }> {
  let q = supabase.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(500);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  return { rows: (data ?? []) as ContactMessage[], error: error?.message ?? null };
}

export async function setContactMessageStatus(id: string, status: 'new' | 'handled'): Promise<string | null> {
  const { error } = await supabase.rpc('admin_set_contact_message_status', { p_id: id, p_status: status });
  return error ? contactErrorText(error.message) : null;
}
