import { test, expect, Page } from '@playwright/test';

/**
 * M3-T45 (F-317): the New order side sheet.
 * The orders, products and customers APIs are served by routes inside the test, so the run does not write to the dev
 * database. The POST answers the way the backend does: the body has no status and the order starts pending_confirmation.
 * Needs the dev users (password123) and the frontend. Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const COUNTS = {
  all: 1,
  byStatus: {
    pending_confirmation: 1, payment_pending: 0, confirmed: 0, preparing: 0, ready_for_pickup: 0, out_for_delivery: 0,
    delivered: 0, digital_delivered: 0, cancelled: 0, returned: 0, failed_delivery: 0, payment_failed: 0,
  },
  waitingToDispatch: 0,
};

async function signIn(page: Page, email = 'admin@codadmin.com') {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

async function serve(page: Page, posted: Array<Record<string, unknown>>) {
  const json = (route: import('@playwright/test').Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/\/api\/products(\?.*)?$/, (route) =>
    json(route, { products: [{ id: 1, name: 'Copybook set', sku: 'MG-1', price: 249, cogs: 80, stockQuantity: 40, isActive: true, category: 'books' }] }));
  await page.route(/\/api\/customers(\?.*)?$/, (route) => json(route, { customers: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } }));
  await page.route(/\/api\/orders(\/[^?]*)?(\?.*)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/counts')) return json(route, posted.length ? COUNTS : { ...COUNTS, all: 0, byStatus: { ...COUNTS.byStatus, pending_confirmation: 0 } });
    if (url.pathname.endsWith('/api/orders') && req.method() === 'POST') {
      posted.push(req.postDataJSON());
      return json(route, { order: { id: 24200, orderNumber: 'ORD-24200', status: 'pending_confirmation' } }, 201);
    }
    if (url.pathname.endsWith('/api/orders') && req.method() === 'GET') {
      const orders = posted.map((p) => ({
        id: 24200,
        status: 'pending_confirmation',
        orderType: 'physical',
        totalAmount: p.totalAmount,
        createdAt: '2026-10-22T09:00:00.000Z',
        customer: { id: 1, firstName: 'W6', lastName: 'test Gifty', phoneNumber: '+233245550182', alternatePhone: null },
        customerRep: null,
        deliveryAgent: null,
        orderItems: [{ id: 1, quantity: 1, product: { id: 1, name: 'Copybook set' } }],
        flags: [],
        reminder: null,
        threadCount: null,
      }));
      return json(route, { orders, pagination: { page: 1, limit: 25, total: orders.length, pages: 1 } });
    }
    return route.continue();
  });
}

test.describe('T45 New order sheet', () => {
  test('create an order: no status is sent, the toast shows the number, the list shows it as Pending confirmation', async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    await serve(page, posted);
    await signIn(page);
    await page.goto('/orders');
    await page.getByRole('button', { name: 'New order' }).click();

    const sheet = page.getByRole('dialog', { name: 'New order' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel(/^status/i)).toHaveCount(0);
    await sheet.getByLabel('Customer name').fill('W6 test Gifty');
    await sheet.getByLabel('Phone', { exact: true }).fill('0245550182');
    await sheet.getByLabel('Delivery address').fill('14 Adum Road');
    await sheet.getByLabel('Region').selectOption('Ashanti');
    await sheet.getByLabel('Town or area').fill('Adum');
    await sheet.getByLabel('Product').selectOption({ label: 'Copybook set' });
    await expect(sheet.getByLabel(/Order total/)).toHaveValue('249');
    await sheet.getByLabel(/Order total/).fill('200');
    await expect(sheet.getByText(/Total differs from the lines by GH₵49/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Create order' }).click();

    await expect(page.getByText('Order ORD-24200 created')).toBeVisible();
    await expect(sheet).toBeHidden();
    expect(posted).toHaveLength(1);
    expect(posted[0]).not.toHaveProperty('status');
    expect(posted[0]).toMatchObject({ deliveryState: 'Ashanti', deliveryArea: 'Adum', totalAmount: 200, discount: 0, customerConfirmed: false });

    const row = page.getByRole('row', { name: /W6 test Gifty/ });
    await expect(row).toContainText('Pending confirmation');
  });

  test('/orders?new=1&customerId= opens the sheet, and closing it clears both params', async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    await serve(page, posted);
    await page.route(/\/api\/customers\/7$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ customer: { id: 7, firstName: 'Abena', lastName: 'Owusu', phoneNumber: '+233245550182', email: null, alternatePhone: null, address: '14 Adum Road', state: 'Ashanti', area: 'Adum' } }),
      }));
    await signIn(page);
    await page.goto('/orders?new=1&customerId=7');
    const sheet = page.getByRole('dialog', { name: 'New order' });
    await expect(sheet.getByLabel('Customer name')).toHaveValue('Abena Owusu');
    await expect(sheet.getByLabel('Region')).toHaveValue('Ashanti');
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/orders$/);
  });
});
