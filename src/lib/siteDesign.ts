import { isFlyttgoHost, isProductionHost } from './hosts';

/**
 * Where FlyttGo's new design shows (docs/HOMEPAGE_RESTRUCTURE.md, "One site, one header"): the journeys
 * header (Explore, Logistics & transport, Run your business, For business customers) on every page and the new homepage at
 * `/`. On preview and development addresses it always shows, so the whole new site can be reviewed
 * there. On flyttgo.no it shows once the owner switches the live site (step 4), by setting
 * LIVE_NEW_DESIGN to true; until then the live site keeps its current header and homepage.
 * White-label domains keep their own branded header and are never affected.
 */
export const LIVE_NEW_DESIGN = true;   // switched on by the owner, 31 October 2026 (step 4)

export function newDesign(host: string = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return isFlyttgoHost(host) && (LIVE_NEW_DESIGN || !isProductionHost(host));
}
