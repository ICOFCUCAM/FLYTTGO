/**
 * Visual and interaction check for the restructured homepage (/preview/home) and its design lab
 * (/preview/lab). Run against a served build:
 *
 *   node scripts/platform-home/visual-check.cjs [baseUrl] [--baseline]
 *
 * For 1440, 1280, 820 and 390 px it takes a full-page screenshot into .visual-check/current,
 * reports anything wider than the viewport, the smallest text and console errors, and compares
 * each screenshot with .visual-check/baseline (pixel difference in the browser; --baseline saves
 * the current run as the new baseline). It then follows the example job through the business
 * and financial workspaces, steps the transaction explorer, changes every Marketplace Studio
 * control and opens the lab. It exits non-zero on a failed check. Uses the pre-installed
 * Playwright; nothing is installed.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.argv.find(a => a.startsWith('http')) || 'http://localhost:4173';
const saveBaseline = process.argv.includes('--baseline');
const out = path.resolve('.visual-check');
const VIEWPORTS = [[1440, 900], [1280, 800], [820, 1180], [390, 844]];
const failures = [];
const fail = m => { failures.push(m); console.log('  ✗', m); };
const ok = m => console.log('  ✓', m);

async function open(browser, w, h, url = '/preview/home') {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    try { localStorage.setItem('flyttgo_cookie_consent', JSON.stringify({ necessary: true, analytics: false })); } catch { /* */ }
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return { page, errors };
}

