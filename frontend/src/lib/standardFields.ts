// Resolves which checkout payload slot each form field feeds.
//
// A field that resolves to a standard key is posted as that key (`address`,
// `state`, `phoneNumber`, ...). Anything else is posted under `customFields`,
// which the order never reads — so a mis-resolved address field means the buyer
// types their address, the server sees an empty `address`, and the order is
// rejected. That is a silent, total failure for the form, which is why the
// builder now writes `standardKey` explicitly and this inference only runs as a
// fallback for forms built before it existed.
import { FieldType, FormField, StandardFieldKey } from '../types/checkout-form';

export interface StandardFieldMeta {
  key: StandardFieldKey;
  /** Shown in the builder's destination picker. */
  label: string;
  /** Lowercased labels that infer this key on forms with no explicit standardKey. */
  aliases: string[];
}

// Aliases are matched exactly (after normalisation), not by substring, so an
// unrelated label can't capture a slot. Ambiguous words are deliberately absent:
// "city" is not an alias for region, because a form may carry both.
export const STANDARD_FIELDS: readonly StandardFieldMeta[] = [
  {
    key: 'fullName',
    label: 'Customer name',
    aliases: ['name', 'full name', 'fullname', 'customer name', 'your name'],
  },
  {
    key: 'phone',
    label: 'Phone number',
    aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'contact number'],
  },
  {
    key: 'alternativePhone',
    label: 'Alternate phone',
    aliases: [
      'alt phone',
      'alt. phone',
      'alt phone number',
      'alternate phone',
      'alternate phone number',
      'alternative phone',
      'alternative phone number',
      'second phone',
      'second phone number',
      'other phone number',
      'whatsapp',
      'whatsapp number',
    ],
  },
  {
    key: 'email',
    label: 'Email address',
    aliases: ['email', 'e-mail', 'email address'],
  },
  {
    key: 'region',
    label: 'Region / State',
    aliases: ['region', 'region/state', 'state', 'state/region', 'province'],
  },
  {
    key: 'streetAddress',
    label: 'Delivery address',
    aliases: [
      'address',
      'street address',
      'delivery address',
      'shipping address',
      'home address',
      'house address',
      'residential address',
      'full address',
    ],
  },
];

// Field types the builder emits 1:1 onto a standard key, used as the last
// inference step for a field whose label matches no alias. Only unambiguous
// types are listed: `phone` covers both phone and alt phone, and
// `text`/`textarea` can be anything.
const TYPE_TO_STANDARD_KEY: Partial<Record<FieldType, StandardFieldKey>> = {
  email: 'email',
  state: 'region',
};

export function getStandardFieldMeta(
  key: StandardFieldKey | null | undefined
): StandardFieldMeta | undefined {
  return key ? STANDARD_FIELDS.find((c) => c.key === key) : undefined;
}

/** Lowercase, drop the required marker and trailing colon, collapse whitespace. */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves one field's destination: explicit `standardKey` first, then label
 * alias, then the field's own type. Returns null for a custom field.
 */
export function resolveStandardKey(field: FormField): StandardFieldKey | null {
  if (field.standardKey) {
    return field.standardKey === 'custom' ? null : field.standardKey;
  }
  const normalized = normalizeLabel(field.label);
  const byAlias = STANDARD_FIELDS.find((c) => c.aliases.includes(normalized));
  if (byAlias) return byAlias.key;
  return TYPE_TO_STANDARD_KEY[field.type] ?? null;
}

export interface MappedField {
  field: FormField;
  standardKey: StandardFieldKey | null;
  /** react-hook-form path: a standard key, or a `customFields.<label>` path. */
  formKey: string;
}

/**
 * Maps every field to its destination in one pass.
 *
 * A standard key is claimed by the first field that resolves to it; a later
 * field resolving to the same key is demoted to a custom field rather than
 * silently overwriting the first one's value.
 */
export function mapFields(fields: FormField[]): MappedField[] {
  const claimed = new Set<StandardFieldKey>();
  return fields.map((field) => {
    const resolved = resolveStandardKey(field);
    const standardKey = resolved && !claimed.has(resolved) ? resolved : null;
    if (standardKey) claimed.add(standardKey);
    return {
      field,
      standardKey,
      formKey: standardKey ?? `customFields.${field.label}`,
    };
  });
}

// Slots the order API rejects the submission without. Mirrors the required-field
// check in backend/src/controllers/publicOrderController.ts — if that list
// changes, change this one.
const REQUIRED_PHYSICAL: StandardFieldKey[] = ['fullName', 'phone', 'streetAddress', 'region'];
const REQUIRED_DIGITAL: StandardFieldKey[] = ['fullName', 'phone', 'email'];

/**
 * Standard slots no enabled field feeds. A non-empty result means the form
 * cannot produce a valid order: the server will reject every submission.
 */
export function findMissingRequiredKeys(
  fields: FormField[],
  opts: { isDigital?: boolean } = {}
): StandardFieldKey[] {
  const enabled = fields.filter((f) => f.enabled !== false);
  const present = new Set(mapFields(enabled).map((m) => m.standardKey).filter(Boolean));
  const required = opts.isDigital ? REQUIRED_DIGITAL : REQUIRED_PHYSICAL;
  return required.filter((key) => !present.has(key));
}
