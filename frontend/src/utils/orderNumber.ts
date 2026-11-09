/**
 * F-300, F-771: The single order number formatter across the frontend.
 * Mirrors backend utils/orderNumber.ts.
 */
export const formatOrderNumber = (id: number | string): string => `#${id}`;

/** The order id in "1042" or "#1042" (the order number on screen). Null for anything else. */
export function parseOrderNumber(ref: string): number | null {
  const m = /^#?\s*(\d{1,9})$/.exec(ref.trim());
  return m ? Number(m[1]) : null;
}
