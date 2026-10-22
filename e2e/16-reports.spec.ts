import { test, expect, Page } from '@playwright/test';
import { reportsFixture, withoutCompare } from '../frontend/src/__tests__/fixtures/reports';

/**
 * M3-T60 to M3-T62 (F-1050 to F-1054, F-1057, F-1064): the Reports page.
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

type Tab = 'overview' | 'sales' | 'delivery' | 'team';

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
    await expect(page.getByRole('tablist', { name: 'Reports' }).getByRole('tab')).toHaveText(['Overview', 'Sales & revenue', 'Delivery & operations', 'Team performance']);
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

test.describe('T61 Sales and Delivery', () => {
  test('Sales: values equal the API, the location table is City/Town and Region is not used', async ({ page }) => {
    await serve(page);
    await openReports(page, 'sales');
    const api = reportsFixture.sales();
    const tiles = page.locator('.kpis');
    await expect(tiles.getByText('GH₵92,000', { exact: true })).toBeVisible();
    await expect(tiles.getByText('GH₵245', { exact: true })).toBeVisible();
    await expect(tiles.getByText('GH₵68.6k', { exact: true })).toBeVisible();
    await expect(tiles.getByText('GH₵23.4k', { exact: true })).toBeVisible();
    const table = page.getByRole('table', { name: 'Revenue by City/Town' });
    await expect(table.getByRole('columnheader', { name: 'City/Town' })).toBeVisible();
    for (const row of api.byCity.rows) {
      await expect(table.getByRole('cell', { name: row.city, exact: true })).toBeVisible();
    }
    await expect(table.locator('tr.tot')).toContainText('376');
    await expect(page.getByText(/region/i)).toHaveCount(0);
  });

  test('Sales without financial:view: no cash tiles', async ({ page }) => {
    await serve(page, (tab, body) => {
      if (tab === 'sales') { delete body.tiles.cashReceived; delete body.tiles.cashWithPartners; }
      return body;
    });
    await openReports(page, 'sales');
    await expect(page.getByText('Average order value')).toBeVisible();
    await expect(page.getByText('Cash received')).toHaveCount(0);
  });

  test('Delivery: failed 354 and returned 48 apart, reasons, partners, waiting and returns', async ({ page }) => {
    await serve(page);
    await openReports(page, 'delivery');
    const tiles = page.locator('.kpis');
    await expect(tiles.getByText('354', { exact: true })).toBeVisible();
    await expect(tiles.getByText('48 returned')).toBeVisible();
    await expect(tiles.getByText('402')).toHaveCount(0);
    await expect(tiles.getByText('48%', { exact: true })).toBeVisible();
    await expect(tiles.getByText('148', { exact: true })).toBeVisible();
    await expect(tiles.getByText('9.2 days', { exact: true })).toBeVisible();

    const reasons = await page.locator('.bar-row').allInnerTexts();
    expect(reasons.map((r) => r.replace(/\s+/g, ' ').trim())).toEqual(['Not reachable 41% 165', 'Refused 24% 96', 'Wrong address 21% 84', 'Rescheduled 14% 57']);

    const partners = page.getByRole('table', { name: 'Delivery partners' });
    await expect(partners.locator('tr.tot')).toContainText('926');
    await expect(partners.getByText('No closed orders yet')).toBeVisible();
    await expect(page.getByText('100 orders')).toBeVisible();
    await expect(page.getByText('Oldest has waited 3 days')).toBeVisible();
  });

  test('the agent card opens the Delivery report and writes nothing', async ({ page }) => {
    await serve(page);
    await openReports(page);
    await expect(page.getByText('Logiswift closes only 45% as delivered')).toBeVisible();
    await page.getByRole('button', { name: 'Open Delivery report' }).click();
    await expect(page).toHaveURL(/tab=delivery/);
    await expect(page.getByRole('table', { name: 'Delivery partners' })).toBeVisible();
  });
});

test.describe('T62 Team tab and Export menu', () => {
  test('Team: tiles and rep rates equal the API, call outcomes and decline reasons show', async ({ page }) => {
    await serve(page);
    await openReports(page, 'team');
    const api = reportsFixture.team();
    const tiles = page.locator('.kpis');
    await expect(tiles.getByText('1,026', { exact: true })).toBeVisible();
    await expect(tiles.getByText('2,310', { exact: true })).toBeVisible();
    await expect(tiles.getByText('540', { exact: true })).toBeVisible();
    await expect(tiles.getByText('64', { exact: true })).toBeVisible();
    const table = page.getByRole('table', { name: 'Call reps' });
    for (const rep of api.reps) {
      await expect(table.getByRole('row', { name: new RegExp(rep.name) })).toContainText(`${rep.confirmationPercent}%`);
    }
    await expect(table.locator('tr.tot')).toContainText('1,026');
    await expect(page.getByText('Why customers decline')).toBeVisible();
    await expect(page.getByText('Delivery partners ranked')).toBeVisible();
  });

  test('Export: the menu has CSV, Excel and Download all, and no PDF', async ({ page }) => {
    await serve(page);
    await openReports(page);
    await page.getByRole('button', { name: /Export/ }).click();
    const menu = page.getByRole('menu', { name: 'Export' });
    await expect(menu.getByRole('menuitem')).toHaveText(['CSV (this tab)', 'Excel (this tab)', 'Download all reports (Excel)']);
    await expect(menu.getByText(/pdf/i)).toHaveCount(0);
  });

  test('Export: CSV of the Delivery tab downloads <report>-<from>-<to>.csv for the range on screen', async ({ page }) => {
    await serve(page);
    let asked = '';
    await page.route('**/api/reports/delivery/export?*', (route) => {
      asked = route.request().url();
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="delivery-2026-10-01-2026-10-17.csv"', 'access-control-expose-headers': 'Content-Disposition' },
        body: 'Metric,This period\nFailed,354\n',
      });
    });
    await openReports(page, 'delivery');
    await page.getByRole('button', { name: /Export/ }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'CSV (this tab)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^delivery-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(new URL(asked).searchParams.get('format')).toBe('csv');
  });
});
