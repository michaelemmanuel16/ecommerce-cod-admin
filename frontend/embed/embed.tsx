/**
 * CodAdmin embed widget bootstrap.
 *
 * Two ways to use it on a host page:
 *
 *  Mode A — auto-render: drop an empty container and the widget renders the full
 *  checkout into it (inside a Shadow DOM so host-page CSS can't bleed in):
 *      <div data-codadmin-checkout data-slug="my-form"></div>
 *      <script src="https://codadminpro.com/embed.js"></script>
 *  Optional package lock: data-package="12" data-lock="1" (or ?package=12&lock=1
 *  on the host URL) restricts checkout to a single package.
 *
 *  Mode B — attach to existing form: the merchant keeps their own form markup and
 *  the widget just wires up submission:
 *      <form data-codadmin-checkout-form data-slug="my-form" data-package="12">
 *        <input name="name"> <input name="phone"> <input name="email">
 *        <input name="address"> <input name="state"> <button>Order</button>
 *      </form>
 *  On a successful (non-redirect) order the widget fires a bubbling
 *  `codadmin:success` CustomEvent on the form and, if data-on-success names a
 *  global function, calls it — both receive { orderId, total, currency,
 *  reference, package } so the host can show a thank-you or fire its own pixel.
 */
import { createElement } from 'react';
import { render } from 'react-dom';
import { EmbedCheckout } from './EmbedCheckout';
import { buildOrderPayload, submitOrder, fetchFormConfig } from './embedApi';
import { buildRedirectUrl } from '../src/lib/orderPayload';
import type { CheckoutFormData } from '../src/components/public/CheckoutForm';
// Compiled Tailwind CSS, inlined as a string and injected into each Shadow root.
import embedCss from './embed.css?inline';

const SCRIPT = document.currentScript as HTMLScriptElement | null;

// API origin: explicit data-api wins, else the origin the script was served from.
function resolveApiBase(): string {
  const explicit = SCRIPT?.getAttribute('data-api');
  if (explicit) return explicit.replace(/\/$/, '');
  if (SCRIPT?.src) {
    try {
      return new URL(SCRIPT.src).origin;
    } catch {
      /* fall through */
    }
  }
  return window.location.origin;
}

const API_BASE = resolveApiBase();

