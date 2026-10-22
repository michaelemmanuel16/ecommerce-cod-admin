import { test, expect, Page } from '@playwright/test';

/**
 * M3-T48 (F-319, F-320): the Import modal and the Export menu on the Orders page.
 * The API is served by routes inside each test, so the numbers do not depend on the dev database.
 * Needs the dev users (password123) and the frontend. Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const COUNTS = {
  all: 1445,
  byStatus: {
    pending_confirmation: 64, payment_pending: 0, confirmed: 21, preparing: 41, ready_for_pickup: 38, out_for_delivery: 148,
    delivered: 376, digital_delivered: 0, cancelled: 355, returned: 48, failed_delivery: 354, payment_failed: 0,
  },
  waitingToDispatch: 100,
};
const order = (id: number) => ({
  id, status: 'pending_confirmation', orderType: 'physical', totalAmount: 249, createdAt: '2026-10-17T14:02:00.000Z',
  customer: { id, firstName: 'Buyer', lastName: String(id), phoneNumber: '+233245550182', alternatePhone: null },
  customerRep: null, deliveryAgent: null, orderItems: [{ id, quantity: 1, product: { id: 1, name: 'Copybook set' } }], flags: [], reminder: null, threadCount: null,
});
const NEW_IDS = Array.from({ length: 40 }, (_, i) => 9000 + i);

const CHECK = {
  fileName: 'meta-leads.csv', total: 42, ready: 40, needFix: 2, duplicates: 0, note: null,
  problems: [
    { row: 17, problems: ['phone has 9 digits'] },
    { row: 31, problems: ['region "Ashante" is not a region. Did you mean Ashanti?'] },
  ],
  problemsCsv: 'customer_name,problem\nX,phone has 9 digits\n',
};

/** A 42-row CSV: the file the check answers for. */
const file42 = () => ({
  name: 'meta-leads.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    ['customer_name,phone,address,state,product,quantity,price,status',
      ...Array.from({ length: 42 }, (_, i) => `Buyer ${i},02455501${String(i).padStart(2, '0')},${i} Adum Road,Ashanti,Copybook set,1,249,pending_confirmation`)].join('\n'),
  ),
});

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@codadmin.com');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

async function serve(page: Page, seen: { list: URLSearchParams[]; imported: number; export: URLSearchParams[] }) {
  await page.route(/\/api\/orders(\/[^?]*)?(\?.*)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/counts')) return json(COUNTS);
    if (url.pathname.endsWith('/upload/validate')) return json(CHECK);
    if (url.pathname.endsWith('/orders/upload') && req.method() === 'POST') {
      seen.imported++;
      return json({
        results: { success: 40, failed: 0, duplicates: 0, orderIds: NEW_IDS, errors: [] },
        total: 42, needFix: 2, note: null, problems: CHECK.problems, problemsCsv: CHECK.problemsCsv,
      });
    }
    if (url.pathname.endsWith('/orders/export')) {
      seen.export.push(url.searchParams);
      const format = url.searchParams.get('format');
      return route.fulfill({
        status: 200,
        contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
        headers: { 'Content-Disposition': `attachment; filename="orders-2026-10-22.${format}"` },
        body: 'Order number\n24118\n',
      });
    }
    if (url.pathname.endsWith('/api/orders') && req.method() === 'GET') {
      seen.list.push(url.searchParams);
      const ids = url.searchParams.get('ids');
      const rows = ids ? ids.split(',').map(Number) : [24118, 24117];
      return json({ orders: rows.map(order), pagination: { page: 1, limit: 25, total: rows.length, pages: 1 } });
    }
    return route.continue();
  });
}

test.describe('T48 import and export', () => {
  test('upload the 42-row file, see 40 ready and 2 need a fix, import 40, then show them', async ({ page }) => {
    const seen = { list: [] as URLSearchParams[], imported: 0, export: [] as URLSearchParams[] };
    await serve(page, seen);
    await signIn(page);
    await page.goto('/orders');
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByText('Up to 2,000 rows')).toBeVisible();
    await page.getByLabel('Choose a file to import').setInputFiles(file42());

    await expect(page.getByText('40 ready', { exact: true })).toBeVisible();
    await expect(page.getByText('2 need a fix', { exact: true })).toBeVisible();
    await expect(page.getByText('Row 17: phone has 9 digits')).toBeVisible();
    expect(seen.imported).toBe(0); // the check saves nothing

    await page.getByRole('button', { name: 'Import 40 orders' }).click();
    await expect(page.getByText('40 successful')).toBeVisible();
    expect(seen.imported).toBe(1);

    await page.getByRole('button', { name: 'Show the imported orders' }).click();
    await expect(page).toHaveURL(/\/orders\?ids=9000(%2C|,)9001/);
    await expect(page.getByText('Showing the 40 orders from your import.')).toBeVisible();
    await page.getByRole('button', { name: 'Show all orders' }).click();
    await expect(page).toHaveURL(/\/orders$/);
  });

  test('Export downloads orders-<date>.csv with the list filters', async ({ page }) => {
    const seen = { list: [] as URLSearchParams[], imported: 0, export: [] as URLSearchParams[] };
    await serve(page, seen);
    await signIn(page);
    await page.goto('/orders?status=confirmed');
    await page.getByRole('button', { name: 'Export' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(seen.export[0].get('format')).toBe('csv');
    expect(seen.export[0].getAll('status[]').concat(seen.export[0].getAll('status'))).toContain('confirmed');
    await expect(page.getByText(/^Exported .* orders to orders-/)).toBeVisible();
  });
});
