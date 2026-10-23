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
    // `city` is the same slot as `town` (COD-33); older forms and the payload still say town.
    if (typeof f?.standardKey === 'string') return f.standardKey === slot || (slot === 'town' && f.standardKey === 'city');
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

/** Standard keys a field can feed (the builder's "Sends to"). `city` and `notes` were added in COD-33. */
export const STANDARD_KEYS = [
  'fullName', 'phone', 'alternativePhone', 'email', 'region', 'town', 'city', 'landmark', 'streetAddress', 'notes', 'custom',
] as const;

// Label aliases for the keys the required-key guard checks (mirrors frontend/src/lib/standardFields.ts).
const GUARD_ALIASES: Record<string, string[]> = {
  fullName: ['name', 'full name', 'fullname', 'customer name', 'your name'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'contact number'],
  email: ['email', 'e-mail', 'email address'],
  region: ['region', 'region/state', 'state', 'state/region', 'province'],
  streetAddress: ALIASES.streetAddress,
};
const GUARD_LABELS: Record<string, string> = { fullName: 'Name', phone: 'Phone number', streetAddress: 'Street address', region: 'State', email: 'Email' };
const REQUIRED_KEYS = {
  physical: ['fullName', 'phone', 'streetAddress', 'region'],
  digital: ['fullName', 'phone', 'email'],
};

/**
 * Human labels of the standard slots an active form cannot do without and no enabled field feeds (F-411).
 * Physical: name, phone, street address, state. Digital: name, phone, email.
 * An empty fields array means the platform defaults apply, which the public order route already completes: nothing is missing.
 */
export function missingRequiredLabels(fields: unknown, formType: string): string[] {
  if (!Array.isArray(fields) || fields.length === 0) return [];
  const present = new Set<string>();
  for (const f of fields as Array<FormFieldLike & { type?: unknown }>) {
    if (f?.enabled === false) continue;
    if (typeof f?.standardKey === 'string') {
      present.add(f.standardKey);
      continue;
    }
    const label = typeof f?.label === 'string' ? f.label.toLowerCase().replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const byAlias = Object.keys(GUARD_ALIASES).find((k) => GUARD_ALIASES[k].includes(label));
    if (byAlias) present.add(byAlias);
    else if (f?.type === 'email') present.add('email');
    else if (f?.type === 'state') present.add('region');
  }
  return REQUIRED_KEYS[formType === 'digital' ? 'digital' : 'physical'].filter((k) => !present.has(k)).map((k) => GUARD_LABELS[k]);
}
