import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, BASE_URL, createProduct, ownerToken, signIn, stamp, userFor, type TestProduct } from './helpers/m3';

/**
 * M3b-T13 and T15 (COD-35): the form editor on the dev stack, with every outside call blocked or mocked.
 *  - Tracking: the saved Conversion API token never shows (screen, inputs); "Send a test event" shows the mocked Meta reply.
 *  - Preview: a label edit shows in the preview at once; the preview makes no pixel / GA / TikTok / GTM request and
 *    sends no order.
 *  - The preview route is closed to a sales rep.
 * It makes its own product and form ("E2E Editor <stamp>"), carrying fake pixel ids so a leaked pixel would show. It never
 * opens the public form, never places an order, and never calls Meta or a payment provider (test-event is answered by the
 * browser, graph.facebook.com is aborted and counted). Whatever it made is removed at the end.
 * Set SHOTS_DIR to also write 1440 px screenshots of the tabs and the list preview modal there.
 * Needs the dev stack (frontend 5174, backend 3001) and the owner admin@codadmin.com (password123).
 */
test.use({ baseURL: BASE_URL });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const formName = `E2E Editor ${stamp()}`;
const TOKEN = 'EAAB_e2e_secret_token_value_9f3a';
const TRACKING = /facebook\.net|connect\.facebook|facebook\.com\/tr|google-analytics|googletagmanager|tiktok/i;
let token: string;
let product: TestProduct;
let formId: number;

async function createForm(request: APIRequestContext): Promise<number> {
  const res = await request.post(`${API_URL}/api/checkout-forms`, {
    headers: auth(token),
    data: {
      name: formName,
      slug: `e2e-editor-${stamp()}`,
      productId: product.id,
      description: 'Made by the Playwright editor spec.',
      fields: [
        { id: 'a', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
        { id: 'b', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
        { id: 'c', label: 'Region', type: 'state', required: true, enabled: true, standardKey: 'region' },
        { id: 'd', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
      ],
      styling: { buttonColor: '#0f172a', accentColor: '#f97316' },
      regions: {},
      packages: [
        { name: '1 set', price: 249, quantity: 1, isDefault: true },
        { name: '2 sets', price: 449, quantity: 2, discountType: 'fixed', discountValue: 49, originalPrice: 498, showHighlight: true, highlightText: 'Best deal' },
      ],
      upsells: [{ name: 'Refill pens', price: 40, items: { quantity: 1 } }],
      pixelConfig: { facebookPixelId: '123456789012345', googleAnalyticsId: 'G-E2ETEST01', tiktokPixelId: 'E2ETIKTOK', googleTagManagerId: 'GTM-E2E01' },
      metaCapiAccessToken: TOKEN,
      metaCapiTestEventCode: 'TEST_E2E',
      codEnabled: true,
    },
  });
  expect(res.status(), `create form: ${await res.text()}`).toBe(201);
  return (await res.json()).form.id;
}

async function cleanUp(request: APIRequestContext): Promise<void> {
  for (const archived of [false, true]) {
    const res = await request.get(`${API_URL}/api/checkout-forms?limit=100&archived=${archived}`, { headers: auth(token) });
    if (!res.ok()) continue;
    const { forms } = (await res.json()) as { forms: Array<{ id: number; name: string }> };
    for (const f of forms.filter((x) => x.name === formName)) {
      await request.delete(`${API_URL}/api/checkout-forms/${f.id}`, { headers: auth(token) });
    }
  }
  if (product) await request.delete(`${API_URL}/api/products/${product.id}`, { headers: auth(token) });
}

const tab = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) }).first();

