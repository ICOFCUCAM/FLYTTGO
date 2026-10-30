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
# brief's colours).
V2_OUT = ROOT / 'src' / 'components' / 'homeV2'
V2_SECTIONS = [                                   # (attribute in the section's opening tag, topic)
    ('class="hero wrap"', '1 hero'),
    ('id="entry-points"', '2 journeys'),
    ('id="unified-platform"', '3 one connected platform: four capabilities'),
    ('id="business-workspace"', '4 business operating platform'),
    ('id="financial-administration"', '5 financial management'),
    ('id="marketplace"', '6 marketplace categories'),
    ('id="white-label-builder"', '7 build your own marketplace'),
    ('id="marketplace-network-experience"', '8 connected network'),
    ('id="industry-experiences"', '9 industry workflows'),
    ('id="business"', '10 corporate solutions'),
    ('id="moving-services"', '11 moving services'),
    ('id="how-it-works"', '11 booking and tracking journey'),
    ('id="van-types"', '11 vehicle sizes (rates on the van guide)'),
    ('id="driver-network"', '11 driver network'),
    ('class="section testimonials"', '11 what every booking includes'),
    ('class="final-cta"', '12 final call to action'),
]
# Wording the code does not support, corrected (the audit's status table).
V2_CLAIMS = [
    ('Create a branded marketplace with your identity, domain, services and provider network.',
     'Create a branded booking site with your identity, domain, services and customers.'),
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
              '#top': '#main-content', '#booking': '#moving-services'}
V2_LIFECYCLE = ('<ol class="v2-lifecycle" aria-label="From booking to financial record">'
                + ''.join(f'<li><b>0{i + 1}</b>{t}</li>' for i, t in enumerate(
                    ['Booking', 'Quote', 'Job completed', 'Invoice', 'Payment', 'Financial record'])) + '</ol>')


def element_span(body: str, start: int, tag: str) -> int:
    """End index of the element opening at start (nested tags of the same name counted)."""
    depth = 0
    for m in re.finditer(r'<(/?)%s\b[^>]*>' % tag, body[start:]):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return start + m.end()
    raise SystemExit(f'unclosed <{tag}> at {start}')


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
    # The lifecycle strip at the head of the finance section; the booking
    # widget (BookingCard) under the moving services.
    page = re.sub(r'(<section\b[^>]*id="financial-administration"[^>]*>\s*<div class="wrap">)', r'\1' + V2_LIFECYCLE, page, count=1)
    m = re.search(r'<section\b[^>]*id="moving-services"', page)
    end = element_span(page, m.start(), 'section')
    page = page[:end] + '<div class="wrap v2-booking" data-slot="booking"></div>' + page[end:]
    return page


# The former homepage's colours (owner, 2026-10-30): navy #1A365D for dark
# sections and buttons, emerald for accents and calls to action, white for
# the light grounds. Each colour of the design moves by its hue family:
# dark greens to navy, mid greens and golds to emerald, the ivory and
# green-tinted greys to white and slate. Lightness is kept, so contrast is.
import colorsys


def recolour(r: int, g: int, b: int) -> tuple[int, int, int]:
    h, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    deg = h * 360
    if sat < 0.06 and (l > 0.97 or l < 0.08):
        return r, g, b                                   # white and black stay
    nl = l
    if 25 <= deg < 70 and sat > 0.2:                     # golds -> emerald-600 (readable on white); beiges -> emerald-50
        nh, ns = (160 / 360, 0.90) if l < 0.8 else (152 / 360, 0.55)
        nl = min(l, 0.34) if l < 0.8 else l
    elif 70 <= deg < 190 and l < 0.42 and sat > 0.12:    # dark greens -> navy
        nh, ns = 214 / 360, 0.56
    elif 70 <= deg < 190 and sat > 0.25:                 # mid greens -> emerald
        nh, ns = 160 / 360, 0.84
    elif l > 0.86:                                       # ivory and pale green-greys -> white / slate-50
        return (255, 255, 255) if l > 0.95 else tuple(round(x * 255) for x in colorsys.hls_to_rgb(214 / 360, l, 0.30))
    else:                                                # green-tinted greys -> slate
        nh, ns = 215 / 360, min(sat, 0.20)
    return tuple(round(x * 255) for x in colorsys.hls_to_rgb(nh, nl, ns))


def recolour_css(css: str) -> str:
    def hexrep(m: re.Match) -> str:
        v = m.group(1)
        if len(v) == 3:
            v = ''.join(c * 2 for c in v)
        r, g, b = (int(v[i:i + 2], 16) for i in (0, 2, 4))
        return '#%02x%02x%02x' % recolour(r, g, b)

    def rgbrep(m: re.Match) -> str:
        r, g, b = (int(x) for x in m.group(2, 3, 4))
        nr, ng, nb = recolour(r, g, b)
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
    if missing:
        print(f'no.json lacks {len(missing)} strings of the restructured page, e.g. {sorted(missing)[:5]}', file=sys.stderr)
        return 1
    (V2_OUT / 'design.v2.no.html').write_text(v2_head.format('Norwegian') + v2_no + '\n', encoding='utf-8')
    (V2_OUT / 'design.v2.css').write_text(
        '/* Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html.\n'
        ' * The design\'s styles, scoped under .fgv2, in its own palette (the restructured homepage). Do not edit. */\n'
        + scope_css(css, '.fgv2') + '\n', encoding='utf-8')
    print(f'design.html {len(body)} chars, design.css, design-scripts.ts ({len(scripts)} scripts); links wired:')
    for u in used:
        print('  ' + u)
    return 0


if __name__ == '__main__':
    sys.exit(main())
