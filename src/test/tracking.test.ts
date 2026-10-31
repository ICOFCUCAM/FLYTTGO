import { describe, expect, it } from 'vitest';
import { BOOKING_STATUSES, TRACKING_STEPS, isUuid, normaliseRef, stepTime, trackingState } from '../lib/trackingStatus';
import { formatDuration, routeGeometry, straightGeometry } from '../lib/routeGeometry';

/* Tracking, rebuilt 31 October 2026: one status mapping, a reference people can type, the road on the map. */
describe('tracking status', () => {
  it('maps every real status: none falls back to step one, cancelled is its own state', () => {
    const steps = Object.fromEntries(BOOKING_STATUSES.map(s => [s, trackingState(s)]));
    expect(steps.pending.step).toBe(0);
    expect(steps.confirmed.step).toBe(0);
    expect(steps.driver_assigned.step).toBe(1);
    expect(steps.pickup_arrived.step).toBe(2);
    expect(steps.loading.step).toBe(3);
    expect(steps.in_transit.step).toBe(4);
    expect(steps.completed.step).toBe(TRACKING_STEPS.length - 1);
    expect(steps.cancelled).toMatchObject({ cancelled: true, step: -1 });
    expect(trackingState('in_progress')).toMatchObject({ unknown: true, step: -1 });   // a status that does not exist is not shown as booked
    expect(trackingState(null).unknown).toBe(true);
  });

  it('knows where the driver is heading, for the arrival estimate', () => {
    expect(trackingState('driver_assigned').heading).toBe('pickup');
    expect(trackingState('in_transit').heading).toBe('dropoff');
    expect(trackingState('completed').heading).toBeNull();
  });

  it('shows only times the booking recorded', () => {
    const b = { created_at: '2026-10-31T08:00:00Z', start_time: '2026-11-01T09:00:00Z', end_time: null };
    expect(stepTime('booked', b)).toBe(b.created_at);
    expect(stepTime('transit', b)).toBe(b.start_time);
    expect(stepTime('assigned', b)).toBeNull();
    expect(stepTime('delivered', b)).toBeNull();
  });

  it('reads a reference however it is typed, and refuses what cannot be one', () => {
    expect(normaliseRef('FG-7K3M9Q')).toBe('FG-7K3M9Q');
    expect(normaliseRef(' fg 7k3m9q ')).toBe('FG-7K3M9Q');
    expect(normaliseRef('7K3M9Q')).toBe('FG-7K3M9Q');
    expect(normaliseRef('FG-0O1IL2')).toBeNull();                // characters the alphabet leaves out
    expect(normaliseRef('9a3907b6')).toBeNull();                 // the old eight characters of the id
    expect(isUuid('9a3907b6-77ed-4a11-8c3b-98f441d3de91')).toBe(true);
  });
});

describe('route geometry', () => {
  const OSLO = { lat: 59.9139, lng: 10.7522 }, BERGEN = { lat: 60.3913, lng: 5.3221 };

  it('draws the road when the router answers', async () => {
    const f = async () => ({ ok: true, json: async () => ({ routes: [{ distance: 460800, duration: 27960, geometry: { coordinates: [[10.7522, 59.9139], [8.0, 60.5], [5.3221, 60.3913]] } }] }) });
    const r = await routeGeometry(OSLO, { lat: 60.3914, lng: 5.3222 }, f);
    expect(r).toMatchObject({ source: 'road', distanceKm: 460.8, durationMinutes: 466 });
    expect(r.points[1]).toEqual([60.5, 8.0]);                     // [lat, lng] for the map
  });

  it('falls back to the straight line, marked as such, and never throws', async () => {
    const down = async () => { throw new Error('offline'); };
    const r = await routeGeometry(OSLO, BERGEN, down);
    expect(r.source).toBe('straight');
    expect(r.points).toHaveLength(2);
    expect(r).toEqual(straightGeometry(OSLO, BERGEN));
  });

  it('formats durations', () => {
    expect(formatDuration(466)).toBe('7 h 46 min');
    expect(formatDuration(45, 'no')).toBe('45 min');
    expect(formatDuration(120, 'no')).toBe('2 t');
  });
});
