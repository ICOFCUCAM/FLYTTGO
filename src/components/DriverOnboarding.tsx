import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { supabase } from '../lib/supabase';

const VEHICLE_TYPES = [
  { id: 'small_van', label: 'Small Van (3–4 m³)', examples: 'Ford Transit Connect, VW Caddy' },
  { id: 'medium_van', label: 'Medium Van (6–9 m³)', examples: 'Ford Transit Custom, Mercedes Vito' },
  { id: 'large_van', label: 'Large Van (11–15 m³)', examples: 'Mercedes Sprinter, Ford Transit LWB' },
  { id: 'luton_van', label: 'Luton Van (18–20 m³)', examples: 'Luton Box Truck with Tail Lift' },
];

/* ── Documents collected in step 3 ──────────────────────────────────
 * Each key is the canonical document_type value we write to
 * driver_documents. The admin dashboard approval flow already reads
 * those exact strings (see AdminDashboard REQUIRED_DOCS), so we stay
 * aligned by not renaming them. The fourth type (identity_document)
 * is new — admin doesn't currently require it, but uploading it
 * costs nothing and matches the spec. */
const DOCUMENT_TYPES = [
  { key: 'driver_license',       label: "Driver's License",   desc: 'Valid Norwegian or EU/EEA driver\u2019s license (front + back)' },
  { key: 'insurance',             label: 'Vehicle Insurance',  desc: 'Comprehensive insurance covering commercial use' },
  { key: 'vehicle_registration', label: 'Vehicle Registration', desc: 'Current vehicle registration document' },
  { key: 'identity_document',    label: 'ID / Passport',      desc: 'Government-issued photo ID or passport' },
] as const;
type DocumentType = typeof DOCUMENT_TYPES[number]['key'];

/** Sanitise a filename segment. We don't trust the uploader's filename
 *  so we rebuild the storage path from {user_id}/{document_type}.{ext}
 *  and only preserve the extension from the original name. */
function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'bin';
}

