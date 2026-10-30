/**
 * The restructured FlyttGo homepage, under review at /preview/home
 * (docs/HOMEPAGE_RESTRUCTURE.md: audit, structure and content-migration map).
 * Twelve sections, one demonstration per topic, each capability labelled
 * with its real status. Detailed figures (driver plans, van rates, tools)
 * stay on their own pages, linked from here. It uses FlyttGo's menu bar and
 * footer (AppLayout) and the real booking widget; it replaces nothing until
 * the owner approves it.
 */
import { useEffect } from 'react';
import { useApp, type Page } from '../../lib/store';
import { IMAGES, VAN_TYPES } from '../../lib/constants';
import BookingCard from '../platformHome/BookingCard';
import { BusinessWorkspace, CorporateView, FinanceWorkspace, IndustrySelector, MarketplaceStudio, NetworkIllustration } from './demos';
import './homeV2.css';

type Status = 'live' | 'addon' | 'dev';
const STATUS_LABEL: Record<Status, string> = { live: 'Available', addon: 'Paid add-on', dev: 'In development' };
function StatusTag({ s }: { s: Status }) {
  return <span className={`status status-${s}`}>{STATUS_LABEL[s]}</span>;
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const CDN = 'https://d64gsuwffb70l.cloudfront.net/';

export default function HomeV2Page() {
  const { setPage } = useApp();
  const go = (p: Page) => setPage(p);

  /* A page under review: not for search engines. */
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const before = meta?.content ?? null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = 'noindex, nofollow';
    return () => { if (before === null) meta?.remove(); else if (meta) meta.content = before; };
  }, []);

  return (
    <main className="hv2">
      {/* ── 1. Hero ── */}
      <section id="top" className="bg-[var(--ivory)]">
        <div className="wrap grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center py-16 lg:py-24">
          <div>
            <div className="kicker">One connected platform</div>
            <h1 className="display mt-7 text-[var(--ever)]">
              Build your business.<br />
              <span className="serif italic text-[var(--blue)]">Own your marketplace.</span>
            </h1>
            <p className="lead mt-7 max-w-xl">
              FlyttGo brings together a marketplace for finding services, the tools to run a service business,
              and the infrastructure to launch a marketplace under your own brand — on one platform.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary" onClick={() => scrollTo('marketplace')}>Find a service <span aria-hidden="true">→</span></button>
              <button type="button" className="btn btn-ghost" onClick={() => scrollTo('business')}>Run a business <span aria-hidden="true">→</span></button>
              <button type="button" className="btn btn-ghost" onClick={() => scrollTo('studio')}>Build a marketplace <span aria-hidden="true">→</span></button>
            </div>
          </div>
          <figure className="relative">
            <div className="aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5] overflow-hidden">
              <img src={IMAGES.hero.truck} alt="A FlyttGo moving truck by the Oslo fjord" className="photo" />
            </div>
            <figcaption className="absolute left-0 bottom-0 bg-[var(--white)] px-6 py-5 max-w-xs">
              <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--gold-text)]">Where FlyttGo started</div>
              <div className="mt-1.5 text-[15px] text-[var(--ever)]">Moving and transport across Norway — now one part of a wider platform.</div>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── 2. Choose your journey ── */}
      <section id="journeys" className="py-20 lg:py-28">
        <div className="wrap">
          <div className="kicker">Choose your journey</div>
          <h2 className="h2 mt-5 max-w-2xl text-[var(--ever)]">Three ways into FlyttGo.</h2>
          <div className="mt-14 grid md:grid-cols-3 gap-10 md:gap-8">
            {([
              ['01', 'I need a service', 'Book moving and transport across Norway with an upfront price, or a company’s services on its own booking site.', 'Explore the marketplace', () => scrollTo('marketplace')],
              ['02', 'I run a business', 'Manage services, bookings, customers, quotes, invoices and payments — and keep your records in order.', 'See the business tools', () => scrollTo('business')],
              ['03', 'I want my own marketplace', 'Launch a booking site under your own brand and domain, with your services, customers and commercial model.', 'See Marketplace Studio', () => scrollTo('studio')],
            ] as const).map(([n, title, text, cta, onClick]) => (
              <article key={n} className="rule pt-8">
                <div className="serif text-4xl text-[var(--gold-text)]">{n}</div>
                <h3 className="mt-5 text-2xl font-semibold text-[var(--ever)]">{title}</h3>
                <p className="mt-3 text-[var(--muted)] leading-relaxed">{text}</p>
                <button type="button" onClick={onClick} className="link mt-6 inline-block">{cta}</button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. One connected platform ── */}
      <section id="platform" className="py-20 lg:py-28 bg-[var(--ivory)]">
        <div className="wrap grid lg:grid-cols-[0.8fr_1.2fr] gap-14 items-center">
          <div>
            <div className="kicker">One connected platform</div>
            <h2 className="h2 mt-5 text-[var(--ever)]">Four capabilities. <span className="serif italic text-[var(--blue)]">One foundation.</span></h2>
            <p className="lead mt-6">A booking made in the marketplace becomes a job in the business workspace, an invoice in its finances and a record for the accountant — without moving data between systems.</p>
          </div>
          <div className="relative grid sm:grid-cols-2 border border-[var(--line)] bg-[var(--white)]">
            {([
              ['Marketplace', 'Customers find, compare and book services with upfront prices.', 'live'],
              ['Business tools', 'Services, bookings, customers, quotes, teams, invoices and payments.', 'live'],
              ['White-label infrastructure', 'A booking site under a company’s own brand and domain.', 'live'],
              ['Financial administration', 'Invoices, payments, vouchers, MVA, SAF-T and year-end figures.', 'live'],
            ] as [string, string, Status][]).map(([name, text, s], n) => (
              <div key={name} className={`p-8 ${n % 2 === 0 ? 'sm:border-r' : ''} ${n < 2 ? 'border-b' : n === 2 ? 'border-b sm:border-b-0' : ''} border-[var(--line)]`}>
                <div className="serif text-sm text-[var(--gold-text)]">0{n + 1}</div>
                <h3 className="mt-3 text-xl font-semibold text-[var(--ever)]">{name}</h3>
                <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{text}</p>
                <div className="mt-4"><StatusTag s={s} /></div>
              </div>
            ))}
            <div aria-hidden="true" className="hidden sm:flex absolute inset-0 m-auto h-24 w-24 items-center justify-center rounded-full border border-[var(--gold)] bg-[var(--ivory)] text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--ever)]">One<br />record</div>
          </div>
        </div>
      </section>

      {/* ── 4. Business operating platform ── */}
      <section id="business" className="py-20 lg:py-28">
        <div className="wrap grid lg:grid-cols-[0.75fr_1.25fr] gap-14 items-start">
          <div>
            <div className="kicker">Business operating platform</div>
            <h2 className="h2 mt-5 text-[var(--ever)]">Run the business <span className="serif italic text-[var(--blue)]">behind the service.</span></h2>
            <p className="lead mt-6">From a single professional to a company with several teams: the work, the customers and the money in one workspace.</p>
            <ul className="mt-8 grid gap-3 text-[var(--ink)]">
              {['Services and pricing — fixed, hourly or by quote', 'Customers and their records', 'Bookings, appointments and reservations', 'Quotes and projects', 'Teams and permissions', 'Invoices and receipts in your name', 'Payments and transactions'].map(x => (
                <li key={x} className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-px w-4 bg-[var(--gold)] flex-none" />{x}</li>
              ))}
            </ul>
            <button type="button" onClick={() => go('white-label')} className="btn btn-primary mt-10">Plans and prices <span aria-hidden="true">→</span></button>
          </div>
          <BusinessWorkspace />
        </div>
      </section>

      {/* ── 5. Financial management ── */}
      <section id="finance" className="py-20 lg:py-28 bg-[var(--blue)] text-white on-dark">
        <div className="wrap">
          <div className="kicker">Financial management</div>
          <h2 className="h2 mt-5 max-w-3xl">Every job accounted for. <span className="serif italic text-[var(--gold)]">Every transaction connected.</span></h2>
          <ol className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-white/15" aria-label="From booking to financial record">
            {['Booking', 'Quote', 'Job completed', 'Invoice', 'Payment', 'Financial record'].map((x, n) => (
              <li key={x} className="bg-[var(--blue)] p-5"><div className="serif text-[var(--gold)]">0{n + 1}</div><div className="mt-2 font-semibold">{x}</div></li>
            ))}
          </ol>
          <div className="mt-14 grid lg:grid-cols-[0.75fr_1.25fr] gap-12 items-start">
            <div>
              <ul className="grid gap-3 text-white/90">
                {['Income and outstanding invoices', 'Expenses with their supporting documents', 'MVA codes on every line and totals per term', 'SAF-T Financial export', 'Næringsspesifikasjon figures', 'Shared with your accountant for review and year-end'].map(x => (
                  <li key={x} className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-px w-4 bg-[var(--gold)] flex-none" />{x}</li>
                ))}
              </ul>
              <p className="mt-8 border-l-2 border-[var(--gold)] pl-5 text-sm leading-relaxed text-white/80">
                FlyttGo prepares records and figures; it is not a certified accounting service and does not file tax returns or MVA reports.
                Offering financial administration features does not make FlyttGo your accountant: have your accountant check the figures before anything is filed.
              </p>
              <div className="mt-8 flex flex-wrap gap-5">
                <button type="button" onClick={() => go('invoice-billing')} className="link">Invoicing</button>
                <button type="button" onClick={() => go('accounting')} className="link">Accounting</button>
              </div>
            </div>
            <div className="min-w-0 text-[var(--ink)]"><FinanceWorkspace /></div>
          </div>
        </div>
      </section>

      {/* ── 6. Marketplace ── */}
      <section id="marketplace" className="py-20 lg:py-28">
        <div className="wrap">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="kicker">FlyttGo Marketplace</div>
              <h2 className="h2 mt-5 text-[var(--ever)]">Services, ready to book.</h2>
            </div>
            <button type="button" onClick={() => go('services')} className="link">All services</button>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-4 md:grid-rows-2 md:h-[560px]">
            {([
              ['Moving and relocation', 'Homes and offices, with approved drivers.', IMAGES.movers, 'booking', 'md:col-span-2 md:row-span-2'],
              ['Transport and delivery', 'Single items and larger loads.', IMAGES.hero.truck1, 'booking', ''],
              ['Local services', 'Trades and help at home, booked with the company.', CDN + '69b1b470fdd1af7483a60acc_1773254286622_a82a1d1b.jpg', 'services', ''],
              ['Hospitality', 'Table and room reservations on companies’ own sites.', IMAGES.hero.office, 'white-label', ''],
              ['Commerce', 'Online shops in the company’s name.', CDN + '69b1b470fdd1af7483a60acc_1773254050705_a292f56d.jpg', 'white-label', ''],
            ] as [string, string, string, Page, string][]).map(([name, text, img, page, span]) => (
              <button key={name} type="button" onClick={() => go(page)} className={`group relative min-h-[220px] overflow-hidden text-left ${span}`}>
                <img src={img} alt="" loading="lazy" className="photo absolute inset-0 transition duration-500 group-hover:scale-[1.03]" />
                <span className="absolute inset-0 bg-gradient-to-t from-[rgba(32,53,43,.85)] via-[rgba(32,53,43,.25)] to-transparent" />
                <span className="absolute left-0 bottom-0 p-6 text-white">
                  <span className="block text-xl font-semibold">{name}</span>
                  <span className="mt-1 block text-sm text-white/85">{text}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. Build your own marketplace ── */}
      <section id="studio" className="py-20 lg:py-28 bg-[var(--ivory)]">
        <div className="wrap grid lg:grid-cols-[0.8fr_1.2fr] gap-14 items-start">
          <div>
            <div className="kicker">Build your own marketplace</div>
            <h2 className="h2 mt-5 text-[var(--ever)]">Your marketplace. <span className="serif italic text-[var(--blue)]">Your relationships.</span></h2>
            <p className="lead mt-6">The operator owns the identity and the customer relationship; FlyttGo supplies the infrastructure underneath.</p>
            <dl className="mt-8">
              {([
                ['Own brand', 'Name, colours and logo', 'live'],
                ['Own domain', 'Your address, connected and verified', 'live'],
                ['Own categories', 'Your services and prices', 'live'],
                ['Own booking workflows', 'Moving, jobs, appointments, reservations or a shop', 'live'],
                ['Own customers', 'You sell in your own name (seller model B)', 'live'],
                ['Own commercial model', 'Your markup, or FlyttGo sells for you (model A)', 'live'],
                ['Own providers', 'Onboarding your own provider network', 'dev'],
              ] as [string, string, Status][]).map(([k, d, s]) => (
                <div key={k} className="rule flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3.5">
                  <dt className="font-semibold text-[var(--ever)]">{k}<span className="block text-sm font-normal text-[var(--muted)]">{d}</span></dt>
                  <dd><StatusTag s={s} /></dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => go('white-label')} className="btn btn-primary mt-8">White-label plans <span aria-hidden="true">→</span></button>
          </div>
          <MarketplaceStudio />
        </div>
      </section>

      {/* ── 8. Connected network ── */}
      <section id="network" className="py-20 lg:py-28">
        <div className="wrap grid lg:grid-cols-2 gap-14 items-center">
          <NetworkIllustration />
          <div>
            <div className="kicker">Connected network</div>
            <h2 className="h2 mt-5 text-[var(--ever)]">Shared infrastructure does not mean <span className="serif italic text-[var(--blue)]">shared private data.</span></h2>
            <dl className="mt-8 grid sm:grid-cols-2 gap-x-8">
              {([
                ['Tenant separation', 'Each company’s records are kept apart in the database, tested on every company table.', 'live'],
                ['Permissions', 'Owner, administrator, booker, finance, viewer and staff roles.', 'live'],
                ['Customer ownership', 'A company selling in its own name sees and owns its bookings.', 'live'],
                ['Provider relationships', 'Drivers approved by FlyttGo today; operators’ own provider networks are in development.', 'dev'],
                ['Payments', 'Card and Vipps; a selling company is paid on its own Stripe account.', 'live'],
                ['Auditability', 'Invoice, approval and API-key history is recorded.', 'live'],
              ] as [string, string, Status][]).map(([k, d, s]) => (
                <div key={k} className="rule py-4">
                  <dt className="flex items-center justify-between gap-3 font-semibold text-[var(--ever)]">{k}<StatusTag s={s} /></dt>
                  <dd className="mt-1.5 text-sm text-[var(--muted)] leading-relaxed">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── 9. Industry workflows ── */}
      <section id="industries" className="py-20 lg:py-28 bg-[var(--ivory)]">
        <div className="wrap">
          <div className="kicker">Industry workflows</div>
          <h2 className="h2 mt-5 max-w-3xl text-[var(--ever)]">Different industries book differently. <span className="serif italic text-[var(--blue)]">The platform follows.</span></h2>
          <p className="lead mt-6 max-w-2xl">Each trade needs its own booking model, its own information before the work, and its own way of finishing the job.</p>
          <div className="mt-12"><IndustrySelector /></div>
        </div>
      </section>

      {/* ── 10. Corporate solutions ── */}
      <section id="corporate" className="py-20 lg:py-28">
        <div className="wrap grid lg:grid-cols-[0.8fr_1.2fr] gap-14 items-start">
          <div>
            <div className="kicker">Corporate solutions</div>
            <h2 className="h2 mt-5 text-[var(--ever)]">Logistics that works <span className="serif italic text-[var(--blue)]">around your organisation.</span></h2>
            <dl className="mt-8">
              {([
                ['Bulk booking', 'bulk-booking', 'live'],
                ['Multi-user access', 'corporate', 'live'],
                ['Invoice billing', 'invoice-billing', 'live'],
                ['Spending limits and approvals', 'corporate', 'live'],
                ['API integrations', 'corporate-api-access', 'addon'],
                ['Analytics and reporting', 'company-dashboard-info', 'live'],
                ['Recurring bookings', 'recurring-deliveries', 'live'],
              ] as [string, Page, Status][]).map(([k, page, s]) => (
                <div key={k} className="rule flex items-center justify-between gap-4 py-3.5">
                  <dt><button type="button" onClick={() => go(page)} className="font-semibold text-[var(--ever)] hover:text-[var(--blue)]">{k} <span aria-hidden="true" className="text-[var(--gold-text)]">→</span></button></dt>
                  <dd><StatusTag s={s} /></dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => go('corporate')} className="btn btn-primary mt-8">FlyttGo for business <span aria-hidden="true">→</span></button>
          </div>
          <CorporateView />
        </div>
      </section>

      {/* ── 11. Moving and driver network ── */}
      <section id="moving" className="py-20 lg:py-28 bg-[var(--ivory)]">
        <div className="wrap">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="kicker">Moving and driver network</div>
              <h2 className="h2 mt-5 max-w-3xl text-[var(--ever)]">Moving remains <span className="serif italic text-[var(--blue)]">part of our foundation.</span></h2>
            </div>
            <button type="button" onClick={() => go('transport-home')} className="link">The full moving site</button>
          </div>
          <p className="lead mt-6 max-w-3xl">Moving services, furniture transport, office relocation, same-day delivery, student moving and storage transport — with drivers FlyttGo has approved.</p>
          <div className="mt-12"><BookingCard /></div>
          <p className="mt-4 text-sm text-[var(--muted)]">Prices include 25 % MVA. Free cancellation until 24 hours before pickup; within 24 hours, 50 % is refunded to the card or Vipps you paid with.</p>
          <div className="mt-14 grid lg:grid-cols-3 gap-10">
            <div>
              <h3 className="text-lg font-semibold text-[var(--ever)]">Vehicle sizes</h3>
              <dl className="mt-4">
                {VAN_TYPES.map(v => (
                  <div key={v.id} className="rule flex justify-between py-2.5 text-sm"><dt>{v.name}</dt><dd className="text-[var(--muted)]">{v.capacity}</dd></div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-5"><button type="button" onClick={() => go('van-guide')} className="link">Rates and van calculator</button><button type="button" onClick={() => go('checklist')} className="link">Moving checklist</button></div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--ever)]">Booking and tracking</h3>
              <ol className="mt-4">
                {['Enter where, what and when', 'See the price before you book', 'Pay by card or Vipps', 'Follow the job on the tracking page'].map((x, n) => (
                  <li key={x} className="rule flex gap-4 py-2.5 text-sm"><span className="serif text-[var(--gold-text)]">0{n + 1}</span>{x}</li>
                ))}
              </ol>
              <div className="mt-4"><button type="button" onClick={() => go('tracking')} className="link">Track a delivery</button></div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--ever)]">Driver network</h3>
              <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">Drivers choose their jobs, see what they earn before they accept, and request payouts from their wallet. Free to join; plans add dispatch priority and lower commission.</p>
              <div className="mt-4 flex flex-wrap gap-5"><button type="button" onClick={() => go('driver-onboarding')} className="link">Become a driver</button><button type="button" onClick={() => go('subscriptions')} className="link">Driver plans and commission</button></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 12. Final call to action ── */}
      <section id="next" className="py-24 lg:py-32 bg-[var(--forest)] text-white on-dark">
        <div className="wrap text-center">
          <div className="kicker justify-center">One platform. Many possibilities.</div>
          <h2 className="display mt-7">Run, connect and grow.<br /><span className="serif italic text-[var(--gold)]">Build with FlyttGo.</span></h2>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <button type="button" className="btn btn-gold" onClick={() => go('booking')}>Book a service</button>
            <button type="button" className="btn btn-light" onClick={() => go('white-label')}>Start your business workspace</button>
            <button type="button" className="btn btn-light" onClick={() => go('contact')}>Talk to us about a marketplace</button>
          </div>
        </div>
      </section>
    </main>
  );
}
