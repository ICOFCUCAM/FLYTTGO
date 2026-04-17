/**
 * /driver-application-status — shows the driver what state their
 * application is in and what they need to do next. This is the
 * "back door" for any user who's already applied but hasn't yet
 * been approved (or who was rejected and needs to re-submit).
 *
 * State machine:
 *
 *   no row yet       → "You haven't applied" → Apply now CTA
 *   pending          → "Under review" → wait / view submitted docs
 *   approved         → "You're approved" → Choose a subscription plan CTA
 *   rejected         → "Not approved"   → rejection_reason + Re-upload CTA
 *
 * Behind the scenes this just reads the one driver_applications row
 * owned by the current user (RLS: driver_applications_self_select).
 * Document status comes from driver_documents.
 *
 * Routes: added to the Page enum in src/lib/store.tsx as
 * 'driver-application-status' with URL /driver-application-status.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useApp }  from '../lib/store';
import { supabase } from '../lib/supabase';

type ApplicationStatus = 'pending' | 'approved' | 'rejected';

interface DriverApplication {
  id:                string;
  user_id:           string;
  status:            ApplicationStatus | string;
  first_name?:       string | null;
  last_name?:        string | null;
  vehicle_type?:     string | null;
  vehicle_model?:    string | null;
  vehicle_year?:     number | null;
  city?:             string | null;
  rejection_reason?: string | null;
  reviewed_at?:      string | null;
  created_at?:       string | null;
}

interface DriverDocument {
  id:                  string;
  document_type:       string;
  file_url:            string;
  verification_status: string;
}

/** Friendly label for each document_type stored in driver_documents. */
const DOC_LABEL: Record<string, string> = {
  driver_license:       "Driver's License",
  insurance:            'Vehicle Insurance',
  vehicle_registration: 'Vehicle Registration',
  identity_document:    'ID / Passport',
  profile_photo:        'Profile Photo',
};

