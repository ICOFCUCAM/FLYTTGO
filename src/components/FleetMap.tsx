/**
 * FleetMap — operations control map for the admin dashboard.
 *
 * Renders:
 *   • Every online driver's latest GPS position (green dot) with a
 *     popup showing their name, plan, and status + quick-action
 *     suspend/refresh buttons.
 *   • Every in-flight booking's pickup (blue pin) + dropoff (grey
 *     dot), connected by a dashed polyline so you can eyeball route
 *     length at a glance. Popup shows the route, price, payment
 *     status, and the assigned driver.
 *
 * Data sources:
 *   - driver_profiles   WHERE online = true
 *   - driver_locations  latest row per driver_id
 *   - bookings          WHERE status IN (driver_assigned, pickup_arrived,
 *                                        loading, in_transit)
 *
 * Real-time: subscribes to the supabase_realtime publication for
 * driver_locations so driver markers move as positions are updated
 * by the DriverPortal GPS beacon. Falls back to the one-shot fetch
 * if the publication isn't enabled yet (common on fresh projects —
 * see docs/realtime-tracking-setup.sql).
 *
 * Lazy-loaded from AdminDashboard so the ~150 KB Leaflet bundle is
 * only paid when an admin actually opens the Fleet Map tab.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L, { LatLngBounds, LatLngTuple } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../lib/supabase';

interface DriverWithLocation {
  id:                string;  // driver_profiles.id
  user_id:           string;  // auth.users.id
  full_name?:        string | null;
  online?:           boolean;
  status?:           string | null;
  phone?:            string | null;
  lat:               number;
  lng:               number;
  plan?:             string | null;
}

interface InFlightBooking {
  id:               string;
  pickup_address?:  string | null;
  pickup_lat?:      number | null;
  pickup_lng?:      number | null;
  dropoff_address?: string | null;
  dropoff_lat?:     number | null;
  dropoff_lng?:     number | null;
  price_estimate?:  number | null;
  status?:          string | null;
  payment_status?:  string | null;
  driver_id?:       string | null;
}

/* In-flight booking statuses (from the bookings CHECK constraint) —
 * everything where a driver has been assigned but the job isn't done. */
const IN_FLIGHT_STATUSES = [
  'driver_assigned',
  'pickup_arrived',
  'loading',
  'in_transit',
];

/* Leaflet default icon paths are broken with bundlers — patch to
 * CDN URLs so the blue pin actually renders. Same fix as
 * DriverTrackingMap + NearbyJobsMap. */
const pickupIcon = L.icon({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:    [25, 41],
  iconAnchor:  [12, 41],
  popupAnchor: [1, -34],
  shadowSize:  [41, 41],
});

const dropoffIcon = L.divIcon({
  className: '',
  iconSize:  [16, 16],
  iconAnchor:[8, 8],
  html: `
    <div style="
      width: 16px; height: 16px; border-radius: 9999px;
      background: #9ca3af;
      border: 3px solid white;
      box-shadow: 0 2px 5px rgba(0,0,0,0.25);
    "></div>`,
});

/* Driver marker — emerald dot with a pulsing halo so the admin can
 * instantly spot moving drivers among the static pickup/dropoff
 * pins. The pulse is CSS-only, no JS timer needed. */
const driverIcon = L.divIcon({
  className: '',
  iconSize:  [24, 24],
  iconAnchor:[12, 12],
  html: `
    <div style="position: relative; width: 24px; height: 24px;">
      <div style="
        position: absolute; inset: 0;
        border-radius: 9999px;
        background: #10b981; opacity: 0.35;
        animation: flyttgo-pulse 2s ease-out infinite;
      "></div>
      <div style="
        position: absolute; top: 4px; left: 4px;
        width: 16px; height: 16px; border-radius: 9999px;
        background: #059669;
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(5, 150, 105, 0.6);
      "></div>
    </div>
    <style>
      @keyframes flyttgo-pulse {
        0%   { transform: scale(1);   opacity: 0.35; }
        70%  { transform: scale(2.2); opacity: 0;    }
        100% { transform: scale(2.2); opacity: 0;    }
      }
    </style>`,
});

/* Auto-fit viewport to cover every pin whenever the driver /
 * booking set changes. Reused from NearbyJobsMap's pattern. */
function FitBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = new LatLngBounds(points);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  }, [map, points]);
  return null;
}

