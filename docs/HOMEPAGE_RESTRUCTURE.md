# Homepage restructuring: audit, plan and content-migration map

Owner's brief, 30 October 2026: restructure the homepage into a premium,
enterprise-grade platform site, built in an isolated route first.

- **Route:** the restructured page is `HomeV2Page` (`src/components/homeV2/`) at **`/preview/home`**.
- **Search engines:** the page is marked `noindex` and is in no menu.
- **Not changed:**
  - the live homepage (`HomePage`, today at `flyttgo.no/`);
  - the platform front page of pull request #20 (`PlatformHomePage`);
  - every other page.

---

## Stage A: audit

### What exists today

| Homepage | Where | Sections |
|---|---|---|
| **Live homepage** (`src/components/HomePage.tsx`) | flyttgo.no `/` in production | 1. Hero slider (7 slides, the site's own photographs)<br>2. Booking widget (Kartverket address lookup, move type, date, route distance, estimate, Book Now)<br>3. Trust bar<br>4. Stats (instant, approved, tracked, 24 h)<br>5. Services (6)<br>6. How it works (4 steps)<br>7. Van types (4, with prices per hour)<br>8. Moving tools (3)<br>9. Cities (4)<br>10. Testimonials<br>11. Driver subscription teaser (5 plans)<br>12. Corporate call to action<br>13. Driver call to action |
| **Platform front page of PR #20** (`src/components/PlatformHomePage.tsx`, the owner's Stage 20 design) | Preview only | 35 sections. They include: hero, entry points, booking card, platform overview, business platform, finance blueprint, business workflow, marketplace, white label, white-label blueprint, marketplace network, industries, corporate, corporate benefits, providers, driver plans, driver network, moving services, how it works, van types, moving tools, cities, manifesto, how, metrics, unified platform, visitor journey, next step, financial administration, network experience, white-label builder, business workspace, experience, testimonials, final call to action |

### Repetition in the Stage 20 design

| Topic | Places it appears | What the new page keeps |
|---|---|---|
| The four capabilities | Platform overview, unified platform (pillars), manifesto, "Not four separate products" | One section (3) |
| Business tools | Business platform, business workflow, business workspace (three dashboard-style demos) | One workspace demo (4) |
| Finance | Finance blueprint, financial administration (two finance demos) | One finance workspace (5) |
| White label | White label, white-label blueprint, white-label builder | One Marketplace Studio (7) |
| Network | Marketplace network, network experience | One architecture illustration (8) |
| Journeys and how it works | Entry points, visitor journey, next step, "how", how it works | Journeys (2); the booking journey (11) |
| Drivers | Providers, driver network, driver plans | Summary (11); the details stay on `/driver-subscriptions` and `/become-a-driver` |

### Checked against the code: what is built (status labels on the page)

| Capability | Status | Evidence |
|---|---|---|
| Moving and transport booking, Kartverket addresses, route distance, estimate, Stripe and Vipps payment, tracking | **Available** | `BookingFlow`, `NorwayAddressAutocomplete`, `route-distance`, `create-checkout-session`, `create-vipps-session`, `TrackingPage` |
| Cancellation | **Available** | Free until 24 hours before pickup; within 24 hours, 50% is refunded (locales, `cancel-booking`) |
| Company accounts with roles (owner, admin, booker, finance, viewer, staff) | **Available** | 00005, `organizations` tests |
| Spending limits and approvals | **Available** | 00017, `approval-expiry` job |
| Invoices in the company's own name, EHF, credit notes, reminders | **Available** | 00011, `invoice-run` |
| Bank file import (OCR giro, camt.054), matched by KID | **Available** | 00016 |
| Bookkeeping: vouchers with attachments, MVA codes, SAF-T export, næringsspesifikasjon figures | **Available** (for the accountant's review; nothing is filed) | 00014/00015, `src/accounting` |
| Jobs with quotes (fixed, hourly, quote); appointments; restaurant and hotel reservations; online shop | **Available** | 00012, 00013, 00019, 00020 |
| Branded company site on its own domain; seller model A or B; Stripe Connect for model B | **Available** | 00009/00010, `white-label-domain`, `stripe-connect` |
| Public API and booking widget | **API: paid add-on. Widget: included in every plan.** | 00018, 00022 |
| Separation between companies (row-level security) | **Available**, tested on 46 company tables | Release rehearsal checks |
| An operator marketplace with its **own provider network** (third-party providers onboarded by the operator) | **In development**. Today's white-label sites sell the company's own services or FlyttGo's drivers (models A and B). | `docs/WHITE_LABEL.md` |
| Live dashboards with real figures | **Not shown.** Every demonstration on the page is labelled as an illustration with example data. | — |

---

## Stage B: the new structure

| # | Section | Purpose | Demonstration |
|---|---|---|---|
| 1 | Hero | Headline, one-line positioning, three entry points | The site's own photograph, no interface mock |
| 2 | Choose your journey | Customer, business or marketplace operator: what each gets and where it goes | — |
| 3 | One connected platform | The four capabilities and how they connect | One connected composition |
| 4 | Business operating platform | Services and pricing, customers, bookings, quotes and projects, team, invoices, payments | One workspace with tabs |
| 5 | Financial management | Booking → quote → job completed → invoice → payment → financial record; MVA, SAF-T, næringsspesifikasjon, year-end; the disclaimer | One finance workspace |
| 6 | Marketplace | Five categories, with photographs | — |
| 7 | Build your own marketplace | What the operator owns, with a status for each | One Marketplace Studio |
| 8 | Connected network | Platform, central marketplace, operators, businesses, providers, customers. "Shared infrastructure does not mean shared private data." | One architecture illustration |
| 9 | Industry workflows | Seven industries: booking model, information needed, fulfilment | Selector |
| 10 | Corporate solutions | Bulk booking, multi-user, invoice billing, spending limits and approvals, API, analytics, recurring | One corporate view |
| 11 | Moving and driver network | Services, driver network, vehicle sizes, booking and tracking journey, cancellation, the working booking widget | The real booking widget |
| 12 | Final call to action | "One platform. Many possibilities. Run, connect and grow. Build with FlyttGo." Three routes. | — |

The menu bar and footer are FlyttGo's own, unchanged.

---

## Content-migration map (stage D checks this)

| Detail | Where it lives now | Status |
|---|---|---|
| Driver plans and commission tiers (Free 0; Basic 0; Pro Mini 149/day; Pro 1,500/month; Unlimited 2,449/month; tiers) | `/driver-subscriptions` (`SubscriptionPlans`), linked from 11 | Exists |
| Becoming a driver | `/become-a-driver`, linked from 11 | Exists |
| Vehicle sizes, capacities and hourly rates (850, 1,150, 1,500, 1,900 NOK/hour) | Sizes in 11; full table and rates at `/van-size-guide` | Exists |
| Van size calculator, moving checklist, item guide | `/van-size-guide`, `/moving-checklist`, linked from 11 | Exists |
| The complete moving front page (slider, cities, testimonials) | `/transport` (later transport.flyttgo.no), linked from 11 | Exists |
| Detailed corporate functions | `/business`, `/business/bulk-booking`, `/business/recurring-deliveries`, `/business/invoicing`, `/business/api`, `/business/about-dashboard` | Exist |
| White-label plans, prices and the data processing agreement | `/business/white-label`, `/business/white-label/agreement` | Exist |
| Accounting (the product itself) | `/accounting` | Exists |
| **A finance overview page** | Recommended: `/business/finance`. Until then, section 5 links to `/business/invoicing` and `/accounting`. | **Missing; recommended** |
| **A platform architecture page** | Recommended: `/platform/architecture`. Until then, section 8 carries the principles. | **Missing; recommended** |
| **Industry pages** | Recommended: `/industries/<industry>`. Until then, section 9 links to `/services` and white-label plans. | **Missing; recommended** |
| Stage 20 sections that only repeated others | Consolidated as in the repetition table above | — |
| The financial-administration disclaimer | Section 5, word for word in substance | Kept |
| The cancellation policy and MVA statement | Section 11 | Kept |

No link on the new page points to a page that does not exist. The three missing pages are recommendations only.

---

## Stage C: implementation, upgraded from the design (owner, 2026-10-30)

The page is built from the owner's own Stage 20 design, upgraded, not replaced.

`scripts/platform-home/build.py` (`V2_SECTIONS`) takes the strongest section of each topic from `docs/flyttgo-premium-platform-homepage-stage-20.html`, in the twelve-section order. It writes:

| File | Content |
|---|---|
| `src/components/homeV2/design.v2.html` | The page in English |
| `src/components/homeV2/design.v2.no.html` | The page in Bokmål, from `no.json` |
| `src/components/homeV2/design.v2.css` | The design's styles, scoped under `.fgv2` |

`HomeV2Page.tsx` renders the page with the design's own scripts (its tabs and live previews).

| # | Topic | The design's section kept | Left out as a duplicate |
|---|---|---|---|
| 1 | Hero | Hero (the site's own photograph) | — |
| 2 | Journeys | Entry cards | Visitor journey, next step |
| 3 | Four capabilities | "Not four separate products" (pillars and ecosystem) | Platform overview, manifesto |
| 4 | Business platform | Business workspace | Business platform, business workflow |
| 5 | Finance | Financial administration, with a booking → … → financial record strip added | Finance blueprint |
| 6 | Marketplace | Market cards | — |
| 7 | Own marketplace | White-label builder | White label, white-label blueprint |
| 8 | Network | Network experience, headed "Shared infrastructure does not mean shared private data." | Marketplace network |
| 9 | Industries | Industry experience | — |
| 10 | Corporate | Business operations (features and dashboard), with recurring bookings added and the API marked paid add-on | Corporate benefits |
| 11 | Moving | Moving services; the real booking widget (`BookingCard`); how it works; van cards (rates on the van guide); driver panel; "What every booking includes" (cancellation and MVA) | Providers, driver plans, moving tools, cities (on their pages and `/transport`) |
| 12 | Call to action | Final call to action | Metrics, experience, "how" |

**What the upgrade does:**

- **Wording the code does not support is corrected** (`V2_CLAIMS`): operators' own provider networks are in development; "branded booking site"; the API is a paid add-on.
- **Finance wording stays softened** (`SOFTEN`).
- **In-page links to sections left out** point to the section that now carries the topic (`V2_ANCHORS`).
- **Cards and buttons open real pages:** the design's `LINKS` and the page's `WIRES`.
- **The brief's palette:** forest, evergreen, champagne gold, ivory and soft white, with deep blue for primary actions (`homeV2.css`).
- **The design's network diagram is repaired:** a class it used twice squeezed the cards to 26px, and its grid had three columns for five items. Its text is raised to a readable size.
- **On phones**, the design's wide workspace panels fit.
- **Scripts:** each of the design's scripts runs on its own, so a script for a section left out does no harm.

## Stage D: content checked against the source

| Content | Where it is |
|---|---|
| Cancellation policy ("free until 24 hours before pickup; within 24 hours, 50% is refunded to the card or Vipps you paid with") and "25% MVA included" | Section 11 |
| Vehicle capacities | Section 11, from `VAN_TYPES` |
| Hourly rates | The van size guide (`VanGuide` reads `pricePerHour`), linked |
| Driver plans and commission | `/driver-subscriptions` (`SubscriptionPlans` reads `SUBSCRIPTION_PLANS` and `calculateCommission`), linked |
| The six moving services | Named in section 11 |
| The full moving site, with cities and testimonials | `/transport`, linked |
| The financial disclaimer | Section 5 |
| Corporate functions | Each links to its existing page |
| "In development" label | Operator-owned provider networks only |
| Demonstrations | Each is marked "Illustration · example data" |

## Stage E: tests

| Check | Result |
|---|---|
| Widths 1440, 820 and 390 px | The page fits; no horizontal scroll |
| Headings | One h1 |
| Search engines | Robots tag reads `noindex, nofollow` |
| Pictures | No broken images |
| Console | No script errors. Network errors also seen on `/transport`, so not caused by this page: the map library from unpkg, blocked in the test environment, and `flyttgo_public_identity`. |
| Interactions | Hero scroll, workspace and finance tabs, studio preview and industry selector all work |
| Links | Ten checked; each opens its real page |

## Not done yet

- **Norwegian:** the page is in English for review. Its text sits in the components, ready to move into the locale files for a Norwegian version once the wording is approved.
- **Recommended pages:** the three recommended pages above (finance, platform architecture, industries) are not built.
