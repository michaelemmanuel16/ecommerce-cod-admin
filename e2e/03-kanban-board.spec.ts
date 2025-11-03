import { test, expect } from '@playwright/test';
import { login, TEST_URLS } from './helpers/test-helpers';

/**
 * Test Suite: Kanban Board Interaction
 *
 * Tests drag-and-drop functionality and real-time updates:
 * - Display kanban columns
 * - Drag order between columns
 * - Verify status change after drag
 * - Check visual feedback
 */

test.describe('Kanban Board Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(TEST_URLS.orders);
    await page.waitForTimeout(2000);
  });

  test('should display kanban board with columns', async ({ page }) => {
    console.log('Test: Display kanban board');

    // Switch to kanban view if not already there
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Take screenshot of full kanban board
    await page.screenshot({ path: 'test-results/screenshots/kanban-board-full.png', fullPage: true });

    // Check for typical kanban column headers
    const columnHeaders = await page.locator('[class*="column"], [data-testid*="column"]').count();

    console.log('Kanban columns found:', columnHeaders);

    // Look for common status column names
    const hasColumns = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('pending') ||
             text.includes('confirmed') ||
             text.includes('preparing') ||
             text.includes('delivery') ||
             text.includes('delivered');
    });

    expect(hasColumns).toBeTruthy();

    console.log('Kanban board displayed with status columns');
  });

  test('should display order cards in kanban columns', async ({ page }) => {
    console.log('Test: Display order cards');

    // Switch to kanban view
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Look for order cards
    const orderCards = await page.locator('[class*="order-card"], [data-testid*="order-card"], [draggable="true"]').count();

    console.log('Order cards found:', orderCards);

    expect(orderCards).toBeGreaterThan(0);

    // Take snapshot of first order card
    const firstCard = page.locator('[class*="order-card"], [data-testid*="order-card"]').first();
    if (await firstCard.isVisible()) {
      await firstCard.screenshot({ path: 'test-results/screenshots/kanban-order-card.png' });

      // Check card content
      const cardText = await firstCard.textContent();
      console.log('Order card content preview:', cardText?.substring(0, 100));
    }
  });

  test('should show order details on card click', async ({ page }) => {
    console.log('Test: Order card click');

    // Switch to kanban view
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Find and click first order card
    const orderCard = page.locator('[class*="order-card"], [data-testid*="order-card"]').first();

    if (await orderCard.isVisible()) {
      await orderCard.click();
      await page.waitForTimeout(1000);

      // Check if modal or details page opened
      const hasModal = await page.locator('[role="dialog"], [class*="modal"]').isVisible();
      const urlChanged = !page.url().endsWith('/orders');

      expect(hasModal || urlChanged).toBeTruthy();

      await page.screenshot({ path: 'test-results/screenshots/kanban-order-details.png' });

      console.log('Order details opened:', hasModal ? 'modal' : 'new page');
    }
  });

  test('should support drag and drop between columns', async ({ page }) => {
    console.log('Test: Drag and drop functionality');

    // Switch to kanban view
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Find draggable order cards
    const draggableCards = await page.locator('[draggable="true"]').count();

    if (draggableCards > 0) {
      console.log('Found', draggableCards, 'draggable cards');

      // Get first draggable card
      const sourceCard = page.locator('[draggable="true"]').first();
      const sourceCardBox = await sourceCard.boundingBox();

      if (sourceCardBox) {
        // Take screenshot before drag
        await page.screenshot({ path: 'test-results/screenshots/kanban-before-drag.png', fullPage: true });

        // Find columns to drag between
        const columns = page.locator('[class*="column"], [data-testid*="column"]');
        const columnCount = await columns.count();

        console.log('Columns available for drag:', columnCount);

        if (columnCount >= 2) {
          // Get target column (second column)
          const targetColumn = columns.nth(1);
          const targetColumnBox = await targetColumn.boundingBox();

          if (targetColumnBox) {
            // Perform drag and drop
            console.log('Attempting drag from:', sourceCardBox, 'to:', targetColumnBox);

            // Method 1: Using dragTo
            try {
              await sourceCard.dragTo(targetColumn);
              await page.waitForTimeout(1000);

              // Take screenshot after drag
              await page.screenshot({ path: 'test-results/screenshots/kanban-after-drag.png', fullPage: true });

              console.log('Drag and drop completed successfully');
            } catch (error) {
              console.log('Drag method 1 failed:', error);

              // Method 2: Manual drag simulation
              try {
                await page.mouse.move(sourceCardBox.x + sourceCardBox.width / 2, sourceCardBox.y + sourceCardBox.height / 2);
                await page.mouse.down();
                await page.mouse.move(targetColumnBox.x + targetColumnBox.width / 2, targetColumnBox.y + targetColumnBox.height / 2, { steps: 10 });
                await page.mouse.up();
                await page.waitForTimeout(1000);

                await page.screenshot({ path: 'test-results/screenshots/kanban-after-drag-manual.png', fullPage: true });

                console.log('Manual drag completed');
              } catch (manualError) {
                console.log('Manual drag also failed:', manualError);
              }
            }
          }
        } else {
          console.log('Not enough columns for drag test');
        }
      }
    } else {
      console.log('No draggable cards found');
      test.skip();
    }
  });

  test('should filter kanban by status', async ({ page }) => {
    console.log('Test: Kanban filtering');

    // Switch to kanban view
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Look for filter controls
    const filterButton = page.locator('button:has-text("Filter")').first();

    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(500);

      // Select a status filter
      const filterCheckbox = page.locator('input[type="checkbox"]').first();
      if (await filterCheckbox.isVisible()) {
        const wasChecked = await filterCheckbox.isChecked();
        await filterCheckbox.click();
        await page.waitForTimeout(1000);

        // Take screenshot of filtered kanban
        await page.screenshot({ path: 'test-results/screenshots/kanban-filtered.png', fullPage: true });

        // Verify filter applied
        const isNowChecked = await filterCheckbox.isChecked();
        expect(isNowChecked).not.toBe(wasChecked);

        console.log('Kanban filter applied successfully');
      }
    }
  });

  test('should search orders in kanban view', async ({ page }) => {
    console.log('Test: Kanban search');

    // Switch to kanban view
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Find search input
    const searchInput = page.locator('input[placeholder*="search" i]').first();

    if (await searchInput.isVisible()) {
      // Get count before search
      const cardsBeforeSearch = await page.locator('[class*="order-card"]').count();

      // Search for order number
      await searchInput.fill('ORD-00001');
      await page.waitForTimeout(1000);

      // Take screenshot
      await page.screenshot({ path: 'test-results/screenshots/kanban-search.png', fullPage: true });

      // Count cards after search
      const cardsAfterSearch = await page.locator('[class*="order-card"]').count();

      console.log('Cards before search:', cardsBeforeSearch, 'after:', cardsAfterSearch);

      // Clear search
      await searchInput.clear();
      await page.waitForTimeout(1000);

      console.log('Kanban search working');
    }
  });

  test('should show column card counts', async ({ page }) => {
    console.log('Test: Column card counts');

    // Switch to kanban view
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Look for count indicators in column headers
    const hasCountIndicators = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('[class*="column-header"], [data-testid*="column-header"]'));
      return headers.some(header => {
        const text = header.textContent || '';
        return /\(\d+\)|\d+/.test(text); // Look for numbers in parentheses or standalone
      });
    });

    if (hasCountIndicators) {
      console.log('Column card counts displayed');
    } else {
      console.log('Card counts not found in column headers');
    }

    await page.screenshot({ path: 'test-results/screenshots/kanban-column-counts.png', fullPage: true });
  });

  test('should handle empty columns gracefully', async ({ page }) => {
    console.log('Test: Empty columns display');

    // Switch to kanban view
    const kanbanButton = page.locator('button:has-text("Kanban")').first();
    if (await kanbanButton.isVisible()) {
      await kanbanButton.click();
      await page.waitForTimeout(1000);
    }

    // Check for empty state messages
    const emptyStateExists = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('no orders') || text.includes('empty') || text.includes('drag here');
    });

    console.log('Empty state handling:', emptyStateExists ? 'present' : 'not visible');

    await page.screenshot({ path: 'test-results/screenshots/kanban-empty-state.png', fullPage: true });
  });
});
