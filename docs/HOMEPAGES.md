# FlyttGo's two front pages

Owner's decision, 2026-10-30.

| Address | Shows |
|---|---|
| `flyttgo.no` (and `www.`) | The **platform front page** (`src/components/PlatformHomePage.tsx`): the owner's premium design, `docs/flyttgo-premium-platform-homepage-stage-20.html`, as designed (layout, text, colours, pictures, its header and interactive panels), with FlyttGo's own footer. |
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
  - `design.html`: the markup, without scripts and without the design's footer;
  - `design.css`: its styles, scoped under `.fgp` so they change nothing outside the page;
  - `design-scripts.ts`: its menu, tabs and previews.

  After the design changes, run `python3 -I scripts/platform-home/build.py` and commit the result. Never edit the generated files. `app.css` holds the one style the app adds.
- **What the app wires in** (`PlatformHomePage.tsx`):
  - Links that lead to a FlyttGo page carry `data-page` (list in `build.py`): services, booking, business, white label, API, become a driver.
  - Sign in and Get started open the sign-in dialog, or the dashboard once signed in.
  - "Looking for a service?" uses the real address lookup (Kartverket) and hands the addresses and date to the booking flow, as the moving page's widget does. Electrician and home services open `/services`; company logistics open `/business`.
  - In-page links (`#section`) stay as designed.
- **Header and footer:** the page has the design's own header. FlyttGo's header (language switch, notifications, account menu) is on every other page and on the moving page. The footer is FlyttGo's own (owner, 2026-10-30).
- **Language:** the design is in English; a Norwegian version of its text is still to be written.
- **Typefaces:** DM Sans and Manrope load from Google Fonts while this page is shown.

## Making transport.flyttgo.no live

1. **Database:** apply migration 00027 to production.
2. **Vercel:** in the production project (the one serving flyttgo.no), go to Settings → Domains, add `transport.flyttgo.no` and assign it to production.
3. **DNS at the registrar:** add a CNAME record `transport` → `cname.vercel-dns.com`. If a wildcard `*.flyttgo.no` already points to Vercel, the subdomain is already covered.
4. **Supabase:** in Authentication → URL Configuration, add `https://transport.flyttgo.no/**` to the redirect URLs.
5. **Links from the platform page:** optionally, set `VITE_TRANSPORT_URL=https://transport.flyttgo.no` in the Vercel project and redeploy, so those links open the subdomain. Until then they open `/transport`.
