/** F-300: the one order number format on screen, in messages and in exports. The Pixel and CAPI event id stays the raw id. */
export const formatOrderNumber = (id: number): string => `#${id}`;
