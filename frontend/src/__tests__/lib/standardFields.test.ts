import { describe, it, expect } from 'vitest';
import { FormField } from '../../types/checkout-form';
import { STANDARD_FIELDS, mapFields, missingKeysMessage, missingRequiredLabels, resolveStandardKey } from '../../lib/standardFields';

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

  it('maps the town and landmark labels (COD-138)', () => {
    for (const label of ['City/Town', 'City', 'Town or area']) {
      expect(resolveStandardKey(field({ label }))).toBe('town');
    }
    expect(resolveStandardKey(field({ label: 'Nearest landmark' }))).toBe('landmark');
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
    expect(resolveStandardKey(field({ label: 'Favourite colour' }))).toBeNull();
    // "City" is the town slot, never the state slot — a form may carry both.
    expect(resolveStandardKey(field({ label: 'City' }))).toBe('town');
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

describe('missingRequiredLabels', () => {
  const physicalFields = [
    field({ label: 'Full Name' }),
    field({ label: 'Phone', type: 'phone' }),
    field({ label: 'Delivery Address', type: 'textarea' }),
    field({ label: 'Region', type: 'state' }),
  ];

  it('passes a form that feeds every required slot', () => {
    expect(missingRequiredLabels(physicalFields, 'physical')).toEqual([]);
  });

  it('names the slot a mislabelled field left empty', () => {
    const broken = physicalFields.map((f) =>
      f.label === 'Full Name' ? { ...f, standardKey: 'custom' as const } : f
    );
    expect(missingRequiredLabels(broken, 'physical')).toEqual(['Name']);
  });

  it('ignores disabled fields', () => {
    const disabled = physicalFields.map((f) =>
      f.label === 'Region' ? { ...f, enabled: false } : f
    );
    expect(missingRequiredLabels(disabled, 'physical')).toEqual(['State']);
  });

  it('requires a street address for a physical form but email instead for a digital one', () => {
    const noAddress = physicalFields.filter((f) => f.label !== 'Delivery Address');
    expect(missingRequiredLabels(noAddress, 'physical')).toEqual(['Street address']);
    expect(missingRequiredLabels(noAddress, 'digital')).toEqual(['Email']);
  });

  it('matches by "Sends to" first, then by label alias, then by field type', () => {
    expect(
      missingRequiredLabels(
        [
          field({ label: 'Who are you', standardKey: 'fullName' }),
          field({ label: 'Mobile', type: 'phone' }),
          field({ label: 'Where', type: 'state' }),
          field({ label: 'Anything', standardKey: 'streetAddress' }),
        ],
        'physical'
      )
    ).toEqual([]);
  });

  it('treats an empty field list as the platform defaults: nothing missing', () => {
    expect(missingRequiredLabels([], 'physical')).toEqual([]);
  });
});

describe('missingKeysMessage', () => {
  it("gives the server's sentence", () => {
    expect(missingKeysMessage([field({ label: 'Full Name' })], 'physical')).toBe(
      "This form can't take orders yet. Add: Phone number, Street address, State."
    );
  });

  it('is null when nothing is missing', () => {
    expect(missingKeysMessage([], 'physical')).toBeNull();
  });
});

describe('Sends to options', () => {
  it('has the notes slot and no label inference for it', () => {
    expect(STANDARD_FIELDS.map((f) => f.label)).toEqual(
      expect.arrayContaining(['Customer name', 'Phone', 'Alternate phone', 'Email', 'Region', 'City or town', 'Street address', 'Order notes'])
    );
    expect(resolveStandardKey(field({ label: 'Notes' }))).toBeNull();
    expect(resolveStandardKey(field({ label: 'Anything', standardKey: 'notes' }))).toBe('notes');
  });
});
