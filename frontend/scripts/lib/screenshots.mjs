// Pure parts of scripts/screenshots.mjs (M3-T69): arguments, page list, file names, scroll check, exit code.
// No browser here, so a unit test can run it (src/__tests__/scripts/screenshots.test.ts).

export const THEMES = ['light', 'dark'];
export const WIDTHS = [1440, 760];

export const DEFAULTS = {
  base: 'http://localhost:5174',
  api: 'http://localhost:3001',
  out: 'docs/screenshots/m3',
  formSlug: 'dictamni-checkout-ghana',
  email: 'admin@codadmin.com',
  password: 'password123',
};

/** The built Reports tabs (src/pages/reports/tabs.ts) and every Settings tab (src/pages/settings/tabs.ts) for the owner. */
export const REPORT_TABS = ['overview', 'sales', 'delivery', 'team'];
export const SETTINGS_TABS = [
  'profile', 'security', 'business', 'currencies', 'statuses', 'notifications', 'billing',
  'users', 'permissions', 'integrations', 'checkout-forms',
];

/** node scripts/screenshots.mjs [--base <url>] [--out <dir>]; env gives the login, the API and the public form slug. */
export function parseArgs(argv, env = {}) {
  const opts = {
    base: DEFAULTS.base,
    out: DEFAULTS.out,
    api: env.SHOT_API || DEFAULTS.api,
    email: env.SHOT_EMAIL || DEFAULTS.email,
    password: env.SHOT_PASSWORD || DEFAULTS.password,
    formSlug: env.SHOT_FORM_SLUG || DEFAULTS.formSlug,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--base' && flag !== '--out') throw new Error(`Unknown argument ${flag}. Use --base <url> and --out <dir>.`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
    opts[flag.slice(2)] = value;
  }
  opts.base = opts.base.replace(/\/+$/, '');
  return opts;
}

/**
 * Every page of the M3 shell. `needs` marks a page that must have an id from the running data;
 * `public` pages need no login; `as403` pages are opened with a menu that hides them, to show the 403 page.
 */
export function buildPages({ orderId, customerId, formSlug }) {
  const pages = [
    { name: 'dashboard', path: '/' },
    { name: 'orders', path: '/orders' },
    { name: 'order-drawer', path: orderId ? `/orders/${orderId}` : null, needs: 'an order' },
    { name: 'customers', path: '/customers' },
    { name: 'customer-detail', path: customerId ? `/customers/${customerId}` : null, needs: 'a customer' },
    ...REPORT_TABS.map((tab) => ({ name: `reports-${tab}`, path: `/reports?tab=${tab}` })),
    ...SETTINGS_TABS.map((tab) => ({ name: `settings-${tab}`, path: `/settings?tab=${tab}` })),
    { name: 'checkout-forms', path: '/checkout-forms' },
    { name: 'onboarding', path: '/onboarding' },
    { name: '403', path: '/reports', as403: true },
    { name: '404', path: '/no-such-page' },
    { name: 'public-checkout', path: `/form/${formSlug}`, public: true },
  ];
  return pages.map((p) => ({ ...p, skipped: p.path === null }));
}

export const shotName = (page, theme, width) => `${page}-${theme}-${width}.png`;

/** Sideways scroll: the page is wider than the window. A one pixel rounding gap is not scroll. */
export const scrollsSideways = ({ scrollWidth, clientWidth }) => scrollWidth - clientWidth > 1;

/** 1 when any page scrolls sideways (the report lists them), else 0. */
export function exitCode(report) {
  return report.sideways.length > 0 ? 1 : 0;
}

/** Fold the per-shot results into the report.json shape. */
export function buildReport({ base, shots }) {
  const sideways = shots.filter((s) => s.sideways).map((s) => s.file);
  const consoleErrors = {};
  for (const s of shots) {
    if (!s.errors.length) continue;
    const list = (consoleErrors[s.page] ||= []);
    for (const e of s.errors) if (!list.includes(e)) list.push(e);
  }
  return { base, shotCount: shots.length, sideways, consoleErrors, shots };
}
