import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_URL, NO_ACCESS, OWNER_EMAIL, createProduct, ownerToken, signIn, stamp, tokenFor, userFor, type TestProduct } from './helpers/m3';

/**
 * COD-37 (M3b-T21): the owner makes a form in the editor, edits it and sees the preview; the roles on the forms pages.
 * Runs on the dev stack (admin API calls only). The form is made by the test with no tracking ids and no Conversion API
 * token, is never opened on its public URL, and is removed at the end with its product. The editor preview is the
 * same-origin page /checkout-forms/:id/preview: the test fails on any tracking, public API or order request.
 * The editor spec 18 covers the Tracking tab, the preview with fake pixel ids, and edit-in-preview of an API-made form.
 * Needs the dev stack (frontend 5174, backend 3001), the owner admin@codadmin.com and the dev users e2e-manager,
 * e2e-rep and e2e-agent (password123); the rep and agent are created when missing, the manager is skipped when missing.
 */
test.use({ baseURL: BASE_URL });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const formName = `E2E Create ${stamp()}`;
const TRACKING = /facebook\.net|connect\.facebook|facebook\.com\/tr|google-analytics|googletagmanager|tiktok/i;
const MANAGER = 'e2e-manager@codadmin.com';
let token: string;
let product: TestProduct;
let formId = 0;

async function cleanUp(request: APIRequestContext): Promise<void> {
  for (const archived of [false, true]) {
    const res = await request.get(`${API_URL}/api/checkout-forms?limit=100&archived=${archived}`, { headers: auth(token) });
    if (!res.ok()) continue;
    const { forms } = (await res.json()) as { forms: Array<{ id: number; name: string }> };
    for (const f of forms.filter((x) => x.name.startsWith(formName))) {
      await request.delete(`${API_URL}/api/checkout-forms/${f.id}`, { headers: auth(token) });
    }
  }
  if (product) await request.delete(`${API_URL}/api/products/${product.id}`, { headers: auth(token) });
}

test.describe.serial('M3b owner makes and edits a form', () => {
  test.beforeAll(async ({ request }) => {
    token = await ownerToken(request);
    product = await createProduct(request, token);
  });

  test.afterAll(async ({ request }) => {
    await cleanUp(request);
  });

  test('the owner creates a form in the editor and finds it in the list', async ({ page }) => {
    await signIn(page, OWNER_EMAIL);
    await page.goto('/checkout-forms/new');
    await page.getByLabel('Form name').fill(formName);
    await page.getByLabel('Product').selectOption({ label: `${product.name} (Physical)` });
    await expect(page.getByText('Physical product (delivered)')).toBeVisible();
    await expect(page.getByLabel('Link')).toHaveValue(/\/form\/e2e-create-/);
    // a form needs one package; the live preview already shows the new form
    await page.getByRole('button', { name: /^Packages/ }).first().click();
    await page.getByRole('button', { name: 'Add package' }).click();
    await page.getByLabel('Name, package 1').fill('1 set');
    await expect(page.frameLocator('iframe[title="Checkout preview"]').getByText('Full Name').first()).toBeVisible();
    await page.getByRole('button', { name: 'Create form' }).click();

    await page.waitForURL(/\/checkout-forms\/\d+\/edit$/);
    await page.goto('/checkout-forms');
    await expect(page.getByText(formName)).toBeVisible();

    const res = await page.request.get(`${API_URL}/api/checkout-forms?limit=100`, { headers: auth(token) });
    const { forms } = (await res.json()) as { forms: Array<{ id: number; name: string; pixelConfig?: unknown }> };
    const made = forms.find((f) => f.name === formName);
    expect(made, 'the new form is saved').toBeTruthy();
    formId = made!.id;
  });

  test('the owner edits it: a label change shows in the preview at once and saves; the preview fires nothing', async ({ page }) => {
    const seen: string[] = [];
    const posts: string[] = [];
    page.on('request', (r) => {
      seen.push(r.url());
      if (r.method() === 'POST') posts.push(r.url());
    });

    await signIn(page, OWNER_EMAIL);
    await page.goto(`/checkout-forms/${formId}/edit`);
    const preview = page.frameLocator('iframe[title="Checkout preview"]');
    await expect(preview.getByText('Full Name', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: /^Fields/ }).first().click();
    await page.getByRole('button', { name: 'Edit Full Name' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Your full name');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(preview.getByText('Your full name').first()).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => {
      const res = await page.request.get(`${API_URL}/api/checkout-forms/${formId}`, { headers: auth(token) });
      return JSON.stringify(await res.json());
    }).toContain('Your full name');

    await page.waitForTimeout(1000);
    expect(seen.filter((u) => TRACKING.test(u)), 'tracking requests from the editor').toEqual([]);
    expect(posts.filter((u) => /\/api\/public\/|\/orders|initiate-checkout/.test(u)), 'order or tracking posts').toEqual([]);
  });

  test('a manager reads the list: Preview shows, nothing that changes a form does', async ({ page, request }) => {
    test.skip(!(await tokenFor(request, MANAGER)), `${MANAGER} cannot sign in on this dev stack`);
    await signIn(page, MANAGER);
    await page.goto('/checkout-forms');
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Checkout forms/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /New form|Create form|Create your first form/i })).toHaveCount(0);
    for (const label of [/^Clone /, /^Delete /, /^Archive /, /^Edit /]) {
      await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    }
    await expect(page.getByText(formName)).toBeVisible();
    await page.getByRole('button', { name: `Preview ${formName}` }).click();
    await expect(page.getByRole('dialog').locator('iframe[title="Checkout preview"]')).toBeVisible();
    await page.keyboard.press('Escape');

    // the preview route opens for a manager
    await page.goto(`/checkout-forms/${formId}/preview`);
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
    await expect(page.locator('iframe, form').first()).toBeVisible();

    // the editor route is open to a manager (it shows Save), but the server refuses every write from that role
    const managerToken = (await tokenFor(request, MANAGER)) as string;
    const put = await request.put(`${API_URL}/api/checkout-forms/${formId}`, { headers: auth(managerToken), data: { name: `${formName} by manager` } });
    expect(put.status()).toBe(403);
    const after = await request.get(`${API_URL}/api/checkout-forms/${formId}`, { headers: auth(token) });
    expect(JSON.stringify(await after.json())).not.toContain('by manager');
  });
});

test.describe('M3b role checks on the forms pages', () => {
  test.beforeAll(async ({ request }) => {
    token = token ?? (await ownerToken(request));
  });

  for (const role of ['sales_rep', 'delivery_agent'] as const) {
    test(`a ${role} gets the no-access screen on the list, the editor and the preview`, async ({ page, request }) => {
      const user = await userFor(request, token, role);
      await signIn(page, user.email);
      for (const path of ['/checkout-forms', '/checkout-forms/new', '/checkout-forms/1/edit', '/checkout-forms/1/preview']) {
        await page.goto(path);
        await expect(page.getByText(NO_ACCESS), path).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.locator('iframe'), path).toHaveCount(0);
      }
    });
  }
});
