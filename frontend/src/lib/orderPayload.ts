// Shared mapping from the checkout form's collected data to the public order
// API payload. Used by both the hosted checkout page (PublicCheckout) and the
// embed widget so the two paths post a provably identical shape.
import type { PublicCheckoutForm } from '../services/public-orders.service';
import type { CheckoutFormData } from '../components/public/CheckoutForm';
import { getFbCookies } from '../utils/pixelTracking';

export interface BuiltOrder {
  payload: {
    formData: {
      name: string;
      phoneNumber: string;
      alternatePhone?: string;
      email: string;
      address?: string;
      state: string;
      town: string;
      landmark?: string;
      notes: string | null;
      customFields?: Record<string, string>;
    };
    paymentMethod?: CheckoutFormData['paymentMethod'];
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
        address: data.streetAddress?.trim() || undefined,
        state: data.region,
        town: data.town?.trim() ?? '',
        landmark: data.landmark?.trim() || undefined,
        notes: data.notes?.trim() || null,
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
// `reference` (Paystack) and `package` are appended when available so the
// merchant's page can reconcile the payment and show package-specific upsells.
export function buildRedirectUrl(
  redirectUrl: string | undefined,
  // Mirrored on the server by buildThankYouUrl (backend/src/utils/thankYouUrl.ts), which builds it for online payments.
  params: { orderId: number; total: number; currency: string; reference?: string | null; package?: number | string | null },
): string | null {
  if (!redirectUrl) return null;
  try {
    const url = new URL(redirectUrl);
    url.searchParams.set('order_id', String(params.orderId));
    url.searchParams.set('total', String(params.total));
    url.searchParams.set('currency', params.currency);
    if (params.reference) url.searchParams.set('reference', String(params.reference));
    if (params.package != null) url.searchParams.set('package', String(params.package));
    return url.toString();
  } catch {
    return null;
  }
}

/** What the order endpoint answers, as far as placing an order needs it. */
export interface OrderReply {
  success?: boolean;
  message?: string;
  orderId?: number;
  orderNumber?: string;
  deduplicated?: boolean;
  authorization_url?: string;
  paymentReference?: string;
}

export type PlaceOrderResult =
  /** Leave for the provider's payment page, or the merchant's thank-you page. `order` is set for a COD order that was created. */
  | { kind: 'redirect'; url: string; order?: { orderId: number; orderNumber?: string; total: number } }
  /** COD order created: show the success screen. */
  | { kind: 'placed'; orderId: number; orderNumber?: string; total: number }
  /** The same buyer just ordered the same thing: a thank-you screen, no new order, no Purchase, no thank-you redirect. */
  | { kind: 'repeat'; orderId?: number; orderNumber?: string; total: number };

/**
 * The submit sequence both checkouts share (the hosted page and the embed widget): check the package, post the order with
 * the Meta click ids, and say what to do next. The caller sends the request (`submit`) and applies the result to its own
 * state. Any failure throws an Error whose message the buyer can read.
 */
export async function placeOrder(
  form: PublicCheckoutForm,
  data: CheckoutFormData,
  submit: (payload: BuiltOrder['payload'] & { fbp?: string; fbc?: string }) => Promise<OrderReply>,
): Promise<PlaceOrderResult> {
  if (!form.packages.some((p) => p.id === data.selectedPackageId)) throw new Error('Please choose a package.');
  const { payload, totalAmount } = buildOrderPayload(form, data);
  // Attach Meta click ids so the Purchase CAPI event can match this buyer.
  const reply = await submit({ ...payload, ...getFbCookies() });
  if (reply.success === false) throw new Error(reply.message || 'We could not place your order. Please try again.');

  // Online payment: the order is created after payment, so there is no order id here.
  if (reply.authorization_url) return { kind: 'redirect', url: reply.authorization_url };

  if (reply.deduplicated) return { kind: 'repeat', orderId: reply.orderId, orderNumber: reply.orderNumber, total: totalAmount };

  // COD: the order was created now and carries an order id.
  if (!reply.orderId) throw new Error('We could not complete your order. Please try again.');
  const order = { orderId: reply.orderId, orderNumber: reply.orderNumber, total: totalAmount };
  // Custom thank-you page: the merchant's page can show the order and fire its own purchase pixel.
  const url = buildRedirectUrl(form.redirectUrl, {
    orderId: reply.orderId,
    total: totalAmount,
    currency: form.currency,
    reference: reply.paymentReference,
    package: data.selectedPackageId,
  });
  return url ? { kind: 'redirect', url, order } : { kind: 'placed', ...order };
}
