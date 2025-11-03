import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckoutForm, CheckoutFormData } from '../components/public/CheckoutForm';
import { OrderSuccess } from '../components/public/OrderSuccess';
import { publicOrdersService, PublicCheckoutForm, PublicOrderData } from '../services/public-orders.service';
import toast from 'react-hot-toast';

export const PublicCheckout: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [formData, setFormData] = useState<PublicCheckoutForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) {
      setError('Invalid form URL');
      setLoading(false);
      return;
    }

    loadForm();
  }, [slug]);

  // Auto-resize support for iframe embedding
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
      const selectedPackage = formData.packages.find((p) => p.id === data.selectedPackageId);
      const selectedAddons = formData.upsells.filter((u) =>
        data.selectedAddonIds.includes(u.id)
      );

      if (!selectedPackage) {
        toast.error('Please select a package');
        return;
      }

      // Calculate total amount
      // Package price is the total bundle price (what customer pays), not per-item price
      const packageTotal = selectedPackage.price;
      const upsellsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
      const totalAmount = packageTotal + upsellsTotal;

      // Map form data to backend API format
      const orderData = {
        formData: {
          name: data.fullName.trim(),
          phoneNumber: data.phone,
          alternatePhone: data.alternativePhone || undefined,
          email: '', // Optional - could add email field later
          address: data.streetAddress,
          state: data.region,
          notes: null,
        },
        selectedPackage: {
          name: selectedPackage.name,
          price: selectedPackage.price,
          quantity: selectedPackage.quantity,
          originalPrice: selectedPackage.originalPrice,
          discountType: selectedPackage.discountType,
          discountValue: selectedPackage.discountValue,
        },
        selectedUpsells: selectedAddons.map((addon) => ({
          id: addon.id,
          productId: addon.productId,
          name: addon.name,
          description: addon.description,
          price: addon.price,
          quantity: addon.items?.quantity || 1,
          originalPrice: addon.originalPrice,
          discountType: addon.discountType,
          discountValue: addon.discountValue,
        })),
        totalAmount,
      };

      const response = await publicOrdersService.submitOrder(slug, orderData as any);

      if (response.success) {
        setOrderId(response.orderId);
        toast.success('Order placed successfully!');
      } else {
        toast.error(response.message || 'Failed to place order');
      }
    } catch (err: any) {
      console.error('Order submission error:', err);
      toast.error(err.response?.data?.message || 'Failed to place order. Please try again.');
    }
  };

  const handleNewOrder = () => {
    setOrderId(null);
    loadForm();
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
    return <OrderSuccess orderId={orderId} onClose={handleNewOrder} />;
  }

  // Checkout form state
  return <CheckoutForm formData={formData} onSubmit={handleSubmit} />;
};
