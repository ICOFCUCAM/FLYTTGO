import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {}, callFunction: vi.fn() }));
const { assignableRoles, canBookFor, canEditCompany, canInvite, canManage, suggestSlug } = await import('../lib/organizations');

describe('company roles in the browser match the database rules', () => {
  it('owners manage everyone; admins only bookers, finance, viewers and staff', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'booker', 'finance', 'viewer', 'staff']);
    expect(assignableRoles('admin')).toEqual(['booker', 'finance', 'viewer', 'staff']);
    expect(canManage('admin', 'admin')).toBe(false);
    expect(canManage('admin', 'owner')).toBe(false);
    expect(canManage('admin', 'viewer')).toBe(true);
    for (const r of ['booker', 'finance', 'viewer'] as const) expect(assignableRoles(r)).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });

  it('only owners and admins of a pending or active company invite', () => {
    expect(canInvite('owner', 'pending')).toBe(true);
    expect(canInvite('admin', 'active')).toBe(true);
    expect(canInvite('owner', 'suspended')).toBe(false);
    expect(canInvite('booker', 'active')).toBe(false);
    expect(canEditCompany('finance')).toBe(false);
  });

  it('only owners, admins and bookers of an active company book for it', () => {
    const m = (role: any, status: any) => ({ role, organization: { status } as any });
    expect(canBookFor(m('booker', 'active'))).toBe(true);
    expect(canBookFor(m('owner', 'active'))).toBe(true);
    expect(canBookFor(m('finance', 'active'))).toBe(false);
    expect(canBookFor(m('viewer', 'active'))).toBe(false);
    expect(canBookFor(m('owner', 'pending'))).toBe(false);
    expect(canBookFor(m('admin', 'suspended'))).toBe(false);
  });

  it('suggests slugs the database accepts', () => {
    expect(suggestSlug('Bærum Flytt AS')).toBe('baerum-flytt');
    expect(suggestSlug('  Acme Logistikk, Oslo! ')).toBe('acme-logistikk-oslo');
    expect(suggestSlug('Ålesund Øst ASA')).toBe('alesund-ost');
    expect(suggestSlug('x'.repeat(80))).toHaveLength(63);
  });
});
