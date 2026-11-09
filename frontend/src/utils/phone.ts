/**
 * Phone number normalization (M1-T04, F-751). Hand-written rules for Ghana and Nigeria.
 * Stored form is E.164 (`+233245550103`).
 */

type PhoneCountry = 'GH' | 'NG';

const COUNTRIES: Record<PhoneCountry, { cc: string; nationalLength: number }> = {
  GH: { cc: '233', nationalLength: 9 },
  NG: { cc: '234', nationalLength: 10 },
};

function nationalToE164(country: PhoneCountry, national: string): string {
  return `+${COUNTRIES[country].cc}${national}`;
}

const PHONE_CHARS = /^\+?[\d\s\-().]+$/;

function parsePhone(
  input: string | null | undefined,
  defaultCountry: PhoneCountry = 'GH'
): { country: PhoneCountry; national: string } | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed || !PHONE_CHARS.test(trimmed)) return null;

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  const tryNational = (country: PhoneCountry, rest: string) => {
    let national = rest;
    if (national.length === COUNTRIES[country].nationalLength + 1 && national.startsWith('0')) national = national.slice(1);
    return national.length === COUNTRIES[country].nationalLength && national[0] !== '0' ? { country, national } : null;
  };

  for (const country of Object.keys(COUNTRIES) as PhoneCountry[]) {
    const { cc } = COUNTRIES[country];
    if (!digits.startsWith(cc)) continue;
    const parsed = tryNational(country, digits.slice(cc.length));
    if (parsed) return parsed;
  }
  return tryNational(defaultCountry, digits);
}

/**
 * Returns the E.164 number (+233... / +234...), or null when the input does not normalize to a valid GH/NG number.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry: PhoneCountry = 'GH'
): string | null {
  const parsed = parsePhone(input, defaultCountry);
  return parsed ? nationalToE164(parsed.country, parsed.national) : null;
}

export const phoneDigits = (phone: string): string => phone.replace(/\D/g, '');

/** Fewer than 9 digits is an error; a 9-digit Ghana number without the leading 0 is accepted (F-317). */
export const phoneOk = (phone: string): boolean => phoneDigits(phone).length >= 9;

/** Two phones are the same person's when their last 9 digits match (+233245550182 and 0245550182). */
export const samePhone = (a: string | null | undefined, b: string): boolean => {
  const x = phoneDigits(a ?? '');
  const y = phoneDigits(b);
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9);
};
