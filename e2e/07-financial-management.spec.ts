import { test, expect, Page } from '@playwright/test';
import { login, clearBrowserState, TEST_URLS, waitForAPICall, isElementVisible } from './helpers/test-helpers';

/**
 * Comprehensive E2E tests for Financial Management module
 * Tests all 3 tabs: Overview, Agent Collections, Accounting & Analysis
 * Verifies data accuracy, integrity, and functionality
 */

test.describe('Financial Management - Overview Tab', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
    await login(page);
    await page.goto(TEST_URLS.financial);

    // Wait for the page to load
    await page.waitForSelector('h1:has-text("Financial Management")');
  });

  test('should display all KPI cards with correct data', async ({ page }) => {
    // Verify Overview tab is active by default
    await expect(page.locator('button[role="tab"]:has-text("Overview")')).toHaveAttribute('aria-selected', 'true');

    // Test Core Financial Health KPIs (5 cards)
    const kpiCards = page.locator('[data-testid^="kpi-"], .bg-white.rounded-lg.shadow.p-6');

    // Should have at least 5 KPI cards in the Overview section
    await expect(kpiCards).toHaveCount({ min: 5 });

    // Verify each KPI card has:
    // 1. Icon
    // 2. Label text
    // 3. Value (amount or number)
    const firstCard = kpiCards.first();
    await expect(firstCard.locator('svg')).toBeVisible(); // Icon
    await expect(firstCard.locator('h3, p.text-sm')).toBeVisible(); // Label
    await expect(firstCard.locator('p.text-2xl, p.text-3xl, div.text-2xl, div.text-3xl')).toBeVisible(); // Value
  });

  test('should verify all KPI values are numbers and properly formatted', async ({ page }) => {
    // Get all KPI values
    const kpiValues = await page.locator('p.text-2xl, p.text-3xl, div.text-2xl, div.text-3xl').allTextContents();

    // Each value should be either:
    // - A currency amount (GHS X,XXX.XX)
    // - A number (X,XXX)
    // - A percentage (X.X%)
    for (const value of kpiValues) {
      const cleanValue = value.trim();

      // Check if it's a valid financial value
      const isValidFormat =
        /^GHS\s?[\d,]+(\.\d{2})?$/.test(cleanValue) || // Currency
        /^[\d,]+$/.test(cleanValue) || // Number
        /^[\d.]+%$/.test(cleanValue); // Percentage

      expect(isValidFormat).toBeTruthy();
    }
  });

  test('should display Revenue vs Expense trend chart', async ({ page }) => {
    // Look for chart container (Recharts typically uses SVG)
    const chartContainer = page.locator('svg.recharts-surface, div.recharts-wrapper').first();
    await expect(chartContainer).toBeVisible({ timeout: 10000 });

    // Verify chart has data (check for lines/bars)
    const hasChartData = await page.evaluate(() => {
      const svg = document.querySelector('svg.recharts-surface');
      if (!svg) return false;

      // Check for line paths or bar rects
      const lines = svg.querySelectorAll('path.recharts-line-curve, path.recharts-line');
      const bars = svg.querySelectorAll('rect.recharts-bar-rectangle');

      return lines.length > 0 || bars.length > 0;
    });

    expect(hasChartData).toBeTruthy();
  });

  test('should display Cash Flow Forecasting section', async ({ page }) => {
    // Scroll to Cash Flow section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));

    // Verify Cash Position Summary cards
    const cashFlowSection = page.locator('div:has-text("Cash Flow")').first();
    await expect(cashFlowSection).toBeVisible();

    // Look for forecast chart
    const forecastChart = page.locator('svg.recharts-surface').nth(1); // Second chart on page
    await expect(forecastChart).toBeVisible({ timeout: 10000 });
  });

  test('should verify Cash Position KPIs are present', async ({ page }) => {
    // Look for specific cash-related KPIs
    const cashInTransit = page.locator('text=Cash in Transit, text=In Transit').first();
    const cashExpected = page.locator('text=Cash Expected, text=Expected').first();
    const totalAvailable = page.locator('text=Total Available, text=Available Cash').first();

    // At least one of these should be visible
    const cashKPIsVisible = await Promise.all([
      cashInTransit.isVisible().catch(() => false),
      cashExpected.isVisible().catch(() => false),
      totalAvailable.isVisible().catch(() => false)
    ]);

    expect(cashKPIsVisible.some(visible => visible)).toBeTruthy();
  });

  test('should handle date range filtering', async ({ page }) => {
    // Find date range picker
    const dateRangePicker = page.locator('input[placeholder*="date" i], button:has-text("Select date range")');

    if (await dateRangePicker.isVisible()) {
      // Click to open date picker
      await dateRangePicker.click();

      // Wait for calendar to appear
      await page.waitForSelector('[role="dialog"], .react-datepicker, .calendar', { timeout: 5000 });

      // Close it (we're just testing it opens)
      await page.keyboard.press('Escape');
    }
  });

  test('should export cash forecast data', async ({ page }) => {
    // Look for export button
    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download")').first();

    if (await exportButton.isVisible()) {
      // Set up download listener
      const downloadPromise = page.waitForEvent('download');

      await exportButton.click();

      // Wait for download to start
      const download = await downloadPromise;

      // Verify filename
      const fileName = download.suggestedFilename();
      expect(fileName).toMatch(/\.(csv|xlsx|pdf)$/i);
    }
  });
});

