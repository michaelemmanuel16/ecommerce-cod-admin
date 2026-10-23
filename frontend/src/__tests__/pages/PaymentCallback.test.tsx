// COD-36 (M3b-T18, F-403): the six states of the payment callback page, with fake timers for the polling.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const verifyPayment = vi.fn();
const getPublicForm = vi.fn();
vi.mock('../../services/public-orders.service', () => ({
  publicOrdersService: {
    verifyPayment: (...a: unknown[]) => verifyPayment(...a),
    getPublicForm: (...a: unknown[]) => getPublicForm(...a),
  },
}));

import { PaymentCallback } from '../../pages/PaymentCallback';
import { POLL_MS, POLL_LIMIT_MS, REDIRECT_DELAY_MS } from '../../lib/paymentPolling';

const open = (search = '?reference=ref_1') =>
  render(
    <MemoryRouter initialEntries={[`/checkout/payment/callback${search}`]}>
      <PaymentCallback />
    </MemoryRouter>,
  );

/** Let the pending promise chain settle. */
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  verifyPayment.mockReset();
  getPublicForm.mockReset().mockResolvedValue({ design: {}, supportWhatsapp: '+233245550103' });
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('PaymentCallback (F-403)', () => {
  it('Confirming: a spinner and "Confirming your payment. Please wait." until the first answer', async () => {
    verifyPayment.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByRole('heading', { name: 'Confirming your payment. Please wait.' })).toBeInTheDocument();
  });

  it('reads the reference or trxref', async () => {
    verifyPayment.mockResolvedValue({ status: 'failed', orderType: 'physical', formSlug: 'f' });
    open('?trxref=T123');
    await flush();
    expect(verifyPayment).toHaveBeenCalledWith('T123');
  });

  it('Pending: waits, asks again every 5 seconds, and shows success when the payment lands', async () => {
    verifyPayment
      .mockResolvedValueOnce({ status: 'pending', orderType: 'digital', formSlug: 'guide' })
      .mockResolvedValueOnce({ status: 'pending', orderType: 'digital', formSlug: 'guide' })
      .mockResolvedValue({ status: 'success', orderNumber: '#24118', orderType: 'digital', formSlug: 'guide', email: 'a***@gmail.com' });
    open();
    await flush();
    expect(screen.getByRole('heading', { name: 'We are waiting for your payment to be confirmed.' })).toBeInTheDocument();
    expect(verifyPayment).toHaveBeenCalledTimes(1);
    await tick(POLL_MS);
    expect(verifyPayment).toHaveBeenCalledTimes(2);
    await tick(POLL_MS);
    expect(verifyPayment).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('heading', { name: 'Order received.' })).toBeInTheDocument();
    expect(screen.getByTestId('order-number')).toHaveTextContent('#24118');
    expect(screen.getByText('We sent the download link to a***@gmail.com.')).toBeInTheDocument();
    // it stops asking once it has an answer
    await tick(POLL_MS * 3);
    expect(verifyPayment).toHaveBeenCalledTimes(3);
  });

  it('Pending for 5 minutes: stops asking and shows the reference', async () => {
    verifyPayment.mockResolvedValue({ status: 'pending', orderType: 'physical', formSlug: 'f' });
    open('?reference=ref_slow');
    await flush();
    await tick(POLL_LIMIT_MS);
    const calls = verifyPayment.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(60);
    expect(screen.getByRole('heading', { name: 'We have not received your payment yet.' })).toBeInTheDocument();
    expect(screen.getByText(/If you were charged, your order will appear within a few minutes/)).toBeInTheDocument();
    expect(screen.getByText('ref_slow')).toBeInTheDocument();
    await tick(POLL_MS * 10);
    expect(verifyPayment).toHaveBeenCalledTimes(calls);
  });

  it('keeps asking when a check fails on the network', async () => {
    verifyPayment.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'success', orderNumber: '#9', orderType: 'physical', formSlug: 'f' });
    open();
    await flush();
    expect(screen.getByRole('heading', { name: 'We are waiting for your payment to be confirmed.' })).toBeInTheDocument();
    await tick(POLL_MS);
    expect(screen.getByRole('heading', { name: 'Order received.' })).toBeInTheDocument();
  });

  it('Success: order number; no email line for a physical order; no redirect without a thank-you page', async () => {
    verifyPayment.mockResolvedValue({ status: 'success', orderNumber: '#24118', orderType: 'physical', formSlug: 'f' });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { href: 'http://localhost/', assign }, writable: true, configurable: true });
    open();
    await flush();
    expect(screen.getByText(/Your order number is/)).toBeInTheDocument();
    expect(screen.queryByText(/download link/)).toBeNull();
    await tick(REDIRECT_DELAY_MS + 100);
    expect(window.location.href).toBe('http://localhost/');
  });

  it('Success with a thank-you page: leaves after 2 seconds for the URL the server built', async () => {
    const built = 'https://shop.example.com/thanks?order_id=24118&total=249&currency=GHS&reference=ref_1&package=12';
    verifyPayment.mockResolvedValue({ status: 'success', orderNumber: '#24118', orderType: 'physical', formSlug: 'f', redirectUrl: built });
    Object.defineProperty(window, 'location', { value: { href: 'http://localhost/' }, writable: true, configurable: true });
    open();
    await flush();
    await tick(REDIRECT_DELAY_MS - 100);
    expect(window.location.href).toBe('http://localhost/');
    await tick(200);
    expect(window.location.href).toBe(built);
  });

  it('Failed: "Try again" opens the form in the same tab, the reference, and the support number', async () => {
    verifyPayment.mockResolvedValue({ status: 'failed', orderType: 'digital', formSlug: 'my-guide' });
    open('?reference=ref_bad');
    await flush();
    expect(screen.getByRole('heading', { name: 'The payment did not go through.' })).toBeInTheDocument();
    const again = screen.getByRole('link', { name: 'Try again' });
    expect(again).toHaveAttribute('href', '/form/my-guide');
    expect(again).not.toHaveAttribute('target');
    expect(screen.getByText('ref_bad')).toBeInTheDocument();
    expect(getPublicForm).toHaveBeenCalledWith('my-guide');
    await flush();
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550103');
  });

  it('Not found: "We could not find this payment." and the support number of the form named in ?form=', async () => {
    verifyPayment.mockResolvedValue({ status: 'not_found', orderType: null, formSlug: null });
    open('?reference=ref_1&form=my-form');
    await flush();
    expect(screen.getByRole('heading', { name: 'We could not find this payment.' })).toBeInTheDocument();
    expect(getPublicForm).toHaveBeenCalledWith('my-form');
    await flush();
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550103');
  });

  it('a link with no reference is Not found, asks the server nothing, and still shows the support number of ?form=', async () => {
    open('?form=my-form');
    await flush();
    await flush();
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toBeInTheDocument();
    expect(verifyPayment).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'We could not find this payment.' })).toBeInTheDocument();
  });

  it('shows no support link when the store has none, and takes its colours from the form', async () => {
    getPublicForm.mockResolvedValue({ design: { colors: { primary: '#2563eb' } }, supportWhatsapp: null });
    verifyPayment.mockResolvedValue({ status: 'success', orderNumber: '#5', orderType: 'physical', formSlug: 'f' });
    open();
    await flush();
    await flush();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('order-number')).toHaveStyle({ color: 'rgb(37, 99, 235)' });
  });

  it('never says Nigeria only and never fires a browser Purchase', async () => {
    verifyPayment.mockResolvedValue({ status: 'success', orderNumber: '#5', orderType: 'physical', formSlug: 'f' });
    const fbq = vi.fn();
    (window as unknown as { fbq: unknown }).fbq = fbq;
    open();
    await flush();
    expect(document.body.textContent).not.toMatch(/nigeria/i);
    expect(fbq).not.toHaveBeenCalled();
  });
});
