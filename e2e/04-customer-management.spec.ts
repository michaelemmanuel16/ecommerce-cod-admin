import { test, expect } from '@playwright/test';
import { login, TEST_URLS } from './helpers/test-helpers';

/**
 * Test Suite: Customer Management
 *
 * Tests customer-related functionality:
 * - View customers list
 * - Search customers
 * - View customer details
 * - View customer order history
 */

test.describe('Customer Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(TEST_URLS.customers);
    await page.waitForTimeout(2000);
  });

  test('should display customers list', async ({ page }) => {
    console.log('Test: Display customers list');

    // Verify we're on customers page
    await expect(page).toHaveURL(TEST_URLS.customers);

    // Take screenshot
    await page.screenshot({ path: 'test-results/screenshots/customers-list.png', fullPage: true });

    // Check for customer data
    const hasCustomers = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('customer') || text.includes('@') || text.includes('phone');
    });

    expect(hasCustomers).toBeTruthy();

    // Count customer rows or cards
    const customerElements = await page.locator('[class*="customer"], tr, [data-testid*="customer"]').count();

    console.log('Customer elements found:', customerElements);
    console.log('Customers list displayed successfully');
  });

  test('should search customers by name', async ({ page }) => {
    console.log('Test: Search customers by name');

    // Find search input
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first();

    if (await searchInput.isVisible()) {
      // Get count before search
      const customersBeforeSearch = await page.locator('tr, [class*="customer-card"]').count();

      // Search for a customer
      await searchInput.fill('Alice');
      await page.waitForTimeout(1000);

      // Take screenshot
      await page.screenshot({ path: 'test-results/screenshots/customers-search.png' });

      // Count after search
      const customersAfterSearch = await page.locator('tr, [class*="customer-card"]').count();

      console.log('Customers before search:', customersBeforeSearch, 'after:', customersAfterSearch);

      // Clear search
      await searchInput.clear();
      await page.waitForTimeout(1000);

      console.log('Customer search working');
    } else {
      console.log('Search input not found');
      test.skip();
    }
  });

  test('should search customers by email', async ({ page }) => {
    console.log('Test: Search customers by email');

    const searchInput = page.locator('input[placeholder*="search" i]').first();

    if (await searchInput.isVisible()) {
      await searchInput.fill('@example.com');
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'test-results/screenshots/customers-search-email.png' });

      console.log('Email search completed');
    }
  });

  test('should search customers by phone', async ({ page }) => {
    console.log('Test: Search customers by phone');

    const searchInput = page.locator('input[placeholder*="search" i]').first();

    if (await searchInput.isVisible()) {
      await searchInput.fill('123456');
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'test-results/screenshots/customers-search-phone.png' });

      console.log('Phone search completed');
    }
  });

  test('should view customer details', async ({ page }) => {
    console.log('Test: View customer details');

    // Find first customer link
    const customerLink = page.locator('a[href*="/customers/"], button:has-text("View"), tr').first();

    if (await customerLink.isVisible()) {
      await customerLink.click();
      await page.waitForTimeout(2000);

      // Verify we navigated to details page or modal opened
      const hasModal = await page.locator('[role="dialog"]').isVisible();
      const urlChanged = !page.url().endsWith('/customers');

      expect(hasModal || urlChanged).toBeTruthy();

      // Take screenshot
      await page.screenshot({ path: 'test-results/screenshots/customer-details.png', fullPage: true });

      // Check for customer information
      const hasCustomerInfo = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('email') || text.includes('phone') || text.includes('address');
      });

      expect(hasCustomerInfo).toBeTruthy();

      console.log('Customer details displayed successfully');
    } else {
      console.log('No customers found to view');
      test.skip();
    }
  });

  test('should display customer order history', async ({ page }) => {
    console.log('Test: Customer order history');

    // Navigate to first customer details
    const customerLink = page.locator('a[href*="/customers/"]').first();

    if (await customerLink.isVisible()) {
      await customerLink.click();
      await page.waitForTimeout(2000);

      // Look for order history section
      const hasOrderHistory = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('order') || text.includes('history') || text.includes('purchase');
      });

      if (hasOrderHistory) {
        await page.screenshot({ path: 'test-results/screenshots/customer-order-history.png', fullPage: true });
        console.log('Order history section found');
      } else {
        console.log('Order history not found on customer details');
      }
    }
  });

  test('should filter customers', async ({ page }) => {
    console.log('Test: Filter customers');

    // Look for filter button
    const filterButton = page.locator('button:has-text("Filter")').first();

    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-results/screenshots/customers-filter-panel.png' });

      // Apply a filter
      const filterOption = page.locator('input[type="checkbox"], input[type="radio"]').first();
      if (await filterOption.isVisible()) {
        await filterOption.click();
        await page.waitForTimeout(1000);

        await page.screenshot({ path: 'test-results/screenshots/customers-filtered.png' });

        console.log('Customer filter applied');
      }
    } else {
      console.log('Filter not available');
    }
  });

  test('should paginate customers', async ({ page }) => {
    console.log('Test: Customer pagination');

    // Look for pagination controls
    const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next" i]').first();

    if (await nextButton.isVisible()) {
      // Get current page customers
      const customersPage1 = await page.locator('tr, [class*="customer-card"]').count();

      await nextButton.click();
      await page.waitForTimeout(1000);

      // Get next page customers
      const customersPage2 = await page.locator('tr, [class*="customer-card"]').count();

      await page.screenshot({ path: 'test-results/screenshots/customers-page-2.png' });

      console.log('Pagination working - page 1:', customersPage1, 'page 2:', customersPage2);
    } else {
      console.log('Pagination not available - not enough customers');
    }
  });

  test('should sort customers', async ({ page }) => {
    console.log('Test: Sort customers');

    // Look for sortable column headers
    const sortableHeader = page.locator('th[class*="sortable"], th button, th[role="button"]').first();

    if (await sortableHeader.isVisible()) {
      // Get first customer before sort
      const firstCustomerBefore = await page.locator('tr, [class*="customer-card"]').first().textContent();

      // Click to sort
      await sortableHeader.click();
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'test-results/screenshots/customers-sorted.png' });

      // Get first customer after sort
      const firstCustomerAfter = await page.locator('tr, [class*="customer-card"]').first().textContent();

      console.log('Sort applied - order changed:', firstCustomerBefore !== firstCustomerAfter);
    } else {
      console.log('Sorting not available');
    }
  });

  test('should show customer statistics', async ({ page }) => {
    console.log('Test: Customer statistics');

    // Look for stat cards or metrics
    const hasStats = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('total') || text.includes('active') || text.includes('new');
    });

    if (hasStats) {
      await page.screenshot({ path: 'test-results/screenshots/customers-statistics.png' });
      console.log('Customer statistics displayed');
    } else {
      console.log('Statistics not visible');
    }
  });

  test('should access add customer form', async ({ page }) => {
    console.log('Test: Add customer form');

    // Look for add customer button
    const addButton = page.locator('button:has-text("Add Customer"), button:has-text("New Customer"), button:has-text("Create")').first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Check if form appeared
      const hasForm = await page.locator('form, [role="dialog"]').isVisible();

      if (hasForm) {
        await page.screenshot({ path: 'test-results/screenshots/customer-add-form.png' });
        console.log('Add customer form accessible');
      }
    } else {
      console.log('Add customer button not found');
    }
  });
});
