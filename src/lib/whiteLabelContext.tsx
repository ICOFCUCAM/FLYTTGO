/** The company page this visit is on, for the whole app (docs/WHITE_LABEL.md). */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { brandTarget, loadSite, type PublicSite } from './whiteLabel';

interface WhiteLabelState { site: PublicSite | null; loading: boolean; refresh: (page?: string | null) => Promise<void> }
const WhiteLabelContext = createContext<WhiteLabelState>({ site: null, loading: false, refresh: async () => {} });

export function WhiteLabelProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<PublicSite | null>(null);
  const [loading, setLoading] = useState(() => brandTarget() !== null);
  const refresh = useCallback(async (page?: string | null) => {
    const target = brandTarget();
    if (!target) { setSite(null); setLoading(false); return; }
    setLoading(true);
    const p = page ?? (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('page') : null);
    setSite(await loadSite(target, p));
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
    const onPop = () => refresh();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [refresh]);
  return <WhiteLabelContext.Provider value={{ site, loading, refresh }}>{children}</WhiteLabelContext.Provider>;
}

export const useWhiteLabel = () => useContext(WhiteLabelContext);
