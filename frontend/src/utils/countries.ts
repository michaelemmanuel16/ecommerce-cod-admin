// Unified country utility using country-state-city package
import { Country, State, ICountry, IState } from 'country-state-city';

/**
 * Map of supported country names to their ISO2 codes
 * Add more countries here as needed
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'Ghana': 'GH',
  'Nigeria': 'NG',
  'Kenya': 'KE',
  'South Africa': 'ZA',
  'Uganda': 'UG',
  'Tanzania': 'TZ',
  'Rwanda': 'RW',
  'Ethiopia': 'ET',
  'Zambia': 'ZM',
  'Zimbabwe': 'ZW',
};

/**
 * Get the ISO2 country code from country name
 * @param countryName - The country name (e.g., 'Ghana', 'Nigeria')
 * @returns ISO2 country code (e.g., 'GH', 'NG')
 */
export function getCountryCode(countryName: string): string {
  return COUNTRY_NAME_TO_CODE[countryName] || 'GH';
}

/**
 * Get all regions/states for a given country
 * @param countryName - The country name
 * @returns Array of region/state names
 */
export function getRegionsForCountry(countryName: string): string[] {
  const countryCode = getCountryCode(countryName);
  const states: IState[] = State.getStatesOfCountry(countryCode);

  // Return state names, or empty array if no states found
  return states.map(state => state.name);
}

/**
 * Get the currency code for a given country
 * @param countryName - The country name
 * @returns Currency code (e.g., 'GHS', 'NGN', 'KES')
 */
export function getCurrencyForCountry(countryName: string): string {
  const countryCode = getCountryCode(countryName);
  const country: ICountry | undefined = Country.getCountryByCode(countryCode);

  // Return currency code, or 'GHS' as fallback
  return country?.currency || 'GHS';
}

/**
 * The one currency list (F-1232). Onboarding and Settings both render from it.
 */
export const SUPPORTED_CURRENCIES = [
  'USD', 'GHS', 'NGN', 'KES', 'ZAR', 'UGX', 'TZS', 'RWF', 'ETB', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const CURRENCY_NAMES: Record<SupportedCurrency, string> = {
  USD: 'US Dollar',
  GHS: 'Ghanaian Cedi',
  NGN: 'Nigerian Naira',
  KES: 'Kenyan Shilling',
  ZAR: 'South African Rand',
  UGX: 'Ugandan Shilling',
  TZS: 'Tanzanian Shilling',
  RWF: 'Rwandan Franc',
  ETB: 'Ethiopian Birr',
  EUR: 'Euro',
  GBP: 'British Pound',
  INR: 'Indian Rupee',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  JPY: 'Japanese Yen',
};

/** Label for a currency picker option, e.g. "NGN - Nigerian Naira (₦)". */
export function getCurrencyOptionLabel(code: SupportedCurrency): string {
  return `${code} - ${CURRENCY_NAMES[code]} (${getCurrencySymbol(code)})`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  'GHS': 'GH₵',
  'NGN': '₦',
  'KES': 'KSh',
  'ZAR': 'R',
  'UGX': 'USh',
  'TZS': 'TSh',
  'RWF': 'FRw',
  'ETB': 'Br',
  'ZMW': 'ZK',
  'ZWL': 'Z$',
  'USD': '$',
  'EUR': '€',
  'GBP': '£',
  'INR': '₹',
  'CAD': '$',
  'AUD': '$',
  'JPY': '¥',
};

/**
 * Get the currency symbol for a given currency code
 * @param currencyCode - The currency code (e.g., 'GHS', 'NGN')
 * @returns Currency symbol (e.g., 'GH₵', '₦')
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}

/**
 * Format a price with currency
 * @param amount - The amount to format
 * @param currency - The currency code
 * @returns Formatted price string (e.g., "GHS 100.00")
 */
export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

/**
 * Format a price with currency symbol
 * @param amount - The amount to format
 * @param currency - The currency code
 * @returns Formatted price string with symbol (e.g., "GH₵ 100.00")
 */
export function formatCurrencyWithSymbol(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

/**
 * Get list of all supported countries
 * @returns Array of country names
 */
export function getSupportedCountries(): string[] {
  return Object.keys(COUNTRY_NAME_TO_CODE);
}

/**
 * Get the country name for a given currency code
 * @param currency - The currency code
 * @returns Country name (e.g., 'Ghana', 'Nigeria')
 */
export function getCountryByCurrency(currency: string): string {
  const countries = getSupportedCountries();
  return countries.find(c => getCurrencyForCountry(c) === currency) || 'Ghana';
}

/**
 * Get all country data for a given country name
 * @param countryName - The country name
 * @returns Country object with all data
 */
export function getCountryData(countryName: string): ICountry | undefined {
  const countryCode = getCountryCode(countryName);
  return Country.getCountryByCode(countryCode);
}
