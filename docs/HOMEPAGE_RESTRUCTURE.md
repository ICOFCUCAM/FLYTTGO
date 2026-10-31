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
| 1 | Hero | Hero (the site's own photograph): the owner's headline, "Assisting Companies to Fly High. / Own your marketplace.", across the full width, with the brief's three entry points (Find a service, Run a business, Build a marketplace) | — |
| 2 | Journeys | Entry cards in the owner's words: Find a Service (customers), My Company (businesses) and Create a Marketplace (operators), each saying who it is for. Managing your own providers is marked in development. | Visitor journey, next step |
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

### The three journeys and the menu (owner, 2026-10-30)

- **Order of the page:** the sections follow the journeys. Find a service comes first: the FlyttGo Marketplace, moving services with the booking widget, how it works and vehicle sizes. My Company comes next: the platform, business workspace, payments and finance, and industries. For Organisations follows: corporate solutions and the provider network. The specialised offering comes last: a marketplace under one's own brand, and the connected network.
- **The central marketplace and white label are kept apart.** The FlyttGo Marketplace is named as such. The white-label section opens with "Separate from the FlyttGo Marketplace, and not needed to use FlyttGo or its business tools".
- **No requirement to own a marketplace:** the hero introduction, the entry heading, the My Company card, the business workspace and the menu each say that a company uses the business tools and takes part in the FlyttGo Marketplace without a marketplace of its own.
- **Hero and entry cards:**
  - The hero has two buttons, Find a service and Manage my business. Marketplace creation is a quiet text link after them.
  - In the entry section, Find a Service and My Company sit side by side. Create a Marketplace is a quieter full-width strip below them, labelled "Specialised offering · White label". Type sizes are unchanged.
- **Menu** (`Header.tsx`, only on `/preview/home`): Explore, My Company, For Organisations, Become a Driver, Book Now, Sign in and Get started. Labels stay on one line from 1024 px.
  - Explore holds Services, Moving, Transport and Local services, plus the Moving Tools group.
  - My Company holds Business workspace, Business tools and Payments and finance, with the "no marketplace of your own needed" note.
  - For Organisations holds Corporate solutions and Provider network, plus the Companies links group. Create a marketplace sits apart at its foot as a specialised offering.
  - No item of the earlier menu bar is lost. The logo leads home. On every other page the menu bar is unchanged.
- **The headline is the owner's own words:** "Assisting Companies to Fly High. Run your company." It sits in the hero's left column and is sized to it: "Assisting Companies" runs the full width of the column, with the picture beside it for the full height.

### Upgrades kept from the platform page, and the readability audit (owner, 2026-10-30)

- **Hero slideshow:** the hero picture plays the former homepage's slides (`HERO_SLIDES`), crossfading with dots, as on the platform page. It is one shared component, `platformHome/HeroSlides.tsx`, used by both pages. It stays still under reduced motion.
- **Booking widget:** it sits between the hero and the first section, at full width, and the design's `#booking` links lead to it.
- **Readability:** every text on the page was measured against its ground, needing 4.5:1, or 3:1 for large text. The first pass found 167 failures; there are none now.
  - Words on photographs cannot be measured that way. The hero caption and the marketplace cards were checked by eye and given a deeper veil.
  - `build.py` (`readable_css`) darkens pale text on light grounds in its own hue and raises text under 11px to 11px.
  - `homeV2.css` corrects what that pass cannot see:
    - gold labels on dark green panels stay light;
    - the driver panel's button, previously dark on dark, now reads "Become a driver";
    - the "What every booking includes" cards are white, where they had no ground of their own and showed the grid's grey;
    - the hero's floating card no longer covers the caption.

### Integrated platform experience (owner, 2026-10-30)

**Colours.** In order, the owner rejected the brief's gold, emerald all over the page, navy with blue, architectpro.co's indigo and lavender, and near-black with violet. The second-pass art-direction brief returns to the established palette, each colour with one job. The failures before were gold and green used as text and fills.
- **Ivory `#F5F3EB` and soft white `#FFFEFA`:** every ground. Sections alternate between them, divided by one warm hairline, so the page stays light.
- **Deep blue `#203F68`:** headings, primary actions, labels and the few dark panels.
- **Forest `#24513B` and evergreen `#20352B`:** positive signals only: available, approved, Book Now, ticks.
- **Champagne gold `#C3A66C`:** hairlines, connectors and numerals. It appears as text only on deep blue, lightened to `#DCC9A0`. `readable_css` turns any gold text on a light ground into deep blue.
- `build.py` recolours the design with `PALETTES['brand']`. The platform page keeps `PALETTES['emerald']` and is unchanged.
- Text on light grounds is darkened to 7:1; the minimum is 4.5:1.

**What changed on the page:**
- **Hero:**
  - The supporting message is the owner's: "Discover services, run your company and connect with a wider business network — all through one connected FlyttGo platform."
  - Three actions: Explore services, My Company and For Organisations.
  - The headline is still the owner's earlier choice, "Assisting Companies to Fly High. Run your company." The brief's recommended "One platform. More ways to grow." is not used yet.
- **Journeys:** Find a Service, My Company and For Organisations are three equal cards. The third lists corporate solutions, the provider network and marketplace infrastructure, the last marked optional.
- **One connected platform:**
  - It shows four capabilities around the platform core, with the provider and business network as the layer that joins them; white-label infrastructure is labelled "build · optional".
  - The lifecycle is Discover → Request → Quote → Book → Deliver → Invoice → Pay → Record.
- **How FlyttGo works** (new, `#how-flyttgo-works`):
  - the lifecycle;
  - how each journey connects;
  - one business's path from registration to a recorded payment;
  - a status beside every capability.
- **Related links** at the foot of six sections lead between related capabilities. The local services card leads to the industry workflows, not to the moving services page.

**Menu** (`Header.tsx`, only on `/preview/home`): Explore, My Company, For Organisations, How it works, Become a Driver, Book Now, Sign in and Get started. Every earlier item is kept.
- **Explore:** the five service groups, plus the moving tools.
- **My Company:** ten items, each opening the matching tab of the business or finance workspace on the page.
- **For Organisations:** three groups. Corporate solutions links the existing corporate pages. Provider network covers drivers, provider plans and opportunities. Marketplace infrastructure is marked optional.
- **Get started** opens the existing sign-up, which asks first whether the visitor is a customer, a driver or a business.

**Status shown on the page.** Sources: `docs/PLATFORM_AUDIT_2026-10-30.md`, `SERVICE_PLATFORM.md`.

| Capability | Status |
|---|---|
| Moving and transport booking and tracking; driver network and plans | Available |
| Company accounts, teams, jobs, appointments, invoices in the company's name | Available |
| Company bookings, multiple users, corporate invoicing | Available |
| Branded booking pages (`/b/<slug>`) | Available |
| Accounting add-on | In development (authorised accountant's review) |
| Operator-managed provider networks | In development |
| Other businesses and categories in the central FlyttGo Marketplace; providers other than drivers | Planned |
| Workspace, finance, studio, network and industry screens | Illustrative (marked on the page) |

### Second-pass art direction (owner, 2026-10-30)

A visual upgrade of the same structure: the three journeys, the four capabilities and white label as a specialised offering are kept.

- **System:**
  - One type scale: display headings 36–62 px, introductions 16 px, small print 14–15 px, labels 11 px.
  - One section rhythm, 84–132 px.
  - Square surfaces with one warm hairline; product mockups lift with a single soft shadow.
  - Deep-blue primary and outlined secondary buttons, and a visible gold focus ring.
  - One motif: the hero's curved top-right corner on every dark panel, and a gold hairline before every label.
- **Hero:**
  - The owner's "Assisting Companies to Fly High." stays, with "Find services. Run your company. Grow." in the serif line.
  - The slideshow stays. The floating card and the index label are gone. The three journeys run as a deep-blue band at the foot of the picture.
  - Explore services and My Company are buttons; For Organisations is a quieter text link.
- **Journeys:** Explore (deep blue) and My Company (soft white) side by side. For Organisations is a strip across both, with its three options and marketplace infrastructure marked optional.
- **One connected platform:**
  - Four capabilities around the FlyttGo platform core, tied to it by gold hairlines.
  - The provider and business network is the layer that joins them, inside the core, not a fifth product.
  - White label is "04 / build · optional".
- **Marketplace:** a Browse row of categories above the editorial gallery, with "More categories open as businesses join." beside it.
- **Moving and transport:**
  - Labelled "A FlyttGo vertical".
  - Eight services: move-out cleaning and packing and assembly join them. Both are booking extras (`constants.ts`).
  - The van note says rates are on the van size guide.
- **Corporate:** the made-up figures and growth curve are removed. The demonstration shows bookings awaiting approval under a booker's spending limit, roles and permissions, and one monthly invoice, all marked as example data.
- **Provider network:** told as part of the ecosystem (same business tools and records); plans stay on their own page.
- **Marketplace Studio:** says provider onboarding is in development.
- **Network model:** three plain tiers a business owner can read: identities, shared infrastructure, then supply and demand. The connector labels are removed.
- **The two flagship demonstrations** (`demoRecords.ts`, preview only): one example company's records.
  - **Business workspace:** each tab shows a table of records (today's schedule, customers, services and prices, jobs, quotes, invoices, records, team) with status chips.
  - **Financial workspace:** an invoice with line items, 25 % MVA, a KID and the total due; a quote; matched payments; expenses with receipts; the year-end export (preparation only); a monthly report.
  - Everything is marked "example data" and amounts belong to the example company. The design's own script, shared with the platform page, is not changed: these render after it on the same tabs.
- **Pictures:** one treatment with a deep-blue veil. The cleaning card uses the design's own living-room photograph (Unsplash licence); every other picture is FlyttGo's own.

### Refinement pass (owner's critique, 2026-10-30)

A refinement of the existing page, not a redesign. The structure, journeys, interactions and availability labels are unchanged.

- **Hero:** "Assisting Companies to Fly High." stays as the signature. Beneath it, smaller, sits "One connected platform for services, business operations and growth." Every slide gets one colour grade.
- **Booking:** framed below the hero, introduced by "Start with a service". The widget is unchanged.
- **Journeys:** shorter cards, each with its own coloured rule: gold for Explore, forest for My Company, deep blue for For Organisations. For Organisations is a panel beneath the two main routes.
- **Platform:** the core with the four capabilities and their detail, then one sentence on ownership and boundaries. The lifecycle, the boundary panel and the principles row are removed here; the lifecycle appears once, in How FlyttGo works.
- **How FlyttGo works:** the lifecycle as a process line. The six journeys are an editorial list under hairlines, not boxes. The example business path is framed.
- **Order:** "What every booking includes" moves into the moving vertical.
- **Business workspace:** the example company and the signed-in person in the sidebar.
- **Financial workspace:** its own identity. An evergreen title bar, the lifecycle timeline after the introduction and above the workspace, tabular figures, and an evergreen total.
- **Industries:** the selector is a row of buttons, with the selected industry in deep blue. Its text is at the page's type size.
- **Marketplace:** one grade on every picture, restrained veils and a slow hover.
- **Studio:** a wider settings column that adds the domain, the provider network (in development) and the payment model.
- **Curved corner:** used only on the hero picture, the platform core and the provider panel.

**Code:**
- `homeV2.css` is rewritten as one ordered layer: one block per component, with its tablet and phone rules beside it, and no appended overrides. The hero breakpoints follow the design's own: it stacks below 760 px.
- `build.py` gained `dedupe_css`. In the generated `design.v2.css` it removes declarations that a later rule for the same selector, in the same scope, overrides. That takes the file from 4,322 to 3,830 declarations and from 1,562 to 1,441 rules; hero rules go from 69 to 47.
- Rules stay in place, so the page is pixel-identical before and after at 1440, 820 and 390 px. Checked with full-page screenshots.

### 2036 premium mandate: audit of the code as it stands (2026-10-31)

Read from the code on `main` after #21: `HomeV2Page.tsx`, the generated `design.v2(.no).html` and
`design.v2.css`, `homeV2.css`, `design.config.ts`, `studioPreview.ts`, `demoRecords.ts`, `lab/` and `build.py`.
Visual findings come from browser screenshots at 1440 and 390 px taken during #21.

**Preserve.** These work and stay:
- **Journeys:** customers, My Company and Organisations as three distinct ways in.
- **Palette:** six colours with fixed roles.
- **One example job:** the trail leads into the finance explorer, with a real NS 4102 voucher.
- **Booking widget:** the real one, under the hero.
- **Translation:** the EN/NO build fails when a string is missing.
- **Design source:** the token and variant source in `design.config.ts`.
- **Isolation:** the production homepage untouched; the lab refuses production hosts.

**Ordinary, not yet distinctive.**
- **Type:** headings use one grotesk (Manrope, tracked to −0.045em), the common SaaS voice. The italic second line of every heading is the design's fallback `Georgia`, not a chosen face.
- **Headline:** it is a slogan. "Assisting Companies to Fly High" says how FlyttGo feels, not what it does; the visitor needs the proposition line to understand the product.
- **Motif:** the only motif is the curved corner.

**Repetitive.**
- **Section heads:** about fourteen use the same arrangement: eyebrow, then a two-line heading with an italic second line, then a paragraph to the right.
- **Wording:** six headings or eyebrows said "one platform" or "connected platform".
- **Frames:** every product demonstration sits in the same frame with a title bar.
- **Related links:** the related-link row repeats on six sections.

**Needs stronger art direction.**
- **Photography:** it is a collection, not a direction: FlyttGo vehicles, interiors and stock scenes. They are united only by a colour grade.
- **Section grounds:** they simply alternate between white and ivory, so the page has no rhythm of emphasis.

**Demonstrations that need more realism.**
- **Business workspace:** no toolbar, date, search or team activity, so it reads as tables in a frame. Appointments and jobs are not told apart.
- **Studio:** the storefront is a single hero and category tiles; the brand mark is small. It does not say which parts are available, illustrative or in development.

**Typography, spacing, imagery, colour, composition and motion.**
- **Headings:** the tracking is heavy at large sizes.
- **Labels:** 11 px uppercase labels are used very widely.
- **Composition:** almost every section is a centred wrap with the same internal rhythm.
- **Motion:** a single entrance pattern, with no control of intensity.

**Technical weaknesses that limit refinement.**
- **Variants:** only six sections have composition variants.
- **Typography:** families and leading are fixed in CSS.
- **Lab measurements:** overflow and smallest text only. No version history, promotion or restore, no synchronised scrolling, no interaction check.
- **CSS:** the generated `design.v2.css` (1,441 rules) still sets values that `homeV2.css` must override.

**Greatest impact, in order.**
1. A hero that says what FlyttGo does, chosen from three real directions.
2. A typographic identity: a chosen editorial serif beside the grotesk.
3. Section compositions that differ by purpose.
4. The business workspace as a convincing product.
5. A refinement studio that makes these choices measurable.

### 2036 mandate: design lab, competing directions, signature demonstrations (owner, 2026-10-30)

**Design settings in one place.** `src/components/homeV2/design.config.ts` holds the tokens (six palette colours, heading, hero and spacing scales, content width, corner radius, signature corner, shadow depth, photo saturation and warmth) and the composition variant of each key section. `applyDesign()` writes tokens as custom properties and variants as data attributes on `.fgv2`; `homeV2.css` reads nothing else. `HomeV2Page` applies the selected defaults.

**Design Refinement Lab** at `/preview/lab` (`homeV2/lab/DesignLab.tsx`):
- **Isolation:** private to preview and development hosts. It refuses to open on `flyttgo.no`, `www.flyttgo.no` and `transport.flyttgo.no` (`isProductionHost()`), carries `noindex`, is linked from nowhere, and shows no menu bar or footer.
- **What it frames:** the real `/preview/home?lab=1`, one to three times at an identical viewport (1440, 1280, 820 or 390). Each frame has its own section variants; the colour pickers and sliders apply to every frame. The preview accepts settings only from a framing page of the same origin, and never on a production host.
- **Inspection:** each frame reports back anything wider than the viewport and its smallest text. The Responsive check shows frame A at all four viewports and marks a harmed one in red. "Show section" scrolls every frame to the same section.
- **Components tab:** the shared pieces (contrast table, type, buttons, status chips, job trail, transaction explorer, related links) drawn with the page's stylesheets and the trial tokens.
- **Decisions tab:** records a choice with its reason from the open frames. Settings are kept in this browser; Export JSON downloads them with the reviewed record in `lab/decisions.ts`.

**Competition.** The hero and five sections each have three materially different directions, compared at 1440 × 900 and 390 × 844. The reasons are in `lab/decisions.ts`:

| Section | Directions | Selected |
|---|---|---|
| Hero | Editorial split, full-bleed photograph, typographic statement | **B, full-bleed photograph** |
| Journeys | Two routes and a panel, editorial index, three equal columns | **A** |
| Marketplace | One dominant picture, film strip, catalogue rows | **A** |
| Business workspace | Framed on ivory, deep-blue stage, centred and wider | **B, deep-blue stage** |
| Financial workspace | Evergreen title bar, paper ledger, evergreen ground | **A** |
| Marketplace Studio | Settings beside, storefront first, settings as toolbar | **A** |

The losing directions stay selectable in the lab. The defects the comparison found in them were fixed: unreadable text in catalogue rows and in the editorial index, and a light note on the evergreen ground.

**Hero.** Three typographic levels: the brand phrase; the proposition as a quieter sans line; then the actions. The photograph runs edge to edge with the slideshow. The ivory card always ends above the journeys band, which runs under the picture into the booking widget.

**One example job across both workspaces.** All of the example company's records now tell one story: A. Berg's leak repair.
- **Business workspace:** the repair was finished yesterday and invoice 1042 has been sent. Its rows are highlighted and focusable. A trail under the records shows Enquiry → Booked → Completed → Invoice 1042 → Payment (awaiting, KID). "See it in finance →" moves to the financial workspace.
- **Financial workspace, Overview:** a transaction explorer follows the same job through Work completed → Invoice → Payment → Voucher → Financial record → Reporting.
  - The voucher posts debit 1500 receivables NOK 3 412,50, credit 3000 sales NOK 2 730,00 and credit 2700 output MVA NOK 682,50 (NS 4102).
  - The record keeps "Subject to your accountant's review".
  - Everything is marked example, in English and Norwegian.

**Marketplace Studio.** The storefront now also follows:
- the secondary colour;
- the brand mark (initials, monogram or name only);
- the domain (`name.flyttgo.no` or an own `.no`), which follows the name until it is edited;
- which categories show;
- the storefront style (classic, editorial or compact);
- the booking and payment model (you sell, or FlyttGo sells moving and delivery).

Provider networks stay "In development". Nothing is created, connected or charged.

**Corporate:** roles, departments and locations; booking within a limit; and reporting with the API as a paid add-on. No figures are shown.

**Order:** follows the commercial order:
1. Hero and booking
2. Journeys
3. Marketplace
4. Moving
5. My Company
6. Finance
7. Industries
8. Connected platform and how it works
9. Corporate
10. Providers
11. White-label
12. Network
13. Closing, with the three journeys

**Motion:** sections rise in once as they enter, photographs reveal top to bottom, the hero copy staggers, workspace and finance panels fade between tabs, the trail steps in order, and cards lift on hover. Motion is off under `prefers-reduced-motion` and when the lab's Motion is Off. Everything stays keyboard operable.

**Build:**
- Images below the hero load lazily.
- Norwegian text inputs now start translated (the studio copies them into its preview). This applies to the restructured page only, so the platform page's output is unchanged.

**Check script:** `scripts/platform-home/visual-check.cjs` runs against a served build:
- full-page screenshots at 1440, 1280, 820 and 390, compared with a local baseline (`.visual-check/`, not committed);
- overflow, smallest text, slideshow, booking widget and console errors at each width;
- the job trail into finance, all six explorer documents, the voucher's accounts, every studio control, and the lab.

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
| Widths 1440, 1280, 1024, 820 and 390 px | The page fits; no horizontal scroll (`visual-check.cjs`) |
| Headings | One h1 |
| Search engines | Robots tag reads `noindex, nofollow` |
| Pictures | No broken images |
| Console | No script errors. Network errors also seen on `/transport`, so not caused by this page: the map library from unpkg, blocked in the test environment, and `flyttgo_public_identity`. |
| Interactions | Hero scroll, workspace and finance tabs, studio preview and industry selector all work |
| Links | Ten checked; each opens its real page |
| Menu | Every item of Explore, My Company and For Organisations opens its page, section or workspace tab (34 items checked); the bar fits from 1024 px |
| Contrast | Every text at 4.5:1 (3:1 large) on its ground; smallest text 11 px; words on photographs on a veil |
| Slideshow and booking widget | Six slides advance; the widget sits under the hero at 1440, 1280, 820 and 390 px |
| Demonstrations | Trail to finance, six explorer documents, voucher accounts and every studio control (`visual-check.cjs`) |
| Design lab | Opens on preview hosts, refuses production hosts (unit test), `noindex`, frames report back, compare and components work |

## Not done yet

- **Recommended pages:** the three recommended pages above (finance, platform architecture, industries) are not built.
