// Basics rules of a checkout form (F-411), the same ones the server applies in
// backend/src/utils/checkoutFormRules.ts. The editor shows them while the owner types; the server stays the judge.

export const THANK_YOU_ERROR = 'Thank-you page must start with https://';

/** Error text for a thank-you page URL, or null. Empty is allowed: the built-in thank-you screen shows. */
export function thankYouError(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    if (new URL(text).protocol === 'https:') return null;
  } catch {
    // fall through
  }
  return THANK_YOU_ERROR;
}

const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d{1,5})?$/i;

/** True for a host or an https origin: no http, no path, no wildcard. Mirrors normalizeAllowedOrigins on the server. */
export function isAllowedDomain(entry: string): boolean {
  const text = entry.trim();
  const host = /^https:\/\//i.test(text) ? text.slice(8).replace(/\/$/, '') : text;
  return HOST.test(host);
}

export interface DomainLineError {
  /** 1-based line number in the textarea. */
  line: number;
  text: string;
  message: string;
}

/** One error per bad line of the Allowed domains box. Blank lines are skipped. */
export function domainLineErrors(value: string): DomainLineError[] {
  const errors: DomainLineError[] = [];
  value.split('\n').forEach((raw, i) => {
    const text = raw.trim();
    if (text && !isAllowedDomain(text)) {
      errors.push({ line: i + 1, text, message: `"${text}" is not a valid domain. Use a host such as shop.example.com.` });
    }
  });
  return errors;
}

/** Slug the server accepts (lowercase letters, digits, hyphens), made from the form name. */
export const slugFromName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The first thing wrong with the Basics values before a save, in the owner's words, or null. The server checks again. */
export function validateBasics(v: { name: string; slug: string; productId: number; redirectUrl: string; allowedOrigins: string }): string | null {
  if (!v.name.trim()) return 'Give the form a name.';
  if (!v.slug) return 'The form name needs at least one letter or number.';
  if (!v.productId) return 'Choose the product this form sells.';
  const thankYou = thankYouError(v.redirectUrl);
  if (thankYou) return thankYou;
  return domainLineErrors(v.allowedOrigins)[0]?.message ?? null;
}
