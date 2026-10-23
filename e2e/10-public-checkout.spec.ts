import { test, expect, Page } from '@playwright/test';

/**
 * Test Suite: Public Checkout Form (COD Order Submission)
 *
 * Tests the customer-facing checkout flow at /form/:slug:
 * 1. Invalid slug shows error state
 * 2. Valid form loads with packages, upsells, and form fields
 * 3. Form validation prevents submission with missing required fields
 * 4. Successful order submission shows confirmation screen
 *
 * Uses API route interception — no live backend or seed data required. Every public API call is mocked: no order is ever
 * posted to a real backend, and no pixel or payment provider is called.
 */

const FORM_SLUG = 'test-product-checkout';
const CHECKOUT_URL = `/form/${FORM_SLUG}`;

/** Canonical mock checkout form response from GET /api/public/forms/:slug */
const MOCK_FORM_DATA = {
  id: 1,
  slug: FORM_SLUG,
  name: 'Test Product Checkout',
  currency: 'GHS',
  fields: [
    { id: 'fullName', label: 'Full Name', type: 'text', required: true, enabled: true },
    { id: 'phone', label: 'Phone', type: 'phone', required: true, enabled: true },
    { id: 'region', label: 'Region/State', type: 'select', required: true, enabled: true },
    { id: 'town', label: 'City or town', type: 'text', required: true, enabled: true, standardKey: 'town' },
    { id: 'landmark', label: 'Nearest landmark', type: 'text', required: true, enabled: true, standardKey: 'landmark' },
    { id: 'streetAddress', label: 'Street Address', type: 'textarea', required: true, enabled: true },
  ],
  packages: [
    {
      id: 1,
      name: 'Basic Pack (1 unit)',
      price: 150,
      quantity: 1,
      originalPrice: 180,
      discountType: 'FIXED',
      discountValue: 30,
    },
    {
      id: 2,
      name: 'Family Pack (3 units)',
      price: 400,
      quantity: 3,
      originalPrice: 540,
      discountType: 'FIXED',
      discountValue: 140,
    },
  ],
  upsells: [
    {
      id: 10,
      productId: 5,
      name: 'Bonus Guide',
      description: 'The complete user guide PDF',
      price: 20,
      quantity: 1,
      originalPrice: 30,
      discountType: 'FIXED',
      discountValue: 10,
      items: { quantity: 1 },
    },
  ],
  pixelConfig: null,
  regions: { available: ['Greater Accra', 'Ashanti', 'Western', 'Eastern', 'Northern'] },
};

/** The store config the public page reads (currency, name). */
async function mockStoreConfig(page: Page) {
  await page.route('**/api/admin/config**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ businessName: 'Test Store', currency: 'GHS' }) });
  });
}

