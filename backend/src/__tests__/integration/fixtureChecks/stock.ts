/**
 * M4-T05 fixture checks: the stock of docs/mockups/v2/inventory.html (F-652, F-653, F-656, F-606), read with SQL.
 * Called from numbersFixture.test.ts, which seeds once. Declares describe/it blocks only.
 */
import { describe, it, expect } from '@jest/globals';
import { prismaBase } from '../../../utils/prisma';

/** Statuses whose units are reserved at the holder (F-651). */
const OPEN_STATUSES = "('confirmed','preparing','ready_for_pickup','out_for_delivery')";

export function stockFixtureChecks(getTenantId: () => string): void {
  describe('stock fixture (M4-T05)', () => {
    const rows = <T>(sql: string) => prismaBase.$queryRawUnsafe<T[]>(sql, getTenantId());
    const byName = (list: Array<{ k: string; n: bigint | string }>) => Object.fromEntries(list.map((r) => [r.k, Number(r.n)]));

    it('on hand: Logiswift 200 / 62 / 180 (442), Kofi 36 / 18 / 45 (99)', async () => {
      const level = byName(await rows(`
        SELECT l.name || ' ' || p.sku AS k, s.quantity AS n FROM stock_levels s
        JOIN stock_locations l ON l.id = s.location_id JOIN products p ON p.id = s.product_id WHERE s.tenant_id = $1`));
      expect(level).toEqual({
        'Logiswift MG-COPYBOOK-SET': 200, 'Logiswift MG-REFILL-PENS': 62, 'Logiswift MG-GRIP-TRAINER': 180,
        'Kofi Appiah MG-COPYBOOK-SET': 36, 'Kofi Appiah MG-REFILL-PENS': 18, 'Kofi Appiah MG-GRIP-TRAINER': 45,
      });
      const total = byName(await rows(`
        SELECT l.name AS k, SUM(s.quantity) AS n FROM stock_levels s JOIN stock_locations l ON l.id = s.location_id WHERE s.tenant_id = $1 GROUP BY 1`));
      expect(total).toEqual({ Logiswift: 442, 'Kofi Appiah': 99 });
    });

    it('Product.stockQuantity is the sum of on-hand over the locations', async () => {
      const cache = await rows<{ sku: string; stock_quantity: number; levels: bigint }>(`
        SELECT p.sku, p.stock_quantity, COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.product_id = p.id), 0) AS levels
        FROM products p WHERE p.tenant_id = $1`);
      for (const r of cache) expect([r.sku, r.stock_quantity]).toEqual([r.sku, Number(r.levels)]);
    });

    it('has the five partner locations of the fixture, linked to their users, plus the in-transit location', async () => {
      const locs = await rows<{ name: string; type: string; first_name: string | null }>(`
        SELECT l.name, l.type::text, u.first_name FROM stock_locations l LEFT JOIN users u ON u.id = l.user_id WHERE l.tenant_id = $1 ORDER BY l.name`);
      expect(locs.map((l) => [l.name, l.type, l.first_name])).toEqual([
        ['Esi Badu', 'agent', 'Esi'], ['In transit', 'in_transit', null], ['Kasapa Express', 'partner_3pl', 'Kasapa'],
        ['Kofi Appiah', 'agent', 'Kofi'], ['Kwesi Amoah', 'agent', 'Kwesi'], ['Logiswift', 'partner_3pl', 'Logiswift'],
      ]);
    });

    it('reserved comes from the orders at the holder, not from a stored number', async () => {
      // The mockup's samples (Logiswift 34 / 11 / 14, Kofi copybook 11) are lower than the number of out-for-delivery
      // orders (100 at Logiswift, 20 at Kofi; one copybook set or more each), so the order data gives 116 and 21.
      // Logiswift copybook on hand is 200 for that reason (see STOCK_AT).
      const reserved = byName(await rows(`
        SELECT u.first_name || ' ' || p.sku AS k, SUM(i.quantity) AS n FROM orders o
        JOIN order_items i ON i.order_id = o.id JOIN products p ON p.id = i.product_id JOIN users u ON u.id = o.delivery_agent_id
        WHERE o.tenant_id = $1 AND o.status IN ${OPEN_STATUSES} AND u.first_name IN ('Logiswift','Kofi') GROUP BY 1`));
      expect(reserved).toEqual({ 'Logiswift MG-COPYBOOK-SET': 116, 'Kofi MG-COPYBOOK-SET': 21 });
    });

    it('available to sell (on hand less reserved at the holders) is 0 or more for every product', async () => {
      const rowsAts = await rows<{ sku: string; on_hand: bigint; reserved: bigint }>(`
        SELECT p.sku,
               COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.product_id = p.id), 0) AS on_hand,
               COALESCE((SELECT SUM(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id
                         WHERE i.product_id = p.id AND o.delivery_agent_id IS NOT NULL
                           AND o.status IN ${OPEN_STATUSES}), 0) AS reserved
        FROM products p WHERE p.tenant_id = $1`);
      expect(rowsAts.length).toBeGreaterThan(0);
      for (const r of rowsAts) expect([r.sku, Number(r.on_hand) - Number(r.reserved) >= 0]).toEqual([r.sku, true]);
    });

    it('Kofi has 20 copybook sets in transit from Logiswift', async () => {
      const [row] = await rows<{ n: bigint; moves: bigint }>(`
        SELECT COALESCE(SUM(t.quantity), 0) AS n, COUNT(*) AS moves FROM inventory_transfers t
        JOIN stock_locations l ON l.id = t.to_location_id WHERE t.tenant_id = $1 AND t.status = 'in_transit' AND l.name = 'Kofi Appiah'`);
      expect([Number(row.n), Number(row.moves)]).toEqual([20, 1]);
    });

    it('the 9 October shipment: 300 shipped, 288 counted, 12 short, 8,700 total, 30.2083 each, claim 324 open', async () => {
      const [s] = await rows<Record<string, string | number | null>>(`
        SELECT quantity, quantity_counted, short_quantity, total_cost::text, total_cost_store::text, landed_cost_per_unit::text, claim_status::text,
               claim_amount::text, status::text, to_char(received_at, 'YYYY-MM-DD') AS received, (SELECT name FROM stock_locations WHERE id = destination_location_id) AS destination
        FROM inventory_shipments WHERE tenant_id = $1`);
      expect(s).toEqual({
        quantity: 300, quantity_counted: 288, short_quantity: 12, total_cost: '8700.0000', total_cost_store: '8700.0000', landed_cost_per_unit: '30.2083',
        claim_status: 'open', claim_amount: '324.0000', status: 'received', received: '2026-10-09', destination: 'Logiswift',
      });
    });

    it('the 3PL count of 15 October: copybook 188 against 200 (12 off), pens and grip trainer match', async () => {
      const lines = await rows<{ k: string; system: number; counted: number; diff: number; day: string; source: string }>(`
        SELECT p.sku AS k, cl.system_quantity AS system, cl.counted_quantity AS counted, cl.difference AS diff,
               to_char(c.count_date, 'YYYY-MM-DD') AS day, c.source::text AS source
        FROM stock_count_lines cl JOIN stock_counts c ON c.id = cl.count_id JOIN products p ON p.id = cl.product_id WHERE cl.tenant_id = $1 ORDER BY p.sku`);
      expect(lines.map((l) => [l.k, l.system, l.counted, l.diff, l.day, l.source])).toEqual([
        ['MG-COPYBOOK-SET', 200, 188, -12, '2026-10-15', 'three_pl_dashboard'],
        ['MG-GRIP-TRAINER', 180, 180, 0, '2026-10-15', 'three_pl_dashboard'],
        ['MG-REFILL-PENS', 62, 62, 0, '2026-10-15', 'three_pl_dashboard'],
      ]);
    });

    it('returns: Logiswift sent 41, we received 36, 5 missing', async () => {
      const [r] = await rows<{ sent: bigint; received: bigint }>(`
        SELECT SUM(quantity) AS sent, SUM(received_quantity) AS received FROM inventory_transfers WHERE tenant_id = $1 AND transfer_type = 'return_to_warehouse'`);
      expect([Number(r.sent), Number(r.received)]).toEqual([41, 36]);
    });
  });
}
