/**
 * Value Formatting Utilities
 * Format numbers, currency, percentages, etc.
 */

import { ValueFormat, FormattedValue } from '../../config/types/dashboard';
import { useConfigStore } from '../../stores/configStore';
import { getCurrencySymbol } from '../countries';

/**
 * Format a value based on the specified format type
 * @param value - The value to format
 * @param format - The format type
 * @param options - Additional formatting options
 * @returns Formatted value object
 */
export function formatValue(
  value: number | string | undefined,
  format: ValueFormat = 'number',
  options?: {
    decimals?: number;
    prefix?: string;
    suffix?: string;
    locale?: string;
  }
): FormattedValue {
  if (value === undefined || value === null) {
    return {
      raw: 0,
      formatted: '—',
    };
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  const locale = options?.locale || 'en-US';

  switch (format) {
    case 'currency':
      const currency = useConfigStore.getState().currency || 'USD';
      return {
        raw: numValue,
        formatted: new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: options?.decimals ?? 2,
          maximumFractionDigits: options?.decimals ?? 2,
        }).format(numValue),
        prefix: getCurrencySymbol(currency),
      };

    case 'percentage':
      return {
        raw: numValue,
        formatted: `${numValue.toFixed(options?.decimals ?? 1)}%`,
        suffix: '%',
      };

    case 'number':
      return {
        raw: numValue,
        formatted: new Intl.NumberFormat(locale, {
          minimumFractionDigits: options?.decimals ?? 0,
          maximumFractionDigits: options?.decimals ?? 0,
        }).format(numValue),
      };

    case 'time':
      // Format as hours (e.g., "2.3h")
      return {
        raw: numValue,
        formatted: `${numValue.toFixed(1)}h`,
        suffix: 'h',
      };

    case 'date':
      // Format as date
      const date = typeof value === 'string' ? new Date(value) : new Date(numValue);
      return {
        raw: value,
        formatted: new Intl.DateTimeFormat(locale, {
          month: 'short',
          day: 'numeric',
        }).format(date),
      };

    case 'custom':
      return {
        raw: value,
        formatted: String(value),
        prefix: options?.prefix,
        suffix: options?.suffix,
      };

    default:
      return {
        raw: value,
        formatted: String(value),
      };
  }
}

/**
 * Format a number as a compact string (e.g., 1.2K, 3.4M)
 * @param value - Number to format
 * @returns Compact formatted string
 */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

/**
 * Format a percentage with sign
 * @param value - Percentage value
 * @param decimals - Number of decimal places
 * @returns Formatted percentage with + or - sign
 */
export function formatPercentageChange(value: number, decimals: number = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Get display format for chart tooltip
 * @param value - Value to format
 * @param format - Format type
 * @returns Formatted string for tooltip
 */
export function formatTooltipValue(value: number, format?: ValueFormat): string {
  const formatted = formatValue(value, format);
  return formatted.formatted;
}
