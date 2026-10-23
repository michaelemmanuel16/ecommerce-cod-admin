import { test, expect, Page } from '@playwright/test';

/**
 * COD-36 (M3b-T16..T18): the public checkout at 390 px, the success and not-available screens, a digital form and the
 * payment callback. Every public API call is mocked with page.route and the mocks are asserted: no order is ever posted
 * to a real backend (dev forms carry real Meta pixel ids and order creation can send email), and no provider is called.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const SHOTS = '/private/tmp/claude-501/-Users-mac-work/ebcbec70-6a74-4e2c-b2aa-47a7b4897b50/scratchpad/shots';
const SLUG = 'mobile-copybooks';
// Top of the "Your information" heading with the offer on top, measured before COD-150 (tall package cards).
const BASELINE_INFO_TOP = 669;

const FIELDS = [
  { id: 'fullName', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
  { id: 'phone', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
  { id: 'region', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' },
  { id: 'town', label: 'City or town', type: 'text', required: true, enabled: true, standardKey: 'town' },
  { id: 'landmark', label: 'Nearest landmark', type: 'text', required: true, enabled: true, standardKey: 'landmark' },
  { id: 'streetAddress', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
];

const FORM = {
  id: 1, slug: SLUG, name: 'Magic Groove', description: 'Reusable handwriting copybooks', currency: 'GHS', country: 'Ghana',
  formType: 'physical', product: { name: 'Magic Groove Copybooks', price: 249, productType: 'physical', inStock: true },
  fields: FIELDS, regions: { available: ['Greater Accra', 'Ashanti'] }, towns: { 'Greater Accra': ['Osu', 'Madina'] }, design: {},
  codEnabled: true, supportWhatsapp: '+233 24 555 0103', pixelConfig: null,
  packages: [
    { id: 1, name: 'Starter', price: 249, quantity: 1, isPopular: false, isDefault: true, originalPrice: 249, discountType: 'none' },
    { id: 2, name: 'Family', price: 649.5, quantity: 3, isPopular: true, isDefault: false, originalPrice: 747, discountType: 'percentage', discountValue: 13, showDiscount: true },
  ],
  upsells: [{ id: 5, name: 'Refill pens', price: 40, items: { quantity: 1 }, isPopular: true, description: 'Two spare pens' }],
};

const DIGITAL = {
  ...FORM, slug: 'guide', name: 'The Guide', formType: 'digital', product: { name: 'The Guide', price: 100, productType: 'digital', inStock: true },
  fields: [...FIELDS, { id: 'email', label: 'Email Address', type: 'email', required: false, enabled: false, standardKey: 'email' }],
  codEnabled: false, paystackFullEnabled: true, upsells: [],
  packages: [{ id: 9, name: 'The Guide', price: 100, quantity: 1, isPopular: false, isDefault: true, originalPrice: 100, discountType: 'none' }],
};

interface Hits { orders: unknown[]; unmocked: string[] }

/** Mocks every API call the public pages make. Anything else is recorded and fails the test. */
async function mockApi(page: Page, opts: { form?: unknown; formStatus?: number; order?: { status: number; body: unknown }; verify?: unknown[] } = {}): Promise<Hits> {
  const hits: Hits = { orders: [], unmocked: [] };
  const form = opts.form ?? FORM;
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (/\/api\/admin\/config/.test(url)) return json(200, { businessName: 'Test Store', currency: 'GHS' });
    if (/\/api\/public\/forms\/[^/]+\/orders$/.test(url) && method === 'POST') {
      hits.orders.push(route.request().postDataJSON());
      const o = opts.order ?? { status: 201, body: { success: true, orderId: 24118, orderNumber: '#24118', message: 'ok' } };
      return json(o.status, o.body);
    }
    if (/\/track\/initiate-checkout$/.test(url)) return json(200, {});
    if (/\/api\/public\/forms\/[^/]+$/.test(url) && method === 'GET') {
      return opts.formStatus ? json(opts.formStatus, { message: 'Form not found', supportWhatsapp: '+233245550103' }) : json(200, { form });
    }
    if (/\/api\/payments\/verify\//.test(url)) {
      const queue = opts.verify ?? [];
      return json(200, queue.length > 1 ? queue.shift() : queue[0]);
    }
    hits.unmocked.push(`${method} ${url}`);
    return json(404, {});
  });
  return hits;
}

const fillCod = async (page: Page) => {
  await page.getByPlaceholder('Enter full name').fill('Kwame Mensah');
  await page.getByPlaceholder('Enter phone').fill('0241234567');
  await page.locator('select').first().selectOption('Greater Accra');
  await page.locator('select').nth(1).selectOption('Osu');
  await page.getByPlaceholder(/Opposite Kasoa/).fill('Near the mall');
  await page.getByPlaceholder('Enter street address').fill('15 Main Street');
};

