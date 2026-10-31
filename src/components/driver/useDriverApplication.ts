/**
 * The driver application's state, checks and submission, shared by the application form on
 * /become-a-driver (DriverApplicationForm) and the earlier view (DriverOnboarding). Moved here
 * unchanged from DriverOnboarding (owner, 31 October 2026), with three fixes:
 *  - submitting while signed out did nothing at all; it now says so and the form offers sign-in,
 *    keeping everything typed in;
 *  - the vehicle year must be a plausible four-digit year (the column is an integer; "20a" or
 *    "abc" used to pass the check);
 *  - a chosen file is checked for type (JPG, PNG, PDF) as well as size, not only by the picker's hint.
 * The database writes are the same: files to the driver-documents bucket under {user_id}/, one
 * driver_applications row (status pending), one driver_documents row per file.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { DOCUMENT_TYPES, documentFileProblem, extensionOf, validVehicleYear, type DocumentType } from './applicationData';

export type Field = 'firstName' | 'lastName' | 'phone' | 'city' | 'vehicleType' | 'vehicleMake' | 'vehicleModel' | 'vehicleYear'
  | 'licensePlate' | DocumentType | 'terms';

export interface ExistingApplication { status: string; created_at: string | null }

/* Save and continue later (owner, 31 October 2026): the typed fields, on this device only, for 14 days. Files
 * cannot be kept by the browser, so a restored application asks for its documents again. */
const SAVE_KEY = 'flyttgo_driver_application_v1';
const SAVE_DAYS = 14;
interface Saved { savedAt: number; step: number; fields: Record<string, string> }
function readSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Saved | null;
    if (!v || typeof v.savedAt !== 'number' || Date.now() - v.savedAt > SAVE_DAYS * 86_400_000) return null;
    return v;
  } catch { return null; }
}

