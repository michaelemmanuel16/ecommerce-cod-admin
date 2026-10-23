import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentTab } from '../../components/forms/builder/PaymentTab';
import { BuilderHarness, type HarnessOptions } from '../fixtures/builderHarness';
import { snapshot } from '../fixtures/readSnapshot';
import type { PaymentOptions } from '../../services/checkout-forms.service';

const connection = (over: Partial<NonNullable<PaymentOptions['connection']>> = {}) => ({
  provider: 'paystack', mode: 'live' as const, isEnabled: true, supportedCurrencies: ['GHS'], lastCheckedAt: null, ...over,
});

const renderTab = (options: HarnessOptions & { payment: PaymentOptions }) =>
  render(
    <BuilderHarness options={{ ...options, ctx: { paymentOptions: options.payment, ...options.ctx } }}>
      <PaymentTab />
    </BuilderHarness>,
  );

const names = () => screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));

describe('PaymentTab, the method matrix (F-402)', () => {
  it('physical, flag off: only Cash on delivery, on and locked', () => {
    renderTab({ payment: { prepaidPhysical: false, connection: null } });
    expect(names()).toEqual(['Cash on delivery']);
    const cod = screen.getByLabelText('Cash on delivery') as HTMLInputElement;
    expect(cod.checked).toBe(true);
    expect(cod.disabled).toBe(true);
    expect(screen.queryByText(/Connect a payment provider/)).toBeNull();
  });

  it('physical, flag on: all three, with the provider line', () => {
    renderTab({ payment: { prepaidPhysical: true, connection: connection() } });
    expect(names()).toEqual(['Cash on delivery', 'Pay a deposit online', 'Pay in full online']);
    expect(screen.getByText(/Online payments go through Paystack \(live mode\)\./)).toBeInTheDocument();
    expect(screen.queryByText(/Real customers cannot pay yet/)).toBeNull();
  });

  it('physical, flag on: at most two methods', () => {
    renderTab({ payment: { prepaidPhysical: true, connection: connection() } });
    fireEvent.click(screen.getByLabelText('Pay in full online'));
    expect((screen.getByLabelText('Pay a deposit online') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Two methods are on. Turn one off to pick another.')).toBeInTheDocument();
  });

  it('the deposit percent box shows when deposit is on and holds 1 to 99', () => {
    renderTab({ payment: { prepaidPhysical: true, connection: connection() }, values: { paystackDepositEnabled: true } });
    const box = screen.getByLabelText('Deposit percent') as HTMLInputElement;
    expect(box.max).toBe('99');
    fireEvent.change(box, { target: { value: '100' } });
    expect(screen.getByText('Deposit must be a whole number from 1 to 99.')).toBeInTheDocument();
  });

  it('digital: Online payment in full, on and locked; no COD, no deposit, flag on or off', () => {
    for (const prepaidPhysical of [false, true]) {
      const { unmount } = renderTab({ formType: 'digital', payment: { prepaidPhysical, connection: connection() } });
      expect(names()).toEqual(['Online payment in full']);
      const full = screen.getByLabelText('Online payment in full') as HTMLInputElement;
      expect(full.checked).toBe(true);
      expect(full.disabled).toBe(true);
      unmount();
    }
  });

  it('never says "Nigeria only" or "Ask for prepayment"', () => {
    renderTab({ payment: { prepaidPhysical: true, connection: connection() } });
    expect(document.body.textContent).not.toMatch(/Nigeria only|Ask for prepayment/i);
  });

  it('with no connection it links to Connections', () => {
    renderTab({ payment: { prepaidPhysical: true, connection: null } });
    const link = screen.getByRole('link', { name: 'Connect a payment provider in Connections.' });
    expect(link).toHaveAttribute('href', '/connections');
  });
});

describe('PaymentTab, currency, test mode, paused (F-401)', () => {
  it('warns when the account cannot take the store currency, and the online switches cannot be turned on', () => {
    renderTab({ currency: 'GHS', payment: { prepaidPhysical: true, connection: connection({ supportedCurrencies: ['NGN'] }) } });
    expect(screen.getByText('This payment account cannot take GHS. Connect another account or provider.')).toBeInTheDocument();
    expect((screen.getByLabelText('Pay a deposit online') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Pay in full online') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Cash on delivery') as HTMLInputElement).disabled).toBe(false);
  });

  it('an online switch that is already on can still be turned off', () => {
    renderTab({
      currency: 'GHS',
      payment: { prepaidPhysical: true, connection: connection({ supportedCurrencies: ['NGN'] }) },
      values: { paystackFullEnabled: true },
    });
    expect((screen.getByLabelText('Pay in full online') as HTMLInputElement).disabled).toBe(false);
  });

  it('a connection never tested says so and blocks nothing', () => {
    renderTab({ payment: { prepaidPhysical: true, connection: connection({ supportedCurrencies: [] }) } });
    expect(screen.getByText('Test the connection in Connections to check which currencies it takes.')).toBeInTheDocument();
    expect((screen.getByLabelText('Pay in full online') as HTMLInputElement).disabled).toBe(false);
  });

  it('test mode shows "Real customers cannot pay yet."; live mode does not', () => {
    const { unmount } = renderTab({ payment: { prepaidPhysical: true, connection: connection({ mode: 'test' }) } });
    expect(screen.getByText(/\(test mode\)\. Real customers cannot pay yet\./)).toBeInTheDocument();
    unmount();
    renderTab({ payment: { prepaidPhysical: true, connection: connection({ mode: 'live' }) } });
    expect(screen.queryByText(/Real customers cannot pay yet/)).toBeNull();
  });

  it('flag off but the saved form has an online method on: the paused note shows and the stored value stays', () => {
    renderTab({ payment: { prepaidPhysical: false, connection: null }, values: { paystackFullEnabled: true } });
    expect(screen.getByText('Online payment is paused for physical products.')).toBeInTheDocument();
    expect(snapshot<{ paystackFullEnabled: boolean }>(screen, 'values-snapshot').paystackFullEnabled).toBe(true);
  });

  it('flag off and nothing online stored: no paused note', () => {
    renderTab({ payment: { prepaidPhysical: false, connection: null } });
    expect(screen.queryByText(/paused/)).toBeNull();
  });

  it('says so when the options could not be loaded', () => {
    render(
      <BuilderHarness options={{ ctx: { paymentOptionsFailed: true } }}>
        <PaymentTab />
      </BuilderHarness>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Payment options could not be loaded');
  });
});
