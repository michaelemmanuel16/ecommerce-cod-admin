import * as fs from 'fs';
import * as path from 'path';

// F-154 money fields (M0-T21). Not in the list on purpose: User.deliveryRate (removed, F1)
// and Product.weight (not money).
const F154: Record<string, string[]> = {
  Tenant: ['defaultDeliveryFee'],
  User: ['commissionAmount', 'totalEarnings'],
  Customer: ['totalSpent'],
  Product: ['price'],
  Order: ['subtotal', 'shippingCost', 'discount', 'totalAmount', 'codAmount', 'depositPaid', 'balanceDue'],
  OrderItem: ['unitPrice', 'totalPrice'],
  Transaction: ['amount'],
  Expense: ['amount'],
  FormPackage: ['price', 'discountValue', 'originalPrice'],
  FormUpsell: ['price', 'discountValue', 'originalPrice'],
  FormSubmission: ['totalAmount'],
  PendingCheckout: ['subtotal', 'shippingCost', 'discount', 'totalAmount', 'codAmount', 'balanceDue'],
  Payout: ['amount'],
  product_cost_entries: ['amount'],
};

function parseModels(schema: string): Record<string, Record<string, string>> {
  const models: Record<string, Record<string, string>> = {};
  let cur: string | null = null;
  for (const line of schema.split('\n')) {
    const m = line.match(/^model (\w+) \{/);
    if (m) { cur = m[1]; models[cur] = {}; continue; }
    if (line.startsWith('}')) { cur = null; continue; }
    if (cur) {
      const f = line.match(/^\s+(\w+)\s+(\w+\??)(.*)$/);
      if (f && !line.trim().startsWith('@@') && !line.trim().startsWith('//')) models[cur][f[1]] = `${f[2]}${f[3]}`;
    }
  }
  return models;
}

describe('schema.prisma money columns (F-154)', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const models = parseModels(schema);

  it('has no Float or Int on any F-154 field; all are Decimal(19, 4)', () => {
    const bad: string[] = [];
    for (const [model, fields] of Object.entries(F154)) {
      for (const field of fields) {
        const def = models[model]?.[field];
        if (!def) { bad.push(`${model}.${field} missing`); continue; }
        if (/^Float/.test(def)) bad.push(`${model}.${field} is Float`);
        else if (!/^Decimal\??\s/.test(def) || !def.includes('@db.Decimal(19, 4)')) bad.push(`${model}.${field}: ${def}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps only the two non-money Float fields', () => {
    const floats: string[] = [];
    for (const [model, fields] of Object.entries(models)) {
      for (const [field, def] of Object.entries(fields)) if (/^Float/.test(def)) floats.push(`${model}.${field}`);
    }
    expect(floats.sort()).toEqual(['Product.weight', 'User.deliveryRate']);
  });
});
