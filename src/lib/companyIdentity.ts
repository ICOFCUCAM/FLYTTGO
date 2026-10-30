/**
 * FlyttGo's own public business details, as the invoices state them: the
 * invoice seller settings (migration 00008, Admin → Invoicing → Invoice
 * settings), read through flyttgo_public_identity() (00026), which gives
 * only the public fields (never the bank account). The footer, header and
 * contact page show each line only once it is set, so nothing invented
 * appears while a setting is empty (docs/COMPANY_DETAILS.md).
 *
 * The one exception is the phone (owner's decision, 2026-10-30): while it
 * is empty a Norwegian placeholder that cannot reach anyone,
 * PHONE_PLACEHOLDER, is shown as plain text (never a tel: or WhatsApp link).
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface CompanyIdentity {
  name: string | null;
  org_number: string | null;
  vat_registered: boolean;
  address: string | null;
  postcode_city: string | null;
  email: string | null;
  phone: string | null;
}

export const EMPTY_IDENTITY: CompanyIdentity = {
  name: null, org_number: null, vat_registered: false, address: null, postcode_city: null, email: null, phone: null,
};

/** Shown while the phone setting is empty: 8-digit Norwegian format, not a real number. */
export const PHONE_PLACEHOLDER = '+47 000 00 000';

/** The support address on FlyttGo's own domain, used while no email is set. */
export const DEFAULT_SUPPORT_EMAIL = 'support@flyttgo.no';

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

export function normaliseIdentity(raw: unknown): CompanyIdentity {
  if (!raw || typeof raw !== 'object') return EMPTY_IDENTITY;
  const r = raw as Record<string, unknown>;
  return {
    name: text(r.name), org_number: text(r.org_number), vat_registered: r.vat_registered === true,
    address: text(r.address), postcode_city: text(r.postcode_city), email: text(r.email), phone: text(r.phone),
  };
}

/** "123456789" → "123 456 789" (other formats are left as typed). */
export function formatOrgNumber(org: string): string {
  const digits = org.replace(/\s/g, '');
  return /^\d{9}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : org;
}

/** The MVA number as Norwegian invoices print it, only when registered. */
export function mvaNumber(id: CompanyIdentity): string | null {
  return id.vat_registered && id.org_number ? `NO ${formatOrgNumber(id.org_number)} MVA` : null;
}

/** The phone to show, and whether it is the real one (only a real one is a link). */
export function displayPhone(id: CompanyIdentity): { text: string; real: boolean; tel: string | null; whatsapp: string | null } {
  if (!id.phone) return { text: PHONE_PLACEHOLDER, real: false, tel: null, whatsapp: null };
  const digits = id.phone.replace(/[^\d+]/g, '');
  return { text: id.phone, real: true, tel: `tel:${digits}`, whatsapp: `https://wa.me/${digits.replace(/^\+/, '')}` };
}

let cache: Promise<CompanyIdentity> | null = null;

export function loadCompanyIdentity(): Promise<CompanyIdentity> {
  cache ??= Promise.resolve(supabase.rpc('flyttgo_public_identity'))
    .then(({ data, error }) => (error ? EMPTY_IDENTITY : normaliseIdentity(data)))
    .catch(() => EMPTY_IDENTITY);
  return cache;
}

/** For tests: forget the loaded details. */
export function resetCompanyIdentityCache() { cache = null; }

export function useCompanyIdentity(): CompanyIdentity {
  const [identity, setIdentity] = useState<CompanyIdentity>(EMPTY_IDENTITY);
  useEffect(() => {
    let live = true;
    loadCompanyIdentity().then(id => { if (live) setIdentity(id); });
    return () => { live = false; };
  }, []);
  return identity;
}
