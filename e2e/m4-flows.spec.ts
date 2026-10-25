import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, PASSWORD, signIn, stamp, tokenFor, uniquePhone } from './helpers/m3';

/**
 * M4-T37 (COD-46): the M4 flows that m4-products, m4-inventory and m4-deliveries do not cover. Real backend, no mocks.
 *
 * Covered elsewhere (see the table in the COD-46 report): the 9 October receive (m4-products), count 188 and the gap tag,
 * allocate + dispute + "Return to source", the stock keeper home, the move window warning (m4-inventory), the Deliveries
 * totals (m4-deliveries). This file adds: a public order delivered by Kofi, the Finding of a count, "Count is old" after a
 * move out, and the agent receiving through the API with a "Write off" resolve.
 *
 * Needs a stack on a local test database that holds the fixture (see e2e/m4-deliveries.spec.ts):
 *   backend: DATABASE_URL=<local ..._test_... db> npm run seed:fixture && npm run e2e:fixture-setup
 *   run:     E2E_BASE_URL=http://localhost:5202 E2E_API_URL=http://localhost:3102 npx playwright test e2e/m4-flows.spec.ts
 * The specs run in order and change stock, so run `npm run e2e:fixture-setup -- --undo` and seed again before a second run.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'fixture-admin@fixture-numbers.test';
const COPYBOOK = 'Magic Groove copybook set';
const GRIP = 'Pencil grip trainer';
const SLUG = `e2e-flows-${stamp()}`;

const authz = (token: string) => ({ Authorization: `Bearer ${token}` });
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const stockTable = (page: Page) => page.getByRole('table', { name: 'Stock by location' });
const recent = (page: Page) => page.getByRole('table', { name: 'Recent transfers' });
const stockRow = (page: Page, location: string, product: string) =>
  stockTable(page).getByRole('row').filter({ hasText: location }).filter({ hasText: product });

interface Level { locationId: number; locationName: string; productId: number; productName: string; onHand: number; reserved: number; inTransit: number }
interface Location { id: number; name: string; userId: number | null; latestCount: { countId: number; unitsOff: number; isOld: boolean } | null }

async function adminToken(request: APIRequestContext): Promise<string> {
  const token = await tokenFor(request, ADMIN);
  expect(token, 'the fixture admin must be able to sign in (npm run e2e:fixture-setup)').not.toBeNull();
  return token!;
}

async function overview(request: APIRequestContext, token: string): Promise<{ locations: Location[]; stockByLocation: Level[] }> {
  const res = await request.get(`${API_URL}/api/inventory/overview`, { headers: authz(token) });
  expect(res.status()).toBe(200);
  return res.json();
}

/** "location|product" -> on hand, for every row of the stock table. */
const onHandMap = (rows: Level[]) => Object.fromEntries(rows.map((r) => [`${r.locationName}|${r.productName}`, r.onHand]));

async function openPage(page: Page) {
  await signIn(page, ADMIN);
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory & stock' })).toBeVisible();
  await expect(card(page, 'Logiswift')).toBeVisible();
}

