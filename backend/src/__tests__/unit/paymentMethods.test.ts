/** M3b-T05 (F-400, F-402, F-423): method names, the method matrix (form type x flag), and the dropped delivery fee column. */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { methodMatrix, normalizeMethod, isOnlineMethod } from '../../services/payments';

describe('methodMatrix', () => {
  // [form type, prepaidPhysical flag, cod, online_deposit, online_full]
  it.each([
    ['physical', false, true, false, false],
    ['physical', true, true, true, true],
    ['digital', false, false, false, true],
    ['digital', true, false, false, true],
  ] as const)('%s form, prepaidPhysical %s: cod %s, deposit %s, full %s', (type, flag, cod, deposit, full) => {
    expect(methodMatrix(type, flag)).toEqual({ cod, online_deposit: deposit, online_full: full });
  });
});

describe('normalizeMethod', () => {
  it('keeps the neutral names', () => {
    expect(normalizeMethod('cod')).toBe('cod');
    expect(normalizeMethod('online_full')).toBe('online_full');
    expect(normalizeMethod('online_deposit')).toBe('online_deposit');
  });

  it('reads the old names', () => {
    expect(normalizeMethod('paystack')).toBe('online_full');
    expect(normalizeMethod('paystack_full')).toBe('online_full');
    expect(normalizeMethod('paystack_deposit')).toBe('online_deposit');
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'card', 'COD', undefined, null, 5, {}]) expect(normalizeMethod(bad)).toBeNull();
  });

  it('knows which methods are online', () => {
    expect(isOnlineMethod('cod')).toBe(false);
    expect(isOnlineMethod('online_deposit')).toBe(true);
  });
});

describe('Tenant.defaultDeliveryFee (F-423)', () => {
  const root = path.join(__dirname, '..', '..', '..');
  it('is gone from the schema', () => {
    expect(fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')).not.toMatch(/defaultDeliveryFee|default_delivery_fee/);
  });

  it('no source file reads it', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.ts') && !full.endsWith('paymentMethods.test.ts') && /defaultDeliveryFee|default_delivery_fee/.test(fs.readFileSync(full, 'utf8'))) hits.push(full);
      }
    };
    walk(path.join(root, 'src'));
    expect(hits).toEqual([]);
  });
});
