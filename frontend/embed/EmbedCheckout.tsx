import React, { useEffect, useState } from 'react';
import { CheckoutForm, CheckoutFormData } from '../src/components/public/CheckoutForm';
import { OrderSuccess } from '../src/components/public/OrderSuccess';
import { FormNotAvailable } from '../src/components/public/FormNotAvailable';
import type { PublicCheckoutForm } from '../src/services/public-orders.service';
import { fetchFormConfig, submitOrder, trackInitiateCheckout, FormLoadError, EmbedFormConfig } from './embedApi';
import { placeOrder } from '../src/lib/orderPayload';
import { fireInitiateCheckoutWithCapi } from '../src/utils/pixelTracking';
import type { PixelConfig } from '../src/types/checkout-form';

interface EmbedCheckoutProps {
  apiBase: string;
  slug: string;
  lockedPackageId: number | null;
}

export const EmbedCheckout: React.FC<EmbedCheckoutProps> = ({ apiBase, slug, lockedPackageId }) => {
  const [form, setForm] = useState<EmbedFormConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorSupport, setErrorSupport] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ orderId?: number; orderNumber?: string; total: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetchFormConfig(apiBase, slug)
      .then((cfg) => active && setForm(cfg))
      .catch((e) => {
        if (!active) return;
        setError(e.message || 'Failed to load checkout');
        if (e instanceof FormLoadError) setErrorSupport(e.supportWhatsapp);
      });
    return () => {
      active = false;
    };
  }, [apiBase, slug]);

  // Fire InitiateCheckout once the form config loads. The widget mounts inline in
  // the host page, so the client beacon and _fbp/_fbc cookies belong to the
  // merchant's domain. Uses the same shared helper as the hosted checkout: browser
  // beacon + CAPI twin sharing one eventId so Meta dedupes them. Without this the
  // embed sent no InitiateCheckout at all (only server-side Purchase reached Meta).
  useEffect(() => {
    const pixelConfig = form?.pixelConfig as PixelConfig | undefined;
    if (!pixelConfig) return;
    fireInitiateCheckoutWithCapi(pixelConfig, (data) => trackInitiateCheckout(apiBase, slug, data));
  }, [form?.pixelConfig, apiBase, slug]);

  // A failure throws: CheckoutForm clears its submitting state and shows the message above the button.
  const handleSubmit = async (data: CheckoutFormData) => {
    if (!form) return;
    const result = await placeOrder(form, data, (payload) => submitOrder(apiBase, slug, payload));
    if (result.kind === 'redirect') {
      window.location.href = result.url;
    } else {
      // A repeat submit is a placed order too: thank-you, no redirect to the merchant's purchase page.
      setSuccess({ orderId: result.orderId, orderNumber: result.orderNumber, total: result.total });
    }
  };

  if (error && !form) {
    return <FormNotAvailable embedded supportWhatsapp={errorSupport} message={error} />;
  }
  if (success) {
    // No pixelConfig here: the host page fires its own events and the server sends the Purchase.
    return (
      <OrderSuccess
        embedded
        orderId={success.orderId}
        orderNumber={success.orderNumber}
        design={form?.design}
        supportWhatsapp={form?.supportWhatsapp}
        digital={form?.formType === 'digital'}
      />
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
