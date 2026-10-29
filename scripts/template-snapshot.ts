// ============================================================================
// FlyttGo — settle a template page before its scripts are removed
// ============================================================================
//
// Architect-AI's pages draw part of themselves with a small script: sections
// fade in on scroll (.reveal and others), star ratings and counters are
// filled in, tabs are set. FlyttGo serves pages without scripts, so the
// importer first opens each page in a headless browser with reduced motion
// (each script then shows everything at once, in its final state), with
// every network request refused, and keeps the page as it ends up.
//
// visibleChars() is the check afterwards: the cleaned page, shown with
// scripts off, must show (nearly) all the text the scripted page shows;
// otherwise the importer flags the page as 'hidden' for review.
//
// Needs Playwright (the `playwright` package and a Chromium). Without it the
// importer warns and imports without the snapshot (the serve step still
// shows `.reveal` content).
// ============================================================================

type Page = {
  setContent(html: string, o?: { waitUntil?: string }): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  route(url: string, handler: (r: { abort(): Promise<void> }) => Promise<void>): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: Record<string, unknown>): Promise<Context>; close(): Promise<void> };

export interface Snapshotter {
  /** The page after its scripts have run, as HTML (scripts still in it). */
  settle(html: string): Promise<string>;
  /** Characters of text a visitor can see on the page (opacity 0, hidden and display none left out). */
  visibleChars(html: string, scripts: boolean): Promise<number>;
  close(): Promise<void>;
}

export async function snapshotter(): Promise<Snapshotter | null> {
  let chromium: { launch(o?: Record<string, unknown>): Promise<Browser> };
  try {
    ({ chromium } = await import('playwright') as unknown as { chromium: typeof chromium });
  } catch {
    return null;
  }
  const browser = await chromium.launch();
  const open = async (scripts: boolean) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', javaScriptEnabled: scripts, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.abort());
    return { ctx, page };
  };
  return {
    async settle(html) {
      const { ctx, page } = await open(true);
      try {
        await page.setContent(html, { waitUntil: 'load' });
        // Scroll through for scripts that wait to be seen, then let timers end.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 30));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(1600);
        return await page.evaluate(() => {
          const d = document.doctype;
          const doctype = d ? `<!DOCTYPE ${d.name}>\n` : '<!DOCTYPE html>\n';
          return doctype + document.documentElement.outerHTML;
        });
      } finally {
        await ctx.close();
      }
    },
    async visibleChars(html, scripts) {
      const { ctx, page } = await open(scripts);
      try {
        await page.setContent(html, { waitUntil: 'load' });
        if (scripts) await page.waitForTimeout(1600);
        return await page.evaluate(() => {
          let n = 0;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const seen = new Map<Element, boolean>();
          const shown = (el: Element | null): boolean => {
            if (!el || el === document.documentElement) return true;
            const known = seen.get(el);
            if (known !== undefined) return known;
            const cs = getComputedStyle(el);
            const v = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && shown(el.parentElement);
            seen.set(el, v);
            return v;
          };
          for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            const text = (t.textContent ?? '').replace(/\s+/g, '');
            if (text && shown(t.parentElement)) n += text.length;
          }
          return n;
        });
      } finally {
        await ctx.close();
      }
    },
    async close() { await browser.close(); },
  };
}
