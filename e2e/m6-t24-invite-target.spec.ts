import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * M6-T24 (F-1158, F-1157): the two M6 flows on a real backend and the test database. Run it with scripts/e2e-m6-t24.sh, which
 * seeds one tenant with an Owner (E2E_M6_OWNER), starts the servers on free ports and deletes the tenant after.
 *  1. The Owner invites a person on the Team page. No email provider is set up, so the app shows the link to copy. The person opens
 *     the link, chooses a password and is signed in. The Owner sees them Active.
 *  2. The Owner sets the person's target on the Targets page and the row shows the target and a status.
 */
test.skip(!process.env.E2E_M6_OWNER, 'run through scripts/e2e-m6-t24.sh');

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5411';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3411';
const SHOTS = process.env.E2E_SHOT_DIR ?? '/private/tmp/claude-501/-Users-mac-work/6a57e2f7-9895-48bf-bc32-b7a448b3804c/scratchpad/t24-shots';
const owner = JSON.parse(process.env.E2E_M6_OWNER ?? '{}') as { email: string; password: string };
const stamp = Date.now();
const person = { name: `Ama Tester${stamp}`, email: `e2e-ama-${stamp}@codadmin.test`, password: 'Passw0rd!person' };
const month = new Date().toISOString().slice(0, 7);

// E2E_BROWSER_CHANNEL=chrome runs the installed Chrome when the Playwright browser download is missing
test.use({ channel: process.env.E2E_BROWSER_CHANNEL || undefined, baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

async function ownerApiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, { data: { email: owner.email, password: owner.password } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).tokens.accessToken;
}

test.describe.serial('M6 invite and target', () => {
  let link = '';

  test('the Owner invites a person, the person accepts the link and signs in, the Owner sees them Active', async ({ page, browser }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', owner.email);
    await page.fill('input[type="password"]', owner.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'));

    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/staff');
    await page.getByRole('button', { name: 'Invite a person' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Full name').fill(person.name);
    await dialog.getByLabel('Email', { exact: true }).fill(person.email);
    await dialog.getByLabel('Role', { exact: true }).selectOption({ label: 'Call rep' });
    await dialog.getByRole('button', { name: 'Send invite' }).click();

    // no email provider in the test: the app keeps the invite and shows the link to copy
    const linkBox = page.getByLabel('Invite link');
    await expect(linkBox).toBeVisible();
    link = await linkBox.inputValue();
    expect(link).toContain(`localhost:${new URL(BASE_URL).port}/accept-invite?token=`);
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();

    await page.getByLabel('Search the team').fill(`Tester${stamp}`);
    const row = page.getByRole('row').filter({ hasText: person.name });
    await expect(row).toContainText('Invited');

    // the person, in a clean browser context
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const guest = await ctx.newPage();
    await guest.goto(link);
    await guest.getByLabel('Password', { exact: true }).fill(person.password);
    await guest.getByPlaceholder('Confirm your password').fill(person.password);
    await guest.getByRole('button', { name: 'Set password and continue' }).click();
    await guest.waitForFunction(() => !location.pathname.startsWith('/accept-invite'));
    await expect(guest).not.toHaveURL(/login|accept-invite/);
    // a used link is dead
    await guest.goto(link);
    await expect(guest.getByText(/no longer|invalid|used|new invite/i).first()).toBeVisible();
    await ctx.close();

    await page.reload();
    await page.getByLabel('Search the team').fill(`Tester${stamp}`);
    await expect(page.getByRole('row').filter({ hasText: person.name })).toContainText('Active');
    await page.screenshot({ path: `${SHOTS}/flow1-team-active.png` });
    expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
  });

  test('the Owner sets the person a target and the Targets row shows it', async ({ page, request }) => {
    const token = await ownerApiToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    // setup through the API: the North Star tree of the year and a Call rep role target of 100 confirmed orders that get delivered, for this month
    const year = Number(month.slice(0, 4));
    const ns = await request.post(`${API_URL}/api/targets/north-star`, { headers: auth, data: { year, annual: 1_200_000, mode: 'grow', plannedAov: 249 } });
    expect(ns.status(), await ns.text()).toBe(201);
    const roles = await request.get(`${API_URL}/api/roles/overview`, { headers: auth });
    const callRep = ((await roles.json()).roles as Array<{ id?: number; roleId?: number; name?: string; roleName?: string }>)
      .find((r) => (r.name ?? r.roleName) === 'Call rep');
    expect(callRep).toBeTruthy();
    const roleTarget = await request.post(`${API_URL}/api/targets`, {
      headers: auth, data: { scope: 'role', metric: 'confirmed_delivered', unit: 'count', value: 100, period: month, roleId: callRep!.id ?? callRep!.roleId },
    });
    expect(roleTarget.status(), await roleTarget.text()).toBe(201);

    await page.goto('/login');
    await page.fill('input[type="email"]', owner.email);
    await page.fill('input[type="password"]', owner.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'));
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/targets');
    const row = page.getByRole('row').filter({ hasText: person.name });
    await expect(row).toContainText('Set a target');
    await row.getByRole('button', { name: 'Set', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Metric').selectOption({ label: 'Confirmed orders that get delivered' });
    await dialog.getByLabel('Value').fill('40');
    await dialog.getByRole('button', { name: 'Add target' }).click();

    await expect(row).not.toContainText('Set a target');
    await expect(row).toContainText('40');
    // the status cell holds a status tag, not the empty dash
    await expect(row.locator('td[data-label="Status"]')).not.toHaveText('—');
    await page.screenshot({ path: `${SHOTS}/flow2-targets-person.png` });
    expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
  });
});
