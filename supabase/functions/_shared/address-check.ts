// ============================================================================
// FlyttGo — the server's own check of a booking's coordinates
// ============================================================================
//
// The browser stores pickup and drop-off coordinates with the address text,
// and the payment functions route between those coordinates. Before this
// check a modified browser could send Oslo→Bergen addresses with two Oslo
// points, pay a local price and send a driver 460 km. Now chargeForBooking()
// looks both addresses up in Kartverket's address register (the same service
// the address field uses) and compares:
//
//   * the point is near the address (or its postcode)  → confirmed
//   * the point is far from it                         → corrected: the
//     booking is priced, and stored, at the register's point
//   * the address cannot be found (service down, unusual text) → unconfirmed:
//     the stored point is used, and the booking records it for the office
//
// A lookup that fails never blocks a payment: a booking priced on an
// unconfirmed point is worth more than no booking, as long as it is recorded
// (bookings.location_check, migration 00028). Never throws.
//
// No Deno or network imports at module level, so Vitest can run it.
// ============================================================================

import { straightLineKm } from './pricing.ts';

export type LocationStatus = 'confirmed' | 'corrected' | 'unconfirmed';
export interface FoundPoint { lat: number; lng: number; precision: 'address' | 'postcode' }
export interface LocationCheck {
  coords: [number, number, number, number];
  pickup: LocationStatus;
  dropoff: LocationStatus;
  corrected: boolean;
  /** What is written to bookings.location_check. */
  record: Record<string, unknown>;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>;
}>;

/** How far a stored point may be from the register's point before it is replaced, by how precise the lookup was. */
export const TOLERANCE_KM = { address: 1.5, postcode: 30 } as const;   // a postcode can cover a wide rural area

const API = 'https://ws.geonorge.no/adresser/v1/sok';

function pointOf(hit: any): { lat: number; lng: number; postcode: string | null } | null {
  const p = hit?.representasjonspunkt;
  const lat = Number(p?.lat), lng = Number(p?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, postcode: hit?.postnummer ? String(hit.postnummer) : null } : null;
}

/** A Norwegian postcode in an address line ("Storgata 1, 0155 Oslo" → "0155"), or null. */
export function postcodeOf(address: string): string | null {
  const m = /(?:^|[\s,])(\d{4})(?=\s|,|$)/.exec(address);
  return m ? m[1] : null;
}

async function lookup(url: string, fetchFn: FetchLike): Promise<{ lat: number; lng: number; postcode: string | null } | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'FlyttGo/1.0 (+https://flyttgo.no)' }, signal: ctrl?.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return pointOf(data?.adresser?.[0]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The register's point for an address: the address itself, else (retrying on
 * the postcode, which resolves far more reliably) a point in its postcode.
 * Null when neither is found. Never throws.
 */
export async function geocodeNorway(address: string | null | undefined, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<FoundPoint | null> {
  const text = (address ?? '').trim();
  if (!text) return null;
  const postcode = postcodeOf(text);
  const full = await lookup(`${API}?sok=${encodeURIComponent(text.replace(/,/g, ' '))}&treffPerSide=1&utkoordsys=4258`, fetchFn);
  /* A free-text hit counts only in the address's own postcode: a similar street elsewhere is not this address. */
  if (full && (!postcode || full.postcode === postcode)) return { lat: full.lat, lng: full.lng, precision: 'address' };
  if (!postcode) return null;
  const area = await lookup(`${API}?postnummer=${postcode}&treffPerSide=1&utkoordsys=4258`, fetchFn);
  return area ? { lat: area.lat, lng: area.lng, precision: 'postcode' } : null;
}

/** Compare one stored point with the register's point for its address. */
export function judgePoint(stored: { lat: number; lng: number }, found: FoundPoint | null):
  { status: LocationStatus; point: { lat: number; lng: number }; offKm: number | null } {
  if (!found) return { status: 'unconfirmed', point: stored, offKm: null };
  const offKm = Math.round(straightLineKm(stored.lat, stored.lng, found.lat, found.lng) * 10) / 10;
  return offKm > TOLERANCE_KM[found.precision]
    ? { status: 'corrected', point: { lat: found.lat, lng: found.lng }, offKm }
    : { status: 'confirmed', point: stored, offKm };
}

/** Check both of a booking's points against its addresses. Never throws. */
export async function checkBookingLocations(
  b: { pickup_address?: string | null; dropoff_address?: string | null },
  coords: [number, number, number, number],
  fetchFn?: FetchLike,
  now: Date = new Date(),
): Promise<LocationCheck> {
  const [plat, plng, dlat, dlng] = coords;
  const [pf, df] = await Promise.all([geocodeNorway(b.pickup_address, fetchFn), geocodeNorway(b.dropoff_address, fetchFn)]);
  const p = judgePoint({ lat: plat, lng: plng }, pf);
  const d = judgePoint({ lat: dlat, lng: dlng }, df);
  const side = (j: ReturnType<typeof judgePoint>, f: FoundPoint | null, lat: number, lng: number) => ({
    status: j.status, precision: f?.precision ?? null, off_km: j.offKm,
    ...(j.status === 'corrected' ? { submitted: [lat, lng] } : {}),
  });
  return {
    coords: [p.point.lat, p.point.lng, d.point.lat, d.point.lng],
    pickup: p.status, dropoff: d.status,
    corrected: p.status === 'corrected' || d.status === 'corrected',
    record: { checked_at: now.toISOString(), source: 'kartverket', pickup: side(p, pf, plat, plng), dropoff: side(d, df, dlat, dlng) },
  };
}
