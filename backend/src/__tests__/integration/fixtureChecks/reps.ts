/**
 * M1-T18 fixture checks, 1 to 17 October 2026 (NUMBERS.md call reps table). Called from kpiContract.test.ts,
 * which seeds once. Rates are stored to 1 decimal; the mockup shows whole percents, so the checks round.
 */
import { describe, it, expect } from '@jest/globals';
import { prismaBase } from '../../../utils/prisma';
import { repRates } from '../../../services/kpi/reps';
import { deliveredRevenue, deliveredRevenueByRep } from '../../../services/kpi/revenue';
import { teamReport } from '../../../services/teamReportService';
import { endOfDay, getStoreTimeZone, startOfDay } from '../../../services/kpi/dates';

export function repsFixtureChecks(getTenantId: () => string): void {
  describe('reps (M1-T18)', () => {
    const zone = getStoreTimeZone();
    const from = startOfDay('2026-10-01', zone);
    const to = endOfDay('2026-10-17', zone);
    const repId = async (firstName: string) =>
      (await prismaBase.user.findFirstOrThrow({ where: { tenantId: getTenantId(), firstName, role: 'sales_rep' } })).id;

    it('delivered from confirmed: Adwoa 52%, Confirm agent 44%, Nana 30%, all 48%', async () => {
      const r = await repRates(getTenantId(), from, to);
      const pct = (v: number | null) => (v === null ? null : Math.round(v));
      expect(pct(r.rep(await repId('Adwoa')).deliveredFromConfirmedRate.value)).toBe(52);
      expect(r.rep(await repId('Adwoa')).deliveredFromConfirmedRate.detail).toMatchObject({ delivered: 253, closed: 486 });
      expect(pct(r.rep(await repId('Confirm')).deliveredFromConfirmedRate.value)).toBe(44);
      expect(pct(r.rep(await repId('Nana')).deliveredFromConfirmedRate.value)).toBe(30);
      expect(pct(r.all.deliveredFromConfirmedRate.value)).toBe(48);
      expect(r.all.deliveredFromConfirmedRate.detail).toMatchObject({ delivered: 376, closed: 778 });

      // Revenue by rep (one grouped query) equals the per-rep deliveredRevenue and adds up to the company total.
      const byRep = await deliveredRevenueByRep(getTenantId(), from, to);
      for (const name of ['Adwoa', 'Confirm', 'Nana']) {
        const id = await repId(name);
        const single = await deliveredRevenue(getTenantId(), from, to, { customerRepId: id });
        expect(byRep.get(id)).toEqual({ revenue: single.total.value, deliveredOrders: single.deliveredOrders.value });
      }
      const total = await deliveredRevenue(getTenantId(), from, to);
      expect([...byRep.values()].reduce((sum, v) => sum + Number(v.revenue), 0).toFixed(2)).toBe(total.total.value);
    });

    it('confirmation rate: Adwoa 73%, Confirm agent 71% (NUMBERS.md 70%, see D28), Nana 58%, all 71%', async () => {
      const r = await repRates(getTenantId(), from, to);
      // Round once from the counts: the stored 1-decimal value (73.5) would round again to 74.
      const pct = (k: { detail?: { confirmed: number; placed: number } }) =>
        Math.round((k.detail!.confirmed / k.detail!.placed) * 100);
      expect(pct(r.rep(await repId('Adwoa')).confirmationRate)).toBe(73);
      expect(r.rep(await repId('Adwoa')).confirmationRate.detail).toMatchObject({ confirmed: 640 });
      // 328 / 465 = 70.5%. NUMBERS.md says 70%; no whole split of 1,336 orders gives both 73% and 70% (D28).
      expect(r.rep(await repId('Confirm')).confirmationRate.detail).toEqual({ confirmed: 328, placed: 465 });
      expect(pct(r.rep(await repId('Confirm')).confirmationRate)).toBe(71);
      expect(pct(r.rep(await repId('Nana')).confirmationRate)).toBe(58);
      expect(pct(r.all.confirmationRate)).toBe(71);
    });

    it('team report: tiles, rep activity and decline reasons', async () => {
      const t = await teamReport(getTenantId(), from, to);
      expect(t.tiles.ordersConfirmed).toBe(1026);
      expect(t.tiles.callsMade).toBe(2310);
      expect(t.tiles.callsPerConfirmation).toBe(2.25);
      expect(t.tiles.queue.pending).toBe(64);
      expect(t.tiles.queue.withoutRep).toBe(9);
      const row = (name: string) => t.reps.find((x) => x.name.startsWith(name))!;
      expect(row('Adwoa')).toMatchObject({ calls: 1360, confirmed: 640 });
      expect(row('Confirm')).toMatchObject({ calls: 780, confirmed: 328 });
      expect(row('Nana')).toMatchObject({ calls: 170, confirmed: 58 });
      expect(t.declineReasons.map((d) => [d.reason, Math.round(d.percent!)])).toEqual([
        ['price_too_high', 34], ['prank_or_mistake', 22], ['changed_mind', 20], ['bought_elsewhere', 14], ['other', 10],
      ]);
    });
  });
}
