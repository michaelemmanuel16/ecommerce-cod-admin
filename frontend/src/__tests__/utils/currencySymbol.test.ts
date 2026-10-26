import { describe, it, expect } from 'vitest';
import { currencySymbol } from '../../utils/format';
import { useConfigStore } from '../../stores/configStore';

describe('currencySymbol (M5 UI fix 19)', () => {
  it('is the sign alone, the one formatCurrency writes', () => {
    expect(currencySymbol('GHS')).toBe('GH₵');
    expect(currencySymbol('NGN')).toBe('₦');
  });

  it('defaults to the store currency, and an unknown code never throws', () => {
    useConfigStore.setState({ currency: 'GHS' });
    expect(currencySymbol()).toBe('GH₵');
    expect(currencySymbol('not a code')).toBe('not a code');
  });
});
