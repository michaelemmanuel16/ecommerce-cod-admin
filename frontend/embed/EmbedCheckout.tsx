import React, { useEffect, useState } from 'react';
import { CheckoutForm, CheckoutFormData } from '../src/components/public/CheckoutForm';
import type { PublicCheckoutForm } from '../src/services/public-orders.service';
import { fetchFormConfig, buildOrderPayload, submitOrder, EmbedFormConfig } from './embedApi';
import { buildRedirectUrl } from '../src/lib/orderPayload';

interface EmbedCheckoutProps {
  apiBase: string;
  slug: string;
  lockedPackageId: number | null;
}

export const EmbedCheckout: React.FC<EmbedCheckoutProps> = ({ apiBase, slug, lockedPackageId }) => {
  const [form, setForm] = useState<EmbedFormConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ orderId: number; total: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetchFormConfig(apiBase, slug)
      .then((cfg) => active && setForm(cfg))
      .catch((e) => active && setError(e.message || 'Failed to load checkout'));
    return () => {
      active = false;
    };
  }, [apiBase, slug]);

  const handleSubmit = async (data: CheckoutFormData) => {
    if (!form) return;
    try {
      const { payload, totalAmount } = buildOrderPayload(form, data);
      const res = await submitOrder(apiBase, slug, payload);

      // Paystack methods: hand off to Paystack (order created after payment).
      if (res.authorization_url) {
        window.location.href = res.authorization_url;
        return;
      }
      // COD: the order was created immediately and carries an orderId.
      if (res.orderId == null) {
        setError('Order could not be completed. Please try again.');
        return;
      }
      // Custom thank-you page wins over the built-in success panel.
      const redirect = buildRedirectUrl(form.redirectUrl, {
        orderId: res.orderId,
        total: totalAmount,
        currency: form.currency,
        reference: res.paymentReference,
        package: data.selectedPackageId,
      });
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      setSuccess({ orderId: res.orderId, total: totalAmount });
    } catch (e: any) {
      // Re-throw so CheckoutForm clears its submitting state; surface inline too.
      setError(e.message || 'Failed to place order');
      throw e;
    }
  };

  if (error && !form) {
    return <div className="p-6 text-center text-red-600">{error}</div>;
  }
  if (success) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Order placed!</h2>
        <p className="text-gray-600">
          Your order #{success.orderId} has been received. We'll be in touch shortly.
        </p>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="p-8 text-center text-gray-600">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-gray-800 mb-3" />
        <p>Loading checkout…</p>
      </div>
    );
  }

  return (
    <CheckoutForm
      formData={form as PublicCheckoutForm}
      onSubmit={handleSubmit}
      lockedPackageId={lockedPackageId}
      embedded
    />
  );
};
