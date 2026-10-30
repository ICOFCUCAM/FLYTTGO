import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from '../lib/locales/en';

/* Fixes from the platform audit of 2026-10-30 (owner's decision):
 * the payment page has no card fields of its own, the public forms report
 * "sent" only when the message was stored, and the footer shows FlyttGo's
 * company details only once they are set. */

await i18n.use(initReactI18next).init({ resources: { en: { translation: en } }, lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false } });

const rpc = vi.fn();
vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: null });
  chain.then = (r: (v: unknown) => void) => r({ data: [] });
  return {
    supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => chain },
    callFunction: vi.fn(),
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '',
  };
});
vi.mock('../lib/store', () => ({
  useApp: () => ({ setPage: () => {}, bookingData: null, setShowAuthModal: () => {}, setAuthMode: () => {} }),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
vi.mock('../lib/whiteLabelContext', () => ({ useWhiteLabel: () => ({ site: null }) }));
vi.mock('../lib/organizations', () => ({ loadMyApprovals: async () => ({}) }));

/* The company details the footer reads, switchable per test. */
const identity = vi.hoisted(() => ({ current: null as null | import('../lib/companyIdentity').CompanyIdentity }));
vi.mock('../lib/companyIdentity', async importOriginal => {
  const real = await importOriginal<typeof import('../lib/companyIdentity')>();
  return { ...real, useCompanyIdentity: () => identity.current ?? real.EMPTY_IDENTITY };
});

const { default: PaymentPage } = await import('../pages/PaymentPage');
const { default: Footer } = await import('../components/Footer');
const { default: ContactPage } = await import('../pages/ContactPage');
const { submitContactMessage, sendContactForm, contactErrorText } = await import('../lib/contact');
const { displayPhone, mvaNumber, normaliseIdentity, PHONE_PLACEHOLDER } = await import('../lib/companyIdentity');

beforeEach(() => { rpc.mockReset(); identity.current = null; });

describe('payment page', () => {
  const html = () => renderToStaticMarkup(<PaymentPage />);

  it('has no card number, expiry or CVC fields of its own', () => {
    const page = html();
    expect(page).not.toMatch(/<input/i);
    expect(page).not.toMatch(/Card Number|Expiry Date|\bCVC\b|Cardholder|1234 5678|MM\/YY|•••/);
  });

  it('pays by card with one button that goes to Stripe, and says card details are entered there', () => {
    const page = html();
    expect(page).toContain('Pay with card');
    expect(page).toContain("Stripe&#x27;s secure checkout page");
    expect(page).toContain("Card details are entered only on Stripe&#x27;s secure page, not on FlyttGo.");
  });

  it('keeps every other payment method', () => {
    const page = html();
    for (const m of ['Vipps', 'Google Pay', 'Invoice']) expect(page).toContain(m);
  });

  it('does not promise escrow or payment on delivery', () => {
    const page = html();
    expect(page).not.toMatch(/escrow|pay only on delivery/i);
    expect(page).toContain('Card payments are taken at checkout through Stripe');
    expect(page).toContain('within 24 hours, 50% is refunded');
  });
});

describe('contact forms', () => {
  it('stores a message through submit_contact_message and reports success', async () => {
    rpc.mockResolvedValue({ data: 'id', error: null });
    const res = await submitContactMessage({ source: 'contact', name: 'Kari', email: 'kari@example.no', message: 'Hei' });
    expect(res).toEqual({ ok: true, error: '' });
    expect(rpc).toHaveBeenCalledWith('submit_contact_message', expect.objectContaining({
      p_source: 'contact', p_name: 'Kari', p_email: 'kari@example.no', p_message: 'Hei' }));
  });

  it('reports the database refusal as a clear error, never as sent', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'contact: too many messages from this email address; please try again in an hour' } });
    const res = await submitContactMessage({ source: 'contact', name: 'Kari', email: 'kari@example.no', message: 'Hei' });
    expect(res).toEqual({ ok: false, error: 'Too many messages from this email address; please try again in an hour.' });
  });

  it('gives a general error for any other failure, and when the network fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.submit_contact_message' } });
    expect((await submitContactMessage({ source: 'newsletter', email: 'a@b.no' })).ok).toBe(false);
    expect(contactErrorText('Could not find the function')).toBe('Your message could not be sent. Please try again later.');
    rpc.mockRejectedValue(new Error('offline'));
    const res = await submitContactMessage({ source: 'newsletter', email: 'a@b.no' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be sent/);
  });

  it('checks the required fields before sending anything', async () => {
    const submit = vi.fn();
    const res = await sendContactForm({ source: 'contact', name: ' ', email: 'kari@example.no', message: 'Hei' },
      ['name', 'email', 'message'], 'Please fill in your name, email and message.', submit);
    expect(res).toEqual({ ok: false, error: 'Please fill in your name, email and message.' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows sent only when the message was stored', async () => {
    const ok = await sendContactForm({ source: 'corporate', company: 'Firma AS', email: 'o@f.no' }, ['company', 'email'], 'x',
      async () => ({ ok: true, error: '' }));
    const refused = await sendContactForm({ source: 'corporate', company: 'Firma AS', email: 'o@f.no' }, ['company', 'email'], 'x',
      async () => ({ ok: false, error: 'Enter a valid email address.' }));
    expect(ok.ok).toBe(true);
    expect(refused).toEqual({ ok: false, error: 'Enter a valid email address.' });
  });

  it('the contact page shows the form, no UK number and no invented office', () => {
    const page = renderToStaticMarkup(<ContactPage />);
    expect(page).toContain('Send Message');
    expect(page).not.toContain('+44');
    expect(page).not.toContain('Karl Johans');
    expect(page).toContain(PHONE_PLACEHOLDER);
    expect(page).not.toContain('within two hours');
    expect(page).not.toMatch(/href="tel:/);
  });
});

describe('footer company details', () => {
  const footer = () => renderToStaticMarkup(<Footer />);

  it('shows no placeholder org. nr., MVA nr., address or UK phone while the settings are empty', () => {
    const html = footer();
    expect(html).not.toContain('000 000 000');
    expect(html).not.toContain('+44');
    expect(html).not.toContain('Karl Johans');
    expect(html).not.toContain('data-testid="footer-company"');
    expect(html).not.toContain('data-testid="footer-vat"');
    expect(html).not.toContain('data-testid="footer-address"');
    expect(html).not.toContain('FlyttGo AS');
  });

  it('shows a Norwegian placeholder phone that is not a link until the phone is set', () => {
    const html = footer();
    expect(html).toContain(`data-testid="footer-phone" class="flex items-center gap-2 text-gray-400">`);
    expect(html).toContain('+47 000 00 000');
    expect(html).not.toMatch(/href="tel:/);
    expect(html).not.toContain('wa.me');
  });

  it('shows each line once it is set in the invoicing settings', () => {
    identity.current = normaliseIdentity({ name: 'FlyttGo AS', org_number: '123456789', vat_registered: true,
      address: 'Storgata 1', postcode_city: '0155 Oslo', email: 'post@flyttgo.no', phone: '+47 22 33 44 55' });
    const html = footer();
    expect(html).toContain('FlyttGo AS');
    expect(html).toContain('Org. nr. <span class="font-mono">123 456 789</span>');
    expect(html).toContain('NO 123 456 789 MVA');
    expect(html).toContain('Storgata 1');
    expect(html).toContain('0155 Oslo');
    expect(html).toContain('href="tel:+4722334455"');
    expect(html).toContain('https://wa.me/4722334455');
    expect(html).toContain('post@flyttgo.no');
    expect(html).not.toContain(PHONE_PLACEHOLDER);
  });

  it('hides the MVA number when FlyttGo is not registered, and a line that is not set', () => {
    identity.current = normaliseIdentity({ name: 'FlyttGo AS', org_number: '123456789', vat_registered: false });
    const html = footer();
    expect(html).toContain('Not registered for MVA');
    expect(html).not.toContain('MVA</span>');
    expect(html).not.toContain('data-testid="footer-address"');
  });

  it('normalises the details: blanks are empty, never invented', () => {
    const id = normaliseIdentity({ name: '  ', org_number: null, vat_registered: true, phone: '' });
    expect(id.name).toBeNull();
    expect(mvaNumber(id)).toBeNull();
    expect(displayPhone(id)).toEqual({ text: '+47 000 00 000', real: false, tel: null, whatsapp: null });
  });
});

describe('public claims', () => {
  it('the English texts make none of the unbacked claims the audit listed', () => {
    const all = JSON.stringify(en);
    for (const claim of ["Norway's #1", '#1 Mov', '25,000+', '500+', '4.8/5', '40+', '500 000 NOK', '10 M NOK', '24/7',
      'Klimafondet', '34%', 'Background check', 'Pay only on delivery', 'held in escrow', 'Escrow Protected']) {
      expect(all, claim).not.toContain(claim);
    }
  });
});