export function useDriverApplication({ persist = false }: { persist?: boolean } = {}) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();

  const [saved] = useState<Saved | null>(() => (persist ? readSaved() : null));
  const sf = (k: string) => saved?.fields?.[k] ?? '';
  const [step, setStep] = useState(() => (saved ? Math.min(3, Math.max(1, saved.step)) : 1));
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Field[]>([]);

  // Step 1 — Personal
  const [firstName, setFirstName] = useState(sf('firstName') || profile?.first_name || '');
  const [lastName, setLastName] = useState(sf('lastName') || profile?.last_name || '');
  const [phone, setPhone] = useState(sf('phone') || profile?.phone || '');
  const [city, setCity] = useState(sf('city'));

  // Step 2 — Vehicle
  const [vehicleType, setVehicleType] = useState(sf('vehicleType'));
  const [vehicleMake, setVehicleMake] = useState(sf('vehicleMake'));
  const [vehicleModel, setVehicleModel] = useState(sf('vehicleModel'));
  const [vehicleYear, setVehicleYear] = useState(sf('vehicleYear'));
  const [licensePlate, setLicensePlate] = useState(sf('licensePlate'));

  // Step 3 — Documents (real file uploads, one per required type)
  const [docFiles, setDocFiles] = useState<Record<DocumentType, File | null>>({
    driver_license:       null,
    insurance:            null,
    vehicle_registration: null,
    identity_document:    null,
  });

  // Step 4 — Terms
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  /* Keep what is typed (persist only). */
  const restored = !!saved;
  useEffect(() => {
    if (!persist || submitted) return;
    const fields = { firstName, lastName, phone, city, vehicleType, vehicleMake, vehicleModel, vehicleYear, licensePlate };
    if (!Object.values(fields).some(v => v.trim())) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ savedAt: Date.now(), step, fields })); } catch { /* storage blocked */ }
  }, [persist, submitted, step, firstName, lastName, phone, city, vehicleType, vehicleMake, vehicleModel, vehicleYear, licensePlate]);
  function clearSaved() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ }
    setFirstName(profile?.first_name || ''); setLastName(profile?.last_name || ''); setPhone(profile?.phone || ''); setCity('');
    setVehicleType(''); setVehicleMake(''); setVehicleModel(''); setVehicleYear(''); setLicensePlate(''); setStep(1);
    setError(''); setFieldErrors([]);
  }

  /* Fill the name and phone from the profile once it arrives, without overwriting what was typed. */
  useEffect(() => {
    if (!profile) return;
    setFirstName(v => v || profile.first_name || '');
    setLastName(v => v || profile.last_name || '');
    setPhone(v => v || profile.phone || '');
  }, [profile]);

  /* An application already sent by this account (the status page reads the same row). */
  const [existing, setExisting] = useState<ExistingApplication | null>(null);
  useEffect(() => {
    if (!user) { setExisting(null); return; }
    let live = true;
    void Promise.resolve(supabase.from('driver_applications').select('status, created_at').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle())
      .then(({ data }) => { if (live) setExisting((data as ExistingApplication | null) ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [user]);

  const docLabel = (key: DocumentType) => t(`driverApplication.docs.${key}.label`, DOCUMENT_TYPES.find(d => d.key === key)!.label);

  /** What is missing or wrong on a step: the message to show and the fields concerned. */
  function check(n: number): { message: string; fields: Field[] } {
    if (n === 1) {
      const fields = ([['firstName', firstName], ['lastName', lastName], ['phone', phone], ['city', city]] as const)
        .filter(([, v]) => !v.trim()).map(([k]) => k as Field);
      return { message: fields.length ? t('driverOnboarding.errFillAll') : '', fields };
    }
    if (n === 2) {
      const fields = ([['vehicleType', vehicleType], ['vehicleMake', vehicleMake], ['vehicleModel', vehicleModel], ['vehicleYear', vehicleYear], ['licensePlate', licensePlate]] as const)
        .filter(([, v]) => !v.trim()).map(([k]) => k as Field);
      if (fields.length) return { message: t('driverOnboarding.errFillVehicle'), fields };
      if (!validVehicleYear(vehicleYear)) return { message: t('driverApplication.errYear', { max: new Date().getFullYear() + 1 }), fields: ['vehicleYear'] };
      return { message: '', fields: [] };
    }
    if (n === 3) {
      /* All four document types are required. Keep this
       * strict so the admin reviewer always has the full
       * package to look at. */
      const missing = DOCUMENT_TYPES.filter(d => !docFiles[d.key]);
      return { message: missing.length ? t('driverApplication.errUpload', { list: missing.map(d => docLabel(d.key)).join(', ') }) : '',
               fields: missing.map(d => d.key) };
    }
    if (n === 4) return { message: acceptedTerms ? '' : t('driverApplication.errTerms'), fields: acceptedTerms ? [] : ['terms'] };
    return { message: '', fields: [] };
  }

  /** Go to the next step if this one is complete; otherwise say what is missing. */
  function next(): boolean {
    const { message, fields } = check(step);
    setError(message);
    setFieldErrors(fields);
    if (message) return false;
    setStep(s => Math.min(4, s + 1));
    return true;
  }

  function back() { setError(''); setFieldErrors([]); setStep(s => Math.max(1, s - 1)); }

  /** Go back to an earlier step (the review's Edit links); never forward past an unchecked step. */
  function goTo(n: number) { if (n < step) { setError(''); setFieldErrors([]); setStep(n); } }

  /** Take a chosen file for a document, or refuse it with a reason. Returns whether it was taken. */
  function pickFile(key: DocumentType, file: File | null): boolean {
    if (file) {
      const problem = documentFileProblem(file);
      if (problem) {
        setError(problem === 'tooLarge' ? t('driverApplication.errTooLarge') : t('driverApplication.errType'));
        setFieldErrors([key]);
        return false;
      }
    }
    setError('');
    setFieldErrors(f => f.filter(x => x !== key));
    setDocFiles(prev => ({ ...prev, [key]: file }));
    return true;
  }

  /* Upload every selected file to the driver-documents bucket under
   * `${user.id}/${document_type}.${ext}`. Using the user id as the
   * first folder segment matches the storage RLS policy installed
   * in docs/fix-driver-onboarding-pipeline.sql (only the owning
   * driver can write into their own folder). Returns a list of rows
   * to insert into driver_documents afterwards. */
  async function uploadDocuments(): Promise<{ document_type: DocumentType; file_url: string }[]> {
    if (!user) throw new Error('Not signed in');
    const rows: { document_type: DocumentType; file_url: string }[] = [];
    for (const doc of DOCUMENT_TYPES) {
      const file = docFiles[doc.key];
      if (!file) continue;
      const path = `${user.id}/${doc.key}.${extensionOf(file.name)}`;
      const { error: uploadError } = await supabase.storage.from('driver-documents').upload(path, file, {
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

  async function submit() {
    const { message, fields } = check(4);
    if (message) { setError(message); setFieldErrors(fields); return; }
    if (!user) { setError(t('driverApplication.errSignIn')); setFieldErrors([]); return; }
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
      const { error: appError } = await supabase.from('driver_applications').insert({
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
        const { error: docsError } = await supabase.from('driver_documents').insert(
          uploadedDocs.map(d => ({
            driver_id:           user.id,
            document_type:       d.document_type,
            file_url:            d.file_url,
            verification_status: 'pending',
          })),
        );
        if (docsError) throw docsError;
      }

      /* 4. profiles.role is NOT updated from the client anymore —
       *    the sync_profile_role_on_driver_approval trigger on
       *    driver_profiles now handles it automatically the moment
       *    the admin approves the application. No more best-effort
       *    client-side role update that silently fails under RLS. */
      if (persist) { try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ } }
      setSubmitted(true);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || t('driverApplication.errSubmit'));
    }
    setLoading(false);
  }

  return {
    user, step, loading, submitted, error, fieldErrors, existing, restored, clearSaved,
    firstName, setFirstName, lastName, setLastName, phone, setPhone, city, setCity,
    vehicleType, setVehicleType, vehicleMake, setVehicleMake, vehicleModel, setVehicleModel,
    vehicleYear, setVehicleYear, licensePlate, setLicensePlate,
    docFiles, pickFile, docLabel, acceptedTerms, setAcceptedTerms,
    next, back, goTo, submit,
  };
}

export type DriverApplication = ReturnType<typeof useDriverApplication>;