async function mockCheckoutAPIs(page: Page) {
  await mockStoreConfig(page);
  // GET /api/public/forms/:slug
  await page.route(`**/api/public/forms/${FORM_SLUG}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_FORM_DATA),
    });
  });

  // POST /api/public/forms/:slug/orders → success
  await page.route(`**/api/public/forms/${FORM_SLUG}/orders`, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        orderId: 12345,
        message: 'Order placed successfully',
      }),
    });
  });
}


/** City or town and Nearest landmark are required; this form has no town list, so the town is typed. */
async function fillLocation(page: Page) {
  await page.getByRole('textbox', { name: /type it/i }).fill('Osu');
  await page.getByPlaceholder(/Opposite Kasoa/).fill('Near the mall');
}

async function mock404Form(page: Page) {
  await mockStoreConfig(page);
  await page.route(`**/api/public/forms/**`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Form not found or no longer available', supportWhatsapp: '+233245550103' }),
    });
  });
}

test.describe('Public Checkout Form', () => {
  test('shows error state for invalid/missing form slug', async ({ page }) => {
    await mock404Form(page);
    await page.goto('/form/nonexistent-form-xyz');

    // Should show the not-available screen, with the store's support contact
    await expect(page.getByRole('heading', { name: 'This form is not available.' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550103');
    await page.screenshot({ path: 'test-results/screenshots/checkout-form-not-found.png' });
  });

  test('shows loading state while fetching form', async ({ page }) => {
    await mockStoreConfig(page);
    // Slow down the API so we can catch the loading state
    await page.route(`**/api/public/forms/${FORM_SLUG}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_FORM_DATA),
      });
    });

    await page.goto(CHECKOUT_URL);
    await expect(page.locator('text=Loading checkout form...')).toBeVisible();
  });

  test('loads and displays form title, packages and upsells', async ({ page }) => {
    await mockCheckoutAPIs(page);
    await page.goto(CHECKOUT_URL);

    // Wait for form to load — packages should be visible
    await expect(page.locator('text=Basic Pack (1 unit)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Family Pack (3 units)')).toBeVisible();

    // Upsell / add-on visible
    await expect(page.locator('text=Bonus Guide')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/checkout-form-loaded.png' });
  });

  test('displays required form fields after form loads', async ({ page }) => {
    await mockCheckoutAPIs(page);
    await page.goto(CHECKOUT_URL);

    // Wait for packages to confirm load
    await expect(page.locator('text=Basic Pack (1 unit)')).toBeVisible({ timeout: 10000 });

    // Standard fields rendered
    await expect(page.locator('text=Full Name')).toBeVisible();
    await expect(page.locator('text=Phone')).toBeVisible();
    await expect(page.locator('text=Street Address')).toBeVisible();
  });

  test('shows validation errors when submitted without required fields', async ({ page }) => {
    await mockCheckoutAPIs(page);
    await page.goto(CHECKOUT_URL);

    // Wait for form to be ready
    await expect(page.locator('text=Basic Pack (1 unit)')).toBeVisible({ timeout: 10000 });

    // The button needs a package first; then an empty form is refused with a message and nothing is posted
    await page.locator('text=Basic Pack (1 unit)').click();
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Full Name is required')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/checkout-validation-errors.png' });
  });

  test('selecting a package updates order summary', async ({ page }) => {
    await mockCheckoutAPIs(page);
    await page.goto(CHECKOUT_URL);

    await expect(page.locator('text=Basic Pack (1 unit)')).toBeVisible({ timeout: 10000 });

    // Click the Basic Pack option
    await page.locator('text=Basic Pack (1 unit)').click();

    // Order summary should reflect the price with the store currency symbol
    await expect(page.getByTestId('order-total')).toHaveText('GH₵150');
    await page.screenshot({ path: 'test-results/screenshots/checkout-package-selected.png' });
  });

  test('successful order submission shows confirmation', async ({ page }) => {
    await mockCheckoutAPIs(page);
    await page.goto(CHECKOUT_URL);

    // Wait for form load
    await expect(page.locator('text=Basic Pack (1 unit)')).toBeVisible({ timeout: 10000 });

    // Select a package
    await page.locator('text=Basic Pack (1 unit)').click();

    // Fill required fields — use the field label text to locate inputs
    const fullNameInput = page.locator('input[name="fullName"], input[placeholder*="Name"], input[placeholder*="name"]').first();
    const phoneInput = page.locator('input[name="phone"], input[type="tel"], input[placeholder*="hone"]').first();

    if (await fullNameInput.isVisible()) {
      await fullNameInput.fill('Kwame Mensah');
    }

    if (await phoneInput.isVisible()) {
      await phoneInput.fill('0241234567');
    }

    // Fill region if it's a select
    const regionSelect = page.locator('select[name="region"]');
    if (await regionSelect.isVisible()) {
      const options = await regionSelect.locator('option').all();
      if (options.length > 1) {
        await regionSelect.selectOption({ index: 1 });
      }
    }

    // Fill street address
    const addressInput = page.locator('textarea[name="streetAddress"], input[name="streetAddress"]').first();
    if (await addressInput.isVisible()) {
      await addressInput.fill('15 Main Street, Accra');
    }

    await fillLocation(page);
    await page.screenshot({ path: 'test-results/screenshots/checkout-form-filled.png' });

    // Submit form
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }

    // Success state: order confirmation with the order number
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('order-number')).toHaveText('#12345');

    await page.screenshot({ path: 'test-results/screenshots/checkout-order-success.png' });
  });

  test('error response from API shows the message above the button', async ({ page }) => {
    await mockStoreConfig(page);
    // Form loads OK but order submission fails
    await page.route(`**/api/public/forms/${FORM_SLUG}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_FORM_DATA),
      });
    });

    await page.route(`**/api/public/forms/${FORM_SLUG}/orders`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Phone number already used today' }),
      });
    });

    await page.goto(CHECKOUT_URL);
    await expect(page.locator('text=Basic Pack (1 unit)')).toBeVisible({ timeout: 10000 });

    // Select package and fill minimum required fields
    await page.locator('text=Basic Pack (1 unit)').click();

    const fullNameInput = page.locator('input[name="fullName"], input[placeholder*="Name"]').first();
    if (await fullNameInput.isVisible()) {
      await fullNameInput.fill('Test Customer');
    }

    const phoneInput = page.locator('input[name="phone"], input[type="tel"]').first();
    if (await phoneInput.isVisible()) {
      await phoneInput.fill('0241234567');
    }

    const regionSelect = page.locator('select[name="region"]');
    if (await regionSelect.isVisible()) {
      await regionSelect.selectOption({ index: 1 });
    }

    const addressInput = page.locator('textarea[name="streetAddress"], input[name="streetAddress"]').first();
    if (await addressInput.isVisible()) {
      await addressInput.fill('25 Test Road, Accra');
    }

    await fillLocation(page);
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }

    // Inline message above the button (no toast, no alert)
    await expect(page.getByRole('alert')).toHaveText('Phone number already used today', { timeout: 10000 });

    await page.screenshot({ path: 'test-results/screenshots/checkout-error-toast.png' });
  });

  test('the not-available screen has no Go Home button and no link to the admin app', async ({ page }) => {
    await mock404Form(page);
    await page.goto('/form/bad-slug-abc');

    await expect(page.getByRole('heading', { name: 'This form is not available.' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.locator('text=Go Home')).toHaveCount(0);
  });
});
