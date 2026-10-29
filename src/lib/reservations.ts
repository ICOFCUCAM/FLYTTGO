/**
 * Reservations (migration 00019, docs/SERVICE_PLATFORM.md): restaurant
 * tables and hotel rooms, beside Jobs and Appointments (lib/services.ts).
 * Reads go through row-level security and changes through the database
 * functions, which decide every permission and every free table or room;
 * the helpers at the end only show the same rules before the database
 * applies them.
 */
import { supabase } from './supabase';

const err = (e: { message: string } | null) => e?.message ?? null;
const rpc = async (fn: string, args: Record<string, unknown>) => err((await supabase.rpc(fn, args)).error);

export interface Contact { name: string; phone: string; email?: string }

/* ── Restaurant ────────────────────────────────────────────────────── */
export interface RestaurantSettings {
  slot_step_minutes: number; booking_window_days: number; lead_time_minutes: number; max_party_online: number;
  default_turn_minutes: number; cancel_hours: number; no_show_fee: number | null; no_show_fee_per: 'guest' | 'booking';
  no_show_vat_rate: number | null;
}
export interface RestaurantTable { id: string; organization_id: string; name: string; area: string | null; seats: number; min_seats: number;
  combinable: boolean; active: boolean; sort: number }
export interface TableGroup { id: string; organization_id: string; name: string; min_seats: number; active: boolean; sort: number;
  restaurant_table_group_members: { table_id: string }[] }
export interface ServicePeriod { weekday: number; name: string; start_time: string; end_time: string; last_seating: string | null }
export interface TurnTime { up_to_party: number; minutes: number }
export interface ClosedDate { id: string; day: string; reason: string | null }
export type TableStatus = 'booked' | 'seated' | 'completed' | 'no_show' | 'cancelled';
export interface TableReservation {
  id: string; organization_id: string; number: number; customer_user_id: string | null;
  customer: { name: string; phone: string | null; email: string | null }; party_size: number; starts_at: string; ends_at: string;
  period: string | null; notes: string | null; source: 'online' | 'phone' | 'walk_in'; status: TableStatus;
  no_show_fee: number | null; invoice_id: string | null; cancel_reason: string | null;
  restaurant_reservation_tables?: { table_id: string }[];
}
export interface FreeTime { starts_at: string; ends_at: string; period: string | null }

export const TABLE_STATUS: Record<TableStatus, string> = {
  booked: 'Booked', seated: 'Seated', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled',
};
export const DEFAULT_RESTAURANT_SETTINGS: RestaurantSettings = {
  slot_step_minutes: 15, booking_window_days: 60, lead_time_minutes: 60, max_party_online: 8, default_turn_minutes: 120,
  cancel_hours: 2, no_show_fee: null, no_show_fee_per: 'guest', no_show_vat_rate: null,
};

export async function loadRestaurantSetup(orgId: string) {
  const [{ data: settings }, { data: tables }, { data: groups }, { data: periods }, { data: turns }, { data: closed }] = await Promise.all([
    supabase.from('restaurant_settings').select('*').eq('organization_id', orgId).maybeSingle(),
    supabase.from('restaurant_tables').select('*').eq('organization_id', orgId).order('sort'),
    supabase.from('restaurant_table_groups').select('*, restaurant_table_group_members(table_id)').eq('organization_id', orgId).order('sort'),
    supabase.from('restaurant_service_periods').select('*').eq('organization_id', orgId).order('weekday').order('start_time'),
    supabase.from('restaurant_turn_times').select('*').eq('organization_id', orgId).order('up_to_party'),
    supabase.from('restaurant_closed_dates').select('*').eq('organization_id', orgId).order('day'),
  ]);
  return {
    settings: (settings ?? null) as RestaurantSettings | null, tables: (tables ?? []) as RestaurantTable[],
    groups: (groups ?? []) as TableGroup[], periods: (periods ?? []) as ServicePeriod[],
    turns: (turns ?? []) as TurnTime[], closed: (closed ?? []) as ClosedDate[],
  };
}
/** The public rules and periods, for the booking page. */
export async function loadRestaurantPublic(orgId: string) {
  const [{ data: settings }, { data: periods }] = await Promise.all([
    supabase.from('restaurant_settings').select('*').eq('organization_id', orgId).maybeSingle(),
    supabase.from('restaurant_service_periods').select('*').eq('organization_id', orgId).order('weekday').order('start_time'),
  ]);
  return { settings: (settings ?? null) as RestaurantSettings | null, periods: (periods ?? []) as ServicePeriod[] };
}
export const saveRestaurantSettings = (orgId: string, s: Partial<RestaurantSettings> & { turn_times?: TurnTime[] }) =>
  rpc('save_restaurant_settings', { p_org: orgId, p: s });
