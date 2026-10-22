// Town, landmark and address handling shared by the COD and Paystack checkout paths (COD-138).

type FormFieldLike = { label?: unknown; enabled?: unknown; required?: unknown; standardKey?: unknown };
export type CheckoutSlot = 'town' | 'landmark' | 'streetAddress';

// Label aliases for forms saved before `standardKey` existed (mirrors frontend/src/lib/standardFields.ts).
const ALIASES: Record<CheckoutSlot, string[]> = {
  town: ['city/town', 'city', 'town', 'city / town'],
  landmark: ['nearest landmark', 'landmark'],
  streetAddress: ['address', 'street address', 'delivery address', 'shipping address', 'home address', 'house address', 'residential address', 'full address'],
};

/** A saved form with no fields array uses the platform defaults: town + landmark on, street address off. */
const DEFAULT_RULE: Record<CheckoutSlot, 'required' | 'optional' | 'off'> = {
  town: 'required',
  landmark: 'required',
  streetAddress: 'off',
};

/**
 * Whether the buyer must fill a slot, may fill it, or is not asked.
 * Forms saved before this change have no town/landmark field: the public renderer adds both as required, so the
 * server treats a missing field as required too. A missing street address field means the buyer is not asked for it.
 */
export function slotRule(fields: unknown, slot: CheckoutSlot): 'required' | 'optional' | 'off' {
  if (!Array.isArray(fields) || fields.length === 0) return DEFAULT_RULE[slot];
  const match = (fields as FormFieldLike[]).find((f) => {
    if (typeof f?.standardKey === 'string') return f.standardKey === slot;
    return typeof f?.label === 'string' && ALIASES[slot].includes(f.label.toLowerCase().replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim());
  });
  if (!match) return slot === 'streetAddress' ? 'off' : 'required';
  if (match.enabled === false) return 'off';
  return match.required === false ? 'optional' : 'required';
}

/** Trimmed text, or '' when not a string. */
export function cleanText(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** What riders read: the street address and the landmark, whichever the buyer gave. */
export function deliveryAddressOf(address: unknown, landmark: unknown): string | null {
  const joined = [cleanText(address, 500), cleanText(landmark)].filter(Boolean).join(', ');
  return joined || null;
}
