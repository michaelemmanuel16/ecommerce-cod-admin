/** Pieces of list-view URL state shared by the Orders and Customers lists. */

/** The search waits this long after the last key press (F-310, F-352). */
export const SEARCH_DEBOUNCE_MS = 300;
export const DEFAULT_SIZE = 25;

/** A whole number above 0, or null (a missing or bad URL value). */
export const positive = (v: string | null): number | null => {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n > 0 ? n : null;
};
