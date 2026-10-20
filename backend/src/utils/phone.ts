/**
 * Phone number normalization (M1-T04). Hand-written rules for Ghana and Nigeria only.
 * Stored form is E.164 (`+233245550103`). Customers saved before this existed are in
 * old forms (`0245550103`, `233245550103`, ...), so lookups use `phoneLookupVariants`.
 */

export type PhoneCountry = 'GH' | 'NG';

// cc = calling code, nationalLength = digits after the country code and the trunk 0.
const COUNTRIES: Record<PhoneCountry, { cc: string; nationalLength: number }> = {
  GH: { cc: '233', nationalLength: 9 },
  NG: { cc: '234', nationalLength: 10 },
};

function nationalToE164(country: PhoneCountry, national: string): string {
  return `+${COUNTRIES[country].cc}${national}`;
}

// Digits plus the usual separators. A plus is allowed once, at the start.
const PHONE_CHARS = /^\+?[\d\s\-().]+$/;

/** Country and national digits (no trunk 0) of a valid GH/NG number, or null. */
function parse(
  input: string | null | undefined,
  defaultCountry: PhoneCountry
): { country: PhoneCountry; national: string } | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed || !PHONE_CHARS.test(trimmed)) return null;

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2); // 00233... international prefix

  const tryNational = (country: PhoneCountry, rest: string) => {
    let national = rest;
    if (national.length === COUNTRIES[country].nationalLength + 1 && national.startsWith('0')) national = national.slice(1); // +233 0245...
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
 * Returns the E.164 number, or null when the input is not a valid GH/NG number.
 * Numbers that already carry a +233 / +234 code keep their own country; local forms use `defaultCountry`.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry: PhoneCountry = 'GH'
): string | null {
  const parsed = parse(input, defaultCountry);
  return parsed ? nationalToE164(parsed.country, parsed.national) : null;
}

/**
 * Value to store for a phone field: E.164 when parseable, else the raw trimmed input.
 * Orders must never fail on odd phone input (prod holds values like "Hallo die Conny").
 * null, undefined and '' pass through unchanged, so callers need no guard.
 */
export function normalizePhoneForStorage(input: string, defaultCountry?: PhoneCountry): string;
export function normalizePhoneForStorage(
  input: string | null | undefined,
  defaultCountry?: PhoneCountry
): string | null | undefined;
export function normalizePhoneForStorage(
  input: string | null | undefined,
  defaultCountry: PhoneCountry = 'GH'
): string | null | undefined {
  if (!input) return input;
  return normalizePhone(input, defaultCountry) ?? String(input).trim();
}

/** `+233245550103` -> `024 555 0103`; `+2347058824150` -> `0705 882 4150`. Anything else comes back unchanged. */
export function formatPhoneLocal(e164: string): string {
  const gh = /^\+233(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (gh) return `0${gh[1]} ${gh[2]} ${gh[3]}`;
  const ng = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (ng) return `0${ng[1]} ${ng[2]} ${ng[3]}`;
  return e164;
}

/**
 * The normalized value plus the old stored forms, for `where: { phoneNumber: { in: variants } }`.
 * Unparseable input gives just the trimmed input, so odd values still match themselves.
 * The legacy-format entries (`0...`, bare digits) can go once `normalize:customer-phones` has run on production (v2 launch).
 */
export function phoneLookupVariants(
  input: string | null | undefined,
  defaultCountry: PhoneCountry = 'GH'
): string[] {
  const raw = String(input ?? '').trim();
  if (!raw) return [];
  const parsed = parse(raw, defaultCountry);
  if (!parsed) return [raw];
  const e164 = nationalToE164(parsed.country, parsed.national);
  return [...new Set([e164, `0${parsed.national}`, e164.slice(1), parsed.national, raw])];
}

/** True when a search term is only digits and phone separators (so it can be matched as a phone). */
export function looksLikePhone(term: string): boolean {
  const t = term.trim();
  return PHONE_CHARS.test(t) && /\d{5,}/.test(t.replace(/\D/g, ''));
}

/**
 * The digits to `contains`-match for a partly typed local number: `024 55` gives `2455`, so it
 * also finds numbers stored as `+233245...`. Null when the term is not a local number with a leading 0.
 * Only needed while legacy-format rows exist; remove after `normalize:customer-phones` has run on production (v2 launch).
 */
export function phonePartialDigits(term: string): string | null {
  const t = term.trim();
  if (!PHONE_CHARS.test(t) || t.startsWith('+')) return null;
  const digits = t.replace(/\D/g, '');
  return /^0\d{2,}$/.test(digits) ? digits.slice(1) : null;
}

type PhoneCondition = { phoneNumber: { contains: string } | { in: string[] } };

/**
 * Extra `phoneNumber` conditions for a free-text search. Phone-like terms also match every stored
 * format of the same number; the plain `contains` match stays so partial typing keeps working.
 * Returns [] when the term has no digit (a name search), so spread it into an OR that has other branches.
 */
export function phoneSearchConditions(term: string): PhoneCondition[] {
  const t = term.trim();
  if (!/\d/.test(t)) return [];
  const conditions: PhoneCondition[] = [{ phoneNumber: { contains: t } }];
  const partial = phonePartialDigits(t);
  if (partial) conditions.push({ phoneNumber: { contains: partial } });
  if (looksLikePhone(t)) conditions.push({ phoneNumber: { in: phoneLookupVariants(t) } });
  return conditions;
}

/** One relation filter for searching orders/deliveries by customer phone, or null for a non-phone term. */
export function customerPhoneSearch(term: string): { customer: { OR: PhoneCondition[] } } | null {
  const conditions = phoneSearchConditions(term);
  return conditions.length ? { customer: { OR: conditions } } : null;
}
