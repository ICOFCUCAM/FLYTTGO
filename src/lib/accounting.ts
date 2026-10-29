/**
 * FlyttGo as host of the accounting module (src/accounting, 00014/00015):
 * its posting of invoices, its price list and billing band, invitations
 * emailed by the server, and the company details documents need.
 */
import { createAccountingApi, type HostApi } from '../accounting/api';
import type { DocumentsHost } from '../accounting/ui/DocumentsTab';
import type { PriceTier, TierInfo, Unposted } from '../accounting/types';
import { supabase } from './supabase';

const host: HostApi = {
  unposted: async ledger => ((await supabase.rpc('accounting_unposted', { p_ledger: ledger })).data ?? []) as Unposted[],
  postUnposted: async ledger => {
    const { data, error } = await supabase.rpc('accounting_post_unposted', { p_ledger: ledger });
    if (error) throw new Error(error.message.replace(/^accounting: /, ''));
    return Number(data ?? 0);
  },
  tier: async ledger => ((await supabase.rpc('accounting_tier', { p_ledger: ledger })).data ?? null) as TierInfo | null,
  priceList: async () => ((await supabase.rpc('accounting_price')).data ?? null) as { tiers: PriceTier[]; price_status: string } | null,
  invite: async (ledgerId, input, lang) => {
    const { data, error } = await supabase.functions.invoke('accounting-invite', { body: { ledgerId, ...input, lang } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      return (body as { error?: string } | null)?.error ?? error.message;
    }
    return (data as { error?: string } | null)?.error ?? null;
  },
  acceptUrl: token => `${window.location.origin}/accounting?invite=${encodeURIComponent(token)}`,
};

export const accountingApi = createAccountingApi(supabase, host);

export const SOFTWARE = { company: 'FlyttGo AS', id: 'FlyttGo Regnskap', version: '1.0' };

/** What the documents and SAF-T say about the company, from its invoice settings. */
export async function documentsHostFor(organizationId: string | null): Promise<DocumentsHost> {
  if (!organizationId) return { software: SOFTWARE, company: {} };
  const { data } = await supabase.from('organization_invoice_settings')
    .select('address, postcode_city, email, phone').eq('organization_id', organizationId).maybeSingle();
  const pc = (data?.postcode_city ?? '').match(/^(\d{4})\s+(.*)$/);
  return {
    software: SOFTWARE,
    company: { street: data?.address ?? null, postalCode: pc?.[1] ?? null, city: pc?.[2] ?? data?.postcode_city ?? null,
               email: data?.email ?? null, phone: data?.phone ?? null },
  };
}
