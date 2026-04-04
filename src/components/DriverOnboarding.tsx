import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { supabase } from '../lib/supabase';

const STEPS = [
  { id: 1, title: 'Personal Info', desc: 'Tell us about yourself' },
  { id: 2, title: 'Vehicle Details', desc: 'Your van or truck info' },
  { id: 3, title: 'Documents', desc: 'Upload required documents' },
  { id: 4, title: 'Review', desc: 'Submit your application' },
];

const VEHICLE_TYPES = [
  { id: 'small_van', label: 'Small Van (3–4 m³)', examples: 'Ford Transit Connect, VW Caddy' },
  { id: 'medium_van', label: 'Medium Van (6–9 m³)', examples: 'Ford Transit Custom, Mercedes Vito' },
  { id: 'large_van', label: 'Large Van (11–15 m³)', examples: 'Mercedes Sprinter, Ford Transit LWB' },
  { id: 'luton_van', label: 'Luton Van (18–20 m³)', examples: 'Luton Box Truck with Tail Lift' },
];

export default function DriverOnboarding() {
  const { user, profile } = useAuth();
  const { setPage } = useApp();

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

  // Step 3 — Documents
  const [hasLicense, setHasLicense] = useState(false);
  const [hasInsurance, setHasInsurance] = useState(false);
  const [hasRegistration, setHasRegistration] = useState(false);

  // Step 4 — Terms
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  async function handleSubmit() {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      // Insert driver application
      const { error: appError } = await supabase
        .from('driver_applications')
        .insert({
          user_id: user.id,
          first_name: firstName,
          last_name: lastName,
          phone,
          city,
          vehicle_type: vehicleType,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_year: vehicleYear,
          license_plate: licensePlate,
          status: 'pending',
        });

      if (appError) throw appError;

      // Update profile role to driver
      await supabase
        .from('profiles')
        .update({ role: 'driver', phone })
        .eq('user_id', user.id);

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
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Application Submitted!</h2>
          <p className="text-gray-600 mb-6">
            Thank you for applying to become a FlyttGo driver. Our team will review your application and get back to you within 1–2 business days.
          </p>
          <div className="bg-emerald-50 rounded-xl p-4 mb-6 text-sm text-emerald-700">
            <p className="font-semibold mb-1">What happens next?</p>
            <ul className="space-y-1 text-left list-disc pl-4">
              <li>We review your application and documents</li>
              <li>Background check is conducted</li>
              <li>You'll receive an email with the decision</li>
              <li>Once approved, choose your subscription plan</li>
            </ul>
          </div>
          <button
            onClick={() => setPage('home')}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
          >
            Back to Home
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
          <h1 className="text-3xl font-bold mb-2">Become a FlyttGo Driver</h1>
          <p className="text-white/70">Complete your application in just 4 steps</p>
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
              <h2 className="text-xl font-bold text-gray-900 mb-1">Personal Information</h2>
              <p className="text-gray-500 text-sm mb-6">Tell us a bit about yourself</p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <input value={firstName} onChange={e => setFirstName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <input value={lastName} onChange={e => setLastName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+47 XXX XX XXX"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <select value={city} onChange={e => setCity(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm bg-white">
                    <option value="">Select your city</option>
                    {['Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Drammen', 'Fredrikstad', 'Kristiansand', 'Tromsø'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={() => { if (firstName && lastName && phone && city) setStep(2); else setError('Please fill in all fields.'); setError(''); }}
                className="w-full mt-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
              >
                Continue
              </button>
            </div>
          )}

          {/* STEP 2 — Vehicle */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Vehicle Details</h2>
              <p className="text-gray-500 text-sm mb-6">Tell us about your vehicle</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Vehicle Type</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                    <input value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} placeholder="e.g. Mercedes"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                    <input value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} placeholder="e.g. Sprinter"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                    <input value={vehicleYear} onChange={e => setVehicleYear(e.target.value)} placeholder="e.g. 2020"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">License Plate</label>
                    <input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="e.g. AB 12345"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm" />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(1)} className="px-6 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 transition">Back</button>
                <button onClick={() => setStep(3)} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">Continue</button>
              </div>
            </div>
          )}

          {/* STEP 3 — Documents */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Required Documents</h2>
              <p className="text-gray-500 text-sm mb-6">Confirm you have the following documents ready. Our team will request them after approval.</p>
              <div className="space-y-3">
                {[
                  { key: 'license', label: "Driver's License", desc: 'Valid Norwegian or EU/EEA driver\'s license', state: hasLicense, setter: setHasLicense },
                  { key: 'insurance', label: 'Vehicle Insurance', desc: 'Comprehensive insurance covering commercial use', state: hasInsurance, setter: setHasInsurance },
                  { key: 'registration', label: 'Vehicle Registration', desc: 'Current vehicle registration document', state: hasRegistration, setter: setHasRegistration },
                ].map(doc => (
                  <label key={doc.key} className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={doc.state} onChange={e => doc.setter(e.target.checked)}
                      className="w-5 h-5 text-emerald-600 rounded mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{doc.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{doc.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(2)} className="px-6 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 transition">Back</button>
                <button
                  onClick={() => { if (hasLicense && hasInsurance && hasRegistration) { setStep(4); setError(''); } else setError('Please confirm all required documents.'); }}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition"
                >
                  Continue
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
                <button onClick={() => setStep(3)} className="px-6 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 transition">Back</button>
                <button
                  onClick={() => { if (acceptedTerms) handleSubmit(); else setError('Please accept the terms to continue.'); }}
                  disabled={loading}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {loading ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
