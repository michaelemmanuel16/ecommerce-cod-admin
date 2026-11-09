/** F-300: the one order number format on screen, in messages and in exports. The Pixel and CAPI event id stays the raw id. */
export const formatOrderNumber = (id: number): string => `#${id}`;

/** The order id in "1042" or "#1042" (the order number on screen). Null for anything else. */
export function parseOrderNumber(ref: string): number | null {
  const m = /^#?\s*(\d{1,9})$/.exec(ref.trim());
  return m ? Number(m[1]) : null;
}
