// M3-T69 screenshot script (F-111). Visits every page of the M3 shell in light and dark at 1440 and 760 px
// and saves full-page PNGs. It only logs in and views pages: it changes no data.
//
// Usage (from the repo root): node frontend/scripts/screenshots.mjs [--base http://localhost:5174] [--out docs/screenshots/m3]
// Env:   SHOT_EMAIL / SHOT_PASSWORD (owner login), SHOT_FORM_SLUG (public checkout), SHOT_API (default http://localhost:3001),
//        SHOT_CHANNEL (browser channel, default "chrome": the system Chrome, no download).
// Output: <out>/<page>-<theme>-<width>.png and <out>/report.json (pages that scroll sideways, console errors).
// Exit 1 when any page scrolls sideways. The PNGs are git-ignored: attach them to the PR.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { THEMES, WIDTHS, parseArgs, buildPages, shotName, scrollsSideways, buildReport, exitCode } from './lib/screenshots.mjs';

// Playwright lives at the repo root (dev dependency), one level above frontend/.
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', '..', 'package.json'));

const THEME_KEY = 'codadmin-theme'; // src/utils/theme.ts

async function apiGet(api, token, url) {
  const res = await fetch(`${api}${url}`, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env);
  const { chromium } = require('playwright');
  const out = path.resolve(opts.out);
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch({ channel: process.env.SHOT_CHANNEL || 'chrome' });

  // Log in once through the real form and keep the session.
  const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await loginCtx.newPage();
  await login.goto(`${opts.base}/login`);
  await login.fill('input[type="email"]', opts.email);
  await login.fill('input[type="password"]', opts.password);
  await Promise.all([login.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), login.click('button[type="submit"]')]);
  const storageState = await loginCtx.storageState();
  await loginCtx.close();

  // One order and one customer from the running data, for the drawer and the detail page.
  let orderId = null;
  let customerId = null;
  try {
    const res = await fetch(`${opts.api}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: opts.email, password: opts.password }),
    });
    const token = (await res.json()).tokens.accessToken;
    orderId = (await apiGet(opts.api, token, '/api/orders?limit=1'))?.orders?.[0]?.id ?? null;
    customerId = (await apiGet(opts.api, token, '/api/customers?limit=1'))?.customers?.[0]?.id ?? null;
  } catch (e) {
    console.warn(`Could not read an order and a customer from ${opts.api}: ${e.message}`);
  }

  const pages = buildPages({ orderId, customerId, formSlug: opts.formSlug });
  const shots = [];

  for (const theme of THEMES) {
    const newContext = (extra = {}) => browser.newContext({ storageState, ...extra });
    for (const def of pages) {
      if (def.skipped) {
        console.warn(`skip ${def.name}: no ${def.needs} found`);
        continue;
      }
      const ctx = await newContext(def.public ? { storageState: undefined } : {});
      await ctx.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* blocked */ } }, [THEME_KEY, theme]);
      if (def.as403) {
        // The owner can open everything, so answer /me with a menu that hides the page: the shell then shows the 403 page.
        await ctx.route('**/api/auth/me', async (route) => {
          const res = await route.fetch();
          await route.fulfill({ response: res, json: { ...(await res.json()), menu: ['dashboard'] } });
        });
      }
      const page = await ctx.newPage();
      let errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));

      for (const width of WIDTHS) {
        errors = [];
        await page.setViewportSize({ width, height: 900 });
        try {
          await page.goto(`${opts.base}${def.path}`, { waitUntil: 'networkidle', timeout: 30000 });
        } catch {
          // networkidle can stall on sockets; the page is still usable
        }
        if (def.as403) await page.getByText('You do not have access to this page').waitFor({ timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(600);
        const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        const file = shotName(def.name, theme, width);
        await page.screenshot({ path: path.join(out, file), fullPage: true });
        const sideways = scrollsSideways(size);
        shots.push({ page: def.name, theme, width, file, ...size, sideways, errors: [...errors] });
        console.log(`${sideways ? 'SIDEWAYS ' : 'ok       '}${file}${errors.length ? `  (${errors.length} console errors)` : ''}`);
      }
      await ctx.close();
    }
  }
  await browser.close();

  const report = buildReport({ base: opts.base, shots });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.shotCount} screenshots in ${out}; ${report.sideways.length} scroll sideways.`);
  process.exit(exitCode(report));
}

main().catch((e) => { console.error(e); process.exit(2); });
