import * as Money from '../../utils/money';

/**
 * Decimal places of a currency's minor unit (2 for GHS and NGN, 0 for JPY). From the ISO 4217
 * table the runtime carries; an unknown code falls back to 2.
 */
function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Major units to an integer count of minor units, rounded half up: toMinor(249, 'GHS') is 24900. */
export function toMinor(amount: Money.MoneyInput, currency: string): number {
  return Money.roundHalfUp(Money.mul(amount, 10 ** minorDigits(currency)), 0).toNumber();
}

/** Integer minor units to major units. */
export function fromMinor(minor: Money.MoneyInput, currency: string): Money.Money {
  return Money.div(minor, 10 ** minorDigits(currency));
}