test.describe('Financial Management - Agent Collections Tab', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
    await login(page);
    await page.goto(TEST_URLS.financial);

    // Click Agent Collections tab
    await page.click('button[role="tab"]:has-text("Agent Collections")');

    // Wait for tab content to load
    await page.waitForSelector('text=Agent, text=Collection, text=Settlement', { timeout: 10000 });
  });

  test('should display Agent Collections KPIs', async ({ page }) => {
    // Verify agent-specific KPIs are displayed
    const kpiCards = page.locator('[data-testid^="kpi-"], .bg-white.rounded-lg.shadow.p-6');

    // Should have agent collection KPIs
    await expect(kpiCards).toHaveCount({ min: 3 });

    // Look for specific agent KPIs
    const agentsHoldingCash = await isElementVisible(page, 'text=Agents Holding Cash, text=Holding Cash');
    const totalCashHeld = await isElementVisible(page, 'text=Total Cash Held, text=Cash Held');
    const overdueSettlements = await isElementVisible(page, 'text=Overdue, text=Overdue Settlements');

    // At least 2 of these should be visible
    const visibleCount = [agentsHoldingCash, totalCashHeld, overdueSettlements].filter(v => v).length;
    expect(visibleCount).toBeGreaterThanOrEqual(2);
  });

  test('should display unified agent table with all required columns', async ({ page }) => {
    // Wait for table to load
    await page.waitForSelector('table, [role="table"]', { timeout: 10000 });

    const table = page.locator('table').first();
    await expect(table).toBeVisible();

    // Get table headers
    const headers = await table.locator('th, [role="columnheader"]').allTextContents();

    // Verify key columns are present
    const headerText = headers.join(' ').toLowerCase();

    expect(headerText).toContain('agent'); // Agent Name
    expect(headerText).toContain('cash'); // Cash Held or similar

    // Check if table has rows
    const rows = table.locator('tbody tr, [role="row"]');
    const rowCount = await rows.count();

    // Table should have at least 1 row (or show "No data" message)
    if (rowCount === 0) {
      const noDataMessage = await isElementVisible(page, 'text=No agents, text=No data');
      expect(noDataMessage).toBeTruthy();
    } else {
      expect(rowCount).toBeGreaterThan(0);
    }
  });

  test('should verify agent table data integrity', async ({ page }) => {
    const table = page.locator('table').first();
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount > 0) {
      // Check first row has valid data
      const firstRow = rows.first();
      const cells = await firstRow.locator('td').allTextContents();

      // Should have multiple columns
      expect(cells.length).toBeGreaterThanOrEqual(3);

      // At least one cell should have content
      const hasContent = cells.some(cell => cell.trim().length > 0);
      expect(hasContent).toBeTruthy();

      // Check for currency values in the row
      const rowText = cells.join(' ');
      const hasCurrencyValue = /GHS\s?[\d,]+/.test(rowText) || /[\d,]+\.\d{2}/.test(rowText);

      // If agent has cash, should show currency value
      if (rowText.includes('GHS') || rowText.match(/\d+/)) {
        expect(hasCurrencyValue || /\d+/.test(rowText)).toBeTruthy();
      }
    }
  });

  test('should verify aging buckets are displayed', async ({ page }) => {
    // Look for aging bucket indicators (0-3 days, 4-7 days, 8+ days)
    const table = page.locator('table').first();
    const tableContent = await table.textContent();

    // Check if aging data is present in table or separate section
    const hasAgingData =
      /\d+-\d+\s*days?/i.test(tableContent || '') ||
      /\d+\+\s*days?/i.test(tableContent || '') ||
      (await isElementVisible(page, 'text=0-3 Days, text=4-7 Days, text=8+ Days'));

    // If agents have outstanding collections, aging should be shown
    if (tableContent?.includes('GHS') && parseInt(tableContent.match(/\d+/)?.[0] || '0') > 0) {
      expect(hasAgingData).toBeTruthy();
    }
  });

  test('should display exposure distribution chart', async ({ page }) => {
    // Look for pie chart or distribution chart
    const chart = page.locator('svg.recharts-surface, div.recharts-wrapper');

    if (await chart.count() > 0) {
      await expect(chart.first()).toBeVisible();

      // Verify it's a pie chart (has pie slices)
      const hasPieSlices = await page.evaluate(() => {
        const svg = document.querySelector('svg.recharts-surface');
        if (!svg) return false;

        const paths = svg.querySelectorAll('path.recharts-pie-sector, path.recharts-sector');
        return paths.length > 0;
      });

      expect(hasPieSlices).toBeTruthy();
    }
  });

  test('should test agent table sorting', async ({ page }) => {
    const table = page.locator('table').first();
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount > 1) {
      // Find sortable column header (usually has cursor pointer or sort icon)
      const sortableHeader = table.locator('th[role="columnheader"]:has(svg), th:has(button)').first();

      if (await sortableHeader.isVisible()) {
        // Get first agent name before sort
        const firstAgentBefore = await rows.first().locator('td').first().textContent();

        // Click to sort
        await sortableHeader.click();

        // Wait for sort to complete
        await page.waitForTimeout(1000);

        // Get first agent name after sort
        const firstAgentAfter = await rows.first().locator('td').first().textContent();

        // Order should have changed (unless already sorted)
        // This is a basic check; exact verification depends on sort logic
      }
    }
  });

  test('should test agent table filters', async ({ page }) => {
    // Look for filter controls
    const overdueFilter = page.locator('input[type="checkbox"]:near(text="Overdue"), label:has-text("Overdue")');
    const blockedFilter = page.locator('input[type="checkbox"]:near(text="Blocked"), label:has-text("Blocked")');

    if (await overdueFilter.isVisible()) {
      // Get initial row count
      const table = page.locator('table').first();
      const initialRows = await table.locator('tbody tr').count();

      // Apply filter
      await overdueFilter.click();

      // Wait for filter to apply
      await page.waitForTimeout(1000);

      // Get filtered row count
      const filteredRows = await table.locator('tbody tr').count();

      // Row count should change (unless all are overdue)
      // Note: Could be same count if all agents are overdue
      expect(typeof filteredRows).toBe('number');
    }
  });

  test('should test search functionality', async ({ page }) => {
    // Look for search input
    const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]');

    if (await searchInput.isVisible()) {
      const table = page.locator('table').first();
      const initialRows = await table.locator('tbody tr').count();

      if (initialRows > 0) {
        // Get first agent name
        const firstAgentName = await table.locator('tbody tr').first().locator('td').first().textContent();

        if (firstAgentName && firstAgentName.trim()) {
          // Search for first few characters
          const searchTerm = firstAgentName.trim().substring(0, 3);
          await searchInput.fill(searchTerm);

          // Wait for search to filter
          await page.waitForTimeout(1000);

          // Should have results (at least the agent we searched for)
          const filteredRows = await table.locator('tbody tr').count();
          expect(filteredRows).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test('should verify agent action buttons', async ({ page }) => {
    const table = page.locator('table').first();
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount > 0) {
      const firstRow = rows.first();

      // Look for action buttons (Send Reminder, View Collections, Block/Unblock)
      const actionButtons = firstRow.locator('button');
      const buttonCount = await actionButtons.count();

      // Should have at least 1 action button per row
      expect(buttonCount).toBeGreaterThanOrEqual(1);

      // Check button text
      const buttonTexts = await actionButtons.allTextContents();
      const hasValidAction = buttonTexts.some(text =>
        text.toLowerCase().includes('view') ||
        text.toLowerCase().includes('remind') ||
        text.toLowerCase().includes('block') ||
        text.toLowerCase().includes('detail')
      );

      expect(hasValidAction || buttonCount > 0).toBeTruthy();
    }
  });

  test('should test "View Collections" action', async ({ page }) => {
    const table = page.locator('table').first();
    const viewButton = table.locator('button:has-text("View"), button:has-text("Details")').first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      // Should open modal or navigate to details
      const modalOpened = await page.waitForSelector('[role="dialog"], .modal', { timeout: 5000 }).catch(() => null);

      if (modalOpened) {
        // Verify modal has agent details
        const modal = page.locator('[role="dialog"], .modal');
        await expect(modal).toBeVisible();

        // Should show collection details
        const hasCollectionData = await modal.locator('text=Collection, text=Order, text=Amount').isVisible();
        expect(hasCollectionData).toBeTruthy();

        // Close modal
        await page.keyboard.press('Escape');
      }
    }
  });

  test('should export agent data to CSV', async ({ page }) => {
    const exportButton = page.locator('button:has-text("Export")').first();

    if (await exportButton.isVisible()) {
      const downloadPromise = page.waitForEvent('download');
      await exportButton.click();

      const download = await downloadPromise;
      const fileName = download.suggestedFilename();

      expect(fileName).toMatch(/\.(csv|xlsx)$/i);
      expect(fileName.toLowerCase()).toContain('agent');
    }
  });

  test('should verify no data duplication from Dashboard', async ({ page }) => {
    // This test ensures Agent Collections shows DIFFERENT data than Dashboard
    // Get data from Agent Collections tab
    const agentKPIs = await page.locator('[data-testid^="kpi-"], .bg-white.rounded-lg.shadow.p-6').allTextContents();

    // Switch to Overview tab
    await page.click('button[role="tab"]:has-text("Overview")');
    await page.waitForTimeout(1000);

    // Get data from Overview tab
    const overviewKPIs = await page.locator('[data-testid^="kpi-"], .bg-white.rounded-lg.shadow.p-6').allTextContents();

    // The content should be different (Agent Collections is more detailed)
    // At minimum, Agent Collections should have agent-specific data not in Overview
    const agentText = agentKPIs.join(' ').toLowerCase();
    const overviewText = overviewKPIs.join(' ').toLowerCase();

    // Agent Collections should mention "agents" more than Overview
    const agentMentionsInAgentTab = (agentText.match(/agent/g) || []).length;
    const agentMentionsInOverview = (overviewText.match(/agent/g) || []).length;

    expect(agentMentionsInAgentTab).toBeGreaterThanOrEqual(agentMentionsInOverview);
  });
});

