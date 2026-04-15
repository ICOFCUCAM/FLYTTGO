/**
 * NearbyJobsMap — multi-pin Leaflet map for the DriverPortal jobs tab.
 *
 * Renders:
 *   • one green dot for the driver's current position (browser
 *     geolocation, one-shot)
 *   • one blue pin per pending-job pickup (clickable popup with the
 *     job summary + "Accept" button)
 *   • one grey pin per pending-job dropoff (visual context for how
 *     far the trip goes)
 *
 * No backend fetches — the jobs array is passed in as a prop by
 * DriverPortal, which already loaded them. This component is only
 * responsible for the visualisation. If browser geolocation fails
 * or is denied, the map still renders with just the job pins and
 * auto-fits the viewport to them.
 *
 * Lazy-loaded from DriverPortal so the ~150 KB Leaflet bundle isn't
 * paid by drivers who don't open the jobs tab.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L, { LatLngBounds, LatLngTuple } from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Job {
  id:              string;
  pickup_address?: string | null;
  pickup_lat?:     number | null;
  pickup_lng?:     number | null;
  dropoff_address?: string | null;
  dropoff_lat?:    number | null;
  dropoff_lng?:    number | null;
  price_estimate?: number | null;
  van_type?:       string | null;
  status?:         string | null;
}

interface Props {
  jobs:      Job[];
  onAccept?: (job: Job) => void;
  className?: string;
  /** Optional tailwind height class, default h-96 */
  height?: string;
}

/* Default Leaflet markers need CDN image paths (bundlers can't
 * resolve the bundled ones). Same fix DriverTrackingMap uses. */
const pickupIcon = L.icon({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:   [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/* Grey-ish circle for dropoff so pickups stand out. */
const dropoffIcon = L.divIcon({
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `
    <div style="
      width: 18px; height: 18px; border-radius: 9999px;
      background: #9ca3af;
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    "></div>`,
});

/* Driver position — emerald dot to match the app's primary colour. */
const driverIcon = L.divIcon({
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html: `
    <div style="
      width: 24px; height: 24px; border-radius: 9999px;
      background: #059669;
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(5, 150, 105, 0.6);
    "></div>`,
});

/** Helper child component — fits the map viewport to cover every
 *  pin whenever the set of jobs or the driver position changes. */
function FitBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = new LatLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [map, points]);
  return null;
}

export default function NearbyJobsMap({ jobs, onAccept, className = '', height = 'h-96' }: Props) {
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);

  /* Ask the browser for the driver's current location on mount.
   * One-shot — we don't watch for movement here because the jobs
   * tab is a "pick something new" view, not a live-tracking one. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      pos => setDriverPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => {
        /* User denied, unavailable, or timed out. Silently fall
         * back to auto-fitting the viewport to just the job pins. */
        console.info('[NearbyJobsMap] geolocation unavailable:', err.message);
      },
      {
        enableHighAccuracy: false,
        timeout:            5000,
        maximumAge:         60_000, // 1 min cached fix is fine
      }
    );
  }, []);

  /* Only jobs with valid pickup coordinates are render-able. We
   * skip anything NULL rather than centre-of-Norway-pinning it
   * because that would be actively misleading. */
  const validJobs = useMemo(
    () =>
      jobs.filter(
        j =>
          typeof j.pickup_lat === 'number' && typeof j.pickup_lng === 'number' &&
          !Number.isNaN(j.pickup_lat) && !Number.isNaN(j.pickup_lng)
      ),
    [jobs]
  );

  /* Collect every lat/lng we're going to render so FitBounds can
   * zoom the viewport to cover all of them. */
  const bounds: LatLngTuple[] = useMemo(() => {
    const pts: LatLngTuple[] = [];
    if (driverPos) pts.push([driverPos.lat, driverPos.lng]);
    for (const j of validJobs) {
      pts.push([j.pickup_lat as number, j.pickup_lng as number]);
      if (typeof j.dropoff_lat === 'number' && typeof j.dropoff_lng === 'number') {
        pts.push([j.dropoff_lat, j.dropoff_lng]);
      }
    }
    return pts;
  }, [driverPos, validJobs]);

  /* Empty state — no jobs have coordinates we can render. */
  if (validJobs.length === 0 && !driverPos) {
    return (
      <div className={`${height} ${className} rounded-2xl bg-gray-100 flex items-center justify-center text-sm text-gray-500`}>
        No nearby jobs to display on the map right now.
      </div>
    );
  }

  /* Oslo fallback centre if we somehow have zero points for the
   * bounds calculation. Leaflet requires an initial center. */
  const initialCentre: LatLngTuple = driverPos
    ? [driverPos.lat, driverPos.lng]
    : validJobs.length > 0
      ? [validJobs[0].pickup_lat as number, validJobs[0].pickup_lng as number]
      : [59.9139, 10.7522]; // Oslo

  return (
    <div className={`${height} ${className} rounded-2xl overflow-hidden border border-gray-200`}>
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

        {/* Driver position */}
        {driverPos && (
          <Marker position={[driverPos.lat, driverPos.lng]} icon={driverIcon}>
            <Popup>You are here</Popup>
          </Marker>
        )}

        {/* Job pins — one pickup + one dropoff per job, connected
         * by a faint line so the driver can eyeball trip length. */}
        {validJobs.map(job => {
          const pickup: LatLngTuple = [job.pickup_lat as number, job.pickup_lng as number];
          const hasDropoff =
            typeof job.dropoff_lat === 'number' && typeof job.dropoff_lng === 'number';
          const dropoff: LatLngTuple | null = hasDropoff
            ? [job.dropoff_lat as number, job.dropoff_lng as number]
            : null;

          /* React.Fragment (not a plain div) because react-leaflet
           * Marker / Popup / Polyline are rendered into the Leaflet
           * map's layer tree via React context — wrapping them in a
           * real DOM element would create an orphan empty <div>
           * inside MapContainer's DOM root and is an invalid child
           * pattern. Fragment passes them through cleanly. */
          return (
            <React.Fragment key={job.id}>
              <Marker position={pickup} icon={pickupIcon}>
                <Popup>
                  <div className="text-xs space-y-1 min-w-[200px]">
                    <div className="font-semibold text-gray-900 text-sm">
                      {job.pickup_address || 'Pickup'}
                    </div>
                    {job.dropoff_address && (
                      <div className="text-gray-600">→ {job.dropoff_address}</div>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      <span className="font-bold text-emerald-600">
                        {Number(job.price_estimate ?? 0).toFixed(0)} NOK
                      </span>
                      {job.van_type && (
                        <span className="text-gray-500 capitalize">
                          {job.van_type.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    {onAccept && job.status === 'pending' && (
                      <button
                        onClick={() => onAccept(job)}
                        className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded px-3 py-1.5 text-xs"
                      >
                        Accept job
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
              {dropoff && (
                <>
                  <Marker position={dropoff} icon={dropoffIcon}>
                    <Popup>
                      <div className="text-xs">{job.dropoff_address || 'Dropoff'}</div>
                    </Popup>
                  </Marker>
                  <Polyline positions={[pickup, dropoff]} color="#6b7280" weight={2} dashArray="4 6" />
                </>
              )}
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
