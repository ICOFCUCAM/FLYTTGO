import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { supabase, supabaseFunctionUrl } from '../lib/supabase';

function safeNumber(value: any): number {
  const n = Number(value ?? 0);
  return isNaN(n) ? 0 : n;
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return 'Not started';
  const diff = Math.floor(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000);
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

function calcCommission(price: number, plan: string) {
  const p = isNaN(price) ? 0 : price;
  if (p <= 500) return { rate: 0, commission: 0, earning: p };
  let rate = 0;
  if (plan === 'Basic') { if (p <= 1500) rate = 0.2; else if (p <= 5000) rate = 0.15; else rate = 0.1; }
  if (plan === 'Pro Mini' || plan === 'Pro') { if (p <= 1500) rate = 0.1; else if (p <= 5000) rate = 0.05; else rate = 0.04; }
  if (plan === 'Unlimited') rate = 0;
  const commission = p * rate;
  return { rate, commission, earning: p - commission };
}

const VAT_RATE = 0.25;
const PLAN_OPTIONS = [
  { id: 'free',      label: 'Free',      priceNOK: 0,    billing: '',          commission: '0%',  description: 'Jobs up to 500 NOK only · Standard priority',  color: 'border-gray-200',    highlight: false },
  { id: 'basic',     label: 'Basic',     priceNOK: 0,    billing: '',          commission: '20%', description: 'All jobs · Moderate priority · Free plan',       color: 'border-gray-200',    highlight: false },
  { id: 'pro_mini',  label: 'Pro Mini',  priceNOK: 149,  billing: 'NOK/day',   commission: '10%', description: 'High priority · Direct Vipps/Bank payments',    color: 'border-blue-300',    highlight: false },
  { id: 'pro',       label: 'Pro',       priceNOK: 1500, billing: 'NOK/month', commission: '10%', description: 'Very high priority · Premium support',           color: 'border-emerald-400', highlight: true  },
  { id: 'unlimited', label: 'Unlimited', priceNOK: 2449, billing: 'NOK/month', commission: '0%',  description: 'Highest priority · Zero commission · VIP',       color: 'border-purple-400',  highlight: false },
];

function Card({ title, value }: any) {
  return (
    <div className="bg-white p-4 rounded-xl border">
      <p className="text-sm text-gray-500 mb-1">{title}</p>
      <h2 className="text-2xl font-bold">{safeNumber(value).toFixed(0)} NOK</h2>
    </div>
  );
}

function EarningsCalculator({ plan }: { plan: string }) {
  const [jobPrice, setJobPrice] = React.useState(1000);
  const [hours, setHours] = React.useState(2);
  const rates: Record<string, number> = { Free: 0, Basic: 0.2, 'Pro Mini': 0.1, Pro: 0.1, Unlimited: 0 };
  const rate = rates[plan] ?? 0.2;
  const commission = jobPrice * rate;
  const earning = jobPrice - commission;
  const hourlyRate = hours > 0 ? earning / hours : 0;
  return (
    <div className="bg-gray-50 rounded-xl p-5">
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Job Price (NOK)</label>
          <input type="range" min={300} max={10000} step={100} value={jobPrice} onChange={e => setJobPrice(Number(e.target.value))} className="w-full accent-emerald-600"/>
          <div className="text-right text-sm font-semibold text-emerald-600 mt-1">{jobPrice.toLocaleString()} NOK</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Estimated Hours</label>
          <input type="range" min={1} max={12} step={0.5} value={hours} onChange={e => setHours(Number(e.target.value))} className="w-full accent-emerald-600"/>
          <div className="text-right text-sm font-semibold text-gray-700 mt-1">{hours}h</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg p-3 text-center border">
          <div className="text-xs text-gray-500 mb-1">Commission ({(rate * 100).toFixed(0)}%)</div>
          <div className="text-lg font-bold text-red-500">-{commission.toFixed(0)} NOK</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center border">
          <div className="text-xs text-gray-500 mb-1">You Earn</div>
          <div className="text-lg font-bold text-emerald-600">{earning.toFixed(0)} NOK</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center border">
          <div className="text-xs text-gray-500 mb-1">Per Hour</div>
          <div className="text-lg font-bold text-gray-900">{hourlyRate.toFixed(0)} NOK</div>
        </div>
      </div>
    </div>
  );
}

export default function DriverPortal() {
  const { profile, user } = useAuth();
  const { setPage } = useApp();
  const [activeTab, setActiveTab] = useState('overview');
  const [online, setOnline] = useState(false);
  const [driver, setDriver] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [changingPlan, setChangingPlan] = useState<string | null>(null);

  useEffect(() => { if (!profile) return; enforceSubscriptionExpiry(); loadDriver(); }, [profile]);
  useEffect(() => { if (!driver) return; loadWallet(); loadJobs(); loadTransactions(); loadSubscription(); }, [driver]);

  async function enforceSubscriptionExpiry() {
    if (!user) return;
    // driver_subscriptions column is `subscription_status`, not `status`.
    const { data: sub } = await supabase
      .from('driver_subscriptions')
      .select('driver_id, end_date, subscription_status')
      .eq('driver_id', user.id)
      .eq('subscription_status', 'active')
      .maybeSingle();
    if (!sub) return;
    if (sub.end_date && new Date(sub.end_date) < new Date()) {
      await supabase.from('driver_subscriptions').update({ subscription_status: 'cancelled' }).eq('driver_id', user.id);
      await supabase.from('driver_profiles').update({ status: 'suspended' }).eq('user_id', user.id);
    }
  }

  async function loadDriver() {
    const { data } = await supabase.from('driver_profiles').select('*').eq('user_id', profile.id).maybeSingle();
    setLoading(false);
    if (!data) return;
    setDriver(data); setOnline(data.online || false);
  }

  async function loadWallet() {
    const { data } = await supabase.from('driver_wallets').select('*').eq('driver_id', driver.id).maybeSingle();
    setWallet(data || { balance: 0, pending: 0, total_earned: 0 });
  }

  async function loadJobs() {
    // 'pending' is the valid CHECK-constraint value for unassigned bookings.
    const { data } = await supabase.from('bookings').select('*').or(`status.eq.pending,driver_id.eq.${driver.id}`);
    if (!data) return;
    setJobs(driver.subscription_plan === 'Free' ? data.filter((j: any) => safeNumber(j.price_estimate) <= 500) : data);
  }

  async function loadTransactions() {
    const { data } = await supabase.from('driver_wallet_transactions').select('*').eq('driver_id', driver.id).order('created_at', { ascending: false });
    setTransactions(data || []);
  }

  async function loadSubscription() {
    if (!user) return;
    const { data } = await supabase.from('driver_subscriptions').select('*').eq('driver_id', user.id).order('created_at', { ascending: false }).limit(1).single();
    setSubscription(data ?? null);
  }

  function daysLeft(endDate: string | null): number | null {
    if (!endDate) return null;
    return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  }

  function calculateProration(currentSub: any, newPlan: typeof PLAN_OPTIONS[0]) {
    if (currentSub?.plan !== 'pro' || newPlan.id !== 'unlimited') return null;
    if (!currentSub?.start_date) return null;
    const proPlan = PLAN_OPTIONS.find(p => p.id === 'pro')!;
    const today = new Date(); const startDate = new Date(currentSub.start_date);
    const daysInMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
    const daysUsed = Math.max(0, Math.floor((today.getTime() - startDate.getTime()) / 86400000));
    const daysRemaining = Math.max(0, daysInMonth - daysUsed);
    const dailyRate = proPlan.priceNOK / daysInMonth;
    const creditExVat = Math.round(dailyRate * daysRemaining);
    const dueExVat = Math.max(0, newPlan.priceNOK - creditExVat);
    const dueVat = Math.round(dueExVat * VAT_RATE);
    const dueTotal = dueExVat + dueVat;
    return { daysInMonth, daysUsed, daysRemaining, dailyRate: Math.round(dailyRate), creditExVat, unlimitedExVat: newPlan.priceNOK, dueExVat, dueVat, dueTotal, isFullyCovered: dueTotal === 0 };
  }

  async function subscribeToPlan(planId: string, method: 'stripe' | 'vipps' = 'stripe') {
    if (!user || !driver) return;
    setChangingPlan(planId);
    try {
      const plan = PLAN_OPTIONS.find(p => p.id === planId);
      if (!plan) return;
      if (plan.priceNOK === 0) {
        await supabase.rpc('change_driver_subscription', { p_driver_id: user.id, p_new_plan: planId });
        alert(`Switched to ${plan.label} plan.`);
        await loadSubscription(); await loadDriver(); setChangingPlan(null); return;
      }
      const proration = calculateProration(subscription, plan);
      let amountExVat: number, vatAmount: number, totalAmount: number, prorationNote = '';
      if (proration && !proration.isFullyCovered) {
        amountExVat = proration.dueExVat; vatAmount = proration.dueVat; totalAmount = proration.dueTotal;
        prorationNote = `Pro → Unlimited proration: ${proration.daysRemaining}d remaining on Pro → credit ${proration.creditExVat} NOK ex VAT`;
      } else if (proration?.isFullyCovered) {
        await supabase.rpc('change_driver_subscription', { p_driver_id: user.id, p_new_plan: planId });
        await supabase.from('driver_wallet_transactions').insert({ driver_id: driver.id, type: 'subscription_credit', amount: proration.creditExVat, description: `Plan credit — ${proration.daysRemaining} unused Pro days` });
        alert('Upgraded to Unlimited. Your remaining Pro credit fully covered the cost — no charge.'); await loadSubscription(); await loadDriver(); setChangingPlan(null); return;
      } else {
        amountExVat = plan.priceNOK; vatAmount = Math.round(plan.priceNOK * VAT_RATE); totalAmount = amountExVat + vatAmount;
      }
      const payload = { type: 'subscription', planId, planLabel: plan.label, driverId: driver.id, userId: user.id, amount: totalAmount, amountExVat, vatAmount, billing: plan.billing, prorationNote, proration: proration ? { creditApplied: proration.creditExVat, daysRemaining: proration.daysRemaining, daysInMonth: proration.daysInMonth, fromPlan: 'pro', fromPlanFullCost: 1500 } : null, description: proration ? `FlyttGo ${plan.label} (prorated ${proration.daysRemaining}d, incl. 25% MVA)` : `FlyttGo ${plan.label} Subscription (incl. 25% MVA)` };
      if (method === 'vipps') {
        const res = await fetch('https://jomtghowrtegjfddite.databasepad.com/functions/v1/create-vipps-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const vipps = await res.json();
        if (!vipps.redirectUrl) { alert('Unable to start Vipps payment. Please use card instead.'); setChangingPlan(null); return; }
        window.location.href = vipps.redirectUrl;
      } else {
        const res = await fetch('https://jomtghowrtegjfddite.databasepad.com/functions/v1/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const checkout = await res.json();
        if (!checkout.url) { alert('Unable to start payment session. Please try again.'); setChangingPlan(null); return; }
        window.location.href = checkout.url;
      }
    } catch (err) { console.error('subscribeToPlan error:', err); alert('Payment initiation failed. Please try again.'); }
    setChangingPlan(null);
  }

  async function acceptJob(job: any) { await supabase.from('bookings').update({ driver_id: driver.id, status: 'driver_assigned' }).eq('id', job.id); loadJobs(); }
  async function startJob(jobId: string) { await supabase.from('bookings').update({ status: 'in_transit', start_time: new Date().toISOString() }).eq('id', jobId); loadJobs(); }
  async function finishJob(jobId: string) {
    // 'completed' is the only valid end state in the bookings status CHECK
    // constraint. The dual-confirmation flow uses the driver_confirmation /
    // customer_confirmation boolean flags, not a separate status value.
    await supabase.from('bookings').update({ status: 'completed', end_time: new Date().toISOString() }).eq('id', jobId);
    await fetch(supabaseFunctionUrl('process-payment'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recalculate_price', bookingId: jobId }) });
    loadJobs();
  }
  async function confirmCompletion(jobId: string) {
    await supabase.from('bookings').update({ driver_confirmation: true }).eq('id', jobId);
    const { data: booking } = await supabase.from('bookings').select('customer_confirmation').eq('id', jobId).single();
    if (booking?.customer_confirmation === true) {
      await fetch(supabaseFunctionUrl('process-payment'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release_escrow', bookingId: jobId }) });
      alert('Payment released to your wallet!');
    } else { alert('Confirmed! Waiting for customer confirmation.'); }
    loadJobs();
  }
  async function toggleOnline() { const n = !online; setOnline(n); await supabase.from('driver_profiles').update({ online: n }).eq('id', driver.id); }
  async function requestPayout() {
    if (safeNumber(wallet?.balance) < 500) { alert('Minimum payout is 500 NOK'); return; }
    await supabase.from('payout_requests').insert({ driver_id: driver.id, amount: wallet.balance });
    alert('Payout request submitted');
  }

  const subExpiry = subscription ? daysLeft(subscription.end_date) : null;

  if (loading) return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-6xl mx-auto px-4 animate-pulse">
        <div className="h-7 w-48 bg-gray-200 rounded mb-2" />
        <div className="h-4 w-64 bg-gray-200 rounded mb-8" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
              <div className="h-6 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
          <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
          {[0, 1, 2].map(i => (
            <div key={i} className="border-b border-gray-100 last:border-0 py-4">
              <div className="h-4 w-1/2 bg-gray-200 rounded mb-2" />
              <div className="h-3 w-1/3 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  if (!driver) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><p className="text-gray-700 font-semibold mb-2">No driver profile found</p><p className="text-gray-500 text-sm">Please complete your driver application first.</p></div></div>;
  if (driver.status === 'suspended') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-sm border border-red-100">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-2xl">🚫</span></div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Account Suspended</h2>
        <p className="text-gray-600 text-sm mb-4">{subExpiry !== null && subExpiry <= 0 ? 'Your subscription has expired. Renew your plan to reactivate.' : 'Your account has been suspended. Please contact support.'}</p>
        <button onClick={() => setActiveTab('subscription')} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">View Subscription Plans</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white p-4 flex justify-between items-center border-b">
        <div>
          <h1 className="text-xl font-bold">Driver Portal</h1>
          {subscription && (
            <div className={`text-xs mt-0.5 ${subExpiry !== null && subExpiry <= 3 ? 'text-red-500 font-semibold' : subExpiry !== null && subExpiry <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
              {subscription.plan} plan{subExpiry !== null && subExpiry > 0 && ` · expires in ${subExpiry}d`}{subExpiry !== null && subExpiry <= 0 && ' · ⚠️ expired'}
            </div>
          )}
        </div>
        <button onClick={toggleOnline} className={`px-4 py-2 rounded-full font-medium text-sm ${online ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {online ? '● Online' : '○ Offline'}
        </button>
      </div>

      {subExpiry !== null && subExpiry <= 7 && subExpiry > 0 && (
        <div className={`px-6 py-3 text-sm font-medium flex items-center justify-between ${subExpiry <= 3 ? 'bg-red-50 text-red-700 border-b border-red-200' : 'bg-orange-50 text-orange-700 border-b border-orange-200'}`}>
          <span>{subExpiry <= 3 ? `🔴 Subscription expires in ${subExpiry} day${subExpiry !== 1 ? 's' : ''} — renew now` : `🟡 Subscription expires in ${subExpiry} days`}</span>
          <button onClick={() => setActiveTab('subscription')} className="ml-4 underline text-xs font-semibold">Renew</button>
        </div>
      )}

      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex gap-2 mb-6 flex-wrap">
          {['overview', 'jobs', 'earnings', 'wallet', 'subscription'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2 rounded capitalize text-sm font-medium ${activeTab === t ? 'bg-black text-white' : 'bg-gray-200 text-gray-700'}`}>{t}</button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card title="Wallet Balance" value={wallet?.balance}/>
              <Card title="Pending" value={wallet?.pending}/>
              <Card title="Total Earned" value={wallet?.total_earned}/>
            </div>
            {subscription && (
              <div className={`bg-white rounded-xl p-5 border shadow-sm ${subExpiry !== null && subExpiry <= 3 ? 'border-red-200' : subExpiry !== null && subExpiry <= 7 ? 'border-orange-200' : 'border-gray-100'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-500 mb-0.5">Active Plan</div>
                    <div className="text-lg font-bold text-gray-900 capitalize">{subscription.plan}</div>
                    {subscription.end_date && (
                      <div className={`text-xs mt-0.5 ${subExpiry !== null && subExpiry <= 3 ? 'text-red-500 font-semibold' : subExpiry !== null && subExpiry <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
                        {subExpiry !== null && subExpiry > 0 ? `Expires in ${subExpiry} days` : '⚠️ Expired'}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setActiveTab('subscription')} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition">Manage</button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="space-y-4">
            {jobs.length === 0 && <div className="text-center py-12 text-gray-500">No jobs available right now</div>}
            {jobs.map(job => {
              const price = safeNumber(job.final_price ?? job.original_price ?? job.price_estimate);
              const comm = calcCommission(price, driver.subscription_plan ?? 'Basic');
              return (
                <div key={job.id} className="bg-white p-5 rounded-xl shadow-sm border">
                  <div className="flex justify-between items-start mb-3">
                    <div><p className="font-semibold">{job.pickup_address}</p><p className="text-sm text-gray-500">{job.dropoff_address}</p></div>
                    <span className={`text-xs px-2 py-1 rounded ${job.status === 'awaiting_driver' ? 'bg-yellow-100 text-yellow-700' : job.status === 'in_transit' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{job.status?.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 mb-3">
                    <p>Estimated: {job.estimated_hours ?? '-'} hrs</p><p>Actual: {job.actual_hours ?? 'Running'}</p>
                    <p>Timer: {formatDuration(job.start_time, job.end_time)}</p><p>Move date: {job.move_date ?? '-'}</p>
                  </div>
                  <div className="flex justify-between items-center mb-3">
                    <div><p className="text-2xl font-bold text-green-600">{safeNumber(comm.earning).toFixed(0)} NOK</p><p className="text-xs text-gray-500">Commission: {safeNumber(comm.rate * 100).toFixed(0)}% ({safeNumber(comm.commission).toFixed(0)} NOK)</p></div>
                    <p className="text-sm text-gray-500">Total: {safeNumber(price).toFixed(0)} NOK</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {job.status === 'awaiting_driver' && <button onClick={() => acceptJob(job)} className="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium">Accept Job</button>}
                    {job.status === 'driver_assigned' && <button onClick={() => startJob(job.id)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium">Start Job</button>}
                    {job.status === 'in_transit' && <button onClick={() => finishJob(job.id)} className="bg-red-600 text-white px-4 py-2 rounded text-sm font-medium">Finish Job</button>}
                    {job.status === 'completed' && !job.driver_confirmation && <button onClick={() => confirmCompletion(job.id)} className="bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium">Confirm Completion</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'wallet' && (
          <div className="bg-white p-6 rounded-xl border">
            <h2 className="font-bold text-lg mb-4">Wallet Ledger</h2>
            <p className="text-3xl font-bold text-emerald-600 mb-1">{safeNumber(wallet?.balance).toFixed(0)} NOK</p>
            <p className="text-sm text-gray-500 mb-6">Available balance</p>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500">Pending</p><p className="text-xl font-bold">{safeNumber(wallet?.pending).toFixed(0)} NOK</p></div>
              <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500">Total Earned</p><p className="text-xl font-bold">{safeNumber(wallet?.total_earned).toFixed(0)} NOK</p></div>
            </div>
            <button onClick={requestPayout} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium">Request Payout</button>
            {transactions.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold mb-3">Recent Transactions</h3>
                <div className="space-y-2">
                  {transactions.slice(0, 10).map((t: any) => (
                    <div key={t.id} className="flex justify-between text-sm py-2 border-b">
                      <span className="text-gray-600">{t.description ?? t.type}</span>
                      <span className="font-medium text-emerald-600">+{safeNumber(t.amount).toFixed(0)} NOK</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'earnings' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border">
              <h2 className="font-bold text-lg mb-4">Earnings Summary</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card title="Total Earned" value={wallet?.total_earned}/>
                <Card title="This Month" value={0}/>
                <Card title="Pending" value={wallet?.pending}/>
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl border">
              <h2 className="font-bold text-lg mb-1">Earnings Calculator</h2>
              <p className="text-sm text-gray-500 mb-5">Estimate your net earnings for any job before you accept.</p>
              <EarningsCalculator plan={driver?.subscription_plan ?? 'Basic'}/>
            </div>
          </div>
        )}

        {activeTab === 'subscription' && (
          <div className="space-y-6">
            {subscription ? (
              <div className={`bg-white rounded-xl p-6 shadow-sm border ${subExpiry !== null && subExpiry <= 3 ? 'border-red-200' : subExpiry !== null && subExpiry <= 7 ? 'border-orange-200' : 'border-emerald-200'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Current Plan</div>
                    <div className="text-2xl font-bold text-gray-900 capitalize">{subscription.plan}</div>
                    <div className="text-sm text-gray-500 mt-1">Status: <span className={`font-medium ${subscription.status === 'active' ? 'text-emerald-600' : 'text-red-500'}`}>{subscription.status}</span></div>
                    {subscription.end_date && (
                      <div className={`text-sm mt-1 ${subExpiry !== null && subExpiry <= 3 ? 'text-red-500 font-semibold' : subExpiry !== null && subExpiry <= 7 ? 'text-orange-500' : 'text-gray-500'}`}>
                        {subExpiry !== null && subExpiry > 0 ? `Expires in ${subExpiry} day${subExpiry !== 1 ? 's' : ''} — ${new Date(subscription.end_date).toLocaleDateString()}` : `⚠️ Expired ${new Date(subscription.end_date).toLocaleDateString()}`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 rounded-xl p-6 border border-emerald-200 text-center">
                <p className="font-bold text-gray-900 mb-1">No Active Subscription</p>
                <p className="text-sm text-gray-500 mb-4">Subscribe to unlock higher dispatch priority and lower commission rates.</p>
                <button onClick={() => setPage('subscriptions')} className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition">View Subscription Plans →</button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PLAN_OPTIONS.map(plan => {
                const isCurrent = subscription?.plan === plan.id;
                const isLoading = changingPlan === plan.id;
                const vatAmount = Math.round(plan.priceNOK * VAT_RATE);
                const totalNOK = plan.priceNOK + vatAmount;
                const isPaid = plan.priceNOK > 0;
                const pro = calculateProration(subscription, plan);
                return (
                  <div key={plan.id} className={`bg-white border-2 rounded-2xl p-5 flex flex-col transition ${isCurrent ? `${plan.color} shadow-md` : `border-gray-200 hover:shadow-sm`} ${plan.highlight ? 'ring-2 ring-emerald-400 ring-offset-1' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold text-gray-900">{plan.label}</div>
                      {isCurrent && <span className="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full font-semibold">Current</span>}
                      {plan.highlight && !isCurrent && <span className="text-xs bg-emerald-600 text-white px-2.5 py-0.5 rounded-full font-semibold">Popular</span>}
                    </div>
                    {!isPaid && <div className="mb-3"><span className="text-2xl font-bold text-gray-900">Free</span></div>}
                    <div className="text-xs text-gray-500 mb-1">Commission: <strong>{plan.commission}</strong></div>
                    <div className="text-xs text-gray-400 mb-4 flex-1">{plan.description}</div>
                    {isCurrent ? (
                      <div className="w-full py-2.5 rounded-xl text-sm font-semibold text-center bg-gray-100 text-gray-400 cursor-default">✓ Current Plan</div>
                    ) : isLoading ? (
                      <div className="w-full py-2.5 rounded-xl text-sm font-semibold text-center bg-gray-100 text-gray-400 animate-pulse">Processing…</div>
                    ) : isPaid ? (
                      <div className="space-y-2">
                        {!pro && (
                          <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1 mb-1">
                            <div className="flex justify-between text-gray-600"><span>Price (ex VAT)</span><span>{plan.priceNOK.toLocaleString()} NOK</span></div>
                            <div className="flex justify-between text-gray-600"><span>MVA 25%</span><span>{vatAmount.toLocaleString()} NOK</span></div>
                            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1"><span>Total</span><span className="text-emerald-700">{totalNOK.toLocaleString()} NOK</span></div>
                          </div>
                        )}
                        {!pro?.isFullyCovered && (
                          <>
                            <button onClick={() => subscribeToPlan(plan.id, 'stripe')} disabled={!!changingPlan} className="w-full py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50">Pay {(pro ? pro.dueTotal : totalNOK).toLocaleString()} NOK by Card</button>
                            <button onClick={() => subscribeToPlan(plan.id, 'vipps')} disabled={!!changingPlan} className="w-full py-2.5 rounded-xl text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 transition disabled:opacity-50">Pay {(pro ? pro.dueTotal : totalNOK).toLocaleString()} NOK via Vipps</button>
                          </>
                        )}
                        {pro?.isFullyCovered && <button onClick={() => subscribeToPlan(plan.id, 'stripe')} disabled={!!changingPlan} className="w-full py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50">Switch Now — No Charge</button>}
                      </div>
                    ) : (
                      <button onClick={() => subscribeToPlan(plan.id, 'stripe')} disabled={!!changingPlan} className="w-full py-2.5 rounded-xl text-sm font-bold bg-gray-800 text-white hover:bg-gray-900 transition disabled:opacity-50">Switch to {plan.label}</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
