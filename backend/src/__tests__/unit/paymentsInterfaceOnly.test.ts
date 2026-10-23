/**
 * M3b-T03: the checkout controller, the settlement service, the verify route and the settings service reach a payment
 * provider through the PaymentProvider interface only. None of them imports paystackService.
 * CodAdmin's own subscription billing (platformPaystackService) is a different account and is out of scope.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const src = path.join(__dirname, '..', '..');
const files = [
  'controllers/publicOrderController.ts',
  'controllers/checkoutFormController.ts',
  'controllers/paystackController.ts', // thin route layer: webhook, verify, admin verify
  'services/paystackSettlementService.ts',
  'services/adminService.ts', // seller payment settings (cache invalidation)
  'routes/paystackRoutes.ts',
];

describe('payment code outside the adapter', () => {
  it.each(files)('%s does not import paystackService', (file) => {
    const text = fs.readFileSync(path.join(src, file), 'utf8');
    expect(text).not.toMatch(/from\s+['"][^'"]*\/paystackService['"]/);
    expect(text).not.toMatch(/import\(\s*['"][^'"]*\/paystackService['"]\s*\)/);
    expect(text).not.toMatch(/require\(\s*['"][^'"]*\/paystackService['"]\s*\)/);
  });

  it('only the Paystack adapter and its own tests import paystackService', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && /from\s+['"][^'"]*\/paystackService['"]/.test(fs.readFileSync(full, 'utf8'))) {
          importers.push(path.relative(src, full));
        }
      }
    };
    walk(src);
    expect(importers).toEqual(['services/payments/paystackAdapter.ts']);
  });
});
