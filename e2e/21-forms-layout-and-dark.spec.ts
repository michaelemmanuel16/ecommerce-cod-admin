import { test, expect, type Page } from '@playwright/test';
import { API_URL, BASE_URL, OWNER_EMAIL, createProduct, ownerToken, signIn, stamp, type TestProduct } from './helpers/m3';

/**
 * COD-37 (M3b-T24): the forms list and the editor fit at 1280 and 760 px, and the editor follows dark mode.
 * Dev stack, admin pages only: it never opens a public form. The test makes its own product and form (no pixel ids,
 * no token) and removes them at the end. Screenshots go to SHOTS_DIR when it is set.
 */
test.use({ baseURL: BASE_URL });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const formName = `E2E Layout ${stamp()}`;
const SHOTS = process.env.SHOTS_DIR;
let token: string;
let product: TestProduct;
let formId = 0;

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m3b-${name}.png` });
};
const setTheme = (page: Page, theme: 'light' | 'dark') =>
  page.addInitScript((t) => localStorage.setItem('codadmin-theme', t), theme);
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe.serial('M3b forms list and editor layout', () => {
  test.beforeAll(async ({ request }) => {
    token = await ownerToken(request);
    product = await createProduct(request, token);
    const res = await request.post(`${API_URL}/api/checkout-forms`, {
      headers: auth(token),
      data: {
        name: formName, slug: `e2e-layout-${stamp()}`, productId: product.id,
        fields: [
          { id: 'a', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
          { id: 'b', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
          { id: 'c', label: 'Region', type: 'state', required: true, enabled: true, standardKey: 'region' },
          { id: 'd', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
        ],
        styling: {}, regions: {}, packages: [{ name: '1 set', price: 249, quantity: 1, isDefault: true }], upsells: [],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    formId = (await res.json()).form.id;
  });

  test.afterAll(async ({ request }) => {
    for (const archived of [false, true]) {
      const res = await request.get(`${API_URL}/api/checkout-forms?limit=100&archived=${archived}`, { headers: auth(token) });
      if (!res.ok()) continue;
      const { forms } = (await res.json()) as { forms: Array<{ id: number; name: string }> };
      for (const f of forms.filter((x) => x.name === formName)) await request.delete(`${API_URL}/api/checkout-forms/${f.id}`, { headers: auth(token) });
    }
    if (product) await request.delete(`${API_URL}/api/products/${product.id}`, { headers: auth(token) });
  });

  for (const width of [1280, 1440]) {
    test(`the list fits at ${width} px: no page scroll, Actions inside the window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await setTheme(page, 'light');
      await signIn(page, OWNER_EMAIL);
      await page.goto('/checkout-forms');
      await expect(page.getByText(formName)).toBeVisible();
      expect(await noPageScroll(page)).toBe(true);
      const box = await page.getByRole('button', { name: `Delete ${formName}` }).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      const wrap = await page.locator('.tablewrap').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(wrap.scroll).toBeLessThanOrEqual(wrap.client);
      if (width === 1280) await shot(page, 'list-1280-light');
    });
  }

  test('the list at 760 px scrolls inside its card, not the page', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 800 });
    await setTheme(page, 'dark');
    await signIn(page, OWNER_EMAIL);
    await page.goto('/checkout-forms');
    await expect(page.getByText(formName)).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
    // positioned, so the switch's hidden absolute checkbox is clipped with the rest of the scrolled table
    expect(await page.locator('.tablewrap').evaluate((el) => [getComputedStyle(el).overflowX, getComputedStyle(el).position])).toEqual(['auto', 'relative']);
    await shot(page, 'list-760-dark');
  });

  test('at 1280 all seven editor tabs are reachable; Design opens its panel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setTheme(page, 'light');
    await signIn(page, OWNER_EMAIL);
    await page.goto(`/checkout-forms/${formId}/edit`);
    const strip = page.getByRole('navigation', { name: 'Form sections' });
    await expect(strip.getByRole('button')).toHaveCount(7);
    await strip.getByRole('button', { name: /^Design/ }).click();
    await expect(page.getByRole('heading', { name: /design/i }).first()).toBeVisible();
    await expect(strip.getByRole('button', { name: /^Design/ })).toHaveAttribute('aria-current', 'page');
    expect(await noPageScroll(page)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 800 });
    await strip.getByRole('button', { name: /^Tracking/ }).click();
    await expect(strip.getByRole('button', { name: /^Tracking/ })).toHaveAttribute('aria-current', 'page');
  });

  test('dark mode: the editor root is dark and the preview stays light', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setTheme(page, 'dark');
    await signIn(page, OWNER_EMAIL);
    await page.goto(`/checkout-forms/${formId}/edit`);
    const preview = page.frameLocator('iframe[title="Checkout preview"]');
    await expect(preview.getByText('Full Name').first()).toBeVisible();
    // no light wrapper around the editor, and its header sits on the dark page colour
    await expect(page.locator('.legacy-light')).toHaveCount(0);
    const luminance = (rgb: string) => {
      const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    };
    const editorBg = await page.locator('.edhead').evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    });
    expect(luminance(editorBg)).toBeLessThan(0.3);
    const title = await page.locator('.edtitle').evaluate((el) => getComputedStyle(el).color);
    expect(luminance(title)).toBeGreaterThan(0.6);
    // the preview document keeps a light background
    const previewBg = await preview.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(luminance(previewBg)).toBeGreaterThan(0.85);
    await shot(page, 'editor-1280-dark');

    // a modal from the editor is dark too
    await page.getByRole('button', { name: /^Fields/ }).first().click();
    await page.getByRole('button', { name: 'Edit Full Name' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(luminance(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor))).toBeLessThan(0.3);
  });

  test('the editor at 760 px, light', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 800 });
    await setTheme(page, 'light');
    await signIn(page, OWNER_EMAIL);
    await page.goto(`/checkout-forms/${formId}/edit`);
    await expect(page.getByRole('navigation', { name: 'Form sections' })).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
    await shot(page, 'editor-760-light');
  });
});