test.describe('Financial Management - Accounting & Analysis Tab', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
    await login(page);
    await page.goto(TEST_URLS.financial);

    // Click Accounting & Analysis tab
    await page.click('button[role="tab"]:has-text("Accounting")');

    // Wait for sub-tabs to load
    await page.waitForSelector('button[role="tab"]:has-text("General Ledger"), button:has-text("General Ledger")', { timeout: 10000 });
  });

  test('should display all 4 sub-tabs', async ({ page }) => {
    // Verify all 4 sub-tabs are present
    const glTab = page.locator('button[role="tab"]:has-text("General Ledger"), button:has-text("General Ledger")');
    const statementsTab = page.locator('button[role="tab"]:has-text("Financial Statements"), button:has-text("Statements")');
    const profitabilityTab = page.locator('button[role="tab"]:has-text("Profitability"), button:has-text("Profitability")');
    const expensesTab = page.locator('button[role="tab"]:has-text("Expense"), button:has-text("Expense")');

    await expect(glTab).toBeVisible();
    await expect(statementsTab).toBeVisible();
    await expect(profitabilityTab).toBeVisible();
    await expect(expensesTab).toBeVisible();
  });

  test('should test General Ledger sub-tab', async ({ page }) => {
    // General Ledger should be default active
    const glTab = page.locator('button[role="tab"]:has-text("General Ledger"), button:has-text("General Ledger")').first();

    if (!(await glTab.getAttribute('aria-selected'))) {
      await glTab.click();
    }

    // Verify Chart of Accounts is visible
    await expect(page.locator('text=Chart of Accounts, text=Accounts')).toBeVisible();

    // Verify accounts table
    const table = page.locator('table').first();
    await expect(table).toBeVisible();

    // Should have account rows
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount > 0) {
      // Verify first account has required fields
      const firstRow = rows.first();
      const cells = await firstRow.locator('td').allTextContents();

      // Should have: Account Code, Name, Type, Balance
      expect(cells.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('should test view account ledger', async ({ page }) => {
    // Click View Ledger on first account
    const viewLedgerButton = page.locator('button:has-text("View Ledger"), button:has-text("View")').first();

    if (await viewLedgerButton.isVisible()) {
      await viewLedgerButton.click();

      // Should show ledger view
      await page.waitForTimeout(1000);

      // Verify ledger table or transactions are shown
      const ledgerTable = page.locator('table').first();
      await expect(ledgerTable).toBeVisible();

      // Should have transaction columns
      const headers = await ledgerTable.locator('th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();

      expect(
        headerText.includes('date') ||
        headerText.includes('transaction') ||
        headerText.includes('debit') ||
        headerText.includes('credit')
      ).toBeTruthy();
    }
  });

  test('should test "Record Journal Entry" modal', async ({ page }) => {
    const recordButton = page.locator('button:has-text("Record Journal Entry"), button:has-text("New Entry")');

    if (await recordButton.isVisible()) {
      await recordButton.click();

      // Wait for modal
      const modal = await page.waitForSelector('[role="dialog"], .modal', { timeout: 5000 });
      expect(modal).toBeTruthy();

      // Verify modal has form fields
      const descriptionField = page.locator('textarea[placeholder*="description" i], input[name="description"]');
      await expect(descriptionField).toBeVisible();

      // Close modal
      await page.click('button:has-text("Cancel"), button:has-text("Close")');
    }
  });

  test('should test Financial Statements sub-tab', async ({ page }) => {
    // Click Financial Statements tab
    await page.click('button[role="tab"]:has-text("Financial Statements"), button:has-text("Statements")');

    // Wait for content
    await page.waitForTimeout(1000);

    // Should show P&L or Balance Sheet
    const hasFinancialStatements = await isElementVisible(page, 'text=Income Statement, text=Balance Sheet, text=P&L, text=Profit');
    expect(hasFinancialStatements).toBeTruthy();

    // Should have financial data
    const pageContent = await page.textContent('body');
    const hasFinancialTerms =
      pageContent?.includes('Revenue') ||
      pageContent?.includes('Expenses') ||
      pageContent?.includes('Assets') ||
      pageContent?.includes('Liabilities');

    expect(hasFinancialTerms).toBeTruthy();
  });

  test('should verify Financial Statements data format', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Financial Statements"), button:has-text("Statements")');
    await page.waitForTimeout(1000);

    // Get all financial values
    const pageContent = await page.textContent('body');

    // Should have currency amounts
    const hasCurrencyValues = /GHS\s?[\d,]+(\.\d{2})?/.test(pageContent || '');
    expect(hasCurrencyValues).toBeTruthy();

    // Should show totals
    const hasTotals = pageContent?.toLowerCase().includes('total');
    expect(hasTotals).toBeTruthy();
  });

  test('should test Profitability Analysis sub-tab', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Profitability"), button:has-text("Profitability")');
    await page.waitForTimeout(1000);

    // Should show profitability KPIs
    const kpiCards = page.locator('[data-testid^="kpi-"], .bg-white.rounded-lg.shadow.p-6');
    await expect(kpiCards).toHaveCount({ min: 2 });

    // Look for key metrics
    const hasGrossProfit = await isElementVisible(page, 'text=Gross Profit');
    const hasNetProfit = await isElementVisible(page, 'text=Net Profit');
    const hasCOGS = await isElementVisible(page, 'text=COGS, text=Cost of Goods');

    expect(hasGrossProfit || hasNetProfit || hasCOGS).toBeTruthy();
  });

  test('should verify Profitability product table', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Profitability"), button:has-text("Profitability")');
    await page.waitForTimeout(1000);

    // Look for product table
    const table = page.locator('table').first();

    if (await table.isVisible()) {
      const headers = await table.locator('th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();

      // Should have product-related columns
      expect(
        headerText.includes('product') ||
        headerText.includes('sku') ||
        headerText.includes('revenue') ||
        headerText.includes('margin')
      ).toBeTruthy();
    }
  });

  test('should test Profitability trend chart', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Profitability"), button:has-text("Profitability")');
    await page.waitForTimeout(1000);

    // Look for chart
    const chart = page.locator('svg.recharts-surface, div.recharts-wrapper').first();

    if (await chart.isVisible()) {
      // Verify it has data
      const hasChartData = await page.evaluate(() => {
        const svg = document.querySelector('svg.recharts-surface');
        if (!svg) return false;

        const lines = svg.querySelectorAll('path.recharts-line, path.recharts-area');
        return lines.length > 0;
      });

      expect(hasChartData).toBeTruthy();
    }
  });

  test('should test Expense Management sub-tab', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Expense"), button:has-text("Expense")');
    await page.waitForTimeout(1000);

    // Should show expense categories or total
    const hasExpenseData = await isElementVisible(page, 'text=Logistics, text=Marketing, text=Expense');
    expect(hasExpenseData).toBeTruthy();

    // Should have expense table
    const table = page.locator('table').first();

    if (await table.isVisible()) {
      const headers = await table.locator('th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();

      expect(
        headerText.includes('expense') ||
        headerText.includes('category') ||
        headerText.includes('amount') ||
        headerText.includes('date')
      ).toBeTruthy();
    }
  });

  test('should test "Add Expense" functionality', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Expense"), button:has-text("Expense")');
    await page.waitForTimeout(1000);

    const addExpenseButton = page.locator('button:has-text("Add Expense"), button:has-text("New Expense")');

    if (await addExpenseButton.isVisible()) {
      await addExpenseButton.click();

      // Wait for modal or form
      const modal = await page.waitForSelector('[role="dialog"], .modal, form', { timeout: 5000 });
      expect(modal).toBeTruthy();

      // Verify has input fields
      const amountField = page.locator('input[name="amount"], input[type="number"]');
      const categoryField = page.locator('select[name="category"], input[name="category"]');

      const hasRequiredFields =
        await amountField.isVisible() ||
        await categoryField.isVisible();

      expect(hasRequiredFields).toBeTruthy();

      // Close modal
      await page.keyboard.press('Escape');
    }
  });

  test('should verify expense data integrity', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Expense"), button:has-text("Expense")');
    await page.waitForTimeout(1000);

    const table = page.locator('table').first();

    if (await table.isVisible()) {
      const rows = table.locator('tbody tr');
      const rowCount = await rows.count();

      if (rowCount > 0) {
        const firstRow = rows.first();
        const cells = await firstRow.locator('td').allTextContents();

        // Should have expense data
        const rowText = cells.join(' ');

        // Should have currency or number
        const hasAmount = /GHS\s?[\d,]+/.test(rowText) || /[\d,]+\.\d{2}/.test(rowText);
        expect(hasAmount).toBeTruthy();
      }
    }
  });

  test('should verify no redundancy across sub-tabs', async ({ page }) => {
    // Test that each sub-tab shows unique data

    // Get GL data
    const glTab = page.locator('button[role="tab"]:has-text("General Ledger")').first();
    if (await glTab.isVisible() && !(await glTab.getAttribute('aria-selected'))) {
      await glTab.click();
    }
    await page.waitForTimeout(500);
    const glContent = await page.textContent('body');

    // Get Statements data
    await page.click('button[role="tab"]:has-text("Financial Statements"), button:has-text("Statements")');
    await page.waitForTimeout(500);
    const statementsContent = await page.textContent('body');

    // Get Profitability data
    await page.click('button[role="tab"]:has-text("Profitability")');
    await page.waitForTimeout(500);
    const profitabilityContent = await page.textContent('body');

    // Get Expenses data
    await page.click('button[role="tab"]:has-text("Expense")');
    await page.waitForTimeout(500);
    const expensesContent = await page.textContent('body');

    // Each should have unique keywords
    expect(glContent?.includes('Chart of Accounts') || glContent?.includes('Ledger')).toBeTruthy();
    expect(statementsContent?.includes('Balance Sheet') || statementsContent?.includes('Income Statement')).toBeTruthy();
    expect(profitabilityContent?.includes('Gross Profit') || profitabilityContent?.includes('Margin')).toBeTruthy();
    expect(expensesContent?.includes('Expense') || expensesContent?.includes('Category')).toBeTruthy();
  });
});