export const saveRestaurantTable = (orgId: string, id: string | null, t: Partial<RestaurantTable>) =>
  rpc('save_restaurant_table', { p_org: orgId, p_id: id, p: t });
export const saveTableGroup = (orgId: string, id: string | null, g: { name: string; min_seats: number; active: boolean; table_ids: string[] }) =>
  rpc('save_restaurant_table_group', { p_org: orgId, p_id: id, p: g });
export const saveRestaurantPeriods = (orgId: string, periods: { weekday: number; name: string; start: string; end: string; last_seating: string | null }[]) =>
  rpc('save_restaurant_periods', { p_org: orgId, p_periods: periods });
export const addClosedDate = (orgId: string, day: string, reason: string) => rpc('add_restaurant_closed_date', { p_org: orgId, p_day: day, p_reason: reason });
export const removeClosedDate = (id: string) => rpc('remove_restaurant_closed_date', { p_id: id });

export async function freeTableTimes(orgId: string, day: string, party: number): Promise<FreeTime[]> {
  const { data } = await supabase.rpc('available_restaurant_times', { p_org: orgId, p_day: day, p_party: party });
  return (data ?? []) as FreeTime[];
}
export async function bookTable(orgId: string, start: string, party: number, contact: Contact, notes: string) {
  const { data, error } = await supabase.rpc('book_restaurant_table', { p_org: orgId, p_start: start, p_party: party, p_contact: contact, p_notes: notes });
  return { reservation: data as TableReservation | null, error: err(error) };
}
/** The company books a phone guest (a time) or seats a walk-in (now). */
export const createTableReservation = (orgId: string, start: string | null, party: number, contact: Partial<Contact>, notes: string,
                                       source: 'phone' | 'walk_in', tables: string[] | null) =>
  rpc('create_restaurant_reservation', { p_org: orgId, p_start: start, p_party: party, p_contact: contact, p_notes: notes,
                                         p_source: source, p_tables: tables && tables.length ? tables : null });
export async function loadTableReservations(filter: { orgId?: string; customer?: string; from?: string; to?: string }): Promise<TableReservation[]> {
  let q = supabase.from('restaurant_reservations').select('*, restaurant_reservation_tables(table_id)').order('starts_at').limit(500);
  if (filter.orgId) q = q.eq('organization_id', filter.orgId);
  if (filter.customer) q = q.eq('customer_user_id', filter.customer);
  if (filter.from) q = q.gte('starts_at', filter.from);
  if (filter.to) q = q.lt('starts_at', filter.to);
  const { data } = await q;
  return (data ?? []) as TableReservation[];
}
export const seatReservation = (id: string, tables: string[] | null) =>
  rpc('seat_restaurant_reservation', { p_id: id, p_tables: tables && tables.length ? tables : null });
export const closeReservation = (id: string, outcome: 'completed' | 'no_show') => rpc('close_restaurant_reservation', { p_id: id, p_outcome: outcome });
export const cancelReservation = (id: string, reason: string) => rpc('cancel_restaurant_reservation', { p_id: id, p_reason: reason });
export const invoiceNoShow = (id: string) => rpc('invoice_restaurant_no_show', { p_id: id });

