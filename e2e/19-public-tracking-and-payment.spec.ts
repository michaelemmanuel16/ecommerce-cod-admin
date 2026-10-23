import { test, expect, type Page } from '@playwright/test';
import { COD_FORM, DIGITAL_FORM, PIXEL_ID, mockPublicApi } from './helpers/public-mocks';

/**
 * COD-37 (M3b-T19 and T21): the public checkout at 390 px with every outside call mocked (see helpers/public-mocks.ts).
 *  - Pixel calls and the 10 minute cooldown: a COD order is placed, the page is reloaded inside the cooldown, and the same
 *    order number shows with no second order POST, no second InitiateCheckout / Purchase. The browser event ids match the
 *    ids the server gets: InitiateCheckout beacon eid = the id posted to the CAPI mirror; Purchase eid = the raw order id.
 *  - Digital form paid online: the order POST answers an authorization_url that points at the local callback page; verify
 *    answers pending, then success with a masked email; the success state shows the download line. No provider page is opened.
 * The COD happy path with no pixel, the double tap and the not-available screen are in 10b-public-checkout-mobile.spec.ts.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const fillCod = async (page: Page) => {
  await page.getByPlaceholder('Enter full name').fill('Kwame Mensah');
  await page.getByPlaceholder('Enter phone').fill('0241234567');
  await page.locator('select').first().selectOption('Greater Accra');
  await page.locator('select').nth(1).selectOption('Osu');
  await page.getByPlaceholder(/Opposite Kasoa/).fill('Near the mall');
  await page.getByPlaceholder('Enter street address').fill('15 Main Street');
};

const ev = (u: URL) => u.searchParams.get('ev');

test.describe('pixel calls and cooldown (mocked)', () => {
  test('COD order, then a reload inside 10 minutes: same order number, no second order, no second pixel event', async ({ page }) => {
    const hits = await mockPublicApi(page, { form: COD_FORM, allowFacebook: true });

    await page.goto(`/form/${COD_FORM.slug}`);
    await expect(page.getByRole('heading', { name: 'Magic Groove Copybooks' })).toBeVisible();
    await expect.poll(() => hits.initiateCheckout.length).toBe(1);
    await expect.poll(() => hits.beacons.map(ev).sort()).toEqual(['InitiateCheckout', 'PageView']);

    // The browser InitiateCheckout and the server mirror share one event id.
    const initiate = hits.beacons.find((b) => ev(b) === 'InitiateCheckout')!;
    expect(initiate.searchParams.get('id')).toBe(PIXEL_ID);
    expect(hits.initiateCheckout[0].eventId).toBeTruthy();
    expect(hits.initiateCheckout[0].eventId).toBe(initiate.searchParams.get('eid'));

    await fillCod(page);
    await page.getByRole('button', { name: /terms/i }).click();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page.getByTestId('order-number')).toHaveText('#24118');

    // Purchase: the event id is the raw order id, never the "#24118" shown on screen.
    await expect.poll(() => hits.beacons.filter((b) => ev(b) === 'Purchase').length).toBe(1);
    const purchase = hits.beacons.find((b) => ev(b) === 'Purchase')!;
    expect(purchase.searchParams.get('eid')).toBe('24118');
    expect(purchase.searchParams.get('cd[value]')).toBe('249');
    expect(purchase.searchParams.get('cd[currency]')).toBe('GHS');
    expect(hits.orders).toHaveLength(1);

    // Reload inside the cooldown.
    const beaconsBefore = hits.beacons.length;
    const trackingBefore = hits.tracking.length;
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
    await expect(page.getByTestId('order-number')).toHaveText('#24118');
    await page.waitForTimeout(1500); // room for any late beacon
    expect(hits.orders).toHaveLength(1);
    expect(hits.initiateCheckout).toHaveLength(1);
    expect(hits.beacons).toHaveLength(beaconsBefore);
    expect(hits.tracking).toHaveLength(trackingBefore);

    // Pixel requests this mocked run made (names only, for the report).
    test.info().annotations.push({ type: 'pixel requests', description: [...new Set(hits.tracking.map((t) => {
      const u = new URL(t.split(' ')[1]);
      return u.pathname.endsWith('/tr') ? `facebook.com/tr ev=${u.searchParams.get('ev')}` : `${u.host}${u.pathname}`;
    }))].join('; ') });
    expect(hits.unmocked).toEqual([]);
  });

  test('a form with no pixel makes no tracking request and no mirror call', async ({ page }) => {
    const hits = await mockPublicApi(page, { form: { ...COD_FORM, slug: 'no-pixel', pixelConfig: null } });
    await page.goto('/form/no-pixel');
    await expect(page.getByRole('heading', { name: 'Magic Groove Copybooks' })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(hits.tracking).toEqual([]);
    expect(hits.initiateCheckout).toEqual([]);
    expect(hits.unmocked).toEqual([]);
  });
});

test.describe('digital form paid online (mocked provider)', () => {
  test('order POST gives a local callback URL; verify says pending then success; the download line shows', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const hits = await mockPublicApi(page, {
      form: DIGITAL_FORM,
      order: { status: 200, body: { success: true, authorization_url: `${baseURL}/checkout/payment/callback/${DIGITAL_FORM.slug}?reference=ref_x`, message: 'ok' } },
      verify: [
        { status: 'pending', orderType: 'digital', formSlug: DIGITAL_FORM.slug },
        { status: 'pending', orderType: 'digital', formSlug: DIGITAL_FORM.slug },
        { status: 'success', orderNumber: '#24120', orderType: 'digital', formSlug: DIGITAL_FORM.slug, email: 'a***@gmail.com' },
      ],
    });

    await page.goto(`/form/${DIGITAL_FORM.slug}`);
    await page.getByPlaceholder('Enter full name').fill('Ama Owusu');
    await page.getByPlaceholder('Enter phone').fill('0241234567');
    await page.getByPlaceholder('Enter email address').fill('ama@gmail.com');
    await page.getByRole('button', { name: 'Proceed to Payment' }).click();

    // the browser leaves for the (local) callback page in the same tab
    await expect(page).toHaveURL(/\/checkout\/payment\/callback\/guide\?reference=ref_x/);
    await expect(page.getByRole('heading', { name: 'We are waiting for your payment to be confirmed.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Order received.' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('order-number')).toHaveText('#24120');
    await expect(page.getByText('We sent the download link to a***@gmail.com.')).toBeVisible();

    expect(hits.orders).toHaveLength(1);
    expect(hits.orders[0]).toMatchObject({ formData: expect.objectContaining({ email: 'ama@gmail.com' }) });
    expect(hits.verifyCalls).toBeGreaterThanOrEqual(3);
    expect(hits.tracking).toEqual([]);
    expect(hits.unmocked).toEqual([]);
  });
});