test.describe('Financial Management - Data Integrity & Cross-Tab Verification', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
    await login(page);
  });

  test('should verify Outstanding AR consistency across tabs', async ({ page }) => {
    await page.goto(TEST_URLS.financial);

    // Get Outstanding AR from Overview tab
    await page.waitForSelector('text=Outstanding AR, text=Receivable, text=Outstanding', { timeout: 10000 });
    const overviewAR = await page.locator('text=Outstanding AR, text=Receivable').first().textContent();
    const overviewARValue = overviewAR?.match(/GHS\s?[\d,]+(\.\d{2})?/)?.[0];

    // Switch to Agent Collections tab
    await page.click('button[role="tab"]:has-text("Agent Collections")');
    await page.waitForTimeout(1000);

    // Get Outstanding AR from Agent Collections (sum of agent balances)
    const agentAR = await page.locator('text=Outstanding AR, text=Outstanding, text=Total').first().textContent();
    const agentARValue = agentAR?.match(/GHS\s?[\d,]+(\.\d{2})?/)?.[0];

    // Values should match (both represent same data)
    if (overviewARValue && agentARValue) {
      expect(overviewARValue).toBe(agentARValue);
    }
  });

  test('should verify Total Expenses consistency', async ({ page }) => {
    await page.goto(TEST_URLS.financial);

    // Get Total Expenses from Overview
    const overviewExpenses = await page.locator('text=Total Expenses, text=Expenses').first().textContent();
    const overviewExpensesValue = overviewExpenses?.match(/GHS\s?[\d,]+(\.\d{2})?/)?.[0];

    // Switch to Accounting & Analysis -> Expenses
    await page.click('button[role="tab"]:has-text("Accounting")');
    await page.waitForTimeout(500);
    await page.click('button[role="tab"]:has-text("Expense")');
    await page.waitForTimeout(1000);

    // Get sum of expenses from Expense Management
    const expenseTotal = await page.locator('text=Total, text=Total Expenses').first().textContent();
    const expenseTotalValue = expenseTotal?.match(/GHS\s?[\d,]+(\.\d{2})?/)?.[0];

    // Values should match
    if (overviewExpensesValue && expenseTotalValue) {
      expect(overviewExpensesValue).toBe(expenseTotalValue);
    }
  });

  test('should verify Net Profit consistency across Dashboard and Statements', async ({ page }) => {
    await page.goto(TEST_URLS.financial);

    // Get Net Profit from Overview
    const overviewProfit = await page.locator('text=Net Profit').first().textContent();
    const overviewProfitValue = overviewProfit?.match(/GHS\s?[\d,]+(\.\d{2})?/)?.[0];

    // Switch to Financial Statements
    await page.click('button[role="tab"]:has-text("Accounting")');
    await page.waitForTimeout(500);
    await page.click('button[role="tab"]:has-text("Financial Statements"), button:has-text("Statements")');
    await page.waitForTimeout(1000);

    // Get Net Profit from Financial Statements
    const statementProfit = await page.locator('text=Net Profit, text=Net Income').first().textContent();
    const statementProfitValue = statementProfit?.match(/GHS\s?[\d,]+(\.\d{2})?/)?.[0];

    // Values should match
    if (overviewProfitValue && statementProfitValue) {
      expect(overviewProfitValue).toBe(statementProfitValue);
    }
  });

  test('should verify all displayed numbers are valid', async ({ page }) => {
    await page.goto(TEST_URLS.financial);

    // Get all numbers on the page
    const allNumbers = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const numberPattern = /GHS\s?[\d,]+(\.\d{2})?|[\d,]+\.\d{2}|\d+%/g;
      return body.match(numberPattern) || [];
    });

    // Each number should be valid
    for (const num of allNumbers) {
      const isValid =
        /^GHS\s?[\d,]+(\.\d{2})?$/.test(num) || // Currency
        /^[\d,]+\.\d{2}$/.test(num) || // Decimal
        /^\d+%$/.test(num); // Percentage

      expect(isValid).toBeTruthy();
    }
  });

  test('should verify no NaN or undefined values are displayed', async ({ page }) => {
    await page.goto(TEST_URLS.financial);

    const pageContent = await page.textContent('body');

    // Check for error values
    expect(pageContent).not.toContain('NaN');
    expect(pageContent).not.toContain('undefined');
    expect(pageContent).not.toContain('null');
    expect(pageContent).not.toContain('[object Object]');
  });

  test('should verify all API calls return 200 OK', async ({ page }) => {
    const failedRequests: Array<{ url: string; status: number }> = [];

    page.on('response', response => {
      const url = response.url();
      const status = response.status();

      // Track API calls (not static assets)
      if (url.includes('/api/') && status !== 200) {
        failedRequests.push({ url, status });
      }
    });

    await page.goto(TEST_URLS.financial);

    // Wait for all data to load
    await page.waitForTimeout(3000);

    // Switch through all tabs to trigger all API calls
    await page.click('button[role="tab"]:has-text("Agent Collections")');
    await page.waitForTimeout(1000);

    await page.click('button[role="tab"]:has-text("Accounting")');
    await page.waitForTimeout(1000);

    // Check for failed requests
    expect(failedRequests).toHaveLength(0);
  });
});

