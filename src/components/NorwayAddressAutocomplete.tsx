import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ─────────────────────────────────────────────
   TYPES
───────────────────────────────────────────── */

export interface NorwegianAddress {
  street_name: string;
  house_number: string;
  postcode: string;
  city: string;
  country: 'Norway';
  lat: number | null;
  lng: number | null;
  formatted: string; // "Karl Johans gate 12, 0154 Oslo"
}

interface KartverketResult {
  adressetekst: string;         // "Karl Johans gate 12"
  adressenavn: string;          // "Karl Johans gate"
  nummer: number;               // 12
  bokstav?: string;             // "A" (optional)
  postnummer: string;           // "0154"
  poststed: string;             // "OSLO"
  representasjonspunkt?: {
    lat: number;
    lon: number;
  };
}

interface KartverketResponse {
  adresser: KartverketResult[];
}

interface Props {
  value: string;
  onSelect: (address: NorwegianAddress) => void;
  placeholder?: string;
  label?: string;
  id?: string;
  required?: boolean;
  error?: string;
  className?: string;
}

/* ─────────────────────────────────────────────
   HELPER: highlight matching text
───────────────────────────────────────────── */

function highlightMatch(text: string, query: string) {
  if (!query || query.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-900 rounded-sm font-semibold">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */

export default function NorwayAddressAutocomplete({
  value,
  onSelect,
  placeholder = 'Search Norwegian address…',
  label,
  id = 'address',
  required = false,
  error,
  className = '',
}: Props) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState<KartverketResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selected, setSelected] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Sync external value changes */
  useEffect(() => {
    if (value !== query) setQuery(value);
  }, [value]);

  /* Click outside closes dropdown */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── FETCH from Kartverket ── */
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    setApiError(false);

    try {
      const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(q)}&treffPerSide=8&utkoordsys=4258`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

      if (!res.ok) throw new Error('Kartverket API error');

      const data: KartverketResponse = await res.json();
      setSuggestions(data.adresser || []);
      setOpen((data.adresser?.length || 0) > 0);
    } catch (err) {
      /* FAILSAFE: silently log, never block booking */
      console.warn('[NorwayAddressAutocomplete] Kartverket unavailable — manual entry enabled:', err);
      setApiError(true);
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  /* Debounce input changes */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelected(false);
    setActiveIdx(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  /* ── SELECT suggestion ── */
  const handleSelect = (result: KartverketResult) => {
    const houseNumber = result.nummer
      ? `${result.nummer}${result.bokstav || ''}`
      : '';
    const city = result.poststed
      ? result.poststed.charAt(0).toUpperCase() + result.poststed.slice(1).toLowerCase()
      : '';
    const formatted = `${result.adressetekst}, ${result.postnummer} ${city}`;

    const address: NorwegianAddress = {
      street_name: result.adressenavn || '',
      house_number: houseNumber,
      postcode: result.postnummer || '',
      city,
      country: 'Norway',
      lat: result.representasjonspunkt?.lat ?? null,
      lng: result.representasjonspunkt?.lon ?? null,
      formatted,
    };

    setQuery(formatted);
    setSelected(true);
    setOpen(false);
    setSuggestions([]);
    setActiveIdx(-1);
    onSelect(address);
  };

  /* ── KEYBOARD navigation ── */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        handleSelect(suggestions[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  /* ── VALIDATION state ── */
  const hasError = !!error;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        {/* Search icon */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {loading ? (
            <svg className="w-4 h-4 text-gray-400 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
        </div>

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && !selected) setOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full pl-10 pr-10 py-3 border rounded-xl text-sm outline-none transition-all
            ${hasError
              ? 'border-red-400 focus:ring-2 focus:ring-red-300 bg-red-50'
              : selected
                ? 'border-green-400 focus:ring-2 focus:ring-green-200 bg-green-50/30'
                : 'border-gray-200 focus:ring-2 focus:ring-[#0B2E59]/20 focus:border-[#0B2E59]/40 bg-white'
            }`}
        />

        {/* Status indicator — verified/manual */}
        {query.length > 0 && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {selected ? (
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              query.length >= 3 && !loading && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); setSelected(false); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Inline error */}
      {hasError && (
        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5C3.498 18.333 4.46 20 6 20z" />
          </svg>
          {error}
        </p>
      )}

      {/* API unavailable — silent fallback note (very subtle) */}
      {apiError && query.length >= 3 && !selected && (
        <p className="mt-1 text-xs text-amber-600">
          Address lookup unavailable — you can type your address manually.
        </p>
      )}

      {/* Verified badge */}
      {selected && !hasError && (
        <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Verified Norwegian address
        </p>
      )}

      {/* ── DROPDOWN ── */}
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-400 font-medium">Kartverket — Official Norwegian Register</span>
            <img
              src="https://www.kartverket.no/Content/Images/kartverket-logo-100.png"
              alt="Kartverket"
              className="h-4 opacity-60"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {suggestions.map((result, idx) => {
              const city = result.poststed
                ? result.poststed.charAt(0).toUpperCase() + result.poststed.slice(1).toLowerCase()
                : '';
              const line1 = result.adressetekst;
              const line2 = `${result.postnummer} ${city}`;
              const isActive = idx === activeIdx;

              return (
                <li key={`${line1}-${line2}-${idx}`}>
                  <button
                    type="button"
                    onMouseDown={() => handleSelect(result)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                      isActive ? 'bg-[#0B2E59]/5' : 'hover:bg-gray-50'
                    }`}
                  >
                    <svg className="w-4 h-4 text-[#0B2E59]/50 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    <div>
                      <div className="text-sm text-gray-800 font-medium">
                        {highlightMatch(line1, query)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {highlightMatch(line2, query)} · Norway
                      </div>
                    </div>
                    {result.representasjonspunkt && (
                      <div className="ml-auto text-[10px] text-gray-300 font-mono hidden lg:block">
                        {result.representasjonspunkt.lat.toFixed(4)}, {result.representasjonspunkt.lon.toFixed(4)}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50">
            <p className="text-[10px] text-gray-400">Powered by Kartverket · Norwegian Mapping Authority</p>
          </div>
        </div>
      )}
    </div>
  );
}
