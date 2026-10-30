/**
 * The business workspace and the financial workspace on /preview/home show one
 * example company's records (owner, 30 October 2026: "make the business
 * workspace the flagship demonstration … realism, hierarchy"). The design's own
 * script (shared with the platform page, which stays as it is) renders each tab
 * first; this runs after it on the same tabs and fills the record panels.
 * Every figure belongs to the example company and is labelled as example data;
 * none is FlyttGo's own result.
 */

type Tone = 'ok' | 'wait' | 'due' | 'info';
type Row = { cells: string[]; status?: [Tone, string] };
type Table = { title: string; meta: string; head: string[]; rows: Row[] };
type Metric = [string, string, string];
type Lang = 'en' | 'no';

const money = (lang: Lang, n: number) =>
  new Intl.NumberFormat(lang === 'no' ? 'nb-NO' : 'en-GB', { style: 'currency', currency: 'NOK' }).format(n);

/* ── Business workspace ─────────────────────────────────────────────────── */
function workspace(lang: Lang): Record<string, { m: Metric[]; table: Table }> {
  const no = lang === 'no';
  const kr = (n: number) => money(lang, n);
  const S = {
    progress: no ? 'Pågår' : 'In progress', scheduled: no ? 'Planlagt' : 'Scheduled', sent: no ? 'Sendt' : 'Sent',
    accepted: no ? 'Akseptert' : 'Accepted', draft: no ? 'Utkast' : 'Draft', paid: no ? 'Betalt' : 'Paid',
    overdue: no ? 'Forfalt' : 'Overdue', done: no ? 'Fullført' : 'Completed', ready: no ? 'Klar' : 'Ready',
    missing: no ? 'Mangler' : 'Missing', active: no ? 'Aktiv' : 'Active',
  };
  const ex = no ? 'EKSEMPELDATA' : 'EXAMPLE DATA';
  return {
    overview: {
      m: [[no ? 'I DAG' : 'TODAY', no ? '3 jobber planlagt' : '3 jobs scheduled', '08:00 – 16:30'],
          [no ? 'HENVENDELSER' : 'ENQUIRIES', no ? '2 venter på svar' : '2 awaiting a reply', no ? 'Eldste: 3 timer' : 'Oldest: 3 hours'],
          [no ? 'FAKTURAER' : 'INVOICES', no ? '1 forfalt' : '1 overdue', no ? 'Purring klar til sending' : 'Reminder ready to send']],
      table: { title: no ? 'Dagens plan' : "Today's schedule", meta: ex, head: [no ? 'Tid' : 'Time', no ? 'Jobb' : 'Job', no ? 'Kunde' : 'Customer', 'Status'],
        rows: [{ cells: ['08:00', no ? 'Lekkasje · kjøkken' : 'Leak repair · kitchen', 'A. Berg'], status: ['info', S.progress] },
               { cells: ['11:30', no ? 'Service på varmtvannsbereder' : 'Water heater service', 'Hansen Eiendom AS'], status: ['wait', S.scheduled] },
               { cells: ['14:00', no ? 'Befaring · bad' : 'Site visit · bathroom', 'M. Nilsen'], status: ['wait', S.scheduled] }] },
    },
    customers: {
      m: [[no ? 'KUNDER' : 'CUSTOMERS', no ? 'Privat og bedrift' : 'Private and business', no ? 'Én kundehistorikk hver' : 'One history each'],
          [no ? 'AVTALEKUNDER' : 'CONTRACT CUSTOMERS', no ? 'Månedlig faktura' : 'Monthly invoice', no ? 'Faste vilkår' : 'Agreed terms'],
          [no ? 'MELDINGER' : 'MESSAGES', no ? 'Samlet på kunden' : 'Kept with the customer', no ? 'Ingen tråder å lete etter' : 'No threads to search']],
      table: { title: no ? 'Kunder' : 'Customers', meta: ex, head: [no ? 'Kunde' : 'Customer', 'Type', no ? 'Siste jobb' : 'Last job', 'Status'],
        rows: [{ cells: ['A. Berg', no ? 'Privat' : 'Private', no ? 'Lekkasje · i dag' : 'Leak repair · today'], status: ['info', S.progress] },
               { cells: ['Hansen Eiendom AS', no ? 'Bedrift · 4 bygg' : 'Company · 4 buildings', no ? 'Service · i dag' : 'Service · today'], status: ['ok', S.active] },
               { cells: ['M. Nilsen', no ? 'Privat' : 'Private', no ? 'Befaring · bad' : 'Site visit · bathroom'], status: ['wait', no ? 'Tilbud å sende' : 'Quote to send'] }] },
    },
    services: {
      m: [[no ? 'TJENESTER' : 'SERVICES', no ? '3 i katalogen' : '3 in the catalogue', no ? 'Hver med sin bestilling' : 'Each with its booking'],
          [no ? 'PRISER' : 'PRICES', no ? 'Time · fast · tilbud' : 'Hourly · fixed · quote', no ? 'MVA på hver linje' : 'MVA on every line'],
          [no ? 'BESTILLING' : 'BOOKING', no ? 'Kunden velger tid' : 'Customers pick a time', no ? 'Eller ber om tilbud' : 'Or ask for a quote']],
      table: { title: no ? 'Tjenester og priser' : 'Services and prices', meta: ex, head: [no ? 'Tjeneste' : 'Service', no ? 'Bestilling' : 'Booking', no ? 'Pris' : 'Price', ''],
        rows: [{ cells: [no ? 'Lekkasjereparasjon' : 'Leak repair', no ? 'Time hos tekniker' : 'Appointment', `${kr(950)} / ${no ? 'time' : 'hour'}`], status: ['ok', S.active] },
               { cells: [no ? 'Service på bereder' : 'Water heater service', no ? 'Fast pris' : 'Fixed price', kr(2400)], status: ['ok', S.active] },
               { cells: [no ? 'Baderomsrenovering' : 'Bathroom renovation', no ? 'Tilbud først' : 'Quote first', no ? 'Etter befaring' : 'After a site visit'], status: ['ok', S.active] }] },
    },
    bookings: {
      m: [[no ? 'NYE' : 'NEW', no ? '2 forespørsler' : '2 requests', no ? 'Sjekk omfang' : 'Check the scope'],
          [no ? 'DENNE UKEN' : 'THIS WEEK', no ? '9 jobber' : '9 jobs', no ? 'Fordelt på 3 teknikere' : 'Across 3 technicians'],
          [no ? 'FULLFØRT' : 'COMPLETED', no ? 'Klar til faktura' : 'Ready to invoice', no ? 'Fra jobben, uten ny registrering' : 'From the job, no retyping']],
      table: { title: no ? 'Jobber' : 'Jobs', meta: ex, head: [no ? 'Jobb' : 'Job', no ? 'Når' : 'When', no ? 'Tildelt' : 'Assigned', 'Status'],
        rows: [{ cells: [no ? 'Lekkasje · kjøkken' : 'Leak repair · kitchen', no ? 'I dag 08:00' : 'Today 08:00', 'Jonas'], status: ['info', S.progress] },
               { cells: [no ? 'Ny blandebatteri' : 'New mixer tap', no ? 'I går' : 'Yesterday', 'Sara'], status: ['ok', S.done] },
               { cells: [no ? 'Befaring · bad' : 'Site visit · bathroom', no ? 'I dag 14:00' : 'Today 14:00', 'Jonas'], status: ['wait', S.scheduled] }] },
    },
    quotes: {
      m: [[no ? 'UTKAST' : 'DRAFTS', no ? '1 tilbud' : '1 quote', no ? 'Fra befaring' : 'From a site visit'],
          [no ? 'SENDT' : 'SENT', no ? '2 tilbud' : '2 quotes', no ? 'Venter på kunden' : 'Waiting on the customer'],
          [no ? 'AKSEPTERT' : 'ACCEPTED', no ? 'Blir til jobb' : 'Becomes a job', no ? 'Omfanget følger med' : 'The scope carries over']],
      table: { title: no ? 'Tilbud' : 'Quotes', meta: ex, head: [no ? 'Tilbud' : 'Quote', no ? 'Kunde' : 'Customer', no ? 'Beløp inkl. MVA' : 'Amount incl. MVA', 'Status'],
        rows: [{ cells: [no ? 'Baderomsrenovering' : 'Bathroom renovation', 'M. Nilsen', kr(86250)], status: ['info', S.draft] },
               { cells: [no ? 'Nye stoppekraner' : 'New stop valves', 'Hansen Eiendom AS', kr(12500)], status: ['wait', S.sent] },
               { cells: [no ? 'Varmekabler' : 'Underfloor heating', 'K. Lie', kr(18750)], status: ['ok', S.accepted] }] },
    },
    invoices: {
      m: [[no ? 'SENDT' : 'SENT', no ? '2 fakturaer' : '2 invoices', no ? 'Ikke forfalt' : 'Not yet due'],
          [no ? 'FORFALT' : 'OVERDUE', no ? '1 faktura' : '1 invoice', no ? 'Purring klar' : 'Reminder ready'],
          [no ? 'BETALT' : 'PAID', no ? 'Avstemt' : 'Matched', no ? 'Mot KID og betaling' : 'By KID and payment']],
      table: { title: no ? 'Fakturaer' : 'Invoices', meta: ex, head: [no ? 'Faktura' : 'Invoice', no ? 'Kunde' : 'Customer', no ? 'Beløp' : 'Amount', 'Status'],
        rows: [{ cells: ['1042', 'A. Berg', kr(3412.5)], status: ['wait', S.sent] },
               { cells: ['1041', 'Hansen Eiendom AS', kr(2150)], status: ['ok', S.paid] },
               { cells: ['1036', 'P. Dahl', kr(1875)], status: ['due', S.overdue] }] },
    },
    records: {
      m: [[no ? 'INNTEKTER' : 'INCOME', no ? 'Bilag per faktura' : 'A voucher per invoice', no ? 'Med MVA-kode' : 'With an MVA code'],
          [no ? 'UTGIFTER' : 'EXPENSES', no ? 'Kvittering på bilaget' : 'Receipt on the voucher', no ? 'Mangler vises' : 'Gaps are shown'],
          [no ? 'ÅRSOPPGJØR' : 'YEAR END', 'SAF-T', no ? 'Til regnskapsføreren' : 'For your accountant']],
      table: { title: no ? 'Regnskapsgrunnlag' : 'Business records', meta: ex, head: [no ? 'Grunnlag' : 'Record', no ? 'Periode' : 'Period', no ? 'Innhold' : 'Contents', 'Status'],
        rows: [{ cells: [no ? 'Inntektsbilag' : 'Income vouchers', no ? 'Denne måneden' : 'This month', no ? 'Fra fakturaene' : 'From the invoices'], status: ['ok', S.ready] },
               { cells: [no ? 'Utgiftsbilag' : 'Expense vouchers', no ? 'Denne måneden' : 'This month', no ? '2 kvitteringer mangler' : '2 receipts missing'], status: ['due', S.missing] },
               { cells: [no ? 'SAF-T-fil' : 'SAF-T file', no ? 'Hele året' : 'The year', no ? 'For gjennomgang' : 'For review'], status: ['wait', no ? 'Ved årsslutt' : 'At year end'] }] },
    },
    team: {
      m: [[no ? 'TEAM' : 'TEAM', no ? '4 personer' : '4 people', no ? '3 teknikere og kontor' : '3 technicians and the office'],
          [no ? 'ROLLER' : 'ROLES', no ? 'Hver med sin tilgang' : 'Each with its access', no ? 'Bare det som trengs' : 'Only what is needed'],
          [no ? 'LOGG' : 'ACTIVITY', no ? 'Hvem gjorde hva' : 'Who did what', no ? 'På hver post' : 'On every record']],
      table: { title: no ? 'Team og tilgang' : 'Team and access', meta: ex, head: no ? ['Person', 'Rolle', 'Tilgang', ''] : ['Person', 'Role', 'Access', ''],
        rows: [{ cells: ['Ingrid', no ? 'Eier' : 'Owner', no ? 'Alt, også fakturering' : 'Everything, including billing'], status: ['ok', S.active] },
               { cells: ['Sara', no ? 'Kontor' : 'Office', no ? 'Tilbud, fakturaer, kunder' : 'Quotes, invoices, customers'], status: ['ok', S.active] },
               { cells: ['Jonas', no ? 'Tekniker' : 'Technician', no ? 'Egne jobber og timer' : 'Own jobs and hours'], status: ['ok', S.active] }] },
    },
  };
}

