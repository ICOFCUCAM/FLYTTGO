import React, { useEffect, useState } from 'react';
import { SUBSCRIPTION_PLANS, calculateCommission } from '../lib/constants';
import { useApp } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

/** The application states we care about for gating. 'approved' → plans
 *  are actionable. Anything else → we redirect or warn. */
type ApplicationGate =
  | 'loading'       // waiting for the application row to load
  | 'not-applied'   // no row — user needs to apply first
  | 'pending'       // application under review
  | 'rejected'      // rejected, needs re-upload
  | 'approved';     // ready to subscribe

export default function SubscriptionPlans() {
  const { setShowAuthModal, setAuthMode, setPage } = useApp();
  const { user, profile } = useAuth();
  const [examplePrice, setExamplePrice] = useState(1000);

  /* Gate state — reflects whether this signed-in user is actually
   * allowed to click Subscribe. Admins and signed-out visitors skip
   * the gate entirely (signed-out gets the auth modal, admins get
   * unrestricted browse access so they can preview the plans). */
  const [gate, setGate] = useState<ApplicationGate>('loading');

  useEffect(() => {
    /* Signed-out visitors can browse plans freely — we still want
     * marketing value for them. They hit the gate only when they
     * click Subscribe, which opens the driver-signup auth modal. */
    if (!user) { setGate('loading'); return; }

    /* Admins always see the unrestricted UI (they shouldn't be
     * subscribing anyway, but we don't block them from looking). */
    if (profile?.role === 'admin') { setGate('approved'); return; }

    /* Existing drivers who already have an approved application get
     * straight through — no need to re-check on every mount. Fall
     * through to the query for the definitive source of truth if
     * the role somehow isn't set yet. */
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('driver_applications')
        .select('status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      /* On error (network, RLS denial, etc.) fail open to the
       * not-applied branch so the user sees an actionable CTA
       * instead of an indefinite spinner. The button will route
       * them to /become-a-driver where they can retry. */
      if (error) {
        console.error('[SubscriptionPlans] gate query failed:', error);
        setGate('not-applied');
        return;
      }

      if (!data)                       setGate('not-applied');
      else if (data.status === 'approved') setGate('approved');
      else if (data.status === 'rejected') setGate('rejected');
      else                                  setGate('pending');
    })();

    return () => { cancelled = true; };
  }, [user?.id, profile?.role]);

  /** Single place that decides what happens when a user clicks any
   *  Subscribe button. Branch on the gate state and route them to
   *  the right next step. */
  function handleSubscribeClick() {
    /* Signed-out: open the driver-signup modal (existing behaviour). */
    if (!user) {
      setAuthMode('driver-signup');
      setShowAuthModal(true);
      return;
    }

    switch (gate) {
      case 'not-applied':
        setPage('driver-onboarding');
        return;
      case 'pending':
      case 'rejected':
        setPage('driver-application-status');
        return;
      case 'approved':
        /* Approved drivers: fall through to the existing in-portal
         * subscribe flow. DriverPortal's subscription tab is the
         * real purchase surface (it builds the Stripe / Vipps
         * checkout session with proration etc.). */
        setPage('driver-portal');
        return;
      case 'loading':
      default:
        /* Still waiting on the gate query — do nothing, the button
         * will re-render once the gate resolves. */
        return;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-emerald-700 via-emerald-800 to-gray-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">Driver Subscription Plans</h1>
          <p className="text-lg text-emerald-100 max-w-2xl mx-auto">Choose the plan that maximizes your earnings. Upgrade anytime.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

        {/* Eligibility banner — only rendered for signed-in users
         * who aren't yet approved. Browsers / admins don't see it. */}
        {user && profile?.role !== 'admin' && gate !== 'approved' && gate !== 'loading' && (
          <div className={`rounded-2xl border p-5 mb-8 flex items-start gap-4 ${
            gate === 'not-applied' ? 'bg-blue-50 border-blue-200' :
            gate === 'pending'     ? 'bg-yellow-50 border-yellow-200' :
                                      'bg-red-50 border-red-200'
          }`}>
            <span className="text-2xl flex-shrink-0">
              {gate === 'not-applied' ? '📋' : gate === 'pending' ? '⏳' : '❌'}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`font-bold text-sm ${
                gate === 'not-applied' ? 'text-blue-900' :
                gate === 'pending'     ? 'text-yellow-900' :
                                          'text-red-900'
              }`}>
                {gate === 'not-applied' && 'Apply to become a driver first'}
                {gate === 'pending'     && 'Your driver application is under review'}
                {gate === 'rejected'    && 'Your driver application was not approved'}
              </p>
              <p className={`text-xs mt-1 ${
                gate === 'not-applied' ? 'text-blue-700' :
                gate === 'pending'     ? 'text-yellow-700' :
                                          'text-red-700'
              }`}>
                {gate === 'not-applied' && 'Subscription plans are only available to approved drivers. Start your application — it takes about 5 minutes.'}
                {gate === 'pending'     && 'We usually review applications within 24 hours. You can subscribe as soon as you\u2019re approved.'}
                {gate === 'rejected'    && 'Check the review notes on your application status page and re-upload updated documents.'}
              </p>
              <button
                onClick={handleSubscribeClick}
                className={`mt-3 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  gate === 'not-applied' ? 'bg-blue-600 hover:bg-blue-700 text-white' :
                  gate === 'pending'     ? 'bg-yellow-500 hover:bg-yellow-600 text-white' :
                                            'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {gate === 'not-applied' && 'Start driver application →'}
                {gate === 'pending'     && 'View application status →'}
                {gate === 'rejected'    && 'View review notes →'}
              </button>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-6 mb-16">
          {SUBSCRIPTION_PLANS.map(plan => (
            <div key={plan.id} className={`bg-white rounded-2xl border-2 p-6 relative ${plan.popular ? 'border-emerald-500 shadow-xl shadow-emerald-500/10' : 'border-gray-100'}`}>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs font-bold px-4 py-1 rounded-full">MOST POPULAR</div>
              )}
              <h3 className="text-xl font-bold text-gray-900 mb-1">{plan.name}</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
                <span className="text-gray-500 text-sm"> NOK{plan.period}</span>
              </div>
              <div className="mb-4">
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                  plan.priorityLevel >= 4 ? 'bg-purple-100 text-purple-700' :
                  plan.priorityLevel >= 3 ? 'bg-emerald-100 text-emerald-700' :
                  plan.priorityLevel >= 2 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {plan.dispatchPriority} Priority
                </span>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <svg className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                    <span className="text-gray-600">{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={handleSubscribeClick}
                disabled={gate === 'loading'}
                className={`w-full py-2.5 rounded-xl font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  plan.popular ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                               : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {gate === 'loading' && user ? 'Checking…' :
                 gate === 'not-applied'     ? 'Apply first' :
                 gate === 'pending'         ? 'Under review' :
                 gate === 'rejected'        ? 'Re-submit application' :
                 plan.price === 0           ? 'Get Started Free' :
                                               'Subscribe Now'}
              </button>
            </div>
          ))}
        </div>

        {/* Earnings Comparison */}
        <div className="bg-white rounded-2xl border border-gray-100 p-8 mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Earnings Comparison</h2>
          <p className="text-gray-600 mb-6">See how much you earn per job with each plan</p>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Example Job Value</label>
            <div className="flex items-center gap-4">
              <input type="range" min={300} max={10000} step={100} value={examplePrice} onChange={e => setExamplePrice(Number(e.target.value))} className="flex-1 accent-emerald-600"/>
              <span className="text-xl font-bold text-emerald-600 w-32 text-right">{examplePrice} NOK</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Plan</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Commission Rate</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Commission Amount</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Driver Earnings</th>
                </tr>
              </thead>
              <tbody>
                {SUBSCRIPTION_PLANS.map(plan => {
                  const calc = calculateCommission(examplePrice, plan.id);
                  return (
                    <tr key={plan.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-900">{plan.name}</td>
                      <td className="py-3 px-4">
                        {calc.rate === -1 ? <span className="text-red-500 font-medium">Job Hidden</span> : <span className="text-gray-600">{Number(calc.rate ?? 0)}%</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {calc.rate === -1 ? '—' : `${Number(calc.commission ?? 0).toFixed(0)} NOK`}
                      </td>
                      <td className="py-3 px-4">
                        {calc.rate === -1 ? <span className="text-gray-400">—</span> : <span className="font-bold text-emerald-600">{Number(calc.earning ?? 0).toFixed(0)} NOK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Priority system */}
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Dispatch Priority System</h2>
          <div className="space-y-3">
            {[...SUBSCRIPTION_PLANS].reverse().map(plan => (
              <div key={plan.id} className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-gray-700">{plan.name}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${
                    plan.priorityLevel >= 5 ? 'bg-amber-500' :
                    plan.priorityLevel >= 4 ? 'bg-purple-500' :
                    plan.priorityLevel >= 3 ? 'bg-emerald-500' :
                    plan.priorityLevel >= 2 ? 'bg-blue-500' : 'bg-gray-400'
                  }`} style={{ width: `${plan.priorityLevel * 20}%` }} />
                </div>
                <span className="text-sm font-medium text-gray-500 w-20">{plan.dispatchPriority}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
