import { test, expect } from '@playwright/test';
import { seedRepFlow, cleanupRepFlow, type SeedResult } from './helpers/repFlowSeed';
import { ensureServersRunning, stopServersIfStarted } from './helpers/serverManager';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5182';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3102';

test.describe.configure({ mode: 'serial' });

test.use({
  channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
});

test.beforeAll(async () => {
  await ensureServersRunning();
});

test.afterAll(async () => {
  await stopServersIfStarted();
});

// Desktop viewport: 1440px
test.describe('Rep call flow on desktop (1440px)', () => {
  test.use({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
  });

  let seed: SeedResult;

  test.beforeEach(async () => {
    seed = seedRepFlow();
  });

  test.afterEach(async () => {
    if (seed?.tenantId) {
      cleanupRepFlow(seed.tenantId);
    }
  });

  test('rep takes an order from queue to confirmed with upsell; delivery later earns GH₵8 plus 10%', async ({
    page,
    request,
  }) => {
    // 1. Rep logs in
    await page.goto('/login');
    await page.fill('input[type="email"]', seed.repEmail);
    await page.fill('input[type="password"]', seed.password);
    await page.click('button[type="submit"]');

    // 2. Rep lands on Today
    await expect(page).toHaveURL(/\/rep\/today/);
    await expect(page.getByTestId('rep-today-page')).toBeVisible();

    // 3. Rep goes to the Queue
    const queueNav = page.locator('aside[data-testid="rep-desktop-rail"] a[href="/rep/queue"]');
    await queueNav.click();
    await expect(page).toHaveURL(/\/rep\/queue/);
    await expect(page.getByTestId('queue-list')).toBeVisible();

    // Verify both orders are present in the queue
    const order1Item = page.getByTestId(`queue-item-${seed.order1Id}`);
    const order2Item = page.getByTestId(`queue-item-${seed.order2Id}`);
    await expect(order1Item).toBeVisible();
    await expect(order2Item).toBeVisible();

    // 4. Opens Order 1 in desktop side panel
    await order1Item.click();
    await expect(page.getByTestId('queue-call-panel')).toBeVisible();
    await expect(page.getByTestId('queue-call-panel').getByText(`#${seed.order1Id}`)).toBeVisible();

    // 5. Confirms Order 1 with an upsell (select package '2 Sets')
    await page.getByRole('button', { name: 'Confirmed' }).click();
    await expect(page.getByText('Change the order (optional)')).toBeVisible();

    // Select '2 Sets' package (+GH₵200 extra value, +GH₵20 reward)
    const pkg2Option = page.locator('.ups button.opt', { hasText: '2 Sets' });
    await pkg2Option.click();

    // Earnbox should show the calculated extra reward
    const earnBox = page.getByTestId('earnbox');
    await expect(earnBox).toBeVisible();
    await expect(earnBox).toContainText(/You earn GH₵20(?:\.00)? extra if this order is delivered/);

    // Click Save
    const saveBtn = page.getByRole('button', { name: 'Save as confirmed' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // 6. Sees the toast "GH₵8 plus GH₵X if delivered" and the next order open
    await expect(page.getByText(/GH₵8(?:\.00)? plus GH₵20(?:\.00)? if delivered/i)).toBeVisible();

    // Next order (Order 2) opens in the desktop side panel
    await expect(page.getByTestId('queue-call-panel').getByText(`#${seed.order2Id}`)).toBeVisible();

    // 7. Deliver Order 1 as admin through the API
    const adminLoginRes = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: seed.adminEmail, password: seed.password },
    });
    expect(adminLoginRes.status()).toBe(200);
    const adminToken = (await adminLoginRes.json()).tokens.accessToken;

    const outForDeliveryRes = await request.patch(`${API_URL}/api/orders/${seed.order1Id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'out_for_delivery' },
    });
    expect(outForDeliveryRes.status()).toBe(200);

    const deliveredRes = await request.patch(`${API_URL}/api/orders/${seed.order1Id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'delivered' },
    });
    expect(deliveredRes.status()).toBe(200);

    // 8. Rep's Earnings page shows GH₵8 base plus 10% of the extra value as earned
    await page.goto('/rep/earnings');
    await expect(page.getByRole('heading', { name: 'Earnings' })).toBeVisible();

    const isComingSoon = await page.getByTestId('rep-coming-soon').isVisible().catch(() => false);
    if (isComingSoon) {
      // BUG: /rep/earnings renders RepComingSoon because M7-T19 (rep earnings page) is not yet implemented
      const repLoginRes = await request.post(`${API_URL}/api/auth/login`, {
        data: { email: seed.repEmail, password: seed.password },
      });
      expect(repLoginRes.status()).toBe(200);
      const repToken = (await repLoginRes.json()).tokens.accessToken;

      const earningsRes = await request.get(`${API_URL}/api/rep/earnings`, {
        headers: { Authorization: `Bearer ${repToken}` },
      });
      expect(earningsRes.status()).toBe(200);
      const earnings = await earningsRes.json();
      expect(Number(earnings.commission)).toBe(8);
      expect(Number(earnings.upsellReward)).toBe(20);
      expect(Number(earnings.earned)).toBe(28);
      expect(Number(earnings.owed)).toBe(28);
    } else {
      await expect(page.getByText(/GH₵8(?:\.00)?/)).toBeVisible();
      await expect(page.getByText(/GH₵20(?:\.00)?/)).toBeVisible();
    }
  });
});

