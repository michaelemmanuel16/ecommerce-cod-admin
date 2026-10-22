import { test, expect } from '@playwright/test';
import { BASE_URL, createOrder, createProduct, createUser, listOrders, ownerToken, signIn, stamp, tokenFor, type TestUser } from './helpers/m3';

/**
 * M3-T70 (F-307): a call rep sees only their own orders.
 * It creates records: a product, a new call rep, and two orders for new "E2E" customers. One order is the rep's, the
 * other has no call rep. The rep signs in and the Orders list shows the first and not the second. The API list of the
 * rep holds only orders where the rep is the call rep.
 * Needs the dev stack (frontend 5174, backend 3001) and the owner admin@codadmin.com (password123).
 */
test.use({ baseURL: BASE_URL });

const ts = stamp();
const mine = `Mine${ts}`;
const other = `Other${ts}`;
let rep: TestUser;
let myOrderId: number;
let otherOrderId: number;

test.beforeAll(async ({ request }) => {
  const owner = await ownerToken(request);
  const product = await createProduct(request, owner);
  rep = await createUser(request, owner, 'sales_rep');
  myOrderId = (await createOrder(request, owner, product, mine, rep.id)).id;
  otherOrderId = (await createOrder(request, owner, product, other)).id;
});

test('the Orders list of a call rep holds their order and not the unassigned one', async ({ page }) => {
  await signIn(page, rep.email);
  await page.goto('/orders');
  await expect(page.getByText(`#${myOrderId}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`E2E ${mine}`)).toBeVisible();
  await expect(page.getByText(`#${otherOrderId}`, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`E2E ${other}`)).toHaveCount(0);
});

test('the orders API gives the rep only their own orders', async ({ request }) => {
  const token = await tokenFor(request, rep.email);
  expect(token).not.toBeNull();
  const orders = await listOrders(request, token!);
  expect(orders.map((o) => o.id)).toContain(myOrderId);
  expect(orders.map((o) => o.id)).not.toContain(otherOrderId);
  for (const o of orders) expect(o.customerRep?.id).toBe(rep.id);
});
