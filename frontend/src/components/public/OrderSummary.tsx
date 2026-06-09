import React from 'react';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { Button } from '../ui/Button';

type ProductPackage = PublicCheckoutForm['packages'][number];
type Upsell = PublicCheckoutForm['upsells'][number];

// One CTA per enabled payment method (MAN-58). The form posts the chosen
// `method`; the label carries its contextual amount (e.g. the deposit value).
export interface PaymentMethodOption {
  method: 'cod' | 'paystack_deposit' | 'paystack_full';
  label: string;
}

interface OrderSummaryProps {
  selectedPackage: ProductPackage | null;
  selectedAddons: Upsell[];
  currency: string;
  isSubmitting: boolean;
  onSubmit: () => void;
  buttonColor?: string;
  accentColor?: string;
  textColor?: string;
  buttonShape?: 'square' | 'rounded' | 'pill';
  buttonSize?: 'sm' | 'md' | 'lg';
  submitLabel?: string;
  // When false, the price breakdown + total are hidden (the host page shows them
  // elsewhere) and only the CTA button + terms remain. Default true.
  showSummary?: boolean;
  // Multi-button payment matrix. When provided, one button renders per method
  // (with "or" dividers) and onSelectMethod fires the chosen one; otherwise the
  // single onSubmit button renders (back-compat). Max two per MAN-58.
  paymentMethods?: PaymentMethodOption[];
  onSelectMethod?: (method: PaymentMethodOption['method']) => void;
  // Renders a short refund-policy note above the CTAs (Paystack dispute defense),
  // shown whenever an online-payment method is offered.
  showRefundPolicy?: boolean;
}

const SHAPE_CLASS: Record<NonNullable<OrderSummaryProps['buttonShape']>, string> = {
  square: 'rounded-none',
  rounded: 'rounded-lg',
  pill: 'rounded-full',
};

const SIZE_CLASS: Record<NonNullable<OrderSummaryProps['buttonSize']>, string> = {
  sm: 'py-2 text-sm',
  md: 'py-3',
  lg: 'py-4 text-lg',
};

export const OrderSummary: React.FC<OrderSummaryProps> = ({
  selectedPackage,
  selectedAddons,
  currency,
  isSubmitting,
  onSubmit,
  buttonColor = '#0f172a',
  accentColor = '#f97316',
  textColor,
  buttonShape = 'rounded',
  buttonSize = 'md',
  submitLabel = 'Place Order',
  showSummary = true,
  paymentMethods,
  onSelectMethod,
  showRefundPolicy = false,
}) => {
  const hasDiscount = selectedPackage?.originalPrice && selectedPackage.originalPrice > selectedPackage.price && selectedPackage.showDiscount !== false;
  const packageOriginalPrice = hasDiscount ? selectedPackage.originalPrice : selectedPackage?.price || 0;
  const packageDiscount = hasDiscount ? (selectedPackage.originalPrice! - selectedPackage.price) : 0;
  const packageFinalPrice = selectedPackage?.price || 0;

  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
  const subtotal = packageFinalPrice + addonsTotal;
  const total = subtotal;

  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-6 sticky top-6">
      {showSummary && (
        <>
      <h2 className="text-xl font-semibold text-gray-900 mb-4" style={textColor ? { color: textColor } : undefined}>Order Summary</h2>

      <div className="space-y-3 mb-6">
        {selectedPackage && (
          <div className="pb-3 border-b border-gray-200">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium text-gray-900">{selectedPackage.name}</p>
                <p className="text-sm text-gray-600">Qty: {selectedPackage.quantity}</p>
              </div>
              <div className="text-right">
                {hasDiscount ? (
                  <>
                    <p className="text-sm text-gray-500 line-through">
                      {currency} {packageOriginalPrice.toFixed(2)}
                    </p>
                    <p className="font-semibold text-green-600">
                      {currency} {packageFinalPrice.toFixed(2)}
                    </p>
                  </>
                ) : (
                  <p className="font-semibold text-gray-900">
                    {currency} {packageFinalPrice.toFixed(2)}
                  </p>
                )}
              </div>
            </div>
            {hasDiscount && (
              <div className="flex justify-between items-center mt-2 text-sm">
                <span className="text-green-600 font-medium">
                  {selectedPackage.discountType === 'percentage'
                    ? `Discount (${selectedPackage.discountValue}%)`
                    : 'Discount'}
                </span>
                <span className="text-green-600 font-medium">
                  - {currency} {packageDiscount.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {selectedAddons.length > 0 && (
          <div className="space-y-2 pb-3 border-b border-gray-200">
            {selectedAddons.map((addon) => (
              <div key={addon.id} className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-900">{addon.name}</p>
                  <p className="text-xs text-gray-600">Qty: {addon.items?.quantity || 1}</p>
                </div>
                <p className="text-sm font-semibold text-gray-900">
                  {currency} {addon.price.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mb-6 pt-3 border-t-2 border-gray-300">
        <span className="text-lg font-semibold text-gray-900" style={textColor ? { color: textColor } : undefined}>Total</span>
        <span className="text-2xl font-bold" style={{ color: accentColor }}>
          {currency} {total.toFixed(2)}
        </span>
      </div>
        </>
      )}

      {showRefundPolicy && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-600">
            Secure payment processed by Paystack. Orders are refundable in line with
            our refund policy — your payment is protected.
          </p>
        </div>
      )}

      {paymentMethods && paymentMethods.length > 0 ? (
        <div className="space-y-3">
          {paymentMethods.map((opt, i) => (
            <React.Fragment key={opt.method}>
              {i > 0 && (
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="h-px flex-1 bg-gray-200" />
                  or
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
              )}
              <Button
                onClick={() => onSelectMethod?.(opt.method)}
                disabled={!selectedPackage || isSubmitting}
                isLoading={isSubmitting}
                // The first/primary method uses the filled brand colour; secondary
                // methods render as outline so the pair reads as one choice.
                className={`w-full font-semibold px-6 transition-colors disabled:cursor-not-allowed ${!selectedPackage ? 'opacity-60' : ''} ${SHAPE_CLASS[buttonShape]} ${SIZE_CLASS[buttonSize]} ${i === 0 ? 'text-white' : 'border-2 bg-white'}`}
                style={i === 0 ? { backgroundColor: buttonColor } : { borderColor: buttonColor, color: buttonColor }}
              >
                {isSubmitting ? 'Processing...' : opt.label}
              </Button>
            </React.Fragment>
          ))}
        </div>
      ) : (
        <Button
          onClick={onSubmit}
          disabled={!selectedPackage || isSubmitting}
          isLoading={isSubmitting}
          className={`w-full text-white font-semibold px-6 transition-colors disabled:cursor-not-allowed ${!selectedPackage ? 'opacity-60' : ''} ${SHAPE_CLASS[buttonShape]} ${SIZE_CLASS[buttonSize]}`}
          style={{ backgroundColor: buttonColor }}
        >
          {isSubmitting ? 'Processing...' : submitLabel}
        </Button>
      )}

      <p className="text-xs text-gray-500 text-center mt-4">
        By placing this order, you agree to our terms and conditions
      </p>
    </div>
  );
};