async function diff(page, a, b) {
  const [x, y] = [a, b].map(f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
  return page.evaluate(async ([x, y]) => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const [i, j] = await Promise.all([load(x), load(y)]);
    if (i.width !== j.width || Math.abs(i.height - j.height) > 2) return { size: true, ratio: 1, h: [i.height, j.height] };
    const c = document.createElement('canvas'); c.width = i.width; c.height = Math.min(i.height, j.height);
    const g = c.getContext('2d');
    g.drawImage(i, 0, 0); const p = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(j, 0, 0); const q = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let k = 0; k < p.length; k += 4) if (Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]) > 48) n++;
    return { size: false, ratio: n / (p.length / 4) };
  }, [x, y]);
}

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(path.join(out, 'current'), { recursive: true });

  for (const [w, h] of VIEWPORTS) {
    console.log(`\n${w} × ${h}`);
    const { page, errors } = await open(browser, w, h);
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, root = document.querySelector('.fgv2');
      let minFont = 99;
      root.querySelectorAll('*').forEach(n => {
        if ([...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()) && n.getBoundingClientRect().width) minFont = Math.min(minFont, parseFloat(getComputedStyle(n).fontSize));
      });
      return { pageOverflow: document.documentElement.scrollWidth > vw, minFont, slides: root.querySelectorAll('.fgp-slides img').length,
        booking: !!root.querySelector('[data-slot="booking"] *'), hero: root.dataset.hero };
    });
    m.pageOverflow ? fail('page wider than the viewport') : ok('no horizontal overflow');
    m.minFont >= 11 ? ok(`smallest text ${m.minFont}px`) : fail(`text at ${m.minFont}px`);
    m.slides > 1 ? ok(`hero slideshow (${m.slides} pictures)`) : fail('hero slideshow missing');
    m.booking ? ok('booking widget rendered') : fail('booking widget missing');
    const shot = path.join(out, 'current', `home-${w}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const baseShot = path.join(out, 'baseline', `home-${w}.png`);
    if (fs.existsSync(baseShot) && !saveBaseline) {
      const d = await diff(page, shot, baseShot);
      d.size ? console.log(`  • page height changed from the baseline (${d.h.join(' → ')})`) : console.log(`  • ${(d.ratio * 100).toFixed(2)}% of pixels differ from the baseline`);
    }
    errors.length ? fail(`console errors: ${errors.slice(0, 3).join(' | ')}`) : ok('no console errors');
    await page.close();
  }

  console.log('\nInteractions (1440)');
  {
    const { page } = await open(browser, 1440, 900);
    const ws = page.locator('#business-workspace');
    (await page.locator('.hero h1').textContent()).includes('Book services') ? ok('selected headline shown') : fail('headline');
    await ws.scrollIntoViewIfNeeded();
    (await page.locator('.v2-trail').count()) ? ok('job trail under the workspace records') : fail('job trail missing');
    (await page.locator('.final-note:visible').count()) === 3 ? ok('closing journeys each say where they lead') : fail('closing notes');
    (await page.locator('.wl-search').count()) ? ok('storefront search shown') : fail('storefront search');
    const provider = page.locator('#driver-network .btn').first();
    const [fg, bg] = await provider.evaluate(b => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]);
    fg !== bg ? ok('provider action readable') : fail('provider action text matches its background');
    (await page.locator('.v2-activity li').count()) === 5 ? ok('team activity on the overview') : fail('team activity missing');
    await page.fill('.v2-bw-tools input', 'Strand');
    (await page.locator('#bw-panel-content .v2-records tbody tr:visible').count()) === 1 ? ok('workspace search filters the records') : fail('workspace search');
    await page.locator('.v2-bw-new').click();
    (await page.locator('#bw-panel-content').textContent()).match(/New booking · draft|Ny bestilling/) ? ok('“New booking” adds a draft booking') : fail('new booking');
    (await page.locator('#bw-panel-content').textContent()).match(/Project|Prosjekt/) && (await page.locator('#bw-panel-content').textContent()).match(/Appointment|Avtale/) ? ok('bookings tell appointments, jobs and projects apart') : fail('booking types');
    await page.locator('[data-v2-trail-go]').first().click();
    await page.waitForTimeout(600);
    const pressed = await page.locator('.v2-explorer [aria-pressed="true"]').textContent().catch(() => '');
    /Invoice|Faktura/.test(pressed || '') ? ok('“See it in finance” opens the explorer at the invoice') : fail('trail did not reach the finance explorer');
    const steps = await page.locator('.v2-explorer button').count();
    const titles = [];
    for (let i = 0; i < steps; i++) { await page.locator('.v2-explorer button').nth(i).click(); titles.push(await page.locator('#finance-doc-title').textContent()); }
    new Set(titles).size === 6 ? ok('explorer: six steps, six documents') : fail(`explorer documents: ${titles.join(' / ')}`);
    const voucher = await (async () => { await page.locator('.v2-explorer button').nth(3).click(); return page.locator('#finance-doc-content').textContent(); })();
    /1500/.test(voucher) && /3000/.test(voucher) && /2700/.test(voucher) ? ok('voucher posts 1500 / 3000 / 2700') : fail('voucher accounts missing');

    const studio = page.locator('#white-label-builder');
    await studio.scrollIntoViewIfNeeded();
    await page.fill('#wl-name', 'Fjord Hjelp');
    const mark = await page.locator('#wl-mark-el').textContent();
    const addr = await page.locator('#wl-address').textContent();
    mark === 'FH' && addr === 'fjord-hjelp.flyttgo.no' ? ok('studio: name drives the mark and the address') : fail(`studio mark/address: ${mark} ${addr}`);
    await page.selectOption('#wl-domain-mode', 'own');
    (await page.locator('#wl-address').textContent()) === 'fjord-hjelp.no' ? ok('studio: own domain') : fail('studio domain mode');
    await page.selectOption('#wl-style', 'editorial');
    (await page.locator('.wl-storefront').getAttribute('data-style')) === 'editorial' ? ok('studio: storefront style') : fail('studio style');
    const before = await page.locator('#wl-category-grid article:visible').count();
    await page.locator('#wl-cat-toggles input').first().uncheck();
    (await page.locator('#wl-category-grid article:visible').count()) === before - 1 ? ok('studio: category toggle hides a category') : fail('studio categories');
    const pay0 = await page.locator('#wl-pay-line').textContent();
    await page.selectOption('#wl-payments', 'a');
    (await page.locator('#wl-pay-line').textContent()) !== pay0 ? ok('studio: booking and payment model') : fail('studio payments');
    await page.close();
  }

  console.log('\nThe new design\'s pages (1440)');
  {
    const pages = { '/': 9, '/my-company': 2, '/my-company/finance': 1, '/industries': 1, '/how-it-works': 3, '/moving': 5 };
    for (const [path, count] of Object.entries(pages)) {
      const { page, errors } = await open(browser, 1440, 900, path);
      const n = await page.locator('.fgv2 main > section, .fgv2 main > .v2-booking').count();
      const h1 = await page.locator('h1').count();
      n === count && h1 >= 1 && !errors.length ? ok(`${path}: ${n} sections, a page heading, no errors`) : fail(`${path}: ${n} sections (expected ${count}), ${h1} h1, ${errors.length} errors`);
      await page.close();
    }
  }

  console.log('\nDesign lab');
  {
    const { page, errors } = await open(browser, 1600, 1000, '/preview/lab');
    (await page.locator('h1').textContent()).includes('Design Refinement Studio') ? ok('studio opens on a preview host') : fail('studio did not open');
    (await page.locator('meta[name="robots"][content*="noindex"]').count()) ? ok('lab is noindex') : fail('lab indexable');
    await page.waitForSelector('text=/Clean|Findings|Harmed/', { timeout: 30000 }).then(() => ok('frame inspected in the browser and reported back'), () => fail('frame did not report'));
    await page.getByRole('button', { name: 'Inspect A' }).click();
    await page.getByRole('button', { name: 'Inspect the rendered page' }).click();
    await page.waitForSelector('text=/No findings|serious|medium|low/', { timeout: 30000 }).then(() => ok('inspection report rendered'), () => fail('inspection report missing'));
    await page.getByRole('button', { name: 'Run the interaction check' }).click();
    await page.waitForSelector('text=/controls respond/', { timeout: 90000 }).then(async () => {
      const t = await page.locator('text=/controls respond/').textContent(); ok(`interaction check: ${t.replace('Interaction check · ', '')}`);
    }, () => fail('interaction check did not finish'));
    await page.getByRole('button', { name: 'Compare A/B/C' }).click();
    await page.getByRole('button', { name: 'Add frame' }).click();
    (await page.locator('iframe').count()) === 2 ? ok('two frames compared') : fail('add frame');
    await page.getByRole('button', { name: 'Components' }).click();
    (await page.locator('.fgv2 .btn-primary').count()) ? ok('component library renders') : fail('component library');
    await page.getByRole('button', { name: 'Versions' }).click();
    (await page.locator('text=APPROVED').count()) ? ok('versions list with the approved version') : fail('versions');
    errors.length ? fail(`lab console errors: ${errors.slice(0, 3).join(' | ')}`) : ok('no lab console errors');
    await page.close();
  }

  if (saveBaseline) {
    fs.rmSync(path.join(out, 'baseline'), { recursive: true, force: true });
    fs.cpSync(path.join(out, 'current'), path.join(out, 'baseline'), { recursive: true });
    console.log('\nBaseline saved.');
  }
  await browser.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
  process.exit(failures.length ? 1 : 0);
})();
