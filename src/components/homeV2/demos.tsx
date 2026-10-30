/**
 * The restructured homepage's product demonstrations (docs/HOMEPAGE_RESTRUCTURE.md):
 * one per topic, each labelled an illustration with example data, so none is
 * mistaken for live figures. The capabilities they show are built (see the
 * audit); the numbers and names are not real.
 */
import { useState } from 'react';

function Mock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mock" role="figure" aria-label={`${title} (illustration with example data)`}>
      <div className="mock-bar">
        <span className="font-semibold text-[var(--ever)]">{title}</span>
        <span className="mock-tag">Illustration · example data</span>
      </div>
      {children}
    </div>
  );
}

function Tabs<T extends string>({ items, value, onChange, label }: { items: [T, string][]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(([id, name]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}>{name}</button>
      ))}
    </div>
  );
}

type Row = [string, string, string];
function Rows({ rows }: { rows: Row[] }) {
  return <div>{rows.map(([a, b, c]) => <div key={a + b} className="row"><span className="font-medium">{a}</span><span className="text-[var(--muted)]">{b}</span><span className="pill">{c}</span></div>)}</div>;
}

/* ── 4. Business operating platform: one workspace ── */
const BUSINESS: Record<string, { head: string; rows: Row[] }> = {
  services: { head: 'Your service catalogue, with the price model each service uses.', rows: [['Fault finding', 'Hourly · from 950 kr/h', 'Hourly'], ['Socket installation', 'Fixed · 1 450 kr', 'Fixed'], ['Bathroom renovation', 'Priced by quote', 'Quote']] },
  customers: { head: 'Each customer with their bookings, invoices and contact history.', rows: [['Nordvik Eiendom AS', '3 open jobs · company', 'Company'], ['Kari Hansen', 'Last visit 12 Oct', 'Private'], ['Byggmester Lie', 'Invoice due in 5 days', 'Company']] },
  bookings: { head: 'Visits, appointments and jobs on one calendar.', rows: [['Mon 09:00', 'Inspection · Grünerløkka', 'Confirmed'], ['Mon 13:30', 'Consultation · online', 'Confirmed'], ['Tue 08:00', 'Installation · Majorstuen', 'Scheduled']] },
  quotes: { head: 'Send a price for a job; the customer accepts before work starts.', rows: [['Q-0142 · Heat pump', '18 400 kr', 'Sent'], ['Q-0141 · Rewiring', '42 900 kr', 'Accepted'], ['Q-0139 · Lighting', '7 800 kr', 'Draft']] },
  team: { head: 'Owners, administrators, bookers, finance and staff, each with their own access.', rows: [['Ingrid S.', 'Owner', 'All access'], ['Ola B.', 'Staff', 'Own jobs'], ['Mona K.', 'Finance', 'Invoices']] },
  invoices: { head: 'Invoices and receipts in your company’s name, with EHF and credit notes.', rows: [['INV-2026-0318', 'Nordvik Eiendom AS · 12 500 kr', 'Sent'], ['INV-2026-0317', 'Kari Hansen · 2 300 kr', 'Paid'], ['CN-2026-0004', 'Credit note · 450 kr', 'Issued']] },
  payments: { head: 'Card and Vipps payments, and bank files matched to invoices by KID.', rows: [['Vipps · Kari Hansen', '2 300 kr', 'Settled'], ['Bank (KID) · Nordvik', '12 500 kr', 'Matched'], ['Card · Lie', '4 100 kr', 'Pending']] },
};
export function BusinessWorkspace() {
  const [tab, setTab] = useState<keyof typeof BUSINESS>('services');
  const v = BUSINESS[tab];
  return (
    <Mock title="Business workspace">
      <Tabs label="Workspace areas" value={tab} onChange={setTab} items={[['services', 'Services & pricing'], ['customers', 'Customers'], ['bookings', 'Bookings'], ['quotes', 'Quotes & projects'], ['team', 'Team'], ['invoices', 'Invoices'], ['payments', 'Payments']]} />
      <p className="px-[18px] pt-4 pb-2 text-sm text-[var(--muted)]">{v.head}</p>
      <Rows rows={v.rows} />
    </Mock>
  );
}

