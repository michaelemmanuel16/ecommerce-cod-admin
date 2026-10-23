// Which payment methods a form may offer (F-402) and the currency check of the payment account (F-401).
// Mirrors backend/src/services/payments/paymentMethods.ts `methodMatrix` and
// backend/src/services/payments/connectionConfig.ts `unsupportedCurrencyMessage`; the server refuses what this lets through.
import type { FormType } from '../types/checkout-form';

export interface MethodMatrix {
  cod: boolean;
  online_deposit: boolean;
  online_full: boolean;
}

/** Digital forms take online payment in full only. Physical forms take COD, and the online methods only with the tenant flag. */
export function methodMatrix(formType: FormType, prepaidPhysical: boolean): MethodMatrix {
  if (formType === 'digital') return { cod: false, online_deposit: false, online_full: true };
  return { cod: true, online_deposit: prepaidPhysical, online_full: prepaidPhysical };
}

export interface PaymentConnectionInfo {
  provider: string;
  mode: 'test' | 'live';
  isEnabled: boolean;
  supportedCurrencies: string[];
  lastCheckedAt: string | null;
}

/** 'unsupported': the account cannot take the currency (online switches stay off). 'untested': no currency list yet, nothing is blocked. */
export function currencyCheck(connection: PaymentConnectionInfo | null, currency: string): 'unsupported' | 'untested' | null {
  if (!connection) return null;
  if (connection.supportedCurrencies.length === 0) return 'untested';
  return connection.supportedCurrencies.includes(currency.toUpperCase()) ? null : 'unsupported';
}

export interface MethodToggles {
  cod: boolean;
  deposit: boolean;
  full: boolean;
}

/** The toggles a form saves and previews. A digital form is always online in full; a physical form keeps what is stored. */
export function effectiveToggles(formType: FormType, toggles: MethodToggles): MethodToggles {
  return formType === 'digital' ? { cod: false, deposit: false, full: true } : toggles;
}
