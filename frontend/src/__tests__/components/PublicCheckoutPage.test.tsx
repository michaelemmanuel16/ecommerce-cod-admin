// COD-36 (M3b-T16, F-420): the public checkout page, section by section.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckoutForm } from '../../components/public/CheckoutForm';
import type { PublicCheckoutForm } from '../../services/public-orders.service';

const form = (over: Partial<PublicCheckoutForm> = {}): PublicCheckoutForm =>
  ({
    id: 1, name: 'Magic Groove', slug: 'mg', productId: 1, description: 'Handwriting copybooks',
    fields: [
      { id: 'a', label: 'Full name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
      { id: 'b', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
    ],
    product: { name: 'Copybook', price: 200, productType: 'physical' } as never,
    packages: [
      { id: 11, name: 'Starter', price: 200, quantity: 1, isPopular: false, isDefault: true, originalPrice: 200, discountType: 'none' },
      { id: 12, name: 'Family', price: 540, quantity: 3, isPopular: true, isDefault: false, originalPrice: 600, discountType: 'percentage', discountValue: 10, showDiscount: true },
    ],
    upsells: [{ id: 21, name: 'Refill pens', price: 40.5, items: { quantity: 1 }, isPopular: true }],
    country: 'Ghana', currency: 'GHS', regions: { available: ['Greater Accra', 'Ashanti'] }, formType: 'physical', design: {},
    ...over,
  }) as PublicCheckoutForm;

const fillAndSubmit = async (button = /Place Order/i) => {
  await userEvent.type(screen.getByPlaceholderText('Enter full name'), 'Ama Mensah');
  await userEvent.type(screen.getByPlaceholderText('Enter phone'), '0241234567');
  await userEvent.click(screen.getByRole('button', { name: button }));
};

describe('public checkout page sections (F-420)', () => {
  it('shows the header, packages, add-ons, your information, summary and one button, in that order', () => {
    render(<CheckoutForm formData={form({ design: { page: { offerPosition: 'top' } } })} onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Copybook' })).toBeInTheDocument();
    const order = ['section-packages', 'section-addons', 'section-information'].map((id) => screen.getByTestId(id));
    order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Your information' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Order summary' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Place Order/i })).toHaveLength(1);
  });

  it('offer position bottom puts "Your information" before the packages', () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('section-information').compareDocumentPosition(screen.getByTestId('section-packages')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the product header and the order summary when the owner switches them off', () => {
    render(<CheckoutForm formData={form({ design: { page: { hideProductDisplay: true, showOrderSummary: false } } })} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('section-header')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Order summary' })).toBeNull();
    expect(screen.getByRole('button', { name: /Place Order/i })).toBeInTheDocument();
  });

  it('package selector: Most popular badge, original price, discount and highlight text', () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    const family = screen.getByRole('button', { name: /Family/ });
    expect(within(family).getByText('Most popular')).toBeInTheDocument();
    expect(within(family).getByText('GH₵600')).toBeInTheDocument();
    expect(within(family).getByText('Save 10%')).toBeInTheDocument();
  });

  it('shows a highlight text instead of Most popular when the owner set one', () => {
    const f = form();
    f.packages[1] = { ...f.packages[1], showHighlight: true, highlightText: 'Best value' };
    render(<CheckoutForm formData={f} onSubmit={vi.fn()} />);
    const family = screen.getByRole('button', { name: /Family/ });
    expect(within(family).getByText('Best value')).toBeInTheDocument();
    expect(within(family).queryByText('Most popular')).toBeNull();
  });

  it('add-ons: Popular badge and a price that keeps its pesewas', () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    const addons = screen.getByTestId('section-addons');
    expect(within(addons).getByText('Popular')).toBeInTheDocument();
    expect(within(addons).getByText('GH₵40.50')).toBeInTheDocument();
  });

  it('the total follows the chosen package and add-ons', async () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('order-total')).toHaveTextContent('GH₵200');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Add Refill pens' }));
    expect(screen.getByTestId('order-total')).toHaveTextContent('GH₵240.50');
  });
});

describe('money (F-420)', () => {
  it('prints the store currency symbol, not the code: Ghana shows GH₵200', () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    expect(screen.getAllByText('GH₵200').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/GHS/);
  });

  it('Nigeria shows ₦', () => {
    render(<CheckoutForm formData={form({ currency: 'NGN' })} onSubmit={vi.fn()} />);
    expect(screen.getAllByText('₦200').length).toBeGreaterThan(0);
  });

  it('payment buttons carry the symbol too', () => {
    render(<CheckoutForm formData={form({ codEnabled: true, paystackDepositEnabled: true, paystackFullEnabled: true, depositPercent: 30 })} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pay Deposit — GH₵60' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay in Full — GH₵200' })).toBeInTheDocument();
  });
});

