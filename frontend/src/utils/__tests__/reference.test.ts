import { describe, it, expect } from 'vitest';
import { State } from 'country-state-city';
import { getRegionsForCountry, SUPPORTED_CURRENCIES, getCurrencyOptionLabel, getCurrencySymbol } from '../countries';
import { ORDER_STATUS_LABELS } from '../orderStatus';
import { ORDER_STATUS_CONFIG } from '../constants';
import settingsSource from '../../pages/Settings.tsx?raw';
import onboardingSource from '../../pages/Onboarding.tsx?raw';

// M1-T03. The GH and NG counts are the same as backend/src/__tests__/unit/regions.test.ts. If the two
// packages drift to different country-state-city versions, one of the two tests fails.
describe('getRegionsForCountry', () => {
  it.each([
    ['Ghana', 'GH', 16],
    ['Nigeria', 'NG', 37],
  ])('%s returns %i unique regions from the library', (name, code, count) => {
    const regions = getRegionsForCountry(name);
    expect(regions).toEqual(State.getStatesOfCountry(code).map((s) => s.name));
    expect(regions).toHaveLength(count);
    expect(new Set(regions).size).toBe(count);
  });
});

describe('currency list', () => {
  it('has the 15 codes of F-1232 with no duplicates', () => {
    expect([...SUPPORTED_CURRENCIES]).toEqual([
      'USD', 'GHS', 'NGN', 'KES', 'ZAR', 'UGX', 'TZS', 'RWF', 'ETB', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY',
    ]);
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(15);
  });

  it('gives every code a name and a symbol', () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(getCurrencyOptionLabel(c)).toMatch(new RegExp(`^${c} - .+ \\(.+\\)$`));
      expect(getCurrencySymbol(c)).toBeTruthy();
    }
  });

  it('Settings reads the one list and keeps no list of its own', () => {
    expect(settingsSource).toContain('SUPPORTED_CURRENCIES.map');
    expect(settingsSource).toMatch(/import \{[^}]*SUPPORTED_CURRENCIES[^}]*\} from '..\/utils\/countries'/);
    expect(settingsSource).not.toMatch(/<option value="(USD|GHS|NGN|KES|EUR|GBP|INR|CAD|AUD|JPY)"/);
  });

  // M3-T67: the wizard has no currency picker. The currency follows the country; Settings changes it later.
  it('Onboarding keeps no currency list of its own', () => {
    expect(onboardingSource).not.toMatch(/<option value="(USD|GHS|NGN|KES|EUR|GBP|INR|CAD|AUD|JPY)"/);
  });
});

describe('order status labels', () => {
  const backendStatuses = [
    'pending_confirmation', 'payment_pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery',
    'delivered', 'digital_delivered', 'cancelled', 'returned', 'failed_delivery', 'payment_failed',
  ];

  it('has one label for each of the 12 backend statuses', () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...backendStatuses].sort());
    for (const label of Object.values(ORDER_STATUS_LABELS)) expect(label).toBeTruthy();
  });

  it('ORDER_STATUS_CONFIG takes its labels from the same map', () => {
    for (const status of backendStatuses) {
      expect(ORDER_STATUS_CONFIG[status as keyof typeof ORDER_STATUS_CONFIG].label).toBe(
        ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]
      );
    }
  });
});
