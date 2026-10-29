/**
 * The office's and the documents' wording, in English and Norwegian
 * (bokmål). Self-contained, so the accounting module carries it to another
 * product. Both languages have exactly the same keys (tested).
 */
import type { Lang } from './documents/model';

const en = {
  office: 'Accounting', language: 'Language', english: 'English', norwegian: 'Norsk',
  tabOverview: 'Overview', tabVouchers: 'Vouchers', tabReports: 'Reports', tabDocuments: 'Documents', tabPeople: 'Back office', tabSettings: 'Settings',
  loading: 'Loading…', save: 'Save', cancel: 'Cancel', close: 'Close', add: 'Add', remove: 'Remove', change: 'Change', download: 'Download',
  from: 'From', to: 'To', date: 'Date', year: 'Year', term: 'Term', account: 'Account', accountName: 'Account name', description: 'Description',
  amount: 'Amount', debit: 'Debit', credit: 'Credit', balance: 'Balance', opening: 'Opening balance', closing: 'Closing balance',
  mvaCode: 'MVA code', party: 'Customer or supplier', voucher: 'Voucher', number: 'No.', total: 'Total', basis: 'Basis', mva: 'MVA',
  noLedger: 'This company has no accounting yet.',
  offerTitle: 'Accounting, built in',
  offerBody: 'Every invoice, credit note and payment you handle on the platform is posted for you. Add your purchases and other costs with the receipt, and the books, the MVA return and the year-end documents are ready when they are due, in PDF, Word and SAF-T, for your accountant to review.',
  offerPrice: 'Priced by your company\'s yearly turnover:',
  offerProposed: 'Provisional prices for the pilot period; the price that applies is the one in your agreement.',
  under: 'under', toUnder: 'to under', andAbove: 'and above',
  offerAgreed: 'Above the last band the price is agreed.',
  offerTerms: 'Excl. MVA, billed monthly in advance. Cancel at any time, effective at the end of the paid month. Unlimited vouchers, users and documents under fair use.',
  startDate: 'Books start on', declaredTurnover: 'Turnover last year or expected this year (NOK)', ask: 'Ask for accounting',
  requested: 'Asked for: waiting for approval.', declined: 'Declined', ended: 'Ended: the books stay readable.',
  role: 'Your role', roleOwner: 'Owner or admin', roleAccountant: 'Accountant', roleBookkeeper: 'Bookkeeper', roleAuditor: 'External auditor', roleViewer: 'Viewer',
  newVoucher: 'New voucher', postVoucher: 'Post voucher', addLine: 'Add line', lines: 'Lines', grossNote: 'With an MVA code the amount includes MVA; it is split for you.',
  positiveDebit: 'Positive is debit, negative is credit.', balanced: 'Balances', unbalanced: 'Does not balance by',
  receipt: 'Receipt', attachReceipt: 'Attach receipt', noReceipt: 'no receipt', reverse: 'Reverse', reason: 'Reason', reversed: 'reversed',
  automatic: 'automatic', manual: 'manual', notes: 'Notes', addNote: 'Add note', writeNote: 'Write a note…',
  trialBalance: 'Trial balance', generalLedger: 'General ledger', incomeStatement: 'Income statement', balanceSheet: 'Balance sheet',
  mvaReturn: 'MVA return', settleMva: 'Settle MVA for the term', checks: 'Checks', ok: 'OK', attention: 'Look at this',
  unposted: 'Not yet in the books', postUnposted: 'Post them now', nothingUnposted: 'Everything from invoicing is in the books.',
  documents: 'Documents', format: 'Format', pdf: 'PDF', word: 'Word', saft: 'SAF-T (XML)', package: 'Accountant package (ZIP)',
  packageBody: 'Everything the accountant needs for the year in one file: every document in PDF and Word, SAF-T, the general ledger as CSV and the receipts list.',
  people: 'People with access', invite: 'Invite', email: 'Email', name: 'Name', firm: 'Firm', validUntil: 'Access until', invitations: 'Invitations',
  inviteSent: 'Invitation created. The link is valid for 14 days:', copyLink: 'Copy link', revoke: 'Withdraw', removed: 'Removed', active: 'Active',
  auditorNeedsEnd: 'An external auditor\'s access needs an end date.',
  settings: 'Settings', vatRegistered: 'Registered for MVA', mvaTerm: 'MVA term', bimonthly: 'Every two months', yearly: 'Yearly (turnover under NOK 1 million, on application)',
  zeroRate: '0 % sales are', zeroRate5: 'exempt with zero rate (code 5)', zeroRate6: 'outside the MVA Act (code 6)', autoPost: 'Post invoices and payments automatically',
  lockPeriod: 'Close the period up to', lockedUntil: 'Closed up to', closeYear: 'Close the year', chart: 'Chart of accounts', grouping: 'Tax return grouping',
  confirm: 'Are you sure?', done: 'Done.', failed: 'It did not work:', price: 'Price', perMonth: 'per month', exclVat: 'excl. MVA',
  docMvaTitle: 'MVA-melding: basis', docMvaSub: 'MVA return basis per standard code',
  docIncomeTitle: 'Resultatregnskap', docIncomeSub: 'Income statement',
  docBalanceTitle: 'Balanse', docBalanceSub: 'Balance sheet',
  docAnnualTitle: 'Årsregnskap', docAnnualSub: 'Annual accounts (draft for the board)',
  docTaxTitle: 'Næringsspesifikasjon: basis', docTaxSub: 'Basis for the business tax return, by Skatteetaten\'s codes',
  docTrialTitle: 'Saldobalanse', docTrialSub: 'Trial balance',
  docLedgerTitle: 'Hovedbok', docLedgerSub: 'General ledger',
  docJournalTitle: 'Bilagsjournal', docJournalSub: 'Voucher journal',
  docReceivablesTitle: 'Kundereskontro', docReceivablesSub: 'Customer balances',
  docPayablesTitle: 'Leverandørreskontro', docPayablesSub: 'Supplier balances',
  docReviewTitle: 'Kontrolloppstilling', docReviewSub: 'Reconciliation and checks for the accountant',
  docCalendarTitle: 'Frister og innleveringer', docCalendarSub: 'What is due to the authorities this year',
  period: 'Period', at: 'At', generated: 'Generated', page: 'Page', company: 'Company', orgNumber: 'Organisation number',
  footer: 'Made with FlyttGo Regnskap from the books', draft: 'Draft',
  mvaPayable: 'MVA to pay', mvaRefund: 'MVA to be refunded', outputMva: 'Output MVA', inputMva: 'Deductible input MVA',
  mvaNote: 'Submit the MVA return in Altinn or through Skatteetaten\'s API; this is its basis, by standard MVA code. Check it against the MVA accounts (see the reconciliation).',
  revenue: 'Operating income', expenses: 'Operating expenses', operatingResult: 'Operating result', financial: 'Financial items and tax', result: 'Result for the period',
  assets: 'Assets', equity: 'Equity', liabilities: 'Liabilities', sumAssets: 'Total assets', sumEquityLiabilities: 'Total equity and liabilities',
  unclosedResult: 'Result not yet closed into equity',
  notesTitle: 'Notes', principlesTitle: 'Note 1 – Accounting principles',
  principlesBody: 'The annual accounts are prepared under the Accounting Act and generally accepted accounting principles for small enterprises. Income is recognised when earned; costs in the same period as the income they relate to. Receivables are shown at nominal value less expected losses.',
  employeesTitle: 'Note 2 – Employees and remuneration', employeesBody: 'Number of employees (full-time equivalents) during the year: ____. Remuneration to the managing director and the board: ____.',
  equityTitle: 'Note 3 – Equity', equityBody: 'Equity at the start of the year, result for the year and equity at the end of the year are shown in the balance sheet. Fill in dividends and other changes.',
  boardSign: 'Board member', chairSign: 'Chair of the board', ceoSign: 'Managing director', placeDate: 'Place and date',
  annualNote: 'Draft made from the books. The board approves and signs the annual accounts; small enterprises file them with Regnskapsregisteret (Brønnøysund) by 31 July.',
  taxNote: 'Basis for the næringsspesifikasjon in the tax return (skattemelding for næringsdrivende), due 31 May: the year\'s amounts per Skatteetaten code. Tax adjustments (permanent and temporary differences) are added by the accountant.',
  category: 'Category', code: 'Code', line: 'Line', open: 'Open balance', customer: 'Customer', supplier: 'Supplier', unknownParty: '(no name)',
  check: 'Check', result_: 'Result', detail: 'Detail', reviewNote: 'The accountant\'s first look: these checks should all be OK before the books are reviewed.',
  deadline: 'Deadline', filing: 'What', ready: 'From the books', notFromBooks: 'Needs information not in the books',
  calendarNote: 'Usual deadlines; Skatteetaten and Brønnøysund publish the exact dates each year (a deadline on a weekend or holiday moves to the next working day).',
  calMva: 'MVA-melding, term', calMvaYear: 'MVA-melding, yearly term', calShareholders: 'Aksjonærregisteroppgaven (shareholder register return)', calTax: 'Skattemelding for næringsdrivende with næringsspesifikasjon',
  calAnnual: 'Årsregnskap to Regnskapsregisteret (limited companies)', calAmelding: 'A-melding (salaries), each month by the 5th',
  yes: 'Yes', no: 'No',
  cancelTitle: 'Cancel accounting', cancelBody: 'Monthly, with no minimum term: the service continues to the end of this month, which is paid; after that the books stay readable but take no new vouchers. Download the accountant package first.',
  cancelButton: 'Cancel at the end of the month', cancelledUntil: 'Cancelled: the last day is', withdraw: 'Withdraw the cancellation',
};

