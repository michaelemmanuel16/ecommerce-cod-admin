import { FieldMapping } from '../types/webhook';

/**
 * Convert API format to UI format
 * API: { customerPhone: 'customer_phone', productName: 'product_name' }
 * UI: [{ external: 'customer_phone', internal: 'customerPhone' }, ...]
 */
export const apiToUiFormat = (fieldMapping: Record<string, string>): FieldMapping[] => {
  return Object.entries(fieldMapping).map(([internal, external]) => ({
    internal,
    external: external as string
  }));
};

/**
 * Convert UI format to API format
 * UI: [{ external: 'customer_phone', internal: 'customerPhone' }, ...]
 * API: { customerPhone: 'customer_phone', productName: 'product_name' }
 */
export const uiToApiFormat = (mappings: FieldMapping[]): Record<string, string> => {
  return mappings.reduce((acc, m) => {
    if (m.external && m.internal) {
      acc[m.internal] = m.external; // internal is KEY, external is VALUE
    }
    return acc;
  }, {} as Record<string, string>);
};
