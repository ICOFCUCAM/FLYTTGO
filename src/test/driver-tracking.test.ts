import { describe, expect, it, vi } from 'vitest';
import { followBookingDriver, hasActiveJob, locationRow, type TrackingClient } from '../lib/driverTracking';

describe('beacon', () => {
  it('starts only for the driver\'s own in-flight jobs, matched on the profile id', () => {
    const jobs = [{ driver_id: 'profile-1', status: 'in_transit' }];
    expect(hasActiveJob(jobs, 'profile-1')).toBe(true);
    expect(hasActiveJob(jobs, 'user-1')).toBe(false);          // the old bug: the user id never matched
    expect(hasActiveJob([{ driver_id: 'profile-1', status: 'completed' }], 'profile-1')).toBe(false);
    expect(hasActiveJob([{ driver_id: null, status: 'pending' }], 'profile-1')).toBe(false);
    expect(hasActiveJob(jobs, null)).toBe(false);
  });

  it('writes the location under the driver\'s user id', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(locationRow('user-1', { coords: { latitude: 59.9, longitude: 10.7, heading: null, speed: 3 } }, now)).toEqual({
      driver_id: 'user-1', lat: 59.9, lng: 10.7, heading: null, speed: 3, updated_at: '2026-10-29T10:00:00.000Z',
    });
  });
});

/** A fake Supabase client for the customer's map. */
function fakeClient(driverUserId: string | null, last: { lat: number; lng: number } | null) {
  let handler: ((p: any) => void) | null = null;
  const filters: string[] = [];
  const channel = {
    on: vi.fn((_ev: string, opts: any, cb: (p: any) => void) => { filters.push(opts.filter); handler = cb; return channel; }),
    subscribe: vi.fn(() => channel),
  };
  const client: TrackingClient = {
    rpc: vi.fn(async () => ({ data: driverUserId, error: null })),
    from: vi.fn(() => {
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => { q.eqArgs = [col, val]; return q; },
        maybeSingle: async () => ({ data: last }),
      };
      return q;
    }),
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };
  return { client, channel, filters, push: (row: any) => handler?.({ new: row }) };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe('customer map', () => {
  it('resolves the booking\'s driver, shows the last position and follows updates', async () => {
    const f = fakeClient('driver-user-1', { lat: 59.91, lng: 10.75 });
    const seen: any[] = [];
    const stop = followBookingDriver(f.client, 'booking-1', p => seen.push(p));
    await tick(); await tick();
    expect(f.client.rpc).toHaveBeenCalledWith('booking_driver_user', { p_booking_id: 'booking-1' });
    expect(f.filters).toEqual(['driver_id=eq.driver-user-1']);
    f.push({ lat: '59.92', lng: '10.76' });
    expect(seen).toEqual([{ lat: 59.91, lng: 10.75 }, { lat: 59.92, lng: 10.76 }]);
    stop();
    expect(f.client.removeChannel).toHaveBeenCalledWith(f.channel);
    f.push({ lat: 1, lng: 1 });
    expect(seen).toHaveLength(2);
  });

  it('does nothing when the booking has no driver the customer may see', async () => {
    const f = fakeClient(null, null);
    const onPos = vi.fn();
    followBookingDriver(f.client, 'booking-1', onPos);
    await tick(); await tick();
    expect(f.client.from).not.toHaveBeenCalled();
    expect(f.client.channel).not.toHaveBeenCalled();
    expect(onPos).not.toHaveBeenCalled();
  });

  it('does not subscribe if the map closed while resolving', async () => {
    const f = fakeClient('driver-user-1', null);
    const stop = followBookingDriver(f.client, 'booking-1', vi.fn());
    stop();
    await tick(); await tick();
    expect(f.client.channel).not.toHaveBeenCalled();
  });
});
