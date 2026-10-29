import { describe, expect, it } from 'vitest';
import { checkBrreg, normaliseCompanyName } from '../../supabase/functions/_shared/brreg.ts';

const reply = (status: number, body: unknown = {}) => async () =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

const entity = (over: Record<string, unknown> = {}) => ({
  organisasjonsnummer: '923609016', navn: 'ACME LOGISTIKK AS', organisasjonsform: { kode: 'AS' },
  konkurs: false, underAvvikling: false, underTvangsavviklingEllerTvangsopplosning: false,
  registrertIMvaregisteret: true, ...over,
});

describe('company names', () => {
  it('compare without case, punctuation or legal form', () => {
    expect(normaliseCompanyName('ACME Logistikk AS')).toBe('acme logistikk');
    expect(normaliseCompanyName('Acme logistikk, a.s.')).toBe('acme logistikk a s');
    expect(normaliseCompanyName('Bærum Flytt ASA')).toBe('baerum flytt');
  });
});

describe('Brønnøysund check', () => {
  it('passes an active company whose name matches, and records VAT registration', async () => {
    let asked = '';
    const out = await checkBrreg(async (url) => { asked = url; return reply(200, entity())(); }, '923609016', 'Acme Logistikk AS');
    expect(asked).toBe('https://data.brreg.no/enhetsregisteret/api/enheter/923609016');
    expect(out).toMatchObject({ kind: 'checked', passed: true, findings: { vatRegistered: true, nameMatches: true } });
  });

  it('fails a bankrupt company, one being wound up, and a name that does not match', async () => {
    for (const [over, name, why] of [
      [{ konkurs: true }, 'Acme Logistikk AS', /bankrupt/],
      [{ underAvvikling: true }, 'Acme Logistikk AS', /wound up/],
      [{ underTvangsavviklingEllerTvangsopplosning: true }, 'Acme Logistikk AS', /forced/],
      [{}, 'Totally Different AS', /does not match/],
    ] as const) {
      const out = await checkBrreg(reply(200, entity(over)), '923609016', name);
      expect(out.kind).toBe('checked');
      if (out.kind === 'checked') {
        expect(out.passed).toBe(false);
        expect(out.findings.reasons.join(' ')).toMatch(why);
      }
    }
  });

  it('fails unknown and deleted numbers; retries outages', async () => {
    expect(await checkBrreg(reply(404), '923609016', 'x')).toMatchObject({ kind: 'checked', passed: false, findings: { found: false } });
    expect(await checkBrreg(reply(410), '923609016', 'x')).toMatchObject({ kind: 'checked', passed: false, findings: { deleted: true } });
    expect((await checkBrreg(reply(503), '923609016', 'x')).kind).toBe('retry');
    expect((await checkBrreg(async () => { throw new Error('timeout'); }, '923609016', 'x')).kind).toBe('retry');
    expect((await checkBrreg(reply(200), '12345', 'x')).kind).toBe('failed');
  });
});