/* ── Hotel ─────────────────────────────────────────────────────────── */
export interface HotelSettings {
  vat_rate: number | null; check_in_from: string; check_out_by: string; booking_window_days: number; lead_days: number;
  min_nights: number; max_nights: number; free_cancel_days: number; late_cancel_fee_pct: number | null;
}
export interface RoomType { id: string; organization_id: string; name: string; description: string | null; capacity: number;
  nightly_price: number; active: boolean; sort: number }
export interface Room { id: string; organization_id: string; room_type_id: string; name: string; active: boolean; sort: number }
export interface Closure { id: string; room_id: string | null; from_date: string; to_date: string; reason: string | null }
export type StayStatus = 'booked' | 'checked_in' | 'checked_out' | 'no_show' | 'cancelled';
export interface HotelStay {
  id: string; organization_id: string; number: number; room_type_id: string; room_id: string; customer_user_id: string | null;
  customer: { name: string; phone: string; email: string | null }; guests: number; check_in: string; check_out: string; nights: number;
  nightly_price: number; total: number; vat_rate: number; free_cancel_until: string | null; late_cancel_fee: number | null;
  cancel_fee: number | null; notes: string | null; status: StayStatus; invoice_id: string | null; cancel_reason: string | null;
}
export interface FreeRoomType { room_type_id: string; name: string; description: string | null; capacity: number; nightly_price: number;
  nights: number; total: number; rooms_free: number }

export const STAY_STATUS: Record<StayStatus, string> = {
  booked: 'Booked', checked_in: 'Checked in', checked_out: 'Checked out', no_show: 'No-show', cancelled: 'Cancelled',
};
export const DEFAULT_HOTEL_SETTINGS: HotelSettings = {
  vat_rate: null, check_in_from: '15:00', check_out_by: '11:00', booking_window_days: 365, lead_days: 0, min_nights: 1,
  max_nights: 30, free_cancel_days: 1, late_cancel_fee_pct: null,
};

