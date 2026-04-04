/**
 * formatNorwegianAddress.ts
 *
 * Official Norwegian address format:
 *   Street name + house number
 *   Postcode + City
 *   Norway
 *
 * Example:
 *   Karl Johans gate 12
 *   0154 Oslo
 *   Norway
 *
 * Use this function everywhere addresses are displayed:
 *   - Booking summary
 *   - Driver dashboard
 *   - Admin panel
 *   - Invoice preview
 *   - Confirmation page
 */

export interface AddressInput {
  street_name?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  country?: string;
  // Flat alternative (legacy / manual fallback)
  formatted?: string;
  // Booking-specific prefixed fields (from store/db)
  pickup_street?: string;
  pickup_house_number?: string;
  pickup_postcode?: string;
  pickup_city?: string;
  delivery_street?: string;
  delivery_house_number?: string;
  delivery_postcode?: string;
  delivery_city?: string;
}

export interface FormattedAddress {
  line1: string;    // "Karl Johans gate 12"
  line2: string;    // "0154 Oslo"
  line3: string;    // "Norway"
  full: string;     // "Karl Johans gate 12, 0154 Oslo, Norway"
  short: string;    // "Karl Johans gate 12, Oslo"
  oneLine: string;  // "Karl Johans gate 12, 0154 Oslo"
}

/**
 * formatNorwegianAddress
 * Formats a structured address object into official Norwegian format.
 *
 * @param address - Address object (structured or legacy flat string)
 * @param prefix  - Optional field prefix: 'pickup' | 'delivery' | ''
 * @returns FormattedAddress object
 */
export function formatNorwegianAddress(
  address: AddressInput | string | null | undefined,
  prefix: 'pickup' | 'delivery' | '' = ''
): FormattedAddress {
  // Handle null/undefined
  if (!address) {
    return {
      line1: 'Address not provided',
      line2: '',
      line3: 'Norway',
      full: 'Address not provided, Norway',
      short: 'Address not provided',
      oneLine: 'Address not provided',
    };
  }

  // Handle legacy flat string
  if (typeof address === 'string') {
    return {
      line1: address,
      line2: '',
      line3: 'Norway',
      full: `${address}, Norway`,
      short: address,
      oneLine: address,
    };
  }

  // Extract fields with prefix support
  const p = prefix ? `${prefix}_` : '';

  const streetName =
    (address as any)[`${p}street_name`] ||
    (address as any)[`${p}street`] ||
    address.street_name ||
    '';

  const houseNumber =
    (address as any)[`${p}house_number`] ||
    address.house_number ||
    '';

  const postcode =
    (address as any)[`${p}postcode`] ||
    address.postcode ||
    '';

  const rawCity =
    (address as any)[`${p}city`] ||
    address.city ||
    '';

  // If we have a pre-formatted string and no structured data
  if (!streetName && !postcode && address.formatted) {
    return {
      line1: address.formatted,
      line2: '',
      line3: 'Norway',
      full: `${address.formatted}, Norway`,
      short: address.formatted,
      oneLine: address.formatted,
    };
  }

  // Capitalize city properly (Kartverket returns UPPERCASE)
  const city = rawCity
    ? rawCity.charAt(0).toUpperCase() + rawCity.slice(1).toLowerCase()
    : '';

  // Build line 1: "Karl Johans gate 12"
  const line1Parts = [streetName, houseNumber].filter(Boolean);
  const line1 = line1Parts.join(' ') || 'Address not provided';

  // Build line 2: "0154 Oslo"
  const line2Parts = [postcode, city].filter(Boolean);
  const line2 = line2Parts.join(' ');

  // line3 always Norway
  const line3 = 'Norway';

  // Assemble full versions
  const allParts = [line1, line2, line3].filter(s => s && s !== 'Address not provided' || s === line1);
  const full = allParts.filter(Boolean).join(', ');
  const short = [line1, city].filter(Boolean).join(', ');
  const oneLine = [line1, line2].filter(Boolean).join(', ');

  return { line1, line2, line3, full, short, oneLine };
}

/**
 * formatAddressMultiline
 * Returns JSX-ready array of lines for multi-line rendering.
 */
export function formatAddressLines(
  address: AddressInput | string | null | undefined,
  prefix: 'pickup' | 'delivery' | '' = ''
): string[] {
  const f = formatNorwegianAddress(address, prefix);
  return [f.line1, f.line2, f.line3].filter(Boolean);
}

/**
 * validateNorwegianAddress
 * Returns validation errors for a structured address.
 */
export interface AddressValidationResult {
  valid: boolean;
  errors: {
    street?: string;
    postcode?: string;
    city?: string;
  };
}

export function validateNorwegianAddress(
  address: Partial<AddressInput> | null | undefined
): AddressValidationResult {
  const errors: AddressValidationResult['errors'] = {};

  if (!address) {
    return {
      valid: false,
      errors: {
        street: 'Street address is required',
        postcode: 'Postcode is required',
        city: 'City is required',
      },
    };
  }

  const street = address.street_name || (address as any).pickup_street || '';
  const postcode = address.postcode || (address as any).pickup_postcode || '';
  const city = address.city || (address as any).pickup_city || '';

  if (!street || street.trim().length < 2) {
    errors.street = 'Street name is required';
  }

  if (!postcode) {
    errors.postcode = 'Postcode is required';
  } else if (!/^\d{4}$/.test(postcode.trim())) {
    errors.postcode = 'Norwegian postcode must be exactly 4 digits';
  }

  if (!city || city.trim().length < 2) {
    errors.city = 'City is required';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * addressToDisplayString
 * Quick single-line display for tables, cards, and summaries.
 * e.g. "Karl Johans gate 12, 0154 Oslo"
 */
export function addressToDisplayString(
  address: AddressInput | string | null | undefined,
  prefix: 'pickup' | 'delivery' | '' = ''
): string {
  return formatNorwegianAddress(address, prefix).oneLine;
}

export default formatNorwegianAddress;
