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
 * Get currency symbol for a given currency code
 * Note: country-state-city doesn't provide symbols, so we maintain a small map
 */
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
  return `${currency} ${amount.toFixed(2)}`;
}

/**
 * Format a price with currency symbol
 * @param amount - The amount to format
 * @param currency - The currency code
 * @returns Formatted price string with symbol (e.g., "GH₵ 100.00")
 */
export function formatCurrencyWithSymbol(amount: number, currency: string): string {
  const symbol = getCurrencySymbol(currency);
  return `${symbol} ${amount.toFixed(2)}`;
}

/**
 * Get list of all supported countries
 * @returns Array of country names
 */
export function getSupportedCountries(): string[] {
  return Object.keys(COUNTRY_NAME_TO_CODE);
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
