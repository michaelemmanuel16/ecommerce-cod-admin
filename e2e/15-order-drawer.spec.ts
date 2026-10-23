import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * M3-T46, T47 (F-321, F-322, F-318): the order details drawer.
 * The orders API is served by routes inside each test, so the numbers do not depend on the dev database. The detail,
 * timeline and edit routes follow the backend contract: PUT answers 409 STALE_ORDER when the body's `updatedAt` is not
 * the stored one. Needs the dev users (password123) and the frontend. Point E2E_BASE_URL at the Vite port.
 */

const PASSWORD = 'password123';
const ID = 24118;

interface Server {
  updatedAt: string;
  address: string;
  puts: Array<Record<string, unknown>>;
}

const detail = (s: Server) => ({
  id: ID,
  displayNumber: `#${ID}`,
  status: 'pending_confirmation',
  orderType: 'physical',
  createdAt: '2026-10-17T14:02:00.000Z',
  updatedAt: s.updatedAt,
  statusVersion: 0,
  source: 'checkout_form',
  sourceLabel: 'Checkout form: Magic Groove copybook set',
  notes: null,
  deliveryAddress: s.address,
  deliveryState: 'Ashanti',
  deliveryArea: 'Kumasi',
  discount: '0.00',
  subtotal: '249.00',
  totalAmount: '249.00',
  customer: { id: 7, firstName: 'Abena', lastName: 'Owusu', email: null, phoneNumber: '+233245550182', alternatePhone: null },
  items: [{ id: 1, productId: 1, quantity: 1, unitPrice: '249.00', totalPrice: '249.00', itemType: 'package', metadata: null, product: { id: 1, name: 'Copybook set' } }],
  assignees: { customerRep: null, deliveryAgent: null },
  calls: [],
  messages: [],
  flags: [],
  transitions: { status: 'pending_confirmation', normal: ['confirmed', 'cancelled'], forced: [] },
  paymentTag: { code: 'pay_on_delivery', label: 'Pay on delivery' },
  payment: { method: 'cod', status: 'pending', amount: '249.00', deposit: null },
});

const listRow = {
  id: ID,
  status: 'pending_confirmation',
  orderType: 'physical',
  totalAmount: 249,
  createdAt: '2026-10-17T14:02:00.000Z',
  customer: { id: 7, firstName: 'Abena', lastName: 'Owusu', phoneNumber: '+233245550182', alternatePhone: null },
  customerRep: null,
  deliveryAgent: null,
  orderItems: [{ id: 1, quantity: 1, product: { id: 1, name: 'Copybook set' } }],
  flags: [],
  reminder: null,
  threadCount: null,
};

const COUNTS = {
  all: 1,
  byStatus: { pending_confirmation: 1, payment_pending: 0, confirmed: 0, preparing: 0, ready_for_pickup: 0, out_for_delivery: 0, delivered: 0, digital_delivered: 0, cancelled: 0, returned: 0, failed_delivery: 0, payment_failed: 0 },
  waitingToDispatch: 0,
};

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'admin@codadmin.com');
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

async function serve(context: BrowserContext): Promise<Server> {
  const s: Server = { updatedAt: '2026-10-17T14:05:00.000Z', address: '14 Adum Road, Adum', puts: [] };
  await context.route(/\/api\/search(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [{ id: ID, status: 'pending_confirmation', totalAmount: 249, createdAt: listRow.createdAt, customer: listRow.customer }], customers: [] }) }),
  );
  await context.route(/\/api\/orders(\/[^?]*)?(\?.*)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/counts')) return json(COUNTS);
    if (url.pathname.endsWith('/timeline')) {
      return json({ timeline: [{ kind: 'placed', size: 'main', at: listRow.createdAt, title: 'Order placed', actor: null, note: null }] });
    }
    if (url.pathname.endsWith('/transitions')) return json({ status: 'pending_confirmation', normal: ['confirmed', 'cancelled'], forced: [] });
    if (url.pathname.endsWith(`/api/orders/${ID}`) && req.method() === 'GET') return json({ order: detail(s) });
    if (url.pathname.endsWith(`/api/orders/${ID}`) && req.method() === 'PUT') {
      const body = req.postDataJSON();
      s.puts.push(body);
      if (body.updatedAt !== s.updatedAt) return json({ code: 'STALE_ORDER', message: 'This order changed. Reload to see the new data.' }, 409);
      if (body.deliveryAddress) s.address = body.deliveryAddress;
      s.updatedAt = '2026-10-17T15:00:00.000Z';
      return json({ order: detail(s) });
    }
    if (url.pathname.endsWith('/api/orders') && req.method() === 'GET') {
      return json({ orders: [listRow], pagination: { page: 1, limit: 25, total: 1, pages: 1 } });
    }
    return route.continue();
  });
  return s;
}