/* ── Financial workspace ────────────────────────────────────────────────── */
type Doc = { title: string; status: string; left: [string, string]; right: [string, string]; head: string[]; rows: string[][]; totals: [string, string][] };
function finance(lang: Lang): Record<string, { m: Metric[]; doc: Doc }> {
  const no = lang === 'no';
  const kr = (n: number) => money(lang, n);
  const company: [string, string] = [no ? 'Eksempel Service AS' : 'Example Services AS', no ? 'Org.nr. og kontonummer vises her' : 'Organisation and account numbers appear here'];
  const invoice: Doc = {
    title: no ? 'Faktura 1042' : 'Invoice 1042', status: no ? 'SENDT · EKSEMPEL' : 'SENT · EXAMPLE', left: company,
    right: [no ? 'Forfall om 14 dager' : 'Due in 14 days', 'KID 0001042 · A. Berg'],
    head: [no ? 'BESKRIVELSE' : 'DESCRIPTION', no ? 'ANTALL' : 'QTY', no ? 'BELØP' : 'AMOUNT'],
    rows: [[no ? 'Lekkasjereparasjon, arbeid' : 'Leak repair, labour', `2 × ${kr(950)}`, kr(1900)],
           [no ? 'Deler og koblinger' : 'Parts and fittings', '1', kr(480)],
           [no ? 'Utrykning' : 'Call-out', '1', kr(350)]],
    totals: [[no ? 'Sum eks. MVA' : 'Subtotal', kr(2730)], ['MVA 25 %', kr(682.5)], [no ? 'Å betale' : 'Total due', kr(3412.5)]],
  };
  return {
    overview: {
      m: [[no ? 'UTESTÅENDE' : 'OUTSTANDING', no ? '2 fakturaer' : '2 invoices', no ? 'Sendt, ikke forfalt' : 'Sent, not yet due'],
          [no ? 'FORFALT' : 'OVERDUE', no ? '1 faktura' : '1 invoice', no ? 'Purring klar' : 'Reminder ready'],
          [no ? 'BETALT' : 'PAID', no ? 'Avstemt automatisk' : 'Matched automatically', no ? 'KID mot betaling' : 'KID to payment']],
      doc: invoice,
    },
    quotes: {
      m: [[no ? 'FORESPØRSEL' : 'REQUEST', no ? 'Fra befaring' : 'From a site visit', no ? 'Bilder og mål' : 'Photos and measurements'],
          [no ? 'TILBUD' : 'QUOTE', no ? 'Linjer og vilkår' : 'Lines and terms', no ? 'Gyldig i 30 dager' : 'Valid for 30 days'],
          [no ? 'AKSEPT' : 'ACCEPTANCE', no ? 'Blir til jobb' : 'Becomes a job', no ? 'Og senere faktura' : 'And later the invoice']],
      doc: { title: no ? 'Tilbud 318 · baderom' : 'Quote 318 · bathroom', status: no ? 'UTKAST · EKSEMPEL' : 'DRAFT · EXAMPLE', left: company, right: [no ? 'Gyldig i 30 dager' : 'Valid for 30 days', 'M. Nilsen'],
        head: [no ? 'BESKRIVELSE' : 'DESCRIPTION', no ? 'ANTALL' : 'QTY', no ? 'BELØP' : 'AMOUNT'],
        rows: [[no ? 'Riving og forarbeid' : 'Removal and preparation', no ? '16 timer' : '16 hours', kr(15200)],
               [no ? 'Rørlegging og membran' : 'Plumbing and membrane', no ? '32 timer' : '32 hours', kr(30400)],
               [no ? 'Materialer etter liste' : 'Materials as listed', '1', kr(23400)]],
        totals: [[no ? 'Sum eks. MVA' : 'Subtotal', kr(69000)], ['MVA 25 %', kr(17250)], [no ? 'Tilbudssum' : 'Quote total', kr(86250)]] },
    },
    invoices: {
      m: [[no ? 'KILDE' : 'SOURCE', no ? 'Fullført jobb' : 'A completed job', no ? 'Linjene følger med' : 'Its lines carry over'],
          [no ? 'FAKTURA' : 'INVOICE', no ? 'MVA og forfall' : 'MVA and due date', no ? 'KID på hver faktura' : 'A KID on every invoice'],
          ['STATUS', no ? 'Utkast · sendt · betalt' : 'Draft · sent · paid', no ? 'Purring ved forfall' : 'A reminder when due']],
      doc: invoice,
    },
    payments: {
      m: [[no ? 'INNBETALINGER' : 'PAYMENTS', no ? 'Vipps, kort, bank' : 'Vipps, card, bank', no ? 'Med referanse' : 'With a reference'],
          [no ? 'AVSTEMMING' : 'MATCHING', no ? 'KID mot faktura' : 'KID to invoice', no ? 'Avvik vises' : 'Differences are shown'],
          [no ? 'KVITTERING' : 'RECEIPT', no ? 'Til kunden' : 'To the customer', no ? 'Når betalingen er inne' : 'When payment arrives']],
      doc: { title: no ? 'Innbetalinger' : 'Payments received', status: no ? 'AVSTEMT · EKSEMPEL' : 'MATCHED · EXAMPLE', left: company, right: [no ? 'Denne uken' : 'This week', no ? '3 innbetalinger' : '3 payments'],
        head: no ? ['BETALING', 'FAKTURA', 'BELØP'] : ['PAYMENT', 'INVOICE', 'AMOUNT'],
        rows: [['Vipps · Hansen Eiendom AS', '1041', kr(2150)], [no ? 'Bank · KID 0001039' : 'Bank · KID 0001039', '1039', kr(8900)], [no ? 'Kort · K. Lie' : 'Card · K. Lie', '1040', kr(4375)]],
        totals: [[no ? 'Avstemt mot fakturaer' : 'Matched to invoices', kr(15425)]] },
    },
    expenses: {
      m: [[no ? 'UTGIFT' : 'EXPENSE', no ? 'Leverandør og dato' : 'Supplier and date', no ? 'Fra kvitteringen' : 'From the receipt'],
          [no ? 'KATEGORI' : 'CATEGORY', no ? 'Konto og MVA-kode' : 'Account and MVA code', no ? 'Foreslått, du bekrefter' : 'Suggested, you confirm'],
          [no ? 'BILAG' : 'EVIDENCE', no ? 'Kvittering vedlagt' : 'Receipt attached', no ? 'Mangler vises' : 'Gaps are shown']],
      doc: { title: no ? 'Utgifter' : 'Expenses', status: no ? 'DENNE MÅNEDEN · EKSEMPEL' : 'THIS MONTH · EXAMPLE', left: company, right: [no ? 'Kvitteringer' : 'Receipts', no ? '1 mangler' : '1 missing'],
        head: [no ? 'LEVERANDØR' : 'SUPPLIER', 'MVA', no ? 'BELØP' : 'AMOUNT'],
        rows: [[no ? 'Rørgrossist · deler' : 'Plumbing wholesaler · parts', '25 %', kr(1240)], [no ? 'Drivstoff · varebil' : 'Fuel · van', '25 %', kr(890)], [no ? 'Verktøy · kvittering mangler' : 'Tools · receipt missing', '25 %', kr(2350)]],
        totals: [[no ? 'Sum utgifter' : 'Total expenses', kr(4480)]] },
    },
    tax: {
      m: [[no ? 'MVA' : 'MVA', no ? 'Kode på hver linje' : 'A code on every line', no ? 'Fra fakturaer og bilag' : 'From invoices and vouchers'],
          [no ? 'KONTOER' : 'ACCOUNTS', no ? 'Bilag per konto' : 'Vouchers by account', no ? 'Inntekt og utgift' : 'Income and expense'],
          [no ? 'GJENNOMGANG' : 'REVIEW', no ? 'Avvik markert' : 'Exceptions marked', no ? 'Før innsending' : 'Before filing']],
      doc: { title: no ? 'Årsoppgjør · eksport' : 'Year-end export', status: no ? 'KUN FORBEREDELSE' : 'PREPARATION ONLY', left: company, right: [no ? 'For regnskapsføreren' : 'For your accountant', 'SAF-T Financial'],
        head: [no ? 'GRUNNLAG' : 'RECORD', no ? 'INNHOLD' : 'CONTENTS', 'STATUS'],
        rows: [[no ? 'Inntektsbilag' : 'Income vouchers', no ? 'Per konto' : 'By account', no ? 'Klar' : 'Ready'], [no ? 'Utgiftsbilag' : 'Expense vouchers', no ? 'Med kvittering' : 'With receipts', no ? '2 mangler' : '2 missing'], [no ? 'MVA-koder' : 'MVA codes', no ? 'Per bilagslinje' : 'Per voucher line', no ? 'Klar' : 'Ready']],
        totals: [[no ? 'Må gjennomgås av regnskapsfører' : 'Subject to your accountant’s review', '']] },
    },
    reports: {
      m: [[no ? 'SALG' : 'SALES', no ? 'Per måned' : 'By month', no ? 'Tilbud og fakturaer' : 'Quotes and invoices'],
          [no ? 'LIKVIDITET' : 'CASH FLOW', no ? 'Inn og ut' : 'In and out', no ? 'Utestående vises' : 'Outstanding shown'],
          [no ? 'EKSPORT' : 'EXPORTS', 'CSV · SAF-T', no ? 'For godkjent gjennomgang' : 'For authorised review']],
      doc: { title: no ? 'Rapport · denne måneden' : 'Report · this month', status: no ? 'EKSEMPEL' : 'EXAMPLE', left: company, right: [no ? 'Periode' : 'Period', no ? 'Denne måneden' : 'This month'],
        head: [no ? 'POST' : 'ITEM', no ? 'ANTALL' : 'COUNT', no ? 'BELØP' : 'AMOUNT'],
        rows: [[no ? 'Fakturert' : 'Invoiced', '8', kr(31250)], [no ? 'Innbetalt' : 'Received', '6', kr(24375)], [no ? 'Utgifter' : 'Expenses', '3', kr(4480)]],
        totals: [[no ? 'Utestående' : 'Outstanding', kr(6875)]] },
    },
  };
}

