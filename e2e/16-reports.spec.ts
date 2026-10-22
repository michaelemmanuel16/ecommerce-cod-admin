import { test, expect, Page } from '@playwright/test';
import { reportsFixture, withoutCompare } from '../frontend/src/__tests__/fixtures/reports';

/**
 * M3-T60 and M3-T61 (F-1050 to F-1053, F-1064): the Reports page.
 * The numbers come from frontend/src/__tests__/fixtures/reports*.json (the NUMBERS.md fixture, 1 to 17 Oct 2026, as
 * GET /api/reports/:tab returns it), served through a route, because the dev database does not hold that month.
 * The sign-in uses the real dev API. Needs the dev users (password123) and the frontend with the repApp and agentApp
 * flags off. Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const PASSWORD = 'password123';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

type Tab = 'overview';

/** Serves the fixture for each tab; compare=previous keeps the previous-period figures, otherwise they are null. */
async function serve(page: Page, edit: (tab: Tab, body: any) => any = (_t, b) => b) {
  await page.route('**/api/reports/*?*', (route) => {
    const url = new URL(route.request().url());
    const tab = url.pathname.split('/').pop() as Tab;
    if (!(tab in reportsFixture)) return route.continue();
    const body = reportsFixture[tab]();
    const shaped = url.searchParams.get('compare') === 'previous' ? body : withoutCompare(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(edit(tab, shaped)) });
  });
}

const openReports = async (page: Page, tab?: string) => {
  await signIn(page, 'admin@codadmin.com');
  await page.goto(tab ? `/reports?tab=${tab}` : '/reports');
};

test.describe('T60 shell and Overview', () => {
  test('range label, previous period, tiles and no tile called Delivery rate', async ({ page }) => {
    await serve(page);
    await openReports(page);
    await expect(page.locator('.rangetext b')).toHaveText(/^1[-–]17 Oct 2026$/);
    const tiles = page.locator('.kpis');
    await expect(tiles.getByText('1,445', { exact: true })).toBeVisible();
    await expect(tiles.getByText('1,026', { exact: true })).toBeVisible();
    await expect(tiles.getByText('376', { exact: true })).toBeVisible();
    await expect(tiles.getByText('GH₵92,000', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Delivery rate$/i)).toHaveCount(0);

    await expect(page.getByText(/Previous period:/)).toHaveCount(0);
    await page.getByLabel('Compare to previous period').check({ force: true });
    await expect(page.getByText(/Previous period: 1[-–]17 Sep 2026/)).toBeVisible();
    await expect(page.getByText('vs 1,380')).toBeVisible();
  });

  test('five presets, the tabs a manager sees, no Products or Marketing tab', async ({ page }) => {
    await serve(page);
    await openReports(page);
    await expect(page.getByRole('group', { name: 'Date range' }).getByRole('button')).toHaveText(['Today', 'Last 7 days', 'This month', 'Last month', 'Custom']);
    await expect(page.getByRole('tablist', { name: 'Reports' }).getByRole('tab')).toHaveText(['Overview', 'Team performance']);
  });

  test('where orders ended up sums to 1,445; the daily table has 17 rows; the old pipeline chart is gone', async ({ page }) => {
    await serve(page);
    await openReports(page);
    await expect(page.getByText('Where 1,445 orders ended up')).toBeVisible();
    await expect(page.getByText('48% success, 34% yield.')).toBeVisible();
    const values = await page.locator('.bar-row .val').allInnerTexts();
    expect(values.map((v) => Number(v.replace(/,/g, ''))).reduce((a, b) => a + b, 0)).toBe(1445);
    await expect(page.getByRole('table', { name: 'Daily breakdown' }).locator('tbody tr')).toHaveCount(18);
    await expect(page.getByText(/order pipeline|delivery funnel|area distribution/i)).toHaveCount(0);
  });

  test('the old Analytics address lands on Reports', async ({ page }) => {
    await serve(page);
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  });

  test('a finance clerk has no Team tab', async ({ page }) => {
    await serve(page);
    await signIn(page, 'e2e-finance@codadmin.com');
    await page.goto('/reports');
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Team performance' })).toHaveCount(0);
  });

  test('works at 760 px in dark mode without a sideways scroll', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('codadmin-theme', 'dark'));
    await page.setViewportSize({ width: 760, height: 1000 });
    await serve(page);
    await openReports(page);
    await expect(page.getByText('Where 1,445 orders ended up')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
