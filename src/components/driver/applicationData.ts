/**
 * What the driver application collects (owner, 31 October 2026: one source for the application form,
 * the requirements on /become-a-driver and the old view). Values are the ones the database and the
 * admin approval flow already use; do not rename them.
 */

/** vehicle_type values written to driver_applications. */
export const VEHICLE_TYPES = [
  { id: 'small_van', label: 'Small Van (3–4 m³)', examples: 'Ford Transit Connect, VW Caddy' },
  { id: 'medium_van', label: 'Medium Van (6–9 m³)', examples: 'Ford Transit Custom, Mercedes Vito' },
  { id: 'large_van', label: 'Large Van (11–15 m³)', examples: 'Mercedes Sprinter, Ford Transit LWB' },
  { id: 'luton_van', label: 'Luton Van (18–20 m³)', examples: 'Luton Box Truck with Tail Lift' },
] as const;

/* ── Documents collected in step 3 ──────────────────────────────────
 * Each key is the canonical document_type value we write to
 * driver_documents. The admin dashboard approval flow already reads
 * those exact strings (see AdminDashboard REQUIRED_DOCS), so we stay
 * aligned by not renaming them. The fourth type (identity_document)
 * is new — admin doesn't currently require it, but uploading it
 * costs nothing and matches the spec. */
export const DOCUMENT_TYPES = [
  { key: 'driver_license',       label: "Driver's License",   desc: 'Valid Norwegian or EU/EEA driver’s license (front + back)' },
  { key: 'insurance',             label: 'Vehicle Insurance',  desc: 'Comprehensive insurance covering commercial use' },
  { key: 'vehicle_registration', label: 'Vehicle Registration', desc: 'Current vehicle registration document' },
  { key: 'identity_document',    label: 'ID / Passport',      desc: 'Government-issued photo ID or passport' },
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number]['key'];

/** The cities an applicant can choose (city on driver_applications). */
export const APPLICATION_CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Drammen', 'Fredrikstad', 'Kristiansand', 'Tromsø'] as const;

/** Files the driver-documents bucket takes from the form: JPG, PNG or PDF, at most 10 MB each. */
export const DOCUMENT_ACCEPT = 'image/jpeg,image/png,application/pdf';
export const DOCUMENT_TYPES_ALLOWED = ['image/jpeg', 'image/png', 'application/pdf'];
export const DOCUMENT_EXTENSIONS_ALLOWED = ['jpg', 'jpeg', 'png', 'pdf'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Sanitise a filename segment. We don't trust the uploader's filename
 *  so we rebuild the storage path from {user_id}/{document_type}.{ext}
 *  and only preserve the extension from the original name. */
export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'bin';
}

/** Why a chosen file cannot be used, or null: too large, or not JPG, PNG or PDF (by type, or by extension when the browser gives none). */
export function documentFileProblem(file: File): 'tooLarge' | 'wrongType' | null {
  if (file.size > MAX_DOCUMENT_BYTES) return 'tooLarge';
  const typeOk = file.type ? DOCUMENT_TYPES_ALLOWED.includes(file.type) : DOCUMENT_EXTENSIONS_ALLOWED.includes(extensionOf(file.name));
  return typeOk ? null : 'wrongType';
}

/** A vehicle year the database's integer column can take and that is plausible: four digits, 1950 to next year. */
export function validVehicleYear(value: string, now = new Date()): boolean {
  if (!/^\d{4}$/.test(value.trim())) return false;
  const y = Number(value.trim());
  return y >= 1950 && y <= now.getFullYear() + 1;
}
