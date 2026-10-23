import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckoutForm, CheckoutFormData } from '../components/public/CheckoutForm';
import { OrderSuccess } from '../components/public/OrderSuccess';
import { FormNotAvailable } from '../components/public/FormNotAvailable';
import { publicOrdersService, PublicCheckoutForm } from '../services/public-orders.service';
import { buildOrderPayload, buildRedirectUrl } from '../lib/orderPayload';
import { initPixels, fireInitiateCheckoutWithCapi, getFbCookies } from '../utils/pixelTracking';
import { rememberLastForm, rememberPayment } from '../lib/lastForm';
import { PixelConfig } from '../types/checkout-form';
import { useConfigStore } from '../stores/configStore';

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function getCooldown(slug: string): { orderId: number; total: number } | null {
  try {
    const raw = localStorage.getItem(`checkout_cooldown_${slug}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp < COOLDOWN_MS) {
      return { orderId: data.orderId, total: data.total };
    }
    localStorage.removeItem(`checkout_cooldown_${slug}`);
  } catch { /* ignore corrupt data */ }
  return null;
}

function setCooldown(slug: string, orderId: number, total: number) {
  try {
    localStorage.setItem(`checkout_cooldown_${slug}`, JSON.stringify({ orderId, total, timestamp: Date.now() }));
  } catch { /* storage blocked: the order is still placed */ }
}

export const PublicCheckout: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  // `?package=<id>` deep-links the checkout to a single package (numeric ids only).
  const lockedPackageParam = searchParams.get('package');
  const lockedPackageId = lockedPackageParam && /^\d+$/.test(lockedPackageParam)
    ? Number(lockedPackageParam)
    : null;
  const [formData, setFormData] = useState<PublicCheckoutForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The store's support number from the 404 body of a form that is switched off.
  const [errorSupport, setErrorSupport] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  // Reload inside the 10-minute cooldown: the success screen is back, but no tracking fires again.
  const cooldownHit = useRef(false);
  // A repeat of an order already placed: thank-you screen, no order number (the server sends none to a new address), no Purchase event.
  const [repeatOrder, setRepeatOrder] = useState(false);
  const [submittedTotal, setSubmittedTotal] = useState<number>(0);

  // the public config route needs this form's slug to find the tenant
  useEffect(() => {
    if (slug) useConfigStore.getState().fetchConfig(slug);
  }, [slug]);

  useEffect(() => {
    if (!slug) {
      setError('Invalid form URL');
      setLoading(false);
      return;
    }

    // Check localStorage cooldown before loading form
    const cooldown = getCooldown(slug);
    if (cooldown) {
      // The form still loads (its colours, currency and support number); the order is not posted again.
      cooldownHit.current = true;
      setOrderId(cooldown.orderId);
      setRepeatOrder(true); // the Purchase event fired when the order was placed
      setSubmittedTotal(cooldown.total);
    }

    loadForm();
  }, [slug]);

  // Auto-resize support for iframe embedding (postMessage to parent)
  useEffect(() => {
    // Detect if running in iframe
    if (window.self !== window.top) {
      const sendHeight = () => {
        const height = document.body.scrollHeight;
        window.parent.postMessage(
          {
            type: 'checkout-resize',
            height: height,
          },
          '*'
        );
      };

      // Send initial height
      sendHeight();

      // Send height on window resize
      window.addEventListener('resize', sendHeight);

      // Send height when content changes (after form loads or state updates)
      const observer = new MutationObserver(sendHeight);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      return () => {
        window.removeEventListener('resize', sendHeight);
        observer.disconnect();
      };
    }
  }, [loading, error, orderId]);

  // Fire pixel PageView + InitiateCheckout when form data is available. The
  // InitiateCheckout server-side CAPI mirror is shared with the embed widget.
  useEffect(() => {
    if (!formData?.pixelConfig || !slug || cooldownHit.current) return;
    const pixelConfig = formData.pixelConfig as PixelConfig;
    initPixels(pixelConfig);
    fireInitiateCheckoutWithCapi(pixelConfig, (data) =>
      publicOrdersService.trackInitiateCheckout(slug, data),
    );
  }, [formData?.pixelConfig, slug]);

  const loadForm = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await publicOrdersService.getPublicForm(slug!);
      setFormData(data);
    } catch (err: any) {
      console.error('Failed to load checkout form:', err);
      const missing = err.response?.status === 404;
      setNotFound(missing);
      setErrorSupport(missing ? err.response?.data?.supportWhatsapp ?? null : null);
      setError(missing ? 'This form is not available.' : 'We could not load this form. Please reload the page.');
    } finally {
      setLoading(false);
    }
  };

  // Every failure throws, so CheckoutForm shows the message above the button and lets the buyer try again.
  const handleSubmit = async (data: CheckoutFormData) => {
    if (!formData || !slug) return;

    try {
      if (!formData.packages.some((p) => p.id === data.selectedPackageId)) {
        throw new Error('Please choose a package.');
      }

      // Shared mapping — identical to what the embed widget posts.
      const { payload, totalAmount } = buildOrderPayload(formData, data);

      // Attach Meta click ids so the Purchase CAPI event can match this buyer.
      const response = await publicOrdersService.submitOrder(slug, { ...payload, ...getFbCookies() } as any);

      if (!response.success) throw new Error(response.message || 'We could not place your order. Please try again.');

      // Online payment: redirect to the provider. The order isn't created until payment is confirmed,
      // so there's no orderId here.
      if (response.authorization_url) {
        rememberLastForm(slug);
        if (response.paymentReference) {
          rememberPayment(response.paymentReference, { slug, total: totalAmount, currency: formData.currency, package: data.selectedPackageId });
        }
        window.location.href = response.authorization_url;
        return;
      }

      // A repeat submit is a placed order, not a failure; the original order already fired its Purchase.
      if (response.deduplicated) {
        setSubmittedTotal(totalAmount);
        setOrderId(response.orderId ?? null);
        setOrderNumber(response.orderNumber ?? null);
        setRepeatOrder(true);
        return;
      }

      // COD: order was created immediately and carries an orderId.
      if (!response.orderId) throw new Error('We could not complete your order. Please try again.');

      setCooldown(slug, response.orderId, totalAmount);

      // Custom thank-you page: redirect with order details appended so the
      // merchant's page can show the order and fire its own purchase pixel.
      const redirect = buildRedirectUrl(formData.redirectUrl, {
        orderId: response.orderId,
        total: totalAmount,
        currency: formData.currency,
        reference: response.paymentReference,
        package: data.selectedPackageId,
      });
      if (redirect) {
        window.location.href = redirect;
        return;
      }

      setSubmittedTotal(totalAmount);
      setOrderId(response.orderId);
      setOrderNumber(response.orderNumber ?? null);
    } catch (err: any) {
      console.error('Order submission error:', err);
      const body = err.response?.data;
      throw new Error(body?.message || body?.error || err.message || 'We could not place your order. Please try again.');
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#0f172a] mb-4"></div>
          <p className="text-gray-600">Loading checkout form...</p>
        </div>
      </div>
    );
  }

  // Not available: the form is missing, switched off or archived (or did not load). No link to the admin app.
  if (error || !formData) {
    return <FormNotAvailable supportWhatsapp={errorSupport} message={notFound ? undefined : error ?? undefined} />;
  }

  // Success state
  if (orderId || repeatOrder) {
    return (
      <OrderSuccess
        orderId={orderId ?? undefined}
        orderNumber={orderNumber ?? undefined}
        repeatOrder={repeatOrder}
        orderTotal={submittedTotal}
        currency={formData?.currency}
        pixelConfig={formData?.pixelConfig as PixelConfig | undefined}
        digital={formData.formType === 'digital' || formData.product?.productType === 'digital'}
        supportWhatsapp={formData.supportWhatsapp}
        design={formData.design}
      />
    );
  }

  // Checkout form state
  return <CheckoutForm formData={formData} onSubmit={handleSubmit} lockedPackageId={lockedPackageId} />;
};
