// COD-36 (M3b-T17, F-421, F-422): the order success and "not available" screens, also inside an iframe-like container.
import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { OrderSuccess } from '../../components/public/OrderSuccess';
import { FormNotAvailable } from '../../components/public/FormNotAvailable';

/** Renders the children into the document of a real iframe, as a host page shows the form. */
const InFrame = ({ children }: { children: React.ReactNode }) => {
  const [doc, setDoc] = useState<Document | null>(null);
  return (
    <iframe
      title="host"
      ref={(el) => { if (el?.contentDocument && !doc) setDoc(el.contentDocument); }}
    >
      {doc ? createPortal(children, doc.body) : null}
    </iframe>
  );
};

describe('OrderSuccess (F-421)', () => {
  it('physical COD: "Order placed", the number from the server, the three next steps and no phone number line', () => {
    render(<OrderSuccess orderId={24118} orderNumber="#24118" orderTotal={200} currency="GHS" />);
    expect(screen.getByRole('heading', { name: 'Order placed' })).toBeInTheDocument();
    expect(screen.getByTestId('order-number')).toHaveTextContent('#24118');
    expect(screen.getByText('What happens next')).toBeInTheDocument();
    expect(screen.getByText('We call you to confirm your order.')).toBeInTheDocument();
    expect(screen.getByText('We deliver to you.')).toBeInTheDocument();
    expect(screen.getByText('You pay when it arrives.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('falls back to #<orderId> when the server sent no printed number', () => {
    render(<OrderSuccess orderId={77} />);
    expect(screen.getByTestId('order-number')).toHaveTextContent('#77');
  });

  it('the support WhatsApp link opens in the same tab and only shows when the store has a number', () => {
    const { rerender } = render(<OrderSuccess orderId={1} supportWhatsapp="+233 24 555 0103" />);
    const link = screen.getByRole('link', { name: /WhatsApp/ });
    expect(link).toHaveAttribute('href', 'https://wa.me/233245550103');
    expect(link).not.toHaveAttribute('target');
    rerender(<OrderSuccess orderId={1} supportWhatsapp={null} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('digital: says where the download link went instead of the delivery steps', () => {
    render(<OrderSuccess orderId={5} digital />);
    expect(screen.getByText('We sent the download link to your email.')).toBeInTheDocument();
    expect(screen.queryByText('We deliver to you.')).toBeNull();
    expect(screen.queryByText('You pay when it arrives.')).toBeNull();
  });

  it('a repeat order with no number still shows the screen, without a number', () => {
    render(<OrderSuccess repeatOrder />);
    expect(screen.getByRole('heading', { name: 'Order placed' })).toBeInTheDocument();
    expect(screen.queryByTestId('order-number')).toBeNull();
  });

  it('uses the form primary colour and background', () => {
    render(<OrderSuccess orderId={9} design={{ colors: { primary: '#2563eb' }, page: { background: '#eef2ff' } }} />);
    expect(screen.getByTestId('order-number')).toHaveStyle({ color: 'rgb(37, 99, 235)' });
    expect(screen.getByTestId('public-form-root')).toHaveStyle({ backgroundColor: 'rgb(238, 242, 255)' });
  });

  it('works inside an iframe', async () => {
    render(<InFrame><OrderSuccess orderId={24118} orderNumber="#24118" supportWhatsapp="+233245550103" embedded /></InFrame>);
    const frame = screen.getByTitle('host') as HTMLIFrameElement;
    await screen.findByTitle('host');
    await new Promise((r) => setTimeout(r, 0));
    const doc = frame.contentDocument!;
    expect(doc.body.textContent).toContain('Order placed');
    expect(doc.body.textContent).toContain('#24118');
    expect(doc.querySelector('a[href="https://wa.me/233245550103"]')).not.toBeNull();
    expect(doc.querySelector('[target="_blank"]')).toBeNull();
  });
});

describe('FormNotAvailable (F-421)', () => {
  it('says "This form is not available." with no Go Home button', () => {
    render(<FormNotAvailable />);
    expect(screen.getByRole('heading', { name: 'This form is not available.' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/go home/i)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('adds the support contact when the store has one', () => {
    render(<FormNotAvailable supportWhatsapp="+233245550103" />);
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550103');
  });

  it('the embed can say the host is not allowed', () => {
    render(<FormNotAvailable embedded message="This form cannot be shown here." />);
    expect(screen.getByRole('heading', { name: 'This form cannot be shown here.' })).toBeInTheDocument();
  });

  it('works inside an iframe', async () => {
    render(<InFrame><FormNotAvailable supportWhatsapp="+233245550103" embedded /></InFrame>);
    await new Promise((r) => setTimeout(r, 0));
    const doc = (screen.getByTitle('host') as HTMLIFrameElement).contentDocument!;
    expect(doc.body.textContent).toContain('This form is not available.');
    expect(doc.querySelector('a[href="https://wa.me/233245550103"]')).not.toBeNull();
  });
});
