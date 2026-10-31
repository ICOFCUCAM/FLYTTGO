/**
 * The route between pickup and drop-off on a map (owner, 31 October 2026): the real road from the router
 * (lib/routeGeometry.ts), the two ends marked A and B, the view fitted to the route, and — on the tracking
 * page — the driver's live position. When the road cannot be fetched the line is the straight one and the
 * caption says so. Load it lazily (React.lazy): Leaflet is only fetched when a map is shown.
 */
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { formatDuration, routeGeometry, straightGeometry, type RouteGeometry } from '../lib/routeGeometry';

export interface RouteMapProps {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  driver?: { lat: number; lng: number } | null;
  pickupLabel?: string;
  dropoffLabel?: string;
  className?: string;
  /** Tailwind height class. */
  height?: string;
  /** Called once the route is known (distance, duration, whether it is the road). */
  onRoute?: (route: RouteGeometry) => void;
}

const pin = (letter: string, bg: string) => L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html: `<div style="width:30px;height:30px;border-radius:9999px;background:${bg};color:#fff;font:700 13px/30px Manrope,system-ui,sans-serif;text-align:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(23,33,46,.35)">${letter}</div>`,
});
const PICKUP = pin('A', '#24513B');
const DROPOFF = pin('B', '#203F68');
const DRIVER = L.divIcon({
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  html: '<div class="fg-driver-dot" style="width:20px;height:20px;border-radius:9999px;background:#203F68;border:3px solid #fff;box-shadow:0 0 0 6px rgba(32,63,104,.3),0 2px 6px rgba(0,0,0,.3)"></div>',
});

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 14 });
  }, [map, points]);
  return null;
}

export default function RouteMap({ pickup, dropoff, driver, pickupLabel, dropoffLabel, className = '', height = 'h-72', onRoute }: RouteMapProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'no' ? 'no' : 'en';
  const [route, setRoute] = useState<RouteGeometry>(() => straightGeometry(pickup, dropoff));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setRoute(straightGeometry(pickup, dropoff));
    void routeGeometry(pickup, dropoff).then(r => { if (live) { setRoute(r); setLoading(false); onRoute?.(r); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  const bounds = useMemo(() => driver ? [...route.points, [driver.lat, driver.lng] as [number, number]] : route.points, [route, driver]);

  return (
    <figure className={`m-0 ${className}`}>
      <div className={`${height} overflow-hidden border border-[#E1E6E3] bg-[#F3F6F5] relative z-0`}>
        <MapContainer center={[(pickup.lat + dropoff.lat) / 2, (pickup.lng + dropoff.lng) / 2]} zoom={7} scrollWheelZoom={false}
                      style={{ height: '100%', width: '100%' }} attributionControl>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                     url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Polyline positions={route.points} pathOptions={route.source === 'road'
            ? { color: '#24513B', weight: 5, opacity: 0.9 }
            : { color: '#24513B', weight: 3, opacity: 0.6, dashArray: '6 8' }} />
          <Marker position={[pickup.lat, pickup.lng]} icon={PICKUP}>
            <Tooltip direction="top" offset={[0, -14]}>{pickupLabel || t('routeMap.pickup')}</Tooltip>
          </Marker>
          <Marker position={[dropoff.lat, dropoff.lng]} icon={DROPOFF}>
            <Tooltip direction="top" offset={[0, -14]}>{dropoffLabel || t('routeMap.dropoff')}</Tooltip>
          </Marker>
          {driver && (
            <Marker position={[driver.lat, driver.lng]} icon={DRIVER}>
              <Tooltip direction="top" offset={[0, -10]} permanent>{t('routeMap.driver')}</Tooltip>
            </Marker>
          )}
          <FitBounds points={bounds} />
        </MapContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#4A5260]">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#24513B]" aria-hidden="true" />{pickupLabel || t('routeMap.pickup')}</span>
        <span aria-hidden="true">→</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#203F68]" aria-hidden="true" />{dropoffLabel || t('routeMap.dropoff')}</span>
        <span className="ms-auto font-semibold text-[#17212E]" aria-live="polite">
          {loading ? t('routeMap.loading') : route.source === 'road'
            ? t('routeMap.road', { km: route.distanceKm.toLocaleString(lang === 'no' ? 'nb-NO' : 'en-GB'), time: formatDuration(route.durationMinutes, lang) })
            : t('routeMap.straight', { km: route.distanceKm.toLocaleString(lang === 'no' ? 'nb-NO' : 'en-GB') })}
        </span>
      </figcaption>
    </figure>
  );
}
