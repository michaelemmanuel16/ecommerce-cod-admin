import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, BASE_URL, createProduct, ownerToken, signIn, stamp, type TestProduct } from './helpers/m3';

/**
 * M3b-T10 (F-408): the Checkout forms list, on real dev data (no routes are mocked).
 * It makes its own product and form ("E2E Form <stamp>"), clones the form from the list, checks the copy is switched off and
 * named "<name> (copy)", opens the copy's public URL (an inactive form answers like an archived one: "Form not found"), and
 * deletes the copy from the list. A copy has no orders, so the delete removes it. It only opens the public URL; it never
 * submits a public form. Whatever it made is removed at the end, also when a step fails.
 * Needs the dev stack (frontend 5174, backend 3001) and the owner admin@codadmin.com (password123).
 */
test.use({ baseURL: BASE_URL });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const formName = `E2E Form ${stamp()}`;
let token: string;
let product: TestProduct;

async function createForm(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API_URL}/api/checkout-forms`, {
    headers: auth(token),
    data: {
      name: formName,
      slug: `e2e-form-${stamp()}`,
      productId: product.id,
      description: 'Made by the Playwright checkout forms spec.',
      fields: [
        { id: 'a', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
        { id: 'b', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
        { id: 'c', label: 'Region', type: 'state', required: true, enabled: true, standardKey: 'region' },
        { id: 'd', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
      ],
      styling: { buttonColor: '#0f172a', accentColor: '#f97316' },
      regions: {},
      packages: [{ name: '1 set', price: 249, quantity: 1 }],
      upsells: [],
    },
  });
  expect(res.status(), `create form: ${await res.text()}`).toBe(201);
}

/** Removes every form this spec made (the original and any copy), archived or not, and the product. */
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

test.describe.serial('M3b checkout forms list', () => {
  test.beforeAll(async ({ request }) => {
    token = await ownerToken(request);
    product = await createProduct(request, token);
    await createForm(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanUp(request);
  });

  test('clone makes an inactive copy named "<name> (copy)"; its public link shows "This form is not available."; delete removes it', async ({ page }) => {
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/checkout-forms');

    const original = page.getByRole('row').filter({ has: page.locator('b', { hasText: new RegExp(`^${formName}$`) }) });
    await expect(original).toHaveCount(1);

    // Clone
    await page.getByRole('button', { name: `Clone ${formName}` }).click();
    await expect(page.getByRole('status')).toContainText('Copy created. It stays off until you switch it on.');

    // The copy: named "<name> (copy)" and switched off
    const copy = page.getByRole('row').filter({ has: page.locator('b', { hasText: new RegExp(`^${formName} \\(copy\\)$`) }) });
    await expect(copy).toHaveCount(1);
    await expect(copy.getByRole('checkbox', { name: `Active: ${formName} (copy)` })).not.toBeChecked();
    await expect(original.getByRole('checkbox', { name: `Active: ${formName}` })).toBeChecked();

    // Its public link answers "This form is not available." (an inactive form takes the same path as an archived one)
    const slug = (await copy.getByText(/^\/form\//).innerText()).replace('/form/', '').trim();
    expect(slug).not.toBe('');
    await page.goto(`/form/${slug}`);
    await expect(page.getByRole('heading', { name: /this form is not available/i })).toBeVisible();

    // Delete the copy: it has no orders, so it is removed, not archived
    await page.goto('/checkout-forms');
    await page.getByRole('button', { name: `Delete ${formName} (copy)` }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(`Delete ${formName} (copy)?`);
    await expect(dialog).toContainText('This form has no orders. It will be removed.');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('status')).toContainText('Form deleted.');
    await expect(page.getByRole('row').filter({ hasText: `${formName} (copy)` })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ has: page.locator('b', { hasText: new RegExp(`^${formName}$`) }) })).toHaveCount(1);
  });
});
