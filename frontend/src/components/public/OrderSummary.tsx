import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { PaymentMethod } from '../../types/checkout-form';
import { Button } from '../ui/Button';
import { formatMoney } from '../../utils/money';
import { whatsappUrl } from '../../utils/whatsapp';
import { packageSaving } from '../../lib/packagePricing';
import { useMediaQuery } from '../../hooks/useMediaQuery';

type ProductPackage = PublicCheckoutForm['packages'][number];
type Upsell = PublicCheckoutForm['upsells'][number];

// One CTA per enabled payment method (MAN-58). The form posts the chosen
// `method`; the label carries its contextual amount (e.g. the deposit value).
export interface PaymentMethodOption {
  method: PaymentMethod;
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
  // Renders a short refund note above the CTAs, shown whenever an online-payment method is offered.
  showRefundPolicy?: boolean;
  priceColor?: string;
  /** The server's answer to the last try ("This product is sold out"), shown in plain words above the buttons. */
  submitError?: string | null;
  /** Digital forms: the terms talk about the download link, not delivery. */
  isDigital?: boolean;
  /** COD is one of the buttons: the terms say you pay on delivery. */
  hasCod?: boolean;
  supportWhatsapp?: string | null;
  /** Shows the product thumbnail and name at the top of the card, on wide screens only. */
  product?: { imageUrl?: string; name: string };
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

/** The terms note: one line and an in-page section that opens on tap. No link, no new tab (the Facebook in-app browser loses the page). */
const TermsNote: React.FC<{ isDigital: boolean; hasCod: boolean; supportWhatsapp?: string | null }> = ({ isDigital, hasCod, supportWhatsapp }) => {
  const [open, setOpen] = useState(false);
  const support = whatsappUrl(supportWhatsapp);
  const lines = isDigital
    ? ['You pay online, in full, before you get the download link.', 'The download link is sent to the email you give us.']
    : [
        'We call you to confirm your order before we send it.',
        ...(hasCod ? ['Cash on delivery: you pay when your order arrives.'] : []),
        'Give us a phone number that works, so we can reach you.',
      ];
  return (
    <div className="mt-4 text-center">
      <p className="text-xs text-gray-500">
        By placing this order, you agree to our{' '}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="checkout-terms"
          className="underline font-medium text-gray-700 inline-flex items-center gap-0.5"
        >
          terms
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </p>
      {open && (
        <div id="checkout-terms" className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-left text-xs text-gray-600 space-y-1">
          <ul className="list-disc pl-4 space-y-1">
            {lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {support && (
            <p>
              Questions? <a href={support} className="underline font-medium">Message us on WhatsApp</a>.
            </p>
          )}
        </div>
      )}
    </div>
  );
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
  priceColor,
  submitError,
  isDigital = false,
  hasCod = true,
  supportWhatsapp,
  product,
}) => {
  const isWide = useMediaQuery('(min-width: 1024px)');
  const hasDiscount = !!selectedPackage && packageSaving(selectedPackage, currency).hasDiscount;
  const packageOriginalPrice = selectedPackage && hasDiscount ? selectedPackage.originalPrice! : selectedPackage?.price || 0;
  const packageDiscount = selectedPackage && hasDiscount ? (selectedPackage.originalPrice! - selectedPackage.price) : 0;
  const packageFinalPrice = selectedPackage?.price || 0;

  const addonsTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
  const subtotal = packageFinalPrice + addonsTotal;
  const total = subtotal;

  // Normalize to a single button list: the multi-method matrix when provided,
  // else the legacy single CTA (driven by onSubmit / submitLabel).
  const buttons: PaymentMethodOption[] =
    paymentMethods && paymentMethods.length > 0
      ? paymentMethods
      : [{ method: 'cod', label: submitLabel }];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-6">
      {isWide && product?.imageUrl && (
        <div className="flex items-center gap-3 mb-4" data-testid="summary-product">
          <img src={product.imageUrl} alt="" width={64} height={64} loading="lazy" decoding="async" className="w-16 h-16 rounded-lg border border-gray-200 object-cover flex-none" />
          <p className="font-semibold text-gray-900 min-w-0">{product.name}</p>
        </div>
      )}
      {showSummary && (
        <>
      <h2 className="text-lg font-semibold text-gray-900 mb-4" style={textColor ? { color: textColor } : undefined}>Order summary</h2>

      <div className="space-y-3 mb-6">
        {selectedPackage && (
          <div className="pb-3 border-b border-gray-200">
            <div className="flex justify-between items-start gap-3">
              <div>
                <p className="font-medium text-gray-900">{selectedPackage.name}</p>
                <p className="text-sm text-gray-600">Qty: {selectedPackage.quantity}</p>
              </div>
              <div className="text-right">
                {hasDiscount ? (
                  <>
                    <p className="text-sm text-gray-500 line-through">
                      {formatMoney(packageOriginalPrice, currency)}
                    </p>
                    <p className="font-semibold text-green-600" style={priceColor ? { color: priceColor } : undefined}>
                      {formatMoney(packageFinalPrice, currency)}
                    </p>
                  </>
                ) : (
                  <p className="font-semibold text-gray-900" style={priceColor ? { color: priceColor } : undefined}>
                    {formatMoney(packageFinalPrice, currency)}
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
                  - {formatMoney(packageDiscount, currency)}
                </span>
              </div>
            )}
          </div>
        )}

        {selectedAddons.length > 0 && (
          <div className="space-y-2 pb-3 border-b border-gray-200">
            {selectedAddons.map((addon) => (
              <div key={addon.id} className="flex justify-between items-start gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{addon.name}</p>
                  <p className="text-xs text-gray-600">Qty: {addon.items?.quantity ?? 1}</p>
                </div>
                <p className="text-sm font-semibold text-gray-900" style={priceColor ? { color: priceColor } : undefined}>
                  {formatMoney(addon.price, currency)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mb-6 pt-3 border-t-2 border-gray-300">
        <span className="text-lg font-semibold text-gray-900" style={textColor ? { color: textColor } : undefined}>Total</span>
        <span className="text-2xl font-bold" style={{ color: priceColor || accentColor }} data-testid="order-total">
          {formatMoney(total, currency)}
        </span>
      </div>
        </>
      )}

      {showRefundPolicy && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-600">
            Your payment is processed securely online. Orders are refundable in line with
            our refund policy.
          </p>
        </div>
      )}

      {submitError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {submitError}
        </p>
      )}

      <div className="space-y-3">
        {buttons.map((opt, i) => (
          <React.Fragment key={opt.method}>
            {i > 0 && (
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="h-px flex-1 bg-gray-200" />
                or
                <span className="h-px flex-1 bg-gray-200" />
              </div>
            )}
            <Button
              // The first button is the form's submit button, so the phone keyboard's Go key places the order too. Its click
              // is taken over (preventDefault) so one tap sends one order; the others are plain buttons.
              type={i === 0 ? 'submit' : 'button'}
              onClick={(e) => {
                e.preventDefault();
                if (isSubmitting) return;
                if (onSelectMethod) onSelectMethod(opt.method);
                else onSubmit();
              }}
              disabled={!selectedPackage || isSubmitting}
              isLoading={isSubmitting}
              // The first/primary method uses the filled brand colour; secondary
              // methods render as outline so the pair reads as one choice.
              className={`w-full font-semibold px-6 transition-colors disabled:cursor-not-allowed ${!selectedPackage ? 'opacity-60' : ''} ${SHAPE_CLASS[buttonShape]} ${SIZE_CLASS[buttonSize]} ${i === 0 ? 'text-white' : 'border-2 bg-white'}`}
              style={i === 0 ? { backgroundColor: buttonColor } : { borderColor: buttonColor, color: buttonColor }}
            >
              {isSubmitting ? 'Placing your order.' : opt.label}
            </Button>
          </React.Fragment>
        ))}
      </div>

      <TermsNote isDigital={isDigital} hasCod={hasCod} supportWhatsapp={supportWhatsapp} />
    </div>
  );
};
