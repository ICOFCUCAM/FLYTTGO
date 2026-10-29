// ============================================================================
// FlyttGo — invoice and credit note PDF (A4)
// ============================================================================
//
// What a Norwegian invoice must show (bokføringsforskriften § 5-1-1):
//   number, invoice date, seller (name, organisation number with "MVA"
//   when VAT-registered, "Foretaksregisteret", address), buyer (name,
//   organisation number, address), delivery date or period, what was
//   delivered, quantity, price, VAT per rate, total, due date; and for
//   payment the bank account and KID.
//
// On the special plan the company's own name and logo head the invoice
// (branding); the legal seller is still FlyttGo and stays stated.
// Standard Helvetica (WinAnsi: æ ø å and the usual punctuation).
// ============================================================================
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import { formatBankAccount, nok, type Invoice, type InvoiceLine } from './invoices.ts';

const A4: [number, number] = [595.28, 841.89];
const M = 48;                                             // margin
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const ACCENT = rgb(0.04, 0.18, 0.35);                     // FlyttGo navy

/** Only characters Helvetica (WinAnsi) can draw. */
function safe(s: unknown): string {
  return String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\u00a0-\u00ff\u2013\u2014\u20ac]/g, '?');
}

const date = (d: string | null | undefined) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '';

export async function invoicePdf(
  inv: Invoice, lines: InvoiceLine[], logo?: { bytes: Uint8Array; type: 'png' | 'jpeg' } | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${inv.kind === 'credit_note' ? 'Kreditnota' : 'Faktura'} ${inv.number}`);
  doc.setAuthor(safe(inv.seller.name));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(A4);
  const W = A4[0];

  const text = (p: PDFPage, s: unknown, x: number, y: number, size = 9, f: PDFFont = font, color = INK) =>
    p.drawText(safe(s), { x, y, size, font: f, color });
  const right = (p: PDFPage, s: unknown, xr: number, y: number, size = 9, f: PDFFont = font, color = INK) =>
    p.drawText(safe(s), { x: xr - f.widthOfTextAtSize(safe(s), size), y, size, font: f, color });

  // ── Header: the brand (the company on the special plan) and the title ──
  let y = A4[1] - M;
  const brandName = inv.branding?.name ?? inv.seller.name;
  if (logo) {
    const img = logo.type === 'png' ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
    const scale = Math.min(140 / img.width, 48 / img.height, 1);
    page.drawImage(img, { x: M, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
    text(page, brandName, M, y - img.height * scale - 14, 10, bold, ACCENT);
  } else {
    text(page, brandName, M, y - 18, 18, bold, ACCENT);
  }
  const title = inv.kind === 'credit_note' ? 'KREDITNOTA' : 'FAKTURA';
  right(page, title, W - M, y - 18, 20, bold, ACCENT);

  // ── Invoice facts (right) ──
  const facts: [string, string][] = [
    [inv.kind === 'credit_note' ? 'Kreditnotanr.' : 'Fakturanr.', String(inv.number)],
    ['Fakturadato', date(inv.issue_date)],
    ...(inv.kind === 'invoice' ? [['Forfallsdato', date(inv.due_date)] as [string, string]] : []),
    ...(inv.credits_number ? [['Krediterer faktura', String(inv.credits_number)] as [string, string]] : []),
    ...(inv.delivery_from ? [['Leveringsdato', inv.delivery_to && inv.delivery_to !== inv.delivery_from
      ? `${date(inv.delivery_from)} – ${date(inv.delivery_to)}` : date(inv.delivery_from)] as [string, string]] : []),
    ...(inv.buyer.customer_number ? [['Kundenr.', String(inv.buyer.customer_number)] as [string, string]] : []),
    ...(inv.reference ? [['Deres ref.', inv.reference] as [string, string]] : []),
    ...(inv.kid ? [['KID', inv.kid] as [string, string]] : []),
  ];
  let fy = y - 46;
  for (const [k, v] of facts) {
    text(page, k, W - M - 190, fy, 9, font, MUTED);
    right(page, v, W - M, fy, 9, bold);
    fy -= 13;
  }

  // ── Buyer (left) ──
  let by = y - 96;
  text(page, 'Faktureres til', M, by, 8, font, MUTED); by -= 14;
  text(page, inv.buyer.name, M, by, 11, bold); by -= 13;
  for (const l of [inv.buyer.address, inv.buyer.postcode_city,
                   inv.buyer.org_number ? `Org.nr. ${inv.buyer.org_number}${inv.buyer.vat_registered ? ' MVA' : ''}` : null]) {
    if (l) { text(page, l, M, by, 9); by -= 12; }
  }

  // ── Lines ──
  y = Math.min(by, fy) - 28;
  const cols = { desc: M, qty: W - M - 250, price: W - M - 165, vat: W - M - 85, total: W - M };
  const header = (p: PDFPage, yy: number) => {
    text(p, 'Beskrivelse', cols.desc, yy, 8, bold, MUTED);
    right(p, 'Antall', cols.qty, yy, 8, bold, MUTED);
    right(p, 'Pris eks. mva', cols.price, yy, 8, bold, MUTED);
    right(p, 'Mva', cols.vat, yy, 8, bold, MUTED);
    right(p, 'Beløp eks. mva', cols.total, yy, 8, bold, MUTED);
    p.drawLine({ start: { x: M, y: yy - 5 }, end: { x: W - M, y: yy - 5 }, thickness: 0.6, color: RULE });
  };
  header(page, y);
  y -= 20;
  const maxDesc = cols.qty - 40 - M;
  for (const l of lines) {
    if (y < 190) { page = doc.addPage(A4); y = A4[1] - M; header(page, y); y -= 20; }
    // wrap the description to its column
    const words = safe(l.description).split(' ');
    const rows: string[] = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, 9) > maxDesc && cur) { rows.push(cur); cur = w; } else cur = t;
    }
    if (cur) rows.push(cur);
    text(page, rows[0] ?? '', cols.desc, y);
    right(page, String(l.quantity).replace('.', ','), cols.qty, y);
    right(page, nok(l.unit_price), cols.price, y);
    right(page, `${l.vat_rate} %`, cols.vat, y);
    right(page, nok(l.net_amount), cols.total, y);
    for (const r of rows.slice(1)) { y -= 11; text(page, r, cols.desc, y); }
    y -= 16;
  }

  // ── Totals ──
  page.drawLine({ start: { x: W - M - 230, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.6, color: RULE });
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const l of lines) {
    const r = byRate.get(l.vat_rate) ?? { net: 0, vat: 0 };
    r.net += l.net_amount; r.vat += l.vat_amount; byRate.set(l.vat_rate, r);
  }
  const totalRow = (k: string, v: string, b = false) => {
    text(page, k, W - M - 230, y - 8, b ? 11 : 9, b ? bold : font, b ? INK : MUTED);
    right(page, v, W - M, y - 8, b ? 11 : 9, b ? bold : font);
    y -= b ? 18 : 13;
  };
  totalRow('Sum eks. mva', nok(inv.net_total));
  for (const [rate, r] of byRate) totalRow(`Mva ${rate} % av ${nok(r.net)}`, nok(r.vat));
  totalRow(inv.kind === 'credit_note' ? 'Kreditert beløp' : 'Å betale', nok(inv.total), true);
  if ((inv.amount_paid ?? 0) > 0 || (inv.amount_credited ?? 0) > 0 || (inv.fees_total ?? 0) > 0) {
    if (inv.fees_total) totalRow('Gebyr og renter', nok(inv.fees_total));
    if (inv.amount_paid) totalRow('Betalt', nok(-(inv.amount_paid)));
    if (inv.amount_credited) totalRow('Kreditert', nok(-(inv.amount_credited)));
    totalRow('Gjenstår', nok(inv.total + (inv.fees_total ?? 0) - (inv.amount_paid ?? 0) - (inv.amount_credited ?? 0)), true);
  }
  if (inv.notes) {
    y -= 8;
    text(page, inv.notes, M, y, 9, font, MUTED);
    y -= 14;
  }

  // ── Payment box (invoices) ──
  if (inv.kind === 'invoice') {
    const bx = M, bw = W - 2 * M, bh = 58, byy = 110;
    page.drawRectangle({ x: bx, y: byy, width: bw, height: bh, color: rgb(0.96, 0.97, 0.98), borderColor: RULE, borderWidth: 0.6 });
    const cells: [string, string][] = [
      ['Kontonummer', formatBankAccount(inv.seller.bank_account)],
      ['KID', inv.kid ?? ''],
      ['Forfallsdato', date(inv.due_date)],
      ['Beløp', nok(inv.total + (inv.fees_total ?? 0) - (inv.amount_paid ?? 0) - (inv.amount_credited ?? 0))],
    ];
    cells.forEach(([k, v], i) => {
      const cx = bx + 14 + i * (bw - 28) / 4;
      text(page, k, cx, byy + bh - 20, 8, font, MUTED);
      text(page, v, cx, byy + bh - 38, 11, bold);
    });
    if (inv.seller.iban) text(page, `IBAN ${inv.seller.iban}${inv.seller.bic ? `   BIC ${inv.seller.bic}` : ''}`, bx + 14, byy + 6, 7, font, MUTED);
  }

  // ── Footer: the legal seller, on every page ──
  for (const p of doc.getPages()) {
    const s = inv.seller;
    const legal = [
      s.name,
      s.org_number ? `Org.nr. ${s.org_number}${s.vat_registered ? ' MVA' : ''}` : null,
      'Foretaksregisteret',
      [s.address, s.postcode_city].filter(Boolean).join(', '),
      s.email, s.phone,
    ].filter(Boolean).join('   ·   ');
    p.drawLine({ start: { x: M, y: 64 }, end: { x: W - M, y: 64 }, thickness: 0.6, color: RULE });
    text(p, inv.branding ? `Utstedt av ${s.name} for ${inv.branding.name}` : '', M, 50, 7, font, MUTED);
    text(p, legal, M, 38, 7, font, MUTED);
  }
  return await doc.save();
}
