// ============================================================================
// FlyttGo — loading, rendering and emailing invoices (server side)
// ============================================================================
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ehfXml, formatBankAccount, nok, type Invoice, type InvoiceLine } from './invoices.ts';
import { invoicePdf } from './invoice-pdf.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FLYTTGO_FROM   = Deno.env.get('FLYTTGO_FROM') ?? 'FlyttGo <faktura@flyttgo.no>';
const REPLY_TO       = Deno.env.get('FLYTTGO_REPLY_TO') ?? 'support@flyttgo.no';

export interface LoadedInvoice { invoice: Invoice & { organization_id: string | null; issuer_org?: string | null }; lines: InvoiceLine[] }

/** The sender of an invoice email: FlyttGo for its own invoices; the
 *  company's name (on FlyttGo's sending address) for a company's own
 *  invoices (00011), with replies going to the company. */
export function invoiceSender(inv: { issuer_org?: string | null; seller: { name?: string | null; email?: string | null } }) {
  if (!inv.issuer_org) return { from: FLYTTGO_FROM, replyTo: REPLY_TO };
  const address = /<([^>]+)>/.exec(FLYTTGO_FROM)?.[1] ?? FLYTTGO_FROM;
  const name = String(inv.seller.name ?? 'Faktura').replace(/["<>\r\n]/g, '').slice(0, 70);
  return { from: `"${name}" <${address}>`, replyTo: inv.seller.email || REPLY_TO };
}

/** An issued invoice with its lines (service client: the caller was checked before). */
export async function loadInvoice(db: SupabaseClient, id: string): Promise<LoadedInvoice | null> {
  const { data: inv } = await db.from('invoices').select('*').eq('id', id).maybeSingle();
  if (!inv || inv.status === 'draft') return null;
  const { data: lines } = await db.from('invoice_lines').select('*').eq('invoice_id', id).order('line_no');
  let credits_number: number | null = null;
  if (inv.credits_invoice_id) {
    const { data: orig } = await db.from('invoices').select('number').eq('id', inv.credits_invoice_id).maybeSingle();
    credits_number = orig?.number ?? null;
  }
  const n = (v: unknown) => Number(v ?? 0);
  return {
    invoice: {
      ...inv, credits_number,
      net_total: n(inv.net_total), vat_total: n(inv.vat_total), total: n(inv.total),
      amount_paid: n(inv.amount_paid), amount_credited: n(inv.amount_credited), fees_total: n(inv.fees_total),
    },
    lines: (lines ?? []).map((l: any) => ({
      ...l, quantity: n(l.quantity), unit_price: n(l.unit_price), vat_rate: n(l.vat_rate),
      net_amount: n(l.net_amount), vat_amount: n(l.vat_amount), total: n(l.total),
    })),
  };
}

/** The company's logo for a branded invoice (special plan), if any. */
export async function loadLogo(db: SupabaseClient, inv: Invoice): Promise<{ bytes: Uint8Array; type: 'png' | 'jpeg' } | null> {
  const path = inv.branding?.logo_path;
  if (!path) return null;
  const { data } = await db.storage.from('organization-logos').download(path);
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return png ? { bytes, type: 'png' } : jpeg ? { bytes, type: 'jpeg' } : null;
}

export async function renderPdf(db: SupabaseClient, li: LoadedInvoice): Promise<Uint8Array> {
  return invoicePdf(li.invoice, li.lines, await loadLogo(db, li.invoice));
}

export const renderEhf = (li: LoadedInvoice) => ehfXml(li.invoice, li.lines);

export const fileName = (inv: Invoice, ext: string) =>
  `${inv.kind === 'credit_note' ? 'kreditnota' : 'faktura'}-${inv.number}.${ext}`;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Email the invoice (or a reminder) as PDF with the EHF file attached, to
 * the company's billing address. Idempotent per invoice and purpose
 * (Resend Idempotency-Key). Returns null when sent, else the reason.
 */
export async function emailInvoice(
  db: SupabaseClient, li: LoadedInvoice, purpose: 'invoice' | 'reminder',
  opts: { reminderLevel?: number; resend?: boolean } = {},
): Promise<string | null> {
  const reminderLevel = opts.reminderLevel ?? 0;
  if (!RESEND_API_KEY) return 'email is not configured (RESEND_API_KEY)';
  const inv = li.invoice;
  const to = inv.buyer.email;
  if (!to) return inv.issuer_org ? 'the customer has no email address' : 'the company has no billing email';
  const pdf = await renderPdf(db, li);
  const owed = inv.total + (inv.fees_total ?? 0) - (inv.amount_paid ?? 0) - (inv.amount_credited ?? 0);
  const brand = inv.branding?.name ?? inv.seller.name ?? 'FlyttGo';
  const credit = inv.kind === 'credit_note';
  const subject = purpose === 'reminder' ? `Påminnelse: faktura ${inv.number} fra ${brand}`
    : credit ? `Kreditnota ${inv.number} fra ${brand}` : `Faktura ${inv.number} fra ${brand}`;
  const body = purpose === 'reminder'
    ? `<p>Hei,</p><p>Vi finner ikke betaling for faktura ${inv.number}, som forfalt ${esc(inv.due_date)}.
       Utestående beløp er <strong>${esc(nok(owed))}</strong>${reminderLevel ? ' inkludert gebyr og renter' : ''}.</p>`
    : credit
    ? `<p>Hei,</p><p>Vedlagt er kreditnota ${inv.number} på ${esc(nok(-inv.total))}, som krediterer faktura ${inv.credits_number}.</p>`
    : `<p>Hei,</p><p>Vedlagt er faktura ${inv.number} på <strong>${esc(nok(inv.total))}</strong>, med forfall ${esc(inv.due_date)}.</p>`;
  const pay = credit ? '' : `<p>Betal til konto <strong>${esc(formatBankAccount(inv.seller.bank_account))}</strong>
       med KID <strong>${esc(inv.kid)}</strong>.</p>`;
  const html = `${body}${pay}<p>Spørsmål om fakturaen? Svar på denne e-posten.</p><p>Med vennlig hilsen<br>${esc(inv.seller.name)}</p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json',
               /* The first send and each reminder go once; an administrator's resend is a new email. */
               'Idempotency-Key': `invoice-${inv.id}-${purpose}-${reminderLevel}${opts.resend ? `-${Date.now()}` : ''}` },
    body: JSON.stringify({
      from: invoiceSender(inv).from, to: [to], reply_to: invoiceSender(inv).replyTo, subject, html,
      attachments: [
        { filename: fileName(inv, 'pdf'), content: b64(pdf) },
        { filename: fileName(inv, 'xml'), content: btoa(unescape(encodeURIComponent(renderEhf(li)))) },
      ],
    }),
  }).catch((e: Error) => ({ ok: false, status: 599, text: async () => e.message }));
  if (!res.ok) return `email failed (${res.status}): ${(await res.text()).slice(0, 200)}`;
  await db.rpc('mark_invoice_sent', { p_invoice: inv.id, p_channel: purpose === 'reminder' ? `reminder ${reminderLevel}` : 'email' });
  return null;
}
