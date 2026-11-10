import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { seedRepFlow, cleanupRepFlow, type SeedResult } from './helpers/repFlowSeed';
import { ensureServersRunning, stopServersIfStarted } from './helpers/serverManager';

// M7-T23: rep end-to-end call flow on the lane test DB (backend 3102, frontend 5182). No real WhatsApp or SMS:
// the seed turns auto-confirm off and the test tenant has no WhatsApp or SMS settings.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5182';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3102';

test.describe.configure({ mode: 'serial' });
test.use({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', baseURL: BASE_URL });

test.beforeAll(async () => {
  await ensureServersRunning();
});

test.afterAll(async () => {
  await stopServersIfStarted();
});

async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, { data: { email, password } });
  expect(res.status()).toBe(200);
  return (await res.json()).tokens.accessToken;
}

async function runRepCallFlow(page: Page, request: APIRequestContext, seed: SeedResult, phone: boolean) {
  // 1. Rep logs in and lands on Today
  await page.goto('/login');
  await page.fill('input[type="email"]', seed.repEmail);
  await page.fill('input[type="password"]', seed.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/rep\/today/);
  await expect(page.getByTestId('rep-today-page')).toBeVisible();

  // 2. Rep goes to the Queue (bottom tabs on phone, side rail on desktop)
  const nav = phone ? 'nav[data-testid="rep-phone-tabs"]' : 'aside[data-testid="rep-desktop-rail"]';
  await page.locator(`${nav} a[href="/rep/queue"]`).click();
  await expect(page).toHaveURL(/\/rep\/queue/);
  await expect(page.getByTestId('queue-list')).toBeVisible();
  const order1Item = page.getByTestId(`queue-item-${seed.order1Id}`);
  await expect(order1Item).toBeVisible();
  await expect(page.getByTestId(`queue-item-${seed.order2Id}`)).toBeVisible();

  // 3. Rep opens order 1: side panel on desktop, its own page on phone
  await order1Item.click();
  const card = phone ? page : page.getByTestId('queue-call-panel');
  if (phone) await expect(page).toHaveURL(`/rep/call/${seed.order1Id}`);
  await expect(card.getByText(`#${seed.order1Id}`)).toBeVisible();

  // 4. Rep confirms with an upsell: package '2 Sets' adds GH₵200 extra value, so GH₵20 reward
  await page.getByRole('button', { name: 'Confirmed' }).click();
  await expect(page.getByText('Change the order (optional)')).toBeVisible();
  await page.locator('.ups button.opt', { hasText: '2 Sets' }).click();
  await expect(page.getByTestId('earnbox')).toContainText(/You earn GH₵20(?:\.00)? extra if this order is delivered/);
  const saveBtn = page.getByRole('button', { name: 'Save as confirmed' });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // 5. Toast, then the next order opens
  await expect(page.getByText(/GH₵8(?:\.00)? plus GH₵20(?:\.00)? if delivered/i)).toBeVisible();
  if (phone) await expect(page).toHaveURL(`/rep/call/${seed.order2Id}`);
  await expect(card.getByText(`#${seed.order2Id}`)).toBeVisible();

  // 6. Admin delivers order 1 through the API
  const adminToken = await login(request, seed.adminEmail, seed.password);
  for (const status of ['out_for_delivery', 'delivered']) {
    const res = await request.patch(`${API_URL}/api/orders/${seed.order1Id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status },
    });
    expect(res.status()).toBe(200);
  }

  // 7. Earnings: GH₵8 base plus 10% of the GH₵200 extra value
  const repToken = await login(request, seed.repEmail, seed.password);
  const earningsRes = await request.get(`${API_URL}/api/rep/earnings`, {
    headers: { Authorization: `Bearer ${repToken}` },
  });
  expect(earningsRes.status()).toBe(200);
  const earnings = await earningsRes.json();
  expect(earnings).toMatchObject({ commission: '8.00', upsellReward: '20.00', earned: '28.00', owed: '28.00' });

  await page.goto('/rep/earnings');
  await expect(page.getByRole('heading', { name: 'Earnings', exact: true })).toBeVisible();
  await expect(page.getByTestId('line-commission')).toContainText(/GH₵\s?8(?:\.00)?(?!\d)/);
  await expect(page.getByTestId('line-upsell')).toContainText(/GH₵\s?20(?:\.00)?(?!\d)/);
  await expect(page.getByTestId('owed-now-amount')).toHaveText(/GH₵\s?28(?:\.00)?(?!\d)/);
  await expect(page.getByTestId(`order-line-${seed.order1Id}`)).toContainText(/GH₵\s?28(?:\.00)?(?!\d)/);
}

const VIEWPORTS = [
  { name: 'desktop (1440px)', phone: false, use: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone (390px, touch)', phone: true, use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
];

for (const vp of VIEWPORTS) {
  test.describe(`Rep call flow on ${vp.name}`, () => {
    test.use(vp.use);
    let seed: SeedResult;

    test.beforeEach(() => {
      seed = seedRepFlow();
    });

    test.afterEach(() => {
      if (seed?.tenantId) cleanupRepFlow(seed.tenantId);
    });

    test('rep confirms an order with an upsell; delivery earns GH₵8 plus 10%', async ({ page, request }) => {
      await runRepCallFlow(page, request, seed, vp.phone);
    });
  });
}
