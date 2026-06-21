import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckoutForm, CheckoutFormData } from '../components/public/CheckoutForm';
import { OrderSuccess } from '../components/public/OrderSuccess';
import { publicOrdersService, PublicCheckoutForm } from '../services/public-orders.service';
import { buildOrderPayload, buildRedirectUrl } from '../lib/orderPayload';
import { initPixels, trackInitiateCheckout } from '../utils/pixelTracking';
import { PixelConfig } from '../types/checkout-form';
import toast from 'react-hot-toast';

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
  localStorage.setItem(`checkout_cooldown_${slug}`, JSON.stringify({ orderId, total, timestamp: Date.now() }));
}

export const PublicCheckout: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `?package=<id>` deep-links the checkout to a single package (numeric ids only).
  const lockedPackageParam = searchParams.get('package');
  const lockedPackageId = lockedPackageParam && /^\d+$/.test(lockedPackageParam)
    ? Number(lockedPackageParam)
    : null;
  const [formData, setFormData] = useState<PublicCheckoutForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [submittedTotal, setSubmittedTotal] = useState<number>(0);

  useEffect(() => {
    if (!slug) {
      setError('Invalid form URL');
      setLoading(false);
      return;
    }

    // Check localStorage cooldown before loading form
    const cooldown = getCooldown(slug);
    if (cooldown) {
      setOrderId(cooldown.orderId);
      setSubmittedTotal(cooldown.total);
      setLoading(false);
      return;
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

  // Fire pixel PageView events when form data is available
  useEffect(() => {
    if (formData?.pixelConfig) {
      initPixels(formData.pixelConfig as PixelConfig);
      trackInitiateCheckout(formData.pixelConfig as PixelConfig);
    }
  }, [formData?.pixelConfig]);

  const loadForm = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await publicOrdersService.getPublicForm(slug!);
      setFormData(data);
    } catch (err: any) {
      console.error('Failed to load checkout form:', err);
      setError(err.response?.data?.message || 'Form not found or no longer available');
      toast.error('Failed to load checkout form');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (data: CheckoutFormData) => {
    if (!formData || !slug) return;

    try {
      // Guard before building so we can show the package-specific toast.
      if (!formData.packages.some((p) => p.id === data.selectedPackageId)) {
        toast.error('Please select a package');
        return;
      }

      // Shared mapping — identical to what the embed widget posts.
      const { payload, totalAmount } = buildOrderPayload(formData, data);

      const response = await publicOrdersService.submitOrder(slug, payload as any);

      if (response.success) {
        // Paystack methods (digital, deposit, full): redirect to Paystack. The
        // order isn't created until payment is confirmed, so there's no orderId here.
        if (response.authorization_url) {
          window.location.href = response.authorization_url;
          return;
        }

        // COD: order was created immediately and carries an orderId.
        if (!response.orderId) {
          toast.error('Order could not be completed. Please try again.');
          return;
        }

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
        toast.success('Order placed successfully!');
      } else {
        toast.error(response.message || 'Failed to place order');
      }
    } catch (err: any) {
      console.error('Order submission error:', err);
      toast.error(err.response?.data?.message || 'Failed to place order. Please try again.');
      throw err; // Re-throw so CheckoutForm resets isSubmitting
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

  // Error state
  if (error || !formData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Form Not Found</h1>
          <p className="text-gray-600 mb-6">
            {error || 'The checkout form you are looking for is not available.'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-[#0f172a] text-white rounded-lg hover:bg-[#1e293b] transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (orderId) {
    return (
      <OrderSuccess
        orderId={orderId}
        orderTotal={submittedTotal}
        currency={formData?.currency}
        pixelConfig={formData?.pixelConfig as PixelConfig | undefined}
      />
    );
  }

  // Checkout form state
  return <CheckoutForm formData={formData} onSubmit={handleSubmit} lockedPackageId={lockedPackageId} />;
};
