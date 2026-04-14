import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/* ── Leaflet global (loaded via CDN in index.html) ── */
declare const L: any;

interface LatLng { lat: number; lng: number; }

export interface DeliveryMapProps {
  pickupAddress: string;
  deliveryAddress: string;
  status: string;
  mode: 'customer' | 'driver';
  driverLat?: number | null;
  driverLng?: number | null;
  className?: string;
  compact?: boolean;
}

/* ── In-memory geocode cache ── */
const geocodeCache: Record<string, LatLng | null> = {};

const STATUS_PROGRESS: Record<string, { step: number; total: number; label: string; phase: string }> = {
  pending:              { step: 0, total: 8, label: 'Awaiting Driver',            phase: 'pickup' },
  confirmed:            { step: 1, total: 8, label: 'Confirmed',                   phase: 'pickup' },
  driver_assigned:      { step: 2, total: 8, label: 'Driver Assigned',             phase: 'pickup' },
  driver_en_route:      { step: 3, total: 8, label: 'Driver En Route to Pickup',   phase: 'pickup' },
  arrived_pickup:       { step: 4, total: 8, label: 'Driver at Pickup',            phase: 'pickup' },
  loading:              { step: 5, total: 8, label: 'Loading Items',               phase: 'pickup' },
  in_transit:           { step: 6, total: 8, label: 'In Transit',                  phase: 'transit' },
  arrived_destination:  { step: 7, total: 8, label: 'Driver Arrived',              phase: 'delivery' },
  unloading:            { step: 7, total: 8, label: 'Unloading',                   phase: 'delivery' },
  completed:            { step: 8, total: 8, label: 'Delivered ✓',                 phase: 'done' },
};

const ETA_LABELS: Record<string, string> = {
  pending: 'Waiting for driver match',
  confirmed: 'Driver will be assigned soon',
  driver_assigned: 'Driver preparing to depart',
  driver_en_route: '15–25 min to pickup',
  arrived_pickup: 'Driver at pickup location',
  loading: '10–20 min loading',
  in_transit: '20–40 min to delivery',
  arrived_destination: 'Driver has arrived!',
  unloading: '10–15 min unloading',
  completed: 'Delivery complete',
};

const ACTIVE_STATUSES = new Set([
  'driver_en_route','arrived_pickup','loading','in_transit','arrived_destination','unloading',
]);

/* ── Norwegian city coordinate fallback ── */
function estimateCoords(addr: string, offset = false): LatLng {
  const a = addr.toLowerCase();
  const o = offset ? 0.02 : 0;
  if (a.includes('oslo'))         return { lat: 59.9139 + o, lng: 10.7522 + o };
  if (a.includes('bergen'))       return { lat: 60.3913 + o, lng: 5.3221  + o };
  if (a.includes('trondheim'))    return { lat: 63.4305 + o, lng: 10.3951 + o };
  if (a.includes('stavanger'))    return { lat: 58.9700 + o, lng: 5.7331  + o };
  if (a.includes('drammen'))      return { lat: 59.7441 + o, lng: 10.2045 + o };
  if (a.includes('fredrikstad'))  return { lat: 59.2181 + o, lng: 10.9298 + o };
  if (a.includes('kristiansand')) return { lat: 58.1599 + o, lng: 8.0182  + o };
  if (a.includes('tromsø') || a.includes('tromso')) return { lat: 69.6492 + o, lng: 18.9553 + o };
  return { lat: 59.92 + o, lng: 10.75 + o };
}

function makeIcon(color: string, label: string, size: number) {
  return L.divIcon({
    className: 'custom-map-marker',
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(45deg);color:#fff;font-weight:700;font-size:${Math.floor(size * 0.4)}px">${label}</div></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size],
  });
}

