import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * M3-T39, T40, T41 (F-200 to F-210): the owner Dashboard.
 * The numbers come from frontend/src/__tests__/fixtures/ownerDashboard.json (the NUMBERS.md fixture as the endpoint
 * returns it), served through a route on GET /api/dashboard/owner, because the dev database has no targets.
 * The role tests use the real dev API. Needs the dev users (password123) and the frontend with the repApp and agentApp
 * flags off. Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const PASSWORD = 'password123';
const fixturePath = path.join(__dirname, '../frontend/src/__tests__/fixtures/ownerDashboard.json');
const fixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

async function serve(page: Page, body: unknown) {
  await page.route('**/api/dashboard/owner**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

test.describe('T39 header, ladder, quests', () => {
  test('header sub-line, ladder pace chip, quest tags, no XP or streak text', async ({ page }) => {
    await serve(page, fixture());
    await signIn(page, 'admin@codadmin.com');
    await expect(page.getByText(/You need GH₵2,100 more delivered revenue today/)).toBeVisible();
    await expect(page.getByText("3 pts behind the year's pace")).toBeVisible();
    await expect(page.getByText('Behind', { exact: true })).toBeVisible();
    await expect(page.getByText('Hit', { exact: true })).toBeVisible();
    await expect(page.getByText('64 of 56 orders')).toBeVisible();
    await expect(page.getByText('Updated 06:42')).toBeVisible();
    const text = await page.locator('section.dash').innerText();
    expect(text).not.toMatch(/\bXP\b|\blevel\b|streak/i);
    expect(text).not.toMatch(/download report/i);
    await expect(page.getByLabel('Period').locator('option')).toHaveCount(7);
  });
});

test.describe('T40 tiles, chart, drivers, orders, errors', () => {
  test('tiles show 71% / 48% / GH₵23.4k; chart, cards and a recent order row', async ({ page }) => {
    await serve(page, fixture());
    await signIn(page, 'admin@codadmin.com');
    await expect(page.getByText('71%', { exact: true })).toBeVisible();
    await expect(page.getByText('48%', { exact: true })).toBeVisible();
    await expect(page.getByText('GH₵23.4k', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Delivered revenue for October/ })).toBeVisible();
    await expect(page.locator('.recharts-wrapper')).toBeVisible();
    await expect(page.getByText('GH₵164k')).toBeVisible();
    await page.getByText('#24117').click();
    await expect(page).toHaveURL(/\/orders\/24117$/);
  });

  test('one failed block shows its own Retry and nothing else breaks', async ({ page }) => {
    const body = fixture();
    body.chart = { error: { code: 'block_failed', errorId: 'e2e-chart-error' } };
    await serve(page, body);
    await signIn(page, 'admin@codadmin.com');
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('alert')).toContainText('Chart did not load');
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(1);
    await expect(page.getByText('71%', { exact: true })).toBeVisible();
  });

  test('works at 760 px in dark mode without a sideways scroll', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('codadmin-theme', 'dark'));
    await page.setViewportSize({ width: 760, height: 1000 });
    await serve(page, fixture());
    await signIn(page, 'admin@codadmin.com');
    await expect(page.getByText('GH₵23.4k', { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(wide).toBe(false);
  });
});

test.describe('T41 role homes (real dev API)', () => {
  test('manager sees the owner Dashboard', async ({ page }) => {
    await signIn(page, 'e2e-manager@codadmin.com');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Today's targets")).toBeVisible();
    await expect(page.getByText('Delivered revenue vs target')).toBeVisible();
  });

  test('finance clerk lands on Finance, stock keeper on Products', async ({ page }) => {
    await signIn(page, 'e2e-finance@codadmin.com');
    await expect(page).toHaveURL(/\/finance$/);
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await signIn(page, 'e2e-stock@codadmin.com');
    await expect(page).toHaveURL(/\/products$/);
  });

  test('flags off: call rep and delivery agent keep the old dashboard, not the owner one', async ({ page }) => {
    await signIn(page, 'e2e-rep@codadmin.com');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Delivered revenue vs target')).toHaveCount(0);
    await expect(page.getByText('Dashboard Not Available')).toHaveCount(0);
    await page.evaluate(() => localStorage.clear());
    await signIn(page, 'e2e-agent@codadmin.com');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Delivered revenue vs target')).toHaveCount(0);
    await expect(page.getByText('Dashboard Not Available')).toHaveCount(0);
  });
});
