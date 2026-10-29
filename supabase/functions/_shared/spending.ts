// ============================================================================
// FlyttGo — spending limits and approval of company bookings (00017)
// ============================================================================
//
// Shared by the payment functions (through booking-charge.ts) and the
// browser. The database decides (company_booking_check,
// decide_booking_approval, set_member_spending_limits); these helpers
// read its answer and say which buttons to show, using the same rules.
// No Deno or browser imports, so Vitest tests it directly.
// ============================================================================

export type ApprovalReason = 'per_booking_limit' | 'monthly_limit' | 'amount_over' | 'role' | 'price_changed';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'refused' | 'expired' | 'withdrawn';

export const APPROVAL_REASON_LABELS: Record<ApprovalReason, string> = {
  per_booking_limit: 'over your limit per booking',
  monthly_limit:     'over your monthly limit',
  amount_over:       'above the amount your company approves',
  role:              'your company approves every booking by your role',
  price_changed:     'at a different price from the one approved',
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  not_required: 'Within limits', pending: 'Waiting for approval', approved: 'Approved',
  refused: 'Not approved', expired: 'Approval expired', withdrawn: 'Withdrawn',
};

/** What company_booking_check returns (jsonb). */
export interface CheckResult {
  status: 'not_company' | ApprovalStatus;
  new?: boolean;
  amount?: number;
  reasons?: string[];
  expires_at?: string | null;
  approvers?: string[];
  organization?: string | null;
  reason?: string | null;
}

export interface ApprovalHold {
  status: 'pending';
  reasons: ApprovalReason[];
  amountNok: number;
  expiresAt: string | null;
}

export type CheckDecision =
  | { proceed: true }
  | { proceed: false; status: number; error: string; approval?: ApprovalHold };

function knownReasons(list: string[] | undefined): ApprovalReason[] {
  return (list ?? []).filter((r): r is ApprovalReason => r in APPROVAL_REASON_LABELS);
}

/** "This booking is over your monthly limit, so it needs approval …" */
export function approvalNotice(reasons: readonly ApprovalReason[], company?: string | null): string {
  const who = company ? `${company}'s` : 'your company\'s';
  const why = reasons.length ? reasons.map(r => APPROVAL_REASON_LABELS[r]).join('; ') : 'it needs approval';
  return `This booking is ${why}. It waits for ${who} approval and is not paid or dispatched until then.`;
}

/**
 * The payment function's answer from the database's check: pay as before
 * (within limits, approved, or not a company booking), or stop. A booking
 * that waits for approval is 409 with `awaitingApproval` (chargeRefusal):
 * nothing is paid, and a payment page that predates 00017 shows the
 * message rather than taking a success status for a booking.
 */
export function interpretCheck(r: CheckResult | null): CheckDecision {
  if (!r) return { proceed: false, status: 500, error: 'the company\'s spending check gave no answer' };
  switch (r.status) {
    case 'not_company':
    case 'not_required':
    case 'approved':
      return { proceed: true };
    case 'pending': {
      const reasons = knownReasons(r.reasons);
      return {
        proceed: false, status: 409, error: approvalNotice(reasons, r.organization),
        approval: { status: 'pending', reasons, amountNok: Number(r.amount ?? 0), expiresAt: r.expires_at ?? null },
      };
    }
    case 'refused':
      return { proceed: false, status: 409, error: `your company did not approve this booking${r.reason ? `: ${r.reason}` : ''}` };
    case 'expired':
      return { proceed: false, status: 409, error: 'the company\'s approval was not given in time; the booking is cancelled' };
    default:
      return { proceed: false, status: 409, error: `the booking cannot be paid (${r.status})` };
  }
}

type Role = 'owner' | 'admin' | 'booker' | 'finance' | 'viewer' | 'staff';

/** May myRole set targetRole's limits? (00017 set_member_spending_limits.) Nobody sets their own. */
export function canSetLimits(myRole: Role | null, targetRole: Role, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (myRole === 'owner') return true;
  if (myRole === 'admin') return !['owner', 'admin'].includes(targetRole);
  if (myRole === 'finance') return !['owner', 'admin', 'finance'].includes(targetRole);
  return false;
}

/** May myRole set the company's approval rules and see everyone's spend? */
export function canManageSpending(myRole: Role | null): boolean {
  return myRole === 'owner' || myRole === 'admin' || myRole === 'finance';
}

/** May this member approve a booking? Never one they made, whatever their role. */
export function canApprove(myRole: Role | null, isOwnBooking: boolean): boolean {
  return !isOwnBooking && canManageSpending(myRole);
}

/** A limit typed in the browser: empty means no limit; otherwise whole NOK, not negative. */
export function parseLimit(input: string): number | null | 'invalid' {
  const t = input.replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 'invalid';
}

/** The Europe/Oslo calendar month a time falls in, e.g. "oktober 2026". */
export function osloMonthLabel(at: Date = new Date()): string {
  return at.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });
}
