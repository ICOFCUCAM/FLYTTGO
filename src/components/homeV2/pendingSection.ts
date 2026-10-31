/**
 * A homepage section asked for from another page (the header's section links): the header stores the
 * section and optional tab here and opens the homepage; the homepage scrolls to it once it renders.
 */
export const PENDING_SECTION = 'flyttgo_pending_section';

export function takePendingSection(): { id: string; tab?: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SECTION);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_SECTION);
    const v = JSON.parse(raw) as { id?: unknown; tab?: unknown };
    return typeof v.id === 'string' && /^[a-z0-9-]+$/.test(v.id)
      ? { id: v.id, tab: typeof v.tab === 'string' ? v.tab : undefined } : null;
  } catch { return null; }
}
