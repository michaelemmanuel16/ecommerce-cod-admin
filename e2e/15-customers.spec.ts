import { test, expect, Page } from '@playwright/test';

/**
 * M3-T49, T50 (F-350 to F-356, F-361): the Customers list and the customer page.
 * The API is served by routes inside each test, with a small in-memory customer book, so the numbers do not depend
 * on the dev database. The routes follow the backend contract (customerController). Phone search follows the
 * backend: any format that has the same digits finds the customer. Needs the dev users (password123) and the
 * frontend. Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const PASSWORD = 'password123';

interface Cust {
  id: number; firstName: string; lastName: string; phoneNumber: string; area: string; state: string; address: string;
  totalOrders: number; refusedOrders: number; inFlight?: boolean; isActive: boolean;
}

const make = (c: Partial<Cust> & Pick<Cust, 'id' | 'firstName' | 'phoneNumber'>): Cust => ({
  lastName: 'T', area: 'Accra', state: 'Greater Accra', address: '1 St', totalOrders: 1, refusedOrders: 0, isActive: true, ...c,
});

const SEED = (): Cust[] => [
  make({ id: 1, firstName: 'Abena', lastName: 'Owusu', phoneNumber: '+233245550182', totalOrders: 5, area: 'Kumasi', state: 'Ashanti' }),
  make({ id: 2, firstName: 'Yaw', lastName: 'Boateng', phoneNumber: '+233245550103', totalOrders: 4, refusedOrders: 2 }),
  make({ id: 3, firstName: 'Kojo', lastName: 'Annan', phoneNumber: '+233265550127', totalOrders: 1, inFlight: true }),
];

const full = (c: Cust) => ({
  ...c, email: null, alternatePhone: null, landmark: null, notes: null, deliveredOrders: 0, deliveredValue: '0.00', lastOrderAt: '2026-10-17T14:02:00.000Z',
  risk: c.refusedOrders >= 2 ? 'high' : c.refusedOrders === 1 ? 'watch' : 'low', codBlocked: c.refusedOrders >= 3, notReachable: false,
  smsOptOut: false, whatsappOptOut: false, emailOptOut: false, createdAt: '2026-01-05T09:00:00.000Z',
});

async function signIn(page: Page, email = 'admin@codadmin.com') {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

async function serve(page: Page, book: Cust[] = SEED()) {
  const digits = (s: string) => s.replace(/\D/g, '');
  // "0245550103" and "+233 24 555 0103" are the same number: compare the last nine digits
  const tail = (s: string) => digits(s).slice(-9);
  await page.route(/\/api\/customers(\/[^?]*)?(\?.*)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const path = url.pathname.replace('/api/customers', '');
    const active = () => book.filter((c) => c.isActive);
    const q = url.searchParams.get('search')?.trim() ?? '';
    const filtered = () => active().filter((c) => !q || `${c.firstName} ${c.lastName}`.toLowerCase().includes(q.toLowerCase()) || (digits(q).length >= 9 && tail(c.phoneNumber) === tail(q)));

    if (path === '/towns') return json({ towns: [...new Set(active().map((c) => c.area))].sort() });
    if (path === '/summary') {
      const rows = filtered();
      return json({
        tiles: { total: rows.length, newThisMonth: 1, firstTime: rows.filter((c) => c.totalOrders === 1).length, firstTimePct: 50, repeat: rows.filter((c) => c.totalOrders >= 2).length, repeatPct: 50, blocked: 0 },
        segments: { all: rows.length, repeat: rows.filter((c) => c.totalOrders >= 2).length, first_time: rows.filter((c) => c.totalOrders === 1).length, refused_before: rows.filter((c) => c.refusedOrders > 0).length, not_reachable: 0 },
      });
    }
    if (path === '/export') {
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="customers.csv"' }, body: 'Name,Phone\n"Abena Owusu","0245550182"\n' });
    }
    if (path === '' && req.method() === 'GET') {
      const rows = filtered();
      return json({ customers: rows.map(full), pagination: { page: 1, limit: 25, total: rows.length, pages: 1 } });
    }
    if (path === '' && req.method() === 'POST') {
      const body = req.postDataJSON();
      const owner = book.find((c) => tail(c.phoneNumber) === tail(body.phoneNumber));
      if (owner) return json({ message: `This number belongs to ${owner.firstName} ${owner.lastName}`, code: 'PHONE_BELONGS_TO_OTHER_CUSTOMER', customerId: owner.id, customerName: `${owner.firstName} ${owner.lastName}` }, 409);
      const made = make({ id: 100 + book.length, firstName: body.firstName, lastName: body.lastName ?? '', phoneNumber: `+233${tail(body.phoneNumber)}`, area: body.area, state: body.state, address: body.address, totalOrders: 0 });
      book.push(made);
      return json({ customer: full(made) }, 201);
    }
    const id = Number(path.slice(1));
    const found = book.find((c) => c.id === id);
    if (req.method() === 'GET') return found ? json({ customer: { ...full(found), averageOrderValue: null, orders: found.totalOrders ? [{ id: 24117, status: found.inFlight ? 'out_for_delivery' : 'delivered', totalAmount: 249, createdAt: '2026-10-17T14:02:00.000Z' }] : [] } }) : json({ message: 'Customer not found' }, 404);
    if (req.method() === 'DELETE' && found) {
      if (found.inFlight) return json({ message: 'This customer has an order out for delivery. Delete them after it is delivered or returned.', code: 'CUSTOMER_HAS_ORDER_IN_FLIGHT' }, 409);
      found.isActive = false;
      return json({ message: 'Customer deactivated successfully' });
    }
    return route.continue();
  });
}

test.describe('T49 customers list', () => {
  test('tile and tab counts equal the list total', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers');
    await expect(page.getByText('Showing 3 of 3 customers')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^All\s*3/ })).toBeVisible();
    await expect(page.locator('.kpi').filter({ hasText: 'Total customers' }).locator('.v')).toHaveText('3');
    await page.getByRole('tab', { name: /^Repeat/ }).click();
    await expect(page).toHaveURL(/segment=repeat/);
  });

  test('a search by phone in two formats finds one row', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers');
    const box = page.getByRole('textbox', { name: 'Search customers' });
    for (const typed of ['0245550103', '+233 24 555 0103']) {
      await box.fill(typed);
      await expect(page.locator('tbody tr')).toHaveCount(1);
      await expect(page.locator('tbody tr')).toContainText('Yaw Boateng');
      await expect(page.locator('tbody tr')).toContainText('024 555 0103');
    }
  });

  test('the export button downloads a file', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export CSV/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^customers-.*\.csv$/);
  });
});

test.describe('T50 customer page', () => {
  test('a rep adds a customer and finds them in the list', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers');
    await page.getByRole('button', { name: /Add customer/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Add customer' });
    await dlg.getByLabel('First name').fill('W6 test');
    await dlg.getByLabel(/^Last name/).fill('Buyer');
    await dlg.getByLabel('Phone', { exact: true }).fill('024 555 0999');
    await dlg.getByLabel('Region').selectOption({ index: 1 });
    await dlg.getByLabel('Town').fill('Accra');
    await dlg.getByLabel('Street address').fill('5 Ring Road');
    await dlg.getByRole('button', { name: 'Add customer' }).click();
    await expect(page.getByText('W6 test Buyer added')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search customers' }).fill('W6 test');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('024 555 0999');
  });

  test('a phone that exists shows who has it, with a link', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers');
    await page.getByRole('button', { name: /Add customer/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Add customer' });
    await dlg.getByLabel('First name').fill('Dup');
    await dlg.getByLabel('Phone', { exact: true }).fill('0245550182');
    await dlg.getByLabel('Region').selectOption({ index: 1 });
    await dlg.getByLabel('Town').fill('Accra');
    await dlg.getByLabel('Street address').fill('1 St');
    await dlg.getByRole('button', { name: 'Add customer' }).click();
    await expect(dlg.getByText('This number belongs to Abena Owusu')).toBeVisible();
    await expect(dlg.getByRole('link', { name: 'Open Abena Owusu' })).toHaveAttribute('href', '/customers/1');
  });

  test('deleting a customer with an order in flight shows the 409 text', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers/3');
    await page.getByRole('button', { name: /Delete/ }).click();
    await expect(page.getByRole('heading', { name: 'Delete Kojo Annan?' })).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('This customer has an order out for delivery. Delete them after it is delivered or returned.').first()).toBeVisible();
    await expect(page).toHaveURL(/\/customers\/3$/);
  });

  test('a customer with no order in flight is deleted and leaves the list', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers/2');
    await page.getByRole('button', { name: /Delete/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByText('Yaw Boateng')).toHaveCount(0);
  });

  test('"New order for this customer" links to /orders?new=1&customerId=', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/customers/1');
    await expect(page.getByRole('link', { name: /New order for this customer/ })).toHaveAttribute('href', '/orders?new=1&customerId=1');
  });
});