function pageQuery(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

// Resolve the locked package id from (in priority order) the element's
// data-package/data-lock, then the host URL's ?package=&lock=1.
function resolveLockedPackage(el: Element | null): number | null {
  const q = pageQuery();
  const pkg = el?.getAttribute('data-package') ?? (q.get('lock') ? q.get('package') : null);
  const lock = el?.hasAttribute('data-lock') || q.get('lock');
  if (!lock || !pkg || !/^\d+$/.test(pkg)) return null;
  return Number(pkg);
}

// ---------- Mode A: auto-render into empty containers ----------

const MODE_A_SELECTOR = '[data-codadmin-checkout]';
const mounted = new WeakSet<Element>();

function mountModeA(el: Element): void {
  if (mounted.has(el)) return;
  const slug = el.getAttribute('data-slug') || SCRIPT?.getAttribute('data-slug');
  if (!slug) {
    // No slug to render — skip silently so a stray attribute can't break the host.
    return;
  }
  mounted.add(el);

  const shadow = el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = embedCss;
  shadow.appendChild(style);
  const mount = document.createElement('div');
  shadow.appendChild(mount);

  render(
    createElement(EmbedCheckout, {
      apiBase: API_BASE,
      slug,
      lockedPackageId: resolveLockedPackage(el),
    }),
    mount,
  );
}

function scanModeA(root: ParentNode = document): void {
  root.querySelectorAll(MODE_A_SELECTOR).forEach(mountModeA);
}

// ---------- Mode B: attach to an existing host form ----------

const MODE_B_SELECTOR = 'form[data-codadmin-checkout-form]';

// Pull a value from the host form by any of the accepted input names.
function field(form: HTMLFormElement, ...names: string[]): string {
  for (const name of names) {
    const el = form.elements.namedItem(name) as HTMLInputElement | null;
    if (el && typeof el.value === 'string' && el.value.trim()) return el.value.trim();
  }
  return '';
}

function setMessage(form: HTMLFormElement, text: string, isError: boolean): void {
  let node = form.querySelector<HTMLElement>('[data-codadmin-message]');
  if (!node) {
    node = document.createElement('p');
    node.setAttribute('data-codadmin-message', '');
    form.appendChild(node);
  }
  node.textContent = text;
  node.style.color = isError ? '#dc2626' : '#16a34a';
}

// Notify the host page that an order succeeded so it can run its own logic
// (thank-you UI, conversion pixel). Two channels, both fired:
//   1. a bubbling `codadmin:success` CustomEvent on the form
//   2. a global callback named by the form's data-on-success attribute
// Only used in Mode B's inline-success path; redirect orders hand off via the
// thank-you URL instead.
function fireSuccess(form: HTMLFormElement, detail: Record<string, unknown>): void {
  form.dispatchEvent(new CustomEvent('codadmin:success', { detail, bubbles: true }));
  const cbName = form.getAttribute('data-on-success');
  if (cbName) {
    const cb = (window as unknown as Record<string, unknown>)[cbName];
    if (typeof cb === 'function') {
      try {
        (cb as (d: Record<string, unknown>) => void)(detail);
      } catch {
        // A throwing host callback must not break the widget's own flow.
      }
    }
  }
}

function attachModeB(form: HTMLFormElement): void {
  if (mounted.has(form)) return;
  mounted.add(form);
  const slug = form.getAttribute('data-slug') || SCRIPT?.getAttribute('data-slug');
  if (!slug) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
    if (submitBtn) submitBtn.disabled = true;
    setMessage(form, 'Placing your order…', false);

    try {
      // Package: explicit data-package (locked), else a checked [name=package] control.
      const lockedPkg = resolveLockedPackage(form);
      const pkgValue = lockedPkg ?? Number(field(form, 'package'));
      const config = await fetchFormConfig(API_BASE, slug);
      const data: CheckoutFormData = {
        fullName: field(form, 'name', 'fullName', 'full_name'),
        phone: field(form, 'phone', 'phoneNumber', 'phone_number'),
        alternativePhone: field(form, 'alternatePhone', 'altPhone') || undefined,
        email: field(form, 'email') || undefined,
        region: field(form, 'state', 'region'),
        streetAddress: field(form, 'address', 'streetAddress', 'street_address'),
        selectedPackageId: pkgValue,
        selectedAddonIds: [],
        // Optional in Mode B — the host form may carry a [name=paymentMethod]
        // control. Absent → the server defaults physical orders to COD.
        paymentMethod: (field(form, 'paymentMethod') || undefined) as CheckoutFormData['paymentMethod'],
      };

      const { payload, totalAmount } = buildOrderPayload(config, data);
      const res = await submitOrder(API_BASE, slug, payload);

      if (res.authorization_url) {
        window.location.href = res.authorization_url;
        return;
      }
      const redirect = buildRedirectUrl(config.redirectUrl, {
        orderId: res.orderId,
        total: totalAmount,
        currency: config.currency,
        reference: res.paymentReference,
        package: pkgValue,
      });
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      setMessage(form, `Order #${res.orderId} placed successfully!`, false);
      fireSuccess(form, {
        orderId: res.orderId,
        total: totalAmount,
        currency: config.currency,
        reference: res.paymentReference,
        package: pkgValue,
      });
      form.reset();
    } catch (e: any) {
      setMessage(form, e.message || 'Failed to place order', true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function scanModeB(root: ParentNode = document): void {
  root.querySelectorAll<HTMLFormElement>(MODE_B_SELECTOR).forEach(attachModeB);
}

// ---------- Boot + observe ----------

function boot(): void {
  scanModeA();
  scanModeB();

  // Re-scan when host pages inject checkout containers/forms after load.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        // Match the node itself; scan* covers its descendants (querySelectorAll
        // excludes the root). All mount/attach calls are idempotent.
        if (n.matches(MODE_A_SELECTOR)) mountModeA(n);
        if (n.matches(MODE_B_SELECTOR)) attachModeB(n as HTMLFormElement);
        scanModeA(n);
        scanModeB(n);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
