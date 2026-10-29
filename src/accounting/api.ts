/**
 * The accounting core over any Supabase client (FlyttGo's, Ledgera's): every
 * call goes to the `accounting` schema, which the project exposes to its API.
 * What depends on the host (posting its invoices, its price list) comes in
 * through `host`, so this file is copied unchanged.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Account, Attachment, CheckRow, DraftLine, Invitation, Ledger, LedgerRow, Member, MvaCode, MvaRow, MyLedger, Note,
  PriceTier, StatementRow, TierInfo, TrialRow, Unposted, Voucher, VoucherLine,
} from './types';

export interface HostApi {
  unposted?: (ledger: string) => Promise<Unposted[]>;
  postUnposted?: (ledger: string) => Promise<number>;
  tier?: (ledger: string) => Promise<TierInfo | null>;
  priceList?: () => Promise<{ tiers: PriceTier[]; price_status: string } | null>;
  /**
   * Invites and emails on the server, so the token never reaches the
   * browser; returns an error message or null. Without it the office calls
   * accounting.invite() and shows the link (acceptUrl) to pass on.
   */
  invite?: (ledger: string, input: { email: string; role: string; name?: string; firm?: string; validUntil?: string | null }, lang: 'en' | 'no') => Promise<string | null>;
  /** Where an invited person accepts, for the link: the token is appended. */
  acceptUrl?: (token: string) => string;
}

export type Result<T> = { data: T; error: null } | { data: null; error: string };

export const RECEIPT_BUCKET = 'ledger-attachments';

