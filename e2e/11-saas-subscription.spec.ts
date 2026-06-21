import { test, expect } from '@playwright/test';

/**
 * Test Suite: SaaS subscription funnel (MAN-61)
 *
 * Covers the public, no-auth surface of the pricing-first funnel using API route
 * interception (no live backend / Paystack keys required):
 *   - /pricing renders the limits-only difference-first table (NGN, sky-blue, no indigo)
 *   - mobile (375px) stacks into per-tier cards (no horizontal-scroll table)
 *   - Enterprise is "Contact us"; Growth/Scale carry the plan into registration
 *   - registering with ?plan=growth posts planName + kicks off Paystack checkout
 *
 * The authenticated Billing states (pending / active / past_due / keyless-degrade)
 * and the real Paystack sandbox-card charge are exercised in the gated manual +
 * Membrane verification (they need platform test keys + a logged-in super_admin).
 */

test.describe('Pricing page (public, limits-only)', () => {
  test('renders the difference-first table with all three tiers in NGN', async ({ page }) => {
    await page.goto('/pricing');

    await expect(page.getByRole('heading', { name: /pick your ceiling/i })).toBeVisible();
    await expect(page.getByText('Growth').first()).toBeVisible();
    await expect(page.getByText('Scale').first()).toBeVisible();
    await expect(page.getByText('Enterprise').first()).toBeVisible();

    // NGN pricing, not GHS/indigo.
    await expect(page.getByText('₦10,000').first()).toBeVisible();
    await expect(page.getByText('₦20,000').first()).toBeVisible();

    // The 5 differentiating caps appear.
    await expect(page.getByText('Orders / month').first()).toBeVisible();
    await expect(page.getByText('5,000').first()).toBeVisible();

    // Growth CTA carries the plan into registration; Enterprise is contact-only.
    await expect(page.getByRole('link', { name: /start with growth/i })).toHaveAttribute('href', '/register?plan=growth');
    await expect(page.getByRole('link', { name: /contact us/i })).toBeVisible();

    // Accent is sky-blue (primary), never indigo.
    const indigo = await page.locator('[class*="indigo"]').count();
    expect(indigo).toBe(0);
  });

  test('stacks into per-tier cards on mobile (no horizontal-scroll table)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/pricing');

    // The md+ table is hidden; the mobile card stack is shown.
    await expect(page.locator('table').first()).toBeHidden();
    await expect(page.getByRole('link', { name: /start with growth/i })).toBeVisible();
    // No horizontal overflow at 375px.
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollW).toBeLessThanOrEqual(380);
  });
});

test.describe('Pricing-first registration', () => {
  test('registering with ?plan=growth posts planName and starts Paystack checkout', async ({ page }) => {
    // Mock the register + subscription-start endpoints; capture the redirect target.
    await page.route('**/api/auth/register-tenant', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      expect(body.planName).toBe('growth');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 1, email: body.adminEmail, firstName: 'Test', lastName: 'User', role: 'super_admin', tenantId: 'T1' },
          tokens: { accessToken: 'a', refreshToken: 'r' },
          tenant: { id: 'T1', name: body.companyName, slug: 'test-co' },
        }),
      });
    });

    let startCalled = false;
    await page.route('**/api/billing/start-subscription', async (route) => {
      startCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // A relative URL so the test stays on the local origin instead of hitting Paystack.
        body: JSON.stringify({ authorizationUrl: '/pricing?paystack=mock', reference: 'ref_mock' }),
      });
    });

    await page.goto('/register?plan=growth');
    await page.getByLabel(/company/i).fill('Test Co');
    await page.getByLabel(/your name|full name|name/i).first().fill('Test User');
    await page.getByLabel(/email/i).fill('owner@test.co');
    await page.getByLabel(/password/i).fill('Password123');
    await page.getByRole('button', { name: /create|register|get started|sign up/i }).first().click();

    // The frontend should call start-subscription then redirect to the (mocked) URL.
    await expect.poll(() => startCalled, { timeout: 5000 }).toBe(true);
    await page.waitForURL('**/pricing?paystack=mock', { timeout: 5000 });
  });
});
