import { describe, expect, it } from 'vitest';
import {
  APPROVAL_REASON_LABELS, approvalNotice, type CheckDecision, canApprove, canManageSpending, canSetLimits, interpretCheck, osloMonthLabel, parseLimit,
} from '../../supabase/functions/_shared/spending';

type Stop = Extract<CheckDecision, { proceed: false }>;

describe('the payment functions read the database check (00017 company_booking_check)', () => {
  it('pays as before within the limits, once approved, and for personal bookings', () => {
    for (const status of ['not_company', 'not_required', 'approved'] as const) {
      expect(interpretCheck({ status })).toEqual({ proceed: true });
    }
  });

  it('a booking that needs approval is refused for now (409) with the request, and nothing is charged', () => {
    const d = interpretCheck({ status: 'pending', new: true, amount: 4200, reasons: ['monthly_limit', 'something_else'],
                               expires_at: '2026-11-05T10:00:00Z', organization: 'Acme AS' }) as Stop;
    expect(d.proceed).toBe(false);
    expect(d.status).toBe(409);
    expect(d.approval).toEqual({ status: 'pending', reasons: ['monthly_limit'], amountNok: 4200, expiresAt: '2026-11-05T10:00:00Z' });
    expect(d.error).toContain(APPROVAL_REASON_LABELS.monthly_limit);
    expect(d.error).toContain("Acme AS's approval");
  });

  it('refused, expired and unknown answers stop the payment with a reason', () => {
    const refused = interpretCheck({ status: 'refused', reason: 'not in budget' }) as Stop;
    expect(refused).toMatchObject({ proceed: false, status: 409 });
    expect(refused.error).toContain('not in budget');
    expect(interpretCheck({ status: 'expired' })).toMatchObject({ proceed: false, status: 409 });
    expect(interpretCheck({ status: 'withdrawn' })).toMatchObject({ proceed: false, status: 409 });
    expect(interpretCheck(null)).toMatchObject({ proceed: false, status: 500 });
  });

  it('names every reason', () => {
    expect(approvalNotice(['per_booking_limit', 'role'])).toBe(
      'This booking is over your limit per booking; your company approves every booking by your role. '
      + 'It waits for your company\'s approval and is not paid or dispatched until then.');
  });
});

describe('who sets limits and approves, as the database rules', () => {
  it('owners limit anyone else; admins those below admin; finance bookers, viewers and staff', () => {
    expect(canSetLimits('owner', 'owner', false)).toBe(true);
    expect(canSetLimits('owner', 'booker', true)).toBe(false);       // nobody sets their own
    expect(canSetLimits('admin', 'admin', false)).toBe(false);
    expect(canSetLimits('admin', 'finance', false)).toBe(true);
    expect(canSetLimits('finance', 'finance', false)).toBe(false);
    expect(canSetLimits('finance', 'booker', false)).toBe(true);
    expect(canSetLimits('booker', 'viewer', false)).toBe(false);
    expect(canSetLimits(null, 'booker', false)).toBe(false);
  });

  it('owners, admins and finance approve, never their own booking', () => {
    for (const r of ['owner', 'admin', 'finance'] as const) {
      expect(canManageSpending(r)).toBe(true);
      expect(canApprove(r, false)).toBe(true);
      expect(canApprove(r, true)).toBe(false);
    }
    for (const r of ['booker', 'viewer', 'staff'] as const) expect(canApprove(r, false)).toBe(false);
  });
});

describe('limits typed in the browser', () => {
  it('empty is no limit; amounts in NOK with Norwegian separators', () => {
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('  ')).toBeNull();
    expect(parseLimit('10 000')).toBe(10000);
    expect(parseLimit('2500,4')).toBe(2500);
    expect(parseLimit('-5')).toBe('invalid');
    expect(parseLimit('abc')).toBe('invalid');
  });

  it('the month is the Europe/Oslo calendar month', () => {
    // 31 October 23:30 UTC is already 1 November in Oslo.
    expect(osloMonthLabel(new Date('2026-10-31T23:30:00Z'))).toBe(osloMonthLabel(new Date('2026-11-15T12:00:00Z')));
    expect(osloMonthLabel(new Date('2026-10-31T22:30:00Z'))).not.toBe(osloMonthLabel(new Date('2026-11-15T12:00:00Z')));
  });
});
