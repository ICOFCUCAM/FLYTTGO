/**
 * Moving services (layout B), owner 31 October 2026: the large picture stays in place while the list
 * of services scrolls past, and shows the photo of the service crossing a line a third of the way down the screen (or the
 * one hovered or focused), with that service's name as its caption. The photos are the ones each
 * service card already carries; nothing new is added. Phones show each service's own small photo
 * in the list instead (CSS). Under reduced motion the photo changes without a fade (CSS).
 */
export function installServiceScroll(el: HTMLElement): () => void {
  const grid = el.querySelector<HTMLElement>('#moving-services .service-grid');
  const cards = grid ? [...grid.querySelectorAll<HTMLElement>('.service-card')] : [];
  const feature = cards[0];
  const frame = feature?.querySelector<HTMLElement>('.photo');
  if (!grid || !feature || !frame || cards.length < 2 || !('IntersectionObserver' in window)) return () => {};

  /* One layer per service over the feature picture; the first is the feature's own photo. */
  const layers = cards.map((card, i) => {
    if (i === 0) { const own = frame.querySelector('img'); own?.classList.add('v2-svc-layer', 'is-on'); return own; }
    const src = card.querySelector<HTMLImageElement>('.photo img');
    if (!src) return null;
    const img = document.createElement('img');
    img.className = 'v2-svc-layer';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.dataset.src = src.currentSrc || src.src;
    frame.appendChild(img);
    return img;
  });
  const caption = document.createElement('div');
  caption.className = 'v2-svc-caption';
  caption.setAttribute('aria-hidden', 'true');
  feature.appendChild(caption);
  grid.classList.add('v2-svc-scroll');
  /* Room under the list (an empty last row the picture spans), so the picture stays on screen until the last service has reached the line. */
  const spacer = document.createElement('div');
  spacer.className = 'v2-svc-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  grid.appendChild(spacer);

  let active = 0;
  const show = (i: number) => {
    if (i === active || !layers[i]) return;
    active = i;
    layers.forEach((l, j) => l?.classList.toggle('is-on', j === i));
    cards.forEach((c, j) => c.classList.toggle('is-active', j === i && j > 0));
    feature.classList.toggle('is-swapped', i > 0);
    const h = cards[i].querySelector('h3')?.textContent ?? '';
    const p = cards[i].querySelector('.body p')?.textContent ?? '';
    caption.innerHTML = '';
    if (i > 0) {
      const n = document.createElement('span'); n.textContent = String(i + 1).padStart(2, '0');
      const t = document.createElement('b'); t.textContent = h;
      const d = document.createElement('span'); d.textContent = p;
      caption.append(n, t, d);
    }
  };

  /* Load the photos once the section is near, so none flashes blank when it comes in. */
  const near = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    layers.forEach(l => { if (l?.dataset.src) { l.src = l.dataset.src; delete l.dataset.src; } });
    near.disconnect();
  }, { rootMargin: '800px 0px' });
  near.observe(grid);

  /* The service crossing a line a third of the way down the screen is the one shown; above the list, the feature. */
  const middle = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) show(cards.indexOf(e.target as HTMLElement));
  }, { rootMargin: '-36% 0px -62% 0px' });
  cards.slice(1).forEach(c => middle.observe(c));
  const onScroll = () => {
    const first = cards[1].getBoundingClientRect();
    if (first.top > window.innerHeight * 0.36) show(0);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  const onPoint = (e: Event) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.service-card');
    const i = card ? cards.indexOf(card) : -1;
    if (i > 0) show(i);
  };
  grid.addEventListener('mouseover', onPoint);
  grid.addEventListener('focusin', onPoint);

  return () => {
    near.disconnect(); middle.disconnect();
    window.removeEventListener('scroll', onScroll);
    grid.removeEventListener('mouseover', onPoint);
    grid.removeEventListener('focusin', onPoint);
  };
}
