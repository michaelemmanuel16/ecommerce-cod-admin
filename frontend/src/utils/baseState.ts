/**
 * Display grouping for a state: trimmed, trailing bracket dropped, so "Greater Accra (Tema)" shows as "Greater Accra" (COD-139).
 * Copy of `baseState` in backend/src/utils/regions.ts; keep the two the same.
 */
export const baseState = (state: string | null | undefined): string => (state ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
