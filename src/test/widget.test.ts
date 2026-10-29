import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WIDGET_RESIZE_MESSAGE, embedSlug, frameAncestors, isAllowedParent, isValidWidgetOrigin, normalizeOrigin, parentOrigin, widgetSnippet,
} from '../../supabase/functions/_shared/widget.ts';

const widgetJs = readFileSync(new URL('../../public/widget.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/00018_api_keys.sql', import.meta.url), 'utf8');

describe('the widget\'s websites', () => {
  it('are origins: https without a path, or localhost for testing (as is_valid_widget_origin)', () => {
    for (const ok of ['https://www.acme.no', 'https://acme.no:8443', 'https://booking.acme-flytt.no', 'http://localhost:5173', 'http://127.0.0.1']) {
      expect(isValidWidgetOrigin(ok), ok).toBe(true);
    }
    for (const bad of ['http://acme.no', 'https://acme.no/booking', 'https://*.acme.no', 'javascript:alert(1)', 'https://acme', 'acme.no',
                       'https://ACME.no', 'https://acme.no/', '']) {
      expect(isValidWidgetOrigin(bad), bad).toBe(false);
    }
    /* The same patterns as the database (written there with SQL escapes). */
    expect(migration).toContain(`'^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9](:[0-9]{1,5})?$'`);
    expect(migration).toContain(`'^http://(localhost|127\\.0\\.0\\.1)(:[0-9]{1,5})?$'`);
  });

  it('are stored as the database normalises them', () => {
    expect(normalizeOrigin(' HTTPS://www.Acme.no/ ')).toBe('https://www.acme.no');
    expect(normalizeOrigin(null)).toBe('');
  });

  it('make the frame-ancestors header: FlyttGo itself and the valid websites', () => {
    expect(frameAncestors([])).toBe("frame-ancestors 'self'");
    expect(frameAncestors(['https://www.acme.no', 'https://acme.no/', 'bad value', 'https://www.acme.no']))
      .toBe("frame-ancestors 'self' https://acme.no https://www.acme.no");
  });
});

describe('the embed page', () => {
  it('serves /embed/<slug> only', () => {
    expect(embedSlug('/embed/acme')).toBe('acme');
    expect(embedSlug('/embed/acme-flytt/')).toBe('acme-flytt');
    expect(embedSlug('/embed/ac')).toBeNull();
    expect(embedSlug('/embed/acme/book')).toBeNull();
    expect(embedSlug('/b/acme')).toBeNull();
  });

  it('trusts the browser\'s parent first, then the referrer, then what the script claimed', () => {
    expect(parentOrigin({ ancestorOrigins: ['https://www.acme.no'], referrer: 'https://evil.example/x', claimed: 'https://x.no' }))
      .toBe('https://www.acme.no');
    expect(parentOrigin({ ancestorOrigins: [], referrer: 'https://www.acme.no/kontakt?x=1', claimed: 'https://x.no' })).toBe('https://www.acme.no');
    expect(parentOrigin({ referrer: 'not a url', claimed: 'https://Acme.no' })).toBe('https://acme.no');
    expect(parentOrigin({})).toBeNull();
  });

  it('shows the flow only inside a listed website or FlyttGo\'s own preview', () => {
    const allowed = ['https://www.acme.no'];
    expect(isAllowedParent('https://www.acme.no', allowed, 'https://flyttgo.no')).toBe(true);
    expect(isAllowedParent('https://flyttgo.no', allowed, 'https://flyttgo.no')).toBe(true);
    expect(isAllowedParent('https://acme.no', allowed, 'https://flyttgo.no')).toBe(false);
    expect(isAllowedParent('https://evil.example', allowed, 'https://flyttgo.no')).toBe(false);
    expect(isAllowedParent(null, allowed, 'https://flyttgo.no')).toBe(false);
  });

  it('gives the company a snippet with its slug', () => {
    const s = widgetSnippet('https://flyttgo.no/', 'acme');
    expect(s).toContain('<script src="https://flyttgo.no/widget.js" data-company="acme" data-target="#flyttgo-booking" async></script>');
    expect(s).toContain('<div id="flyttgo-booking"></div>');
  });
});

