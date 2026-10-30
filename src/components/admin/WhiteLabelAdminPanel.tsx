/**
 * Admin → White label (docs/WHITE_LABEL.md):
 *   Requests  companies' plans: approve once every requirement is met (the
 *             database refuses otherwise), decline with a reason, suspend,
 *             end or reactivate.
 *   Plans     the price list: change prices (they become proposals),
 *             accept them as pilot prices with a note, or confirm them.
 *   Add-ons   modules on a company's plan, and API access (00022): enabled
 *             and ended here, priced by a written quote or an approved
 *             pilot price recorded with the add-on.
 *   Templates the website template library: check each imported template's
 *             wording (sample prices, reviews, claims) and its automated
 *             checks (template-quality.ts: overflow on phones, images, alt
 *             texts, booking links, sample content, unsafe HTML), correct
 *             its pages, approve or retire it. Approval despite a failing
 *             check needs a reason, which is kept. Its images, slot by
 *             slot (template-images.ts): where each comes from, its
 *             licence, review, and replacing one. Previews are sandboxed,
 *             without scripts.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatNok } from '../../lib/invoicing';
import { supabase } from '../../lib/supabase';
import {
  ADDON_LABELS, addonPrice, decide, enableAddon, endAddon, loadAddons, loadAllWhiteLabels, loadPlans, loadTemplate,
  loadTemplateImages, loadTemplateList, missingFor, PRICE_STATUS_LABELS, recordPageChecks, replaceTemplateImage, reviewTemplate,
  reviewTemplateImage, SELLER_LABELS, setPilotPrice, setStatus, STATUS_LABELS, updatePlan, updateTemplatePage, type AddonModule,
  type OrgAddon, type SiteTemplate, type SiteTemplateSummary, type WhiteLabelPlan,
} from '../../lib/whiteLabel';
import { SOURCE_LABELS, type ImageSource, type TemplateImage } from '../../../supabase/functions/_shared/template-images';
import {
  OTHER_CATEGORY, TEMPLATE_CATEGORIES, categoryLabel, contentFlags, renderTemplatePage, templateCategory, type ContentFlag,
} from '../../../supabase/functions/_shared/site-template';
import {
  CHECKS, checkLabel, failingChecks, pageStaticChecks, type CheckResult, type TemplateChecks,
} from '../../../supabase/functions/_shared/template-quality';

type Row = Awaited<ReturnType<typeof loadAllWhiteLabels>>[number];
const btn = 'px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50';

export default function WhiteLabelAdminPanel() {
  const [view, setView] = useState<'requests' | 'plans' | 'addons' | 'templates'>('requests');
  const [addons, setAddons] = useState<OrgAddon[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<Record<string, string[]>>({});
  const [plans, setPlans] = useState<WhiteLabelPlan[]>([]);
  const [templates, setTemplates] = useState<SiteTemplateSummary[]>([]);
  const [full, setFull] = useState<SiteTemplate | null>(null);
  const [cat, setCat] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'imported' | 'approved' | 'retired'>('all');
  const [open, setOpen] = useState<{ id: string; path: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [r, p, t, a, o] = await Promise.all([loadAllWhiteLabels(), loadPlans(), loadTemplateList(true), loadAddons(),
      supabase.from('organizations').select('id, name, slug').eq('status', 'active').order('name')]);
    setRows(r); setPlans(p); setTemplates(t); setAddons(a); setOrgs((o.data ?? []) as { id: string; name: string; slug: string }[]);
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
    if (open) setFull(await loadTemplate(open.id));
  }
  const planName = (c: string | null) => plans.find(p => p.code === c)?.name ?? c ?? '';
  const tpl = open && full?.id === open.id ? full : null;
  const openTemplate = async (id: string) => {
    const t = await loadTemplate(id);
    setFull(t);
    if (t) { setOpen({ id, path: t.pages[0]?.path ?? '/' }); setDraft(t.pages[0]?.html ?? ''); }
  };
  const catOf = (t: SiteTemplateSummary) => templateCategory(t.industry) ?? OTHER_CATEGORY.id;
  const listed = templates.filter(t => (cat === 'all' || catOf(t) === cat) && (statusFilter === 'all' || t.status === statusFilter));
  const page = tpl?.pages.find(p => p.path === open?.path);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">White label</h1>
      <p className="text-sm text-gray-500 mb-4">
        Companies' own booking pages. Model A: FlyttGo sells under the company's brand (the default). Model B: the company sells, paid into its own Stripe account.
      </p>
      <div className="flex gap-2 mb-4">
        {(['requests', 'plans', 'addons', 'templates'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${view === v ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            {v === 'requests' ? `Companies (${rows.length})` : v === 'plans' ? 'Plans and prices'
              : v === 'addons' ? `Add-ons (${addons.filter(a => a.status === 'active').length})` : `Templates (${templates.length})`}
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
          <p className="text-sm text-gray-500">Prices exclude MVA. A changed price is a proposal until you confirm it or accept it as a pilot price; the public page says which.</p>
          {plans.map(p => (
            <PlanEditor key={p.code} plan={p} busy={busy}
              onSave={(v, confirm) => run(() => updatePlan(p.code, { ...v, confirm }), confirm ? 'Prices confirmed.' : 'Saved as proposal.')}
              onPilot={note => run(() => setPilotPrice(p.code, note), 'Accepted as pilot pricing.')} />
          ))}
        </div>
      )}

      {view === 'addons' && (
        <AddonsView addons={addons} orgs={orgs} busy={busy}
          onEnable={(org, m, a) => run(() => enableAddon(org, m, a), 'Add-on enabled.')}
          onEnd={(org, m, reason) => run(() => endAddon(org, m, reason), 'Add-on ended.')} />
      )}

      {view === 'templates' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow max-h-[70vh] overflow-auto">
            <div className="p-3 border-b space-y-2 sticky top-0 bg-white">
              <select value={cat} onChange={e => setCat(e.target.value)} className="w-full border rounded px-2 py-1 text-xs">
                <option value="all">Every category ({templates.length})</option>
                {[...TEMPLATE_CATEGORIES, OTHER_CATEGORY].map(c => {
                  const n = templates.filter(t => catOf(t) === c.id).length;
                  return n ? <option key={c.id} value={c.id}>{c.label} ({n})</option> : null;
                })}
              </select>
              <div className="flex gap-1">
                {(['all', 'imported', 'approved', 'retired'] as const).map(st => (
                  <button key={st} onClick={() => setStatusFilter(st)} className={`${btn} ${statusFilter === st ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>
                    {st === 'all' ? 'All' : st === 'imported' ? 'To review' : st === 'approved' ? 'Offered' : 'Retired'} ({templates.filter(t => st === 'all' || t.status === st).length})
                  </button>
                ))}
              </div>
            </div>
            {templates.length === 0 && <p className="p-4 text-sm text-gray-500">No templates yet. Import them with scripts/import-site-templates.ts (see docs/WHITE_LABEL.md).</p>}
            {listed.map(t => {
              const flags = t.content_flags ?? [];
              const prices = flags.filter(f => f.kind === 'price').length;
              const hidden = flags.filter(f => f.kind === 'hidden').length;
              return (
                <button key={t.id} onClick={() => openTemplate(t.id)}
                  className={`w-full text-left px-4 py-3 border-b text-sm ${open?.id === t.id ? 'bg-gray-50' : ''}`}>
                  <div className="flex justify-between"><span className="font-medium">{t.name}</span>
                    <span className={`text-xs ${t.status === 'approved' ? 'text-emerald-700' : t.status === 'retired' ? 'text-gray-400' : 'text-yellow-700'}`}>{t.status}</span></div>
                  <div className="text-xs text-gray-500">{categoryLabel(catOf(t))} · {t.style} · {t.industry.slice(0, 3).join(', ')}</div>
                  {t.status !== 'approved' && <div className="text-xs text-gray-500">{flags.length} things to check{prices ? `, ${prices} prices` : ''}</div>}
                  {hidden > 0 && <div className="text-xs text-red-700">{hidden} page(s) show less without scripts: fix before approval</div>}
                  {t.status !== 'approved' && (() => {
                    const failing = new Set(failingChecks(t.checks as TemplateChecks).map(r => r.id));
                    const never = !(t.checks as TemplateChecks | undefined)?.results;
                    return never ? <div className="text-xs text-red-700">Not checked automatically yet</div>
                      : failing.size ? <div className="text-xs text-red-700">{failing.size} automated check(s) fail: {[...failing].map(checkLabel).join(', ').toLowerCase()}</div>
                      : <div className="text-xs text-emerald-700">Automated checks pass</div>;
                  })()}
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
                <QualityChecks template={tpl} path={page.path} draft={draft === page.html ? null : draft} />
                <TemplateImages template={tpl} onChanged={text => run(async () => null, text)} />
                <textarea value={draft} onChange={e => setDraft(e.target.value)} className="w-full h-56 font-mono text-xs border rounded p-2" spellCheck={false} />
                <p className="text-xs text-gray-500">Placeholders: {'{{brand.name}} {{brand.logo}} {{brand.phone}} {{brand.email}} {{brand.city}} {{brand.tagline}} {{BOOKING_URL}}'}; the logo slot is an element with class "fg-brand-slot" holding {'{{brand.logo}}<span class="fg-brand-name">{{brand.name}}</span>'}. Scripts, forms, frames and event handlers are refused.</p>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy || draft === page.html} onClick={() => run(async () => {
                    const e = await updateTemplatePage(tpl.id, page.path, draft);
                    if (e) return e;
                    // The checks that need no browser, and the page's flags, from the saved page.
                    const flags = draftFlags(tpl, page.path, draft);
                    return recordPageChecks(tpl.id, page.path, pageStaticChecks({ path: page.path, html: draft }, tpl.assets, flags), flags);
                  }, 'Page saved and checked again (the checks that need a browser wait for a re-check); the template needs approval again.')} className={`${btn} bg-[#0B2E59] text-white`}>Save page</button>
                  {tpl.status !== 'approved' && <button disabled={busy} onClick={() => {
                    if (!confirm('Have you removed or corrected every sample price, review, figure and claim on all pages?')) return;
                    const failing = failingIds(tpl);
                    let reason: string | null = null;
                    if (failing.length) {
                      reason = prompt(`${failing.length} automated check(s) fail or are out of date: ${failing.map(checkLabel).join('; ')}.\n\n`
                        + 'Fix the pages (and run the checks again), or give the reason to approve anyway. The reason is kept with the template.')?.trim() || null;
                      if (!reason) return;
                    }
                    const note = prompt('Review note (optional):') ?? '';
                    run(() => reviewTemplate(tpl.id, true, true, note, reason), reason ? 'Template approved despite failing checks; your reason is kept.' : 'Template approved: companies can choose it.');
                  }} className={`${btn} bg-emerald-600 text-white`}>Approve{failingIds(tpl).length ? ' (checks fail)' : ''}</button>}
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

function AddonsView({ addons, orgs, busy, onEnable, onEnd }: {
  addons: OrgAddon[]; orgs: { id: string; name: string; slug: string }[]; busy: boolean;
  onEnable: (org: string, m: AddonModule, a: { pricing: 'quote' | 'pilot'; setup_fee: number | null; monthly_fee: number | null;
                                              quote_reference: string | null; price_note: string | null }) => void;
  onEnd: (org: string, m: AddonModule, reason: string) => void;
}) {
  const [org, setOrg] = useState('');
  const [mod, setMod] = useState<AddonModule>('api');
  const [pricing, setPricing] = useState<'quote' | 'pilot'>('quote');
  const [quote, setQuote] = useState('');
  const [monthly, setMonthly] = useState('');
  const [setup, setSetup] = useState('');
  const [note, setNote] = useState('');
  const name = (id: string) => orgs.find(o => o.id === id)?.name ?? id.slice(0, 8);
  const num = (v: string) => v.trim() === '' ? null : Number(v.replace(',', '.'));
  const field = 'w-full border border-gray-200 rounded px-2 py-1 text-sm';
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Modules on top of a company's plan (one plan per company), and API access. Each is priced by a written quote, or by a pilot price you
        approve now and record here: never a price worked out from the plans. On a plan where FlyttGo sells, only the API can be added;
        the API is also available to an active company without a plan.
      </p>
      <div className="bg-white rounded-lg shadow p-4 grid md:grid-cols-3 gap-3 text-xs">
        <label>Company<select value={org} onChange={e => setOrg(e.target.value)} className={field}>
          <option value="">Choose…</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>)}</select></label>
        <label>Module<select value={mod} onChange={e => setMod(e.target.value as AddonModule)} className={field}>
          {(Object.keys(ADDON_LABELS) as AddonModule[]).map(m => <option key={m} value={m}>{ADDON_LABELS[m]}</option>)}</select></label>
        <label>Priced by<select value={pricing} onChange={e => setPricing(e.target.value as 'quote' | 'pilot')} className={field}>
          <option value="quote">Written quote</option><option value="pilot">Approved pilot price</option></select></label>
        {pricing === 'quote'
          ? <label className="md:col-span-3">Quote reference<input value={quote} onChange={e => setQuote(e.target.value)} className={field} placeholder="e.g. Q-2026-014" /></label>
          : (<>
            <label>Monthly (NOK excl. MVA)<input value={monthly} onChange={e => setMonthly(e.target.value)} className={field} inputMode="decimal" /></label>
            <label>Set-up (NOK, optional)<input value={setup} onChange={e => setSetup(e.target.value)} className={field} inputMode="decimal" /></label>
            <label>Approval note<input value={note} onChange={e => setNote(e.target.value)} className={field} placeholder="Who approved it, and when" /></label>
          </>)}
        <div className="md:col-span-3">
          <button disabled={busy || !org} className={`${btn} bg-emerald-600 text-white`}
            onClick={() => onEnable(org, mod, pricing === 'quote'
              ? { pricing, setup_fee: null, monthly_fee: null, quote_reference: quote, price_note: null }
              : { pricing, setup_fee: num(setup), monthly_fee: num(monthly), quote_reference: null, price_note: note })}>Enable add-on</button>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>{['Company', 'Module', 'Price', 'Status', ''].map(h => <th key={h} className="text-left p-3 text-xs uppercase text-gray-500">{h}</th>)}</tr></thead>
          <tbody>
            {addons.map(a => (
              <tr key={a.id} className="border-t align-top">
                <td className="p-3">{name(a.organization_id)}</td>
                <td className="p-3">{ADDON_LABELS[a.module] ?? a.module}</td>
                <td className="p-3 text-xs">{addonPrice(a, formatNok)}{a.price_note && <div className="text-gray-400">{a.price_note}</div>}</td>
                <td className="p-3 text-xs">{a.status === 'active' ? `active since ${new Date(a.enabled_at).toLocaleDateString('nb-NO')}`
                  : `ended ${a.ended_at ? new Date(a.ended_at).toLocaleDateString('nb-NO') : ''}${a.end_reason ? `: ${a.end_reason}` : ''}`}</td>
                <td className="p-3">{a.status === 'active' && <button disabled={busy} className={`${btn} bg-gray-200 text-gray-700`}
                  onClick={() => { const why = prompt('Reason for ending the add-on:'); if (why?.trim()) onEnd(a.organization_id, a.module, why.trim()); }}>End</button>}</td>
              </tr>
            ))}
            {addons.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-400">No add-ons yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanEditor({ plan, busy, onSave, onPilot }: {
  plan: WhiteLabelPlan; busy: boolean;
  onSave: (v: { setup_fee: number; monthly_fee: number; platform_fee_pct: number; platform_fee_min: number }, confirm: boolean) => void;
  onPilot: (note: string) => void;
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
        <span className={`text-xs ${plan.price_status === 'confirmed' ? 'text-emerald-700' : plan.price_status === 'pilot' ? 'text-sky-700' : 'text-yellow-700'}`}>
          {plan.price_status === 'proposed' ? 'proposed'
            : `${PRICE_STATUS_LABELS[plan.price_status].toLowerCase()}${plan.prices_confirmed_at ? ` ${new Date(plan.prices_confirmed_at).toLocaleDateString('nb-NO')}` : ''}`}
        </span>
      </div>
      {plan.price_note && <div className="text-xs text-sky-800 mb-2">{plan.price_note}</div>}
      {(plan.setup_fee_includes?.length ?? 0) > 0 && (
        <div className="text-xs text-gray-500 mb-2">Set-up includes: {plan.setup_fee_includes!.join('; ')}</div>
      )}
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
        {plan.price_status !== 'pilot' && (
          <button disabled={busy} onClick={() => { const note = prompt(`Accept the current prices of ${plan.name} as pilot pricing. Note shown beside them:`, 'Pilot pricing: accepted provisionally by FlyttGo for the pilot.'); if (note?.trim()) onPilot(note.trim()); }}
            className={`${btn} bg-sky-600 text-white`}>Accept as pilot pricing</button>
        )}
      </div>
    </div>
  );
}

/** The automated checks that stop approval, as the database counts them ('not_checked' when never checked). */
function failingIds(t: SiteTemplate): string[] {
  const checks = t.checks as TemplateChecks | undefined;
  if (!checks?.results) return ['not_checked'];
  return [...new Set(failingChecks(checks).map(r => r.id))];
}

