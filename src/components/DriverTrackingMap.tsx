import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../lib/supabase';
import { followBookingDriver } from '../lib/driverTracking';

/**
 * DriverTrackingMap
 *
 * Renders a Leaflet map showing:
 *   - the pickup location pin
 *   - the delivery location pin
 *   - the driver's live location (subscribed to driver_locations via
 *     Supabase Realtime — falls back to a one-time fetch if Realtime
 *     isn't configured for the table)
 *
 * Drop this in anywhere a booking detail is shown; pass the booking's
 * id and it does the rest (src/lib/driverTracking.ts): it asks for the
 * driver of the signed-in customer's own in-flight booking, reads the
 * last position and follows updates over Realtime. Before a driver is
 * assigned, or once the job is done, it shows just pickup + delivery.
 *
 * Leaflet is already in package.json, so no extra deps required.
 */

interface Coords {
  lat: number;
  lng: number;
}

interface Props {
  pickup: Coords;
  dropoff: Coords;
  /** The booking whose driver to follow (the customer's own booking). */
  bookingId?: string | null;
  className?: string;
  height?: string; // tailwind height class, default h-72
}

/* Default Leaflet marker icons are broken with bundlers because the
 * image paths inside the package don't resolve. Patch them with the
 * CDN URLs Leaflet's docs recommend. */
const defaultIcon = L.icon({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:    [25, 41],
  iconAnchor:  [12, 41],
  popupAnchor: [1, -34],
  shadowSize:  [41, 41],
});

/* Simple coloured circle for the driver position so it stands out
 * from the pickup/dropoff pins. */
const driverIcon = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `
    <div style="
      width: 22px; height: 22px; border-radius: 9999px;
      background: #059669;
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
});

export default function DriverTrackingMap({ pickup, dropoff, bookingId, className = '', height = 'h-72' }: Props) {
  const [driverPos, setDriverPos] = useState<Coords | null>(null);

  useEffect(() => {
    setDriverPos(null);
    if (!bookingId) return;
    return followBookingDriver(supabase, bookingId, setDriverPos);
  }, [bookingId]);

  /* Centre the map on the midpoint of pickup → dropoff (or driver
   * position if available, so the user always sees something useful). */
  const center = useMemo<[number, number]>(() => {
    if (driverPos) return [driverPos.lat, driverPos.lng];
    return [(pickup.lat + dropoff.lat) / 2, (pickup.lng + dropoff.lng) / 2];
  }, [pickup, dropoff, driverPos]);

  /* Auto-zoom — wider when the route is longer */
  const zoom = useMemo(() => {
    const dx = Math.abs(pickup.lat - dropoff.lat) + Math.abs(pickup.lng - dropoff.lng);
    if (dx > 5)  return 6;
    if (dx > 1)  return 8;
    if (dx > 0.3) return 10;
    return 12;
  }, [pickup, dropoff]);

  return (
    <div className={`${height} rounded-xl overflow-hidden border border-gray-200 ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={[pickup.lat, pickup.lng]} icon={defaultIcon}>
          <Popup>Pickup</Popup>
        </Marker>

        <Marker position={[dropoff.lat, dropoff.lng]} icon={defaultIcon}>
          <Popup>Delivery</Popup>
        </Marker>

        <Polyline
          positions={[
            [pickup.lat, pickup.lng],
            [dropoff.lat, dropoff.lng],
          ]}
          pathOptions={{ color: '#059669', weight: 3, opacity: 0.6, dashArray: '6 6' }}
        />

        {driverPos && (
          <Marker position={[driverPos.lat, driverPos.lng]} icon={driverIcon}>
            <Popup>Driver — live position</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
