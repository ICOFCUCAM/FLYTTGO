/**
 * Word (.docx, Office Open XML) from a document: A4, the same headings,
 * facts and tables as the PDF, table headers repeated on each page, page
 * numbers in the footer. Opens in Word, LibreOffice, Google Docs and Pages.
 * No dependencies (stored ZIP).
 */
import type { Block, Doc } from '../documents/model';
import { zip } from './zip';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PAGE_W = 11906, MARGIN = 1020, CONTENT = PAGE_W - 2 * MARGIN;   // twips, A4

function run(text: string, o: { bold?: boolean; size?: number; color?: string } = {}): string {
  const props = `${o.bold ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : ''}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function para(content: string, o: { align?: 'left' | 'right'; style?: string; after?: number; keepNext?: boolean } = {}): string {
  const pPr = `${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="${o.after ?? 80}"/>${o.align === 'right' ? '<w:jc w:val="right"/>' : ''}`;
  return `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;
}

function table(b: Extract<Block, { kind: 'table' }>): string {
  const total = b.columns.reduce((n, c) => n + c.width, 0);
  const widths = b.columns.map(c => Math.round((c.width / total) * CONTENT));
  const cell = (text: string, i: number, o: { bold?: boolean; shade?: boolean; topLine?: boolean } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EBEF"/>' : ''}`
    + `${o.topLine ? '<w:tcBorders><w:top w:val="single" w:sz="8" w:color="444444"/></w:tcBorders>' : ''}</w:tcPr>`
    + para(run(text ?? '', { bold: o.bold, size: 17 }), { align: b.columns[i].align, after: 0 }) + '</w:tc>';
  const head = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${b.columns.map((c, i) => cell(c.label, i, { bold: true, shade: true })).join('')}</w:tr>`;
  const rows = b.rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((v, i) => cell(v, i, { bold: b.emphasis?.includes(ri) })).join('')}</w:tr>`).join('');
  const tot = b.total ? `<w:tr>${b.total.map((v, i) => cell(v, i, { bold: true, topLine: true })).join('')}</w:tr>` : '';
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT}" w:type="dxa"/><w:tblBorders>`
    + '<w:insideH w:val="single" w:sz="2" w:color="D5D9DE"/><w:bottom w:val="single" w:sz="4" w:color="A0A6AD"/></w:tblBorders>'
    + `<w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head}${rows}${tot}</w:tbl>` + para('', { after: 120 });
}

function body(doc: Doc): string {
  const out: string[] = [];
  out.push(para(run(doc.company + (doc.orgNumber ? `  ·  ${doc.orgNumber}` : ''), { size: 16, color: '666666' })));
  out.push(para(run(doc.title), { style: 'Title' }));
  if (doc.subtitle) out.push(para(run(doc.subtitle, { size: 22, color: '444444' })));
  out.push(para(run(doc.period, { size: 18, color: '444444' }), { after: 240 }));
  for (const b of doc.blocks) {
    if (b.kind === 'heading') out.push(para(run(b.text), { style: 'Heading1', keepNext: true }));
    else if (b.kind === 'text') {
      for (const line of b.text.split('\n'))
        out.push(para(run(line, { size: b.tone === 'note' ? 16 : 18, color: b.tone === 'note' ? '555555' : undefined, bold: b.tone === 'warning' })));
    } else if (b.kind === 'facts') {
      out.push(table({ kind: 'table', columns: [{ label: '', width: 38 }, { label: '', width: 62 }], rows: b.items.map(([k, v]) => [k, v]) })
        .replace(/<w:tr><w:trPr><w:tblHeader\/><w:cantSplit\/><\/w:trPr>.*?<\/w:tr>/, ''));
    } else if (b.kind === 'table') out.push(table(b));
    else if (b.kind === 'signature') {
      out.push(para('', { after: 480 }));
      out.push(table({ kind: 'table', columns: b.lines.map(() => ({ label: '', width: 1 })), rows: [b.lines.map(() => ''), b.lines] })
        .replace(/<w:tr><w:trPr><w:tblHeader\/><w:cantSplit\/><\/w:trPr>.*?<\/w:tr>/, ''));
    }
  }
  return out.join('');
}

export function renderDocx(doc: Doc): Uint8Array {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${w}><w:body>${body(doc)}`
    + `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${PAGE_W}" w:h="16838"/>`
    + `<w:pgMar w:top="1020" w:right="${MARGIN}" w:bottom="1020" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${w}><w:p><w:pPr><w:jc w:val="left"/></w:pPr>`
    + run(`${doc.footer}  ·  ${doc.generated}  ·  `, { size: 14, color: '777777' })
    + '<w:r><w:rPr><w:sz w:val="14"/><w:color w:val="777777"/></w:rPr><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:r>'
    + run(' / ', { size: 14, color: '777777' })
    + '<w:r><w:rPr><w:sz w:val="14"/><w:color w:val="777777"/></w:rPr><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:r></w:p></w:ftr>';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${w}>`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="18"/><w:lang w:val="nb-NO"/></w:rPr></w:rPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="BBBBBB"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>'
    + '</w:styles>';
  const lang = doc.lang === 'no' ? 'nb-NO' : 'en-GB';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>' },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles.replace('nb-NO', lang) },
    { name: 'word/footer1.xml', data: footer },
    { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${esc(doc.title)}</dc:title><dc:creator>${esc(doc.company)}</dc:creator><dc:language>${lang}</dc:language>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>` },
  ]);
}
