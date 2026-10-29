// ============================================================================
// FlyttGo — company check against Brønnøysundregistrene (Enhetsregisteret)
// ============================================================================
//
// Open API, no key: GET https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}
//   200 the entity · 404 no such number · 410 deleted from the register
//
// A company passes when it exists, is not bankrupt, not being wound up
// (voluntarily or by force), and its registered name matches the name
// given at sign-up. What was seen is kept as evidence with the result
// (organization_verifications.findings), so an administrator can see
// why a check failed and record a manual check instead.
//
// No Deno or network imports: fetch is passed in, so the Vitest suite
// (src/test/brreg.test.ts) runs this against a fake register.
// ============================================================================

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const BRREG_BASE = 'https://data.brreg.no/enhetsregisteret/api/enheter';

export interface BrregCheck {
  kind:     'checked';
  passed:   boolean;
  findings: {
    orgNumber:        string;
    found:            boolean;
    deleted?:         boolean;
    registeredName?:  string | null;
    nameMatches?:     boolean;
    bankrupt?:        boolean;
    beingWoundUp?:    boolean;
    forcedDissolution?: boolean;
    vatRegistered?:   boolean;
    organisationForm?: string | null;
    reasons:          string[];
    checkedAt:        string;
  };
}

/** Company names compared without case, punctuation or the legal form. */
export function normaliseCompanyName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'a')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(asa|as|ans|da|enk|sa|ba|nuf|ks)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function checkBrreg(
  fetchFn: Fetch, orgNumber: string, givenName: string, now: Date = new Date(),
): Promise<BrregCheck | { kind: 'retry'; error: string } | { kind: 'failed'; error: string }> {
  if (!/^\d{9}$/.test(orgNumber)) return { kind: 'failed', error: 'organisation number must be 9 digits' };
  let res;
  try {
    res = await fetchFn(`${BRREG_BASE}/${orgNumber}`, { method: 'GET', headers: { Accept: 'application/json' } });
  } catch (err) {
    return { kind: 'retry', error: `brreg unreachable: ${(err as Error).message}` };
  }
  const checkedAt = now.toISOString();
  if (res.status === 404) {
    return { kind: 'checked', passed: false, findings: { orgNumber, found: false, reasons: ['not in Enhetsregisteret'], checkedAt } };
  }
  if (res.status === 410) {
    return { kind: 'checked', passed: false, findings: { orgNumber, found: false, deleted: true, reasons: ['deleted from Enhetsregisteret'], checkedAt } };
  }
  if (res.status >= 500 || res.status === 429) return { kind: 'retry', error: `brreg ${res.status}` };
  if (!res.ok) return { kind: 'failed', error: `brreg ${res.status}` };

  let e: any;
  try { e = JSON.parse(await res.text()); } catch { return { kind: 'retry', error: 'brreg answered with invalid JSON' }; }

  const registeredName = typeof e?.navn === 'string' ? e.navn : null;
  const a = normaliseCompanyName(registeredName);
  const b = normaliseCompanyName(givenName);
  const nameMatches = !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const bankrupt          = e?.konkurs === true;
  const beingWoundUp      = e?.underAvvikling === true;
  const forcedDissolution = e?.underTvangsavviklingEllerTvangsopplosning === true;
  const deleted           = !!e?.slettedato;

  const reasons: string[] = [];
  if (!nameMatches)      reasons.push(`registered name "${registeredName ?? ''}" does not match "${givenName}"`);
  if (bankrupt)          reasons.push('bankrupt (konkurs)');
  if (beingWoundUp)      reasons.push('being wound up (under avvikling)');
  if (forcedDissolution) reasons.push('under forced dissolution');
  if (deleted)           reasons.push(`deleted ${e.slettedato}`);

  return {
    kind: 'checked',
    passed: reasons.length === 0,
    findings: {
      orgNumber, found: true, deleted, registeredName, nameMatches, bankrupt, beingWoundUp, forcedDissolution,
      vatRegistered: e?.registrertIMvaregisteret === true,
      organisationForm: e?.organisasjonsform?.kode ?? null,
      reasons, checkedAt,
    },
  };
}
