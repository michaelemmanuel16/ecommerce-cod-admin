import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentView, CustomerView } from '../../pages/orders/drawer/ViewBlocks';
import { Timeline } from '../../pages/orders/drawer/Timeline';
import { useConfigStore } from '../../stores/configStore';
import { DETAIL, TIMELINE } from '../fixtures/orderDetail';
import type { PaymentTagCode } from '../../services/orders.service';

beforeEach(() => useConfigStore.setState({ currency: 'GHS', loaded: true }));

describe('payment block and tag (F-323)', () => {
  const cases: Array<[PaymentTagCode, string, string]> = [
    ['pay_on_delivery', 'Pay on delivery', 'n'],
    ['cash_with_agent', 'Cash with agent', 'warn'],
    ['overdue_from_agent', 'Overdue from agent', 'bad'],
    ['paid_in', 'Paid in', 'ok'],
    ['paid', 'Paid', 'ok'],
    ['no_payment', 'No payment', 'n'],
  ];
  it.each(cases)('tag %s shows "%s" in the %s tone', (code, label, tone) => {
    render(<PaymentView order={{ ...DETAIL, paymentTag: { code, label } }} />);
    const tag = screen.getByText(label);
    expect(tag).toHaveClass('tag', tone);
  });

  it('shows method, amount and "Cash held by" from the server', () => {
    render(<PaymentView order={{ ...DETAIL, payment: { ...DETAIL.payment, cashHeldBy: 'Kofi Appiah' } }} />);
    expect(screen.getByText('Cash on delivery')).toBeInTheDocument();
    expect(screen.getByText('GH₵249')).toBeInTheDocument();
    expect(screen.getByText('Cash held by')).toBeInTheDocument();
    expect(screen.getByText('Kofi Appiah')).toBeInTheDocument();
  });

  it('leaves the "Cash held by" line out when the server did not send it (no financial:view)', () => {
    const { cashHeldBy: _c, ...payment } = DETAIL.payment;
    render(<PaymentView order={{ ...DETAIL, payment }} />);
    expect(screen.queryByText('Cash held by')).toBeNull();
  });

  it('a deposit order shows "Deposit GH₵X paid. GH₵Y due on delivery"', () => {
    render(<PaymentView order={{ ...DETAIL, payment: { ...DETAIL.payment, method: 'paystack_deposit', deposit: { paid: '100.00', due: '149.00' } } }} />);
    expect(screen.getByText('Deposit GH₵100 paid. GH₵149 due on delivery')).toBeInTheDocument();
  });
});

describe('customer block (F-321)', () => {
  it('Call uses tel:, WhatsApp uses https://wa.me/<number> with no plus, and the phone shows in local format', () => {
    render(<CustomerView order={DETAIL} />);
    expect(screen.getByText('024 555 0182')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+233245550182');
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550182');
  });
});

describe('timeline (F-322)', () => {
  it('shows who did each move, the Override tag with its reason, duration chips and the future re-delivery row', () => {
    render(<Timeline entries={TIMELINE} sourceLabel="Checkout form: Magic Groove copybook set" />);
    expect(screen.getByText('Confirmed by Adwoa Darko')).toBeInTheDocument();
    expect(screen.getByText('Confirmed after 12 min')).toBeInTheDocument();
    expect(screen.getByText('Delivered after 4.1 days')).toBeInTheDocument();
    expect(screen.getByText('Delivered by AI agent')).toBeInTheDocument();
    expect(screen.getByText('Override')).toBeInTheDocument();
    expect(screen.getByText('Reason: Customer paid at the office')).toBeInTheDocument();
    expect(screen.getByText('Failed delivery by System')).toBeInTheDocument();
    expect(screen.getByText('Edited by Adwoa: address, total')).toBeInTheDocument();
    expect(screen.getByText('Re-delivery planned').closest('li')).toHaveClass('future');
    // times are Accra time
    expect(screen.getByText(/Checkout form: Magic Groove copybook set, 17 Oct, 14:02/)).toBeInTheDocument();
  });
});
