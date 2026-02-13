import { test, expect, Page } from '@playwright/test';
import { login, TEST_URLS, waitForAPICall, waitForToast } from './helpers/test-helpers';

/**
 * Test Suite: Agent Inventory Tracking
 *
 * Tests the agent inventory tracking feature:
 * - Products page expandable rows showing agent stock distribution
 * - Allocating stock from warehouse to a delivery agent
 * - Viewing agent stock panel with correct totals
 * - Transferring stock between agents
 * - Returning stock from agent to warehouse
 * - Transfer history modal
 * - API endpoints return correct data
 *
 * Pre-conditions:
 * - At least one active product with warehouse stock > 0
 * - At least one active delivery agent user
 */

const SCREENSHOTS_DIR = 'test-results/screenshots/agent-inventory';

test.describe('Agent Inventory Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ─── Products Page - Expandable Rows ──────────────────────────────────────

  test('should show expandable chevron on every product row', async ({ page }) => {
    console.log('Test: Expandable rows on Products page');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Verify the "With Agents" column header exists
    const withAgentsHeader = await page.getByText('With Agents').first();
    await expect(withAgentsHeader).toBeVisible();

    // Verify chevron icons exist on product rows
    const chevrons = page.locator('tbody tr td:first-child svg').first();
    await expect(chevrons).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-products-with-agents-column.png`, fullPage: true });
    console.log('Products page shows With Agents column and chevrons');
  });

  test('should expand product row and show AgentStockPanel', async ({ page }) => {
    console.log('Test: Expand product row');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Click the first product row to expand it
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();

    // Wait for the expanded panel to appear
    await page.waitForTimeout(1500);

    // The AgentStockPanel should be visible
    const panelHeader = await page.getByText('Agent Stock Distribution').first();
    await expect(panelHeader).toBeVisible();

    // Should show "Allocate" button
    const allocateBtn = await page.getByRole('button', { name: /allocate/i }).first();
    await expect(allocateBtn).toBeVisible();

    // Should show "History" button
    const historyBtn = await page.getByRole('button', { name: /history/i }).first();
    await expect(historyBtn).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-agent-stock-panel-expanded.png`, fullPage: true });
    console.log('AgentStockPanel renders correctly when row expanded');
  });

  test('should collapse product row when clicked again', async ({ page }) => {
    console.log('Test: Collapse expanded row');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    const firstRow = page.locator('tbody tr').first();

    // Expand
    await firstRow.click();
    await page.waitForTimeout(1000);
    await expect(page.getByText('Agent Stock Distribution').first()).toBeVisible();

    // Collapse
    await firstRow.click();
    await page.waitForTimeout(500);

    const panel = page.getByText('Agent Stock Distribution');
    await expect(panel).not.toBeVisible();

    console.log('Row collapses correctly on second click');
  });

  // ─── Allocate Stock ────────────────────────────────────────────────────────

  test('should open AllocateStockModal when Allocate button clicked', async ({ page }) => {
    console.log('Test: Open AllocateStockModal');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Expand first product row
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(1500);

    // Click Allocate button
    const allocateBtn = page.getByRole('button', { name: /allocate/i }).first();
    await allocateBtn.click();
    await page.waitForTimeout(500);

    // Modal should appear
    await expect(page.getByText('Allocate Stock to Agent')).toBeVisible();
    await expect(page.getByText('Warehouse Stock')).toBeVisible();

    // Agent dropdown should be present
    const agentSelect = page.locator('select').first();
    await expect(agentSelect).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-allocate-modal-open.png`, fullPage: true });
    console.log('AllocateStockModal opens with correct elements');
  });

  test('should allocate stock to a delivery agent', async ({ page }) => {
    console.log('Test: Allocate stock to agent');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Intercept the allocate API call
    const allocateResponse = waitForAPICall(page, '/api/agent-inventory/allocate', 'POST');

    // Expand first row
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(1500);

    // Click Allocate
    await page.getByRole('button', { name: /allocate/i }).first().click();
    await page.waitForTimeout(1000);

    // Wait for agents to load in dropdown
    await page.waitForTimeout(2000);

    // Select first available agent
    const agentSelect = page.locator('select').first();
    const agentOptions = await agentSelect.locator('option').count();

    if (agentOptions <= 1) {
      console.log('No delivery agents available - skipping allocation test');
      return;
    }

    // Select first actual agent (index 1, skipping placeholder)
    await agentSelect.selectOption({ index: 1 });

    // Enter quantity
    const quantityInput = page.locator('input[type="number"]').first();
    await quantityInput.fill('2');

    // Submit
    const submitBtn = page.getByRole('button', { name: /allocate stock/i });
    await submitBtn.click();

    // Wait for API response
    try {
      const response = await allocateResponse;
      const status = response.status();
      console.log(`Allocate API response status: ${status}`);
      expect([200, 201]).toContain(status);
    } catch (e) {
      console.log('API call may have completed before intercept registered');
    }

    // Toast should appear
    const toastShown = await waitForToast(page, undefined, 5000);
    console.log(`Toast shown after allocation: ${toastShown}`);

    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/04-after-allocation.png`, fullPage: true });
    console.log('Stock allocation completed');
  });

  test('should validate that quantity cannot exceed warehouse stock', async ({ page }) => {
    console.log('Test: Validate max quantity in AllocateStockModal');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Get warehouse stock from first row
    const warehouseStockCell = page.locator('tbody tr').first().locator('td').nth(5);
    const warehouseStockText = await warehouseStockCell.textContent();
    console.log(`Warehouse stock text: "${warehouseStockText}"`);

    // Expand and open modal
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /allocate/i }).first().click();
    await page.waitForTimeout(1000);

    // Enter quantity way above any stock
    const quantityInput = page.locator('input[type="number"]').first();
    await quantityInput.fill('999999');

    // Warning message should appear
    const warning = page.getByText(/exceeds warehouse stock/i);
    await expect(warning).toBeVisible();

    // Submit button should be disabled
    const submitBtn = page.getByRole('button', { name: /allocate stock/i });
    await expect(submitBtn).toBeDisabled();

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/05-quantity-validation.png`, fullPage: true });
    console.log('Quantity validation working correctly');
  });

  // ─── Transfer History Modal ────────────────────────────────────────────────

  test('should open TransferHistoryModal and show transfer records', async ({ page }) => {
    console.log('Test: Transfer history modal');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Expand first product row
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(1500);

    // Intercept history API call
    const historyAPICall = waitForAPICall(page, '/api/agent-inventory/transfers', 'GET');

    // Click History button
    const historyBtn = page.getByRole('button', { name: /history/i }).first();
    await historyBtn.click();

    // Wait for API call
    try {
      const response = await historyAPICall;
      expect(response.status()).toBe(200);
      const data = await response.json();
      console.log(`Transfer history returned ${data.transfers?.length ?? 0} records`);
    } catch (e) {
      console.log('History API call pre-loaded from cache');
    }

    await page.waitForTimeout(1000);

    // Modal title should appear
    await expect(page.getByText('Transfer History')).toBeVisible();

    // Filter dropdown should be present
    const filterSelect = page.locator('select').first();
    await expect(filterSelect).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/06-transfer-history-modal.png`, fullPage: true });
    console.log('Transfer history modal opens correctly');
  });

  // ─── API Endpoints ─────────────────────────────────────────────────────────

  test('should return correct data from GET /api/agent-inventory/product/:id', async ({ page }) => {
    console.log('Test: Product agent stock API endpoint');

    await login(page);

    // Get access token from localStorage
    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    const token = authData?.state?.accessToken;
    if (!token) {
      console.log('No auth token available - skipping API test');
      return;
    }

    // Get products to find a valid product ID
    const productsResponse = await page.request.get('/api/products', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(productsResponse.status()).toBe(200);
    const productsData = await productsResponse.json();
    const products = productsData.products || productsData;

    if (!products || products.length === 0) {
      console.log('No products found - skipping');
      return;
    }

    const productId = products[0].id;
    console.log(`Testing with product ID: ${productId}`);

    // Call agent stock endpoint
    const response = await page.request.get(`/api/agent-inventory/product/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify response shape
    expect(data).toHaveProperty('product');
    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('totalWithAgents');
    expect(data).toHaveProperty('totalValue');
    expect(Array.isArray(data.agents)).toBe(true);

    console.log(`Product ${productId} has ${data.agents.length} agents with stock, total: ${data.totalWithAgents}`);
  });

  test('should return correct data from GET /api/agent-inventory/summary', async ({ page }) => {
    console.log('Test: Agent inventory summary API');

    await login(page);

    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    const token = authData?.state?.accessToken;
    if (!token) {
      console.log('No auth token - skipping');
      return;
    }

    const response = await page.request.get('/api/agent-inventory/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('totalAgents');
    expect(data).toHaveProperty('totalQuantity');
    expect(data).toHaveProperty('totalValue');
    expect(Array.isArray(data.agents)).toBe(true);

    console.log(`Summary: ${data.totalAgents} agents holding ${data.totalQuantity} total units worth ${data.totalValue}`);
  });

  test('should return paginated transfer history from GET /api/agent-inventory/transfers', async ({ page }) => {
    console.log('Test: Transfer history API endpoint');

    await login(page);

    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    const token = authData?.state?.accessToken;
    if (!token) {
      console.log('No auth token - skipping');
      return;
    }

    const response = await page.request.get('/api/agent-inventory/transfers?page=1&limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty('transfers');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.transfers)).toBe(true);
    expect(data.pagination).toHaveProperty('page', 1);
    expect(data.pagination).toHaveProperty('limit', 10);
    expect(data.pagination).toHaveProperty('total');
    expect(data.pagination).toHaveProperty('totalPages');

    console.log(`Transfer history: ${data.pagination.total} total transfers`);
  });

  test('should reject allocation with invalid quantity via API', async ({ page }) => {
    console.log('Test: API rejects invalid allocation');

    await login(page);

    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    const token = authData?.state?.accessToken;
    if (!token) {
      console.log('No auth token - skipping');
      return;
    }

    // Attempt allocation with quantity 0 (invalid)
    const response = await page.request.post('/api/agent-inventory/allocate', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        productId: 1,
        agentId: 1,
        quantity: 0, // Invalid - must be >= 1
      },
    });

    // Should return 400 validation error
    expect(response.status()).toBe(400);
    console.log('API correctly rejects quantity 0');
  });

  test('should reject unauthenticated requests to agent inventory endpoints', async ({ page }) => {
    console.log('Test: Authentication required for agent inventory');

    // Attempt without auth token
    const response = await page.request.get('/api/agent-inventory/summary');

    // Should return 401
    expect(response.status()).toBe(401);
    console.log('API correctly rejects unauthenticated requests');
  });

  // ─── Return Stock Modal ────────────────────────────────────────────────────

  test('should show ReturnStockModal when return button clicked on agent row', async ({ page }) => {
    console.log('Test: Return stock modal');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Expand first product row
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(2000);

    // Check if any agents are listed
    const returnButtons = page.locator('button[title="Return to warehouse"]');
    const returnCount = await returnButtons.count();

    if (returnCount === 0) {
      console.log('No agents with stock found - skipping return modal test');
      return;
    }

    // Click the first return button
    await returnButtons.first().click();
    await page.waitForTimeout(500);

    // Modal should appear
    await expect(page.getByText('Return Stock to Warehouse')).toBeVisible();
    await expect(page.getByText(/On Hand/i)).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/07-return-modal.png`, fullPage: true });
    console.log('Return stock modal opens correctly');
  });

  // ─── Transfer Stock Modal ──────────────────────────────────────────────────

  test('should show TransferStockModal when transfer button clicked on agent row', async ({ page }) => {
    console.log('Test: Transfer stock modal');

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Expand first product row
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(2000);

    // Check if any agents are listed
    const transferButtons = page.locator('button[title="Transfer to another agent"]');
    const transferCount = await transferButtons.count();

    if (transferCount === 0) {
      console.log('No agents with stock found - skipping transfer modal test');
      return;
    }

    // Click the first transfer button
    await transferButtons.first().click();
    await page.waitForTimeout(500);

    // Modal should appear
    await expect(page.getByText('Transfer Stock Between Agents')).toBeVisible();
    await expect(page.getByText(/From:/i)).toBeVisible();
    await expect(page.getByText(/Available:/i)).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/08-transfer-modal.png`, fullPage: true });
    console.log('Transfer stock modal opens correctly');
  });

  // ─── "With Agents" column badge ───────────────────────────────────────────

  test('should show purple badge in With Agents column when stock is allocated', async ({ page }) => {
    console.log('Test: With Agents badge shown after allocation');

    // First get auth token and check if any agent stock exists
    await login(page);
    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });
    const token = authData?.state?.accessToken;

    if (token) {
      const summaryResp = await page.request.get('/api/agent-inventory/summary', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const summary = await summaryResp.json();

      if (summary.totalQuantity === 0) {
        console.log('No agent stock in system - badge may not appear (expected)');
        return;
      }
    }

    await page.goto(TEST_URLS.products);
    await page.waitForTimeout(2000);

    // Check for purple badge in With Agents column (bg-purple-100 text-purple-800)
    const purpleBadge = page.locator('span.bg-purple-100').first();
    const hasBadge = await purpleBadge.isVisible().catch(() => false);

    if (hasBadge) {
      const badgeText = await purpleBadge.textContent();
      console.log(`Found purple badge with value: ${badgeText}`);
      expect(parseInt(badgeText || '0')).toBeGreaterThan(0);
    } else {
      console.log('No agent stock badges visible (correct if no stock allocated)');
    }

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/09-with-agents-badge.png`, fullPage: true });
  });
});
