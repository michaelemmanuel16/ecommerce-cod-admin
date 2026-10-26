/**
 * Fixture checks for product delivered units (M1-T20, F-610), 1 to 17 October 2026.
 * `productsFixtureChecks` declares describe/it blocks; kpiContract.test.ts (which seeds once) calls it.
 */
import { describe, it, expect } from '@jest/globals';
import { prismaBase } from '../../../utils/prisma';
import { productDeliveredUnits } from '../../../services/kpi/products';
import { deliveredRevenue } from '../../../services/kpi/revenue';
import { endOfDay, getStoreTimeZone, startOfDay } from '../../../services/kpi/dates';

const zone = getStoreTimeZone();
const from = startOfDay('2026-10-01', zone);
const to = endOfDay('2026-10-17', zone);

export function productsFixtureChecks(getTenantId: () => string): void {
  describe('product delivered units on the fixture (M1-T20)', () => {
    it('copybook set 306, refill pens 172, grip trainer 89, guide 58, Dictamni cream 10', async () => {
      const all = await productDeliveredUnits(getTenantId(), 'all', from, to);
      const bySku = Object.fromEntries((all.byProduct ?? []).map((p) => [p.sku, p.units]));
      expect(bySku).toEqual({ 'MG-COPYBOOK-SET': 306, 'MG-REFILL-PENS': 172, 'MG-GRIP-TRAINER': 89, 'MG-PARENT-GUIDE': 58, 'DT-CREAM': 10 });
    });

    it('product costs give margins 88 / 70 / 69 / 95, and the average margin 86 over the four products of the Products table', async () => {
      const products = await prismaBase.product.findMany({ where: { tenantId: getTenantId() } });
      const all = await productDeliveredUnits(getTenantId(), 'all', from, to);
      const units = Object.fromEntries((all.byProduct ?? []).map((p) => [p.sku, p.units]));
      const margin = (sku: string) => { const p = products.find((x) => x.sku === sku)!; return Math.round(((Number(p.price) - Number(p.cogs)) / Number(p.price)) * 100); };
      expect(['MG-COPYBOOK-SET', 'MG-REFILL-PENS', 'MG-GRIP-TRAINER', 'MG-PARENT-GUIDE'].map(margin)).toEqual([88, 70, 69, 95]);
      // Revenue-weighted: sum(units x (price - cost)) / sum(units x price). The Dictamni cream is not in the Products table (and has no cost here).
      const weighted = (skus: string[]) => {
        const rows = skus.map((sku) => ({ u: Number(units[sku]), p: Number(products.find((x) => x.sku === sku)!.price), c: Number(products.find((x) => x.sku === sku)!.cogs) }));
        return Math.round((rows.reduce((s, r) => s + r.u * (r.p - r.c), 0) / rows.reduce((s, r) => s + r.u * r.p, 0)) * 100);
      };
      expect(weighted(['MG-COPYBOOK-SET', 'MG-REFILL-PENS', 'MG-GRIP-TRAINER', 'MG-PARENT-GUIDE'])).toBe(86);
      expect(weighted(['MG-COPYBOOK-SET', 'MG-REFILL-PENS', 'MG-GRIP-TRAINER', 'MG-PARENT-GUIDE', 'DT-CREAM'])).toBe(87);
    });

    it('gives the same number for one product as the all-products row', async () => {
      const set = await prismaBase.product.findFirstOrThrow({ where: { tenantId: getTenantId(), sku: 'MG-COPYBOOK-SET' } });
      expect((await productDeliveredUnits(getTenantId(), set.id, from, to)).units.value).toBe(306);
    });

    it('line revenue uses the real prices: 306 x 249 = 76,194.00 (not the mockup 76,100)', async () => {
      const all = await productDeliveredUnits(getTenantId(), 'all', from, to);
      const line = Object.fromEntries((all.byProduct ?? []).map((p) => [p.sku, p.lineRevenue]));
      expect(line['MG-COPYBOOK-SET']).toBe('76194.00');
      expect(line['MG-REFILL-PENS']).toBe('6880.00');
      expect(line['MG-GRIP-TRAINER']).toBe('3115.00');
      expect(line['MG-PARENT-GUIDE']).toBe('3422.00');
      expect(line['DT-CREAM']).toBe('2500.00');
    });

    it('376 delivered orders contain 635 item units (two facts, never compared)', async () => {
      const orders = (await deliveredRevenue(getTenantId(), from, to)).deliveredOrders.value;
      const units = (await productDeliveredUnits(getTenantId(), 'all', from, to)).units.value;
      expect(orders).toBe(376);
      expect(units).toBe(635);
    });
  });
}