interface Props {
  /** Callback when admin clicks "Suspend" on a driver marker popup. */
  onSuspendDriver?: (driverId: string) => void;
  /** Optional tailwind height class, default h-[600px]. */
  height?: string;
  className?: string;
}

export default function FleetMap({ onSuspendDriver, height = 'h-[600px]', className = '' }: Props) {
  const [drivers,  setDrivers]  = useState<DriverWithLocation[]>([]);
  const [bookings, setBookings] = useState<InFlightBooking[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  /* Initial data load — drivers, their latest positions, and
   * in-flight bookings in parallel. Any single query failing just
   * logs and continues so a missing optional table (e.g. a fresh
   * project without driver_locations) doesn't blank the map. */
  async function load() {
    setLoading(true);
    setError('');

    try {
      /* Online drivers with their current subscription plan. */
      const { data: drv, error: drvErr } = await supabase
        .from('driver_profiles')
        .select('id, user_id, full_name, online, status, phone, driver_subscriptions(plan)')
        .eq('online', true);

      if (drvErr) throw drvErr;

      /* Latest GPS fix per driver_id. We read every row and
       * dedupe client-side by (driver_id → most-recent) — the
       * driver_locations table is small (one row per driver per
       * ~10s) so this is fast enough. */
      const { data: locs } = await supabase
        .from('driver_locations')
        .select('driver_id, lat, lng, updated_at')
        .order('updated_at', { ascending: false });

      const latestByDriver: Record<string, { lat: number; lng: number }> = {};
      for (const row of (locs ?? []) as any[]) {
        if (!latestByDriver[row.driver_id]) {
          const lat = Number(row.lat);
          const lng = Number(row.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            latestByDriver[row.driver_id] = { lat, lng };
          }
        }
      }

      const merged: DriverWithLocation[] = ((drv ?? []) as any[])
        .map(d => {
          /* driver_locations.driver_id is keyed on auth.users.id
           * (the same key DriverPortal uses when upserting). */
          const loc = latestByDriver[d.user_id];
          if (!loc) return null;
          return {
            id:        d.id,
            user_id:   d.user_id,
            full_name: d.full_name,
            online:    d.online,
            status:    d.status,
            phone:     d.phone,
            plan:      d.driver_subscriptions?.[0]?.plan ?? null,
            lat:       loc.lat,
            lng:       loc.lng,
          };
        })
        .filter((x): x is DriverWithLocation => x !== null);

      setDrivers(merged);

      /* In-flight bookings with valid coordinates. */
      const { data: bks } = await supabase
        .from('bookings')
        .select('id, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, price_estimate, status, payment_status, driver_id')
        .in('status', IN_FLIGHT_STATUSES);

      setBookings(
        ((bks ?? []) as any[]).filter(
          b =>
            typeof b.pickup_lat === 'number' && typeof b.pickup_lng === 'number'
        )
      );
    } catch (e: any) {
      console.error('[FleetMap] load failed', e);
      setError(e?.message || 'Unable to load fleet data');
    }
    setLoading(false);
  }

  useEffect(() => {
    load();

    /* Realtime: whenever a driver_locations row is inserted or
     * updated, merge the new position into the drivers state
     * without refetching. Silent no-op when driver_locations
     * isn't in the supabase_realtime publication. */
    const channel = supabase
      .channel('admin-fleet-map-driver-locations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_locations' },
        payload => {
          const row: any = payload.new;
          if (!row) return;
          const lat = Number(row.lat);
          const lng = Number(row.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          setDrivers(prev =>
            prev.map(d => (d.user_id === row.driver_id ? { ...d, lat, lng } : d))
          );
        }
      )
      .subscribe();

    /* Also periodically reload everything every 30s in case
     * drivers go online/offline or new bookings come in. Cheap
     * and covers the case where Realtime isn't set up. */
    const intervalId = window.setInterval(load, 30_000);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Collect every lat/lng so FitBounds can zoom the viewport to
   * cover the whole active fleet + all pending routes. */
  const bounds: LatLngTuple[] = useMemo(() => {
    const pts: LatLngTuple[] = [];
    for (const d of drivers) pts.push([d.lat, d.lng]);
    for (const b of bookings) {
      pts.push([b.pickup_lat as number, b.pickup_lng as number]);
      if (typeof b.dropoff_lat === 'number' && typeof b.dropoff_lng === 'number') {
        pts.push([b.dropoff_lat, b.dropoff_lng]);
      }
    }
    return pts;
  }, [drivers, bookings]);

  /* Oslo fallback centre when we have zero pins to render. */
  const initialCentre: LatLngTuple =
    bounds.length > 0 ? bounds[0] : [59.9139, 10.7522];

  return (
    <div className={`${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Live Fleet Map</h2>
          <p className="text-xs text-gray-500">
            {loading
              ? 'Loading fleet…'
              : `${drivers.length} online driver${drivers.length === 1 ? '' : 's'} · ${bookings.length} in-flight booking${bookings.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-semibold"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div className={`${height} rounded-xl overflow-hidden border border-gray-200 relative`}>
        {drivers.length === 0 && bookings.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-[1000] pointer-events-none">
            <div className="text-center text-sm text-gray-500 max-w-md px-6">
              <div className="text-3xl mb-2">🗺️</div>
              <p className="font-semibold">No fleet activity right now</p>
              <p className="text-xs mt-1">
                The map will light up as soon as drivers go online or bookings enter the in-flight lifecycle.
                Driver positions require the DriverPortal GPS beacon to be pushing updates to
                <code className="mx-1 bg-gray-100 rounded px-1">driver_locations</code>.
              </p>
            </div>
          </div>
        )}
        <MapContainer
          center={initialCentre}
          zoom={11}
          scrollWheelZoom={true}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={bounds} />

          {/* Driver markers */}
          {drivers.map(d => (
            <Marker key={`drv-${d.id}`} position={[d.lat, d.lng]} icon={driverIcon}>
              <Popup>
                <div className="text-xs min-w-[220px] space-y-1">
                  <div className="font-bold text-gray-900 text-sm">
                    {d.full_name || 'Driver'}
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                    Online
                    {d.status && (
                      <span className="capitalize text-gray-400">· {d.status}</span>
                    )}
                  </div>
                  {d.plan && (
                    <div className="text-gray-500">
                      Plan: <span className="font-semibold capitalize">{d.plan.replace(/_/g, ' ')}</span>
                    </div>
                  )}
                  {d.phone && (
                    <div className="text-gray-500">
                      <a href={`tel:${d.phone}`} className="text-emerald-600 hover:underline">
                        {d.phone}
                      </a>
                    </div>
                  )}
                  {onSuspendDriver && (
                    <button
                      onClick={() => onSuspendDriver(d.id)}
                      className="mt-2 w-full bg-red-600 hover:bg-red-700 text-white rounded px-3 py-1 text-xs font-semibold"
                    >
                      Suspend driver
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Booking markers */}
          {bookings.map(b => {
            const pickup: LatLngTuple = [b.pickup_lat as number, b.pickup_lng as number];
            const hasDropoff =
              typeof b.dropoff_lat === 'number' && typeof b.dropoff_lng === 'number';
            const dropoff: LatLngTuple | null = hasDropoff
              ? [b.dropoff_lat as number, b.dropoff_lng as number]
              : null;
            return (
              <React.Fragment key={`bk-${b.id}`}>
                <Marker position={pickup} icon={pickupIcon}>
                  <Popup>
                    <div className="text-xs min-w-[220px] space-y-1">
                      <div className="font-semibold text-gray-900">
                        {b.pickup_address || 'Pickup'}
                      </div>
                      {b.dropoff_address && (
                        <div className="text-gray-600">→ {b.dropoff_address}</div>
                      )}
                      <div className="flex items-center justify-between pt-2">
                        <span className="font-bold text-emerald-600">
                          {Number(b.price_estimate ?? 0).toFixed(0)} NOK
                        </span>
                        {b.status && (
                          <span className="capitalize text-gray-500">
                            {b.status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      {b.payment_status && (
                        <div className="text-gray-500">
                          Payment: <span className="font-semibold capitalize">{b.payment_status}</span>
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
                {dropoff && (
                  <>
                    <Marker position={dropoff} icon={dropoffIcon}>
                      <Popup>
                        <div className="text-xs">
                          {b.dropoff_address || 'Dropoff'}
                        </div>
                      </Popup>
                    </Marker>
                    <Polyline
                      positions={[pickup, dropoff]}
                      color="#6b7280"
                      weight={2}
                      dashArray="4 6"
                    />
                  </>
                )}
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