test('a public order for 3 copybooks, assigned to Kofi and delivered: Kofi on hand falls by 3, no other holder changes', async ({ page, request }) => {
  const token = await adminToken(request);
  const before = await overview(request, token);
  const kofi = before.locations.find((l) => l.name === 'Kofi Appiah')!;
  const copybook = before.stockByLocation.find((r) => r.productName === COPYBOOK)!;
  const kofiBefore = before.stockByLocation.find((r) => r.locationName === 'Kofi Appiah' && r.productName === COPYBOOK)!;

  // the owner makes a checkout form with one package of 3 sets
  const field = (id: string, label: string, type: string) => ({ id, label, type, required: true, enabled: true, standardKey: id });
  const made = await request.post(`${API_URL}/api/checkout-forms`, {
    headers: authz(token),
    data: {
      name: `E2E flows ${SLUG}`, slug: SLUG, productId: copybook.productId,
      fields: [
        field('fullName', 'Full Name', 'text'), field('phone', 'Phone', 'phone'), field('region', 'State', 'state'),
        field('town', 'City or town', 'text'), field('landmark', 'Nearest landmark', 'text'), field('streetAddress', 'Street address', 'textarea'),
      ],
      styling: {}, regions: { available: ['Greater Accra', 'Ashanti'] }, upsells: [],
      packages: [{ name: 'Three sets', price: 600, quantity: 3, isDefault: true }],
    },
  });
  expect(made.status(), await made.text()).toBe(201);

  // the customer fills the public form
  await page.goto(`/form/${SLUG}`);
  await page.getByText('Three sets').first().click();
  await page.locator('input[name="fullName"], input[placeholder*="Name"], input[placeholder*="name"]').first().fill('E2E Flows Buyer');
  await page.locator('input[name="phone"], input[type="tel"], input[placeholder*="hone"]').first().fill(uniquePhone());
  await page.locator('select[name="region"]').selectOption({ label: 'Greater Accra' });
  await page.locator('textarea[name="streetAddress"], input[name="streetAddress"]').first().fill('15 Main Street, Accra');
  await page.locator('select').filter({ hasText: 'Choose city/town' }).selectOption({ index: 1 });
  await page.getByPlaceholder(/Opposite Kasoa/).fill('Near the mall');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible({ timeout: 15000 });
  const orderId = Number((await page.getByTestId('order-number').innerText()).replace(/\D/g, ''));
  expect(orderId).toBeGreaterThan(0);

  // the owner assigns Kofi and moves the order to delivered
  const assign = await request.patch(`${API_URL}/api/orders/${orderId}/assign-agent`, { headers: authz(token), data: { deliveryAgentId: kofi.userId } });
  expect(assign.status(), await assign.text()).toBe(200);
  for (const status of ['confirmed', 'out_for_delivery', 'delivered']) {
    const res = await request.patch(`${API_URL}/api/orders/${orderId}/status`, { headers: authz(token), data: { status } });
    expect(res.status(), `${status}: ${await res.text()}`).toBe(200);
  }

  const after = await overview(request, token);
  const was = onHandMap(before.stockByLocation);
  const now = onHandMap(after.stockByLocation);
  expect(now[`Kofi Appiah|${COPYBOOK}`]).toBe(kofiBefore.onHand - 3);
  for (const key of Object.keys(was).filter((k) => k !== `Kofi Appiah|${COPYBOOK}`)) expect(now[key], key).toBe(was[key]);

  // the page shows the same
  await openPage(page);
  await expect(stockRow(page, 'Kofi Appiah', COPYBOOK)).toContainText(String(kofiBefore.onHand - 3));
  await expect(stockRow(page, 'Logiswift', COPYBOOK)).toContainText('200');

  await request.delete(`${API_URL}/api/checkout-forms/${(await made.json()).form.id}`, { headers: authz(token) });
});

test('count Logiswift 188 against 200: the gap tag says 12 units off and the count carries one open Finding worth GH₵360', async ({ page, request }) => {
  await openPage(page);
  await page.getByRole('button', { name: 'Start stock count' }).click();
  const sheet = page.getByRole('dialog', { name: 'Start a stock count' });
  await sheet.getByLabel('Location').selectOption({ label: 'Logiswift' });
  await sheet.getByLabel(`Counted ${COPYBOOK}`).fill('188');
  await sheet.getByRole('button', { name: 'Save count' }).click();
  const result = page.getByRole('dialog', { name: 'Stock count saved' });
  await expect(result.getByRole('region', { name: COPYBOOK })).toContainText('Our records said 200. Counted 188.');
  await result.getByRole('button', { name: 'Done' }).click();

  await expect(card(page, 'Logiswift')).toContainText('12 units off');
  await expect(stockRow(page, 'Logiswift', COPYBOOK)).toContainText('200 vs 188');

  const token = await adminToken(request);
  const swift = (await overview(request, token)).locations.find((l) => l.name === 'Logiswift')!;
  const detail = await request.get(`${API_URL}/api/inventory/counts/${swift.latestCount!.countId}`, { headers: authz(token) });
  expect(detail.status(), await detail.text()).toBe(200);
  const lines = (await detail.json()).count.lines as Array<{ productId: number; difference: number; finding: { status: string; amount: number | string } | null }>;
  const gap = lines.filter((l) => l.difference !== 0);
  expect(gap).toHaveLength(1);
  expect(gap[0].difference).toBe(-12);
  expect(gap[0].finding?.status).toBe('open');
  expect(Number(gap[0].finding?.amount)).toBe(360);
});

