#!/usr/bin/env python3
"""
Turns the owner's homepage design into the app's platform front page
(docs/HOMEPAGES.md). Run from the repository root after the design changes:

    python3 -I scripts/platform-home/build.py

Reads  docs/flyttgo-premium-platform-homepage-stage-20.html  (kept unchanged)
Writes src/components/platformHome/design.html   the page's markup, without scripts,
                                                  with its actions wired to app pages
       src/components/platformHome/design.css    its styles, scoped under .fgp so they
                                                  touch nothing outside the page
       src/components/platformHome/design-scripts.ts  its scripts, as initDesign()

The design's text, layout and colours are not changed; its footer is left
out, as the page has FlyttGo's own footer (owner, 2026-10-30). Links that lead to a
FlyttGo page get data-page="<page id>" (src/lib/pageRoutes.ts); the app
handles them. In-page links (#section) stay as they are.
"""
import html as htmlmod
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'docs' / 'flyttgo-premium-platform-homepage-stage-20.html'
OUT = ROOT / 'src' / 'components' / 'platformHome'

# (link text as shown, its href in the design) -> app page. Everything not
# listed keeps its in-page link. 'auth:signin' / 'auth:signup' open the
# sign-in dialog (the dashboard once signed in).
LINKS = {
    ('Sign in', '#booking'): 'auth:signin',
    ('Get started ↗', '#booking'): 'auth:signup',
    ('Explore your platform options ↗', '#business-platform'): 'white-label',
    ('Explore corporate FlyttGo ↗', '#corporate-benefits'): 'corporate',
    ('Become a FlyttGo provider ↗', '#driver-network'): 'driver-onboarding',
    ('Join the ecosystem', '#providers'): 'driver-onboarding',
    # The design's footer is not used: the page has FlyttGo's own footer
    # (owner, 2026-10-30), with its links, newsletter and company details.
}
# The marketplace cards (their text starts with the number and title).
CARD_PREFIX = {
    '↗01 / Moving & relocation': 'booking',
    '↗02 / Transport & delivery': 'booking',
    '↗03 / Local services': 'services',
    '↗04 / Hospitality': 'white-label',
    '↗05 / Commerce': 'white-label',
}


# Finance wording softened to what FlyttGo does today (owner, 2026-10-30):
# vouchers, receipts and MVA codes in a ledger, SAF-T export and
# næringsspesifikasjon figures for the accountant; FlyttGo files nothing.
# Applied to the design's text before the page is generated; the design file
# itself is unchanged. Each must be found exactly once.
SOFTEN = [
    ('<h3>Tax &amp; financial records</h3><p>Calculate tax estimates and prepare organised financial summaries and tax documentation, subject to local rules and integrations.</p>',
     '<h3>MVA &amp; financial records</h3><p>Keep vouchers, receipts and MVA codes in one ledger, and export SAF-T and næringsspesifikasjon figures for your accountant to check.</p>'),
    ('<small>Tax overview</small><strong>—</strong><em>Estimates and reporting periods</em>',
     '<small>MVA overview</small><strong>—</strong><em>MVA codes and reporting periods</em>'),
    ('>Tax preparation</button>', '>Year-end documents</button>'),
    ('<b>Tax preparation support</b><span>Prepare structured records and reports for review by the business or its qualified adviser.</span>',
     '<b>Year-end documents</b><span>SAF-T export and næringsspesifikasjon figures, for the business or its accountant to check before filing.</span>'),
    ('<span>04 / TAX &amp; REPORTING</span><h3>Prepare with better records</h3><p>Organise tax-relevant figures and reporting outputs. Final tax treatment and filing remain subject to local rules and appropriate review.</p>',
     '<span>04 / MVA &amp; YEAR-END</span><h3>Prepare with better records</h3><p>MVA codes on every voucher, SAF-T export and næringsspesifikasjon figures. FlyttGo does not file tax or MVA returns; your accountant checks and files them.</p>'),
    ('payments, records and tax preparation.</span>', 'payments, records and year-end exports.</span>'),
    ('reconciliation and tax preparation.</p>', 'reconciliation and the year-end work of your accountant.</p>'),
    ('Review income, expenses, tax information and performance.', 'Review income, expenses, MVA and performance.'),
    ("['TAX PREPARATION','Prepare relevant information','Reviewable records and exports']",
     "['YEAR-END DOCUMENTS','Export for your accountant','SAF-T and næringsspesifikasjon figures']"),
    ("['TAX READINESS','Configurable tax categories and reporting support'],['IMPORTANT DISTINCTION','Preparation support is not a substitute for approved tax advice or filing']",
     "['MVA AND YEAR-END','MVA codes on vouchers and exports for your accountant'],['IMPORTANT DISTINCTION','FlyttGo does not give tax advice or file returns']"),
    ("structured tax-preparation support.'", "SAF-T and year-end exports for your accountant.'"),
    ("tax:{k:'STRUCTURED INFORMATION FOR REVIEW',t:'Tax preparation',m:[['TAX SETTINGS','Select jurisdiction','Business and tax profile'],['TAX RECORDS','Organise relevant activity','Income and expense categories']",
     "tax:{k:'STRUCTURED INFORMATION FOR YOUR ACCOUNTANT',t:'Year-end documents',m:[['MVA SETTINGS','MVA registration','Business and MVA profile'],['ACCOUNTS','Vouchers by account','Income and expense accounts']"),
    ("doc:'Tax preparation summary'", "doc:'Year-end export summary'"),
    ("['Tax categories','—','Configured treatment']", "['MVA codes','—','Per voucher line']"),
]


def soften(src: str) -> str:
    for old, new in SOFTEN:
        n = src.count(old)
        if n != 1:
            raise SystemExit(f'soften: expected once, found {n}: {old[:70]}')
        src = src.replace(old, new)
    return src


def text_of(fragment: str) -> str:
    return htmlmod.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', fragment))).strip()


def wire_links(body: str) -> tuple[str, list[str]]:
    used: list[str] = []

    def repl(m: re.Match) -> str:
        attrs, inner = m.group(1), m.group(2)
        if 'data-anchor' in attrs:                       # kept as an in-page link on purpose
            return m.group(0)
        href = re.search(r'href="([^"]*)"', attrs)
        key = (text_of(inner), href.group(1) if href else '')
        page = LINKS.get(key)
        if page is None:
            page = next((p for pre, p in CARD_PREFIX.items() if key[0].startswith(pre)), None)
        if page is None:
            return m.group(0)
        used.append(f'{key[0][:40]} -> {page}')
        return f'<a{attrs} data-page="{page}">{inner}</a>'

    body = re.sub(r'<a\b([^>]*)>(.*?)</a>', repl, body, flags=re.S)
    return body, used


# ── CSS scoping ─────────────────────────────────────────────────────────────