type Strings = typeof en;

const no: Strings = {
  office: 'Regnskap', language: 'Språk', english: 'English', norwegian: 'Norsk',
  tabOverview: 'Oversikt', tabVouchers: 'Bilag', tabReports: 'Rapporter', tabDocuments: 'Dokumenter', tabPeople: 'Backoffice', tabSettings: 'Innstillinger',
  loading: 'Laster …', save: 'Lagre', cancel: 'Avbryt', close: 'Lukk', add: 'Legg til', remove: 'Fjern', change: 'Endre', download: 'Last ned',
  from: 'Fra', to: 'Til', date: 'Dato', year: 'År', term: 'Termin', account: 'Konto', accountName: 'Kontonavn', description: 'Beskrivelse',
  amount: 'Beløp', debit: 'Debet', credit: 'Kredit', balance: 'Saldo', opening: 'Inngående saldo', closing: 'Utgående saldo',
  mvaCode: 'Mva-kode', party: 'Kunde eller leverandør', voucher: 'Bilag', number: 'Nr.', total: 'Sum', basis: 'Grunnlag', mva: 'Mva',
  noLedger: 'Selskapet har ikke regnskap her ennå.',
  offerTitle: 'Regnskap, innebygd',
  offerBody: 'Alle fakturaer, kreditnotaer og innbetalinger du håndterer på plattformen, bokføres for deg. Legg inn innkjøp og andre kostnader med kvittering, så er regnskapet, mva-meldingen og årsoppgjørsdokumentene klare når de skal leveres – i PDF, Word og SAF-T, til gjennomgang hos regnskapsføreren din.',
  offerPrice: 'Prisen følger selskapets årlige omsetning:',
  offerProposed: 'Foreløpige priser i pilotperioden; prisen som gjelder, er den i avtalen din.',
  under: 'under', toUnder: 'til under', andAbove: 'og over',
  offerAgreed: 'Over øverste trinn avtales prisen.',
  offerTerms: 'Eks. mva, faktureres månedlig forskuddsvis. Kan sies opp når som helst, med virkning fra slutten av den betalte måneden. Ubegrenset antall bilag, brukere og dokumenter ved rimelig bruk.',
  startDate: 'Regnskapet starter', declaredTurnover: 'Omsetning i fjor eller forventet i år (NOK)', ask: 'Bestill regnskap',
  requested: 'Bestilt: venter på godkjenning.', declined: 'Avslått', ended: 'Avsluttet: regnskapet kan fortsatt leses.',
  role: 'Din rolle', roleOwner: 'Eier eller administrator', roleAccountant: 'Regnskapsfører', roleBookkeeper: 'Regnskapsmedarbeider', roleAuditor: 'Ekstern revisor', roleViewer: 'Lesetilgang',
  newVoucher: 'Nytt bilag', postVoucher: 'Bokfør bilag', addLine: 'Ny linje', lines: 'Linjer', grossNote: 'Med mva-kode er beløpet inkludert mva; det deles for deg.',
  positiveDebit: 'Positivt er debet, negativt er kredit.', balanced: 'Går i balanse', unbalanced: 'Går ikke i balanse med',
  receipt: 'Kvittering', attachReceipt: 'Legg ved kvittering', noReceipt: 'ingen kvittering', reverse: 'Tilbakefør', reason: 'Begrunnelse', reversed: 'tilbakeført',
  automatic: 'automatisk', manual: 'manuelt', notes: 'Merknader', addNote: 'Legg til merknad', writeNote: 'Skriv en merknad …',
  trialBalance: 'Saldobalanse', generalLedger: 'Hovedbok', incomeStatement: 'Resultatregnskap', balanceSheet: 'Balanse',
  mvaReturn: 'Mva-melding', settleMva: 'Avregn mva for terminen', checks: 'Kontroller', ok: 'OK', attention: 'Se på dette',
  unposted: 'Ikke bokført ennå', postUnposted: 'Bokfør nå', nothingUnposted: 'Alt fra faktureringen er bokført.',
  documents: 'Dokumenter', format: 'Format', pdf: 'PDF', word: 'Word', saft: 'SAF-T (XML)', package: 'Pakke til regnskapsfører (ZIP)',
  packageBody: 'Alt regnskapsføreren trenger for året i én fil: alle dokumentene i PDF og Word, SAF-T, hovedboken som CSV og oversikten over kvitteringer.',
  people: 'Personer med tilgang', invite: 'Inviter', email: 'E-post', name: 'Navn', firm: 'Firma', validUntil: 'Tilgang til', invitations: 'Invitasjoner',
  inviteSent: 'Invitasjonen er laget. Lenken gjelder i 14 dager:', copyLink: 'Kopier lenke', revoke: 'Trekk tilbake', removed: 'Fjernet', active: 'Aktiv',
  auditorNeedsEnd: 'Ekstern revisor må ha en sluttdato for tilgangen.',
  settings: 'Innstillinger', vatRegistered: 'Registrert i Merverdiavgiftsregisteret', mvaTerm: 'Mva-termin', bimonthly: 'Annenhver måned', yearly: 'Årlig (omsetning under 1 million kroner, etter søknad)',
  zeroRate: 'Salg med 0 % er', zeroRate5: 'fritatt med nullsats (kode 5)', zeroRate6: 'utenfor merverdiavgiftsloven (kode 6)', autoPost: 'Bokfør fakturaer og innbetalinger automatisk',
  lockPeriod: 'Lukk perioden til og med', lockedUntil: 'Lukket til og med', closeYear: 'Avslutt året', chart: 'Kontoplan', grouping: 'Gruppering i skattemeldingen',
  confirm: 'Er du sikker?', done: 'Ferdig.', failed: 'Det gikk ikke:', price: 'Pris', perMonth: 'per måned', exclVat: 'eks. mva',
  docMvaTitle: 'Mva-melding: grunnlag', docMvaSub: 'Grunnlag for mva-meldingen per standard mva-kode',
  docIncomeTitle: 'Resultatregnskap', docIncomeSub: 'For perioden',
  docBalanceTitle: 'Balanse', docBalanceSub: 'Per dato',
  docAnnualTitle: 'Årsregnskap', docAnnualSub: 'Utkast til styret',
  docTaxTitle: 'Næringsspesifikasjon: grunnlag', docTaxSub: 'Grunnlag for skattemeldingen etter Skatteetatens koder',
  docTrialTitle: 'Saldobalanse', docTrialSub: 'For perioden',
  docLedgerTitle: 'Hovedbok', docLedgerSub: 'Alle posteringer per konto',
  docJournalTitle: 'Bilagsjournal', docJournalSub: 'Alle bilag i nummerorden',
  docReceivablesTitle: 'Kundereskontro', docReceivablesSub: 'Åpne saldoer per kunde',
  docPayablesTitle: 'Leverandørreskontro', docPayablesSub: 'Åpne saldoer per leverandør',
  docReviewTitle: 'Kontrolloppstilling', docReviewSub: 'Avstemming og kontroller for regnskapsføreren',
  docCalendarTitle: 'Frister og innleveringer', docCalendarSub: 'Det som skal leveres til myndighetene i år',
  period: 'Periode', at: 'Per', generated: 'Laget', page: 'Side', company: 'Selskap', orgNumber: 'Organisasjonsnummer',
  footer: 'Laget med FlyttGo Regnskap fra regnskapet', draft: 'Utkast',
  mvaPayable: 'Mva å betale', mvaRefund: 'Mva til gode', outputMva: 'Utgående mva', inputMva: 'Fradragsberettiget inngående mva',
  mvaNote: 'Mva-meldingen sendes i Altinn eller via Skatteetatens API; dette er grunnlaget per standard mva-kode. Kontroller mot mva-kontoene (se kontrolloppstillingen).',
  revenue: 'Driftsinntekter', expenses: 'Driftskostnader', operatingResult: 'Driftsresultat', financial: 'Finansposter og skatt', result: 'Resultat for perioden',
  assets: 'Eiendeler', equity: 'Egenkapital', liabilities: 'Gjeld', sumAssets: 'Sum eiendeler', sumEquityLiabilities: 'Sum egenkapital og gjeld',
  unclosedResult: 'Resultat som ikke er disponert',
  notesTitle: 'Noter', principlesTitle: 'Note 1 – Regnskapsprinsipper',
  principlesBody: 'Årsregnskapet er satt opp i samsvar med regnskapsloven og god regnskapsskikk for små foretak. Inntekter resultatføres når de er opptjent; kostnader i samme periode som inntektene de knytter seg til. Fordringer er oppført til pålydende med fradrag for forventet tap.',
  employeesTitle: 'Note 2 – Ansatte og godtgjørelser', employeesBody: 'Antall årsverk i året: ____. Godtgjørelse til daglig leder og styret: ____.',
  equityTitle: 'Note 3 – Egenkapital', equityBody: 'Egenkapital ved årets begynnelse, årets resultat og egenkapital ved årets slutt fremgår av balansen. Fyll inn utbytte og andre endringer.',
  boardSign: 'Styremedlem', chairSign: 'Styrets leder', ceoSign: 'Daglig leder', placeDate: 'Sted og dato',
  annualNote: 'Utkast laget fra regnskapet. Styret fastsetter og signerer årsregnskapet; små foretak sender det til Regnskapsregisteret (Brønnøysund) innen 31. juli.',
  taxNote: 'Grunnlag for næringsspesifikasjonen i skattemeldingen for næringsdrivende, frist 31. mai: årets beløp per Skatteetatens kode. Skattemessige justeringer (permanente og midlertidige forskjeller) legges inn av regnskapsføreren.',
  category: 'Kategori', code: 'Kode', line: 'Linje', open: 'Åpen saldo', customer: 'Kunde', supplier: 'Leverandør', unknownParty: '(uten navn)',
  check: 'Kontroll', result_: 'Resultat', detail: 'Detalj', reviewNote: 'Regnskapsførerens første blikk: alle kontrollene bør være OK før regnskapet gjennomgås.',
  deadline: 'Frist', filing: 'Hva', ready: 'Fra regnskapet', notFromBooks: 'Trenger opplysninger som ikke er i regnskapet',
  calendarNote: 'Vanlige frister; Skatteetaten og Brønnøysund publiserer nøyaktige datoer hvert år (en frist på helg eller helligdag flyttes til neste virkedag).',
  calMva: 'Mva-melding, termin', calMvaYear: 'Mva-melding, årstermin', calShareholders: 'Aksjonærregisteroppgaven', calTax: 'Skattemelding for næringsdrivende med næringsspesifikasjon',
  calAnnual: 'Årsregnskap til Regnskapsregisteret (aksjeselskaper)', calAmelding: 'A-melding (lønn), hver måned innen den 5.',
  yes: 'Ja', no: 'Nei',
  cancelTitle: 'Si opp regnskap', cancelBody: 'Månedlig, uten bindingstid: tjenesten varer ut denne måneden, som er betalt; deretter kan regnskapet fortsatt leses, men tar ikke imot nye bilag. Last ned pakken til regnskapsfører først.',
  cancelButton: 'Si opp fra slutten av måneden', cancelledUntil: 'Sagt opp: siste dag er', withdraw: 'Trekk oppsigelsen',
};

export const STRINGS: Record<Lang, Strings> = { en, no };
export type StringKey = keyof Strings;

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key] ?? STRINGS.en[key];
}

export function money(n: number | string | null | undefined, lang: Lang): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat(lang === 'no' ? 'nb-NO' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

export function day(d: string | Date | null | undefined, lang: Lang): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00` : d) : d;
  return new Intl.DateTimeFormat(lang === 'no' ? 'nb-NO' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Oslo' }).format(date);
}

/** A band's turnover range, half-open: "under 1 000 000", "1 000 000 to under 5 000 000", "100 000 000 and above". */
export function bandRange(lower: number, upTo: number | null, lang: Lang): string {
  const n = (v: number) => new Intl.NumberFormat(lang === 'no' ? 'nb-NO' : 'en-GB', { maximumFractionDigits: 0 }).format(v);
  if (upTo === null) return `${n(lower)} ${t(lang, 'andAbove')}`;
  if (lower === 0) return `${t(lang, 'under')} ${n(upTo)}`;
  return `${n(lower)} ${t(lang, 'toUnder')} ${n(upTo)}`;
}