test('after a move out of the counted Logiswift, the card and the row say "Count is old"', async ({ page }) => {
  await openPage(page);
  await expect(card(page, 'Logiswift')).toContainText('12 units off');

  await page.getByRole('button', { name: 'Move stock' }).click();
  await page.getByRole('menuitem', { name: 'Allocate to an agent' }).click();
  const modal = page.getByRole('dialog', { name: 'Allocate to an agent' });
  await modal.getByLabel('Product').selectOption({ label: COPYBOOK });
  await modal.getByLabel('From').selectOption({ label: 'Logiswift' });
  await modal.getByLabel('To', { exact: true }).selectOption({ label: 'Esi Badu' });
  await modal.getByLabel('Quantity').fill('5');
  await modal.getByRole('button', { name: 'Allocate to an agent' }).click();
  await expect(page.getByRole('status')).toContainText('Allocated 5');

  await expect(card(page, 'Logiswift')).toContainText('Count is old');
  await expect(card(page, 'Logiswift')).not.toContainText('units off');
  await expect(stockRow(page, 'Logiswift', COPYBOOK)).toContainText('Count is old');
  // a product that did not move keeps its tag
  await expect(stockRow(page, 'Logiswift', GRIP)).toContainText('Matches');
});

test('an agent receives through the API with the agent token; the owner writes off the short units', async ({ page, request }) => {
  const token = await adminToken(request);
  const email = `e2e-flows-agent-${stamp()}@codadmin.test`;
  const lastName = `Efua${stamp()}`;
  const made = await request.post(`${API_URL}/api/delivery-partners`, {
    data: { kind: 'person', firstName: 'E2E', lastName, email, password: PASSWORD, daysToPay: 2, phoneNumber: uniquePhone() },
    headers: authz(token),
  });
  expect(made.status(), await made.text()).toBe(201);
  const name = `E2E ${lastName}`;

  const data = await overview(request, token);
  const swift = data.locations.find((l) => l.name === 'Logiswift')!;
  const agent = data.locations.find((l) => l.name === name)!;
  const grip = data.stockByLocation.find((r) => r.locationName === 'Logiswift' && r.productName === GRIP)!;
  expect(grip.onHand).toBe(180);

  const sent = await request.post(`${API_URL}/api/inventory/transfers`, {
    data: { type: 'allocation', productId: grip.productId, quantity: 10, fromLocationId: swift.id, toLocationId: agent.id },
    headers: authz(token),
  });
  expect(sent.status(), await sent.text()).toBe(201);
  const transferId = (await sent.json()).transfer.id as number;

  // the agent counts 8 and says 2 were short in the package
  const agentToken = (await tokenFor(request, email))!;
  expect(agentToken).toBeTruthy();
  const received = await request.post(`${API_URL}/api/inventory/transfers/${transferId}/receive`, {
    data: { quantity: 8, reason: 'short_in_package' },
    headers: authz(agentToken),
  });
  expect(received.status(), await received.text()).toBe(200);
  expect((await received.json()).transfer.status).toBe('disputed');

  // the agent cannot resolve their own dispute
  const own = await request.post(`${API_URL}/api/inventory/transfers/${transferId}/resolve`, { data: { action: 'write_off' }, headers: authz(agentToken) });
  expect(own.status()).toBe(403);

  await openPage(page);
  const row = recent(page).getByRole('row').filter({ hasText: name }).first();
  await expect(row).toContainText('Received 2 short');
  await row.getByRole('button', { name: /Resolve/ }).click();
  const resolve = page.getByRole('dialog', { name: 'Resolve the shortage' });
  await resolve.getByLabel(/Write off/).check();
  await resolve.getByRole('button', { name: 'Resolve' }).click();
  await expect(row).toContainText('Resolved');

  // write off: the 2 units are not put back. Logiswift 180 - 10 = 170, the agent holds 8.
  const after = (await overview(request, token)).stockByLocation;
  expect(after.find((r) => r.locationName === 'Logiswift' && r.productName === GRIP)!.onHand).toBe(170);
  expect(after.find((r) => r.locationName === name && r.productName === GRIP)!.onHand).toBe(8);
});