/* ── 5. Financial management: one finance workspace ── */
const FINANCE: Record<string, { head: string; rows: Row[] }> = {
  income: { head: 'What has been invoiced, what is paid and what is outstanding.', rows: [['Invoiced this month', '184 300 kr', 'Income'], ['Outstanding', '36 900 kr · 4 invoices', 'Due'], ['Overdue', '4 200 kr · 1 reminder sent', 'Reminder']] },
  expenses: { head: 'Costs recorded as vouchers, with the receipt attached.', rows: [['Fuel · Circle K', '1 240 kr · receipt attached', 'Voucher'], ['Materials · Elektroimport', '8 930 kr · invoice attached', 'Voucher'], ['Software', '499 kr · receipt attached', 'Voucher']] },
  mva: { head: 'Every voucher line carries its MVA code; totals per term for your report.', rows: [['Output MVA 25 %', '36 860 kr', 'Term 5'], ['Input MVA 25 %', '9 170 kr', 'Term 5'], ['Exempt sales', '0 kr', 'Term 5']] },
  saft: { head: 'The standard SAF-T Financial file, generated from your ledger.', rows: [['SAF-T 2025', 'Full year · 1 248 vouchers', 'Ready'], ['SAF-T Jan–Oct 2026', 'Year to date', 'Ready'], ['Validation', 'Accounts and parties mapped', 'Checked']] },
  naering: { head: 'Figures for the næringsspesifikasjon, from your accounts.', rows: [['Operating income', 'Post 3000–3999', 'Figures'], ['Operating costs', 'Post 4000–7999', 'Figures'], ['Balance', 'Assets and liabilities', 'Figures']] },
  yearend: { head: 'Everything your accountant needs to review before year-end.', rows: [['Ledger and vouchers', 'Open to your accountant', 'Shared'], ['Notes and questions', '2 open', 'Review'], ['Year-end check', 'By your accountant', 'Pending']] },
};
export function FinanceWorkspace() {
  const [tab, setTab] = useState<keyof typeof FINANCE>('income');
  const v = FINANCE[tab];
  return (
    <Mock title="Financial records">
      <Tabs label="Financial areas" value={tab} onChange={setTab} items={[['income', 'Income & outstanding'], ['expenses', 'Expenses & documents'], ['mva', 'MVA'], ['saft', 'SAF-T'], ['naering', 'Næringsspesifikasjon'], ['yearend', 'Accountant & year-end']]} />
      <p className="px-[18px] pt-4 pb-2 text-sm text-[var(--muted)]">{v.head}</p>
      <Rows rows={v.rows} />
    </Mock>
  );
}

