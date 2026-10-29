import { describe, expect, it } from 'vitest';
import { sellerNotice, sellerSplit } from '../../supabase/functions/_shared/white-label.ts';

const OWN_SELLER = { platform_fee_pct: 4, platform_fee_min: 49 };

describe('sellerSplit (Model B)', () => {
  it('matches the database test: 1250 NOK move, 10% markup, minimum fee', () => {
    const s = sellerSplit(1250, { ...OWN_SELLER, markup_pct: 10 });
    expect(s).toEqual({ customerPrice: 1375, platformFee: 61.25, flyttgoPrice: 1250, applicationFeeOre: 131125 });
  });

  it('uses the percentage above the minimum', () => {
    const s = sellerSplit(12500, { ...OWN_SELLER, markup_pct: 15 });
    expect(s.platformFee).toBe(500);                       // 4% of 10 000 ex. MVA = 400, + MVA
    expect(s.customerPrice).toBe(14375);
    expect(s.applicationFeeOre).toBe(1300000);
  });

  it('never lets the company sell below what FlyttGo takes', () => {
    const s = sellerSplit(1000, { ...OWN_SELLER, markup_pct: 0 });
    expect(s.customerPrice).toBe(1062);                    // 1000 + 61.25, rounded up
    expect(s.customerPrice * 100).toBeGreaterThanOrEqual(s.applicationFeeOre);
  });

  it('caps the markup at 100% and ignores nonsense', () => {
    expect(sellerSplit(1000, { ...OWN_SELLER, markup_pct: 500 }).customerPrice).toBe(2000);
    expect(sellerSplit(1000, { platform_fee_pct: 'x', platform_fee_min: null, markup_pct: undefined }).customerPrice).toBe(1000);
  });
});

describe('sellerNotice', () => {
  it('names the seller for each model', () => {
    expect(sellerNotice({ seller_model: 'flyttgo', display_name: 'Acme Flytt', seller: { name: 'FlyttGo AS', org_number: '923609016' } }))
      .toBe('Moves booked here are sold and carried out by FlyttGo AS (org. nr. 923609016), for Acme Flytt.');
    expect(sellerNotice({ seller_model: 'company', display_name: 'Acme Flytt', seller: { name: 'Acme AS', org_number: '987654321' } }))
      .toBe('Acme AS (org. nr. 987654321) sells the moves booked here. FlyttGo AS carries them out as its subcontractor.');
  });
});