/* ── Rendering into the design's panels ─────────────────────────────────── */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function table(head: string[], rows: Row[]) {
  const t = el('table', 'v2-records');
  const hr = el('tr');
  head.forEach(h => hr.append(el('th', undefined, h)));
  t.append(el('thead'), el('tbody'));
  t.tHead!.append(hr);
  rows.forEach(r => {
    const tr = el('tr');
    r.cells.forEach(c => tr.append(el('td', undefined, c)));
    const td = el('td');
    if (r.status) td.append(el('span', `v2-chip v2-chip-${r.status[0]}`, r.status[1]));
    tr.append(td);
    t.tBodies[0].append(tr);
  });
  return t;
}

function metrics(box: HTMLElement | null, m: Metric[]) {
  box?.replaceChildren(...m.map(([s, b, e]) => {
    const a = el('article');
    a.append(el('small', undefined, s), el('b', undefined, b), el('em', undefined, e));
    return a;
  }));
}

/** Installs the example records on the page's two workspaces; returns a cleanup. */
export function installDemoRecords(root: HTMLElement, lang: Lang): () => void {
  const bw = workspace(lang), fin = finance(lang);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  const renderBw = (key: string) => {
    const d = bw[key]; if (!d) return;
    metrics(q('#bw-metrics'), d.m);
    const title = q('#bw-panel-title'), meta = q('#bw-panel-meta'), content = q('#bw-panel-content');
    if (title) title.textContent = d.table.title;
    if (meta) meta.textContent = d.table.meta;
    content?.replaceChildren(table(d.table.head, d.table.rows));
  };
  const renderFin = (key: string) => {
    const d = fin[key]; if (!d) return;
    metrics(q('#finance-metrics'), d.m);
    const t = q('#finance-doc-title'), s = q('#finance-doc-status'), c = q('#finance-doc-content');
    if (t) t.textContent = d.doc.title;
    if (s) s.textContent = d.doc.status;
    const meta = el('div', 'finance-doc-meta');
    [d.doc.left, d.doc.right].forEach(([b, small]) => { const x = el('div'); x.append(el('b', undefined, b), el('small', undefined, small)); meta.append(x); });
    const lines = el('table', 'finance-lines');
    const hr = el('tr'); d.doc.head.forEach(h => hr.append(el('th', undefined, h)));
    lines.append(el('thead'), el('tbody')); lines.tHead!.append(hr);
    d.doc.rows.forEach(r => { const tr = el('tr'); r.forEach(v => tr.append(el('td', undefined, v))); lines.tBodies[0].append(tr); });
    const totals = el('div', 'v2-totals');
    d.doc.totals.forEach(([k, v], i) => { const row = el('div', i === d.doc.totals.length - 1 ? 'v2-total-final' : undefined); row.append(el('span', undefined, k), el('b', undefined, v)); totals.append(row); });
    c?.replaceChildren(meta, lines, totals);
  };

  /* After the design's own handler on the same tab (it was added first). */
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-bw]'); if (b && root.contains(b)) renderBw(b.dataset.bw!);
    const f = t.closest<HTMLElement>('[data-finance]'); if (f && root.contains(f)) renderFin(f.dataset.finance!);
  };
  root.addEventListener('click', onClick);
  renderBw(q<HTMLElement>('[data-bw][aria-pressed="true"]')?.dataset.bw ?? 'overview');
  renderFin(q<HTMLElement>('[data-finance][aria-pressed="true"]')?.dataset.finance ?? 'overview');
  return () => root.removeEventListener('click', onClick);
}
