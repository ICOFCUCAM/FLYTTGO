/**
 * A booking in progress, kept in this browser tab while the visitor is not signed in (owner, 31 October 2026).
 * Signing in with Google or Apple leaves the page and comes back through /auth/callback; without this the
 * quote and everything typed were lost and the customer landed on the dashboard. sessionStorage only: it
 * belongs to this tab, ends when the tab closes, and the draft is dropped after two hours or once used.
 */
const DRAFT = 'flyttgo_booking_draft';
const RETURN = 'flyttgo_return_page';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function saveBookingDraft(draft: Record<string, unknown>) {
  try { sessionStorage.setItem(DRAFT, JSON.stringify({ savedAt: Date.now(), draft })); } catch { /* storage blocked */ }
}

/** The saved draft, if one is fresh; it stays saved until clearBookingDraft(). */
export function readBookingDraft<T = Record<string, unknown>>(now = Date.now()): T | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null') as { savedAt: number; draft: T } | null;
    if (!v || typeof v.savedAt !== 'number' || now - v.savedAt > MAX_AGE_MS) return null;
    return v.draft;
  } catch { return null; }
}

export function clearBookingDraft() {
  try { sessionStorage.removeItem(DRAFT); sessionStorage.removeItem(RETURN); } catch { /* storage blocked */ }
}

/** Ask the sign-in callback to come back to the booking. */
export function returnToBookingAfterSignIn() {
  try { sessionStorage.setItem(RETURN, 'booking'); } catch { /* storage blocked */ }
}

/** Where the sign-in callback should go back to (read once), or null. */
export function takeReturnPage(): 'booking' | null {
  try {
    const v = sessionStorage.getItem(RETURN);
    sessionStorage.removeItem(RETURN);
    return v === 'booking' && readBookingDraft() ? 'booking' : null;
  } catch { return null; }
}
