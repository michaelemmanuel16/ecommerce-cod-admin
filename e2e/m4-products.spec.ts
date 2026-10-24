import { test, expect, type Page } from '@playwright/test';
import { signIn, stamp } from './helpers/m3';

/**
 * M4-T21 to T24 (COD-43): the Products page, the product drawer, the Incoming shipments tab and the receive modal on the
 * NUMBERS.md fixture. Real backend, no mocks.
 *
 * Needs a stack on a local test database that holds the fixture:
 *   backend: DATABASE_URL=<local ..._test_... db> npm run seed:fixture && npm run e2e:fixture-setup
 *   run:     E2E_BASE_URL=http://localhost:5201 E2E_API_URL=http://localhost:3101 npx playwright test e2e/m4-products.spec.ts
 * The specs run in order and add rows (a product, two shipments), so seed again before a second run.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = 'fixture-admin@fixture-numbers.test';
const COPYBOOK = 'Magic Groove copybook set';
const SKU = `E2E-${stamp()}`.slice(0, 14);

const productRow = (page: Page, name: string) => page.getByRole('table', { name: 'Products' }).getByRole('row').filter({ hasText: name }).first();

async function openProducts(page: Page, query = '') {
  await signIn(page, ADMIN);
  await page.goto(`/products${query}`);
  await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible();
  if (!query.includes('pane=shipments')) await expect(productRow(page, COPYBOOK)).toBeVisible();
}

test('the tiles show the best seller (306) and the margins follow the product costs', async ({ page }) => {
  await openProducts(page);
  const best = page.locator('.card.kpi', { hasText: 'Best seller this month' });
  await expect(best).toContainText(COPYBOOK);
  await expect(best).toContainText('306');
  await expect(productRow(page, COPYBOOK)).toContainText('88%');
  await expect(productRow(page, 'Refill pens')).toContainText('70%');
  await expect(page.locator('.card.kpi', { hasText: 'Average margin' })).toContainText('%');
});

test('the expansion lists the holders, notes the count gap at Logiswift and has no Allocate or Transfer button', async ({ page }) => {
  await openProducts(page);
  await productRow(page, COPYBOOK).getByRole('button', { name: /Show stock by holder/ }).click();
  const holders = page.getByRole('table', { name: 'Stock by holder' });
  await expect(holders).toContainText('Logiswift');
  await expect(holders).toContainText('Kofi Appiah');
  await expect(page.locator('.exnote').filter({ hasText: 'Logiswift' }).first()).toContainText(/Our records say \d+ on hand at Logiswift\. The .* count of .* says 188\./);
  const expansion = page.locator('tr.exp');
  await expect(expansion.getByRole('link', { name: /Open in Inventory/ })).toHaveAttribute('href', /\/inventory\?product=\d+/);
  await expect(expansion.getByRole('button', { name: /allocate|transfer/i })).toHaveCount(0);
  await expect(expansion.getByRole('link', { name: /allocate|transfer/i })).toHaveCount(0);
});

test('a physical product with a starting stock of 20 at Logiswift shows level 20; archive says what it still holds', async ({ page }) => {
  await openProducts(page);
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add product' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Product name').fill(`E2E bolts ${SKU}`);
  await drawer.getByLabel('SKU').fill(SKU);
  await drawer.getByLabel('Category').fill('Hardware');
  await drawer.getByLabel('Selling price').fill('50');
  await drawer.getByLabel('Cost per unit').fill('20');
  await expect(drawer.getByTestId('live-margin')).toContainText('60%');
  await drawer.getByLabel('Starting stock').fill('20');
  await drawer.getByLabel('Holder').selectOption({ label: 'Logiswift' });
  await drawer.getByRole('button', { name: 'Save product' }).click();

  const row = productRow(page, `E2E bolts ${SKU}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('20');
  await row.getByRole('button', { name: /Show stock by holder/ }).click();
  await expect(page.getByRole('table', { name: 'Stock by holder' }).getByRole('row').filter({ hasText: 'Logiswift' })).toContainText('20');

  await row.getByRole('button', { name: /^Edit / }).click();
  const edit = page.getByRole('dialog', { name: 'Edit product' });
  await expect(edit.getByLabel('Product name')).toHaveValue(`E2E bolts ${SKU}`);
  await edit.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(edit.getByRole('status')).toContainText('0 open orders, 20 units on hand');
  // Closed and opened again from the Archived tab: the drawer still opens it, with Restore
  await edit.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: /Archived/ }).click();
  await row.getByRole('button', { name: /^Edit / }).click();
  await edit.getByRole('button', { name: 'Restore' }).click();
  await expect(edit.getByRole('button', { name: 'Archive' })).toBeVisible();
});

test('the shipments tab shows 3 pending, 1,500 units and GH₵24,950; the received row is locked', async ({ page }) => {
  await openProducts(page, '?pane=shipments');
  await expect(page.locator('.card.kpi', { hasText: 'Pending shipments' })).toContainText('3');
  await expect(page.locator('.card.kpi', { hasText: 'Units on the way' })).toContainText('1,500');
  await expect(page.locator('.card.kpi', { hasText: 'Cost to land them' })).toContainText('GH₵24,950');

  const table = page.getByRole('table', { name: 'Incoming shipments' });
  await expect(table.locator('thead th')).toHaveCount(15);
  const received = table.locator('tbody tr').filter({ hasText: 'Received' }).filter({ hasText: 'short' });
  await expect(received).toHaveCount(1);
  await expect(received.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
  await expect(received.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  await expect(received.getByLabel('Locked')).toBeVisible();
  await expect(table.locator('tbody tr').filter({ hasText: 'Pending' }).first().getByRole('button', { name: /^Edit/ })).toBeVisible();
});

test('a CNY shipment with a typed rate shows the converted total and the original amount', async ({ page }) => {
  await openProducts(page, '?pane=shipments');
  await page.getByRole('button', { name: 'Add shipment' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Add incoming shipment' });
  await modal.getByLabel('Product').selectOption({ label: COPYBOOK });
  await modal.getByLabel('Supplier').fill('Guangzhou E2E');
  await modal.getByLabel('Quantity').fill('100');
  await modal.getByLabel('Currency').fill('CNY');
  await modal.getByLabel(/^Unit cost/).fill('10');
  await modal.getByLabel(/^Shipping/).fill('0');
  await modal.getByLabel(/^Other costs/).fill('0');
  await modal.getByLabel(/^Rate/).fill('1.6');
  await expect(modal.getByTestId('rate-line')).toContainText('Typed rate: 1 CNY = 1.6 GHS');
  await expect(modal.getByTestId('live-landed')).toContainText('16'); // 1,000 CNY x 1.6 / 100
  await modal.getByRole('button', { name: 'Save shipment' }).click();

  const row = page.getByRole('table', { name: 'Incoming shipments' }).getByRole('row').filter({ hasText: 'Guangzhou E2E' });
  await expect(row).toContainText('GH₵1,600');
  await expect(row.getByTestId('original-amount')).toContainText('1,000');
  await expect(page.locator('.card.kpi', { hasText: 'Pending shipments' })).toContainText('4');
});

test('a missing rate shows the API message in the modal', async ({ page }) => {
  await openProducts(page, '?pane=shipments');
  await page.getByRole('button', { name: 'Add shipment' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Add incoming shipment' });
  await modal.getByLabel('Quantity').fill('5');
  await modal.getByLabel('Currency').fill('JPY');
  await modal.getByLabel(/^Unit cost/).fill('100');
  await modal.getByRole('button', { name: 'Save shipment' }).click();
  await expect(modal.getByRole('alert')).toContainText('No exchange rate from JPY to GHS');
});

test('receive 288 of 300: counted 288, short 12, landed 30.21; the claim is GH₵324 and settles with a ledger preview', async ({ page }) => {
  await openProducts(page, '?pane=shipments');
  await page.getByRole('button', { name: 'Add shipment' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add incoming shipment' });
  await add.getByLabel('Product').selectOption({ label: COPYBOOK });
  await add.getByLabel('Supplier').fill('Receive E2E');
  await add.getByLabel('Quantity').fill('300');
  await add.getByLabel(/^Unit cost/).fill('27');
  await add.getByLabel(/^Shipping/).fill('450');
  await add.getByLabel(/^Other costs/).fill('150');
  await expect(add.getByTestId('live-landed')).toContainText('29');
  await add.getByRole('button', { name: 'Save shipment' }).click();

  const table = page.getByRole('table', { name: 'Incoming shipments' });
  const row = table.getByRole('row').filter({ hasText: 'Receive E2E' });
  await row.getByRole('button', { name: /Receive/ }).click();
  const modal = page.getByRole('dialog', { name: 'Receive shipment' });
  await modal.getByLabel('Received at').selectOption({ label: 'Logiswift' });
  await modal.getByLabel('Units counted').fill('288');
  await expect(modal.getByTestId('live-short')).toContainText('12');
  await expect(modal.getByTestId('live-landed')).toContainText('30.21');
  await modal.getByRole('button', { name: 'Save and add to stock' }).click();

  await expect(row).toContainText('288');
  await expect(row).toContainText('12 short');
  await expect(row).toContainText('30.21');
  await expect(row.getByRole('button', { name: /^Edit/ })).toHaveCount(0);

  await row.getByRole('button', { name: /Claim GH₵324/ }).click();
  const claim = page.getByRole('dialog', { name: 'Supplier claim' });
  await expect(claim.getByTestId('claim-amount')).toContainText('GH₵324');
  await expect(claim.getByTestId('ledger-preview')).toContainText('DR 1010');
  await expect(claim.getByTestId('ledger-preview')).toContainText('CR 1200');
  await claim.getByLabel(/Amount recovered/).fill('300');
  await expect(claim.getByTestId('ledger-preview')).toContainText('GH₵300');
  await claim.getByRole('button', { name: 'Settle claim' }).click();
  await expect(row.getByRole('button', { name: 'Claim settled' })).toBeVisible();
});

test('delete asks first and removes a pending shipment', async ({ page }) => {
  await openProducts(page, '?pane=shipments');
  const table = page.getByRole('table', { name: 'Incoming shipments' });
  const row = table.getByRole('row').filter({ hasText: 'Guangzhou E2E' });
  await row.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
});
