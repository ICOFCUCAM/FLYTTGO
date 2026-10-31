// ============================================================================
// FlyttGo — plate lookup in the Norwegian vehicle register (Statens vegvesen)
// ============================================================================
//
// Owner's decision, 31 October 2026: the driver application fills make, model and year from the
// number plate. Statens vegvesen's "tekniske kjøretøyopplysninger" API needs an API key ordered
// through Altinn by FlyttGo AS (service "Kjøretøyoppslag"); until SVV_API_KEY is set the lookup is
// off and the form does not offer it. The address and the header are settings (SVV_API_URL,
// SVV_AUTH_HEADER) because the agreement Vegvesen issues with the key states them; the defaults
// below are the published single-lookup endpoint and header and must be checked against that
// agreement before the key is set (docs/VEHICLE_REGISTER.md).
//
// Only technical data is read (make, trade name, first registration). The register's answer is
// never stored; what is filled in stays editable and the driver's typed values are what is sent.
//
// No Deno or network imports: fetch is passed in, so the Vitest suite runs this against a fake.
// ============================================================================

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const SVV_DEFAULT_URL = 'https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata';
export const SVV_DEFAULT_HEADER = 'SVV-Authorization';

export interface VehicleFacts { plate: string; make: string | null; model: string | null; year: number | null }
export type LookupResult =
  | { kind: 'found'; vehicle: VehicleFacts }
  | { kind: 'not_found' }
  | { kind: 'invalid' }
  | { kind: 'unavailable'; status?: number };

/** A Norwegian plate as the register spells it: letters and digits only, upper case (e.g. "AB12345"). */
export function normalisePlate(input: string): string | null {
  const p = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-ZÆØÅ0-9]{2,8}$/.test(p) ? p : null;
}

/* deno-lint-ignore no-explicit-any */
type Any = any;
const first = (v: Any): Any => (Array.isArray(v) ? v[0] : v);
const str = (v: Any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Make, model and year from the register's answer; null fields where it does not say. */
export function parseVehicle(plate: string, body: Any): VehicleFacts | null {
  const k = first(body?.kjoretoydataListe);
  if (!k) return null;
  const generelt = k?.godkjenning?.tekniskGodkjenning?.tekniskeData?.generelt;
  const make = str(first(generelt?.merke)?.merke) ?? str(first(generelt?.merke));
  const model = str(first(generelt?.handelsbetegnelse));
  const date = str(k?.forstegangsregistrering?.registrertForstegangNorgeDato)
    ?? str(k?.godkjenning?.forstegangsGodkjenning?.forstegangRegistrertDato);
  const year = date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
  return { plate, make, model, year };
}

export async function lookupPlate(input: string, opts: { key: string; url?: string; header?: string; fetch: Fetch }): Promise<LookupResult> {
  const plate = normalisePlate(input);
  if (!plate) return { kind: 'invalid' };
  const url = `${opts.url || SVV_DEFAULT_URL}?kjennemerke=${encodeURIComponent(plate)}`;
  let res;
  try {
    res = await opts.fetch(url, { headers: { [opts.header || SVV_DEFAULT_HEADER]: `Apikey ${opts.key}`, Accept: 'application/json' } });
  } catch {
    return { kind: 'unavailable' };
  }
  if (res.status === 404 || res.status === 204) return { kind: 'not_found' };
  if (!res.ok) return { kind: 'unavailable', status: res.status };
  try {
    const v = parseVehicle(plate, JSON.parse(await res.text()));
    return v ? { kind: 'found', vehicle: v } : { kind: 'not_found' };
  } catch {
    return { kind: 'unavailable', status: res.status };
  }
}
