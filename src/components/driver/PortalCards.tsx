/**
 * The driver portal's job card and wallet, moved out of DriverPortal unchanged (owner, 31 October 2026) so
 * /become-a-driver can show the real screens (items 5 and 6) with a sample job instead of a drawing of them.
 * In the portal the buttons act; on the landing page (`preview`) they are shown but do nothing.
 */
import { useTranslation } from 'react-i18next';

/* eslint-disable @typescript-eslint/no-explicit-any -- the portal's rows are untyped, as before the move */
export function safeNumber(value: any): number {
  const n = Number(value ?? 0);
  return isNaN(n) ? 0 : n;
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return 'Not started';
  const diff = Math.floor(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000);
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

/* Commission brackets — keyed on the plan slug derived from
 * driver_subscriptions.plan_id (src/lib/plans.ts). Previously this function compared
 * against display names ('Basic', 'Pro Mini', ...) which meant it
 * silently returned 0 commission whenever the plan came from the
 * DB (which uses lowercase snake_case IDs). Now aligned with the
 * canonical source of truth. */
export function calcCommission(price: number, plan: string) {
  const p = isNaN(price) ? 0 : price;
  if (p <= 500) return { rate: 0, commission: 0, earning: p };
  let rate = 0;
  if (plan === 'basic') {
    if (p <= 1500)      rate = 0.2;
    else if (p <= 5000) rate = 0.15;
    else                rate = 0.1;
  }
  if (plan === 'pro_mini' || plan === 'pro') {
    if (p <= 1500)      rate = 0.1;
    else if (p <= 5000) rate = 0.05;
    else                rate = 0.04;
  }
  if (plan === 'unlimited') rate = 0;
  const commission = p * rate;
  return { rate, commission, earning: p - commission };
}

export interface JobActions {
  accept?: (job: any) => void;
  start?: (id: string) => void;
  finish?: (id: string) => void;
  confirm?: (id: string) => void;
}

export function JobCard({ job, plan, driverId, actions, preview = false }: { job: any; plan: string; driverId?: string; actions?: JobActions; preview?: boolean }) {
  const { t } = useTranslation();
  const price = safeNumber(job.final_price ?? job.original_price ?? job.price_estimate);
  const comm = calcCommission(price, plan);
  const act = (fn?: () => void) => () => { if (!preview) fn?.(); };
  const btn = preview ? ' cursor-default' : '';
  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border">
      <div className="flex justify-between items-start mb-3">
        <div><p className="font-semibold">{job.pickup_address}</p><p className="text-sm text-gray-500">{job.dropoff_address}</p></div>
        <span className={`text-xs px-2 py-1 rounded ${job.status === 'awaiting_driver' ? 'bg-yellow-100 text-yellow-700' : job.status === 'in_transit' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{job.status?.replace(/_/g, ' ')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm text-gray-600 mb-3">
        <p>Estimated: {job.estimated_hours ?? '-'} hrs</p><p>Actual: {job.actual_hours ?? 'Running'}</p>
        <p>Timer: {formatDuration(job.start_time, job.end_time)}</p><p>Move date: {job.move_date ?? '-'}</p>
      </div>
      {/* What the customer asked for (owner, 31 October 2026): helpers and extras on every card; the
        * customer's own instructions only on a job this driver holds (the open pool never carries them). */}
      {(Number(job.helpers) > 0 || (Array.isArray(job.additional_services) && job.additional_services.length > 0)) && (
        <p className="text-sm text-gray-600 mb-3">
          {Number(job.helpers) > 0 && <span>{t('driverPortal.helpersLabel', { count: Number(job.helpers) })}</span>}
          {Number(job.helpers) > 0 && Array.isArray(job.additional_services) && job.additional_services.length > 0 && ' · '}
          {Array.isArray(job.additional_services) && job.additional_services.length > 0 &&
            <span>{t('driverPortal.extrasLabel')}: {job.additional_services.map((e: string) => t(`driverPortal.extra.${e}`, e.replace(/_/g, ' '))).join(', ')}</span>}
        </p>
      )}
      {driverId && job.driver_id === driverId && typeof job.customer_notes === 'string' && job.customer_notes.trim() && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <p className="font-semibold mb-0.5">{t('driverPortal.customerNotes')}</p>
          <p className="whitespace-pre-line break-words">{job.customer_notes}</p>
        </div>
      )}
      <div className="flex justify-between items-center mb-3">
        <div><p className="text-2xl font-bold text-green-600">{safeNumber(comm.earning).toFixed(0)} NOK</p><p className="text-xs text-gray-500">Commission: {safeNumber(comm.rate * 100).toFixed(0)}% ({safeNumber(comm.commission).toFixed(0)} NOK)</p></div>
        <p className="text-sm text-gray-500">Total: {safeNumber(price).toFixed(0)} NOK</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {job.status === 'awaiting_driver' && <button type="button" tabIndex={preview ? -1 : undefined} onClick={act(() => actions?.accept?.(job))} className={`bg-green-600 text-white px-4 py-2 rounded text-sm font-medium${btn}`}>{t('driverPortal.acceptJob')}</button>}
        {job.status === 'driver_assigned' && <button type="button" tabIndex={preview ? -1 : undefined} onClick={act(() => actions?.start?.(job.id))} className={`bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium${btn}`}>{t('driverPortal.startJob')}</button>}
        {job.status === 'in_transit' && <button type="button" tabIndex={preview ? -1 : undefined} onClick={act(() => actions?.finish?.(job.id))} className={`bg-red-600 text-white px-4 py-2 rounded text-sm font-medium${btn}`}>{t('driverPortal.finishJob')}</button>}
        {job.status === 'completed' && !job.driver_confirmation && <button type="button" tabIndex={preview ? -1 : undefined} onClick={act(() => actions?.confirm?.(job.id))} className={`bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium${btn}`}>{t('driverPortal.confirmCompletion')}</button>}
      </div>
    </div>
  );
}

export function WalletPanel({ wallet, transactions, onPayout, preview = false }: { wallet: any; transactions: any[]; onPayout?: () => void; preview?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white p-6 rounded-xl border">
      <h2 className="font-bold text-lg mb-4">{t('driverPortal.walletBalance')}</h2>
      <p className="text-3xl font-bold text-emerald-600 mb-1">{safeNumber(wallet?.balance).toFixed(0)} NOK</p>
      <p className="text-sm text-gray-500 mb-6">{t('driverPortal.availableBalance')}</p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500">Pending</p><p className="text-xl font-bold">{safeNumber(wallet?.pending).toFixed(0)} NOK</p></div>
        <div className="bg-gray-50 rounded-lg p-4"><p className="text-sm text-gray-500">Total Earned</p><p className="text-xl font-bold">{safeNumber(wallet?.total_earned).toFixed(0)} NOK</p></div>
      </div>
      <button type="button" tabIndex={preview ? -1 : undefined} onClick={() => { if (!preview) onPayout?.(); }} className={`bg-blue-600 text-white px-6 py-3 rounded-lg font-medium${preview ? ' cursor-default' : ''}`}>{t('driverPortal.requestPayout')}</button>
      {transactions.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-3">Recent Transactions</h3>
          <div className="space-y-2">
            {transactions.slice(0, 10).map((tx: any) => (
              <div key={tx.id} className="flex justify-between text-sm py-2 border-b">
                <span className="text-gray-600">{tx.description ?? tx.type}</span>
                <span className="font-medium text-emerald-600">+{safeNumber(tx.amount).toFixed(0)} NOK</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