def split_top(css: str):
    """Yields (prelude, block) for each top-level rule; block without braces."""
    i, n = 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        prelude = css[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        yield prelude, css[j + 1:k - 1]
        i = k


def split_selectors(sel: str):
    out, depth, cur = [], 0, ''
    for ch in sel:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return [s.strip() for s in out if s.strip()]


def scope_selector(s: str, scope: str = '.fgp') -> str:
    if s in ('html', 'body', ':root', 'html body'):
        return scope
    for root in ('html ', 'body ', ':root '):
        if s.startswith(root):
            return scope + ' ' + s[len(root):]
    return scope + ' ' + s


def scope_css(css: str, scope: str = '.fgp') -> str:
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    out = []
    for prelude, block in split_top(css):
        if prelude.startswith('@media') or prelude.startswith('@supports') or prelude.startswith('@container'):
            out.append(f'{prelude}{{{scope_css(block, scope)}}}')
        elif prelude.startswith('@'):
            out.append(f'{prelude}{{{block}}}')     # @keyframes, @font-face
        else:
            sels = ','.join(scope_selector(s, scope) for s in split_selectors(prelude))
            out.append(f'{sels}{{{block.strip()}}}')
    return '\n'.join(out)


# ── The old site's functions wired in beneath the design (owner, 2026-10-30) ─
# The design looks as designed; PlatformHomePage wires the old site's working
# parts into its own elements (booking with the address lookup and price,
# live van and plan data, every card and button to a real page). Only these
# changes are made to the markup:
#   - the design's stock photos give way to the old site's own pictures;
#   - FlyttGo's menu bar replaces the design's top line and header; its
#     Platform dropdown holds the design's menu items;
#   - the booking card moves between the hero and the first section and
#     holds the old booking widget (BookingCard) in place of the design's form.
OLD = 'https://d64gsuwffb70l.cloudfront.net/'
PICTURES = {   # design stock photo (Unsplash id) -> the old site's picture
    '1556761175-b413da4baf72': OLD + '69b48d1c24a3a59014dde38a_1773440407421_d3f9f76f.jpg',  # hero: the first slide
    '1600210492486-724fe5c67fb0': OLD + '69b087fd736aea2f6794825c_1773177274288_a53014fe.jpg',  # moving & relocation: movers
    '1586528116311-ad8dd3c8310d': OLD + '69bc733e874094bcf729aca5_1773958078738_546d64ee.png',  # transport & delivery: van
    '1621905251918-48416bd8575a': OLD + '69b1b470fdd1af7483a60acc_1773254286622_a82a1d1b.jpg',  # local services: furniture service
    '1517248135467-4c7edcad34c4': OLD + '69b9877aa085bb4df2a9da28_1773766806786_1db52f56.jpg',  # hospitality: office move
    '1555529669-e69e7aa0ba9a': OLD + '69b1b470fdd1af7483a60acc_1773254050705_a292f56d.jpg',  # commerce: storage
    '1600880292203-757bb62b4baf': OLD + '69b9877aa085bb4df2a9da28_1773766976394_04c23eab.jpg',  # providers: driver and vehicle
}


def old_pictures(body: str) -> str:
    for photo, url in PICTURES.items():
        body, n = re.subn(r'https://images\.unsplash\.com/photo-%s[^"]*' % re.escape(photo), url, body)
        if n == 0:
            raise SystemExit(f'picture {photo} is no longer in the design')
    if 'images.unsplash.com' in body:
        raise SystemExit('the design has a stock photo with no old-site picture to replace it')
    return body


def booking_card(body: str) -> str:
    """The old booking widget in the design's booking card, between the hero and the first section (owner, 2026-10-30)."""
    m = re.search(r'<section class="booking-shell wrap" id="booking">.*?</section>', body, re.S)
    if not m:
        raise SystemExit('the design has no booking section')
    section = m.group(0)
    section, n = re.subn(r'<form class="booking" id="booking-form">.*?</form>',
                         '<div class="fgp-booking-slot" data-slot="booking"></div>', section, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('the design booking section has no form')
    body = body[:m.start()] + body[m.end():]
    hero = re.search(r'<section class="hero wrap">', body)
    end = body.index('</section>', hero.end()) + len('</section>')
    if body.count('<section', hero.end(), end) != 0:
        raise SystemExit('the hero holds a nested section; move the booking card by hand')
    return body[:end] + section + body[end:]


def header_places(body: str) -> str:
    """FlyttGo's own menu bar replaces the design's top line and header (owner,
    2026-10-30): it carries the old menus and, as its Platform dropdown, the
    design's menu items (Header.tsx)."""
    body, n = re.subn(r'<div class="topline"[^>]*>.*?</div>\s*', '', body, count=1, flags=re.S)
    body, m = re.subn(r'<header class="wrap nav">.*?</header>\s*', '', body, count=1, flags=re.S)
    if n != 1 or m != 1:
        raise SystemExit('the design has no top line or header')
    return body


# ── The restructured homepage (/preview/home, docs/HOMEPAGE_RESTRUCTURE.md) ─
# Built from the design's own sections, upgraded, not replaced (owner,
# 2026-10-30): the strongest section of each topic, in the twelve-section
# order, with the weaker duplicates left out. Written to
# src/components/homeV2/ as design.v2(.no).html and design.v2.css (scoped
# under .fgv2, in the design's own palette, which HomeV2Page tunes to the
# brief's colours, since replaced by the platform page's navy, emerald and white).
V2_OUT = ROOT / 'src' / 'components' / 'homeV2'
V2_SECTIONS = [                                   # (attribute in the section's opening tag, topic)
    # The commercial story (owner's 2036 mandate, 30 October 2026): understand FlyttGo, find your
    # journey, discover the marketplace, experience the transaction, then My Company, finance,
    # industries; only then the connected platform, organisations, providers, the optional white-label
    # infrastructure and network independence.
    ('class="hero wrap"', '1 understand FlyttGo'),
    ('id="moving-services"', '2 moving and transport, the core service, straight after its booking band'),
    ('id="entry-points"', '3 find your journey'),
    ('id="marketplace"', '4 discover the marketplace'),
    ('id="how-it-works"', '5 the booking experience'),
    ('id="van-types"', '5 vehicle sizes (rates on the van guide)'),
    ('class="section testimonials"', '5 what every booking includes'),
    ('id="business-workspace"', '6 My Company'),
    ('id="financial-administration"', '7 financial administration'),
    ('id="industry-experiences"', '8 industry workflows'),
    ('id="unified-platform"', '9 the connected platform'),
    ('id="business"', '10 corporate solutions'),
    ('id="driver-network"', '11 provider network'),
    ('id="white-label-builder"', '12 white-label infrastructure (optional)'),
    ('id="marketplace-network-experience"', '13 network independence'),
    ('class="final-cta"', '14 take action'),
]
# Wording the code does not support, corrected (the audit's status table).
V2_CLAIMS = [
    # The owner's headline for the restructured page (brief, 30 October 2026).
    ('<h1 class="display">Build your business.<br/><span class="serif">Own your marketplace.</span></h1>',
     '<h1 class="display"><span class="h1-line">Assisting Companies</span> <span class="h1-line">to Fly High.</span><br/><span class="serif">One connected platform for services, business operations and growth.</span></h1>'),
    # The three entry points in the owner's words (30 October 2026): customer,
    # business and specialist, each with who it is for and where it leads.
    ('<span class="eyebrow">Choose your way into FlyttGo</span><h2 class="display">One platform. Three ways to get started.</h2><p>Whether you need a service, run a company or want to build a marketplace, start with what matters to you.</p>',
     '<span class="eyebrow">Choose your way into FlyttGo</span><h2 class="display">Three journeys. One platform.</h2><p>Most people come to FlyttGo to book a service or to run their company. Organisations add corporate services, a provider network or, as one option, a marketplace of their own.</p>'),
    ('<h3>I need a service</h3><p>Explore moving, transport, trades and other services from participating providers.</p><a href="#marketplace">Explore services ↗</a>',
     '<h3>Find a Service</h3><p>Find moving, transport, home services and professionals.</p><p class="entry-for">For customers who need something done.</p><a href="#marketplace">Explore services →</a>'),
    ('<h3>I run a business</h3><p>Manage services, appointments, customers, quotes, invoices, receipts and payments.</p><a href="#business-workspace">Explore business tools ↗</a>',
     '<h3>My Company</h3><p>Manage your business, customers, services, bookings, employees, invoices and payments.</p><p class="entry-for">For independent professionals, small businesses and established companies.</p><a href="#business-workspace">Manage my business →</a>'),
    ('<h3>I want my own marketplace</h3><p>Create a branded marketplace with your identity, domain, services and provider network.</p><a href="#white-label-builder">Explore white-label ↗</a>',
     '<div class="entry-side"><h3>For Organisations</h3><p>Corporate solutions, a provider network and marketplace infrastructure.</p></div><div class="entry-body"><p class="entry-for">For corporate customers, provider network participants and marketplace operators.</p><ul class="entry-options"><li><a href="#business">Corporate solutions</a></li><li><a href="#driver-network">Provider network</a></li><li><a href="#white-label-builder">Marketplace infrastructure</a> <span>(optional)</span></li></ul><a href="#business">Explore organisational solutions →</a></div>'),
    # The specialised offering: a strip below the two main journeys, never their equal.
    ('<article class="entry-card entry-gold"><span>03 / BUILD &amp; OWN</span><div class="entry-side">',
     '<article class="entry-card entry-gold entry-org"><div class="entry-side"><span>03 / ORGANISE &amp; SCALE</span>'),
    # The brief's three entry points in the hero (the design had two buttons).
    ('<div class="hero-actions"><a class="btn btn-primary" href="#entry-points">Explore your options<span class="arrow">↗</span></a><a class="btn btn-light" href="#unified-platform">See the platform<span class="arrow">↗</span></a></div>',
     '<div class="hero-actions"><a class="btn btn-primary" href="#marketplace">Explore services<span class="arrow">↗</span></a><a class="btn btn-light" href="#business-workspace">My Company<span class="arrow">↗</span></a><a class="hero-link" href="#business">For Organisations →</a></div>'),
    # The hero introduces the two main journeys; a marketplace of one's own is not needed for either.
    ('<p class="hero-lede">Run a service company, manage customers and bookings, collect payments, issue invoices — or launch a marketplace under your own brand. FlyttGo brings business operations and marketplace infrastructure together.</p>',
     '<p class="hero-lede">Discover services, run your company and connect with a wider business network — all through one connected FlyttGo platform.</p>'),
    ('<span>For independent professionals, growing companies and marketplace operators.</span>',
     '<span>For customers, independent professionals, growing companies and organisations.</span>'),
    # The driver panel's button opens the driver sign-up (WIRES), so it says so.
    ('<a class="btn btn-light" href="#main-content">Explore FlyttGo</a>', '<a class="btn btn-light" href="#main-content">Become a driver ↗</a>'),
    # The lifecycle in the owner's words (30 October 2026): Pay between Invoice and Record.
    ('<div>Deliver</div><div>Invoice</div><div>Record</div>', '<div>Deliver</div><div>Invoice</div><div>Pay</div><div>Record</div>'),
    # The local services card leads to how trades and professionals take bookings, not to the moving services page.
    ('<a class="market-card" href="#providers">', '<a class="market-card" href="#industry-experiences" data-anchor>'),
    # Five connected capabilities (owner, 30 October 2026): the provider and business network joins, and
    # white-label infrastructure comes last, marked optional. HomeV2Page gives the new card its description.
    ('<p>FlyttGo brings service discovery, business operations, independent marketplace infrastructure and financial administration into one connected platform.',
     '<p>FlyttGo brings service discovery, business operations, financial administration and, for organisations that want one, independent marketplace infrastructure into one connected platform, joined by its provider and business network.'),
    ('<div class="ecosystem-hub"><small>THE SHARED FOUNDATION</small><strong>FLYTTGO PLATFORM</strong><p>Common identity · Configurable workflows · Marketplace connections · Business records · Permissions · Integrations</p></div>',
     '<div class="ecosystem-hub"><small>THE SHARED FOUNDATION</small><strong>FLYTTGO PLATFORM</strong><p>Common identity · Configurable workflows · Marketplace connections · Business records · Permissions · Integrations</p><span class="hub-network">Joined by the provider and business network: drivers, transport partners and service providers take part in every capability.</span></div>'),
    ('<button type="button" class="ecosystem-pillar" data-pillar="white" aria-pressed="false"><small>03 / BUILD</small><strong>White-Label Infrastructure</strong><span>Create and operate a branded marketplace on shared technology.</span></button>\n        <button type="button" class="ecosystem-pillar" data-pillar="finance" aria-pressed="false"><small>04 / ADMINISTER</small><strong>Financial Infrastructure</strong><span>Connect quotes, invoices, payments, records and year-end exports.</span></button>',
     '<button type="button" class="ecosystem-pillar" data-pillar="finance" aria-pressed="false"><small>03 / ADMINISTER</small><strong>Financial Infrastructure</strong><span>Connect quotes, invoices, payments, records and year-end exports.</span></button>\n        <button type="button" class="ecosystem-pillar" data-pillar="white" aria-pressed="false"><small>04 / BUILD · OPTIONAL</small><strong>White-Label Infrastructure</strong><span>For organisations that want to operate their own branded marketplace.</span></button>'),
    # Second-pass art direction (owner, 30 October 2026).
    # Hero: one quiet eyebrow; the picture carries the three journeys as a band, in place of a floating card and index.
    ('<div class="eyebrow">The business and marketplace platform</div>', '<div class="eyebrow">One connected platform</div>'),
    ('<div class="hero-index"><b>01</b> / BUSINESS IN MOTION</div><div class="image-caption"><small>BUSINESS · SERVICES · COMMERCE</small><strong>Everything your business needs to move forward.</strong></div><div class="floating-card"><small>ONE OPERATING PLATFORM</small><strong>Your business. Your brand.</strong><span>Bookings · Payments · Growth ↗</span></div>',
     '<nav class="hero-ledger" aria-label="Three ways into FlyttGo"><a href="#marketplace"><small>01 · Explore</small><strong>Services near you</strong></a><a href="#business-workspace"><small>02 · My Company</small><strong>Run the business</strong></a><a href="#business"><small>03 · For Organisations</small><strong>Scale with FlyttGo</strong></a></nav>'),
    # Marketplace: a way in by category above the editorial gallery.
    ('<div class="market-grid">',
     '<nav class="v2-categories" aria-label="Browse services"><span>Browse</span><a href="#booking" data-anchor>Moving and relocation</a><a href="#moving-services" data-anchor>Transport and delivery</a><a href="#industry-experiences" data-anchor>Home and local services</a><a href="#industry-experiences" data-anchor>Professional services</a><a href="#how-flyttgo-works" data-anchor>Hospitality and commerce</a><em>More categories open as businesses join.</em></nav><div class="market-grid">'),
    # Moving and transport: a strong vertical within FlyttGo, not the whole platform.
    ('<span class="eyebrow">The moving network</span>', '<span class="eyebrow">A FlyttGo vertical · Moving and transport</span>'),
    # Provider network: part of the ecosystem story, plans left to their own page.
    ('<span class="eyebrow" style="color:#d6c18e">Join the driver network</span>', '<span class="eyebrow" style="color:#d6c18e">Provider network</span>'),
    ('<p>Connect with moving and delivery opportunities, choose a plan and grow your work through the FlyttGo network.</p>',
     '<p>Drivers and transport partners take eligible jobs from the FlyttGo network and run their work with the same business tools and records as every company on the platform.</p>'),
    # Marketplace Studio: what is still in development is said in the studio itself.
    ('<span>INTERACTIVE PRODUCT CONCEPT</span></div>\n    <div class="wl-layout">', '<span>INTERACTIVE PRODUCT CONCEPT · PROVIDER ONBOARDING IN DEVELOPMENT</span></div>\n    <div class="wl-layout">'),
    # Corporate: a workflow of approvals, roles and invoicing in place of figures that read as results.
    ('<div class="dash-top"><b>Company overview</b><small>ILLUSTRATIVE DASHBOARD PREVIEW</small></div><div class="dash-stats"><div class="dash-stat"><small>Active bookings</small><strong>128</strong><em>↑ 12.4% this month</em></div><div class="dash-stat"><small>Monthly spend</small><strong>84.2k</strong><em>NOK · This month</em></div><div class="dash-stat"><small>On-time rate</small><strong>98.6%</strong><em>Operational overview</em></div></div>',
     '<div class="dash-top"><b>Company account · Example AS</b><small>ILLUSTRATION · EXAMPLE DATA</small></div>'
     '<div class="corp-flow"><div class="corp-flow-head"><b>Bookings awaiting approval</b><span>Spending limit per booker</span></div>'
     '<div class="corp-row"><span><b>Office move</b>Requested by a booker · Facilities</span><em class="corp-wait">Awaiting approval</em></div>'
     '<div class="corp-row"><span><b>Weekly delivery</b>Recurring · Warehouse</span><em class="corp-ok">Approved</em></div>'
     '<div class="corp-row"><span><b>Furniture transport</b>Within the booker&#x27;s limit</span><em class="corp-ok">Booked</em></div></div>'
     '<div class="corp-roles"><b>Roles and permissions</b><div><span><i>Owner</i>Everything, including billing</span><span><i>Admin</i>Approve, manage team</span><span><i>Booker</i>Book within a limit</span></div></div>'),
    ('<div class="dash-bottom"><div class="dash-mini"><b>Recent activity</b>Booking #FG-1048 · Confirmed<br/>Booking #FG-1047 · In progress</div><div class="dash-mini"><b>Team overview</b>12 team members<br/>4 locations · 3 departments</div></div>',
     '<div class="corp-invoice"><span><b>Monthly invoice</b>All approved bookings on one invoice, with each booking&#x27;s reference</span><em>Issued by FlyttGo</em></div>'),
    # The van cards no longer show rates; the note says where they are, in the visitor's words.
    ('Vehicle rates shown are the starting hourly prices listed in the current FlyttGo codebase. Final quotes depend on the booking details and applicable pricing rules.',
     'Hourly rates are on the van size guide. Your final price depends on the booking details and applicable pricing rules.'),
    # Eight moving services (owner, 30 October 2026): move-out cleaning and packing and assembly are
    # extras on a FlyttGo booking (constants.ts, extras: cleaning, packing_service, furniture_assembly).
    # The cleaning picture is the design's own living room photograph (Unsplash licence).
    ('<div class="body"><h3>Storage transport</h3><p>Moving items to and from storage units efficiently.</p></div></article>',
     '<div class="body"><h3>Storage transport</h3><p>Moving items to and from storage units efficiently.</p></div></article>'
     '<article class="service-card"><div class="photo"><img alt="Clean, bright living room" loading="lazy" src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&amp;fit=crop&amp;w=900&amp;q=80"/></div><div class="body"><h3>Move-out cleaning</h3><p>Cleaning of the home you leave, added to your move as an extra.</p></div></article>'
     '<article class="service-card"><div class="photo"><img alt="People packing and taping moving boxes" loading="lazy" src="https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766787761_26698bc2.jpg"/></div><div class="body"><h3>Packing and assembly</h3><p>Packing, furniture dismantling and assembly, added to your move as extras.</p></div></article>'),
    # Refinement pass (owner's critique, 30 October 2026).
    # The workspace has an identity: the example company and who is signed in.
    ('<aside class="bw-sidebar">\n        <div class="bw-label">WORKSPACE</div>',
     '<aside class="bw-sidebar">\n        <div class="bw-company"><i aria-hidden="true">ES</i><span><b>Example Services AS</b>Signed in as Ingrid · Owner</span></div>\n        <div class="bw-label">WORKSPACE</div>'),
    # The studio shows the operator's domain, provider network and payment model, with what is still in development.
    ('<label>BRAND COLOUR</label>', '<span class="wl-setting-label">BRAND COLOUR</span>'),
    ('</div>\n      </aside>\n      <div class="wl-preview">',
     '</div>\n        <dl class="wl-settings"><div><dt>DOMAIN</dt><dd>Your own domain or a FlyttGo address</dd></div><div><dt>PROVIDER NETWORK</dt><dd><span class="v2-chip v2-chip-wait">In development</span></dd></div><div><dt>PAYMENTS</dt><dd>FlyttGo sells, or you sell under your own terms</dd></div></dl>\n      </aside>\n      <div class="wl-preview">'),
    # 2036 mandate (owner, 30 October 2026).
    # The closing section ends with the three journeys.
    ('<div class="final-actions"><a class="btn btn-primary" href="#booking">Find what you need <span class="arrow">↗</span></a><a class="btn btn-light" href="#providers">Join the ecosystem</a></div>',
     '<div class="final-actions"><a class="btn btn-primary" href="#marketplace" data-anchor>Explore services <span class="arrow">↗</span></a><a class="btn btn-light" href="#business-workspace" data-anchor>My Company</a><a class="btn btn-light" href="#business" data-anchor>For Organisations</a></div>'),
    # Corporate: locations and API access shown in the workflow, not as figures.
    ('<div class="corp-roles"><b>Roles and permissions</b>',
     '<div class="corp-roles"><b>Roles, departments and locations</b>'),
    ('<span><i>Booker</i>Book within a limit</span></div></div>',
     '<span><i>Booker</i>Book within a limit · Oslo or Bergen office</span></div></div>'),
    ('<em>Issued by FlyttGo</em></div>',
     '<em>Issued by FlyttGo</em></div><div class="corp-api"><span><b>Reporting and API</b>Monthly reports by department; bookings from your own systems through the API (paid add-on)</span></div>'),
    # Marketplace Studio: a working storefront preview with the operator's own choices.
    ('<span class="wl-setting-label">BRAND COLOUR</span>', '<span class="wl-setting-label">PRIMARY COLOUR</span>'),
    ('<dl class="wl-settings"><div><dt>DOMAIN</dt><dd>Your own domain or a FlyttGo address</dd></div><div><dt>PROVIDER NETWORK</dt><dd><span class="v2-chip v2-chip-wait">In development</span></dd></div><div><dt>PAYMENTS</dt><dd>FlyttGo sells, or you sell under your own terms</dd></div></dl>',
     '<div class="wl-more">'
     '<label for="wl-color2">SECONDARY COLOUR</label><input id="wl-color2" type="color" value="#C3A66C"/>'
     '<label for="wl-mark">BRAND MARK</label><select id="wl-mark"><option value="initials">Initials</option><option value="circle">Monogram</option><option value="none">Name only</option></select>'
     '<label for="wl-domain">DOMAIN</label><div class="wl-domain-row"><input id="wl-domain" value="northside"/><select id="wl-domain-mode" aria-label="Domain type"><option value="flyttgo">.flyttgo.no</option><option value="own">own domain (.no)</option></select></div>'
     '<span class="wl-setting-label">CATEGORIES</span><div class="wl-cat-toggles" id="wl-cat-toggles"></div>'
     '<label for="wl-style">STOREFRONT</label><select id="wl-style"><option value="classic">Classic</option><option value="editorial">Editorial</option><option value="compact">Compact</option></select>'
     '<label for="wl-payments">BOOKING AND PAYMENTS</label><select id="wl-payments"><option value="b">You sell, on your own terms</option><option value="a">FlyttGo sells (moving and delivery only)</option></select>'
     '<dl class="wl-settings"><div><dt>PROVIDER NETWORK</dt><dd><span class="v2-chip v2-chip-wait">In development</span></dd></div></dl>'
     '</div>'),
    ('<div class="wl-preview-bar"><div class="wl-preview-brand" id="wl-preview-brand">NORTHSIDE SERVICES</div><span>YOUR MARKETPLACE PREVIEW</span></div>',
     '<div class="wl-preview-bar"><div class="wl-address" id="wl-address">northside.flyttgo.no</div><span>YOUR MARKETPLACE PREVIEW · ILLUSTRATION</span></div>'
     '<div class="wl-preview-brand" id="wl-preview-brand" hidden>NORTHSIDE SERVICES</div>'),
    ('<div class="wl-store-nav"><strong id="wl-store-name">NORTHSIDE SERVICES</strong>',
     '<div class="wl-store-nav"><span class="wl-mark-el" id="wl-mark-el" aria-hidden="true">NS</span><strong id="wl-store-name">NORTHSIDE SERVICES</strong>'),
    ('</div>\n          </div>\n        </div>\n      </div>\n    </div>\n    <div class="wl-builder-foot">',
     '</div>\n          </div>\n          <div class="wl-pay-line" id="wl-pay-line">Bookings and payments: you sell, under your own terms and VAT · Stripe Connect</div>\n        </div>\n      </div>\n    </div>\n    <div class="wl-builder-foot">'),
    # The central FlyttGo Marketplace, never confused with a marketplace of one's own.
    ('<div class="eyebrow">Explore the marketplace</div>', '<div class="eyebrow">The FlyttGo Marketplace</div>'),
    ('<p>Discover the FlyttGo marketplace: moving and transport, local services, business solutions and opportunities for providers.</p>',
     '<p>Discover the FlyttGo Marketplace: moving and transport, local services, business solutions and opportunities for providers. No marketplace of your own is needed to take part.</p>'),
    ('<div class="eyebrow">Marketplace infrastructure for entrepreneurs and organisations</div>',
     '<div class="eyebrow">Specialised offering for entrepreneurs and organisations</div>'),
    ('<p>FlyttGo is designed to let an operator build a branded service marketplace',
     '<p>Separate from the FlyttGo Marketplace, and not needed to use FlyttGo or its business tools. FlyttGo is designed to let an operator build a branded service marketplace'),
    ('The same foundation can support a small independent operator or a larger organisation with teams.</p>',
     'The same foundation can support a small independent operator or a larger organisation with teams. You do not need a marketplace of your own to use it.</p>'),
    ('<p>Find a service, operate your company or create a marketplace under your own brand — on one connected platform.</p>',
     '<p>Find a service or run your company on FlyttGo. Organisations that want a marketplace under their own brand can build one on the same platform.</p>'),
    ('<p>Own brand, domain, customer proposition, provider network and commercial rules.</p>',
     '<p>Own brand, domain, customer proposition and commercial rules. Own provider networks: in development.</p>'),
    ('<h2 class="display">Connected by design.<br/><span class="serif">Separate by ownership.</span></h2>',
     '<h2 class="display">Shared infrastructure does not mean<br/><span class="serif">shared private data.</span></h2>'),
    ('<span>API Integration — connect FlyttGo to your warehouse or ERP</span>',
     '<span>API Integration — connect FlyttGo to your warehouse or ERP (paid add-on)</span>'),
    ('<span>Analytics Dashboard — track delivery volumes, costs and performance</span></div>',
     '<span>Analytics Dashboard — track delivery volumes, costs and performance</span></div><div class="feature"><i>✓</i><span>Recurring bookings — repeat deliveries on a schedule</span></div>'),
]
# In-page links to sections the restructured page leaves out go to the section that carries the topic now.
V2_ANCHORS = {'#platform': '#unified-platform', '#business-platform': '#business-workspace', '#white-label': '#white-label-builder',
              '#top': '#main-content'}
V2_ECO_NOTE = ('<p class="v2-eco-note">Every business and marketplace keeps its own customers, records and permissions '
               'on the shared foundation. Customers, businesses and operators move between the capabilities as one experience.</p>')
# Moving and transport, FlyttGo's core service, as a bold band straight after the hero (owner, 31 October
# 2026): the transport site's own photograph, its proof points (all built: approved drivers, MVA-inclusive
# prices, tracking, card and Vipps), the real booking widget and a way to the full transport site.
V2_BOOKING = ('<div class="v2-booking v2-move-band" id="booking"><div class="wrap v2-booking-inner">'
              '<div class="v2-booking-head"><span class="eyebrow">FlyttGo Moving &amp; Transport</span>'
              '<h2>Moving and transport across Norway.</h2>'
              '<p>Book approved movers and cargo drivers in a minute. Upfront price, live tracking and secure payment.</p>'
              '<ul class="v2-move-proof"><li>Approved, document-checked drivers</li><li>Upfront price with 25% MVA included</li>'
              '<li>Live tracking on the day</li><li>Pay by card or Vipps</li></ul>'
              '<div class="v2-move-actions"><a href="/book" data-page="booking" data-anchor>Get a moving price →</a>'
              '<a href="/transport" data-page="transport-home" data-anchor>Go to FlyttGo Moving &amp; Transport</a></div></div>'
              '<div data-slot="booking"></div></div></div>')
V2_LIFECYCLE = ('<ol class="v2-lifecycle" aria-label="From booking to financial record">'
                + ''.join(f'<li><b>0{i + 1}</b>{t}</li>' for i, t in enumerate(
                    ['Booking', 'Quote', 'Job completed', 'Invoice', 'Payment', 'Financial record'])) + '</ol>')

# How FlyttGo works (owner, 30 October 2026): the lifecycle, how each journey
# connects to the others, one business's journey, and what is available today,
# in development or planned (docs/PLATFORM_AUDIT_2026-10-30.md, SERVICE_PLATFORM.md).
V2_STEPS = ['Discover', 'Request', 'Quote', 'Book', 'Deliver', 'Invoice', 'Pay', 'Record']
V2_LINKS_HOW = [
    ('Customers', 'Explore', 'Customers discover and book services through Explore.',
     [('ok', 'Moving and transport'), ('plan', 'Other categories in the central marketplace')], '#marketplace', 'Explore services'),
    ('Businesses', 'My Company', 'Businesses manage customers, bookings, jobs, quotes, employees and invoices in My Company.',
     [('ok', 'Company accounts, teams, jobs, appointments and invoices')], '#business-workspace', 'See the business workspace'),
    ('Providers', 'Provider network', 'Providers receive and fulfil eligible work through the provider network.',
     [('ok', 'Drivers and moving jobs'), ('plan', 'Other service providers')], '#driver-network', 'Join the provider network'),
    ('Payments and records', 'Finance', 'Payments, invoices and financial records connect to the work that was done.',
     [('ok', 'Invoices and payment records'), ('dev', 'Accounting add-on, awaiting an authorised accountant\'s review')], '#financial-administration', 'See payments and finance'),
    ('Organisations', 'Corporate solutions', 'Corporate organisations manage bookings, users, invoicing and reporting with organisational tools.',
     [('ok', 'Company bookings, multiple users and corporate invoicing')], '#business', 'See corporate solutions'),
    ('Marketplace operators', 'Marketplace infrastructure', 'An operator can run its own branded marketplace on the same infrastructure. It is a separate operating model from the central FlyttGo Marketplace.',
     [('ok', 'Branded booking pages'), ('dev', 'Operator-managed provider networks')], '#white-label-builder', 'See marketplace infrastructure'),
]
V2_BUSINESS_PATH = ['Registers on FlyttGo', 'Creates its company profile', 'Adds services and pricing', 'Manages customer enquiries',
                    'Accepts bookings', 'Fulfils the work', 'Issues invoices', 'Records payments']
V2_STATUS = {'ok': 'Available', 'dev': 'In development', 'plan': 'Planned'}
V2_HOW = (
    '<section class="v2-how" id="how-flyttgo-works"><div class="wrap">'
    '<div class="section-head"><div><div class="eyebrow">How FlyttGo works</div>'
    '<h2 class="display">Different journeys.<br/><span class="serif">One connected platform.</span></h2></div>'
    '<p>Customers, businesses, providers and organisations each use FlyttGo in their own way. Underneath, the same records connect the work from the first request to the financial record.</p></div>'
    '<ol class="v2-lifecycle v2-steps" aria-label="From discovery to financial record">'
    + ''.join(f'<li><b>0{i + 1}</b>{t}</li>' for i, t in enumerate(V2_STEPS)) + '</ol>'
    '<div class="v2-links">'
    + ''.join(
        f'<article><small>{who}</small><h3>{where}</h3><p>{text}</p><ul>'
        + ''.join(f'<li class="v2-status v2-{k}"><span>{V2_STATUS[k]}</span>{t}</li>' for k, t in status)
        + f'</ul><a href="{href}">{cta} →</a></article>'
        for who, where, text, status, href, cta in V2_LINKS_HOW)
    + '</div>'
    '<div class="v2-path"><div><div class="eyebrow">One business on FlyttGo</div><h3>From registration to a paid invoice.</h3>'
    '<p>If eligible, the same business can also take part in the central FlyttGo Marketplace. A separate organisation can run its own branded marketplace, onboard providers and set its commercial model. These are different journeys on shared infrastructure, not steps every account has to take.</p></div>'
    '<ol>' + ''.join(f'<li><b>{i + 1}</b>{t}</li>' for i, t in enumerate(V2_BUSINESS_PATH)) + '</ol></div>'
    '<p class="v2-legend"><span class="v2-status v2-ok"><span>Available</span></span> built in FlyttGo today '
    '<span class="v2-status v2-dev"><span>In development</span></span> being built '
    '<span class="v2-status v2-plan"><span>Planned</span></span> the intended product. '
    'Screens marked “illustration” show example data, not live records.</p>'
    '</div></section>')

# Links between related capabilities at the foot of a section (owner, 30 October 2026).
V2_RELATED = {
    'business-workspace': [('Provider participation', '#how-flyttgo-works'), ('Payments and finance', '#financial-administration')],
    'financial-administration': [('The business workspace', '#business-workspace'), ('How the records connect', '#how-flyttgo-works')],
    'business': [('Service categories', '#marketplace'), ('Moving and transport services', '#moving-services')],
    'driver-network': [('Business tools for providers', '#business-workspace'), ('How providers take part', '#how-flyttgo-works')],
    'white-label-builder': [('Platform architecture', '#marketplace-network-experience'), ('How the platform connects', '#how-flyttgo-works')],
    'marketplace': [('Book a move', '#booking'), ('How booking works', '#how-it-works')],
}


def related(page: str) -> str:
    for sid, links in V2_RELATED.items():
        m = re.search(r'<section\b[^>]*id="%s"' % sid, page)
        end = element_span(page, m.start(), 'section')
        block = ('<div class="wrap v2-related"><span>Related</span>'
                 + ''.join(f'<a href="{href}">{text} →</a>' for text, href in links) + '</div>')
        page = page[:end - len('</section>')] + block + page[end - len('</section>'):]
    return page


def element_span(body: str, start: int, tag: str) -> int:
    """End index of the element opening at start (nested tags of the same name counted)."""
    depth = 0
    for m in re.finditer(r'<(/?)%s\b[^>]*>' % tag, body[start:]):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return start + m.end()
    raise SystemExit(f'unclosed <{tag}> at {start}')


# One job per section (owner's 2036 evaluation, 31 October 2026): the page says "one platform" once, in
# the hero; every other heading says what its own section is for. Applied last, to the finished page.
V2_VOICE = [
    ('<div class="eyebrow">One connected platform</div>', '<div class="eyebrow">Services · Business tools · Network</div>'),
    ('<span class="eyebrow">Choose your way into FlyttGo</span><h2 class="display">Three journeys. One platform.</h2>',
     '<span class="eyebrow">Choose your way in</span><h2 class="display">Book a service. Run your company. Build with us.</h2>'),
    ('<div class="eyebrow">One platform. Workflows for different industries.</div>', '<div class="eyebrow">Industries</div>'),
    ('<div class="eyebrow">One platform · Four connected capabilities</div><h2 class="display">Not four separate products.<br/><span class="serif">One business ecosystem.</span></h2>',
     '<div class="eyebrow">What connects underneath</div><h2 class="display">Bookings, work and money.<br/><span class="serif">Recorded once.</span></h2>'),
    ('<h2 class="display">Different journeys.<br/><span class="serif">One connected platform.</span></h2>',
     '<h2 class="display">From the first search<br/><span class="serif">to the final record.</span></h2>'),
    ('<div class="eyebrow">One infrastructure · Independent marketplace businesses</div>', '<div class="eyebrow">Trust and data boundaries</div>'),
    ('<div class="eyebrow">One platform. Many possibilities.</div>', '<div class="eyebrow">Start today</div>'),
    # Hero directions (design.config.ts): the participants band (B, the connected business) and the
    # flight-line motif (C, the signature statement); each is hidden in the other directions.
    ('<strong>Scale with FlyttGo</strong></a></nav>',
     '<strong>Scale with FlyttGo</strong></a></nav>'
     '<ul class="hero-actors"><li><b>Customers</b><span>find and book services</span></li>'
     '<li><b>Professionals</b><span>deliver the work</span></li>'
     '<li><b>Companies</b><span>run bookings, jobs and invoices</span></li>'
     '<li><b>Organisations</b><span>buy, approve and scale</span></li></ul>'),
    ('<div class="hero-copy">',
     '<div class="hero-copy"><svg class="hero-motif" viewBox="0 0 600 320" aria-hidden="true" focusable="false">'
     '<path d="M8 304 C 180 300, 330 250, 430 150 S 560 30, 592 12" fill="none" stroke="currentColor" stroke-width="1.5"/>'
     '<path d="M8 304 C 180 300, 330 250, 430 150 S 560 30, 592 12" fill="none" stroke="currentColor" stroke-width="14" opacity=".06"/>'
     '<circle cx="592" cy="12" r="6" fill="currentColor"/></svg>'),
    # Headline candidates (design.config.ts `headline`): the owner's slogan and two that say what FlyttGo
    # does. One shows at a time; the slogan becomes the signature line above the others.
    ('<span class="h1-line">Assisting Companies</span> <span class="h1-line">to Fly High.</span><br/>',
     '<span class="hl hl-a"><span class="h1-line">Assisting Companies</span> <span class="h1-line">to Fly High.</span></span>'
     '<span class="hl hl-b"><span class="h1-line">Book services.</span> <span class="h1-line">Run your company.</span> <span class="h1-line">Grow with FlyttGo.</span></span>'
     '<span class="hl hl-c"><span class="h1-line">The platform behind</span> <span class="h1-line">every service business.</span></span><br/>'),
    ('<div class="eyebrow">Services · Business tools · Network</div>',
     '<a class="hero-move" href="#booking" data-anchor><i aria-hidden="true"></i>Moving &amp; transport across Norway — get a price in a minute →</a>'
     '<div class="eyebrow"><span class="hl-sig-a">Services · Business tools · Network</span><span class="hl-sig">Assisting companies to fly high</span></div>'),
    # What the studio shows that exists, what is being connected and what is in development
    # (docs/PLATFORM_AUDIT_2026-10-30.md, white label rows).
    ('<dd><span class="v2-chip v2-chip-wait">In development</span></dd></div></dl></div>',
     '<dd><span class="v2-chip v2-chip-wait">In development</span></dd></div></dl>'
     '<ul class="wl-status"><li><span class="v2-chip v2-chip-ok">Available</span>Your branded page and flyttgo.no address; FlyttGo sells and invoices (moving and delivery)</li>'
     '<li><span class="v2-chip v2-chip-info">Being connected</span>Your own domain; selling under your own terms (Stripe Connect)</li>'
     '<li><span class="v2-chip v2-chip-wait">In development</span>Your own provider network</li>'
     '<li><span class="v2-chip v2-chip-neutral">Illustration</span>This preview creates, connects and charges nothing</li></ul></div>'),
]


# Visual polish that needs markup (premium plan, 31 October 2026): the storefront's search and example
# providers (illustration), the studio settings in labelled groups, and a line under each closing journey.
V2_POLISH = [
    [('<div class="wl-categories"><small>DISCOVER YOUR CATEGORIES</small>',
      '<div class="wl-search" aria-hidden="true"><span>Search services in your area</span><b>Search</b></div>'
      '<div class="wl-categories"><small>DISCOVER YOUR CATEGORIES</small>')],
    [('<label for="wl-name">MARKETPLACE NAME</label>', '<span class="wl-group">Identity</span><label for="wl-name">MARKETPLACE NAME</label>'),
     ('<label for="wl-market">MARKET FOCUS</label>', '<span class="wl-group">Catalogue and look</span><label for="wl-market">MARKET FOCUS</label>'),
     ('<label for="wl-domain">DOMAIN</label>', '<span class="wl-group">Address</span><label for="wl-domain">DOMAIN</label>'),
     ('<label for="wl-payments">BOOKING AND PAYMENTS</label>', '<span class="wl-group">Commerce</span><label for="wl-payments">BOOKING AND PAYMENTS</label>')],
    [('<a class="btn btn-primary" href="#marketplace" data-anchor>Explore services <span class="arrow">↗</span></a>',
      '<a class="btn btn-primary" href="#marketplace" data-anchor>Explore services <span class="arrow">↗</span><small class="final-note">Find and book a service</small></a>'),
     ('<a class="btn btn-light" href="#business-workspace" data-anchor>My Company</a>',
      '<a class="btn btn-light" href="#business-workspace" data-anchor>My Company<small class="final-note">Run bookings, jobs and invoices</small></a>'),
     ('<a class="btn btn-light" href="#business" data-anchor>For Organisations</a>',
      '<a class="btn btn-light" href="#business" data-anchor>For Organisations<small class="final-note">Corporate services, providers, marketplaces</small></a>')],
    [('<section class="section testimonials">', '<section class="section testimonials" id="booking-guarantees">')],
    # "Go further": on the homepage only, the products that have their own page (sitePages.ts).
    [('<section class="finance-section" id="financial-administration">',
      '<section class="v2-explore" id="explore-more"><div class="wrap">'
      '<div class="section-head"><div><div class="eyebrow">Go further</div><h2 class="display">Everything else<br/><span class="serif">FlyttGo does.</span></h2></div>'
      '<p>Each part of the platform has its own page, with the full demonstration and example data.</p></div>'
      '<div class="v2-explore-grid">'
      '<a href="/my-company" data-page="my-company" data-anchor><small>My Company</small><b>The business workspace</b><span>Customers, services, bookings, quotes, invoices and team.</span></a>'
      '<a href="/my-company/finance" data-page="my-company-finance" data-anchor><small>Finance</small><b>Financial administration</b><span>Follow one job from invoice to voucher, ledger and report.</span></a>'
      '<a href="/industries" data-page="industries" data-anchor><small>Industries</small><b>Built around your work</b><span>Plumbing, electrical, cleaning, moving and consulting.</span></a>'
      '<a href="/how-it-works" data-page="how-it-works-page" data-anchor><small>How it works</small><b>What connects underneath</b><span>One record, one lifecycle, separated data.</span></a>'
      '<a href="/moving" data-page="moving-hub" data-anchor><small>Moving and transport</small><b>Steps, vans and guarantees</b><span>What every booking includes.</span></a>'
      '<a href="/business" data-page="corporate" data-anchor><small>For organisations</small><b>Corporate services</b><span>Accounts, approvals, monthly invoicing and reporting.</span></a>'
      '<a href="/business/white-label" data-page="white-label" data-anchor><small>Your own marketplace</small><b>Marketplace Studio</b><span>Name, colours, domain and storefront, as an illustration.</span></a>'
      '</div></div></section>'
      '<section class="finance-section" id="financial-administration">')],
]

def type_vars(css: str) -> str:
    """The restructured page's typefaces as variables (design.config.ts sets them; the design lab
    changes them): Manrope is the display face, DM Sans the text face, Georgia the accent serif."""
    css = re.sub(r'"DM Sans"(,\s*sans-serif)?', 'var(--font-body)', css)
    css = re.sub(r'\bManrope(,\s*sans-serif)?', 'var(--font-display)', css)
    css = css.replace('--serif:Georgia,"Times New Roman",serif', '--serif:var(--font-accent)')
    return re.sub(r'\bGeorgia(,\s*serif)?', 'var(--font-accent)', css)


def build_v2(base: str) -> str:
    main = []
    for attr, topic in V2_SECTIONS:
        m = re.search(r'<section\b[^>]*%s[^>]*>' % re.escape(attr), base)
        if not m:
            raise SystemExit(f'v2: the design has no section {attr} ({topic})')
        main.append(base[m.start():element_span(base, m.start(), 'section')])
    page = '<main id="main-content">' + '\n'.join(main) + '</main>'
    for old, new in V2_ANCHORS.items():
        page = page.replace(f'href="{old}"', f'href="{new}"')
    for old, new in V2_CLAIMS:
        if page.count(old) != 1:
            raise SystemExit(f'v2: expected once: {old[:60]}')
        page = page.replace(old, new)
    # The lifecycle strip in the finance section; the booking
    # widget (BookingCard) between the hero and the first section, as on the
    # platform page (owner, 30 October 2026).
    # The finance lifecycle follows the section's introduction, directly above the financial workspace.
    m = re.search(r'<div class="finance-intro">', page)
    end = element_span(page, m.start(), 'div')
    page = page[:end] + V2_LIFECYCLE + page[end:]
    m = re.search(r'<section\b[^>]*id="unified-platform"', page)
    end = element_span(page, m.start(), 'section')
    page = page[:end] + V2_HOW + page[end:]
    # The corporate demonstration shows workflows, not a growth curve that would read as results.
    page, n = re.subn(r'<div class="chart"><svg.*?</svg></div>', '', page, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('v2: the corporate chart was not found')
    # The ecosystem keeps its core, four capabilities and their detail; the lifecycle appears once (How
    # FlyttGo works), and the boundary and principles become one sentence.
    for cls in ('ecosystem-flow', 'ecosystem-boundary', 'ecosystem-principles'):
        m = re.search(r'<div class="%s">' % cls, page)
        if not m:
            raise SystemExit(f'v2: no {cls}')
        page = page[:m.start()] + (V2_ECO_NOTE if cls == 'ecosystem-principles' else '') + page[element_span(page, m.start(), 'div'):]
    page = related(page)
    page = re.sub(r'<img(?![^>]*\bloading=)', '<img loading="lazy" decoding="async"', page)
    m = re.search(r'<section\b[^>]*class="hero wrap"', page)
    end = element_span(page, m.start(), 'section')
    page = page[:end] + V2_BOOKING + page[end:]
    for old, new in V2_VOICE + [pair for group in V2_POLISH for pair in group]:
        if page.count(old) != 1:
            raise SystemExit(f'v2 voice: expected once: {old[:60]}')
        page = page.replace(old, new)
    return page


# The former homepage's colours (owner, 2026-10-30): navy #1A365D for dark
# sections and buttons, emerald for accents and calls to action, white for
# the light grounds. Each colour of the design moves by its hue family:
# dark greens to navy, mid greens and golds to emerald, the ivory and
# green-tinted greys to white and slate. Lightness is kept, so contrast is.
import colorsys


# The restructured page takes near-black, white and neutral greys with one
# violet accent (owner, 30 October 2026, after gold, green all over, navy and
# blue, and architectpro.co's indigo and lavender). The platform page keeps
# emerald. Each entry is (hue, saturation).
PALETTES = {
    'emerald': {'accent': (160, 0.90), 'mid': (160, 0.84), 'beige': (152, 0.55), 'dark': (214, 0.56), 'tint': (214, 0.30), 'grey': (215, 0.20)},
    'violet': {'accent': (246, 0.86), 'mid': (246, 0.80), 'beige': (246, 0.45), 'dark': (246, 0.38), 'tint': (246, 0.22), 'grey': (246, 0.12)},
    # Near-black and neutral greys with a single violet accent (owner, 30 October 2026: "is black also good?").
    'ink': {'accent': (246, 0.86), 'mid': (246, 0.80), 'beige': (240, 0.10), 'dark': (240, 0.10), 'tint': (240, 0.08), 'grey': (240, 0.06)},
    # The established FlyttGo palette with disciplined roles (owner's art-direction brief, 30 October
    # 2026): dark grounds in deep blue #203F68, accents in forest #24513B, gold kept for hairlines and
    # numerals (gold text on light grounds becomes deep blue in readable_css), ivory grounds.
    'brand': {'accent': (40, 0.42), 'mid': (150, 0.38), 'beige': (45, 0.33), 'dark': (214, 0.53), 'tint': (45, 0.33), 'grey': (40, 0.07)},
}
EMERALD, VIOLET, INK, BRAND = 'emerald', 'violet', 'ink', 'brand'


def recolour(r: int, g: int, b: int, palette: str = EMERALD) -> tuple[int, int, int]:
    pal = PALETTES[palette]
    h, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    deg = h * 360
    if sat < 0.06 and (l > 0.97 or l < 0.08):
        return r, g, b                                   # white and black stay
    nl = l
    if 25 <= deg < 70 and sat > 0.2:                     # golds -> the accent (readable on white); beiges -> its palest tint
        (nh, ns), nl = (pal['accent'], l if palette == BRAND else min(l, 0.34)) if l < 0.8 else (pal['beige'], l)
    elif 70 <= deg < 190 and l < 0.42 and sat > 0.12:    # dark greens -> navy or indigo
        nh, ns = pal['dark']
    elif 70 <= deg < 190 and sat > 0.25:                 # mid greens -> the accent
        nh, ns = pal['mid']
    elif l > 0.86:                                       # ivory and pale green-greys -> white / a pale tint
        th, ts = pal['tint']
        return (255, 255, 255) if l > 0.95 else tuple(round(x * 255) for x in colorsys.hls_to_rgb(th / 360, l, ts))
    else:                                                # green-tinted greys -> cool greys
        nh, ns = pal['grey'][0], min(sat, pal['grey'][1])
    return tuple(round(x * 255) for x in colorsys.hls_to_rgb(nh / 360, nl, ns))


# Readability on the restructured page (owner, 30 October 2026: "letters cannot
# be readable"). The design sets much of its small print in pale grey-greens and
# golds at 8-10px. Text colours that fall short of 4.5:1 on the page's light
# grounds are darkened in their own hue until they reach 7:1, for crisp dark text
# like the owner's reference; light colours made for dark grounds are left alone.
# Text below 11px is raised to 11px.
READABLE_GROUND = (232, 228, 216)                    # the darkest light ground on the page (ivory, after recolouring)
GOLD_TEXT_TO = (32, 63, 104)                         # gold text on light grounds becomes deep blue #203F68: never gold or brown text on ivory


def _lum(c: tuple) -> float:
    f = lambda x: x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = (f(v / 255) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: tuple, b: tuple) -> float:
    x, y = sorted((_lum(a), _lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


READABLE_TARGET = 7.0                                # crisp, dark text (owner, 30 October 2026), above the 4.5:1 minimum


def _readable(c: tuple) -> tuple:
    h, l, sat = colorsys.rgb_to_hls(*(v / 255 for v in c))
    if GOLD_TEXT_TO and l <= 0.8 and 25 <= h * 360 < 70 and sat > 0.2:
        return GOLD_TEXT_TO                              # never gold or brown text on ivory: it reads faded
    if l > 0.8 or _contrast(c, READABLE_GROUND) >= READABLE_TARGET:
        return c
    while l > 0 and _contrast(c, READABLE_GROUND) < READABLE_TARGET:
        l -= 0.01
        c = tuple(round(v * 255) for v in colorsys.hls_to_rgb(h, l, sat))
    return c


def readable_css(css: str) -> str:
    def colour(m: re.Match) -> str:
        v = m.group(2)
        hx = re.fullmatch(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})', v)
        rg = re.fullmatch(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,[^)]*)?\)', v)
        if hx:
            h6 = hx.group(1) if len(hx.group(1)) == 6 else ''.join(ch * 2 for ch in hx.group(1))
            c = tuple(int(h6[i:i + 2], 16) for i in (0, 2, 4))
            return m.group(1) + '#%02x%02x%02x' % _readable(c)
        if rg and not rg.group(4):
            return m.group(1) + 'rgb(%d,%d,%d)' % _readable(tuple(int(x) for x in rg.group(1, 2, 3)))
        return m.group(0)

    def size(m: re.Match) -> str:
        return f'{m.group(1)}{max(float(m.group(2)), 11):g}px'

    css = re.sub(r'((?<![-\w])color:\s*)(#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\))', colour, css)
    css = re.sub(r'(font-size:\s*)(\d+(?:\.\d+)?)px', size, css)
    return re.sub(r'(font:\s*(?:\d{3}\s+|italic\s+|normal\s+)*)(\d+(?:\.\d+)?)px', size, css)


def _split_decls(block: str) -> list[str]:
    """Declarations of one rule, split on ';' outside parentheses and quotes (data URIs keep theirs)."""
    out, cur, depth, quote = [], [], 0, ''
    for ch in block:
        if quote:
            quote = '' if ch == quote else quote
        elif ch in '"\'':
            quote = ch
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        elif ch == ';' and depth == 0:
            out.append(''.join(cur).strip())
            cur = []
            continue
        cur.append(ch)
    out.append(''.join(cur).strip())
    return [d for d in out if d]


def dedupe_css(css: str) -> str:
    """Removes what the design file's older generations of rules leave behind (owner's critique, 30
    October 2026: several generations of the same rules, later ones silently overriding earlier ones).
    Every rule stays where it is. A declaration is removed only when a later rule with the same selector,
    in the same scope (top level or the same @media condition), sets the same property and would win
    anyway (an !important one is kept unless the later one is !important too). Rules left empty go.
    The rendered page is unchanged; build checks compare it pixel for pixel."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    entries: list[dict] = []                              # in order: {'scope', 'block', 'sel', 'decls'}
    i, n, scope, block = 0, len(css), '', 0
    while i < n:
        if css[i].isspace():
            i += 1
            continue
        if css[i] == '}':
            scope, i = '', i + 1
            continue
        j = css.find('{', i)
        if j < 0:
            break
        prelude = css[i:j].strip()
        if prelude.startswith('@media'):
            scope, block, i = ' '.join(prelude.split()), block + 1, j + 1
            continue
        if prelude.startswith('@'):
            raise SystemExit(f'dedupe_css: unsupported at-rule {prelude[:40]}')
        k = css.find('}', j)
        entries.append({'scope': scope, 'block': block if scope else 0, 'sel': prelude, 'decls': _split_decls(css[j + 1:k])})
        i = k + 1
    prop = lambda d: d.split(':', 1)[0].strip().lower()
    important = lambda d: d.replace(' ', '').lower().endswith('!important')
    later: dict[tuple[str, str], dict[str, bool]] = {}    # (scope, selector) -> property -> set !important later
    for e in reversed(entries):
        seen = later.setdefault((e['scope'], e['sel']), {})
        kept = []
        for d in reversed(e['decls']):
            p_, imp = prop(d), important(d)
            if p_ in seen and (seen[p_] or not imp):
                continue                                  # overridden by a later rule for the same selector
            kept.append(d)
            seen[p_] = seen.get(p_, False) or imp
        e['decls'] = list(reversed(kept))
    out, open_block = [], None
    for e in entries:
        if not e['decls']:
            continue
        if e['block'] != open_block:
            if open_block:
                out.append('}')
            if e['block']:
                out.append(e['scope'] + '{')
            open_block = e['block']
        out.append(f"{e['sel']}{{{';'.join(e['decls'])}}}")
    if open_block:
        out.append('}')
    return '\n'.join(out)


def recolour_css(css: str, palette: str = EMERALD) -> str:
    def hexrep(m: re.Match) -> str:
        v = m.group(1)
        if len(v) == 3:
            v = ''.join(c * 2 for c in v)
        r, g, b = (int(v[i:i + 2], 16) for i in (0, 2, 4))
        return '#%02x%02x%02x' % recolour(r, g, b, palette)

    def rgbrep(m: re.Match) -> str:
        r, g, b = (int(x) for x in m.group(2, 3, 4))
        nr, ng, nb = recolour(r, g, b, palette)
        return f'{m.group(1)}({nr},{ng},{nb}{m.group(5)})'

    css = re.sub(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b', hexrep, css)
    return re.sub(r'(rgba?)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,[^)]*)?\)', lambda m: rgbrep(m) if True else m.group(0), css)


# ── Norwegian (owner, 2026-10-30) ───────────────────────────────────────────
# scripts/platform-home/no.json maps each English text of the page (HTML text,
# placeholder/aria-label/title/alt, and the scripts' visible strings) to its
# Bokmål. `build.py --strings` writes the list to translate
# (scripts/platform-home/strings.json); the build fails while any is missing.
NO_JSON = Path(__file__).with_name('no.json')
STRINGS_JSON = Path(__file__).with_name('strings.json')
LETTER = re.compile(r'[A-Za-zÆØÅæøå]')
ATTRS = ('placeholder', 'aria-label', 'title', 'alt')
KEY_NAMES = {'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Home', 'End', 'Tab'}
JS_LITERAL = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"")


def norm(t: str) -> str:
    return re.sub(r'\s+', ' ', htmlmod.unescape(t)).strip()


def html_strings(body: str):
    for m in re.finditer(r'>([^<>]+)<', body):
        t = norm(m.group(1))
        if LETTER.search(t):
            yield t
    for m in re.finditer(r'\b(?:%s)="([^"]*)"' % '|'.join(ATTRS), body):
        t = norm(m.group(1))
        if LETTER.search(t):
            yield t


def js_visible(t: str) -> bool:
    """A string literal a visitor reads (not a selector, key or class name)."""
    if not LETTER.search(t) or t[:1] in '#.[' or '<' in t or '=' in t or t in KEY_NAMES:
        return False
    return ' ' in t or t[:1].isupper() or '·' in t


def js_strings(js: str):
    for m in JS_LITERAL.finditer(js):
        t = m.group(1) if m.group(1) is not None else m.group(2)
        if js_visible(t):
            yield t


def translate_html(body: str, no: dict, missing: set) -> str:
    def tr(t: str) -> str | None:
        k = norm(t)
        if not LETTER.search(k):
            return None
        if k not in no:
            missing.add(k)
            return None
        return no[k]

    def text(m: re.Match) -> str:
        raw = m.group(1)
        v = tr(raw)
        if v is None:
            return m.group(0)
        lead = raw[:len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()):]
        return '>' + lead + htmlmod.escape(v, quote=False) + trail + '<'

    def attr(m: re.Match) -> str:
        v = tr(m.group(2))
        return m.group(0) if v is None else f'{m.group(1)}="{htmlmod.escape(v)}"'

    body = re.sub(r'>([^<>]+)<', text, body)
    return re.sub(r'\b(%s)="([^"]*)"' % '|'.join(ATTRS), attr, body)


def translate_js(js: str, no: dict, missing: set) -> str:
    def lit(m: re.Match) -> str:
        single = m.group(1) is not None
        t = m.group(1) if single else m.group(2)
        if not js_visible(t):
            return m.group(0)
        if t not in no:
            missing.add(t)
            return m.group(0)
        q = "'" if single else '"'
        return q + no[t].replace('\\', '\\\\').replace(q, '\\' + q) + q
    return JS_LITERAL.sub(lit, js)


def main() -> int:
    src = soften(SRC.read_text(encoding='utf-8'))
    css = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', src, re.S))
    body = re.search(r'<body[^>]*>(.*)</body>', src, re.S).group(1)
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', src, re.S)
    body = re.sub(r'<script.*?</script>', '', body, flags=re.S).strip()
    # Style blocks inside the body are already in design.css (scoped).
    body = re.sub(r'<style\b.*?</style>', '', body, flags=re.S)
    # FlyttGo's own footer replaces the design's (owner, 2026-10-30).
    body = re.sub(r'<footer\b.*?</footer>', '', body, flags=re.S)
    base = header_places(old_pictures(body))
    body = booking_card(base)
    body, used = wire_links(body)
    v2, _ = wire_links(build_v2(base))

    # The booking form is handled by the app (real address lookup and booking),
    # so the design's placeholder submit handler is left out.
    first = scripts[0]
    start = first.index("const bookingForm=document.getElementById('booking-form');")
    end = first.index("document.querySelectorAll('a[href^=\"#\"]')")
    scripts[0] = first[:start] + first[end:]

    OUT.mkdir(parents=True, exist_ok=True)
    if '--strings' in sys.argv:
        seen: dict[str, None] = {}
        for t in list(html_strings(body)) + list(html_strings(v2)) + [t for sc in scripts for t in js_strings(sc)]:
            seen.setdefault(t, None)
        import json
        STRINGS_JSON.write_text(json.dumps(list(seen), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print(f'{len(seen)} strings written to {STRINGS_JSON.relative_to(ROOT)}')
        return 0

    def write(suffix: str, page: str, scs: list[str], lang: str) -> None:
        header = f'<!-- Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html ({lang}). Do not edit. -->\n'
        (OUT / f'design{suffix}.html').write_text(header + page + '\n', encoding='utf-8')
        js = ['// Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html (' + lang + ').',
              '// The design\'s own scripts (menu, tabs, previews), run once the page is in the document. Do not edit.',
              '/* eslint-disable */', '// @ts-nocheck', 'export function initDesign() {']
        for i, sc in enumerate(scs):
            js.append(f'  /* ── script {i + 1} ── */')
            # Each script on its own: a script for a section a page leaves out stops there, not the rest.
            js.append('  try {' + sc.strip() + '\n  } catch { /* its section is not on this page */ }')
        js.append('}')
        (OUT / f'design-scripts{suffix}.ts').write_text('\n'.join(js) + '\n', encoding='utf-8')

    write('', body, scripts, 'English')
    (OUT / 'design.css').write_text(
        '/* Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html.\n'
        ' * The design\'s styles, scoped under .fgp, in FlyttGo\'s navy, emerald and white. Do not edit. */\n' + recolour_css(scope_css(css)) + '\n', encoding='utf-8')

    import json
    no = json.loads(NO_JSON.read_text(encoding='utf-8')) if NO_JSON.exists() else {}
    missing: set[str] = set()
    body_no = translate_html(body, no, missing)
    scripts_no = [translate_js(sc, no, missing) for sc in scripts]
    if missing:
        print(f'no.json lacks {len(missing)} strings, e.g. {sorted(missing)[:5]}; the Norwegian page is not written', file=sys.stderr)
        return 1
    write('.no', body_no, scripts_no, 'Norwegian')
    V2_OUT.mkdir(parents=True, exist_ok=True)
    v2_head = '<!-- Generated by scripts/platform-home/build.py (restructured homepage, {}). Do not edit. -->\n'
    (V2_OUT / 'design.v2.html').write_text(v2_head.format('English') + v2 + '\n', encoding='utf-8')
    v2_no = translate_html(v2, no, missing)
    # Text inputs' starting values are visible too (the studio copies them into its preview);
    # restructured page only, so the platform page's output is unchanged.
    v2_no = re.sub(r'(<input\b[^>]*type="text"[^>]*\bvalue=")([^"]*)"',
                   lambda m: m.group(1) + htmlmod.escape(no.get(norm(m.group(2)), m.group(2))) + '"', v2_no)
    if missing:
        print(f'no.json lacks {len(missing)} strings of the restructured page, e.g. {sorted(missing)}', file=sys.stderr)
        return 1
    (V2_OUT / 'design.v2.no.html').write_text(v2_head.format('Norwegian') + v2_no + '\n', encoding='utf-8')
    (V2_OUT / 'design.v2.css').write_text(
        '/* Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html.\n'
        ' * The design\'s styles, scoped under .fgv2, in the FlyttGo palette with disciplined roles (deep blue,\n'
        ' * forest, gold hairlines, ivory; owner, 30 October 2026), then made readable. Do not edit. */\n'
        + type_vars(dedupe_css(readable_css(recolour_css(scope_css(css, '.fgv2'), BRAND)))) + '\n', encoding='utf-8')
    print(f'design.html {len(body)} chars, design.css, design-scripts.ts ({len(scripts)} scripts); links wired:')
    for u in used:
        print('  ' + u)
    return 0


if __name__ == '__main__':
    sys.exit(main())
