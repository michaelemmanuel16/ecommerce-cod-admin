import { test, expect, Page } from '@playwright/test';

/**
 * COD-150: the hosted public checkout at 1280x800 is two columns: the offer and "Your information" on the left, the
 * sticky summary with the payment buttons on the right. Every API call is mocked and tracking hosts are blocked: no
 * real pixel loads and no order is ever posted to a real backend.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const SHOTS = '/private/tmp/claude-501/-Users-mac-work/ebcbec70-6a74-4e2c-b2aa-47a7b4897b50/scratchpad/shots';
const SLUG = 'desktop-copybooks';

const FORM = {
  id: 1, slug: SLUG, name: 'Magic Groove', description: 'Reusable handwriting copybooks', currency: 'GHS', country: 'Ghana',
  formType: 'physical', product: { name: 'Magic Groove Copybooks', price: 249, productType: 'physical', inStock: true },
  fields: [
    { id: 'fullName', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
    { id: 'phone', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
    { id: 'region', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' },
    { id: 'town', label: 'City or town', type: 'text', required: true, enabled: true, standardKey: 'town' },
    { id: 'landmark', label: 'Nearest landmark', type: 'text', required: true, enabled: true, standardKey: 'landmark' },
    { id: 'streetAddress', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
  ],
  regions: { available: ['Greater Accra', 'Ashanti'] }, towns: { 'Greater Accra': ['Osu', 'Madina'] }, design: {},
  codEnabled: true, supportWhatsapp: '+233 24 555 0103', pixelConfig: null,
  packages: [
    { id: 1, name: 'Starter', price: 249, quantity: 1, isPopular: false, isDefault: true, originalPrice: 249, discountType: 'none' },
    { id: 2, name: 'Family', price: 649.5, quantity: 3, isPopular: true, isDefault: false, originalPrice: 747, discountType: 'percentage', discountValue: 13, showDiscount: true },
  ],
  upsells: [{ id: 5, name: 'Refill pens', price: 40, items: { quantity: 1 }, isPopular: true, description: 'Two spare pens' }],
};

async function mockApi(page: Page): Promise<{ orders: unknown[]; unmocked: string[] }> {
  const hits = { orders: [] as unknown[], unmocked: [] as string[] };
  // Tracking hosts never load.
  await page.route(/connect\.facebook\.net|facebook\.com\/tr|googletagmanager\.com|google-analytics\.com|analytics\.tiktok\.com/, (route) => route.abort());
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (/\/api\/admin\/config/.test(url)) return json(200, { businessName: 'Test Store', currency: 'GHS' });
    if (/\/api\/public\/forms\/[^/]+\/orders$/.test(url) && method === 'POST') {
      hits.orders.push(route.request().postDataJSON());
      return json(201, { success: true, orderId: 24118, orderNumber: '#24118', message: 'ok' });
    }
    if (/\/track\/initiate-checkout$/.test(url)) return json(200, {});
    if (/\/api\/public\/forms\/[^/]+$/.test(url) && method === 'GET') return json(200, { form: FORM });
    hits.unmocked.push(`${method} ${url}`);
    return json(404, {});
  });
  return hits;
}

test.describe('public checkout at 1280 px', () => {
  test('summary sits to the right, stays in view while scrolling, and one click places one order', async ({ page }) => {
    const hits = await mockApi(page);
    await page.goto(`/form/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'Magic Groove Copybooks' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/cod150-1280-top.png` });

    const info = (await page.getByTestId('section-information').boundingBox())!;
    const summary = (await page.getByTestId('summary-column').boundingBox())!;
    expect(summary.x).toBeGreaterThan(info.x + info.width - 1);
    expect(summary.width).toBeLessThanOrEqual(361);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The form is long enough to scroll; at the bottom the summary and the COD button are still in the viewport.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const cod = page.getByRole('button', { name: 'Place Order' });
    await expect(cod).toBeInViewport();
    await expect(page.getByTestId('order-total')).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/cod150-1280-bottom.png` });

    await page.getByPlaceholder('Enter full name').fill('Kwame Mensah');
    await page.getByPlaceholder('Enter phone').fill('0241234567');
    await page.locator('select').first().selectOption('Greater Accra');
    await page.locator('select').nth(1).selectOption('Osu');
    await page.getByPlaceholder(/Opposite Kasoa/).fill('Near the mall');
    await page.getByPlaceholder('Enter street address').fill('15 Main Street');
    await cod.click();
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
    expect(hits.orders).toHaveLength(1);
    expect(hits.unmocked).toEqual([]);
  });
});
