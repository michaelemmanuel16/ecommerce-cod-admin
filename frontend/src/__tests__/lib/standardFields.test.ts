import { describe, it, expect } from 'vitest';
import { FormField } from '../../types/checkout-form';
import { findMissingRequiredKeys, mapFields, resolveStandardKey } from '../../lib/standardFields';

function field(overrides: Partial<FormField> & { label: string }): FormField {
  return {
    id: overrides.label,
    type: 'text',
    required: false,
    enabled: true,
    ...overrides,
  };
}

describe('resolveStandardKey', () => {
  // The bug this whole module exists for: a tenant labelled their address field
  // "Delivery Address", it matched no alias, the value went to customFields, and
  // every order they took was rejected for a missing address.
  it('maps address labels merchants actually use', () => {
    for (const label of [
      'Street Address',
      'Delivery Address',
      'Shipping Address',
      'House Address',
      'Address',
    ]) {
      expect(resolveStandardKey(field({ label, type: 'textarea' }))).toBe('streetAddress');
    }
  });

  it('maps a WhatsApp number to the alternate phone slot', () => {
    expect(resolveStandardKey(field({ label: 'Whatsapp Number', type: 'phone' }))).toBe(
      'alternativePhone'
    );
  });

  it('ignores case, trailing colons and required markers on the label', () => {
    expect(resolveStandardKey(field({ label: '  DELIVERY ADDRESS: *' }))).toBe('streetAddress');
  });

  it('prefers an explicit standardKey over the label', () => {
    const f = field({ label: 'Where should we drop it?', standardKey: 'streetAddress' });
    expect(resolveStandardKey(f)).toBe('streetAddress');
  });

  it("honours 'custom' as a pin, even on a label that would otherwise match", () => {
    expect(resolveStandardKey(field({ label: 'Address', standardKey: 'custom' }))).toBeNull();
  });

  it('falls back to the field type when the label matches nothing', () => {
    expect(resolveStandardKey(field({ label: 'Where do you live?', type: 'state' }))).toBe('region');
    expect(resolveStandardKey(field({ label: 'Contact me at', type: 'email' }))).toBe('email');
  });

  it('leaves genuinely custom fields unmapped', () => {
    expect(resolveStandardKey(field({ label: 'How did you hear about us?' }))).toBeNull();
    // "City" is deliberately not a region alias — a form may carry both.
    expect(resolveStandardKey(field({ label: 'City' }))).toBeNull();
  });
});

describe('mapFields', () => {
  it('routes standard fields to payload keys and the rest to customFields', () => {
    const mapped = mapFields([
      field({ label: 'Full Name' }),
      field({ label: 'Delivery Address', type: 'textarea' }),
      field({ label: 'How did you hear about us?' }),
    ]);

    expect(mapped.map((m) => m.formKey)).toEqual([
      'fullName',
      'streetAddress',
      'customFields.How did you hear about us?',
    ]);
  });

  it('gives a standard slot to the first claimant and demotes later duplicates', () => {
    const mapped = mapFields([
      field({ label: 'Phone Number', type: 'phone' }),
      field({ label: 'Phone', type: 'phone' }),
    ]);

    // Without this, the second field would overwrite the first buyer's number.
    expect(mapped[0].standardKey).toBe('phone');
    expect(mapped[1].standardKey).toBeNull();
    expect(mapped[1].formKey).toBe('customFields.Phone');
  });
});

describe('findMissingRequiredKeys', () => {
  const physicalFields = [
    field({ label: 'Full Name' }),
    field({ label: 'Phone', type: 'phone' }),
    field({ label: 'Delivery Address', type: 'textarea' }),
    field({ label: 'Region', type: 'state' }),
  ];

  it('passes a form that feeds every required slot', () => {
    expect(findMissingRequiredKeys(physicalFields)).toEqual([]);
  });

  it('flags the slot a mislabelled field left empty', () => {
    const broken = physicalFields.map((f) =>
      f.label === 'Delivery Address' ? { ...f, standardKey: 'custom' as const } : f
    );
    expect(findMissingRequiredKeys(broken)).toEqual(['streetAddress']);
  });

  it('ignores disabled fields', () => {
    const disabled = physicalFields.map((f) =>
      f.label === 'Region' ? { ...f, enabled: false } : f
    );
    expect(findMissingRequiredKeys(disabled)).toEqual(['region']);
  });

  it('requires email but not address for digital products', () => {
    expect(findMissingRequiredKeys(physicalFields, { isDigital: true })).toEqual(['email']);
  });
});
