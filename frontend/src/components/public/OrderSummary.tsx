import React from 'react';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { Button } from '../ui/Button';

type ProductPackage = PublicCheckoutForm['packages'][number];
type Upsell = PublicCheckoutForm['upsells'][number];

interface OrderSummaryProps {
  selectedPackage: ProductPackage | null;
  selectedAddons: Upsell[];
  currency: string;
  isSubmitting: boolean;
  onSubmit: () => void;
}

export const OrderSummary: React.FC<OrderSummaryProps> = ({
  selectedPackage,
  selectedAddons,
  currency,
  isSubmitting,
  onSubmit,
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
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Order Summary</h2>

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
        <span className="text-lg font-semibold text-gray-900">Total</span>
        <span className="text-2xl font-bold text-[#0f172a]">
          {currency} {total.toFixed(2)}
        </span>
      </div>

      <Button
        onClick={onSubmit}
        disabled={!selectedPackage || isSubmitting}
        isLoading={isSubmitting}
        className="w-full bg-[#0f172a] hover:bg-[#1e293b] text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Processing...' : 'Place Order'}
      </Button>

      <p className="text-xs text-gray-500 text-center mt-4">
        By placing this order, you agree to our terms and conditions
      </p>
    </div>
  );
};
