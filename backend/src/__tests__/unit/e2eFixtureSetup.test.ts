import { refusal, undoFixtureRows } from '../../../scripts/e2e-fixture-setup';

describe('e2e fixture setup guard (M4-T30)', () => {
  const local = 'postgresql://u:p@localhost:5432/ecommerce_cod_test_b';

  it('allows a local test database outside production', () => {
    expect(refusal(local, 'development')).toBeNull();
    expect(refusal(local, undefined)).toBeNull();
  });

  it('refuses production, a missing url, a bad url, a remote host and a database that is not a test database', () => {
    expect(refusal(local, 'production')).toMatch(/production/);
    expect(refusal(undefined, 'test')).toMatch(/not set/);
    expect(refusal('nonsense', 'test')).toMatch(/not a valid URL/);
    expect(refusal('postgresql://u:p@db.example.com:5432/ecommerce_cod_test_b', 'test')).toMatch(/not local/);
    expect(refusal('postgresql://u:p@localhost:5432/ecommerce_cod', 'test')).toMatch(/not a test database/);
    expect(refusal('postgresql://u:p@localhost:5432/ecommerce_cod_m3copy', 'test')).toMatch(/not a test database/);
  });
});

describe('e2e fixture undo (COD-46 follow-up)', () => {
  it('deletes checkout data children first, every delete scoped to the fixture tenant', async () => {
    const calls: Array<{ model: string; args: any }> = [];
    const del = (model: string) => ({
      deleteMany: jest.fn(async (args: any) => {
        calls.push({ model, args });
        return { count: 1 };
      }),
    });
    const prisma: any = {};
    for (const m of ['delivery', 'deliveryPartnerProfile', 'notification', 'formSubmission', 'pendingCheckout', 'formPackage', 'formUpsell', 'checkoutForm']) prisma[m] = del(m);

    const message = await undoFixtureRows(prisma, 'tenant-1');

    const order = calls.map((c) => c.model);
    expect(order.indexOf('formSubmission')).toBeLessThan(order.indexOf('checkoutForm'));
    expect(order.indexOf('pendingCheckout')).toBeLessThan(order.indexOf('checkoutForm'));
    expect(order.indexOf('formPackage')).toBeLessThan(order.indexOf('checkoutForm'));
    expect(order.indexOf('formUpsell')).toBeLessThan(order.indexOf('checkoutForm'));
    expect(order.indexOf('formSubmission')).toBeLessThan(order.indexOf('formPackage'));
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      const scoped = ['formPackage', 'formUpsell'].includes(c.model) ? c.args.where.form : c.args.where;
      expect(scoped).toEqual({ tenantId: 'tenant-1' });
    }
    expect(message).toMatch(/1 form submissions, 1 pending checkouts, 1 packages, 1 upsells and 1 checkout forms/);
  });
});
