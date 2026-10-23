import type { FormField, StandardFieldKey } from '../types/checkout-form';

/**
 * The fields of a new checkout form. Destinations are pinned via standardKey so relabelling any of these keeps the
 * value flowing to the order. The server refuses to switch a physical form on without a street address (F-411), so it
 * starts on; email is off until the seller turns it on.
 */
export const NEW_FORM_FIELDS: FormField[] = [
  { id: 'fullName', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
  { id: 'phone', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
  { id: 'region', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' },
  { id: 'town', label: 'City or town', type: 'text', required: true, enabled: true, standardKey: 'town' },
  { id: 'landmark', label: 'Nearest landmark', type: 'text', required: true, enabled: true, standardKey: 'landmark' },
  { id: 'email', label: 'Email Address', type: 'email', required: false, enabled: false, standardKey: 'email' },
  { id: 'streetAddress', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
];

// What the public form shows for a saved form with no fields at all (forms from before the builder). It keeps its old
// wording and asks no street address, so those forms render as they always did. Only the differences are listed.
const LEGACY_EMPTY_FORM: Partial<Record<StandardFieldKey, Partial<FormField>>> = {
  region: { label: 'State', type: 'select' },
  town: { label: 'City/Town' },
  streetAddress: { label: 'Street Address', required: false, enabled: false },
};

export const LEGACY_EMPTY_FORM_FIELDS: FormField[] = NEW_FORM_FIELDS.map((f) => ({
  ...f,
  ...(f.standardKey && f.standardKey !== 'custom' ? LEGACY_EMPTY_FORM[f.standardKey] : undefined),
}));
