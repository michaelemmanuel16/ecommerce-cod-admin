import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckoutForm, CheckoutFormData } from '../components/public/CheckoutForm';
import { OrderSuccess } from '../components/public/OrderSuccess';
import { FormNotAvailable } from '../components/public/FormNotAvailable';
import { publicOrdersService, PublicCheckoutForm } from '../services/public-orders.service';
import { placeOrder } from '../lib/orderPayload';
import { initPixels, fireInitiateCheckoutWithCapi } from '../utils/pixelTracking';
import { PixelConfig } from '../types/checkout-form';
import { useConfigStore } from '../stores/configStore';

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

interface Cooldown { orderId: number; orderNumber?: string; total: number }

function getCooldown(slug: string): Cooldown | null {
  try {
    const raw = localStorage.getItem(`checkout_cooldown_${slug}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp < COOLDOWN_MS) {
      return { orderId: data.orderId, orderNumber: data.orderNumber, total: data.total };
    }
    localStorage.removeItem(`checkout_cooldown_${slug}`);
  } catch { /* ignore corrupt data */ }
  return null;
}

function setCooldown(slug: string, entry: Cooldown) {
  try {
    localStorage.setItem(`checkout_cooldown_${slug}`, JSON.stringify({ ...entry, timestamp: Date.now() }));
  } catch { /* storage blocked: the order is still placed */ }
}

/** An order the buyer just placed (or placed a moment ago): what the success screen shows. */
interface Placed {
  orderId?: number;
  orderNumber?: string;
  total: number;
  /** No new order and no Purchase event: a repeat submit, or a reload inside the cooldown. */
  repeat: boolean;
}

/** Why the form is not shown. `support` is the store's public WhatsApp number from the 404 body. */
interface LoadError {
  notFound: boolean;
  support: string | null;
  message?: string;
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
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  // the public config route needs this form's slug to find the tenant
  useEffect(() => {
    if (slug) useConfigStore.getState().fetchConfig(slug);
  }, [slug]);

  useEffect(() => {
    if (!slug) {
      setLoadError({ notFound: false, support: null, message: 'Invalid form URL' });
      setLoading(false);
      return;
    }

    // A reload inside the cooldown shows the same order again. The form still loads (its colours, currency and support
    // number); the order is not posted again and no tracking fires.
    const cooldown = getCooldown(slug);
    if (cooldown) setPlaced({ ...cooldown, repeat: true });

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
  }, [loading, loadError, placed]);

  // Fire pixel PageView + InitiateCheckout when form data is available. The
  // InitiateCheckout server-side CAPI mirror is shared with the embed widget.
  useEffect(() => {
    if (!formData?.pixelConfig || !slug || placed) return;
    const pixelConfig = formData.pixelConfig as PixelConfig;
    initPixels(pixelConfig);
    fireInitiateCheckoutWithCapi(pixelConfig, (data) =>
      publicOrdersService.trackInitiateCheckout(slug, data),
    );
  }, [formData?.pixelConfig, slug, placed]);

  const loadForm = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setFormData(await publicOrdersService.getPublicForm(slug!));
    } catch (err: any) {
      console.error('Failed to load checkout form:', err);
      const notFound = err.response?.status === 404;
      setLoadError(notFound
        ? { notFound, support: err.response?.data?.supportWhatsapp ?? null }
        : { notFound, support: null, message: 'We could not load this form. Please reload the page.' });
    } finally {
      setLoading(false);
    }
  };

  // Every failure throws, so CheckoutForm shows the message above the button and lets the buyer try again.
  const handleSubmit = async (data: CheckoutFormData) => {
    if (!formData || !slug) return;

    try {
      const result = await placeOrder(formData, data, (payload) => publicOrdersService.submitOrder(slug, payload as any));
      if (result.kind === 'redirect') {
        if (result.order) setCooldown(slug, result.order);
        window.location.href = result.url;
      } else if (result.kind === 'placed') {
        setCooldown(slug, { orderId: result.orderId, orderNumber: result.orderNumber, total: result.total });
        setPlaced({ orderId: result.orderId, orderNumber: result.orderNumber, total: result.total, repeat: false });
      } else {
        setPlaced({ orderId: result.orderId, orderNumber: result.orderNumber, total: result.total, repeat: true });
      }
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
  if (loadError || !formData) {
    return <FormNotAvailable supportWhatsapp={loadError?.support} message={loadError?.message} />;
  }

  // Success state
  if (placed) {
    return (
      <OrderSuccess
        orderId={placed.orderId}
        orderNumber={placed.orderNumber}
        repeatOrder={placed.repeat}
        orderTotal={placed.total}
        currency={formData.currency}
        pixelConfig={formData.pixelConfig as PixelConfig | undefined}
        digital={formData.formType === 'digital' || formData.product?.productType === 'digital'}
        supportWhatsapp={formData.supportWhatsapp}
        design={formData.design}
      />
    );
  }

  // Checkout form state
  return <CheckoutForm formData={formData} onSubmit={handleSubmit} lockedPackageId={lockedPackageId} />;
};