export default function DriverApplicationStatusPage() {
  const { user }    = useAuth();
  const { setPage } = useApp();
  const { t }       = useTranslation();

  const [loading,     setLoading]     = useState(true);
  const [application, setApplication] = useState<DriverApplication | null>(null);
  const [documents,   setDocuments]   = useState<DriverDocument[]>([]);
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    loadApplication();
  }, [user?.id]);

  async function loadApplication() {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      /* One application per user — maybeSingle is forgiving if the
       * user hasn't applied yet. */
      const { data: app, error: appErr } = await supabase
        .from('driver_applications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (appErr) throw appErr;
      setApplication(app as DriverApplication | null);

      /* Documents live on driver_documents keyed by driver_id (the
       * auth user id). We load all of them so the status page can
       * show which are uploaded + which have been approved. */
      const { data: docs } = await supabase
        .from('driver_documents')
        .select('*')
        .eq('driver_id', user.id);

      setDocuments((docs as DriverDocument[]) ?? []);
    } catch (e: any) {
      setError(e.message || 'Unable to load your application.');
    }
    setLoading(false);
  }

  /* ── Signed-out view ───────────────────────────────────────── */
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t('driverStatus.signInRequired')}</h1>
          <p className="text-sm text-gray-600 mb-6">
            Please sign in to view your driver application status.
          </p>
          <button
            onClick={() => setPage('home')}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition"
          >
            {t('driverStatus.backHome')}
          </button>
        </div>
      </div>
    );
  }

  /* ── Loading skeleton ──────────────────────────────────────── */
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-gray-200 rounded" />
            <div className="h-4 w-64 bg-gray-200 rounded" />
            <div className="h-64 bg-gray-200 rounded-2xl mt-8" />
          </div>
        </div>
      </div>
    );
  }

  /* ── No application ────────────────────────────────────────── */
  if (!application) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center text-3xl">📋</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('driverStatus.noAppTitle')}</h1>
          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            {t('driverStatus.noAppBody')}
          </p>
          <button
            onClick={() => setPage('driver-onboarding')}
            className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition"
          >
            {t('driverStatus.startApp')}
          </button>
        </div>
      </div>
    );
  }

  /* ── Shared layout for all three application states ───────── */
  const submittedAt = application.created_at
    ? new Date(application.created_at).toLocaleDateString('en-GB', {
        day:   '2-digit',
        month: 'short',
        year:  'numeric',
      })
    : '—';

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => setPage('home')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          ← {t('driverStatus.backHome')}
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Status hero — colour depends on state */}
          {application.status === 'pending' && (
            <div className="bg-yellow-50 border-b border-yellow-200 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-yellow-100 flex items-center justify-center text-3xl">⏳</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('driverStatus.pendingTitle')}</h1>
              <p className="text-sm text-gray-600 max-w-md mx-auto">
                Your application is in the queue. Our approvals team usually reviews new drivers within 24 hours.
              </p>
            </div>
          )}

          {application.status === 'approved' && (
            <div className="bg-emerald-50 border-b border-emerald-200 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-emerald-100 flex items-center justify-center text-3xl">✅</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('driverStatus.approvedTitle')}</h1>
              <p className="text-sm text-gray-600 max-w-md mx-auto">
                Welcome to FlyttGo. Pick a subscription plan to start receiving job offers in your area.
              </p>
            </div>
          )}

          {application.status === 'rejected' && (
            <div className="bg-red-50 border-b border-red-200 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center text-3xl">❌</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('driverStatus.rejectedTitle')}</h1>
              <p className="text-sm text-gray-600 max-w-md mx-auto">
                Your application wasn&rsquo;t approved this time. You can update your documents and re-submit below.
              </p>
            </div>
          )}

          <div className="p-8 space-y-6">

            {/* Rejection reason block */}
            {application.status === 'rejected' && application.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-red-900 uppercase tracking-wide mb-1">{t('driverStatus.reviewerReason')}</p>
                <p className="text-sm text-red-800">{application.rejection_reason}</p>
              </div>
            )}

            {/* Application summary */}
            <div>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">{t('driverStatus.appDetails')}</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">{t('driverStatus.submitted')}</p>
                  <p className="font-medium text-gray-900">{submittedAt}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('driverStatus.statusLabel')}</p>
                  <p className="font-medium capitalize text-gray-900">{application.status}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('driverStatus.name')}</p>
                  <p className="font-medium text-gray-900">
                    {(application.first_name ?? '') + ' ' + (application.last_name ?? '')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('driverStatus.city')}</p>
                  <p className="font-medium text-gray-900">{application.city ?? '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">{t('driverStatus.vehicle')}</p>
                  <p className="font-medium text-gray-900">
                    {application.vehicle_type?.replace(/_/g, ' ') ?? '—'}
                    {application.vehicle_model ? ` · ${application.vehicle_model}` : ''}
                    {application.vehicle_year ? ` (${application.vehicle_year})` : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* Document status */}
            <div>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">{t('driverStatus.documents')}</h2>
              {documents.length === 0 ? (
                <p className="text-sm text-gray-500">{t('driverStatus.noDocsUploaded')}</p>
              ) : (
                <ul className="space-y-2">
                  {documents.map(doc => (
                    <li key={doc.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
                      <span className="text-sm font-medium text-gray-800">
                        {DOC_LABEL[doc.document_type] ?? doc.document_type}
                      </span>
                      <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded ${
                        doc.verification_status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                        doc.verification_status === 'rejected' ? 'bg-red-100 text-red-700'         :
                                                                  'bg-yellow-100 text-yellow-700'
                      }`}>
                        {doc.verification_status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Primary action — depends on state */}
            <div className="pt-2 border-t border-gray-100">
              {application.status === 'pending' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
                  <p className="text-sm text-yellow-800">
                    {t('driverStatus.pendingNote')}
                  </p>
                </div>
              )}

              {application.status === 'approved' && (
                <button
                  onClick={() => setPage('subscriptions')}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base transition shadow-sm"
                >
                  {t('driverStatus.choosePlan')}
                </button>
              )}

              {application.status === 'rejected' && (
                <button
                  onClick={() => setPage('driver-onboarding')}
                  className="w-full py-4 bg-[#0B2E59] hover:bg-[#1a4a8a] text-white rounded-xl font-bold text-base transition shadow-sm"
                >
                  {t('driverStatus.reupload')}
                </button>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
