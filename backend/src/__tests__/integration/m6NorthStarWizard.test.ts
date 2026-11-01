/**
 * M6-T17 (COD-59, F-1111, F-1112): what the wizard and the Settings tab need from the API: the split preview, the saved-on date of the
 * North Star, the wizard progress in the Owner's preferences, and the "Set up North Star" menu item that goes when step 6 is done.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import navService from '../../services/navService';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

jest.setTimeout(90_000);

let pair: TwoTenants;
let owner: string;
let ownerB: string;
let ownerId: number;
const get = (t: string, url: string) => request(app).get(url).set(bearer(t));
const post = (t: string, url: string, body: object = {}) => request(app).post(url).set(bearer(t)).send(body);

beforeAll(async () => {
  // 17 October 2026: January to September are past
  jest.useFakeTimers({
    now: new Date('2026-10-17T12:00:00Z'),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  pair = await createTwoTenants('m6wizard');
  owner = await superAdminToken(pair.a.id, pair.a.slug);
  ownerB = await superAdminToken(pair.b.id, pair.b.slug);
  ownerId = (await prismaBase.user.findFirstOrThrow({ where: { tenantId: pair.a.id, email: `owner-${pair.a.slug}@codadmin.test` } })).id; // the user of the token
}, 90_000);

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.target.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] }, metric: { in: ['revenue', 'planned_aov'] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('GET /api/targets/north-star/preview', () => {
  it('grow gives 360/420/480/540k and the equal months; even gives four equal quarters', async () => {
    const grow = await get(owner, '/api/targets/north-star/preview?year=2026&annual=1800000&mode=grow');
    expect(grow.status).toBe(200);
    expect(grow.body.quarters).toEqual(['360000.00', '420000.00', '480000.00', '540000.00']);
    expect(grow.body.months[0]).toEqual(['120000.00', '120000.00', '120000.00']);
    expect(grow.body.months[3]).toEqual(['180000.00', '180000.00', '180000.00']);
    const even = await get(owner, '/api/targets/north-star/preview?year=2026&annual=1800000&mode=even');
    expect(even.body.quarters).toEqual(Array(4).fill('450000.00'));
  });

  it('custom quarters that add up come back; ones that do not are refused with the difference', async () => {
    const ok = await get(owner, '/api/targets/north-star/preview?year=2026&annual=1800000&mode=custom&customQuarters=100000,200000,500000,1000000');
    expect(ok.body.quarters[3]).toBe('1000000.00');
    const bad = await get(owner, '/api/targets/north-star/preview?year=2026&annual=1800000&mode=custom&customQuarters=300000,400000,500000,500000');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('TARGET_SUM_MISMATCH');
    expect(bad.body.message).toMatch(/Difference: 100000\.00/);
  });

  it('saves nothing, and a sales rep is refused', async () => {
    expect(await prismaBase.target.count({ where: { tenantId: pair.a.id, metric: 'revenue', scope: 'north_star' } })).toBe(0);
    expect((await get(pair.a.users.salesRep.token, '/api/targets/north-star/preview?year=2026&annual=1&mode=even')).status).toBe(403);
  });
});

describe('the preview is what a save writes: past months stay', () => {
  it('after a Grow tree is saved, an Even preview keeps the quarters that are over and gives the rest to the open ones', async () => {
    expect((await post(owner, '/api/targets/north-star', { year: 2026, annual: 1_800_000, mode: 'grow', plannedAov: 249 })).status).toBe(201);
    const even = await get(owner, '/api/targets/north-star/preview?year=2026&annual=1800000&mode=even');
    expect(even.body.quarters).toEqual(['360000.00', '420000.00', '480000.00', '540000.00']);
    expect(even.body.kept).toBe(9);
    const bigger = await get(owner, '/api/targets/north-star/preview?year=2026&annual=2000000&mode=even');
    expect(bigger.body.quarters[3]).toBe('740000.00');
    const saved = await post(owner, '/api/targets/north-star', { year: 2026, annual: 2_000_000, mode: 'even' });
    expect(saved.body.quarters.map((q: any) => q.value)).toEqual(bigger.body.quarters);
  });
});

describe('the saved-on date of the North Star', () => {
  it('the tree gives the North Star its updatedAt', async () => {
    const tree = await get(owner, '/api/targets/tree?year=2026');
    expect(tree.body.northStar.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await get(ownerB, '/api/targets/tree?year=2026')).body.northStar).toBeNull();
  });
});

describe('wizard progress (Owner preferences) and the menu item', () => {
  const menu = () => runInTenant(pair.a.id, () => navService.getShell(ownerId, 'super_admin')).then((s) => s.menu);

  it('starts at step 3, saves the step reached, and reaching step 3 closes the store setup', async () => {
    expect((await get(owner, '/api/onboarding/status')).body.northStar).toEqual({ step: 3, done: false });
    expect((await post(owner, '/api/onboarding/north-star', { step: 4 })).status).toBe(200);
    const status = (await get(owner, '/api/onboarding/status')).body;
    expect(status.northStar).toEqual({ step: 4, done: false });
    expect(status.onboardingCompleted).toBe(true);
    expect(await menu()).toContain('setupNorthStar');
  });

  it('step 6 done removes "Set up North Star" from the menu; a step outside 3 to 6 is refused', async () => {
    expect((await post(owner, '/api/onboarding/north-star', { step: 2 })).status).toBe(400);
    expect((await post(owner, '/api/onboarding/north-star', { step: 7 })).status).toBe(400);
    expect((await post(owner, '/api/onboarding/north-star', { step: 6, done: true })).status).toBe(200);
    expect((await get(owner, '/api/onboarding/status')).body.northStar).toEqual({ step: 6, done: true });
    expect(await menu()).not.toContain('setupNorthStar');
  });

  it('only the Owner saves progress; another tenant keeps its own', async () => {
    expect((await post(pair.a.users.admin.token, '/api/onboarding/north-star', { step: 4 })).status).toBe(403);
    expect((await get(ownerB, '/api/onboarding/status')).body.northStar).toEqual({ step: 3, done: false });
  });
});
