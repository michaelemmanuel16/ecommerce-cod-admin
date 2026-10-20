import { describe, it, expect } from '@jest/globals';
import { normalizePhone, formatPhoneLocal, phoneLookupVariants, looksLikePhone, phoneSearchConditions, phonePartialDigits, customerPhoneSearch, normalizePhoneForStorage } from '../../utils/phone';

describe('normalizePhone (M1-T04)', () => {
  it.each([
    '024 555 0103',
    '0245550103',
    '245550103',
    '233245550103',
    '+233245550103',
    '024-555-0103',
    '(024) 555-0103',
    '+233 24 555 0103',
    '00233245550103',
    '+2330245550103',
    '  0245550103  ',
  ])('GH input %s gives +233245550103', (input) => {
    expect(normalizePhone(input)).toBe('+233245550103');
  });

  it('handles Nigerian numbers', () => {
    expect(normalizePhone('07058824150', 'NG')).toBe('+2347058824150');
    expect(normalizePhone('7058824150', 'NG')).toBe('+2347058824150');
    expect(normalizePhone('0705 882 4150', 'NG')).toBe('+2347058824150');
  });

  it('keeps the country of an international number whatever the default is', () => {
    expect(normalizePhone('+2347058824150')).toBe('+2347058824150');
    expect(normalizePhone('2347058824150')).toBe('+2347058824150');
    expect(normalizePhone('+233245550103', 'NG')).toBe('+233245550103');
  });

  it.each([null, undefined, '', '   ', 'Hallo die Conny', '024 555 01x3', '12345', '024555010', '02455501034', '+2335550103', '0000000000', '++233245550103', '0245550103 ext 5'])(
    'garbage %p gives null',
    (input) => {
      expect(normalizePhone(input as any)).toBeNull();
    }
  );

  it('is idempotent', () => {
    const once = normalizePhone('0245550103')!;
    expect(normalizePhone(once)).toBe(once);
  });
});

describe('formatPhoneLocal', () => {
  it('formats GH and NG', () => {
    expect(formatPhoneLocal('+233245550103')).toBe('024 555 0103');
    expect(formatPhoneLocal('+2347058824150')).toBe('0705 882 4150');
  });
  it('returns unknown input unchanged', () => {
    expect(formatPhoneLocal('Hallo die Conny')).toBe('Hallo die Conny');
    expect(formatPhoneLocal('+14155550100')).toBe('+14155550100');
  });
});

describe('phoneLookupVariants', () => {
  it('lists the normalized value and every old stored form', () => {
    const variants = phoneLookupVariants('024 555 0103');
    expect(variants).toEqual(expect.arrayContaining(['+233245550103', '0245550103', '233245550103', '245550103']));
    expect(phoneLookupVariants('+233245550103')).toEqual(expect.arrayContaining(['0245550103']));
  });
  it('returns the raw input for unparseable values and nothing for empty', () => {
    expect(phoneLookupVariants(' Hallo die Conny ')).toEqual(['Hallo die Conny']);
    expect(phoneLookupVariants('')).toEqual([]);
    expect(phoneLookupVariants(null)).toEqual([]);
  });
});

describe('phone search helpers', () => {
  it('detects phone-like terms', () => {
    expect(looksLikePhone('0245550103')).toBe(true);
    expect(looksLikePhone('+233 24 555 0103')).toBe(true);
    expect(looksLikePhone('Kofi')).toBe(false);
    expect(looksLikePhone('123')).toBe(false);
  });
  it('adds variant matching only for phone-like terms', () => {
    expect(phoneSearchConditions('Kofi')).toEqual([]); // name search: no phone conditions
    expect(customerPhoneSearch('Kofi')).toBeNull();
    expect(customerPhoneSearch('0245550103')?.customer.OR).toHaveLength(3);
    const conds = phoneSearchConditions('0245550103');
    expect(conds).toHaveLength(3);
    expect(conds[1]).toEqual({ phoneNumber: { contains: '245550103' } });
    expect(conds[2]).toEqual({ phoneNumber: { in: expect.arrayContaining(['+233245550103']) } });
  });

  it('partial local number also matches the normalized form', () => {
    expect(phonePartialDigits('02455')).toBe('2455');
    expect(phonePartialDigits('024 55')).toBe('2455');
    expect(phonePartialDigits('2455')).toBeNull();
    expect(phonePartialDigits('Kofi 024')).toBeNull();
    expect(phoneSearchConditions('0245')).toEqual([
      { phoneNumber: { contains: '0245' } },
      { phoneNumber: { contains: '245' } },
    ]);
  });
});

describe('normalizePhoneForStorage', () => {
  it('passes null, undefined and empty through unchanged', () => {
    expect(normalizePhoneForStorage(null)).toBeNull();
    expect(normalizePhoneForStorage(undefined)).toBeUndefined();
    expect(normalizePhoneForStorage('')).toBe('');
  });
  it('normalizes parseable input and keeps odd input trimmed', () => {
    expect(normalizePhoneForStorage('024 555 0103')).toBe('+233245550103');
    expect(normalizePhoneForStorage(' Hallo ')).toBe('Hallo');
  });
});
