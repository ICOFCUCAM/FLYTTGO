/** The accounting core's records and report rows, as the database returns them (00014). */

export type Role = 'owner' | 'accountant' | 'bookkeeper' | 'auditor' | 'viewer';

export interface Ledger {
  id: string; tenant_id: string | null; status: 'requested' | 'active' | 'declined' | 'ended';
  legal_name: string; org_number: string | null; vat_registered: boolean; mva_term: 'bimonthly' | 'yearly';
  zero_rate_code: '5' | '6'; start_date: string; auto_post: boolean; locked_until: string | null;
  monthly_fee: number | null; declared_turnover: number | null; decided_at: string | null; created_at: string;
}
export interface Account {
  ledger_id: string; code: string; name: string; default_mva_code: string | null;
  grouping_category: string | null; grouping_code: string | null; active: boolean;
}
export interface MvaCode { code: string; direction: 'output' | 'input' | 'none'; rate: number; description: string; sort: number }
export interface Voucher {
  id: string; ledger_id: string; year: number; number: number; voucher_date: string; description: string;
  source_type: string; source_id: string | null; reverses_voucher: string | null; posted_by: string | null; posted_at: string;
}
export interface VoucherLine {
  id: string; voucher_id: string; line_no: number; account_code: string; debit: number; credit: number;
  mva_code: string | null; mva_role: 'basis' | 'vat' | null; description: string | null; party: string | null; ref: string | null;
}
export interface Attachment { id: string; voucher_id: string; storage_path: string; file_name: string; sha256: string; size_bytes: number; uploaded_at: string }
export interface Member {
  ledger_id: string; user_id: string; role: Exclude<Role, 'owner'>; name: string | null; email: string | null; firm: string | null;
  valid_until: string | null; status: 'active' | 'removed'; added_at: string; removed_at: string | null; removed_reason: string | null;
}
export interface Invitation {
  id: string; ledger_id: string; email: string; role: Exclude<Role, 'owner'>; name: string | null; firm: string | null;
  valid_until: string | null; status: 'pending' | 'accepted' | 'revoked'; created_at: string; expires_at: string;
}
export interface Note { id: string; ledger_id: string; voucher_id: string | null; author_id: string | null; role: string; body: string; created_at: string }

export interface TrialRow { account_code: string; account_name: string; opening: number; debit: number; credit: number; closing: number }
export interface LedgerRow {
  voucher_id: string; voucher_no: string; voucher_date: string; description: string; account_code: string;
  debit: number; credit: number; mva_code: string | null; line_description: string | null; party: string | null;
}
export interface StatementRow { grp: string; account_code: string | null; account_name: string; amount: number }
export interface MvaRow { mva_code: string; description: string; direction: 'output' | 'input' | 'none'; rate: number; basis: number; mva: number; term_from: string; term_to: string }
export interface CheckRow { check_name: string; ok: boolean; detail: string }
export interface MyLedger { ledger_id: string; legal_name: string; status: string; role: Role; tenant_id: string | null }
export interface Unposted { source_type: string; source_id: string; source_date: string; description: string; amount: number }
export interface PriceTier { name: string; up_to: number | null; monthly_fee: number | null }
export interface TierInfo { tier: string | null; turnover: number; basis: string; list_fee: number | null; agreed_fee: number | null; monthly_fee: number | null }

/** A manual voucher line as the office sends it: a signed amount (positive debit). */
export interface DraftLine { account: string; amount: number; mva_code?: string | null; description?: string | null; party?: string | null }
