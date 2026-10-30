# FlyttGo's two front pages

Owner's decision, 2026-10-30.

| Address | Shows |
|---|---|
| `flyttgo.no` (and `www.`) | The **platform front page** (`src/components/PlatformHomePage.tsx`): the owner's premium design (`docs/flyttgo-premium-platform-homepage-stage-20.html`) with everything the former homepage had. It keeps FlyttGo's menu bar and footer, the slideshow in the hero picture, the booking widget, and the former sections in their places. It is shown in navy, emerald and white. |
| `transport.flyttgo.no` | The **moving and transport front page** (`src/components/HomePage.tsx`), unchanged: price estimate, van types, cities, testimonials, driver and corporate calls to action. |
| `flyttgo.no/transport` | The same moving and transport front page, on the main site. |

## What did not change

- **One app:** the same database, server functions, sign-in, booking, payment, admin and company pages.
- **Every other path works the same on both addresses:** `/book`, `/business`, `/admin` and the rest.
- **The moving and transport page is kept whole:** nothing on it was removed or moved.

## How it works

- **The rule is host-aware:** `src/lib/hosts.ts` lists FlyttGo's own hosts, `transport.flyttgo.no` included, so the app does not treat it as a company's domain. On that host the page `home` renders `HomePage`; elsewhere it renders `PlatformHomePage` (`src/components/AppLayout.tsx`). The page `transport-home` (`/transport`) always renders `HomePage`.
- **The header gains one link:** "Moving & transport", shown everywhere except on the subdomain, where it is the Home link.
- **Search engines see one address per page** (`applyPageMeta()` in `src/lib/pageRoutes.ts`):
  - the moving and transport page: `https://transport.flyttgo.no/`;
  - every other page: on `https://flyttgo.no`.
- **Where its links go:** links from the platform page to the moving page go to `/transport`, which keeps the visitor signed in, until `VITE_TRANSPORT_URL` is set in the Vercel project. After that they go to that address. Sign-in is kept per address by the browser, so a visitor signed in on one address is not signed in on the other.
- **The subdomain is reserved:** every company's page is also `<slug>.flyttgo.no`. Migration `00027` reserves `transport`, `moving` and `flytting` so no company can take them (none had them; rollback `supabase/rollback/00027_down.sql`).
- **The design is the source.** `scripts/platform-home/build.py` turns the design file into `src/components/platformHome/`:
  - `design.html`: the markup, without scripts and without the design's top line, header and footer (FlyttGo's menu bar and footer are used), with the old site's pictures and the booking card moved between the hero and the first section, holding the old booking widget;
  - `design.css`: its styles, scoped under `.fgp` so they change nothing outside the page, and recoloured (`recolour()`): dark greens to navy, golds and mid greens to emerald, ivory to white. `app.css` pins the main colours to the site's exact values: navy #1A365D, its hover #2D4A7A, emerald #059669, white;
  - `design-scripts.ts`: its menu, tabs and previews.

  After the design changes, run `python3 -I scripts/platform-home/build.py` and commit the result. Never edit the generated files. `app.css` holds the one style the app adds.
- **The old site's functions wired in beneath the design** (owner, 2026-10-30): the design looks as designed, with its own cards. Nothing of the old homepage is stacked on it; its functions run inside the design's elements:

  | Design element | Old function inside it |
  |---|---|
  | Header | FlyttGo's own menu bar (the old site's container: top strip with phone and EN/NO, main bar with all the old items, Book Now, Sign In and Sign Up) in place of the design's header. On this page it adds a Platform dropdown with the design's menu items (each scrolls to its section) and its corners are square (`.fg-square`). |
  | Hero picture | The old site's slideshow (`HERO_SLIDES`). |
  | Booking card (moved between the hero and the first section) | The old booking widget (`BookingCard`), looking like the old one (navy header, white body, navy Get Estimate, emerald Book Now, its height) at the design's full width with square corners. Pickup and delivery use the Kartverket address lookup; move type, moving date, route distance, Get Estimate (`estimateMovePrice()`, shared with the old widget) and Book Now hand everything to the booking flow. It replaces the design's own form. |
  | Van types, driver plans | Prices from `VAN_TYPES` and `SUBSCRIPTION_PLANS`. Van cards book that van; plans open driver subscriptions. |
  | Services, cities, how it works | Open booking; the fourth step opens tracking. |
  | Moving tools | Open the van size guide and the moving checklist. |
  | Corporate benefits | Open bulk booking, recurring deliveries, the company dashboard, invoicing, API access and the corporate dashboard. |
  | Driver panel, provider and other buttons | Open their real pages (`LINKS` in `build.py`, `WIRES` in the page). |

  The design's seven stock photos are replaced by the old site's own pictures (`PICTURES` in `build.py`).
- **What the app wires in** (`PlatformHomePage.tsx`):
  - Links that lead to a FlyttGo page carry `data-page` (list in `build.py`): services, booking, business, white label, API, become a driver.
  - In-page links (`#section`) stay as designed.
- **Header and footer:** FlyttGo's menu bar with the Platform dropdown (above) and FlyttGo's footer (owner, 2026-10-30).
- **Language:** English and Bokmål, following the site's language. The menu bar's EN/NO switch changes it.
  - Every English text of the page maps to its Bokmål in `scripts/platform-home/no.json`. `build.py --strings` lists what to translate (`strings.json`).
  - The build writes `design.no.html` and `design-scripts.no.ts`, and fails while any text lacks a translation.
- **Finance wording is softened** to what FlyttGo does today (owner, 2026-10-30; `SOFTEN` in `build.py`): vouchers, receipts and MVA codes in a ledger, SAF-T export and næringsspesifikasjon figures for the accountant. FlyttGo gives no tax advice and files no returns. "Tax preparation" reads "Year-end documents". The design file itself is unchanged.
- **Phones:** the design's own file is wider than a phone screen (its business workspace and finance panels). `app.css` lets those panels' tab rows scroll inside their box and their columns stack, so the page fits; nothing is hidden.
- **The phone layout** keeps the design's floating "Your business. Your brand." card where the design puts it (owner, 2026-10-30).
- **Typefaces:** DM Sans and Manrope load from Google Fonts while this page is shown.

## Making transport.flyttgo.no live

1. **Database:** apply migration 00027 to production.
2. **Vercel:** in the production project (the one serving flyttgo.no), go to Settings → Domains, add `transport.flyttgo.no` and assign it to production.
3. **DNS at the registrar:** add a CNAME record `transport` → `cname.vercel-dns.com`. If a wildcard `*.flyttgo.no` already points to Vercel, the subdomain is already covered.
4. **Supabase:** in Authentication → URL Configuration, add `https://transport.flyttgo.no/**` to the redirect URLs.
5. **Links from the platform page:** optionally, set `VITE_TRANSPORT_URL=https://transport.flyttgo.no` in the Vercel project and redeploy, so those links open the subdomain. Until then they open `/transport`.
