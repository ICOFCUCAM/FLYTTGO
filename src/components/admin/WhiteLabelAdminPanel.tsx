/**
 * Admin → White label (docs/WHITE_LABEL.md):
 *   Requests  companies' plans: approve once every requirement is met (the
 *             database refuses otherwise), decline with a reason, suspend,
 *             end or reactivate.
 *   Plans     the price list: change prices (they become proposals) and
 *             confirm them.
 *   Templates the website template library: check each imported template's
 *             wording (sample prices, reviews, claims), correct its pages,
 *             approve or retire it. Previews are sandboxed, without scripts.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatNok } from '../../lib/invoicing';
import {
  SELLER_LABELS, STATUS_LABELS, decide, loadAllWhiteLabels, loadPlans, loadTemplates, missingFor, reviewTemplate,
  setStatus, updatePlan, updateTemplatePage, type SiteTemplate, type WhiteLabelPlan,
} from '../../lib/whiteLabel';
import { renderTemplatePage } from '../../../supabase/functions/_shared/site-template';

type Row = Awaited<ReturnType<typeof loadAllWhiteLabels>>[number];
const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';

export default function WhiteLabelAdminPanel() {
  const [view, setView] = useState<'requests' | 'plans' | 'templates'>('requests');
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<Record<string, string[]>>({});
  const [plans, setPlans] = useState<WhiteLabelPlan[]>([]);
  const [templates, setTemplates] = useState<SiteTemplate[]>([]);
  const [open, setOpen] = useState<{ id: string; path: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [r, p, t] = await Promise.all([loadAllWhiteLabels(), loadPlans(), loadTemplates()]);
    setRows(r); setPlans(p); setTemplates(t);
    const m: Record<string, string[]> = {};
    for (const x of r.filter(x => x.status === 'requested' || x.requested_plan_code)) m[x.organization_id] = await missingFor(x.organization_id);
    setMissing(m);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn: () => Promise<string | null>, ok: string) {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    await reload();
  }
  const planName = (c: string | null) => plans.find(p => p.code === c)?.name ?? c ?? '';
  const tpl = open ? templates.find(t => t.id === open.id) : null;
  const page = tpl?.pages.find(p => p.path === open?.path);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">White label</h1>
      <p className="text-sm text-gray-500 mb-4">
        Companies' own booking pages. Model A: FlyttGo sells under the company's brand (the default). Model B: the company sells, paid into its own Stripe account.
      </p>
      <div className="flex gap-2 mb-4">
        {(['requests', 'plans', 'templates'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            {v === 'requests' ? `Companies (${rows.length})` : v === 'plans' ? 'Plans and prices' : `Templates (${templates.length})`}
          </button>
        ))}
      </div>
      {msg && <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}

      {view === 'requests' && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Company', 'Plan', 'Status', 'Still missing', ''].map(h => <th key={h} className="text-left p-3 text-xs uppercase text-gray-500">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => {
                const waiting = r.status === 'requested' || !!r.requested_plan_code;
                const m = missing[r.organization_id] ?? [];
                return (
                  <tr key={r.organization_id} className="border-t align-top">
                    <td className="p-3"><div className="font-medium">{r.organizations?.name}</div><div className="text-xs text-gray-400">{r.organizations?.slug} · {r.organizations?.org_number ?? 'no org. nr.'}{r.organizations?.vat_registered ? ' · MVA' : ''}</div></td>
                    <td className="p-3">
                      <div>{planName(r.plan_code)}</div>
                      <div className="text-xs text-gray-500">{SELLER_LABELS[plans.find(p => p.code === r.plan_code)?.seller_model ?? 'flyttgo']}</div>
                      {r.requested_plan_code && <div className="text-xs text-indigo-700">change to {planName(r.requested_plan_code)}</div>}
                    </td>
                    <td className="p-3 text-xs">{STATUS_LABELS[r.status]}{r.decision_reason ? <div className="text-gray-500">{r.decision_reason}</div> : null}
                      {r.custom_domain && <div className="text-gray-500">{r.custom_domain} {r.domain_verified_at ? '✓ verified (connect it in hosting)' : '(not verified)'}</div>}
                      {r.stripe_account_id && <div className="text-gray-500">{r.stripe_account_id} {r.stripe_charges_enabled ? '✓' : '(cannot take payments)'}</div>}
                    </td>
                    <td className="p-3 text-xs text-gray-600">{waiting ? (m.length ? m.join('; ') : <span className="text-emerald-700">nothing</span>) : '—'}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {waiting && <button disabled={busy || m.length > 0} title={m.length ? 'Requirements are missing' : ''} onClick={() => run(() => decide(r.organization_id, true, null), 'Approved.')} className={`${btn} bg-emerald-600 text-white`}>Approve</button>}
                        {waiting && <button disabled={busy} onClick={() => { const why = prompt('Reason for declining (shown to the company):'); if (why?.trim()) run(() => decide(r.organization_id, false, why.trim()), 'Declined.'); }} className={`${btn} bg-gray-100 text-gray-700`}>Decline</button>}
                        {r.status === 'active' && <button disabled={busy} onClick={() => { const why = prompt('Reason for suspending:'); if (why?.trim()) run(() => setStatus(r.organization_id, 'suspended', why.trim()), 'Suspended.'); }} className={`${btn} bg-orange-500 text-white`}>Suspend</button>}
                        {r.status === 'suspended' && <button disabled={busy} onClick={() => { const why = prompt('Reason for reactivating:'); if (why?.trim()) run(() => setStatus(r.organization_id, 'active', why.trim()), 'Reactivated.'); }} className={`${btn} bg-emerald-600 text-white`}>Reactivate</button>}
                        {(r.status === 'active' || r.status === 'suspended') && <button disabled={busy} onClick={() => { const why = prompt('Reason for ending the plan:'); if (why?.trim()) run(() => setStatus(r.organization_id, 'ended', why.trim()), 'Ended.'); }} className={`${btn} bg-gray-200 text-gray-700`}>End</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-400">No company has asked for a plan yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'plans' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Prices exclude MVA. A changed price is a proposal until you confirm it; the public page says so meanwhile.</p>
          {plans.map(p => (
            <PlanEditor key={p.code} plan={p} busy={busy}
              onSave={(v, confirm) => run(() => updatePlan(p.code, { ...v, confirm }), confirm ? 'Prices confirmed.' : 'Saved as proposal.')} />
          ))}
        </div>
      )}

      {view === 'templates' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow max-h-[70vh] overflow-auto">
            {templates.length === 0 && <p className="p-4 text-sm text-gray-500">No templates yet. Import them with scripts/import-site-templates.ts (see docs/WHITE_LABEL.md).</p>}
            {templates.map(t => {
              const prices = t.content_flags.filter(f => f.kind === 'price').length;
              return (
                <button key={t.id} onClick={() => { setOpen({ id: t.id, path: t.pages[0]?.path ?? '/' }); setDraft(t.pages[0]?.html ?? ''); }}
                  className={`w-full text-left px-4 py-3 border-b text-sm ${open?.id === t.id ? 'bg-gray-50' : ''}`}>
                  <div className="flex justify-between"><span className="font-medium">{t.name}</span>
                    <span className={`text-xs ${t.status === 'approved' ? 'text-emerald-700' : t.status === 'retired' ? 'text-gray-400' : 'text-yellow-700'}`}>{t.status}</span></div>
                  <div className="text-xs text-gray-500">{t.id} · {t.style} · {t.industry.slice(0, 3).join(', ')}</div>
                  {t.status !== 'approved' && <div className="text-xs text-gray-500">{t.content_flags.length} things to check{prices ? `, ${prices} prices` : ''}</div>}
                </button>
              );
            })}
          </div>
          <div className="lg:col-span-2">
            {tpl && page ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {tpl.pages.map(p => (
                    <button key={p.path} onClick={() => { setOpen({ id: tpl.id, path: p.path }); setDraft(p.html); }}
                      className={`px-2.5 py-1 rounded text-xs ${p.path === open?.path ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>{p.path}</button>
                  ))}
                </div>
                <iframe title="Template preview" sandbox="" className="w-full h-96 border rounded bg-white"
                  srcDoc={renderTemplatePage(draft, {
                    brand: { name: 'Example Moving AS', phone: '+47 22 33 44 55', email: 'post@example.no', city: 'Oslo' },
                    assets: tpl.assets, pageUrl: () => '#', bookingUrl: '#', sellerNotice: 'Preview: the seller notice appears here.',
                    assetHosts: tpl.assets.map(a => { try { return new URL(a.url).host; } catch { return ''; } }).filter(Boolean),
                  })} />
                <div className="bg-white rounded-lg shadow p-3 text-xs max-h-40 overflow-auto">
                  <div className="font-semibold mb-1">To check on this page</div>
                  {tpl.content_flags.filter(f => f.page === open?.path).map((f, i) => <div key={i}><span className="font-medium">{f.kind}</span>: …{f.sample}…</div>)}
                  {tpl.content_flags.filter(f => f.page === open?.path).length === 0 && <div className="text-gray-500">Nothing flagged at import. Still read the page.</div>}
                </div>
                <textarea value={draft} onChange={e => setDraft(e.target.value)} className="w-full h-56 font-mono text-xs border rounded p-2" spellCheck={false} />
                <p className="text-xs text-gray-500">Placeholders: {'{{brand.name}} {{brand.phone}} {{brand.email}} {{brand.city}} {{brand.tagline}} {{BOOKING_URL}}'}. Scripts, forms, frames and event handlers are refused.</p>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy || draft === page.html} onClick={() => run(() => updateTemplatePage(tpl.id, page.path, draft), 'Page saved; the template needs approval again.')} className={`${btn} bg-[#0B2E59] text-white`}>Save page</button>
                  {tpl.status !== 'approved' && <button disabled={busy} onClick={() => {
                    if (!confirm('Have you removed or corrected every sample price, review, figure and claim on all pages?')) return;
                    const note = prompt('Review note (optional):') ?? '';
                    run(() => reviewTemplate(tpl.id, true, true, note), 'Template approved: companies can choose it.');
                  }} className={`${btn} bg-emerald-600 text-white`}>Approve</button>}
                  {tpl.status !== 'retired' && <button disabled={busy} onClick={() => { const note = prompt('Why retire this template?') ?? ''; run(() => reviewTemplate(tpl.id, false, false, note), 'Template retired.'); }} className={`${btn} bg-gray-100 text-gray-700`}>Retire</button>}
                </div>
              </div>
            ) : <p className="text-sm text-gray-500">Choose a template to review it.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanEditor({ plan, busy, onSave }: {
  plan: WhiteLabelPlan; busy: boolean;
  onSave: (v: { setup_fee: number; monthly_fee: number; platform_fee_pct: number; platform_fee_min: number }, confirm: boolean) => void;
}) {
  const [v, setV] = useState({ setup_fee: plan.setup_fee, monthly_fee: plan.monthly_fee, platform_fee_pct: plan.platform_fee_pct, platform_fee_min: plan.platform_fee_min });
  const field = (k: keyof typeof v, label: string, disabled = false) => (
    <label className="text-xs">{label}
      <input type="number" min={0} step="any" disabled={disabled} value={v[k]} onChange={e => setV({ ...v, [k]: Number(e.target.value) })}
        className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
    </label>
  );
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between mb-2">
        <div><span className="font-semibold">{plan.name}</span> <span className="text-xs text-gray-500">{SELLER_LABELS[plan.seller_model]}{plan.is_default ? ' · default' : ''}</span></div>
        <span className={`text-xs ${plan.price_status === 'confirmed' ? 'text-emerald-700' : 'text-yellow-700'}`}>
          {plan.price_status === 'confirmed' ? `confirmed ${plan.prices_confirmed_at ? new Date(plan.prices_confirmed_at).toLocaleDateString('nb-NO') : ''}` : 'proposed'}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {field('setup_fee', 'Set-up (NOK)')}
        {field('monthly_fee', 'Monthly (NOK)')}
        {field('platform_fee_pct', 'Platform fee %', plan.seller_model !== 'company')}
        {field('platform_fee_min', 'Fee minimum (NOK)', plan.seller_model !== 'company')}
      </div>
      <div className="text-xs text-gray-500 mt-2">Now: {formatNok(plan.monthly_fee)}/month, {formatNok(plan.setup_fee)} set-up{plan.seller_model === 'company' ? `, ${plan.platform_fee_pct} % min. ${formatNok(plan.platform_fee_min)}` : ''}</div>
      <div className="flex gap-2 mt-3">
        <button disabled={busy} onClick={() => onSave(v, false)} className={`${btn} bg-gray-100 text-gray-800`}>Save as proposal</button>
        <button disabled={busy} onClick={() => { if (confirm(`Confirm these prices for ${plan.name}? They apply to new charges from now.`)) onSave(v, true); }} className={`${btn} bg-emerald-600 text-white`}>Confirm prices</button>
      </div>
    </div>
  );
}