test.describe.serial('M3b checkout form editor', () => {
  test.beforeAll(async ({ request }) => {
    token = await ownerToken(request);
    product = await createProduct(request, token);
    formId = await createForm(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanUp(request);
  });

  test('Tracking: the saved token never shows, and "Send a test event" shows the mocked Meta reply', async ({ page, context }) => {
    let testEventCalls = 0;
    let metaCalls = 0;
    await context.route(/graph\.facebook\.com/, (route) => {
      metaCalls += 1;
      return route.abort();
    });
    // Routed before the click; the real endpoint is never reached.
    await page.route('**/test-event', (route) => {
      testEventCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 200, metaResponse: { events_received: 1, fbtrace_id: 'MOCKED' } }) });
    });

    await signIn(page, 'admin@codadmin.com');
    await page.goto(`/checkout-forms/${formId}/edit`);
    await tab(page, 'Tracking').click();

    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(TOKEN);
    const everyInput = await page.locator('input, textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(everyInput.join('|')).not.toContain(TOKEN);
    expect(everyInput.join('|')).not.toContain('••••');
    expect(await page.content()).not.toContain(TOKEN);

    // Replace shows an empty password box, Cancel brings back "Connected"
    await page.getByRole('button', { name: 'Replace' }).click();
    const box = page.locator('input[type="password"]');
    await expect(box).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Connected')).toBeVisible();

    await page.getByRole('button', { name: 'Send a test event' }).click();
    await expect(page.getByTestId('test-event-result')).toContainText('Status 200');
    await expect(page.getByTestId('test-event-result')).toContainText('events_received');
    expect(testEventCalls).toBe(1);
    expect(metaCalls).toBe(0);
  });

  test('Preview: a label edit shows at once, and the preview fires no pixel and sends no order', async ({ page }) => {
    const seen: string[] = [];
    const posts: string[] = [];
    page.on('request', (r) => {
      seen.push(r.url());
      if (r.method() === 'POST') posts.push(r.url());
    });

    await signIn(page, 'admin@codadmin.com');
    await page.goto(`/checkout-forms/${formId}/edit`);
    const preview = page.frameLocator('iframe[title="Checkout preview"]');
    await expect(preview.getByText('Full Name', { exact: false }).first()).toBeVisible();

    await tab(page, 'Fields').click();
    await page.getByRole('button', { name: 'Edit Full Name' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Your full name');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(preview.getByText('Your full name').first()).toBeVisible({ timeout: 5000 });

    // The package table feeds the preview too: a discount shows its final price
    await tab(page, 'Packages').click();
    await expect(page.getByLabel('Sets, package 2')).toHaveValue('2');
    await expect(preview.getByText(/449/).first()).toBeVisible();

    // Place order in the preview says "Preview only." and posts nothing
    await preview.getByRole('button', { name: /Place Order/i }).click();
    await expect(preview.getByText('Preview only.')).toBeVisible();

    await page.waitForTimeout(1500);
    expect(seen.filter((u) => TRACKING.test(u)), 'tracking requests from the preview').toEqual([]);
    expect(posts.filter((u) => /\/api\/public\/|\/orders|initiate-checkout/.test(u)), 'order or tracking posts from the preview').toEqual([]);
  });

  test('the preview route is closed to a sales rep', async ({ page, request }) => {
    const rep = await userFor(request, token, 'sales_rep');
    await signIn(page, rep.email);
    await page.goto(`/checkout-forms/${formId}/preview`);
    await expect.poll(() => new URL(page.url()).pathname).not.toContain('/preview');
  });

  test('Preview opens from the list in a modal', async ({ page }) => {
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/checkout-forms');
    await page.getByRole('button', { name: `Preview ${formName}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('iframe[title="Checkout preview"]')).toHaveAttribute('data-width', '390');
    await expect(dialog.frameLocator('iframe').getByText('Full Name').first()).toBeVisible();
    await dialog.getByRole('button', { name: /Desktop/ }).click();
    await expect(dialog.locator('iframe[title="Checkout preview"]')).toHaveAttribute('data-width', '1024');
  });

  test('screenshots at 1440 px', async ({ page }) => {
    test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR to write screenshots');
    const dir = process.env.SHOTS_DIR as string;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, 'admin@codadmin.com');
    await page.goto(`/checkout-forms/${formId}/edit`);
    await expect(page.frameLocator('iframe[title="Checkout preview"]').getByText('Full Name').first()).toBeVisible();
    for (const name of ['Packages', 'Upsells', 'Payment', 'Tracking', 'Design']) {
      await tab(page, name).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${dir}/cod35-${name.toLowerCase()}.png` });
    }
    await page.goto('/checkout-forms');
    await page.getByRole('button', { name: `Preview ${formName}` }).click();
    await expect(page.getByRole('dialog').frameLocator('iframe').getByText('Full Name').first()).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/cod35-list-preview-modal.png` });
  });
});