describe('refund note and terms (F-420)', () => {
  it('the refund note shows only with an online method, and never names a provider', () => {
    const { unmount } = render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/refund policy/i)).toBeNull();
    unmount();
    render(<CheckoutForm formData={form({ paystackFullEnabled: true })} onSubmit={vi.fn()} />);
    expect(screen.getByText(/refundable in line with our refund policy/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/paystack/i);
  });

  it('terms open in the page, with no link that leaves it', async () => {
    const { container } = render(<CheckoutForm formData={form({ supportWhatsapp: '+233 24 555 0103' })} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/We call you to confirm/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /terms/i }));
    expect(screen.getByText(/We call you to confirm your order before we send it/)).toBeInTheDocument();
    expect(screen.getByText(/you pay when your order arrives/)).toBeInTheDocument();
    expect(container.querySelector('[target="_blank"]')).toBeNull();
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550103');
  });
});

describe('the button (F-420)', () => {
  it('after the first tap it disables and says "Placing your order."; a second tap does nothing', async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<CheckoutForm formData={form()} onSubmit={onSubmit} />);
    await fillAndSubmit();
    const busy = await screen.findByRole('button', { name: 'Placing your order.' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish();
  });

  it('puts the server answer for a sold-out product above the button, in plain words, and lets the buyer try again', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('This product is sold out')).mockResolvedValue(undefined);
    render(<CheckoutForm formData={form()} onSubmit={onSubmit} />);
    await fillAndSubmit();
    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('This product is sold out');
    const button = screen.getByRole('button', { name: /Place Order/i });
    expect(button).not.toBeDisabled();
    expect(message.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    await userEvent.click(button);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    alertSpy.mockRestore();
  });

  it('the Go key on the phone keyboard places the order (the first button is the form submit button)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CheckoutForm formData={form()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByPlaceholderText('Enter full name'), 'Ama Mensah');
    await userEvent.type(screen.getByPlaceholderText('Enter phone'), '0241234567{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe('the field labels (owner decision 2026-10-23)', () => {
  const fields = (label: string) => [
    { id: 'a', label: 'Full name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
    { id: 'r', label, type: 'state', required: true, enabled: true, standardKey: 'region' },
  ];

  it('shows exactly the label the owner typed: County stays County', () => {
    render(<CheckoutForm formData={form({ fields: fields('County') as never })} onSubmit={vi.fn()} />);
    expect(screen.getByText('County', { selector: 'label' })).toBeInTheDocument();
    expect(screen.queryByText('State', { selector: 'label' })).toBeNull();
  });

  it('a stored label after the migration shows State', () => {
    render(<CheckoutForm formData={form({ fields: fields('State') as never })} onSubmit={vi.fn()} />);
    expect(screen.getByText('State', { selector: 'label' })).toBeInTheDocument();
  });
});

describe('digital form (F-422)', () => {
  const stored = [
    { id: 'a', label: 'Full name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
    { id: 'b', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
    { id: 'r', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' },
    { id: 't', label: 'City or town', type: 'text', required: true, enabled: true, standardKey: 'town' },
    { id: 'l', label: 'Nearest landmark', type: 'text', required: true, enabled: true, standardKey: 'landmark' },
    { id: 's', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
    { id: 'e', label: 'Email Address', type: 'email', required: false, enabled: false, standardKey: 'email' },
  ];
  const digital = () => form({ formType: 'digital', product: { name: 'Guide', price: 100, productType: 'digital' } as never, fields: stored as never });

  it('asks no address, state, town or landmark; the email is on and required; one online button', () => {
    render(<CheckoutForm formData={digital()} onSubmit={vi.fn()} />);
    ['State', 'City or town', 'Nearest landmark', 'Street address'].forEach((l) => expect(screen.queryByText(l, { selector: 'label' })).toBeNull());
    const email = screen.getByText(/Email Address/, { selector: 'label' });
    expect(email.querySelector('.text-red-500')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /Proceed to Payment/i })).toHaveLength(1);
    expect(screen.queryByText(/Cash on Delivery/i)).toBeNull();
  });

  it('a digital form with no saved fields still asks name, phone and email only', () => {
    render(<CheckoutForm formData={form({ ...digital(), fields: [] })} onSubmit={vi.fn()} />);
    expect(screen.getByText(/Email Address/, { selector: 'label' })).toBeInTheDocument();
    expect(screen.queryByText('State', { selector: 'label' })).toBeNull();
  });

  it('the terms talk about the download link, not delivery', async () => {
    render(<CheckoutForm formData={digital()} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /terms/i }));
    expect(screen.getByText(/download link is sent to the email/)).toBeInTheDocument();
    expect(screen.queryByText(/pay when your order arrives/)).toBeNull();
  });
});

describe('locked package (?package=)', () => {
  it('shows only that package', () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} lockedPackageId={12} />);
    expect(screen.getByRole('button', { name: /Family/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Starter/ })).toBeNull();
    expect(screen.getByTestId('order-total')).toHaveTextContent('GH₵540');
  });
});
