import { test, expect, Page } from '@playwright/test';

/**
 * M3-T42, T43, T44 (F-307 to F-316): the Orders list.
 * The API is served by routes inside each test (GET /api/orders, /counts, /transitions, the bulk calls), so the
 * numbers do not depend on the dev database. The routes follow the backend contract: the list takes `search`,
 * `status[]`, `sortBy`, `page`, `limit`; the counts ignore status; a bulk call answers {succeeded, failed}.
 * Needs the dev users (password123) and the frontend. Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const PASSWORD = 'password123';

interface Row { id: number; status: string; name: string; rep?: string; agent?: string; amount?: number }

const person = (full?: string) => (full ? { id: 1, firstName: full.split(' ')[0], lastName: full.split(' ')[1] ?? '' } : null);
const apiRow = (r: Row) => ({
  id: r.id,
  status: r.status,
  orderType: 'physical',
  totalAmount: r.amount ?? 249,
  createdAt: '2026-10-17T14:02:00.000Z',
  customer: { id: r.id % 5, firstName: r.name.split(' ')[0], lastName: r.name.split(' ')[1] ?? '', phoneNumber: '+233245550182', alternatePhone: null },
  customerRep: person(r.rep),
  deliveryAgent: person(r.agent),
  orderItems: [{ id: r.id, quantity: 1, product: { id: 1, name: 'Copybook set' } }],
  flags: [],
  reminder: null,
  threadCount: null,
});

const ROWS: Row[] = [
  { id: 24118, status: 'pending_confirmation', name: 'Gifty Addo' },
  { id: 24117, status: 'delivered', name: 'Abena Owusu', rep: 'Adwoa Darko', agent: 'Kofi Appiah' },
  { id: 24113, status: 'pending_confirmation', name: 'Yaw Boateng', rep: 'Adwoa Darko' },
  { id: 24112, status: 'confirmed', name: 'Kojo Annan', rep: 'Adwoa Darko' },
];

const COUNTS = {
  all: 1445,
  byStatus: {
    pending_confirmation: 64, payment_pending: 0, confirmed: 21, preparing: 41, ready_for_pickup: 38, out_for_delivery: 148,
    delivered: 376, digital_delivered: 0, cancelled: 355, returned: 48, failed_delivery: 354, payment_failed: 0,
  },
  waitingToDispatch: 100,
};

async function signIn(page: Page, email = 'admin@codadmin.com') {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

/** Serves the orders API. `onBulk` answers PATCH /api/orders/bulk/status; `seen` collects the list queries. */
async function serve(
  page: Page,
  opts: { rows?: Row[]; counts?: typeof COUNTS; onBulk?: (body: Record<string, unknown>) => unknown; onDelete?: (body: { ids: number[] }) => unknown; seen?: URLSearchParams[] } = {},
) {
  const rows = opts.rows ?? ROWS;
  await page.route(/\/api\/orders(\/[^?]*)?(\?.*)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/counts')) return json(opts.counts ?? COUNTS);
    if (url.pathname.endsWith('/transitions')) return json({ status: 'pending_confirmation', normal: ['confirmed', 'cancelled'], forced: [] });
    if (url.pathname.endsWith('/bulk/status') && req.method() === 'PATCH') return json(opts.onBulk?.(req.postDataJSON()) ?? { succeeded: [], failed: [] });
    if (url.pathname.endsWith('/orders/bulk') && req.method() === 'DELETE') {
      return json(opts.onDelete?.(req.postDataJSON()) ?? { message: 'ok', deletedCount: 0, deleted: 0, skipped: [] });
    }
    if (url.pathname.endsWith('/api/orders') && req.method() === 'GET') {
      opts.seen?.push(url.searchParams);
      // the backend reads "#24118" and "24118" as the same order number
      const term = (url.searchParams.get('search') ?? '').replace('#', '').trim();
      const hit = term ? rows.filter((r) => String(r.id) === term) : rows;
      return json({ orders: hit.map(apiRow), pagination: { page: 1, limit: 25, total: hit.length, pages: 1 } });
    }
    return route.continue();
  });
}

test.describe('T42 tabs, rows, footer', () => {
  test('tab counts as on the fixture, and the tab is kept in ?status=', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/orders');
    await expect(page.getByRole('tab', { name: /^All\s*1,445/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Pending confirmation\s*64/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Failed delivery\s*354/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Digital/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Payment issues/ })).toHaveCount(0);
    await page.getByRole('tab', { name: /Delivered/ }).click();
    await expect(page).toHaveURL(/\/orders\?status=delivered$/);
  });

  test('order numbers are #id, the footer reads Showing n of N, no Kanban', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/orders');
    await expect(page.getByText('#24118', { exact: true })).toBeVisible();
    await expect(page.getByText(/Showing \d+ of 4 orders/)).toBeVisible();
    await expect(page.getByText(/kanban/i)).toHaveCount(0);
  });

  test('a row click opens the order; a checkbox click does not', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/orders');
    await page.getByLabel('Select order #24117').check();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByText('1 selected')).toBeVisible();
    await page.getByText('#24112', { exact: true }).click();
    await expect(page).toHaveURL(/\/orders\/24112$/);
  });
});

