/**
 * M3-T69: the pure parts of scripts/screenshots.mjs: arguments, page list, file names, the sideways-scroll check
 * and the exit code. The browser part runs by hand against the dev stack.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper without types
import * as lib from '../../../scripts/lib/screenshots.mjs';

describe('screenshots: arguments', () => {
  it('defaults to the staging dev port, the m3 folder and the seeded owner', () => {
    const o = lib.parseArgs([], {});
    expect(o).toMatchObject({ base: 'http://localhost:5174', out: 'docs/screenshots/m3', email: 'admin@codadmin.com', password: 'password123', formSlug: 'dictamni-checkout-ghana' });
  });

  it('reads --base and --out, drops a trailing slash, and takes login and slug from env', () => {
    const o = lib.parseArgs(['--base', 'http://x:1/', '--out', '/tmp/shots'], { SHOT_EMAIL: 'a@b.c', SHOT_PASSWORD: 'pw', SHOT_FORM_SLUG: 'my-form' });
    expect(o).toMatchObject({ base: 'http://x:1', out: '/tmp/shots', email: 'a@b.c', password: 'pw', formSlug: 'my-form' });
  });

  it('refuses an unknown flag and a flag with no value', () => {
    expect(() => lib.parseArgs(['--nope'], {})).toThrow(/Unknown argument/);
    expect(() => lib.parseArgs(['--base'], {})).toThrow(/needs a value/);
    expect(() => lib.parseArgs(['--base', '--out', 'x'], {})).toThrow(/needs a value/);
  });
});

describe('screenshots: page list', () => {
  const pages = lib.buildPages({ orderId: 7, customerId: 9, formSlug: 'f1' });
  const byName = (n: string) => pages.find((p: { name: string }) => p.name === n);

  it('has the shell pages, each Reports tab, each Settings tab, 403, 404 and the public form', () => {
    expect(byName('dashboard').path).toBe('/');
    expect(byName('order-drawer').path).toBe('/orders/7');
    expect(byName('customer-detail').path).toBe('/customers/9');
    expect(['overview', 'sales', 'delivery', 'team'].map((t) => byName(`reports-${t}`).path)).toEqual(
      ['overview', 'sales', 'delivery', 'team'].map((t) => `/reports?tab=${t}`),
    );
    expect(pages.filter((p: { name: string }) => p.name.startsWith('settings-'))).toHaveLength(11);
    expect(byName('settings-billing').path).toBe('/settings?tab=billing');
    expect(byName('403').as403).toBe(true);
    expect(byName('404').path).toBe('/no-such-page');
    expect(byName('public-checkout')).toMatchObject({ path: '/form/f1', public: true });
  });

  it('names are unique, so no two pages write the same file', () => {
    const names = pages.map((p: { name: string }) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a page that needs data is skipped when the data is missing', () => {
    const none = lib.buildPages({ orderId: null, customerId: null, formSlug: 'f1' });
    expect(none.filter((p: { skipped: boolean }) => p.skipped).map((p: { name: string }) => p.name)).toEqual(['order-drawer', 'customer-detail']);
  });
});

describe('screenshots: file names, scroll check, exit code', () => {
  it('names a shot <page>-<theme>-<width>.png', () => {
    expect(lib.shotName('orders', 'dark', 760)).toBe('orders-dark-760.png');
  });

  it('there are two themes and two widths, so four shots per page', () => {
    expect(lib.THEMES).toEqual(['light', 'dark']);
    expect(lib.WIDTHS).toEqual([1440, 760]);
  });

  it('sideways scroll: wider than the window by more than one pixel', () => {
    expect(lib.scrollsSideways({ scrollWidth: 760, clientWidth: 760 })).toBe(false);
    expect(lib.scrollsSideways({ scrollWidth: 761, clientWidth: 760 })).toBe(false);
    expect(lib.scrollsSideways({ scrollWidth: 900, clientWidth: 760 })).toBe(true);
  });

  const shot = (page: string, sideways: boolean, errors: string[] = []) => ({ page, file: `${page}-light-760.png`, sideways, errors });

  it('the report lists sideways files and console errors per page, and the exit code follows', () => {
    const report = lib.buildReport({ base: 'http://b', shots: [shot('orders', true, ['boom', 'boom']), shot('customers', false)] });
    expect(report.sideways).toEqual(['orders-light-760.png']);
    expect(report.consoleErrors).toEqual({ orders: ['boom'] });
    expect(report.shotCount).toBe(2);
    expect(lib.exitCode(report)).toBe(1);
  });

  it('no sideways scroll gives exit code 0, even with console errors', () => {
    const report = lib.buildReport({ base: 'http://b', shots: [shot('orders', false, ['warn'])] });
    expect(lib.exitCode(report)).toBe(0);
  });
});
