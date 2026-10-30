# FlyttGo's two front pages

Owner's decision, 2026-10-30.

| Address | Shows |
|---|---|
| `flyttgo.no` (and `www.`) | The **platform front page** (`src/components/PlatformHomePage.tsx`): business tools, the marketplace, white-label sites, industries and moving. Built from the owner's "Stage 20" design (`Open FlyttGo Homepage — Stage 20 (HTML)/index.html`, kept as the reference). |
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
- **Colours and text:** the platform page uses the site's existing colours (emerald, grey, the business pages' navy #1A365D) and is in English and Norwegian (`platformHome` in `src/lib/locales/`).
- **The copy describes only what works today** (owner's decision): quotes are "send a price, the customer accepts"; bookkeeping is vouchers, receipts and MVA codes; year-end documents are SAF-T and næringsspesifikasjon figures for the accountant to check. FlyttGo files nothing for the company.

## Making transport.flyttgo.no live

1. **Database:** apply migration 00027 to production.
2. **Vercel:** in the production project (the one serving flyttgo.no), go to Settings → Domains, add `transport.flyttgo.no` and assign it to production.
3. **DNS at the registrar:** add a CNAME record `transport` → `cname.vercel-dns.com`. If a wildcard `*.flyttgo.no` already points to Vercel, the subdomain is already covered.
4. **Supabase:** in Authentication → URL Configuration, add `https://transport.flyttgo.no/**` to the redirect URLs.
5. **Links from the platform page:** optionally, set `VITE_TRANSPORT_URL=https://transport.flyttgo.no` in the Vercel project and redeploy, so those links open the subdomain. Until then they open `/transport`.