export function createAccountingApi(client: SupabaseClient, host: HostApi = {}) {
  const db = client.schema('accounting');
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> => {
    const { data, error } = await db.rpc(fn, args);
    return error ? { data: null, error: error.message.replace(/^accounting: /, '') } : { data: data as T, error: null };
  };
  const rows = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  };

  return {
    host,
    // Ledgers
    myLedgers: () => rpc<MyLedger[]>('my_ledgers', {}),
    ledgerForTenant: async (tenant: string) =>
      (await rows<Ledger>(db.from('ledgers').select('*').eq('tenant_id', tenant)))[0] ?? null,
    ledger: async (id: string) => (await rows<Ledger>(db.from('ledgers').select('*').eq('id', id)))[0] ?? null,
    pendingLedgers: () => rows<Ledger>(db.from('ledgers').select('*').eq('status', 'requested').order('created_at')),
    allLedgers: () => rows<Ledger>(db.from('ledgers').select('*').order('legal_name')),
    roleOf: (ledger: string) => rpc<string | null>('role_of', { p_ledger: ledger }),
    canManage: (ledger: string) => rpc<boolean>('can_manage', { p_ledger: ledger }),
    request: (tenant: string, start: string, term: string, declaredTurnover: number | null) =>
      rpc<Ledger>('request_ledger', { p_tenant: tenant, p_start: start, p_mva_term: term, p_declared_turnover: declaredTurnover }),
    decide: (ledger: string, approve: boolean, monthlyFee: number | null, note: string) =>
      rpc<Ledger>('decide_ledger', { p_ledger: ledger, p_approve: approve, p_monthly_fee: monthlyFee, p_note: note }),
    openHouse: (legalName: string, orgNumber: string, start: string, term: string) =>
      rpc<Ledger>('open_house_ledger', { p_legal_name: legalName, p_org_number: orgNumber, p_start: start, p_mva_term: term }),
    setSettings: (ledger: string, s: Partial<Pick<Ledger, 'vat_registered' | 'mva_term' | 'zero_rate_code' | 'auto_post' | 'legal_name' | 'org_number'>>) =>
      rpc<Ledger>('set_settings', { p_ledger: ledger, p: s }),
    end: (ledger: string, reason: string) => rpc<Ledger>('end_ledger', { p_ledger: ledger, p_reason: reason }),

    // Chart of accounts
    accounts: (ledger: string) => rows<Account>(db.from('accounts').select('*').eq('ledger_id', ledger).order('code')),
    mvaCodes: () => rows<MvaCode>(db.from('mva_codes').select('*').order('sort')),
    postingAccounts: (ledger: string) => rows<{ key: string; account_code: string }>(db.from('posting_accounts').select('key, account_code').eq('ledger_id', ledger)),
    saveAccount: (ledger: string, a: { code: string; name: string; mva: string | null; active: boolean; groupingCategory?: string | null; groupingCode?: string | null }) =>
      rpc<Account>('save_account', { p_ledger: ledger, p_code: a.code, p_name: a.name, p_mva_code: a.mva, p_active: a.active,
                                      p_grouping_category: a.groupingCategory ?? null, p_grouping_code: a.groupingCode ?? null }),
    setPostingAccount: (ledger: string, key: string, code: string) => rpc<null>('set_posting_account', { p_ledger: ledger, p_key: key, p_code: code }),

    // Vouchers
    vouchers: (ledger: string, from: string, to: string) =>
      rows<Voucher>(db.from('vouchers').select('*').eq('ledger_id', ledger).gte('voucher_date', from).lte('voucher_date', to)
        .order('year').order('number')),
    lines: (voucherIds: string[]) => voucherIds.length === 0 ? Promise.resolve([] as VoucherLine[])
      : rows<VoucherLine>(db.from('voucher_lines').select('*').in('voucher_id', voucherIds).order('line_no')),
    attachments: (voucherIds: string[]) => voucherIds.length === 0 ? Promise.resolve([] as Attachment[])
      : rows<Attachment>(db.from('attachments').select('*').in('voucher_id', voucherIds)),
    post: (ledger: string, date: string, description: string, lines: DraftLine[]) =>
      rpc<Voucher>('post_voucher', { p_ledger: ledger, p_date: date, p_description: description, p_lines: lines }),
    reverse: (voucher: string, date: string | null, reason: string) =>
      rpc<Voucher>('reverse_voucher', { p_voucher: voucher, p_date: date, p_reason: reason }),
    /** Uploads a receipt to the ledger's folder and records it with its SHA-256. */
    attach: async (ledger: string, voucher: string, file: File | Blob, fileName: string): Promise<Result<Attachment>> => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
      const safe = fileName.replace(/[^\w.\-æøåÆØÅ ]+/g, '_').slice(-120);
      const path = `${ledger}/${voucher}/${hash.slice(0, 12)}-${safe}`;
      const up = await client.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: (file as File).type || 'application/octet-stream', upsert: false });
      if (up.error) return { data: null, error: up.error.message };
      return rpc<Attachment>('add_attachment', { p_voucher: voucher, p_path: path, p_file_name: fileName, p_sha256: hash, p_size: bytes.length });
    },
    receiptUrl: async (path: string) => (await client.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 300)).data?.signedUrl ?? null,

    // Closing
    lock: (ledger: string, until: string) => rpc<Ledger>('lock_period', { p_ledger: ledger, p_until: until }),
    closeYear: (ledger: string, year: number) => rpc<Voucher>('close_year', { p_ledger: ledger, p_year: year }),
    settleMva: (ledger: string, year: number, term: number) => rpc<Voucher>('settle_mva', { p_ledger: ledger, p_year: year, p_term: term }),

    // Reports
    trialBalance: (ledger: string, from: string, to: string) => rpc<TrialRow[]>('trial_balance', { p_ledger: ledger, p_from: from, p_to: to }),
    generalLedger: (ledger: string, from: string, to: string, account?: string) =>
      rpc<LedgerRow[]>('general_ledger', { p_ledger: ledger, p_from: from, p_to: to, p_account: account ?? null }),
    incomeStatement: (ledger: string, from: string, to: string) => rpc<StatementRow[]>('income_statement', { p_ledger: ledger, p_from: from, p_to: to }),
    balanceSheet: (ledger: string, at: string) => rpc<StatementRow[]>('balance_sheet', { p_ledger: ledger, p_at: at }),
    mvaReport: (ledger: string, year: number, term: number) => rpc<MvaRow[]>('mva_report', { p_ledger: ledger, p_year: year, p_term: term }),
    checks: (ledger: string, from: string, to: string) => rpc<CheckRow[]>('review_checks', { p_ledger: ledger, p_from: from, p_to: to }),

    // Back office
    members: (ledger: string) => rows<Member>(db.from('members').select('*').eq('ledger_id', ledger).order('added_at')),
    invitations: (ledger: string) => rows<Invitation>(db.from('invitations').select('*').eq('ledger_id', ledger).eq('status', 'pending').order('created_at')),
    invite: (ledger: string, i: { email: string; role: string; name?: string; firm?: string; validUntil?: string | null }) =>
      rpc<Array<{ invitation_id: string; token: string; expires_at: string }>>('invite',
        { p_ledger: ledger, p_email: i.email, p_role: i.role, p_name: i.name ?? null, p_firm: i.firm ?? null, p_valid_until: i.validUntil || null }),
    accept: (token: string) => rpc<Member>('accept_invitation', { p_token: token }),
    revokeInvitation: (id: string) => rpc<null>('revoke_invitation', { p_invitation: id }),
    updateMember: (ledger: string, user: string, role: string, validUntil: string | null) =>
      rpc<Member>('update_member', { p_ledger: ledger, p_user: user, p_role: role, p_valid_until: validUntil }),
    removeMember: (ledger: string, user: string, reason: string) => rpc<null>('remove_member', { p_ledger: ledger, p_user: user, p_reason: reason }),
    notes: (ledger: string) => rows<Note>(db.from('notes').select('*').eq('ledger_id', ledger).order('created_at', { ascending: false })),
    addNote: (ledger: string, voucher: string | null, body: string) => rpc<Note>('add_note', { p_ledger: ledger, p_voucher: voucher, p_body: body }),
  };
}

export type AccountingApi = ReturnType<typeof createAccountingApi>;
