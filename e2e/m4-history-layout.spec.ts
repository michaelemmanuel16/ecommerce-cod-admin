import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers/m3';

/**
 * M4 COD-46c: the Transfer history layout. The detail pane is a solid layer over the right of the list (a stacked block at 900 px
 * and below), the list scrolls sideways instead of spilling, and the Status cell keeps its three lines apart.
 *
 * Needs the NUMBERS.md fixture (see e2e/m4-inventory.spec.ts). Read-only: it changes no stock.
 *   run: E2E_BASE_URL=http://localhost:5201 E2E_API_URL=http://localhost:3101 npx playwright test e2e/m4-history-layout.spec.ts
 * Screenshots go to test-results/m4-history/.
 */
const ADMIN = 'fixture-admin@fixture-numbers.test';

async function openHistory(page: Page, theme: 'light' | 'dark') {
  await signIn(page, ADMIN);
  await page.goto('/inventory');
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await expect(page.getByRole('heading', { name: 'Inventory & stock' })).toBeVisible();
  await page.getByRole('button', { name: 'Transfer history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer history' });
  const table = dialog.getByRole('table', { name: 'Transfer history' });
  const row = table.getByRole('row').filter({ hasText: 'Received 5 short' });
  await expect(row).toBeVisible();
  return { dialog, table, row };
}

for (const width of [1440, 760]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`history layout at ${width} px, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { dialog, table, row } = await openHistory(page, theme);
      const list = dialog.locator('.histlist');
      const shot = (name: string) => dialog.screenshot({ path: `test-results/m4-history/${width}-${theme}-${name}.png` });

      // Closed: the list scrolls sideways or fits; the Status cell is whole, with the Overdue tag under the status tag.
      const fits = await list.evaluate((el) => el.scrollWidth <= el.clientWidth || ['auto', 'scroll'].includes(getComputedStyle(el).overflowX));
      expect(fits).toBe(true);
      const statusCell = row.getByRole('cell').last();
      expect(await statusCell.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const tag = await statusCell.getByText('Received 5 short').boundingBox();
      const overdue = await statusCell.getByText('Overdue').boundingBox();
      const sub = await statusCell.getByText(/Counted 36 of 41/).boundingBox();
      expect(overdue!.y).toBeGreaterThanOrEqual(tag!.y + tag!.height - 1);
      expect(sub!.y).toBeGreaterThanOrEqual(overdue!.y + overdue!.height - 1);
      await expect(statusCell).toContainText('Counted 36 of 41 · 5 not received');
      await shot('closed');

      // Open: a solid pane.
      await row.click();
      const pane = dialog.getByRole('complementary');
      await expect(pane).toContainText('Audit trail');
      const bg = await pane.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toMatch(/rgba\(.*, 0\)$/);
      expect(bg).not.toBe('transparent');
      expect(await pane.evaluate((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))).toBe(true);
      const paneBox = (await pane.boundingBox())!;
      const listBox = (await list.boundingBox())!;
      if (width > 900) {
        // A layer over the right of the list area: same height as the list area, flush right, the table keeps its width.
        expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
        const body = (await dialog.locator('.histbody').boundingBox())!;
        expect(Math.abs(paneBox.y - body.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(paneBox.y + paneBox.height - (body.y + body.height))).toBeLessThanOrEqual(1);
        expect(Math.abs(paneBox.x + paneBox.width - (body.x + body.width))).toBeLessThanOrEqual(1);
        expect(listBox.width).toBeGreaterThan(paneBox.width);
      } else {
        // Stacked: the pane sits under the list.
        expect(paneBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
      }
      // The picked row stays highlighted; the table is still full width.
      await expect(table.locator('tr.picked')).toHaveCount(1);
      await shot('open');

      // Escape closes the dialog as before.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  }
}