/* public/widget.js in a small stand-in for a browser page. */
function runWidget(attrs: Record<string, string>, pageOrigin = 'https://www.acme.no') {
  const listeners: ((e: { source: unknown; origin: string; data: unknown }) => void)[] = [];
  const inserted: Record<string, any>[] = [];
  const contentWindow = {};
  const script = {
    src: 'https://flyttgo.no/widget.js',
    attrs: { ...attrs } as Record<string, string>,
    getAttribute(n: string) { return this.attrs[n] ?? null; },
    setAttribute(n: string, v: string) { this.attrs[n] = v; },
    parentNode: { insertBefore: (el: Record<string, any>) => { inserted.push(el); } },
  };
  const target = { appendChild: (el: Record<string, any>) => { inserted.push(el); } };
  const document = {
    currentScript: script, baseURI: `${pageOrigin}/`,
    createElement: () => {
      const el: Record<string, any> = { style: {}, attributes: {} as Record<string, string>, contentWindow };
      el.setAttribute = (n: string, v: string) => { el.attributes[n] = v; };
      return el;
    },
    querySelector: (sel: string) => (sel === '#flyttgo-booking' ? target : null),
    querySelectorAll: () => [script],
  };
  const window = { location: { origin: pageOrigin }, addEventListener: (_: string, fn: any) => listeners.push(fn) };
  const consoleStub = { errors: [] as string[], error(m: string) { this.errors.push(m); } };
  new Function('window', 'document', 'console', widgetJs)(window, document, consoleStub);
  const send = (origin: string, data: unknown, source: unknown = contentWindow) => listeners.forEach(l => l({ source, origin, data }));
  return { frame: inserted[0], inserted, send, consoleStub };
}

describe('public/widget.js', () => {
  it('puts the company\'s embed page in a frame, telling it which website it is on', () => {
    const { frame, inserted } = runWidget({ 'data-company': 'acme', 'data-target': '#flyttgo-booking' });
    expect(inserted).toHaveLength(1);
    expect(frame.src).toBe('https://flyttgo.no/embed/acme?origin=https%3A%2F%2Fwww.acme.no');
    expect(frame.attributes.sandbox).toContain('allow-top-navigation-by-user-activation');
    expect(frame.attributes.sandbox).not.toMatch(/allow-top-navigation(\s|$)/);
    expect(frame.style.cssText).toContain('height:640px');
  });

  it('resizes only on messages from its own frame and FlyttGo\'s origin', () => {
    const { frame, send } = runWidget({ 'data-company': 'acme' });
    send('https://evil.example', { type: WIDGET_RESIZE_MESSAGE, height: 900 });
    send('https://flyttgo.no', { type: WIDGET_RESIZE_MESSAGE, height: 900 }, {});
    send('https://flyttgo.no', { type: 'other', height: 900 });
    send('https://flyttgo.no', { type: WIDGET_RESIZE_MESSAGE, height: 50 });
    expect(frame.style.height).toBeUndefined();
    send('https://flyttgo.no', { type: WIDGET_RESIZE_MESSAGE, height: 912.4 });
    expect(frame.style.height).toBe('912px');
  });

  it('needs a valid company slug, and runs once per script tag', () => {
    const { inserted, consoleStub } = runWidget({ 'data-company': 'Acme AS' });
    expect(inserted).toHaveLength(0);
    expect(consoleStub.errors[0]).toMatch(/data-company/);
    expect(runWidget({ 'data-company': 'acme', 'data-flyttgo-done': '1' }).inserted).toHaveLength(0);
  });

  it('has no dependencies and carries no key', () => {
    expect(widgetJs).not.toMatch(/\bimport\b|\brequire\(|fgo_[0-9a-f]/);
  });
});
