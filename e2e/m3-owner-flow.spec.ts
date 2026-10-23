import { test, expect, type Locator, type Page } from '@playwright/test';
import { BASE_URL, OWNER_EMAIL, createProduct, createUser, ownerToken, signIn, stamp, uniquePhone, type TestProduct, type TestUser } from './helpers/m3';

/**
 * M3-T70 (F-102, F-307): the owner flow through the M3 shell, on real dev data (no routes are mocked).
 * Dashboard, create an order in the New order sheet, give it a call rep and a delivery agent from the row, move it
 * to Confirmed (a normal move) and then to Delivered (outside the normal flow, at once, no dialog), open the customer
 * page, and download a Reports CSV.
 * It creates records: a product, a call rep, a delivery agent, one customer and one order, all named "E2E ...".
 * Needs the dev stack (frontend 5174, backend 3001) and the owner admin@codadmin.com (password123).
 * Point E2E_BASE_URL and E2E_API_URL elsewhere if the stack runs on other ports.
 */
test.use({ baseURL: BASE_URL });

let product: TestProduct;
let rep: TestUser;
let agent: TestUser;
const lastName = `Owner${stamp()}`;
const customerName = `E2E ${lastName}`;

test.describe.serial('M3 owner flow', () => {
  test.beforeAll(async ({ request }) => {
    const owner = await ownerToken(request);
    product = await createProduct(request, owner);
    rep = await createUser(request, owner, 'sales_rep');
    agent = await createUser(request, owner, 'delivery_agent');
  });

  /** The Orders list narrowed to the order this spec made. */
  const findOrderRow = async (page: Page) => {
    await page.goto('/orders');
    await page.getByLabel('Search orders').fill(lastName);
    const row = page.getByRole('row').filter({ hasText: customerName });
    await expect(row).toHaveCount(1);
    return row;
  };

  /**
   * The row menus close on any scroll. A click that first scrolls the table sideways gets that scroll event one frame
   * later, after the menu opened. Scroll the button into view, wait a frame, then click.
   */
  const openMenu = async (page: Page, button: Locator) => {
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await button.click();
  };

  test('login lands on the Dashboard', async ({ page }) => {
    await signIn(page, OWNER_EMAIL);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('section.dash')).toBeVisible();
    await expect(page.getByText('You do not have access to this page')).toHaveCount(0);
  });

  test('create an order in the New order sheet: it starts at Pending confirmation', async ({ page }) => {
    await signIn(page, OWNER_EMAIL);
    await page.goto('/orders');
    await page.getByRole('button', { name: 'New order' }).click();

    const sheet = page.getByRole('dialog', { name: 'New order' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel(/^status/i)).toHaveCount(0);
    await sheet.getByLabel('Customer name').fill(customerName);
    await sheet.getByLabel('Phone', { exact: true }).fill(uniquePhone());
    await sheet.getByLabel('Delivery address').fill('1 E2E Street');
    await sheet.getByLabel('State').selectOption({ index: 1 });
    // The town is a list for the state, or a typed field when the state has no list: take the typed way either way.
    const townList = sheet.getByLabel('City/Town', { exact: true });
    if (await townList.count()) {
      await expect(townList).toBeEnabled();
      await townList.selectOption({ label: 'Other – type it' });
      await sheet.getByLabel('City/Town (type it)').fill('E2E Town');
    } else {
      await sheet.getByLabel('City/Town', { exact: true }).fill('E2E Town');
    }
    await sheet.getByLabel('Product').selectOption({ label: product.name });
    await sheet.getByRole('button', { name: 'Create order' }).click();

    await expect(page.getByText(/^Order .* created$/)).toBeVisible();
    await expect(sheet).toBeHidden();
    const row = await findOrderRow(page);
    await expect(row).toContainText('Pending confirmation');
  });

  test('assign a call rep and a delivery agent from the row', async ({ page }) => {
    await signIn(page, OWNER_EMAIL);
    const row = await findOrderRow(page);

    await openMenu(page, row.getByRole('button', { name: /^Assign order/ }));
    await page.getByRole('menuitem', { name: new RegExp(rep.lastName) }).click();
    await expect(page.getByText(`${rep.name} will call 1 order`)).toBeVisible();
    await expect(row).toContainText(rep.name);

    await openMenu(page, row.getByRole('button', { name: /^Assign order/ }));
    await page.getByRole('menuitem', { name: new RegExp(agent.lastName) }).click();
    await expect(page.getByText(`${agent.name} will deliver 1 order`)).toBeVisible();
    await expect(row).toContainText(agent.name);
  });

  test('change status from the row: Confirmed, then Delivered at once with no dialog', async ({ page }) => {
    await signIn(page, OWNER_EMAIL);
    const row = await findOrderRow(page);
    const statusButton = row.getByRole('button', { name: /^Change status of/ });

    // A normal move
    await openMenu(page, statusButton);
    await page.getByRole('menuitem', { name: 'Confirmed', exact: true }).click();
    await expect(page.getByText(/is now Confirmed$/)).toBeVisible();
    await expect(row).toContainText('Confirmed');

    // Delivered is outside the normal flow from Confirmed. It moves at once: no reason dialog opens.
    await openMenu(page, statusButton);
    await expect(page.getByText('Outside the normal flow')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Delivered', exact: true }).click();
    await expect(page.getByText(/is now Delivered$/)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText('Delivered');
  });

  test('open the customer page from the Customers list', async ({ page }) => {
    await signIn(page, OWNER_EMAIL);
    await page.goto('/customers');
    await page.getByRole('textbox', { name: 'Search customers' }).fill(lastName);
    await page.locator('tbody tr').filter({ hasText: customerName }).click();
    await expect(page).toHaveURL(/\/customers\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: customerName })).toBeVisible();
  });

  test('Reports: the CSV export starts a download', async ({ page }) => {
    await signIn(page, OWNER_EMAIL);
    await page.goto('/reports');
    await page.getByRole('button', { name: /Export/ }).click();
    const menu = page.getByRole('menu', { name: 'Export' });
    await expect(menu.getByRole('menuitem', { name: 'CSV (this tab)' })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('menuitem', { name: 'CSV (this tab)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
});
