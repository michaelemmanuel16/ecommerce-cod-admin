// The form a buyer was on when they left for the payment page. The callback page reads it to offer that store's support
// number when a payment reference is unknown (the reference then points to no form). Storage can be blocked: both calls swallow it.
const KEY = 'checkout_last_form';

export function rememberLastForm(slug: string): void {
  try {
    localStorage.setItem(KEY, slug);
  } catch { /* storage blocked */ }
}

export function lastFormSlug(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export interface PaymentNote {
  slug: string;
  total: number;
  currency: string;
  package: number;
}

/** What the thank-you page redirect needs and the verify answer does not carry (it holds no amounts). Keyed by payment reference. */
export function rememberPayment(reference: string, note: PaymentNote): void {
  try {
    localStorage.setItem(`checkout_payment_${reference}`, JSON.stringify(note));
  } catch { /* storage blocked */ }
}

export function recallPayment(reference: string): PaymentNote | null {
  try {
    const raw = localStorage.getItem(`checkout_payment_${reference}`);
    return raw ? (JSON.parse(raw) as PaymentNote) : null;
  } catch {
    return null;
  }
}
