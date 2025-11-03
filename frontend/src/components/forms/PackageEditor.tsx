import React, { useEffect } from 'react';
import { Trash2, Percent, DollarSign } from 'lucide-react';
import { ProductPackage } from '../../types/checkout-form';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

interface PackageEditorProps {
  package: ProductPackage;
  productPrice: number; // Base product price for auto-calculation
  currency: string; // Currency code (e.g., GHS, NGN)
  onUpdate: (pkg: ProductPackage) => void;
  onDelete: () => void;
}

export const PackageEditor: React.FC<PackageEditorProps> = ({
  package: pkg,
  productPrice,
  currency,
  onUpdate,
  onDelete,
}) => {
  const discountType = pkg.discountType || 'none';
  const discountValue = pkg.discountValue || 0;
  const originalPrice = pkg.originalPrice || pkg.price;

  // Calculate final price with discount
  const calculateFinalPrice = (original: number, type: string, value: number): number => {
    if (type === 'percentage') {
      return original - (original * value / 100);
    } else if (type === 'fixed') {
      return Math.max(0, original - value);
    }
    return original;
  };

  // Auto-calculate original price based on quantity and product price
  useEffect(() => {
    const calculatedOriginalPrice = productPrice * pkg.quantity;
    if (calculatedOriginalPrice !== originalPrice) {
      const finalPrice = calculateFinalPrice(calculatedOriginalPrice, discountType, discountValue);
      onUpdate({
        ...pkg,
        originalPrice: calculatedOriginalPrice,
        price: discountType !== 'none' ? Math.round(finalPrice * 100) / 100 : calculatedOriginalPrice,
      });
    }
  }, [pkg.quantity, productPrice]);

  // Auto-calculate final price when discount changes
  useEffect(() => {
    if (discountType !== 'none' && discountValue > 0) {
      const finalPrice = calculateFinalPrice(originalPrice, discountType, discountValue);
      if (finalPrice !== pkg.price) {
        onUpdate({
          ...pkg,
          price: Math.round(finalPrice * 100) / 100, // Round to 2 decimals
          originalPrice: originalPrice,
          discountType: discountType,
          discountValue: discountValue,
        });
      }
    }
  }, [discountType, discountValue, originalPrice]);

  const handleDiscountTypeChange = (type: 'none' | 'percentage' | 'fixed') => {
    if (type === 'none') {
      // Reset to original price when discount is removed
      onUpdate({
        ...pkg,
        discountType: 'none',
        discountValue: 0,
        price: originalPrice,
      });
    } else {
      const finalPrice = calculateFinalPrice(originalPrice, type, discountValue);
      onUpdate({
        ...pkg,
        discountType: type,
        price: Math.round(finalPrice * 100) / 100,
      });
    }
  };

  const handleDiscountValueChange = (value: number) => {
    const finalPrice = calculateFinalPrice(originalPrice, discountType, value);
    onUpdate({
      ...pkg,
      discountValue: value,
      price: Math.round(finalPrice * 100) / 100,
    });
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
      <div className="space-y-3">
        {/* Row 1: Package Name, Quantity, Default, Delete */}
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-6">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Package Name
            </label>
            <Input
              placeholder="e.g., Buy 1, Buy 2, Buy 3"
              value={pkg.name}
              onChange={(e) => onUpdate({ ...pkg, name: e.target.value })}
            />
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Quantity
            </label>
            <Input
              type="number"
              placeholder="1"
              value={pkg.quantity}
              onChange={(e) => onUpdate({ ...pkg, quantity: parseInt(e.target.value) || 1 })}
            />
          </div>

          <div className="col-span-2 flex items-end">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={pkg.isDefault || false}
                onChange={(e) => onUpdate({ ...pkg, isDefault: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs font-medium text-gray-700">Default</span>
            </label>
          </div>

          <div className="col-span-2 flex items-end justify-end">
            <button
              onClick={onDelete}
              className="text-red-600 hover:text-red-700 p-2"
              title="Delete package"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Group 2: Pricing & Discounts */}
        <div className="bg-blue-50 p-3 rounded-md border border-blue-200">
          <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1">
            💰 Pricing & Discounts
          </h4>

          {/* Row A: Price Display */}
          <div className="grid grid-cols-12 gap-3 mb-3">
            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Original Price (Auto)
              </label>
              <Input
                type="number"
                placeholder="0"
                value={originalPrice}
                readOnly
                className="bg-gray-100 cursor-not-allowed"
                title={`Auto-calculated: ${productPrice} × ${pkg.quantity} = ${originalPrice.toFixed(2)}`}
              />
              <p className="text-xs text-gray-500 mt-1">
                {productPrice.toFixed(2)} × {pkg.quantity} = {originalPrice.toFixed(2)}
              </p>
            </div>

            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Final Price
              </label>
              <div className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm font-semibold text-green-600">
                {currency} {pkg.price.toFixed(2)}
              </div>
            </div>

            <div className="col-span-4"></div>
          </div>

          {/* Row B: Discount Controls */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-3 flex items-end">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pkg.showDiscount !== false}
                  onChange={(e) => onUpdate({ ...pkg, showDiscount: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-gray-700">Show Discount</span>
              </label>
            </div>

            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Discount Type
              </label>
              <Select
                value={discountType}
                onChange={(e) => handleDiscountTypeChange(e.target.value as any)}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'percentage', label: 'Percentage (%)' },
                  { value: 'fixed', label: `Fixed Amount (${currency})` }
                ]}
              />
            </div>

            <div className="col-span-5">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Discount Value
              </label>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0"
                  value={discountValue}
                  onChange={(e) => handleDiscountValueChange(parseFloat(e.target.value) || 0)}
                  disabled={discountType === 'none'}
                />
                {discountType !== 'none' && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {discountType === 'percentage' ? <Percent className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Savings Badge */}
          {discountType !== 'none' && discountValue > 0 && (
            <div className="text-xs text-green-600 font-medium mt-3">
              💰 Customer saves: {currency} {(originalPrice - pkg.price).toFixed(2)}
              {discountType === 'percentage' && ` (${discountValue}% off)`}
            </div>
          )}
        </div>

        {/* Group 3: Highlight Badge */}
        <div className="bg-purple-50 p-3 rounded-md border border-purple-200">
          <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1">
            ⭐ Highlight Badge
          </h4>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-3 flex items-end">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pkg.showHighlight || false}
                  onChange={(e) => onUpdate({ ...pkg, showHighlight: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-gray-700">Show Highlight</span>
              </label>
            </div>

            <div className="col-span-9">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Highlight Text
              </label>
              <Input
                placeholder="e.g., Best Deal, Limited Offer"
                value={pkg.highlightText || ''}
                onChange={(e) => onUpdate({ ...pkg, highlightText: e.target.value })}
                disabled={!pkg.showHighlight}
                className={!pkg.showHighlight ? 'bg-gray-100' : ''}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