/** A draft page's content flags, found as the importer finds them (the sample names it recorded). */
function draftFlags(t: SiteTemplate, path: string, html: string): ContentFlag[] {
  const names = (t.checks as TemplateChecks | undefined)?.sample_names ?? [t.name];
  return contentFlags(html, path, names[0], names.slice(1));
}

const STATUS_STYLE: Record<CheckResult['status'], string> = {
  pass: 'bg-emerald-50 text-emerald-800 border-emerald-200', fail: 'bg-red-50 text-red-800 border-red-200',
  stale: 'bg-amber-50 text-amber-900 border-amber-200', not_run: 'bg-gray-50 text-gray-600 border-gray-200',
};
const STATUS_WORD: Record<CheckResult['status'], string> = { pass: 'pass', fail: 'fail', stale: 'out of date', not_run: 'not run' };

/**
 * The template's automated checks (template-quality.ts), by check and page,
 * with what failed; the checks that need no browser run live on an unsaved
 * draft; and the approvals given despite failing checks.
 */
function QualityChecks({ template, path, draft }: { template: SiteTemplate; path: string; draft: string | null }) {
  const checks = template.checks as TemplateChecks | undefined;
  const results = checks?.results ?? [];
  const pages = template.pages.map(p => p.path);
  const live = draft === null ? [] : pageStaticChecks({ path, html: draft }, template.assets, draftFlags(template, path, draft)).filter(r => r.status === 'fail');
  const failing = failingChecks(checks);
  return (
    <div className="bg-white rounded-lg shadow p-3 text-xs space-y-2" aria-label="Automated checks">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">Automated checks</span>
        {checks?.ran_at ? <span className="text-gray-500">run {new Date(checks.ran_at).toLocaleString('nb-NO')}</span>
          : <span className="text-red-700">never run: import the template again or run the importer with --recheck</span>}
        {results.length > 0 && <span className={failing.length ? 'text-red-700 font-semibold' : 'text-emerald-700 font-semibold'}>
          {failing.length ? `${new Set(failing.map(r => r.id)).size} check(s) stop approval` : 'nothing stops approval'}</span>}
      </div>
      {results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="text-left text-gray-500"><th className="py-1 pr-2 font-medium">Check</th>
              {pages.map(p => <th key={p} className={`py-1 px-1 font-medium ${p === path ? 'text-gray-900' : ''}`}>{p}</th>)}</tr></thead>
            <tbody>{CHECKS.map(c => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-1 pr-2">{c.label}{c.overridable ? '' : ' (never overridden)'}</td>
                {pages.map(p => {
                  const r = results.find(x => x.id === c.id && x.page === p);
                  return <td key={p} className="py-1 px-1">{r
                    ? <span title={r.detail} className={`inline-block rounded border px-1.5 py-0.5 ${STATUS_STYLE[r.status]}`}>{STATUS_WORD[r.status]}</span>
                    : <span className="text-gray-400">–</span>}</td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {failing.filter(r => r.page === path).map(r => (
        <div key={r.id} className="border-l-2 border-red-300 pl-2">
          <div><span className="font-medium">{checkLabel(r.id)}</span>: {r.detail}</div>
          {r.items?.slice(0, 6).map((it, i) => <div key={i} className="text-gray-600 truncate">{it}</div>)}
        </div>
      ))}
      {failing.some(r => r.status === 'stale') && (
        <p className="text-amber-900">Out of date: the page changed after the browser checked it. Run <code>node scripts/import-site-templates.ts --recheck --ids {template.id}</code> (needs the owner's go-ahead: it writes to the database), or approve with a reason.</p>
      )}
      {live.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2">
          <div className="font-medium text-amber-900">This draft (not saved yet)</div>
          {live.map(r => <div key={r.id}>{checkLabel(r.id)}: {r.detail} {r.items?.slice(0, 3).join('; ')}</div>)}
        </div>
      )}
      {(template.check_overrides ?? []).length > 0 && (
        <div className="border-t pt-2">
          <div className="font-medium mb-1">Approved despite failing checks</div>
          {(template.check_overrides ?? []).map((o, i) => (
            <div key={i} className="text-gray-700">{new Date(o.at).toLocaleString('nb-NO')}: {o.checks.map(checkLabel).join(', ').toLowerCase()}. Reason: “{o.reason}”</div>
          ))}
        </div>
      )}
    </div>
  );
}

const REVIEW_STYLE: Record<TemplateImage['review_status'], string> = {
  approved: 'text-emerald-700', rejected: 'text-red-700', unreviewed: 'text-amber-800',
};

/**
 * The template's images slot by slot (site_template_images, 00021): the
 * picture, its slot and what it is meant to show, where it comes from, its
 * licence or how it was made, its size and review. An administrator
 * approves or rejects each, or replaces it with an uploaded image (checked
 * by its bytes) saying where it comes from.
 */
function TemplateImages({ template, onChanged }: { template: SiteTemplate; onChanged: (message: string) => void }) {
  const [images, setImages] = useState<Awaited<ReturnType<typeof loadTemplateImages>>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ file: File | null; source: Exclude<ImageSource, 'architect-ai'>; licence: string; model: string; prompt: string; use: string }>(
    { file: null, source: 'licensed', licence: '', model: '', prompt: '', use: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => { loadTemplateImages(template.id).then(setImages).catch(() => setImages([])); }, [template.id]);
  useEffect(() => { reload(); }, [reload]);

  const act = async (fn: () => Promise<string | null>, done: string) => {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    if (e) { setMsg(e); return; }
    setEditing(null); reload(); onChanged(done);
  };
  const shared = images.filter(i => i.source === 'architect-ai').length;

  return (
    <div className="bg-white rounded-lg shadow p-3 text-xs space-y-2" aria-label="Images">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">Images</span>
        <span className="text-gray-500">{images.length} slot(s){shared ? `, ${shared} as imported from Architect-AI (licence to be confirmed)` : ''}</span>
      </div>
      {images.length === 0 && <p className="text-gray-500">No image slots recorded: import the template again to record them.</p>}
      {msg && <p className="text-red-700">{msg}</p>}
      <div className="grid sm:grid-cols-2 gap-2">
        {images.map(i => (
          <div key={i.asset_key} className="border border-gray-100 rounded p-2 flex gap-2">
            <img src={i.url} alt={i.intended_use ?? ''} loading="lazy" className="w-24 h-16 object-cover rounded bg-gray-100 shrink-0" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex justify-between gap-2"><span className="font-medium truncate">{i.slot} · {i.asset_key}</span>
                <span className={REVIEW_STYLE[i.review_status]}>{i.review_status}</span></div>
              <div className="text-gray-600 truncate" title={i.intended_use ?? ''}>{i.intended_use ?? 'No description on the page'}</div>
              <div className="text-gray-600">{SOURCE_LABELS[i.source]}{i.licence ? ` · ${i.licence}` : i.source === 'ai-generated' ? ` · ${i.generation?.model ?? ''}` : ' · licence unknown'}</div>
              <div className="text-gray-500">{i.width && i.height ? `${i.width} × ${i.height} px` : 'size unknown'}{i.sha256 ? ` · ${i.sha256.slice(0, 10)}…` : ''}</div>
              <div className="flex flex-wrap gap-1 pt-1">
                <button disabled={busy} className={`${btn} bg-emerald-50 text-emerald-800`} onClick={() => {
                  const licence = !i.licence && i.source !== 'ai-generated' && i.source !== 'own'
                    ? prompt('Licence of this image (name and reference), as confirmed:')?.trim() : null;
                  if (licence === '') return;
                  act(() => reviewTemplateImage(template.id, i.asset_key, 'approved', licence), 'Image approved.');
                }}>Approve</button>
                <button disabled={busy} className={`${btn} bg-red-50 text-red-800`} onClick={() => act(() => reviewTemplateImage(template.id, i.asset_key, 'rejected'), 'Image rejected.')}>Reject</button>
                <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => { setEditing(editing === i.asset_key ? null : i.asset_key); setForm({ ...form, file: null, use: i.intended_use ?? '' }); }}>Replace…</button>
              </div>
              {editing === i.asset_key && (
                <div className="mt-1 space-y-1 border-t pt-1">
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
                  <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value as typeof form.source })} className="w-full border rounded px-1 py-0.5">
                    <option value="licensed">{SOURCE_LABELS.licensed}</option>
                    <option value="ai-generated">{SOURCE_LABELS['ai-generated']}</option>
                    <option value="own">{SOURCE_LABELS.own}</option>
                  </select>
                  {form.source === 'licensed' && <input value={form.licence} onChange={e => setForm({ ...form, licence: e.target.value })} placeholder="Licence (name and reference)" className="w-full border rounded px-1 py-0.5" />}
                  {form.source === 'ai-generated' && <>
                    <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model" className="w-full border rounded px-1 py-0.5" />
                    <input value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="Prompt (optional)" className="w-full border rounded px-1 py-0.5" />
                  </>}
                  <input value={form.use} onChange={e => setForm({ ...form, use: e.target.value })} placeholder="What it shows" className="w-full border rounded px-1 py-0.5" />
                  <button disabled={busy || !form.file} className={`${btn} bg-[#0B2E59] text-white`} onClick={() => form.file && act(() =>
                    replaceTemplateImage(template.id, i.asset_key, form.file!, { source: form.source, licence: form.licence, model: form.model, prompt: form.prompt, intended_use: form.use }), 'Image replaced; the template needs approval again.')}>
                    Upload and replace</button>
                  <p className="text-gray-500">PNG, JPEG or WebP, at most 5 MB, checked by its bytes. The template goes back to review.</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
