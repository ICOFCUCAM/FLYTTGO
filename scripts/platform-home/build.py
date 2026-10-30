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


def scope_selector(s: str) -> str:
    if s in ('html', 'body', ':root', 'html body'):
        return '.fgp'
    for root in ('html ', 'body ', ':root '):
        if s.startswith(root):
            return '.fgp ' + s[len(root):]
    return '.fgp ' + s


def scope_css(css: str) -> str:
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    out = []
    for prelude, block in split_top(css):
        if prelude.startswith('@media') or prelude.startswith('@supports') or prelude.startswith('@container'):
            out.append(f'{prelude}{{{scope_css(block)}}}')
        elif prelude.startswith('@'):
            out.append(f'{prelude}{{{block}}}')     # @keyframes, @font-face
        else:
            sels = ','.join(scope_selector(s) for s in split_selectors(prelude))
            out.append(f'{sels}{{{block.strip()}}}')
    return '\n'.join(out)


def main() -> int:
    src = SRC.read_text(encoding='utf-8')
    css = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', src, re.S))
    body = re.search(r'<body[^>]*>(.*)</body>', src, re.S).group(1)
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', src, re.S)
    body = re.sub(r'<script.*?</script>', '', body, flags=re.S).strip()
    # FlyttGo's own footer replaces the design's (owner, 2026-10-30).
    body = re.sub(r'<footer\b.*?</footer>', '', body, flags=re.S)
    body, used = wire_links(body)

    # The booking form is handled by the app (real address lookup and booking),
    # so the design's placeholder submit handler is left out.
    first = scripts[0]
    start = first.index("const bookingForm=document.getElementById('booking-form');")
    end = first.index("document.querySelectorAll('a[href^=\"#\"]')")
    scripts[0] = first[:start] + first[end:]

    OUT.mkdir(parents=True, exist_ok=True)
    header = '<!-- Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html. Do not edit. -->\n'
    (OUT / 'design.html').write_text(header + body + '\n', encoding='utf-8')
    (OUT / 'design.css').write_text(
        '/* Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html.\n'
        ' * The design\'s styles, scoped under .fgp. Do not edit. */\n' + scope_css(css) + '\n', encoding='utf-8')
    js = ['// Generated by scripts/platform-home/build.py from docs/flyttgo-premium-platform-homepage-stage-20.html.',
          '// The design\'s own scripts (menu, tabs, previews), run once the page is in the document. Do not edit.',
          '/* eslint-disable */', '// @ts-nocheck', 'export function initDesign() {']
    for i, s in enumerate(scripts):
        js.append(f'  /* ── script {i + 1} ── */')
        js.append('  {' + s.strip() + '\n  }')
    js.append('}')
    (OUT / 'design-scripts.ts').write_text('\n'.join(js) + '\n', encoding='utf-8')
    print(f'design.html {len(body)} chars, design.css, design-scripts.ts ({len(scripts)} scripts); links wired:')
    for u in used:
        print('  ' + u)
    return 0


if __name__ == '__main__':
    sys.exit(main())