export default function DriverOnboarding() {
  const { user, profile } = useAuth();
  const { setPage } = useApp();
  const { t } = useTranslation();

  /* Steps list — built inside the component so titles translate
   * when the language changes. */
  const STEPS = [
    { id: 1, title: t('driverOnboarding.stepPersonal'),   desc: t('driverOnboarding.stepPersonalDesc') },
    { id: 2, title: t('driverOnboarding.stepVehicle'),    desc: t('driverOnboarding.stepVehicleDesc') },
    { id: 3, title: t('driverOnboarding.stepDocuments'),  desc: t('driverOnboarding.stepDocumentsDesc') },
    { id: 4, title: t('driverOnboarding.stepReview'),     desc: t('driverOnboarding.stepReviewDesc') },
  ];

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — Personal
  const [firstName, setFirstName] = useState(profile?.first_name || '');
  const [lastName, setLastName] = useState(profile?.last_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [city, setCity] = useState('');

  // Step 2 — Vehicle
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [licensePlate, setLicensePlate] = useState('');

  // Step 3 — Documents (real file uploads, one per required type)
  const [docFiles, setDocFiles] = useState<Record<DocumentType, File | null>>({
    driver_license:       null,
    insurance:            null,
    vehicle_registration: null,
    identity_document:    null,
  });

  // Step 4 — Terms
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  function setDocFile(key: DocumentType, file: File | null) {
    setDocFiles(prev => ({ ...prev, [key]: file }));
  }

  /* Upload every selected file to the driver-documents bucket under
   * `${user.id}/${document_type}.${ext}`. Using the user id as the
   * first folder segment matches the storage RLS policy installed
   * in docs/fix-driver-onboarding-pipeline.sql (only the owning
   * driver can write into their own folder). Returns a list of rows
   * to insert into driver_documents afterwards. */
  async function uploadDocuments(): Promise<{
    document_type: DocumentType;
    file_url: string;
  }[]> {
    if (!user) throw new Error('Not signed in');

    const rows: { document_type: DocumentType; file_url: string }[] = [];

    for (const doc of DOCUMENT_TYPES) {
      const file = docFiles[doc.key];
      if (!file) continue;

      const path = `${user.id}/${doc.key}.${extensionOf(file.name)}`;

      const { error: uploadError } = await supabase
        .storage
        .from('driver-documents')
        .upload(path, file, {
          upsert:       true,   // re-submission overwrites the previous file
          cacheControl: '3600',
        });

      if (uploadError) throw uploadError;

      /* We store the raw storage path in driver_documents.file_url
       * rather than a signed / public URL, because the admin panel
       * already resolves it via supabase.storage.from(bucket)
       * .getPublicUrl(path) when rendering the preview. Keeping
       * the path keeps the row agnostic to bucket visibility
       * settings. */
      rows.push({ document_type: doc.key, file_url: path });
    }

    return rows;
  }

  async function handleSubmit() {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      /* 1. Upload files to storage. Do this BEFORE inserting the
       *    driver_applications row so a failed upload doesn't leave
       *    an application row pointing at files that don't exist. */
      const uploadedDocs = await uploadDocuments();

      /* 2. Insert the application row. driver_applications columns:
       *    user_id, email, first_name, last_name, phone, address,
       *    license_number, license_expiry, years_experience,
       *    vehicle_type, vehicle_model, vehicle_year (int),
       *    vehicle_registration, cargo_capacity, city, zone, status.
       *    UI collects make + model separately; we concatenate them
       *    into the single `vehicle_model` column. */
      const { error: appError } = await supabase
        .from('driver_applications')
        .insert({
          user_id: user.id,
          email: user.email ?? null,
          first_name: firstName,
          last_name: lastName,
          phone,
          city,
          vehicle_type: vehicleType,
          vehicle_model: `${vehicleMake} ${vehicleModel}`.trim(),
          vehicle_year: vehicleYear ? parseInt(vehicleYear, 10) : null,
          vehicle_registration: licensePlate,
          status: 'pending',
        });

      if (appError) throw appError;

      /* 3. Insert one driver_documents row per uploaded file so
       *    the admin dashboard can review them. driver_documents is
       *    keyed on driver_id = auth user id (see AdminDashboard),
       *    not application_id, so we write user.id there. */
      if (uploadedDocs.length > 0) {
        const { error: docsError } = await supabase
          .from('driver_documents')
          .insert(
            uploadedDocs.map(d => ({
              driver_id:           user.id,
              document_type:       d.document_type,
              file_url:            d.file_url,
              verification_status: 'pending',
            }))
          );

        if (docsError) throw docsError;
      }

      /* 4. profiles.role is NOT updated from the client anymore —
       *    the sync_profile_role_on_driver_approval trigger on
       *    driver_profiles now handles it automatically the moment
       *    the admin approves the application. No more best-effort
       *    client-side role update that silently fails under RLS. */

      setSubmitted(true);
    } catch (e: any) {
      setError(e.message || 'Submission failed. Please try again.');
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center shadow-sm border">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">{t('driverOnboarding.successTitle')}</h2>
          <p className="text-gray-600 mb-6">
            {t('driverOnboarding.successBody')}
          </p>
          <div className="bg-emerald-50 rounded-xl p-4 mb-6 text-sm text-emerald-700">
            <p className="font-semibold mb-1">{t('driverOnboarding.successWhatNext')}</p>
            <ul className="space-y-1 text-left list-disc pl-4">
              <li>{t('driverOnboarding.successStep1')}</li>
              <li>{t('driverOnboarding.successStep2')}</li>
              <li>{t('driverOnboarding.successStep3')}</li>
              <li>{t('driverOnboarding.successStep4')}</li>
            </ul>
          </div>
          <button
            onClick={() => setPage('driver-application-status')}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
          >
            Check application status →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1A365D] to-[#2D4A7A] text-white py-10">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h1 className="text-3xl font-bold mb-2">{t('driverOnboarding.heroTitle')}</h1>
          <p className="text-white/70">{t('driverOnboarding.heroSubtitle')}</p>
        </div>
      </div>

      {/* Progress */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-10">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.id}>
              {i > 0 && (
                <div className={`flex-1 h-0.5 mx-2 ${step > s.id - 1 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
              )}
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  step === s.id ? 'bg-emerald-600 text-white shadow-lg' :
                  step > s.id ? 'bg-emerald-100 text-emerald-600' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {step > s.id ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : s.id}
                </div>
                <div className="text-xs font-medium text-gray-600 mt-1 hidden sm:block">{s.title}</div>
              </div>
            </React.Fragment>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>
          )}

          {/* STEP 1 — Personal Info */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">{t('driverOnboarding.personalTitle')}</h2>
              <p className="text-gray-500 text-sm mb-6">{t('driverOnboarding.personalSubtitle')}</p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.firstName')}</label>
                    <input value={firstName} onChange={e => setFirstName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.lastName')}</label>
                    <input value={lastName} onChange={e => setLastName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.phoneLabel')}</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+47 XXX XX XXX"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.cityLabel')}</label>
                  <select value={city} onChange={e => setCity(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm bg-white">
                    <option value="">{t('driverOnboarding.citySelect')}</option>
                    {['Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Drammen', 'Fredrikstad', 'Kristiansand', 'Tromsø'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={() => {
                  if (firstName && lastName && phone && city) {
                    setError('');
                    setStep(2);
                  } else {
                    setError(t('driverOnboarding.errFillAll'));
                  }
                }}
                className="w-full mt-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
              >
                {t('driverOnboarding.continueBtn')}
              </button>
            </div>
          )}

          {/* STEP 2 — Vehicle */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">{t('driverOnboarding.vehicleTitle')}</h2>
              <p className="text-gray-500 text-sm mb-6">{t('driverOnboarding.vehicleSubtitle')}</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('driverOnboarding.vehicleType')}</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {VEHICLE_TYPES.map(v => (
                      <button key={v.id} onClick={() => setVehicleType(v.id)}
                        className={`text-left p-4 rounded-xl border-2 transition ${
                          vehicleType === v.id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <div className="font-medium text-sm text-gray-900">{v.label}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{v.examples}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.vehicleMake')}</label>
                    <input value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} placeholder="e.g. Mercedes"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.vehicleModel')}</label>
                    <input value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} placeholder="e.g. Sprinter"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.vehicleYear')}</label>
                    <input value={vehicleYear} onChange={e => setVehicleYear(e.target.value)} placeholder="e.g. 2020"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('driverOnboarding.licensePlate')}</label>
                    <input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="e.g. AB 12345"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(1)} className="px-6 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 transition">{t('driverOnboarding.backBtn')}</button>
                <button
                  onClick={() => {
                    if (vehicleType && vehicleMake && vehicleModel && vehicleYear && licensePlate) {
                      setError('');
                      setStep(3);
                    } else {
                      setError(t('driverOnboarding.errFillVehicle'));
                    }
                  }}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
                >
                  {t('driverOnboarding.continueBtn')}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Documents (real file uploads) */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Upload Documents</h2>
              <p className="text-gray-500 text-sm mb-6">
                Upload clear photos or scans of each document. Accepted formats: JPG, PNG, PDF. Max 10&nbsp;MB per file. Files are uploaded securely to your private folder and only reviewed by the FlyttGo approvals team.
              </p>
              <div className="space-y-3">
                {DOCUMENT_TYPES.map(doc => {
                  const file = docFiles[doc.key];
                  return (
                    <div key={doc.key} className="p-4 rounded-xl border border-gray-200">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 text-sm">{doc.label}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{doc.desc}</div>
                        </div>
                        {file && (
                          <span className="flex-shrink-0 bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-1 rounded">
                            ✓ Ready
                          </span>
                        )}
                      </div>
                      <label className="block">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          onChange={e => {
                            const f = e.target.files?.[0] ?? null;
                            if (f && f.size > 10 * 1024 * 1024) {
                              setError('File too large (max 10 MB). Please upload a smaller file.');
                              return;
                            }
                            setError('');
                            setDocFile(doc.key, f);
                          }}
                          className="block w-full text-sm text-gray-500
                            file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                            file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700
                            hover:file:bg-emerald-100 cursor-pointer"
                        />
                        {file && (
                          <div className="text-xs text-gray-500 mt-2 truncate">
                            {file.name} &middot; {(file.size / 1024 / 1024).toFixed(2)}&nbsp;MB
                          </div>
                        )}
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(2)} className="px-6 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 transition">{t('driverOnboarding.backBtn')}</button>
                <button
                  onClick={() => {
                    /* All four document types are required. Keep this
                     * strict so the admin reviewer always has the full
                     * package to look at. */
                    const missing = DOCUMENT_TYPES.filter(d => !docFiles[d.key]).map(d => d.label);
                    if (missing.length === 0) {
                      setStep(4);
                      setError('');
                    } else {
                      setError(`Please upload: ${missing.join(', ')}`);
                    }
                  }}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
                >
                  {t('driverOnboarding.continueBtn')}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 — Review */}
          {step === 4 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Review & Submit</h2>
              <p className="text-gray-500 text-sm mb-6">Please review your information before submitting</p>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Personal Info</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-gray-500">Name:</span> <span className="font-medium">{firstName} {lastName}</span></div>
                    <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{phone}</span></div>
                    <div><span className="text-gray-500">City:</span> <span className="font-medium">{city}</span></div>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Vehicle</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-gray-500">Type:</span> <span className="font-medium">{VEHICLE_TYPES.find(v => v.id === vehicleType)?.label || '—'}</span></div>
                    <div><span className="text-gray-500">Make/Model:</span> <span className="font-medium">{vehicleMake} {vehicleModel}</span></div>
                    <div><span className="text-gray-500">Year:</span> <span className="font-medium">{vehicleYear}</span></div>
                    <div><span className="text-gray-500">Plate:</span> <span className="font-medium">{licensePlate}</span></div>
                  </div>
                </div>
                <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 cursor-pointer">
                  <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)}
                    className="w-5 h-5 text-emerald-600 rounded mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-600">
                    I agree to the <button className="text-emerald-600 underline">Terms of Service</button> and <button className="text-emerald-600 underline">Driver Agreement</button>. I confirm all information provided is accurate.
                  </span>
                </label>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(3)} className="px-6 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 transition">{t('driverOnboarding.backBtn')}</button>
                <button
                  onClick={() => { if (acceptedTerms) handleSubmit(); else setError('Please accept the terms to continue.'); }}
                  disabled={loading}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {loading ? t('driverOnboarding.submittingBtn') : t('driverOnboarding.submitBtn')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