test.describe('public checkout at 390 px', () => {
  test('places a COD order and lands on the success screen; the mocked POST is hit once', async ({ page }) => {
    const hits = await mockApi(page);
    await page.goto(`/form/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'Magic Groove Copybooks' })).toBeVisible();
    // money uses the Ghana symbol, whole amounts without cents, pesewas kept
    await expect(page.getByTestId('order-total')).toHaveText('GH₵249');
    await expect(page.getByText('GH₵649.50').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/cod36-page-top.png` });

    // no horizontal scroll at 390 px
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // COD-150: compact package rows (option B), so the form starts higher up the page
    const rows = page.getByRole('radio');
    await expect(rows).toHaveCount(2);
    for (let i = 0; i < 2; i++) expect((await rows.nth(i).boundingBox())!.height).toBeLessThanOrEqual(80);
    await expect(rows.nth(1).getByText('Qty 3')).toBeVisible();
    await expect(rows.nth(1).getByTestId('package-edge-tag')).toHaveText('Most popular');
    await page.screenshot({ path: `${SHOTS}/cod150-390-full.png`, fullPage: true });

    await fillCod(page);
    await page.getByRole('checkbox', { name: 'Add Refill pens' }).click();
    await expect(page.getByTestId('order-total')).toHaveText('GH₵289');
    await page.getByRole('button', { name: /terms/i }).click();
    await expect(page.getByText('We call you to confirm your order before we send it.')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/cod36-page-bottom.png`, fullPage: true });

    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
    await expect(page.getByTestId('order-number')).toHaveText('#24118');
    await expect(page.getByText('You pay when it arrives.')).toBeVisible();
    await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550103');
    await page.screenshot({ path: `${SHOTS}/cod36-success.png` });

    expect(hits.orders).toHaveLength(1);
    expect((hits.orders[0] as { totalAmount: number }).totalAmount).toBe(289);
    expect(hits.unmocked).toEqual([]);

    // a reload inside the 10 minute cooldown shows the same order and posts nothing more
    await page.reload();
    await expect(page.getByTestId('order-number')).toHaveText('#24118');
    expect(hits.orders).toHaveLength(1);
  });

  test('offer on top: compact rows put "Your information" higher up the page', async ({ page }) => {
    await mockApi(page, { form: { ...FORM, design: { page: { offerPosition: 'top' } } } });
    await page.goto(`/form/${SLUG}`);
    await expect(page.getByRole('radio')).toHaveCount(2);
    const infoTop = (await page.getByRole('heading', { name: 'Your information' }).boundingBox())!.y;
    expect(infoTop).toBeLessThan(BASELINE_INFO_TOP);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('a double tap places one order and the sold-out answer shows above the button', async ({ page }) => {
    const hits = await mockApi(page, { order: { status: 400, body: { message: 'This product is sold out', error: 'This product is sold out' } } });
    await page.goto(`/form/${SLUG}`);
    await fillCod(page);
    const button = page.getByRole('button', { name: 'Place Order' });
    await button.dblclick();
    await expect(page.getByRole('alert')).toHaveText('This product is sold out');
    expect(hits.orders).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Place Order' })).toBeEnabled();
    expect(hits.unmocked).toEqual([]);
  });

  test('?package= locks the form to one package', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/form/${SLUG}?package=2`);
    await expect(page.getByRole('radio', { name: /Family/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Starter/ })).toHaveCount(0);
    await expect(page.getByTestId('order-total')).toHaveText('GH₵649.50');
  });

  test('a form that is not available shows the plain screen with the support contact', async ({ page }) => {
    const hits = await mockApi(page, { formStatus: 404 });
    await page.goto(`/form/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'This form is not available.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550103');
    await expect(page.getByRole('button')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/cod36-not-available.png` });
    expect(hits.unmocked).toEqual([]);
  });

  test('a digital form asks no address fields, asks an email, and has one online button', async ({ page }) => {
    const hits = await mockApi(page, { form: DIGITAL });
    await page.goto('/form/guide');
    await expect(page.getByPlaceholder('Enter email address')).toBeVisible();
    for (const label of ['State', 'City or town', 'Nearest landmark', 'Street address']) {
      await expect(page.locator('label', { hasText: label })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Proceed to Payment' })).toHaveCount(1);
    await expect(page.getByText('Cash on Delivery')).toHaveCount(0);
    expect(hits.orders).toHaveLength(0);
  });

  test('has no link that opens a new tab', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/form/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'Magic Groove Copybooks' })).toBeVisible();
    await expect(page.locator('[target="_blank"]')).toHaveCount(0);
  });
});

test.describe('payment callback at 390 px', () => {
  const CALLBACK = '/checkout/payment/callback?reference=ref_123';

  test('pending shows the waiting text, then the order number once paid', async ({ page }) => {
    await mockApi(page, {
      verify: [
        // two pending answers: the dev server's strict mode asks twice on load
        { status: 'pending', orderType: 'digital', formSlug: 'guide' },
        { status: 'pending', orderType: 'digital', formSlug: 'guide' },
        { status: 'success', orderNumber: '#24119', orderType: 'digital', formSlug: 'guide', email: 'a***@gmail.com' },
      ],
    });
    await page.goto(CALLBACK);
    await expect(page.getByRole('heading', { name: 'We are waiting for your payment to be confirmed.' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/cod36-callback-pending.png` });
    await expect(page.getByRole('heading', { name: 'Order received.' })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId('order-number')).toHaveText('#24119');
    await expect(page.getByText('We sent the download link to a***@gmail.com.')).toBeVisible();
  });

  test('failed shows Try again to the form in the same tab', async ({ page }) => {
    const hits = await mockApi(page, { verify: [{ status: 'failed', orderType: 'physical', formSlug: SLUG }] });
    await page.goto(CALLBACK);
    await expect(page.getByRole('heading', { name: 'The payment did not go through.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', `/form/${SLUG}`);
    await expect(page.getByRole('link', { name: /WhatsApp/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/cod36-callback-failed.png` });
    expect(hits.unmocked).toEqual([]);
  });

  test('not found says so', async ({ page }) => {
    await mockApi(page, { verify: [{ status: 'not_found', orderType: null, formSlug: null }] });
    await page.goto(CALLBACK);
    await expect(page.getByRole('heading', { name: 'We could not find this payment.' })).toBeVisible();
  });
});
