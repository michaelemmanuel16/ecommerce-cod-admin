import { test, expect } from '@playwright/test';
import { BASE_URL, NO_ACCESS, ownerToken, signIn, userFor } from './helpers/m3';

/**
 * M3-T70 (F-102): each role lands on its own home, the redirect flags are off, and a page the role cannot open shows
 * the "no access" page.
 * Read-only on the pages. It signs in as the dev users e2e-finance, e2e-stock, e2e-rep and e2e-agent (password123);
 * a role whose dev user cannot sign in gets a new E2E user, made through the API with the owner token.
 * Needs the dev stack and the frontend with the repApp and agentApp flags off (the default).
 */
test.use({ baseURL: BASE_URL });

const email: Record<'finance' | 'stock' | 'rep' | 'agent', string> = { finance: '', stock: '', rep: '', agent: '' };

test.beforeAll(async ({ request }) => {
  const owner = await ownerToken(request);
  email.finance = (await userFor(request, owner, 'accountant')).email;
  email.stock = (await userFor(request, owner, 'inventory_manager')).email;
  email.rep = (await userFor(request, owner, 'sales_rep')).email;
  email.agent = (await userFor(request, owner, 'delivery_agent')).email;
});

test.describe('each role lands on its own home', () => {
  test('finance clerk lands on Finance', async ({ page }) => {
    await signIn(page, email.finance);
    await expect(page).toHaveURL(/\/finance$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
  });

  test('stock keeper lands on Products', async ({ page }) => {
    await signIn(page, email.stock);
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
  });
});

test.describe('redirect flags off: reps and agents stay on the current pages', () => {
  test('a call rep stays on the home page, not on /rep or /m', async ({ page }) => {
    await signIn(page, email.rep);
    await expect(page).toHaveURL(/\/$/);
    await expect(page).not.toHaveURL(/\/(agent|rep|m)\b/);
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
  });

  test('a delivery agent stays on the home page, not on /agent or /m', async ({ page }) => {
    await signIn(page, email.agent);
    await expect(page).toHaveURL(/\/$/);
    await expect(page).not.toHaveURL(/\/(agent|rep|m)\b/);
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
  });
});

test.describe('the no access page', () => {
  test('a stock keeper who opens /finance sees it, the URL stays, and the link goes home', async ({ page }) => {
    await signIn(page, email.stock);
    await page.goto('/finance');
    await expect(page.getByText(NO_ACCESS)).toBeVisible();
    await expect(page).toHaveURL(/\/finance$/);
    await page.getByRole('link', { name: 'Go to Products' }).click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
  });

  test('a call rep who opens /finance sees it', async ({ page }) => {
    await signIn(page, email.rep);
    await page.goto('/finance');
    await expect(page.getByText(NO_ACCESS)).toBeVisible();
    await expect(page).toHaveURL(/\/finance$/);
  });
});
