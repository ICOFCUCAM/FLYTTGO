import { describe, expect, it } from 'vitest';
import { BLURRY_BELOW, DARK_BELOW, judge, measure } from '../components/driver/imageQuality';
import { SUBSCRIPTION_PLANS, calculateCommission } from '../lib/constants';
import { computeCommission } from '../../supabase/functions/_shared/pricing';

/* /become-a-driver, 31 October 2026: the photo check warns on dark or blurry photos; the plan picker's
 * "what you keep" uses the same commission rule the payout does. */
describe('document photo check', () => {
  const grid = (w: number, h: number, f: (x: number, y: number) => number) => {
    const a: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.push(f(x, y));
    return a;
  };
  it('a dark, flat photo is dark and blurry; a bright, detailed one is neither', () => {
    const dark = measure(grid(40, 40, () => 20), 40, 40);
    expect(judge(dark)).toEqual({ dark: true, blurry: true });
    const sharp = measure(grid(40, 40, (x, y) => ((x + y) % 2 ? 230 : 40)), 40, 40);
    expect(sharp.brightness).toBeGreaterThan(DARK_BELOW);
    expect(sharp.sharpness).toBeGreaterThan(BLURRY_BELOW);
    expect(judge(sharp)).toEqual({ dark: false, blurry: false });
  });
  it('a bright but smooth (out of focus) photo is blurry only', () => {
    const smooth = measure(grid(40, 40, x => 150 + x), 40, 40);
    expect(judge(smooth)).toEqual({ dark: false, blurry: true });
  });
});

describe('plan picker figures', () => {
  it('matches the payout rule for every paid plan and price band', () => {
    for (const plan of ['basic', 'pro_mini', 'pro', 'unlimited']) {
      for (const price of [300, 500, 900, 2500, 7000]) {
        expect(Math.round(calculateCommission(price, plan).commission)).toBe(computeCommission(price, plan).commission);
      }
    }
    expect(SUBSCRIPTION_PLANS[0].id).toBe('free');
  });
});
