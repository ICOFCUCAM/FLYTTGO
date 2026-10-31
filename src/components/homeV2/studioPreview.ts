/**
 * Marketplace Studio on /preview/home: the storefront preview follows the operator's choices
 * (owner's 2036 mandate, 30 October 2026). The design's own script (shared with the platform page)
 * handles the name, positioning, market focus and primary colour; this adds the brand mark, the
 * secondary colour, the domain, which categories show, the storefront style and the booking and
 * payment model. It is an illustration: nothing is created, connected or charged.
 */
type Lang = 'en' | 'no';

const PAY: Record<Lang, Record<string, string>> = {
  en: { b: 'Bookings and payments: you sell, under your own terms and VAT · Stripe Connect',
        a: 'Bookings and payments: FlyttGo sells and invoices · moving and delivery only' },
  no: { b: 'Bestilling og betaling: du selger, på egne vilkår og med egen MVA · Stripe Connect',
        a: 'Bestilling og betaling: FlyttGo selger og fakturerer · kun flytting og levering' },
};

const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'M';
const slugOf = (s: string) =>
  s.trim().toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'your-marketplace';

export function installStudio(root: HTMLElement, lang: Lang): () => void {
  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`);
  const name = q<HTMLInputElement>('wl-name'), mark = q<HTMLElement>('wl-mark-el'), markSel = q<HTMLSelectElement>('wl-mark');
  const color2 = q<HTMLInputElement>('wl-color2'), hero = q<HTMLElement>('wl-hero'), store = root.querySelector<HTMLElement>('.wl-storefront');
  const domain = q<HTMLInputElement>('wl-domain'), mode = q<HTMLSelectElement>('wl-domain-mode'), address = q<HTMLElement>('wl-address');
  const style = q<HTMLSelectElement>('wl-style'), pay = q<HTMLSelectElement>('wl-payments'), payLine = q<HTMLElement>('wl-pay-line');
  const grid = q<HTMLElement>('wl-category-grid'), toggles = q<HTMLElement>('wl-cat-toggles');
  if (!name || !mark || !grid || !toggles || !store) return () => {};

  const hidden = new Set<string>();
  let domainTouched = false;

  const renderMark = () => {
    mark.textContent = initials(name.value);
    mark.dataset.style = markSel?.value ?? 'initials';
  };
  const renderAddress = () => {
    if (!domainTouched && domain) domain.value = slugOf(name.value);
    const slug = slugOf(domain?.value ?? name.value);
    if (address) address.textContent = mode?.value === 'own' ? `${slug}.no` : `${slug}.flyttgo.no`;
  };
  const renderToggles = () => {
    const items = [...grid.querySelectorAll<HTMLElement>('article')];
    toggles.replaceChildren(...items.map(a => {
      const title = a.querySelector('b')?.textContent ?? '';
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = !hidden.has(title);
      box.addEventListener('change', () => { if (box.checked) hidden.delete(title); else hidden.add(title); applyHidden(); });
      label.append(box, document.createTextNode(title));
      return label;
    }));
    applyHidden();
  };
  const applyHidden = () => grid.querySelectorAll<HTMLElement>('article').forEach(a => {
    a.hidden = hidden.has(a.querySelector('b')?.textContent ?? '');
  });
  const renderStyle = () => { store.dataset.style = style?.value ?? 'classic'; };
  const renderPay = () => { if (payLine) payLine.textContent = PAY[lang][pay?.value ?? 'b']; };
  const renderColour2 = () => { hero?.style.setProperty('--wl-accent2', color2?.value ?? '#C3A66C'); store.style.setProperty('--wl-accent2', color2?.value ?? '#C3A66C'); };
  const onPrimary = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-wl-color]');
    if (b && root.contains(b)) mark.style.background = b.dataset.wlColor ?? '';
  };

  /* The market focus rebuilds the category grid (design script); the toggles follow it. */
  const obs = new MutationObserver(() => { hidden.clear(); renderToggles(); });
  obs.observe(grid, { childList: true });

  const onName = () => { renderMark(); renderAddress(); };
  const onDomain = () => { domainTouched = true; renderAddress(); };
  name.addEventListener('input', onName);
  markSel?.addEventListener('change', renderMark);
  domain?.addEventListener('input', onDomain);
  mode?.addEventListener('change', renderAddress);
  style?.addEventListener('change', renderStyle);
  pay?.addEventListener('change', renderPay);
  color2?.addEventListener('input', renderColour2);
  root.addEventListener('click', onPrimary);

  mark.style.background = root.querySelector<HTMLElement>('[data-wl-color][aria-pressed="true"]')?.dataset.wlColor ?? '';
  renderMark(); renderAddress(); renderToggles(); renderStyle(); renderPay(); renderColour2();

  return () => {
    obs.disconnect();
    name.removeEventListener('input', onName);
    markSel?.removeEventListener('change', renderMark);
    domain?.removeEventListener('input', onDomain);
    mode?.removeEventListener('change', renderAddress);
    style?.removeEventListener('change', renderStyle);
    pay?.removeEventListener('change', renderPay);
    color2?.removeEventListener('input', renderColour2);
    root.removeEventListener('click', onPrimary);
  };
}
