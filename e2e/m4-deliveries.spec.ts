import { test, expect, type Page } from '@playwright/test';
import { API_URL, signIn, stamp } from './helpers/m3';

/**
 * M4-T30 to T33 (COD-45): the Deliveries page on the NUMBERS.md fixture. Real backend, no mocks.
 *
 * Needs a stack on a local test database that holds the fixture:
 *   backend: DATABASE_URL=<local ..._test_... db> npm run seed:fixture && npm run e2e:fixture-setup
 *            (the setup step sets the fixture admin's password, makes Logiswift and Kasapa companies, adds partner profiles
 *            and gives one delivered order of Kofi a proof photo; it refuses any other database)
 *   frontend: VITE_API_URL=relative VITE_PROXY_TARGET=http://localhost:3102 npx vite --port 5202 (a photo link on another origin is refused by the API)
 *   run:     E2E_BASE_URL=http://localhost:5202 E2E_API_URL=http://localhost:3102 npx playwright test e2e/m4-deliveries.spec.ts
 * The specs run in order and the last one adds a partner, so seed again before a second run.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'fixture-admin@fixture-numbers.test';
const PAGE_URL = '/delivery-agents';

const row = (page: Page, name: string) => page.getByRole('table', { name: 'Delivery partners' }).getByRole('row').filter({ hasText: name });

async function openPage(page: Page) {
  await signIn(page, ADMIN);
  await page.goto(PAGE_URL);
  await expect(page.getByRole('heading', { name: 'Deliveries' })).toBeVisible();
  await expect(row(page, 'Logiswift')).toBeVisible();
}

test('tabs show 5 / 3 / 2 and really filter; the total row holds the fixture numbers', async ({ page }) => {
  await openPage(page);
  const tab = (name: RegExp) => page.getByRole('tab', { name });
  await expect(tab(/All partners/)).toContainText('5');
  await expect(tab(/Agents/)).toContainText('3');
  await expect(tab(/3PLs/)).toContainText('2');

  const total = page.getByRole('table', { name: 'Delivery partners' }).locator('tfoot tr');
  for (const v of ['926', '376', '402', '148', '48%']) await expect(total).toContainText(v);
  await expect(row(page, 'Kasapa Express')).toContainText('No closed orders yet');

  await tab(/3PLs/).click();
  await expect(row(page, 'Logiswift')).toBeVisible();
  await expect(row(page, 'Kasapa Express')).toBeVisible();
  await expect(row(page, 'Kofi Appiah')).toHaveCount(0);
  await expect(total).toContainText('598'); // 590 + 8

  await tab(/Agents/).click();
  await expect(row(page, 'Kofi Appiah')).toBeVisible();
  await expect(row(page, 'Logiswift')).toHaveCount(0);
  await expect(total).toContainText('328'); // 172 + 102 + 54
});

test('the reasons card adds up to 402 and a reason opens Orders filtered', async ({ page }) => {
  await openPage(page);
  const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Failed and returned by reason' }) });
  await expect(card).toContainText('354');
  await expect(card).toContainText('48');
  const counts = await card.locator('.bar-row .val small').allTextContents();
  expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(402);

  await card.getByRole('link', { name: /^Refused/ }).click();
  await expect(page).toHaveURL(/\/orders\?failure=refused/);
  await expect(page.getByText('Showing failed and returned orders where the reason is refused.')).toBeVisible();
  await expect(page.getByText('Showing 25 of 96 orders')).toBeVisible();
});

test('the reasons card shows 5 returned units missing (41 sent, 36 received) with a link to the 3PL stock', async ({ page }) => {
  await openPage(page);
  const card = page.locator('.card', { has: page.getByRole('heading', { name: 'Failed and returned by reason' }) });
  const line = card.locator('p.note', { hasText: 'Returned units missing' });
  await expect(line).toContainText('Returned units missing: 5. Logiswift sent back 41 units. We received 36.');
  await expect(line.getByRole('link', { name: 'See it in Inventory' })).toHaveAttribute('href', /^\/inventory\?location=\d+$/);
});

test('open Kofi: the Orders tab shows a proof photo, a save writes an audit row', async ({ page, request }) => {
  await openPage(page);
  await row(page, 'Kofi Appiah').click();
  const drawer = page.getByRole('dialog', { name: /Kofi Appiah/ });
  await expect(drawer).toBeVisible();

  await drawer.getByRole('tab', { name: 'Orders' }).click();
  await drawer.getByLabel('Status').selectOption('delivered');
  const photo = drawer.getByRole('img', { name: 'Delivery proof' }).first();
  await expect(photo).toBeVisible();
  // the signed link really serves an image
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

  await drawer.getByRole('tab', { name: 'Stock' }).click();
  const figs = drawer.locator('.dstock .dfig');
  await expect(figs).toContainText('On hand');
  await expect(figs).toContainText('Reserved');
  await expect(drawer.getByRole('list', { name: 'Stock at Kofi Appiah' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'See Kofi Appiah in Inventory' })).toHaveAttribute('href', /^\/inventory\?location=\d+$/);

  await drawer.getByRole('tab', { name: 'Fees' }).click();
  const days = drawer.getByLabel('Days to pay');
  await expect(days).toHaveValue('2');
  await days.fill('4');
  await drawer.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Partner saved')).toBeVisible();

  const login = await request.post(`${API_URL}/api/auth/login`, { data: { email: ADMIN, password: 'password123' } });
  const token = (await login.json()).tokens.accessToken as string;
  const audit = await request.get(`${API_URL}/api/audit-log?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
  expect(audit.ok(), await audit.text()).toBe(true);
  const rows = (await audit.json()).logs as Array<{ resource?: string; action?: string }>;
  expect(rows.some((r) => r.resource === 'delivery_partner' && r.action === 'update')).toBe(true);

  // the open drawer is in the URL, so a reload opens it again
  await page.reload();
  await page.getByRole('dialog', { name: /Kofi Appiah/ }).getByRole('tab', { name: 'Fees' }).click();
  await expect(page.getByLabel('Days to pay')).toHaveValue('4');
});

test('the availability switch changes the tag', async ({ page }) => {
  await openPage(page);
  const esi = row(page, 'Esi Badu');
  await expect(esi.getByText('Unavailable')).toHaveCount(0);
  await esi.getByRole('switch', { name: /Esi Badu available/ }).click({ force: true });
  await expect(esi.getByText('Unavailable')).toBeVisible();
  await esi.getByRole('switch', { name: /Esi Badu available/ }).click({ force: true });
  await expect(esi.getByText('Unavailable')).toHaveCount(0);
});

test('add a partner: it shows in the list, in the right tab, and its drawer opens on Fees', async ({ page }) => {
  await openPage(page);
  const name = `E2E Haulers ${stamp()}`;
  await page.getByRole('button', { name: 'Add delivery partner' }).click();
  const modal = page.getByRole('dialog', { name: 'Add delivery partner' });
  await modal.getByLabel('Type', { exact: true }).selectOption('company');
  await modal.getByLabel('Company name').fill(name);
  await modal.getByLabel('Email').fill(`e2e-haulers-${stamp()}@codadmin.test`);
  await modal.getByLabel(/Base town/).fill('Tamale');
  await modal.getByRole('button', { name: 'Add partner' }).click();

  const drawer = page.getByRole('dialog', { name: new RegExp(name) });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Days to pay')).toHaveValue('7'); // opened on Fees
  await drawer.getByRole('button', { name: 'Close' }).click();

  await expect(row(page, name)).toBeVisible();
  await expect(page.getByRole('tab', { name: /3PLs/ })).toContainText('3');
  await page.getByRole('tab', { name: /3PLs/ }).click();
  await expect(row(page, name)).toBeVisible();
});
