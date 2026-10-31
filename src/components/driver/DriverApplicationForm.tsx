/**
 * The driver application on /become-a-driver with the new design (owner, 31 October 2026). Four steps,
 * the same fields, checks and database writes as before (useDriverApplication); presented as an
 * onboarding: a step rail (a progress bar on phones), fields grouped with their own messages, the
 * vehicle as a choice of sizes, an upload area per document (choose or drop a file), a review with
 * Edit links, and a sign-in prompt when the visitor is not signed in, keeping what was typed.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../lib/store';
import { VAN_TYPES } from '../../lib/constants';
import { APPLICATION_CITIES, DOCUMENT_ACCEPT, DOCUMENT_TYPES, VEHICLE_TYPES, type DocumentType } from './applicationData';
import { useDriverApplication, type Field } from './useDriverApplication';
import { checkPhoto, type PhotoCheck } from './imageQuality';
import { TermsSummary } from './LandingParts';
import { callFunction, supabase, supabaseFunctionUrl } from '../../lib/supabase';

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24513B]';
const inputBase = 'block w-full h-12 px-4 bg-white text-[15px] text-[#17212E] border placeholder:text-[#8a8f98] outline-none transition focus:border-[#24513B] focus:ring-2 focus:ring-[#24513B]/25';
const btnPrimary = `inline-flex items-center justify-center gap-2 min-h-[52px] px-7 bg-[#24513B] hover:bg-[#1C4130] text-white font-bold transition disabled:opacity-60 ${focus}`;
const btnSecondary = `inline-flex items-center justify-center min-h-[52px] px-6 border border-[#CFC7B5] text-[#17212E] font-semibold hover:bg-[#F3EEE2] transition ${focus}`;

export interface ApplicationProgress { step: number; started: boolean; submitted: boolean }

/* presetCity: a city chosen elsewhere on the page (the cities ribbon); onProgress: for the page's sticky bar. */
export default function DriverApplicationForm({ presetCity, onProgress }: { presetCity?: string | null; onProgress?: (p: ApplicationProgress) => void } = {}) {
  const { t, i18n } = useTranslation();
  const { setPage, setShowAuthModal, setAuthMode } = useApp();
  const app = useDriverApplication({ persist: true });
  const { step, error, fieldErrors } = app;
  const no = i18n.language === 'no';

  const { setCity } = app;
  useEffect(() => { if (presetCity) setCity(presetCity); }, [presetCity, setCity]);
  const started = !!(app.firstName || app.lastName || app.phone || app.city || app.vehicleType || app.vehicleMake || app.licensePlate) || step > 1;
  useEffect(() => { onProgress?.({ step, started, submitted: app.submitted }); }, [onProgress, step, started, app.submitted]);

  /* After sending: the application's real status, checked now and every minute (driver_applications). */
  const [appStatus, setAppStatus] = useState<string | null>(null);
  const userId = app.user?.id;
  useEffect(() => {
    if (!app.submitted || !userId) return;
    let live = true;
    const load = () => void Promise.resolve(supabase.from('driver_applications').select('status').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle())
      .then(({ data }) => { if (live && data) setAppStatus((data as { status: string }).status); }).catch(() => {});
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [app.submitted, userId]);

  /* Plate lookup in the vehicle register (owner, 31 October 2026; vehicle-lookup): offered only once the
   * register is connected. It fills make, model and year; the driver can still change them. */
  const [lookupOn, setLookupOn] = useState(false);
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'filled' | 'notFound' | 'signIn' | 'failed'>('idle');
  useEffect(() => {
    let live = true;
    /* Sent like the public price check (calculatePrice.ts): no key or token needed to ask whether it is on. */
    fetch(supabaseFunctionUrl('vehicle-lookup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ probe: true }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (live && d?.available) setLookupOn(true); }).catch(() => {});
    return () => { live = false; };
  }, []);
  async function lookUpPlate() {
    if (!app.licensePlate.trim()) return;
    if (!app.user) { setLookup('signIn'); return; }
    setLookup('busy');
    try {
      const r = await callFunction('vehicle-lookup', { plate: app.licensePlate });
      const d = await r.json().catch(() => null);
      if (r.status === 401) { setLookup('signIn'); return; }
      if (!r.ok) { setLookup('failed'); return; }
      if (!d?.found) { setLookup('notFound'); return; }
      const v = d.vehicle as { make: string | null; model: string | null; year: number | null };
      if (v.make) app.setVehicleMake(v.make[0] + v.make.slice(1).toLowerCase());
      if (v.model) app.setVehicleModel(v.model);
      if (v.year) app.setVehicleYear(String(v.year));
      setLookup('filled');
    } catch { setLookup('failed'); }
  }

  const steps = [1, 2, 3, 4].map(n => ({
    n,
    title: t(['', 'driverOnboarding.stepPersonal', 'driverOnboarding.stepVehicle', 'driverOnboarding.stepDocuments', 'driverOnboarding.stepReview'][n]),
    desc: t(['', 'driverOnboarding.stepPersonalDesc', 'driverOnboarding.stepVehicleDesc', 'driverOnboarding.stepDocumentsDesc', 'driverOnboarding.stepReviewDesc'][n]),
  }));

  /* After a step changes: bring the form's top into view and put focus on the step heading. */
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    top.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    heading.current?.focus({ preventScroll: true });
  }, [step, app.submitted]);

  /* A new error is announced and takes focus, so keyboard and screen-reader users hear what to fix. */
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) alertRef.current?.focus({ preventScroll: false }); }, [error]);

  const bad = (f: Field) => fieldErrors.includes(f);
  const signIn = () => { setAuthMode('signup'); setShowAuthModal(true); };

  const field = (id: Field, label: string, input: React.ReactNode, hint?: string, msg?: string) => (
    <div>
      <label htmlFor={`da-${id}`} className="block text-sm font-semibold text-[#17212E] mb-1.5">{label}</label>
      {input}
      {bad(id)
        ? <p id={`da-${id}-msg`} className="mt-1.5 text-sm font-semibold text-[#A4271C]">{msg ?? t('driverApplication.fieldRequired')}</p>
        : hint ? <p id={`da-${id}-msg`} className="mt-1.5 text-[13px] text-[#4A5260]">{hint}</p> : null}
    </div>
  );
  const text = (id: Field, value: string, set: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`da-${id}`} value={value} onChange={e => set(e.target.value)} aria-invalid={bad(id) || undefined}
           aria-describedby={`da-${id}-msg`} required
           className={`${inputBase} ${bad(id) ? 'border-[#A4271C]' : 'border-[#CFC7B5]'}`} {...extra} />
  );

  const vehicleName = (id: string, label: string) => t(`driverApplication.vehicles.${id}`, label.replace(/\s*\(.*\)$/, ''));
  const capacity = (label: string) => /\(([^)]+)\)/.exec(label)?.[1] ?? '';
  const docDesc = (key: DocumentType) => t(`driverApplication.docs.${key}.desc`, DOCUMENT_TYPES.find(d => d.key === key)!.desc);
  const mb = (bytes: number) => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(no ? 'nb-NO' : 'en-GB')} KB`
    : `${(bytes / 1024 / 1024).toLocaleString(no ? 'nb-NO' : 'en-GB', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} MB`;

  /* ── Success ─────────────────────────────────────────────────────── */
  if (app.submitted) {
    return (
      <section id="driver-application" aria-labelledby="da-title" className="scroll-mt-28 bg-[#F3EEE2] py-20 md:py-28">
        <div ref={top} className="max-w-[880px] mx-auto px-5 md:px-10 scroll-mt-32">
          <div className="bg-[#FFFEFA] border border-[#E2DACA] p-8 md:p-14">
            <span aria-hidden="true" className="flex items-center justify-center w-14 h-14 bg-[#24513B] text-white mb-7">
              <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </span>
            <h2 id="da-title" ref={heading} tabIndex={-1} className="text-3xl md:text-[40px] font-bold tracking-tight leading-tight mb-3 outline-none">{t('driverOnboarding.successTitle')}</h2>
            <p className="text-[17px] leading-relaxed text-[#4A5260] max-w-[60ch] mb-8">{t('driverOnboarding.successBody')}</p>
            <h3 className="text-xs font-bold !tracking-[.14em] uppercase text-[#7A6436] mb-5">{t('driverApplication.timelineTitle')}</h3>
            {appStatus === 'rejected' ? (
              <p className="mb-10 p-4 border-s-4 border-[#A4271C] bg-[#FBEDEA] text-[#5E1610]">{t('driverApplication.timelineRejected')}</p>
            ) : (
              <ol className="list-none p-0 m-0 mb-10">
                {(['received', 'checking', 'approved', 'plan'] as const).map((k, i) => {
                  const reached = appStatus === 'approved' ? 3 : 1;          // received, then being checked, until approved
                  const done = i < reached || (appStatus === 'approved' && i <= 2), now = i === reached;
                  return (
                    <li key={k} className="relative flex gap-4 pb-6 last:pb-0" aria-current={now ? 'step' : undefined}>
                      {i < 3 && <span aria-hidden="true" className={`absolute start-[13px] top-7 bottom-0 w-[2px] ${done ? 'bg-[#24513B]' : 'bg-[#E2DACA]'}`} />}
                      <span aria-hidden="true" className={`relative z-10 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        done ? 'bg-[#24513B] text-white' : now ? 'bg-[#FFFEFA] border-2 border-[#24513B] text-[#24513B]' : 'bg-[#F3EEE2] border border-[#CFC7B5] text-[#4A5260]'}`}>{done ? '✓' : i + 1}</span>
                      <div>
                        <p className={`m-0 text-[16px] ${now || done ? 'font-bold' : 'text-[#4A5260]'}`}>{t(`driverApplication.timeline.${k}`)}</p>
                        <p className="m-0 text-[14px] text-[#4A5260]">{t(`driverApplication.timeline.${k}Desc`)}</p>
                        {k === 'plan' && appStatus === 'approved' && (
                          <button type="button" onClick={() => setPage('subscriptions')} className={`mt-2 font-bold text-[#24513B] underline ${focus}`}>{t('driverApplication.choosePlan')} →</button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="text-[13px] text-[#4A5260] mb-6">{t('driverApplication.timelineNote')}</p>
            <button type="button" onClick={() => setPage('driver-application-status')} className={btnPrimary}>{t('driverApplication.statusLink')} →</button>
          </div>
        </div>
      </section>
    );
  }

  const current = steps[step - 1];
  return (
    <section id="driver-application" aria-labelledby="da-title" className="scroll-mt-28 bg-[#F3EEE2] py-20 md:py-28">
      <div className="max-w-[1240px] mx-auto px-5 md:px-10 grid lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)] gap-10 lg:gap-16">
        {/* The rail: the steps, what to have ready, and that nothing is sent before the last step. */}
        <div>
          <p className="text-xs font-bold tracking-[.16em] uppercase text-[#7A6436] mb-3">{t('driverApplication.eyebrow')}</p>
          <h2 id="da-title" className="text-[34px] md:text-[44px] font-bold tracking-tight leading-[1.05] mb-4">{t('driverApplication.title')}</h2>
          <p className="text-[16px] leading-relaxed text-[#4A5260] mb-8">{t('driverApplication.lede')}</p>

          <ol className="hidden lg:block list-none p-0 m-0 border-s-2 border-[#E2DACA]">
            {steps.map(s => {
              const done = s.n < step, now = s.n === step;
              const inner = (
                <>
                  <span className={`absolute -start-[17px] top-3 flex items-center justify-center w-8 h-8 text-sm font-bold border-2 ${
                    now ? 'bg-[#24513B] border-[#24513B] text-white' : done ? 'bg-[#FFFEFA] border-[#24513B] text-[#24513B]' : 'bg-[#F3EEE2] border-[#CFC7B5] text-[#4A5260]'}`} aria-hidden="true">
                    {done ? '✓' : s.n}
                  </span>
                  <span className={`block font-bold ${now ? 'text-[#17212E]' : 'text-[#4A5260]'}`}>{s.title}</span>
                  <span className="block text-sm text-[#4A5260]">{s.desc}</span>
                </>
              );
              return (
                <li key={s.n} className="relative ps-8 py-3" aria-current={now ? 'step' : undefined}>
                  {done
                    ? <button type="button" onClick={() => app.goTo(s.n)} className={`text-start w-full hover:underline ${focus}`}
                              aria-label={t('driverApplication.backTo', { step: s.title })}>{inner}</button>
                    : inner}
                  <span className="sr-only">{done ? t('driverApplication.done') : now ? t('driverApplication.current') : ''}</span>
                </li>
              );
            })}
          </ol>

          <div className="hidden lg:block mt-10 pt-6 border-t border-[#E2DACA]">
            <h3 className="text-sm font-bold mb-3">{t('driverApplication.readyTitle')}</h3>
            <ul className="list-none p-0 m-0 space-y-2 text-sm text-[#4A5260]">
              {DOCUMENT_TYPES.map(d => <li key={d.key} className="flex gap-2"><span className="text-[#7A6436]" aria-hidden="true">—</span>{app.docLabel(d.key)}</li>)}
            </ul>
            <p className="text-[13px] text-[#4A5260] mt-4">{t('driverApplication.formats')}</p>
            <p className="text-[13px] text-[#4A5260] mt-2">{t('driverApplication.nothingSent')}</p>
          </div>
        </div>

        {/* The form */}
        <div ref={top} className="scroll-mt-32 min-w-0">
          {app.restored && (
            <div className="mb-5 p-5 border border-[#BCD3C4] bg-[#EEF3EF] text-[15px] text-[#17212E] flex flex-wrap items-center gap-3">
              <span className="flex-1 min-w-[220px]">{t('driverApplication.restored')}</span>
              <button type="button" onClick={app.clearSaved} className={`font-bold underline text-[#24513B] ${focus}`}>{t('driverApplication.startOver')}</button>
            </div>
          )}
          {app.existing && (
            <div className="mb-5 p-5 border border-[#D9C9A0] bg-[#FBF5E6] text-[15px] text-[#17212E]">
              {t('driverApplication.existing', {
                date: app.existing.created_at ? new Date(app.existing.created_at).toLocaleDateString(no ? 'nb-NO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
                status: t(`driverApplication.status.${app.existing.status}`, app.existing.status),
              })}{' '}
              <button type="button" onClick={() => setPage('driver-application-status')} className={`font-bold underline text-[#24513B] ${focus}`}>{t('driverApplication.statusLink')}</button>
            </div>
          )}

          <div className="bg-[#FFFEFA] border border-[#E2DACA]">
            {/* Phones and tablets: a progress bar instead of the rail. */}
            <div className="lg:hidden px-6 pt-6">
              <div className="flex gap-1.5" aria-hidden="true">
                {steps.map(s => <span key={s.n} className={`h-1.5 flex-1 ${s.n <= step ? 'bg-[#24513B]' : 'bg-[#E2DACA]'}`} />)}
              </div>
            </div>
            <div className="p-6 md:p-10">
              <p className="text-xs font-bold tracking-[.14em] uppercase text-[#7A6436] mb-2">{t('driverApplication.stepOf', { n: step, total: 4 })}</p>
              <h3 ref={heading} tabIndex={-1} className="text-2xl md:text-[30px] font-bold tracking-tight leading-tight outline-none">{current.title}</h3>
              <p className="text-[15px] text-[#4A5260] mt-1 mb-7">{
                step === 1 ? t('driverOnboarding.personalSubtitle') : step === 2 ? t('driverOnboarding.vehicleSubtitle')
                  : step === 3 ? t('driverApplication.docsLede') : t('driverApplication.reviewLede')}</p>

              {error && (
                <div ref={alertRef} tabIndex={-1} role="alert" className="mb-7 flex gap-3 p-4 border-s-4 border-[#A4271C] bg-[#FBEDEA] text-[15px] text-[#5E1610] outline-none">
                  <span aria-hidden="true" className="font-bold">!</span>
                  <div>
                    <p className="m-0 font-semibold">{error}</p>
                  </div>
                </div>
              )}

              {step === 1 && (
                <fieldset className="border-0 p-0 m-0 min-w-0">
                  <legend className="sr-only">{t('driverOnboarding.personalTitle')}</legend>
                  <p className="text-[13px] text-[#4A5260] mb-5">{t('driverApplication.allRequired')}</p>
                  <div className="grid sm:grid-cols-2 gap-5">
                    {field('firstName', t('driverOnboarding.firstName'), text('firstName', app.firstName, app.setFirstName, { autoComplete: 'given-name' }))}
                    {field('lastName', t('driverOnboarding.lastName'), text('lastName', app.lastName, app.setLastName, { autoComplete: 'family-name' }))}
                    {field('phone', t('driverOnboarding.phoneLabel'), text('phone', app.phone, app.setPhone, { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '+47 XXX XX XXX' }), t('driverApplication.phoneHint'))}
                    {field('city', t('driverOnboarding.cityLabel'), (
                      <select id="da-city" value={app.city} onChange={e => app.setCity(e.target.value)} required aria-invalid={bad('city') || undefined}
                              aria-describedby="da-city-msg" className={`${inputBase} ${bad('city') ? 'border-[#A4271C]' : 'border-[#CFC7B5]'}`}>
                        <option value="">{t('driverOnboarding.citySelect')}</option>
                        {APPLICATION_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ), t('driverApplication.cityHint'))}
                  </div>
                </fieldset>
              )}

              {step === 2 && (
                <div className="space-y-7">
                  <fieldset className="border-0 p-0 m-0 min-w-0" aria-describedby="da-vehicleType-msg">
                    <legend className="block text-sm font-semibold text-[#17212E] mb-3">{t('driverOnboarding.vehicleType')}</legend>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {VEHICLE_TYPES.map(v => {
                        const on = app.vehicleType === v.id;
                        return (
                          <label key={v.id} className={`relative flex flex-col gap-1 p-5 pt-4 border cursor-pointer transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#24513B] ${
                            on ? 'border-[#24513B] bg-[#EEF3EF] shadow-[inset_0_0_0_1px_#24513B]' : bad('vehicleType') ? 'border-[#A4271C] bg-white' : 'border-[#CFC7B5] bg-white hover:border-[#8F9A8F]'}`}>
                            <input type="radio" name="da-vehicle" value={v.id} checked={on} onChange={() => app.setVehicleType(v.id)} className="sr-only" />
                            {/* The van's photo, the same one the booking flow shows for this size (VAN_TYPES). */}
                            {VAN_TYPES.find(x => x.id === v.id)?.image && (
                              <img src={VAN_TYPES.find(x => x.id === v.id)!.image} alt="" loading="lazy" decoding="async"
                                   className={`w-full aspect-[16/9] object-cover mb-3 transition ${on ? '' : 'saturate-[.85]'}`} />
                            )}
                            <span className="flex items-baseline justify-between gap-3 pe-7">
                              <span className="font-bold text-[16px]">{vehicleName(v.id, v.label)}</span>
                              <span className="text-xl text-[#24513B] whitespace-nowrap" style={{ fontFamily: 'Georgia, serif' }}>{capacity(v.label)}</span>
                            </span>
                            <span className="text-[13px] text-[#4A5260]">{v.examples}</span>
                            <span aria-hidden="true" className={`absolute top-6 end-6 w-5 h-5 border-2 shadow ${on ? 'border-white bg-[#24513B]' : 'border-white bg-white/80'}`} style={{ borderRadius: '50%' }} />
                          </label>
                        );
                      })}
                    </div>
                    {bad('vehicleType') ? <p id="da-vehicleType-msg" className="mt-2 text-sm font-semibold text-[#A4271C]">{t('driverApplication.chooseVehicle')}</p>
                      : <p id="da-vehicleType-msg" className="mt-2 text-[13px] text-[#4A5260]">{t('driverApplication.vehicleHint')}</p>}
                  </fieldset>
                  <div className="grid sm:grid-cols-2 gap-5">
                    {field('vehicleMake', t('driverOnboarding.vehicleMake'), text('vehicleMake', app.vehicleMake, app.setVehicleMake, { placeholder: t('driverApplication.egMake') }))}
                    {field('vehicleModel', t('driverOnboarding.vehicleModel'), text('vehicleModel', app.vehicleModel, app.setVehicleModel, { placeholder: t('driverApplication.egModel') }))}
                    {field('vehicleYear', t('driverOnboarding.vehicleYear'), text('vehicleYear', app.vehicleYear, app.setVehicleYear, { inputMode: 'numeric', maxLength: 4, placeholder: '2020' }),
                      t('driverApplication.yearHint'), app.vehicleYear.trim() ? t('driverApplication.errYear', { max: new Date().getFullYear() + 1 }) : undefined)}
                    {field('licensePlate', t('driverOnboarding.licensePlate'), text('licensePlate', app.licensePlate, app.setLicensePlate, { placeholder: 'AB 12345', autoCapitalize: 'characters' }))}
                  </div>
                  {lookupOn && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-[#DCD4C2] bg-[#FFFEFA] p-4">
                      <button type="button" onClick={lookUpPlate} disabled={!app.licensePlate.trim() || lookup === 'busy'} className={`${btnSecondary} min-h-[44px] disabled:opacity-50`}>
                        {lookup === 'busy' ? t('driverApplication.lookup.busy') : t('driverApplication.lookup.button')}
                      </button>
                      <p aria-live="polite" className="m-0 text-[13px] text-[#4A5260] flex-1 min-w-[200px]">
                        {lookup === 'idle' || lookup === 'busy' ? t('driverApplication.lookup.hint') : t(`driverApplication.lookup.${lookup}`)}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <ul className="list-none p-0 m-0 space-y-4">
                  {DOCUMENT_TYPES.map(d => <DocumentDrop key={d.key} k={d.key} label={app.docLabel(d.key)} desc={docDesc(d.key)} file={app.docFiles[d.key]}
                                                          invalid={bad(d.key)} pick={f => app.pickFile(d.key, f)} mb={mb} />)}
                </ul>
              )}

              {step === 4 && (
                <div className="space-y-5">
                  {([
                    [1, t('driverApplication.sectionPersonal'), [
                      [t('driverApplication.name'), `${app.firstName} ${app.lastName}`],
                      [t('driverApplication.phone'), app.phone],
                      [t('driverApplication.city'), app.city],
                    ]],
                    [2, t('driverApplication.sectionVehicle'), [
                      [t('driverApplication.type'), (() => { const v = VEHICLE_TYPES.find(x => x.id === app.vehicleType); return v ? `${vehicleName(v.id, v.label)} (${capacity(v.label)})` : '—'; })()],
                      [t('driverApplication.makeModel'), `${app.vehicleMake} ${app.vehicleModel}`],
                      [t('driverApplication.year'), app.vehicleYear],
                      [t('driverApplication.plate'), app.licensePlate],
                    ]],
                    [3, t('driverApplication.sectionDocuments'), DOCUMENT_TYPES.map(d => [app.docLabel(d.key), app.docFiles[d.key]?.name ?? '—'])],
                  ] as [number, string, string[][]][]).map(([n, title, rows]) => (
                    <div key={n} className="border border-[#E2DACA]">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-[#E2DACA] bg-[#FBF8F1]">
                        <h4 className="text-xs font-bold !tracking-[.12em] uppercase text-[#4A5260] m-0">{title}</h4>
                        <button type="button" onClick={() => app.goTo(n)} className={`text-sm font-bold text-[#24513B] underline ${focus}`}
                                aria-label={`${t('driverApplication.edit')}: ${title}`}>{t('driverApplication.edit')}</button>
                      </div>
                      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 m-0">
                        {rows.map(([k, v]) => (
                          <div key={k} className="min-w-0">
                            <dt className="text-[13px] text-[#4A5260]">{k}</dt>
                            <dd className="m-0 text-[15px] font-semibold text-[#17212E] break-words">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}

                  <details className="border border-[#E2DACA] bg-[#FFFEFA] p-5 group">
                    <summary className={`cursor-pointer list-none font-bold text-[#17212E] flex items-center gap-2 ${focus}`}>
                      <span aria-hidden="true" className="text-[#24513B] transition group-open:rotate-90">›</span>{t('driverLanding.terms.inForm')}
                    </summary>
                    <div className="mt-4"><TermsSummary compact /></div>
                  </details>
                  <label className={`flex items-start gap-3 p-5 border cursor-pointer ${bad('terms') ? 'border-[#A4271C]' : 'border-[#E2DACA]'} bg-white`}>
                    <input type="checkbox" checked={app.acceptedTerms} onChange={e => app.setAcceptedTerms(e.target.checked)}
                           aria-invalid={bad('terms') || undefined} className="w-5 h-5 mt-0.5 flex-shrink-0 accent-[#24513B]" />
                    <span className="text-[15px] text-[#17212E]">
                      {t('driverApplication.termsBefore')}{' '}
                      <a href="/terms" target="_blank" rel="noopener noreferrer" className={`font-semibold text-[#24513B] underline ${focus}`}>{t('driverApplication.terms')}</a>{' '}
                      {t('driverApplication.and')}{' '}
                      <a href="/driver-terms" target="_blank" rel="noopener noreferrer" className={`font-semibold text-[#24513B] underline ${focus}`}>{t('driverApplication.driverTerms')}</a>
                      {t('driverApplication.termsAfter')}
                    </span>
                  </label>

                  {!app.user && (
                    <div className="p-5 bg-[#FBF5E6] border border-[#D9C9A0] text-[15px]">
                      <p className="m-0 mb-3">{t('driverApplication.signInNote')}</p>
                      <button type="button" onClick={signIn} className={btnSecondary}>{t('driverApplication.signInAction')}</button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3 mt-9 pt-7 border-t border-[#E2DACA]">
                {step > 1 && <button type="button" onClick={app.back} className={btnSecondary}>← {t('driverOnboarding.backBtn')}</button>}
                <span className="hidden sm:block flex-1" />
                {step < 4
                  ? <button type="button" onClick={() => app.next()} className={btnPrimary}>{t('driverOnboarding.continueBtn')} →</button>
                  : <button type="button" onClick={() => void app.submit()} disabled={app.loading} aria-busy={app.loading || undefined} className={btnPrimary}>
                      {app.loading && <span aria-hidden="true" className="w-4 h-4 border-2 border-white/40 border-t-white animate-spin" style={{ borderRadius: '50%' }} />}
                      {app.loading ? t('driverOnboarding.submittingBtn') : t('driverOnboarding.submitBtn')}
                    </button>}
              </div>
            </div>
          </div>
          <p className="lg:hidden text-[13px] text-[#4A5260] mt-4">{t('driverApplication.nothingSent')}</p>
        </div>
      </div>
    </section>
  );
}

/** One document: choose a file or drop one here; shows the chosen file with Replace and Remove. */
function DocumentDrop({ k, label, desc, file, invalid, pick, mb }: {
  k: DocumentType; label: string; desc: string; file: File | null; invalid: boolean; pick: (f: File | null) => boolean; mb: (n: number) => string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = `da-${k}`;
  /* A preview of a chosen photo, and a quick check that it is light and sharp enough to read (a warning only). */
  const [preview, setPreview] = useState<string | null>(null);
  const [quality, setQuality] = useState<PhotoCheck | null>(null);
  useEffect(() => {
    setQuality(null);
    if (!file || !file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    let on = true;
    void checkPhoto(file).then(q => { if (on) setQuality(q); });
    return () => { on = false; URL.revokeObjectURL(url); };
  }, [file]);
  const warn = quality && (quality.dark || quality.blurry) ? t(quality.dark ? 'driverApplication.photoDark' : 'driverApplication.photoBlurry') : null;
  return (
    <li>
      <div
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f); }}
        className={`grid sm:grid-cols-[minmax(0,1fr)_auto] gap-4 items-center p-5 border transition ${
          file ? 'border-[#24513B] bg-[#F4F8F5]' : over ? 'border-[#24513B] border-dashed bg-[#EEF3EF]' : invalid ? 'border-[#A4271C] border-dashed bg-white' : 'border-[#CFC7B5] border-dashed bg-white'}`}>
        <div className="min-w-0 flex gap-4">
          {preview
            ? <img src={preview} alt="" className="flex-shrink-0 w-14 h-14 object-cover border border-[#24513B]" />
            : <span aria-hidden="true" className={`flex-shrink-0 flex items-center justify-center w-10 h-10 border ${file ? 'bg-[#24513B] border-[#24513B] text-white' : 'border-[#CFC7B5] text-[#4A5260]'}`}>
            {file
              ? <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              : <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg>}
          </span>}
          <div className="min-w-0">
            <label htmlFor={id} className="block font-bold text-[16px] text-[#17212E]">{label}</label>
            <p className="m-0 text-[13px] text-[#4A5260]">{desc}</p>
            <p id={`${id}-msg`} className={`m-0 mt-1.5 text-[13px] ${file ? 'text-[#24513B] font-semibold' : invalid ? 'text-[#A4271C] font-semibold' : 'text-[#4A5260]'} truncate`}>
              {file ? `${t('driverApplication.ready')} · ${file.name} · ${mb(file.size)}` : invalid ? t('driverApplication.docMissing') : t('driverApplication.dropHint')}
            </p>
            {warn && <p role="status" className="m-0 mt-1 text-[13px] font-semibold text-[#7A4A00]">⚠ {warn}</p>}
          </div>
        </div>
        <div className="flex gap-2 sm:justify-end">
          <input ref={input} id={id} type="file" accept={DOCUMENT_ACCEPT} aria-describedby={`${id}-msg`} aria-invalid={invalid || undefined}
                 className="sr-only peer" onChange={e => { const f = e.target.files?.[0]; if (f && !pick(f)) e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} tabIndex={-1} aria-hidden="true"
                  className="min-h-[44px] px-4 border border-[#CFC7B5] bg-white font-semibold text-sm hover:bg-[#F3EEE2] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#24513B]">
            {file ? t('driverApplication.replace') : t('driverApplication.choose')}
          </button>
          {/* Phones: take the photo with the camera straight away. */}
          <input ref={camera} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" className="hidden"
                 onChange={e => { const f = e.target.files?.[0]; if (f && !pick(f)) e.target.value = ''; }} />
          <button type="button" onClick={() => camera.current?.click()} aria-label={`${t('driverApplication.takePhoto')}: ${label}`}
                  className={`sm:hidden min-h-[44px] px-4 border border-[#CFC7B5] bg-white font-semibold text-sm hover:bg-[#F3EEE2] ${focus}`}>
            {t('driverApplication.takePhoto')}
          </button>
          {file && (
            <button type="button" onClick={() => { pick(null); if (input.current) input.current.value = ''; }}
                    className={`min-h-[44px] px-4 font-semibold text-sm text-[#4A5260] underline ${focus}`}
                    aria-label={`${t('driverApplication.remove')}: ${label}`}>{t('driverApplication.remove')}</button>
          )}
        </div>
      </div>
    </li>
  );
}
