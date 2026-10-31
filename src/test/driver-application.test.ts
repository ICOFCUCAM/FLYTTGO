import { describe, expect, it } from 'vitest';
import { documentFileProblem, extensionOf, validVehicleYear, DOCUMENT_TYPES, VEHICLE_TYPES } from '../components/driver/applicationData';

/* The driver application's checks (driver/applicationData.ts): the database values stay as the admin flow reads them. */
describe('driver application checks', () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size }) as File;

  it('takes JPG, PNG and PDF up to 10 MB, and refuses anything else', () => {
    expect(documentFileProblem(file('licence.jpg', 'image/jpeg', 2_000))).toBeNull();
    expect(documentFileProblem(file('scan.PDF', 'application/pdf', 10 * 1024 * 1024))).toBeNull();
    expect(documentFileProblem(file('photo.png', '', 5_000))).toBeNull();          // no type from the browser: the extension decides
    expect(documentFileProblem(file('notes.txt', 'text/plain', 10))).toBe('wrongType');
    expect(documentFileProblem(file('photo.heic', '', 10))).toBe('wrongType');
    expect(documentFileProblem(file('big.png', 'image/png', 10 * 1024 * 1024 + 1))).toBe('tooLarge');
  });

  it('accepts only a plausible four-digit vehicle year', () => {
    const now = new Date('2026-10-31');
    expect(validVehicleYear('2020', now)).toBe(true);
    expect(validVehicleYear(' 2027 ', now)).toBe(true);
    expect(validVehicleYear('2028', now)).toBe(false);
    expect(validVehicleYear('1949', now)).toBe(false);
    expect(validVehicleYear('20a', now)).toBe(false);
    expect(validVehicleYear('abc', now)).toBe(false);
  });

  it('keeps the values the database and the admin approval flow read', () => {
    expect(DOCUMENT_TYPES.map(d => d.key)).toEqual(['driver_license', 'insurance', 'vehicle_registration', 'identity_document']);
    expect(VEHICLE_TYPES.map(v => v.id)).toEqual(['small_van', 'medium_van', 'large_van', 'luton_van']);
    expect(extensionOf('My Licence.JPEG')).toBe('jpeg');
    expect(extensionOf('noext')).toBe('bin');
  });
});
