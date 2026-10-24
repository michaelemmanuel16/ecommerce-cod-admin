import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, PASSWORD, signIn, stamp, tokenFor, uniquePhone } from './helpers/m3';

/**
 * M4-T25 to T29 (COD-44): the Inventory page on the NUMBERS.md fixture. Real backend, no mocks.
 *
 * Needs a stack on a local test database that holds the fixture (see e2e/m4-deliveries.spec.ts):
 *   backend: DATABASE_URL=<local ..._test_... db> npm run seed:fixture && npm run e2e:fixture-setup
 *   run:     E2E_BASE_URL=http://localhost:5203 E2E_API_URL=http://localhost:3103 npx playwright test e2e/m4-inventory.spec.ts
 * The specs run in order and change stock, so seed again before a second run. Run `npm run e2e:fixture-setup -- --undo` first:
 * it also removes the notifications this spec leaves, which would block the fixture re-seed.
 *
 * Fixture numbers (the API's, not the mockup's): Logiswift holds 442 on hand and 116 reserved (200 / 62 / 180), the Magic
 * Groove copybook set is 12 units under our records (200 against the 3PL count of 188), Kofi holds 99 with 20 in transit.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'fixture-admin@fixture-numbers.test';
const COPYBOOK = 'Magic Groove copybook set';

const authz = (token: string) => ({ Authorization: `Bearer ${token}` });
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const stockTable = (page: Page) => page.getByRole('table', { name: 'Stock by location' });
const recent = (page: Page) => page.getByRole('table', { name: 'Recent transfers' });
const stockRow = (page: Page, location: string, product: string) =>
  stockTable(page).getByRole('row').filter({ hasText: location }).filter({ hasText: product });

async function openPage(page: Page, query = '') {
  await signIn(page, ADMIN);
  await page.goto(`/inventory${query}`);
  await expect(page.getByRole('heading', { name: 'Inventory & stock' })).toBeVisible();
  await expect(card(page, 'Logiswift')).toBeVisible();
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const token = await tokenFor(request, ADMIN);
  expect(token, 'the fixture admin must be able to sign in (npm run e2e:fixture-setup)').not.toBeNull();
  return token!;
}

async function overview(request: APIRequestContext, token: string) {
  const res = await request.get(`${API_URL}/api/inventory/overview`, { headers: authz(token) });
  expect(res.status()).toBe(200);
  return res.json();
}

test('cards carry the fixture numbers and the count tag; the table row shows the difference 12', async ({ page }) => {
  await openPage(page);
  const swift = card(page, 'Logiswift');
  await expect(swift).toContainText('442');
  await expect(swift).toContainText('116');
  await expect(swift).toContainText('12 units off');
  await expect(card(page, 'Kofi Appiah')).toContainText('99');
  await expect(card(page, 'Kofi Appiah')).toContainText('20');

  const row = stockRow(page, 'Logiswift', COPYBOOK);
  await expect(row).toContainText('200 vs 188');
  await expect(row).toContainText('12 units');
  await expect(stockRow(page, 'Logiswift', 'Pencil grip trainer')).toContainText('Matches');
});

test('?product= and ?location= pre-filter the table; the stock count opens from ?action=count', async ({ page, request }) => {
  const token = await adminToken(request);
  const data = await overview(request, token);
  const grip = data.stockByLocation.find((r: { productName: string }) => r.productName === 'Pencil grip trainer');
  const kofi = data.locations.find((l: { name: string }) => l.name === 'Kofi Appiah');

  await openPage(page, `?product=${grip.productId}`);
  await expect(stockTable(page).getByRole('row')).toHaveCount(3); // header + Logiswift + Kofi
  await expect(stockTable(page)).not.toContainText(COPYBOOK);

  await page.goto(`/inventory?location=${kofi.id}`);
  await expect(stockRow(page, 'Kofi Appiah', COPYBOOK)).toBeVisible();
  await expect(stockTable(page)).not.toContainText('Logiswift');

  await page.goto('/inventory?action=count');
  await expect(page.getByRole('dialog', { name: 'Start a stock count' })).toBeVisible();
  await expect(page).toHaveURL(/\/inventory$/);
});

test('count Logiswift 188, apply with "Short on arrival": the gap becomes 0', async ({ page }) => {
  await openPage(page);
  await page.getByRole('button', { name: 'Start stock count' }).click();
  const sheet = page.getByRole('dialog', { name: 'Start a stock count' });
  await sheet.getByLabel('Location').selectOption({ label: 'Logiswift' });
  await expect(sheet.getByLabel('Who counted')).toHaveValue('three_pl_dashboard');
  await sheet.getByLabel(`Counted ${COPYBOOK}`).fill('188');
  await expect(sheet.getByText('12 units differ from our records.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save count' }).click();

  const result = page.getByRole('dialog', { name: 'Stock count saved' });
  const line = result.getByRole('region', { name: COPYBOOK });
  await expect(line).toContainText('Our records said 200. Counted 188.');
  await line.getByLabel('Reason').selectOption({ label: 'Short on arrival' });
  await line.getByRole('button', { name: 'Apply count' }).click();
  await expect(line.getByText('Applied')).toBeVisible();
  await result.getByRole('button', { name: 'Done' }).click();

  await expect(card(page, 'Logiswift')).toContainText('Matches');
  await expect(stockRow(page, 'Logiswift', COPYBOOK)).toContainText('188 vs 188');
  await expect(stockRow(page, 'Logiswift', COPYBOOK)).toContainText('Matches');
});

test('allocate 10 to Kofi: the transfer shows "In transit" and the table updates', async ({ page }) => {
  await openPage(page);
  await page.getByRole('button', { name: 'Move stock' }).click();
  await page.getByRole('menuitem', { name: 'Allocate to an agent' }).click();
  const modal = page.getByRole('dialog', { name: 'Allocate to an agent' });
  await modal.getByLabel('Product').selectOption({ label: COPYBOOK });
  await modal.getByLabel('From').selectOption({ label: 'Logiswift' });
  await expect(modal.getByText('188 available')).toBeVisible();
  await modal.getByLabel('To', { exact: true }).selectOption({ label: 'Kofi Appiah' });
  await modal.getByLabel('Quantity').fill('10');
  await modal.getByRole('button', { name: 'Allocate to an agent' }).click();

  await expect(page.getByRole('status')).toContainText('Allocated 10');
  const first = recent(page).getByRole('row').nth(1);
  await expect(first).toContainText('Kofi Appiah');
  await expect(first).toContainText('In transit');
  await expect(stockRow(page, 'Kofi Appiah', COPYBOOK)).toContainText('30'); // 20 + 10 in transit
  await expect(stockRow(page, 'Logiswift', COPYBOOK)).toContainText('178');
});

test('receive 8 of 10 with a reason: "Received 2 short"; resolve with "Return to source"', async ({ page, request }) => {
  await openPage(page);
  // 10 copybooks to the other 3PL, which the stock keeper confirms on its behalf
  await page.getByRole('button', { name: 'Move stock' }).click();
  await page.getByRole('menuitem', { name: 'Allocate to an agent' }).click();
  const modal = page.getByRole('dialog', { name: 'Allocate to an agent' });
  await modal.getByLabel('Product').selectOption({ label: COPYBOOK });
  await modal.getByLabel('From').selectOption({ label: 'Logiswift' });
  await modal.getByLabel('To', { exact: true }).selectOption({ label: 'Kasapa Express' });
  await modal.getByLabel('Quantity').fill('10');
  await modal.getByRole('button', { name: 'Allocate to an agent' }).click();

  const row = recent(page).getByRole('row').filter({ hasText: 'Kasapa Express' }).first();
  await expect(row).toContainText('In transit');
  await row.getByRole('button', { name: /Confirm received/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm received' });
  await dialog.getByLabel('Counted on arrival').fill('8');
  await dialog.getByLabel('Reason').selectOption({ label: 'Short in package' });
  await dialog.getByRole('button', { name: 'Confirm received' }).click();
  await expect(row).toContainText('Received 2 short');

  await row.getByRole('button', { name: /Resolve/ }).click();
  const resolve = page.getByRole('dialog', { name: 'Resolve the shortage' });
  await resolve.getByLabel(/Return to source/).check();
  await resolve.getByRole('button', { name: 'Resolve' }).click();
  await expect(row).toContainText('Resolved');

  // the 2 short units are back at Logiswift: 178 - 10 + 2
  const data = await overview(request, await adminToken(request));
  const swift = data.stockByLocation.find((r: { locationName: string; productName: string }) => r.locationName === 'Logiswift' && r.productName === COPYBOOK);
  expect(swift.onHand).toBe(170);
});

test('the history modal lists the moves and opens the audit trail of one', async ({ page }) => {
  await openPage(page);
  await page.getByRole('button', { name: 'Transfer history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer history' });
  await expect(dialog.getByRole('tab', { name: /^All \d/ })).toBeVisible();
  await dialog.getByRole('table', { name: 'Transfer history' }).getByRole('row').filter({ hasText: 'Kasapa Express' }).first().click();
  const detail = dialog.getByRole('complementary');
  await expect(detail).toContainText('Audit trail');
  await expect(detail.getByText('Dispute resolved')).toBeVisible();
  await expect(detail.getByText('Counted on arrival')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: /Export CSV/ }).click()]);
  expect(download.suggestedFilename()).toBe('stock-moves.csv');
});

test('a stock keeper signs in and lands on Inventory', async ({ page, request }) => {
  const token = await adminToken(request);
  const email = `e2e-stock-${stamp()}@codadmin.test`;
  const res = await request.post(`${API_URL}/api/users`, {
    data: { email, password: PASSWORD, firstName: 'E2E', lastName: 'Keeper', phoneNumber: uniquePhone(), role: 'inventory_manager' },
    headers: authz(token),
  });
  expect(res.status(), await res.text()).toBe(201);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole('heading', { name: 'Inventory & stock' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start stock count' })).toBeVisible();
});

test('the agent screen shows the agent\'s own stock only and lets the agent confirm what was sent', async ({ page, request }) => {
  const token = await adminToken(request);
  const email = `e2e-agent-${stamp()}@codadmin.test`;
  const made = await request.post(`${API_URL}/api/delivery-partners`, {
    data: { kind: 'person', firstName: 'E2E', lastName: 'Ama', email, password: PASSWORD, daysToPay: 2, phoneNumber: uniquePhone() },
    headers: authz(token),
  });
  expect(made.status(), await made.text()).toBe(201);

  const data = await overview(request, token);
  const swift = data.locations.find((l: { name: string }) => l.name === 'Logiswift');
  const ama = data.locations.find((l: { name: string }) => l.name === 'E2E Ama');
  const pens = data.stockByLocation.find((r: { productName: string }) => /pens/i.test(r.productName));
  const sent = await request.post(`${API_URL}/api/inventory/transfers`, {
    data: { type: 'allocation', productId: pens.productId, quantity: 5, fromLocationId: swift.id, toLocationId: ama.id },
    headers: authz(token),
  });
  expect(sent.status(), await sent.text()).toBe(201);

  await signIn(page, email);
  await page.goto('/agent-inventory');
  await expect(page.getByRole('heading', { name: 'My Inventory' })).toBeVisible();
  await expect(page.getByText('Waiting for you')).toBeVisible();
  await page.getByRole('button', { name: /Confirm received: / }).click();
  await page.getByRole('dialog', { name: 'Confirm received' }).getByRole('button', { name: 'Confirm received' }).click();

  const mine = page.getByRole('table', { name: 'My stock' });
  await expect(mine).toContainText(pens.productName);
  await expect(mine).toContainText('5');
  await expect(mine).not.toContainText(COPYBOOK); // other holders' products are not in the answer
  await expect(page.getByRole('row')).toHaveCount(2);

  // the API itself refuses another location
  const agentToken = await tokenFor(request, email);
  const other = await request.get(`${API_URL}/api/inventory/levels?locationId=${swift.id}`, { headers: authz(agentToken!) });
  expect(other.status()).toBe(403);
});