test.describe('T43 search, sort, page size, URL', () => {
  test('"#24118" and "24118" find the same row', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/orders');
    const search = page.getByLabel('Search orders');
    await search.fill('#24118');
    await expect(page.getByText('#24117', { exact: true })).toHaveCount(0);
    await expect(page.getByText('#24118', { exact: true })).toBeVisible();
    await search.fill('24118');
    await expect(page.getByText('#24117', { exact: true })).toHaveCount(0);
    await expect(page.getByText('#24118', { exact: true })).toBeVisible();
  });

  test('copy the URL, open it in a new tab: same view', async ({ page, context }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/orders');
    await page.getByRole('tab', { name: /Confirmed/ }).click();
    await page.getByLabel('Rows per page').selectOption('50');
    await page.getByLabel('Search orders').fill('kojo');
    await page.getByRole('button', { name: /Sort by amount/ }).click();
    await expect(page).toHaveURL(/status=confirmed/);
    await expect(page).toHaveURL(/q=kojo/);
    const link = page.url();

    const other = await context.newPage();
    const seen: URLSearchParams[] = [];
    await serve(other, { seen });
    await other.goto(link);
    await expect(other.getByRole('tab', { name: /Confirmed/ })).toHaveAttribute('aria-selected', 'true');
    await expect(other.getByLabel('Search orders')).toHaveValue('kojo');
    await expect(other.getByLabel('Rows per page')).toHaveValue('50');
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    const q = seen[seen.length - 1];
    expect(q.get('search')).toBe('kojo');
    expect(q.get('limit')).toBe('50');
    expect(q.get('sortBy')).toBe('totalAmount');
  });

  test('page size is saved for the user and the date range defaults to this month', async ({ page }) => {
    const seen: URLSearchParams[] = [];
    await serve(page, { seen });
    await signIn(page);
    await page.goto('/orders');
    await page.getByLabel('Rows per page').selectOption('75');
    await page.goto('/orders');
    await expect(page.getByLabel('Rows per page')).toHaveValue('75');
    await expect(page.getByRole('button', { name: 'Date range: This month' })).toBeVisible();
    await page.getByRole('button', { name: 'Delivery date' }).click();
    await expect(page).toHaveURL(/basis=delivery/);
  });
});

test.describe('T44 actions', () => {
  test('bulk change with 2 that cannot move: the toast text, and the 2 stay selected', async ({ page }) => {
    await serve(page, {
      onBulk: () => ({
        succeeded: [24118],
        failed: [{ id: 24113, code: 'INVALID_TRANSITION', message: 'It cannot move to confirmed.' }, { id: 24112, code: 'ERROR', message: 'This order could not be changed.' }],
      }),
    });
    await signIn(page);
    await page.goto('/orders');
    for (const id of [24118, 24113, 24112]) await page.getByLabel(`Select order #${id}`).check();
    await page.getByRole('button', { name: 'Change status', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Confirmed' }).click();
    await expect(page.getByRole('status')).toContainText('1 order moved to Confirmed. 2 could not move');
    await expect(page.getByText('2 selected')).toBeVisible();
    await expect(page.getByLabel('Select order #24113')).toBeChecked();
    await expect(page.getByLabel('Select order #24118')).not.toBeChecked();
    await page.getByRole('button', { name: 'Show the 2' }).click();
    await expect(page.getByText('#24113: It cannot move to confirmed.')).toBeVisible();
  });

  test('delete 3 asks "Delete 3 orders?" and sends the ids on confirm', async ({ page }) => {
    let sent: number[] = [];
    await serve(page, { onDelete: (b) => { sent = b.ids; return { message: 'ok', deletedCount: 3, deleted: 3, skipped: [] }; } });
    await signIn(page);
    await page.goto('/orders');
    for (const id of [24118, 24113, 24112]) await page.getByLabel(`Select order #${id}`).check();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Delete 3 orders?' })).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    expect(sent).toEqual([]);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('status')).toContainText('Deleted 3 orders');
    expect(sent).toEqual([24118, 24113, 24112]);
  });

  test('the row status menu shows the moves from /transitions', async ({ page }) => {
    await serve(page);
    await signIn(page);
    await page.goto('/orders');
    await page.getByRole('button', { name: /Change status of #24118/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Confirmed' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Cancelled' })).toBeVisible();
    await expect(page).toHaveURL(/\/orders$/);
  });
});
