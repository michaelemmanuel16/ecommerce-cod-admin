// Shared mapping from the checkout form's collected data to the public order
// API payload. Used by both the hosted checkout page (PublicCheckout) and the
// embed widget so the two paths post a provably identical shape.
import type { PublicCheckoutForm } from '../services/public-orders.service';
import type { CheckoutFormData } from '../components/public/CheckoutForm';

export interface BuiltOrder {
  payload: {
    formData: {
      name: string;
      phoneNumber: string;
      alternatePhone?: string;
      email: string;
      address: string;
      state: string;
      notes: null;
      customFields?: Record<string, string>;
    };
    paymentMethod?: 'cod' | 'paystack_deposit' | 'paystack_full';
    selectedPackage: {
      id: number;
      name: string;
      price: number;
      quantity: number;
      originalPrice?: number;
      discountType?: string;
      discountValue?: number;
    };
    selectedUpsells: Array<{
      id: number;
      productId?: number;
      name: string;
      description?: string;
      price: number;
      quantity: number;
      originalPrice?: number;
      discountType?: string;
      discountValue?: number;
    }>;
    totalAmount: number;
  };
  totalAmount: number;
}

// Builds the order request body. Throws if the selected package isn't on the
// form (prices are re-validated server-side regardless).
export function buildOrderPayload(form: PublicCheckoutForm, data: CheckoutFormData): BuiltOrder {
  const selectedPackage = form.packages.find((p) => p.id === data.selectedPackageId);
  if (!selectedPackage) {
    throw new Error('Please select a package');
  }
  const selectedAddons = form.upsells.filter((u) => data.selectedAddonIds.includes(u.id));
  const upsellsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
  const totalAmount = selectedPackage.price + upsellsTotal;

  return {
    payload: {
      formData: {
        name: data.fullName.trim(),
        phoneNumber: data.phone,
        alternatePhone: data.alternativePhone || undefined,
        email: data.email || '',
        address: data.streetAddress,
        state: data.region,
        notes: null,
        customFields: data.customFields,
      },
      paymentMethod: data.paymentMethod,
      selectedPackage: {
        id: selectedPackage.id,
        name: selectedPackage.name,
        price: selectedPackage.price,
        quantity: selectedPackage.quantity,
        originalPrice: selectedPackage.originalPrice,
        discountType: selectedPackage.discountType,
        discountValue: selectedPackage.discountValue,
      },
      selectedUpsells: selectedAddons.map((addon) => ({
        id: addon.id,
        productId: (addon as any).productId,
        name: addon.name,
        description: addon.description,
        price: addon.price,
        quantity: addon.items?.quantity || 1,
        originalPrice: addon.originalPrice,
        discountType: addon.discountType,
        discountValue: addon.discountValue,
      })),
      totalAmount,
    },
    totalAmount,
  };
}

// Appends order details to a merchant's custom thank-you URL. Returns null when
// no URL is set or it fails to parse (caller falls back to the built-in screen).
export function buildRedirectUrl(
  redirectUrl: string | undefined,
  params: { orderId: number; total: number; currency: string },
): string | null {
  if (!redirectUrl) return null;
  try {
    const url = new URL(redirectUrl);
    url.searchParams.set('order_id', String(params.orderId));
    url.searchParams.set('total', String(params.total));
    url.searchParams.set('currency', params.currency);
    return url.toString();
  } catch {
    return null;
  }
}
