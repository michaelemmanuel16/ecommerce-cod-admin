/**
 * Data Resolver Utilities
 * Resolves data from nested paths and handles template strings
 */

import { DashboardData } from '../../config/types/dashboard';

/**
 * Resolve nested data path (e.g., 'metrics.totalRevenue' from data object)
 * @param data - The data object to search in
 * @param path - Dot-notation path (e.g., 'metrics.totalRevenue')
 * @returns The value at the path, or undefined if not found
 */
export function resolveDataSource<T = any>(data: DashboardData, path: string): T | undefined {
  if (!path || !data) return undefined;

  // Handle special cases
  if (path === 'currentUser') {
    // This should be injected from authStore
    return (data as any).currentUser;
  }

  // Split path and traverse object
  const keys = path.split('.');
  let result: any = data;

  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      return undefined;
    }
  }

  return result as T;
}

/**
 * Resolve template string with data sources
 * Example: "From {deliveredOrders} orders" with { deliveredOrders: 'metrics.deliveredOrders' }
 * @param template - Template string with {placeholder} syntax
 * @param data - Data object to resolve from
 * @param dataSources - Map of placeholders to data paths
 * @returns Resolved string
 */
export function resolveTemplate(
  template: string,
  data: DashboardData,
  dataSources: Record<string, string>
): string {
  let result = template;

  // Replace each placeholder with its resolved value
  Object.entries(dataSources).forEach(([placeholder, dataPath]) => {
    const value = resolveDataSource(data, dataPath);
    const formattedValue = value !== undefined ? String(value) : '—';
    result = result.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), formattedValue);
  });

  return result;
}

/**
 * Apply data filters to a dataset
 * @param data - Array of data items
 * @param filters - Filter criteria
 * @param currentUserId - Current user ID for 'currentUser' filter
 * @returns Filtered data
 */
export function applyDataFilters<T = any>(
  data: T[] | undefined,
  filters?: Record<string, any>,
  currentUserId?: string
): T[] {
  if (!data || !Array.isArray(data)) return [];
  if (!filters) return data;

  return data.filter((item) => {
    return Object.entries(filters).every(([key, value]) => {
      // Handle special 'currentUser' value
      const filterValue = value === 'currentUser' ? currentUserId : value;

      // @ts-ignore - Dynamic key access
      return item[key] === filterValue;
    });
  });
}

/**
 * Calculate derived/computed field
 * @param data - Dashboard data
 * @param calculation - Calculation function
 * @returns Calculated value
 */
export function calculateField(data: DashboardData, calculation: (data: any) => any): any {
  try {
    return calculation(data);
  } catch (error) {
    console.error('Error calculating field:', error);
    return undefined;
  }
}

/**
 * Get nested value safely
 * @param obj - Object to get value from
 * @param path - Path to value
 * @param defaultValue - Default value if not found
 * @returns Value or default
 */
export function getNestedValue(obj: any, path: string, defaultValue: any = undefined): any {
  const value = resolveDataSource(obj, path);
  return value !== undefined ? value : defaultValue;
}