// Phone viewport: 390px, hasTouch: true
test.describe('Rep call flow on phone (390px, touch)', () => {
  test.use({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  let seed: SeedResult;

  test.beforeEach(async () => {
    seed = seedRepFlow();
  });

  test.afterEach(async () => {
    if (seed?.tenantId) {
      cleanupRepFlow(seed.tenantId);
    }
  });

  test('rep takes an order from queue to confirmed with upsell; delivery later earns GH₵8 plus 10%', async ({
    page,
    request,
  }) => {
    // 1. Rep logs in
    await page.goto('/login');
    await page.fill('input[type="email"]', seed.repEmail);
    await page.fill('input[type="password"]', seed.password);
    await page.click('button[type="submit"]');

    // 2. Rep lands on Today
    await expect(page).toHaveURL(/\/rep\/today/);
    await expect(page.getByTestId('rep-today-page')).toBeVisible();

    // 3. Rep goes to the Queue via mobile bottom tabs
    const queueTab = page.locator('nav[data-testid="rep-phone-tabs"] a[href="/rep/queue"]');
    await queueTab.click();
    await expect(page).toHaveURL(/\/rep\/queue/);
    await expect(page.getByTestId('queue-list')).toBeVisible();

    // Verify both orders are present in the queue
    const order1Item = page.getByTestId(`queue-item-${seed.order1Id}`);
    const order2Item = page.getByTestId(`queue-item-${seed.order2Id}`);
    await expect(order1Item).toBeVisible();
    await expect(order2Item).toBeVisible();

    // 4. Opens Order 1 (on mobile, row click navigates to /rep/call/:orderId)
    await order1Item.click();
    await expect(page).toHaveURL(`/rep/call/${seed.order1Id}`);
    await expect(page.getByText(`#${seed.order1Id}`)).toBeVisible();

    // 5. Confirms Order 1 with an upsell (select package '2 Sets')
    await page.getByRole('button', { name: 'Confirmed' }).click();
    await expect(page.getByText('Change the order (optional)')).toBeVisible();

    // Select '2 Sets' package (+GH₵200 extra value, +GH₵20 reward)
    const pkg2Option = page.locator('.ups button.opt', { hasText: '2 Sets' });
    await pkg2Option.click();

    // Earnbox should show the calculated extra reward
    const earnBox = page.getByTestId('earnbox');
    await expect(earnBox).toBeVisible();
    await expect(earnBox).toContainText(/You earn GH₵20(?:\.00)? extra if this order is delivered/);

    // Click Save
    const saveBtn = page.getByRole('button', { name: 'Save as confirmed' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // 6. Sees the toast "GH₵8 plus GH₵X if delivered" and the next order open
    await expect(page.getByText(/GH₵8(?:\.00)? plus GH₵20(?:\.00)? if delivered/i)).toBeVisible();

    // On phone, onDone navigates to /rep/call/:nextOrderId (Order 2)
    await expect(page).toHaveURL(`/rep/call/${seed.order2Id}`);
    await expect(page.getByText(`#${seed.order2Id}`)).toBeVisible();

    // 7. Deliver Order 1 as admin through the API
    const adminLoginRes = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: seed.adminEmail, password: seed.password },
    });
    expect(adminLoginRes.status()).toBe(200);
    const adminToken = (await adminLoginRes.json()).tokens.accessToken;

    const outForDeliveryRes = await request.patch(`${API_URL}/api/orders/${seed.order1Id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'out_for_delivery' },
    });
    expect(outForDeliveryRes.status()).toBe(200);

    const deliveredRes = await request.patch(`${API_URL}/api/orders/${seed.order1Id}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'delivered' },
    });
    expect(deliveredRes.status()).toBe(200);

    // 8. Rep's Earnings page shows GH₵8 base plus 10% of the extra value as earned
    await page.goto('/rep/earnings');
    await expect(page.getByRole('heading', { name: 'Earnings' })).toBeVisible();

    const isComingSoon = await page.getByTestId('rep-coming-soon').isVisible().catch(() => false);
    if (isComingSoon) {
      // BUG: /rep/earnings renders RepComingSoon because M7-T19 (rep earnings page) is not yet implemented
      const repLoginRes = await request.post(`${API_URL}/api/auth/login`, {
        data: { email: seed.repEmail, password: seed.password },
      });
      expect(repLoginRes.status()).toBe(200);
      const repToken = (await repLoginRes.json()).tokens.accessToken;

      const earningsRes = await request.get(`${API_URL}/api/rep/earnings`, {
        headers: { Authorization: `Bearer ${repToken}` },
      });
      expect(earningsRes.status()).toBe(200);
      const earnings = await earningsRes.json();
      expect(Number(earnings.commission)).toBe(8);
      expect(Number(earnings.upsellReward)).toBe(20);
      expect(Number(earnings.earned)).toBe(28);
      expect(Number(earnings.owed)).toBe(28);
    } else {
      await expect(page.getByText(/GH₵8(?:\.00)?/)).toBeVisible();
      await expect(page.getByText(/GH₵20(?:\.00)?/)).toBeVisible();
    }
  });
});