function makeDriverIcon(size: number, pulse: boolean) {
  return L.divIcon({
    className: 'custom-map-marker',
    html: `<div style="width:${size}px;height:${size}px;background:#3b82f6;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 12px rgba(59,130,246,.5);display:flex;align-items:center;justify-content:center;${pulse?'animation:pulse 2s infinite':''}"><svg width="${Math.floor(size*.55)}" height="${Math.floor(size*.55)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}

export default function DeliveryMap({
  pickupAddress, deliveryAddress, status, mode,
  driverLat, driverLng, className = '', compact = false,
}: DeliveryMapProps) {
  const mapRef      = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);
  const markersRef  = useRef<any[]>([]);
  const routeRef    = useRef<any>(null);

  const [pickupCoords,   setPickupCoords]   = useState<LatLng | null>(null);
  const [deliveryCoords, setDeliveryCoords] = useState<LatLng | null>(null);
  const [loadingMap,     setLoadingMap]     = useState(true);
  const [mapError,       setMapError]       = useState<string | null>(null);
  const [retry,          setRetry]          = useState(0);

  /* ── 1. Geocode ── */
  const geocode = useCallback(async () => {
    setLoadingMap(true); setMapError(null);
    try {
      const toGeocode: string[] = [];
      if (geocodeCache[pickupAddress]   !== undefined) setPickupCoords(geocodeCache[pickupAddress]);
      else toGeocode.push(pickupAddress);
      if (geocodeCache[deliveryAddress] !== undefined) setDeliveryCoords(geocodeCache[deliveryAddress]);
      else toGeocode.push(deliveryAddress);

      if (toGeocode.length) {
        const { data, error } = await supabase.functions.invoke('geocode-address', {
          body: { addresses: toGeocode },
        });
        if (!error && data?.results) {
          toGeocode.forEach(addr => {
            const res = data.results[addr] ?? estimateCoords(addr, addr === deliveryAddress);
            geocodeCache[addr] = res;
            if (addr === pickupAddress)   setPickupCoords(res);
            if (addr === deliveryAddress) setDeliveryCoords(res);
          });
        } else throw new Error('geocode failed');
      }
    } catch {
      /* Fall back to city estimation — never leave map blank */
      const p = estimateCoords(pickupAddress);
      const d = estimateCoords(deliveryAddress, true);
      geocodeCache[pickupAddress]   = p;
      geocodeCache[deliveryAddress] = d;
      setPickupCoords(p);
      setDeliveryCoords(d);
    } finally { setLoadingMap(false); }
  }, [pickupAddress, deliveryAddress, retry]);

  useEffect(() => { geocode(); }, [geocode]);

  /* ── 2. Render map ── */
  useEffect(() => {
    if (loadingMap || !mapRef.current || typeof L === 'undefined') return;

    /* Inject pulse keyframes once */
    if (!document.getElementById('map-pulse-style')) {
      const s = document.createElement('style');
      s.id = 'map-pulse-style';
      s.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}';
      document.head.appendChild(s);
    }

    /* Init map */
    if (!instanceRef.current) {
      instanceRef.current = L.map(mapRef.current, {
        zoomControl: !compact,
        attributionControl: !compact,
        scrollWheelZoom: !compact,
        dragging: !compact || window.innerWidth > 768,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: compact ? '' : '&copy; OpenStreetMap contributors', maxZoom: 19,
      }).addTo(instanceRef.current);
    }

    const map = instanceRef.current;

    /* Clear old layers */
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    if (routeRef.current) { map.removeLayer(routeRef.current); routeRef.current = null; }

    const bounds: [number, number][] = [];
    const ms = compact ? 28 : 36;

    if (pickupCoords) {
      const m = L.marker([pickupCoords.lat, pickupCoords.lng], { icon: makeIcon('#10b981', 'P', ms) })
        .addTo(map).bindPopup(`<b style="color:#10b981">Pickup</b><br/>${pickupAddress}`);
      markersRef.current.push(m);
      bounds.push([pickupCoords.lat, pickupCoords.lng]);
    }

    if (deliveryCoords) {
      const m = L.marker([deliveryCoords.lat, deliveryCoords.lng], { icon: makeIcon('#ef4444', 'D', ms) })
        .addTo(map).bindPopup(`<b style="color:#ef4444">Delivery</b><br/>${deliveryAddress}`);
      markersRef.current.push(m);
      bounds.push([deliveryCoords.lat, deliveryCoords.lng]);
    }

    const isMoving = status === 'driver_en_route' || status === 'in_transit';
    if (driverLat && driverLng) {
      const dm = L.marker([driverLat, driverLng], { icon: makeDriverIcon(compact ? 32 : 40, isMoving) })
        .addTo(map).bindPopup(`<b style="color:#3b82f6">Driver</b><br/>${isMoving ? 'On the way' : 'At location'}`);
      markersRef.current.push(dm);
      bounds.push([driverLat, driverLng]);
    }

    if (pickupCoords && deliveryCoords) {
      const mid = { lat: (pickupCoords.lat + deliveryCoords.lat) / 2, lng: (pickupCoords.lng + deliveryCoords.lng) / 2 };
      const off = Math.abs(pickupCoords.lat - deliveryCoords.lat) * 0.15;
      routeRef.current = L.polyline([
        [pickupCoords.lat, pickupCoords.lng],
        [mid.lat + off, mid.lng],
        [deliveryCoords.lat, deliveryCoords.lng],
      ], { color: '#10b981', weight: 3, opacity: 0.7, dashArray: isMoving ? '10,8' : undefined, smoothFactor: 1.5 }).addTo(map);
    }

    const pad = compact ? 30 : 50;
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [pad, pad] });
    else if (bounds.length === 1) map.setView(bounds[0], 14);

    setTimeout(() => map.invalidateSize(), 120);
  }, [loadingMap, pickupCoords, deliveryCoords, status, driverLat, driverLng, compact]);

  /* ── Cleanup ── */
  useEffect(() => () => {
    if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; }
  }, []);

  function openGoogleMaps(addr: string, coords?: LatLng | null) {
    const dest = coords ? `${coords.lat},${coords.lng}` : encodeURIComponent(addr);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`, '_blank');
  }

  const sp = STATUS_PROGRESS[status];
  const isActive = ACTIVE_STATUSES.has(status);

  return (
    <div className={`rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm ${className}`}>

      {/* MAP */}
      <div className="relative">
        <div ref={mapRef} className={compact ? 'h-48' : 'h-72 md:h-80'} style={{ width: '100%', zIndex: 1 }}/>

        {loadingMap && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
              <span className="text-sm text-gray-500">Loading map…</span>
            </div>
          </div>
        )}

        {mapError && !loadingMap && (
          <div className="absolute inset-0 bg-gray-50 flex items-center justify-center z-10">
            <div className="text-center px-4">
              <div className="text-3xl mb-2">⚠️</div>
              <p className="text-sm text-gray-500 mb-3">{mapError}</p>
              <button onClick={() => setRetry(r => r + 1)}
                className="px-4 py-2 text-xs font-medium text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition">
                Retry
              </button>
            </div>
          </div>
        )}

        {!loadingMap && !compact && (
          <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm rounded-lg shadow px-3 py-2 z-10 flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"/>Pickup</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"/>Delivery</span>
            {(status === 'driver_en_route' || status === 'in_transit') && (
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"/>Driver</span>
            )}
          </div>
        )}
      </div>

      {/* INFO PANEL */}
      <div className="p-4 space-y-3">
        {/* Route row */}
        <div className="space-y-1.5">
          {([
            { color: '#10b981', label: 'Pickup',   addr: pickupAddress,   coords: pickupCoords,   dest: 'pickup' as const },
            { color: '#ef4444', label: 'Delivery', addr: deliveryAddress, coords: deliveryCoords, dest: 'delivery' as const },
          ]).map((row, i) => (
            <div key={row.label}>
              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: row.color + '20' }}>
                  <span style={{ color: row.color }} className="text-xs">📍</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: row.color }}>{row.label}</div>
                  <div className="text-sm text-gray-700 truncate">{row.addr}</div>
                </div>
                {mode === 'driver' && (
                  <button onClick={() => openGoogleMaps(row.addr, row.coords)}
                    className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition"
                    style={{ background: row.color + '15', color: row.color }}>
                    Navigate →
                  </button>
                )}
              </div>
              {i === 0 && <div className="ml-2.5 border-l-2 border-dashed border-gray-200 h-2 mt-1"/>}
            </div>
          ))}
        </div>

        {/* Customer progress panel */}
        {mode === 'customer' && isActive && sp && (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {(status === 'in_transit' || status === 'driver_en_route') && (
                  <div className="relative w-5 h-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-emerald-500 items-center justify-center text-white text-xs">🚚</span>
                  </div>
                )}
                <span className="text-sm font-semibold text-emerald-800">{sp.label}</span>
              </div>
              <span className="text-xs text-emerald-600 font-medium">⏱ {ETA_LABELS[status]}</span>
            </div>
            <div className="flex items-center gap-0.5 mb-1.5">
              {Array.from({ length: sp.total }).map((_, i) => (
                <div key={i} className={`flex-1 h-2 rounded-full transition-all duration-500 ${
                  i < sp.step ? 'bg-emerald-500' : i === sp.step ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-200'
                }`}/>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-emerald-500 mb-2">
              <span>Booked</span><span>Pickup</span><span>Delivery</span>
            </div>
            <p className="text-xs text-emerald-700 leading-relaxed">
              {status === 'driver_en_route' && 'Your driver is on the way to the pickup location.'}
              {status === 'arrived_pickup'  && 'Driver has arrived at pickup and is ready to load.'}
              {status === 'loading'         && 'Items are being carefully loaded. Transit starts soon.'}
              {status === 'in_transit'      && 'Your belongings are on the way to the delivery address!'}
              {status === 'arrived_destination' && 'Driver has arrived. Unloading will begin shortly.'}
              {status === 'unloading'       && 'Your items are being unloaded. Almost done!'}
            </p>
          </div>
        )}

        {/* Driver navigation panel */}
        {mode === 'driver' && isActive && (
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🧭</span>
              <span className="text-sm font-semibold text-blue-800">Quick Navigation</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => openGoogleMaps(pickupAddress, pickupCoords)}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition ${
                  ['driver_en_route','driver_assigned'].includes(status)
                    ? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-700'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}>
                📍 To Pickup ↗
              </button>
              <button onClick={() => openGoogleMaps(deliveryAddress, deliveryCoords)}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition ${
                  ['in_transit','loading'].includes(status)
                    ? 'bg-red-600 text-white shadow-md hover:bg-red-700'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}>
                📍 To Delivery ↗
              </button>
            </div>
          </div>
        )}

        {/* Completed */}
        {status === 'completed' && (
          <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 text-center">
            <div className="text-3xl mb-2">✅</div>
            <p className="font-bold text-emerald-800 text-sm">Delivery Complete</p>
            <p className="text-xs text-emerald-600 mt-0.5">Payment will be released from escrow shortly.</p>
          </div>
        )}
      </div>
    </div>
  );
}
