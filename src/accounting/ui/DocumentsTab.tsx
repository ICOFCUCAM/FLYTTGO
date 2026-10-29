/** Documents for the tax office, Brønnøysund and the accountant: each in PDF or Word, SAF-T, and the whole package. */
import { useState } from 'react';
import { buildDoc, DOC_KINDS, type DocKind } from '../documents/build';
import type { Lang } from '../documents/model';
import { t as tr } from '../i18n';
import { accountantPackage, download, loadBooks, saftFor, type PackageOptions } from '../package';
import { renderDocx } from '../render/docx';
import { renderPdf } from '../render/pdf';
import { btn, input, useOffice, useRunner, yearEnd, yearStart } from './office';
import { Card, Message } from './parts';

export interface DocumentsHost {
  company: PackageOptions['company'];
  software: PackageOptions['software'];
}

export default function DocumentsTab({ host }: { host: DocumentsHost }) {
  const { api, ledger, lang: officeLang, t } = useOffice();
  const [year, setYear] = useState(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0));
  const [term, setTerm] = useState(1);
  const [lang, setLang] = useState<Lang>(officeLang);
  const { busy, msg, run } = useRunner();
  const terms = ledger.mva_term === 'yearly' ? [1] : [1, 2, 3, 4, 5, 6];

  const books = () => loadBooks(api, ledger.id, yearStart(year), yearEnd(year));
  const options = async (): Promise<PackageOptions> => ({ lang, software: host.software, company: host.company, mvaCodes: await api.mvaCodes() });

  const one = (kind: DocKind, format: 'pdf' | 'docx') => run(async () => {
    const doc = buildDoc(kind, await books(), lang, term);
    if (format === 'pdf') download(`${doc.name}.pdf`, renderPdf(doc), 'application/pdf');
    else download(`${doc.name}.docx`, renderDocx(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  return (
    <div className="space-y-4">
      <Message msg={msg} />
      <Card title={t('documents')}>
        <div className="flex flex-wrap items-end gap-3 mb-4 text-sm">
          <label className="flex flex-col">{t('year')}<input type="number" className={`${input} w-24`} value={year} onChange={e => setYear(Number(e.target.value))} /></label>
          <label className="flex flex-col">{t('term')} ({t('mvaReturn')})
            <select className={input} value={term} onChange={e => setTerm(Number(e.target.value))}>{terms.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="flex flex-col">{t('language')}
            <select className={input} value={lang} onChange={e => setLang(e.target.value as Lang)}>
              <option value="no">{t('norwegian')}</option><option value="en">{t('english')}</option></select></label>
        </div>
        <div className="divide-y">
          {DOC_KINDS.map(k => (
            <div key={k.kind} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div><div className="font-medium">{tr(lang, k.title)}</div><div className="text-xs text-gray-500">{tr(lang, k.sub)}</div></div>
              <div className="flex gap-2">
                <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => one(k.kind, 'pdf')}>{t('pdf')}</button>
                <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => one(k.kind, 'docx')}>{t('word')}</button>
              </div>
            </div>
          ))}
          <div className="py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div><div className="font-medium">SAF-T Financial 1.30</div><div className="text-xs text-gray-500">Skatteetaten · XML</div></div>
            <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => run(async () => {
              const s = saftFor(await books(), await options());
              download(s.name, s.xml, 'application/xml');
            })}>{t('saft')}</button>
          </div>
        </div>
      </Card>
      <Card title={t('package')}>
        <p className="text-sm text-gray-600 mb-3">{t('packageBody')}</p>
        <button disabled={busy} className={`${btn} bg-gray-900 text-white`} onClick={() => run(async () => {
          const d = await books();
          const p = accountantPackage(d, { ...(await options()), attachments: await api.attachments(d.vouchers.map(v => v.id)) });
          download(p.name, p.bytes, 'application/zip');
        })}>{busy ? t('loading') : `${t('download')} (${year})`}</button>
      </Card>
    </div>
  );
}
