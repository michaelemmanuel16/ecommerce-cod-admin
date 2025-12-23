/**
 * Trend Calculation Utilities
 * Calculate trends, growth rates, and comparisons
 */

import { TrendData, TrendComparison } from '../../config/types/dashboard';

/**
 * Calculate trend between current and previous values
 * @param current - Current period value
 * @param previous - Previous period value
 * @param inverted - If true, lower values are considered better
 * @returns Trend data with direction and percentage
 */
export function calculateTrend(
  current: number | undefined,
  previous: number | undefined,
  inverted: boolean = false
): TrendData {
  // Handle undefined or invalid values
  if (current === undefined || previous === undefined || previous === 0) {
    return {
      direction: 'neutral',
      percentage: 0,
      isPositive: false,
    };
  }

  // Calculate percentage change
  const change = current - previous;
  const percentage = Math.abs((change / previous) * 100);

  // Determine direction
  let direction: 'up' | 'down' | 'neutral';
  if (Math.abs(percentage) < 0.1) {
    // Less than 0.1% change is neutral
    direction = 'neutral';
  } else if (change > 0) {
    direction = 'up';
  } else {
    direction = 'down';
  }

  // Determine if positive (considering inverted)
  let isPositive: boolean;
  if (direction === 'neutral') {
    isPositive = false;
  } else if (inverted) {
    // For inverted metrics (like cancellation rate), down is good
    isPositive = direction === 'down';
  } else {
    // For normal metrics, up is good
    isPositive = direction === 'up';
  }

  return {
    direction,
    percentage: Math.round(percentage * 10) / 10, // Round to 1 decimal
    isPositive,
  };
}

/**
 * Get previous period value from trends data
 * @param data - Dashboard data object
 * @param currentValue - Current value
 * @param comparison - Type of comparison
 * @param trendDataPath - Path to trend data
 * @returns Previous period value
 */
export function getPreviousPeriodValue(
  data: any,
  currentValue: number,
  comparison: TrendComparison,
  trendDataPath?: string
): number | undefined {
  // If no trend data path provided, can't calculate
  if (!trendDataPath) {
    return undefined;
  }

  // For now, we'll use a simple heuristic
  // In a real implementation, this would access historical data
  // from the trends array based on the comparison type

  // Placeholder: Return a value for demonstration
  // This should be replaced with actual historical data lookup
  return currentValue * 0.9; // Assume 10% less as previous period
}

/**
 * Calculate moving average for time series data
 * @param values - Array of values
 * @param window - Moving average window size
 * @returns Array of moving average values
 */
export function calculateMovingAverage(values: number[], window: number = 7): number[] {
  const result: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const subset = values.slice(start, i + 1);
    const avg = subset.reduce((sum, val) => sum + val, 0) / subset.length;
    result.push(Math.round(avg * 100) / 100); // Round to 2 decimals
  }

  return result;
}

/**
 * Calculate growth rate
 * @param current - Current value
 * @param previous - Previous value
 * @returns Growth rate as percentage
 */
export function calculateGrowthRate(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Get trend color class based on direction and positivity
 * @param trend - Trend data
 * @returns Tailwind color class
 */
export function getTrendColorClass(trend: TrendData): string {
  if (trend.direction === 'neutral') {
    return 'text-gray-500';
  }
  return trend.isPositive ? 'text-green-600' : 'text-red-600';
}

/**
 * Get trend icon based on direction
 * @param direction - Trend direction
 * @returns Arrow character
 */
export function getTrendIcon(direction: 'up' | 'down' | 'neutral'): string {
  switch (direction) {
    case 'up':
      return '↗';
    case 'down':
      return '↘';
    case 'neutral':
      return '→';
  }
}
