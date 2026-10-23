import { describe, it, expect } from '@jest/globals';
import { deliveryAddressOf, slotRule } from '../../utils/checkoutLocation';

describe('slotRule (COD-138)', () => {
  it('a form with no fields uses the new defaults', () => {
    expect(slotRule([], 'town')).toBe('required');
    expect(slotRule(null, 'landmark')).toBe('required');
    expect(slotRule([], 'streetAddress')).toBe('off');
  });
  it('a form saved before town/landmark existed asks for both and keeps its required address', () => {
    const old = [
      { label: 'Region/State', standardKey: 'region', required: true, enabled: true },
      { label: 'Street Address', standardKey: 'streetAddress', required: true, enabled: true },
    ];
    expect(slotRule(old, 'town')).toBe('required');
    expect(slotRule(old, 'landmark')).toBe('required');
    expect(slotRule(old, 'streetAddress')).toBe('required');
  });
  it('honours enabled and required on the saved field, and label aliases', () => {
    expect(slotRule([{ label: 'City/Town', standardKey: 'town', enabled: false }], 'town')).toBe('off');
    expect(slotRule([{ label: 'Nearest landmark', standardKey: 'landmark', required: false, enabled: true }], 'landmark')).toBe('optional');
    expect(slotRule([{ label: 'Delivery Address', type: 'textarea', required: true, enabled: true }], 'streetAddress')).toBe('required');
  });
});

describe('deliveryAddressOf', () => {
  it('joins the non-empty parts', () => {
    expect(deliveryAddressOf('12 High St', 'Near the mall')).toBe('12 High St, Near the mall');
    expect(deliveryAddressOf('', 'Near the mall')).toBe('Near the mall');
    expect(deliveryAddressOf(undefined, '  ')).toBeNull();
  });
});