test.describe('T46 frame and blocks', () => {
  test('opens from a list row, keeps the list behind it, and Esc closes it', async ({ page, context }) => {
    await serve(context);
    await signIn(page);
    await page.goto('/orders');
    await page.getByText(`#${ID}`, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${ID}$`));
    const drawer = page.getByRole('dialog', { name: `#${ID}` });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/17 Oct, 14:02 · Checkout form: Magic Groove copybook set/)).toBeVisible();
    await expect(drawer.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+233245550182');
    await expect(drawer.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550182');
    await expect(drawer.getByText('024 555 0182')).toBeVisible();
    // the list is still there behind the drawer
    await expect(page.getByRole('tab', { name: /^All/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/orders$/);
    await expect(drawer).toBeHidden();
  });

  test('opens from its own URL, and the Close button closes it', async ({ page, context }) => {
    await serve(context);
    await signIn(page);
    await page.goto(`/orders/${ID}`);
    const drawer = page.getByRole('dialog', { name: `#${ID}` });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole('tab', { name: /^All/ })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).last().click();
    await expect(page).toHaveURL(/\/orders$/);
  });

  test('opens from the command palette search', async ({ page, context }) => {
    await serve(context);
    await signIn(page);
    await page.goto('/orders');
    await page.locator('button.search').click();
    await page.getByLabel('Command menu search').fill('24118');
    await page.getByRole('option', { name: new RegExp(`#${ID}`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/orders/${ID}$`));
    await expect(page.getByRole('dialog', { name: `#${ID}` })).toBeVisible();
  });

  test('fills the whole screen on a phone', async ({ page, context }) => {
    await serve(context);
    await page.setViewportSize({ width: 390, height: 800 });
    await signIn(page);
    await page.goto(`/orders/${ID}`);
    const box = await page.getByRole('dialog', { name: `#${ID}` }).boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(390);
  });
});

test.describe('T47 edit mode', () => {
  test('edits the address of a pending order and the timeline reloads', async ({ page, context }) => {
    const server = await serve(context);
    await signIn(page);
    await page.goto(`/orders/${ID}`);
    const drawer = page.getByRole('dialog', { name: `#${ID}` });
    await drawer.getByRole('button', { name: /Edit/ }).click();
    await drawer.getByLabel('Delivery address').fill('9 New Road, Adum');
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`#${ID} saved`)).toBeVisible();
    expect(server.puts[0]).toMatchObject({ deliveryAddress: '9 New Road, Adum', updatedAt: '2026-10-17T14:05:00.000Z' });
    await expect(drawer.getByText('9 New Road, Adum')).toBeVisible();
  });

  test('a second tab that saves after the first sees "This order changed. Reload to see the new data."', async ({ page, context }) => {
    await serve(context);
    await signIn(page);
    await page.goto(`/orders/${ID}`);
    const second = await context.newPage();
    await second.goto(`/orders/${ID}`);
    const one = page.getByRole('dialog', { name: `#${ID}` });
    const two = second.getByRole('dialog', { name: `#${ID}` });
    await one.getByRole('button', { name: /Edit/ }).click();
    await two.getByRole('button', { name: /Edit/ }).click();

    await one.getByLabel('Delivery address').fill('From tab one');
    await one.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`#${ID} saved`)).toBeVisible();

    await two.getByLabel('Delivery address').fill('From tab two');
    await two.getByRole('button', { name: 'Save changes' }).click();
    await expect(two.getByRole('alert')).toHaveText(/This order changed\. Reload to see the new data\./);
    await two.getByRole('button', { name: 'Reload' }).click();
    await expect(two.getByText('From tab one')).toBeVisible();
  });
});
