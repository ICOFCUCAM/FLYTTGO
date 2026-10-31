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

/* Second pass, 31 October 2026: the sample screens, the agreement summary, the plate lookup and the PDF. */
import { readFileSync } from 'node:fs';
import { calcCommission } from '../components/driver/PortalCards';
import { DRIVER_TERMS, TERMS_SUMMARY } from '../lib/driverTerms';
import { lookupPlate, normalisePlate, parseVehicle } from '../../supabase/functions/_shared/vehicle-register';
import { buildPdf, pdfString } from '../lib/simplePdf';
import { en } from '../lib/locales/en';
import { no } from '../lib/locales/no';

describe('sample job on the landing page', () => {
  it('the driver app shows the same pay as the plan picker for the sample job (Pro Mini, 2,500 NOK)', () => {
    expect(calcCommission(2500, 'pro_mini').earning).toBe(calculateCommission(2500, 'pro_mini').earning);
  });
});

describe('Driver Agreement summary', () => {
  const page = readFileSync('src/pages/DriverTermsPage.tsx', 'utf8');
  it('states the figures the agreement states', () => {
    expect(page).toContain('NOK 500,000 per consignment');
    expect(DRIVER_TERMS.goodsInTransitMinNok).toBe(500_000);
    expect(page).toContain('NOK 5,000,000 per incident');
    expect(DRIVER_TERMS.publicLiabilityMinNok).toBe(5_000_000);
    expect(page).toMatch(new RegExp(`within ${DRIVER_TERMS.commissionDisputeDays} days of payment`));
  });
  it('points to sections that exist, and every point has text in both languages', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    for (const { key, section } of TERMS_SUMMARY) {
      expect(page).toMatch(new RegExp(`>${section}\\. `));
      for (const l of [en, no] as any[]) {
        expect(l.driverLanding.terms[key]).toBeTruthy();
        expect(l.driverLanding.terms[`${key}Desc`]).toBeTruthy();
      }
    }
  });
  it('the new sections and the lookup have text in both languages', () => {
    for (const l of [en, no] as any[]) {
      for (const k of ['accept', 'drive', 'work', 'confirm', 'paid']) expect(l.driverLanding.day[`${k}Desc`]).toBeTruthy();
      for (const k of ['register', 'team', 'drivers', 'grow']) expect(l.driverLanding.fleet[`${k}Desc`]).toBeTruthy();
      for (const k of ['button', 'hint', 'filled', 'notFound', 'signIn', 'failed']) expect(l.driverApplication.lookup[k]).toBeTruthy();
      expect(l.driverLanding.nav.day && l.driverLanding.nav.terms).toBeTruthy();
    }
  });
});

describe('vehicle register lookup', () => {
  const answer = { kjoretoydataListe: [{
    forstegangsregistrering: { registrertForstegangNorgeDato: '2019-04-12' },
    godkjenning: { tekniskGodkjenning: { tekniskeData: { generelt: { merke: [{ merke: 'VOLKSWAGEN' }], handelsbetegnelse: ['CRAFTER'] } } } },
  }] };
  const fake = (status: number, body: unknown) => async () => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  it('reads make, model and year', () => {
    expect(parseVehicle('AB12345', answer)).toEqual({ plate: 'AB12345', make: 'VOLKSWAGEN', model: 'CRAFTER', year: 2019 });
    expect(parseVehicle('AB12345', { kjoretoydataListe: [] })).toBeNull();
  });
  it('normalises plates and refuses what is not one', () => {
    expect(normalisePlate('ab 12-345')).toBe('AB12345');
    expect(normalisePlate('x')).toBeNull();
    expect(normalisePlate('AB12345; DROP')).toBeNull();
  });
  it('sends the key in the header and maps the answers', async () => {
    let seen: { url: string; headers?: Record<string, string> } | null = null;
    const r = await lookupPlate('ab 12345', { key: 'k', fetch: async (url, init) => { seen = { url, headers: init?.headers }; return fake(200, answer)(); } });
    expect(r).toMatchObject({ kind: 'found', vehicle: { model: 'CRAFTER' } });
    expect(seen!.url).toMatch(/kjennemerke=AB12345$/);
    expect(seen!.headers!['SVV-Authorization']).toBe('Apikey k');
    expect(await lookupPlate('AB12345', { key: 'k', fetch: fake(404, {}) })).toEqual({ kind: 'not_found' });
    expect(await lookupPlate('AB12345', { key: 'k', fetch: fake(403, {}) })).toEqual({ kind: 'unavailable', status: 403 });
    expect(await lookupPlate('?', { key: 'k', fetch: fake(200, answer) })).toEqual({ kind: 'invalid' });
  });
});

describe('price estimate PDF', () => {
  it('escapes and encodes Norwegian letters', () => {
    expect(pdfString('Første (år)')).toBe('(F\\370rste \\(\\345r\\))');
    expect(pdfString('1–2')).toBe('(1\\2262)');
  });
  it('is a well-formed one-page PDF with a correct cross-reference table', () => {
    const bytes = buildPdf([{ text: 'FlyttGo prisoverslag', size: 20, bold: true }, { text: 'Første år', right: '12 345 NOK' }]);
    const s = Array.from(bytes, b => String.fromCharCode(b)).join('');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
    offs.forEach((o, i) => expect(s.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    const len = Number(/\/Length (\d+)/.exec(s)![1]);
    const start = s.indexOf('stream\n') + 7;
    expect(s.slice(start + len, start + len + 10)).toBe('\nendstream');
  });
});