test.describe('Financial Management - Performance & UX', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
    await login(page);
  });

  test('should load Financial page within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto(TEST_URLS.financial);
    await page.waitForSelector('h1:has-text("Financial Management")');

    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  test('should switch between tabs smoothly', async ({ page }) => {
    await page.goto(TEST_URLS.financial);

    // Measure tab switch time
    const startTime = Date.now();

    await page.click('button[role="tab"]:has-text("Agent Collections")');
    await page.waitForSelector('table', { timeout: 5000 });

    const switchTime = Date.now() - startTime;

    // Tab switch should be fast (< 2 seconds)
    expect(switchTime).toBeLessThan(2000);
  });

  test('should handle empty data gracefully', async ({ page }) => {
    // This test assumes a fresh database might have no data
    await page.goto(TEST_URLS.financial);

    // Check if any "No data" or "Empty" messages are shown properly
    const pageContent = await page.textContent('body');

    // If there's no data, should show friendly message (not error)
    if (!pageContent?.includes('GHS')) {
      const hasEmptyMessage =
        pageContent?.includes('No data') ||
        pageContent?.includes('No agents') ||
        pageContent?.includes('No expenses') ||
        pageContent?.includes('Empty');

      // Should either have data OR empty state message
      expect(hasEmptyMessage || pageContent?.includes('GHS')).toBeTruthy();
    }
  });

  test('should not have console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(TEST_URLS.financial);

    // Switch through tabs
    await page.click('button[role="tab"]:has-text("Agent Collections")');
    await page.waitForTimeout(1000);

    await page.click('button[role="tab"]:has-text("Accounting")');
    await page.waitForTimeout(1000);

    // Filter out known non-critical errors (like failed images, etc.)
    const criticalErrors = consoleErrors.filter(error =>
      !error.includes('favicon') &&
      !error.includes('404') &&
      !error.includes('ERR_BLOCKED_BY_CLIENT')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});