export async function loadHotelSetup(orgId: string) {
  const [{ data: settings }, { data: types }, { data: rooms }, { data: closures }] = await Promise.all([
    supabase.from('hotel_settings').select('*').eq('organization_id', orgId).maybeSingle(),
    supabase.from('hotel_room_types').select('*').eq('organization_id', orgId).order('sort'),
    supabase.from('hotel_rooms').select('*').eq('organization_id', orgId).order('sort'),
    supabase.from('hotel_closures').select('*').eq('organization_id', orgId).order('from_date'),
  ]);
  return {
    settings: (settings ?? null) as HotelSettings | null, types: (types ?? []) as RoomType[], rooms: (rooms ?? []) as Room[],
    closures: (closures ?? []) as Closure[],
  };
}
export async function loadHotelSettings(orgId: string): Promise<HotelSettings | null> {
  const { data } = await supabase.from('hotel_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return (data ?? null) as HotelSettings | null;
}
export const saveHotelSettings = (orgId: string, s: Partial<HotelSettings>) => rpc('save_hotel_settings', { p_org: orgId, p: s });
export const saveRoomType = (orgId: string, id: string | null, t: Partial<RoomType>) => rpc('save_hotel_room_type', { p_org: orgId, p_id: id, p: t });
export const saveRoom = (orgId: string, id: string | null, r: Partial<Room>) => rpc('save_hotel_room', { p_org: orgId, p_id: id, p: r });
export const addClosure = (orgId: string, roomId: string | null, from: string, to: string, reason: string) =>
  rpc('add_hotel_closure', { p_org: orgId, p_room: roomId, p_from: from, p_to: to, p_reason: reason });
export const removeClosure = (id: string) => rpc('remove_hotel_closure', { p_id: id });

export async function freeRooms(orgId: string, checkIn: string, checkOut: string, guests: number): Promise<FreeRoomType[]> {
  const { data } = await supabase.rpc('available_hotel_rooms', { p_org: orgId, p_check_in: checkIn, p_check_out: checkOut, p_guests: guests });
  return (data ?? []) as FreeRoomType[];
}
export async function bookStay(orgId: string, typeId: string, checkIn: string, checkOut: string, guests: number, contact: Contact, notes: string) {
  const { data, error } = await supabase.rpc('book_hotel_stay', { p_org: orgId, p_room_type: typeId, p_check_in: checkIn, p_check_out: checkOut,
                                                                  p_guests: guests, p_contact: contact, p_notes: notes });
  return { stay: data as HotelStay | null, error: err(error) };
}
export const createStay = (orgId: string, typeId: string, roomId: string | null, checkIn: string, checkOut: string, guests: number,
                           contact: Contact, notes: string) =>
  rpc('create_hotel_stay', { p_org: orgId, p_room_type: typeId, p_room: roomId, p_check_in: checkIn, p_check_out: checkOut,
                             p_guests: guests, p_contact: contact, p_notes: notes });
export async function loadStays(filter: { orgId?: string; customer?: string; from?: string; to?: string }): Promise<HotelStay[]> {
  let q = supabase.from('hotel_stays').select('*').order('check_in').limit(500);
  if (filter.orgId) q = q.eq('organization_id', filter.orgId);
  if (filter.customer) q = q.eq('customer_user_id', filter.customer);
  if (filter.from) q = q.gte('check_out', filter.from);          // stays still running on or after the day
  if (filter.to) q = q.lte('check_in', filter.to);
  const { data } = await q;
  return (data ?? []) as HotelStay[];
}
export const checkInStay = (id: string, roomId: string | null) => rpc('check_in_hotel_stay', { p_id: id, p_room: roomId });
export const checkOutStay = (id: string) => rpc('check_out_hotel_stay', { p_id: id });
export const markStayNoShow = (id: string) => rpc('mark_hotel_no_show', { p_id: id });
export const cancelStay = (id: string, reason: string, chargeFee = false) => rpc('cancel_hotel_stay', { p_id: id, p_reason: reason, p_charge_fee: chargeFee });
export const invoiceStay = (id: string) => rpc('invoice_hotel_stay', { p_id: id });

/* ── The same rules as the database, shown before it applies them ──── */
/** Nights between two dates (YYYY-MM-DD): the number of nights stayed. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`), b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The no-show fee a booking made now would carry (incl. MVA), or null. */
export function noShowFeeFor(s: Pick<RestaurantSettings, 'no_show_fee' | 'no_show_fee_per'> | null, party: number): number | null {
  if (!s || s.no_show_fee == null || Number(s.no_show_fee) <= 0) return null;
  return Number(s.no_show_fee) * (s.no_show_fee_per === 'guest' ? party : 1);
}

/** The hotel's cancellation rule for a stay booked now: the last free day
 * and the fee after it (incl. MVA), as the database copies them. */
export function stayCancellationRule(s: Pick<HotelSettings, 'free_cancel_days' | 'late_cancel_fee_pct'> | null, checkIn: string, total: number):
  { freeUntil: string | null; fee: number | null } {
  if (!s || s.late_cancel_fee_pct == null) return { freeUntil: null, fee: null };
  const d = new Date(`${checkIn}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - s.free_cancel_days);
  return { freeUntil: d.toISOString().slice(0, 10), fee: Math.round(total * Number(s.late_cancel_fee_pct)) / 100 };
}

/** What cancelling a stay online today would cost the guest: allowed until
 * the day before arrival; free until the last free day. */
export function stayCancellation(stay: Pick<HotelStay, 'status' | 'check_in' | 'free_cancel_until' | 'late_cancel_fee'>, today: string):
  { online: boolean; fee: number | null } {
  const online = stay.status === 'booked' && today < stay.check_in;
  const late = stay.free_cancel_until != null && today > stay.free_cancel_until;
  return { online, fee: online && late ? stay.late_cancel_fee : null };
}

/** Free times grouped by service period, in the order they come. */
export function timesByPeriod(times: FreeTime[]): { period: string; times: FreeTime[] }[] {
  const out: { period: string; times: FreeTime[] }[] = [];
  for (const t of times) {
    const p = t.period ?? '';
    const last = out[out.length - 1];
    if (last && last.period === p) last.times.push(t); else out.push({ period: p, times: [t] });
  }
  return out;
}