/* ── 7. Build your own marketplace: one studio ── */
const SWATCHES = ['#203F68', '#24513B', '#8A4B3C', '#5B4A7A'];
const WORKFLOWS = ['Moving & transport', 'Appointments', 'Jobs with quotes', 'Table reservations', 'Online shop'] as const;
export function MarketplaceStudio() {
  const [name, setName] = useState('Nordlys Services');
  const [colour, setColour] = useState(SWATCHES[0]);
  const [domain, setDomain] = useState('booking.nordlys.no');
  const [on, setOn] = useState<string[]>(['Appointments', 'Jobs with quotes']);
  const toggle = (w: string) => setOn(s => (s.includes(w) ? s.filter(x => x !== w) : [...s, w]));
  return (
    <Mock title="Marketplace Studio">
      <div className="grid md:grid-cols-2">
        <div className="p-5 space-y-4 border-b md:border-b-0 md:border-r border-[var(--line)]">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Brand name
            <input value={name} onChange={e => setName(e.target.value.slice(0, 32))} className="mt-1.5 w-full border border-[var(--line)] bg-white px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]" />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Own domain
            <input value={domain} onChange={e => setDomain(e.target.value.slice(0, 40))} className="mt-1.5 w-full border border-[var(--line)] bg-white px-3 py-2 text-sm normal-case tracking-normal text-[var(--ink)]" />
          </label>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Brand colour</div>
            <div className="mt-2 flex gap-2">
              {SWATCHES.map(c => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={colour === c} onClick={() => setColour(c)} className={`h-8 w-8 border-2 ${colour === c ? 'border-[var(--gold)]' : 'border-transparent'}`} style={{ background: c }} />)}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Booking workflows</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {WORKFLOWS.map(w => <button key={w} type="button" aria-pressed={on.includes(w)} onClick={() => toggle(w)} className={`px-2.5 py-1 text-xs border ${on.includes(w) ? 'bg-[var(--ever)] text-white border-[var(--ever)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>{w}</button>)}
            </div>
          </div>
        </div>
        <div className="p-5 bg-[var(--ivory)]">
          <div className="text-[11px] text-[var(--muted)] mb-2">https://{domain || 'your-domain.no'}</div>
          <div className="bg-white border border-[var(--line)]">
            <div className="px-4 py-3 text-white font-semibold" style={{ background: colour }}>{name || 'Your brand'}</div>
            <div className="p-4">
              <div className="text-lg font-semibold text-[var(--ink)]">Book with {name || 'us'}</div>
              <div className="mt-3 space-y-2">
                {(on.length ? on : ['Choose a workflow']).map(w => <div key={w} className="flex items-center justify-between border border-[var(--line)] px-3 py-2 text-sm"><span>{w}</span><span className="text-xs" style={{ color: colour }}>Book →</span></div>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Mock>
  );
}

/* ── 9. Industry workflows: one selector ── */
type Industry = { name: string; model: string; info: string; fulfilment: string; module: string };
const INDUSTRIES: Industry[] = [
  { name: 'Electricians', model: 'Request, then a fixed price, an hourly rate or a quote the customer accepts', info: 'What needs doing, the address and a preferred time', fulfilment: 'Scheduled visit, work recorded as done, invoice in your name', module: 'Jobs' },
  { name: 'Plumbers', model: 'Repair, installation or maintenance, priced fixed, hourly or by quote', info: 'The problem, the address and how soon', fulfilment: 'Visit, completion, invoice and payment', module: 'Jobs' },
  { name: 'Cleaning companies', model: 'A time slot booked as an appointment', info: 'The service, the address and the time', fulfilment: 'Appointment, reminder the day before, invoice', module: 'Appointments' },
  { name: 'Relocation businesses', model: 'Moves priced from distance, van and time, before the customer confirms', info: 'Pickup and delivery addresses, items, floors and lift, van size and helpers', fulfilment: 'Approved driver, tracking during the job, card or Vipps payment', module: 'Moving & transport' },
  { name: 'Transport operators', model: 'Transport and delivery jobs taken from the FlyttGo job pool', info: 'Route, load, vehicle and time', fulfilment: 'Driver portal, tracking, payout after the job is confirmed', module: 'Driver network' },
  { name: 'Maintenance teams', model: 'Jobs assigned to team members, with quotes for larger work', info: 'The site, the task and who does it', fulfilment: 'Job per team member, completion, invoice', module: 'Jobs & team' },
  { name: 'Independent professionals', model: 'Consultations and sessions booked online', info: 'The service, the time and the client’s details', fulfilment: 'Appointment, reminder, receipt or invoice', module: 'Appointments' },
];
export function IndustrySelector() {
  const [i, setI] = useState(0);
  const v = INDUSTRIES[i];
  return (
    <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-0 border border-[var(--line)] bg-[var(--white)]">
      <div className="border-b lg:border-b-0 lg:border-r border-[var(--line)]" role="tablist" aria-label="Industries">
        {INDUSTRIES.map((x, n) => (
          <button key={x.name} type="button" role="tab" aria-selected={n === i} onClick={() => setI(n)}
            className={`flex w-full items-center justify-between px-6 py-4 text-left text-[15px] border-b border-[var(--line)] last:border-b-0 transition ${n === i ? 'bg-[var(--ivory)] text-[var(--blue)] font-semibold' : 'text-[var(--ink)] hover:bg-[var(--ivory)]/60'}`}>
            {x.name}<span aria-hidden="true" className="text-[var(--gold-text)]">{n === i ? '—' : '+'}</span>
          </button>
        ))}
      </div>
      <div className="p-8 lg:p-10" role="tabpanel">
        <div className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--gold-text)]">{v.module}</div>
        <h3 className="mt-2 text-2xl font-semibold text-[var(--ever)]">{v.name}</h3>
        <dl className="mt-8 grid gap-6">
          {([['Booking model', v.model], ['Information needed', v.info], ['Fulfilment', v.fulfilment]] as const).map(([k, d]) => (
            <div key={k} className="rule pt-4"><dt className="text-xs uppercase tracking-wider text-[var(--muted)]">{k}</dt><dd className="mt-1.5 text-[var(--ink)] leading-relaxed">{d}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* ── 10. Corporate solutions: one corporate view ── */
export function CorporateView() {
  return (
    <Mock title="Company account · Nordvik Eiendom AS">
      <div className="p-5">
        <div className="flex items-baseline justify-between text-sm"><span className="text-[var(--muted)]">Monthly spend against limit</span><span className="font-semibold">38 400 / 60 000 kr</span></div>
        <div className="mt-2 h-2 bg-[var(--ivory)]"><div className="h-2 bg-[var(--forest)]" style={{ width: '64%' }} /></div>
      </div>
      <div className="px-5 pb-2 text-xs uppercase tracking-wider text-[var(--muted)]">Waiting for approval</div>
      <Rows rows={[['Office move · 14 Nov', 'Booked by Ola · 18 900 kr', 'Approve'], ['Furniture to Bergen', 'Booked by Mona · 6 200 kr', 'Approve']]} />
      <div className="px-5 pt-4 pb-2 text-xs uppercase tracking-wider text-[var(--muted)]">This month</div>
      <Rows rows={[['Recurring · weekly delivery', 'Every Monday · 4 runs', 'Scheduled'], ['Invoice · October', 'One invoice for all bookings', 'EHF'], ['API · booking system', '2 keys active', 'Add-on']]} />
    </Mock>
  );
}

/* ── 8. Connected network: one architecture illustration ── */
export function NetworkIllustration() {
  const node = 'border border-[var(--line)] bg-[var(--white)] px-4 py-3 text-center text-sm font-semibold text-[var(--ever)]';
  return (
    <figure className="relative" aria-label="How the FlyttGo network fits together">
      <div className={`${node} mx-auto max-w-md bg-[var(--ivory)]`}>Customers</div>
      <div className="mx-auto h-8 w-px bg-[var(--gold)]" aria-hidden="true" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={node}>FlyttGo Marketplace<span className="block text-xs font-normal text-[var(--muted)] mt-1">the central marketplace</span></div>
        <div className={node}>Independent operators<span className="block text-xs font-normal text-[var(--muted)] mt-1">white-label sites</span></div>
        <div className={node}>Businesses & providers<span className="block text-xs font-normal text-[var(--muted)] mt-1">their own workspaces</span></div>
      </div>
      <div className="mx-auto h-8 w-px bg-[var(--gold)]" aria-hidden="true" />
      <div className="bg-[var(--blue)] px-6 py-5 text-center text-white">
        <div className="text-sm font-semibold tracking-wide">FlyttGo platform · shared infrastructure</div>
        <div className="mt-1 text-xs text-white/75">Booking, payments, invoicing, records — each company’s data kept apart</div>
      </div>
    </figure>
  );
}
