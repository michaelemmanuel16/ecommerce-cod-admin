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
          price: Math.round(finalPrice * 100) / 100,
          originalPrice: originalPrice,
          discountType: discountType,
          discountValue: discountValue,
        });
      }
    }
  }, [discountType, discountValue, originalPrice]);

  const handleDiscountTypeChange = (type: 'none' | 'percentage' | 'fixed') => {
    if (type === 'none') {
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

  const hasDiscount = discountType !== 'none' && discountValue > 0;

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
      <details open>
        <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-3">
            <span className="font-medium text-sm text-gray-900">
              {pkg.name || 'Untitled Package'}
            </span>
            <span className="text-sm font-semibold text-green-600">
              {currency} {pkg.price.toFixed(2)}
            </span>
            {pkg.quantity > 1 && (
              <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">x{pkg.quantity}</span>
            )}
            {pkg.isDefault && (
              <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">Default</span>
            )}
            {hasDiscount && (
              <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded font-medium">
                {discountType === 'percentage' ? `${discountValue}% off` : `${currency} ${discountValue} off`}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onDelete(); }}
            className="text-gray-400 hover:text-red-600 p-1 transition-colors"
            title="Delete package"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </summary>

        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          {/* Row 1: Name, Qty, Default */}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <Input
                placeholder="e.g., Buy 1, Buy 2, Buy 3"
                value={pkg.name}
                onChange={(e) => onUpdate({ ...pkg, name: e.target.value })}
              />
            </div>
            <div className="w-20">
              <label className="block text-xs font-medium text-gray-600 mb-1">Qty</label>
              <Input
                type="number"
                value={pkg.quantity}
                onChange={(e) => onUpdate({ ...pkg, quantity: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="pt-6">
              <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={pkg.isDefault || false}
                  onChange={(e) => onUpdate({ ...pkg, isDefault: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-gray-600">Default</span>
              </label>
            </div>
          </div>

          {/* Row 2: Pricing — inline single row */}
          <div className="flex items-end gap-3">
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Price <span className="text-gray-400">({productPrice} x {pkg.quantity})</span>
              </label>
              <div className="px-2.5 py-[7px] bg-gray-50 border border-gray-200 rounded-md text-sm text-gray-500">
                {currency} {originalPrice.toFixed(2)}
              </div>
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-600 mb-1">Discount</label>
              <Select
                value={discountType}
                onChange={(e) => handleDiscountTypeChange(e.target.value as any)}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'percentage', label: '% off' },
                  { value: 'fixed', label: `${currency} off` }
                ]}
              />
            </div>
            {discountType !== 'none' && (
              <div className="w-24">
                <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="0"
                    value={discountValue}
                    onChange={(e) => handleDiscountValueChange(parseFloat(e.target.value) || 0)}
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                    {discountType === 'percentage' ? <Percent className="w-3.5 h-3.5" /> : <DollarSign className="w-3.5 h-3.5" />}
                  </div>
                </div>
              </div>
            )}
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-600 mb-1">Final</label>
              <div className="px-2.5 py-[7px] bg-green-50 border border-green-200 rounded-md text-sm font-semibold text-green-700">
                {currency} {pkg.price.toFixed(2)}
              </div>
            </div>
            <div className="pt-5">
              <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={pkg.showDiscount !== false}
                  onChange={(e) => onUpdate({ ...pkg, showDiscount: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-gray-600">Show</span>
              </label>
            </div>
          </div>

          {/* Row 3: Highlight — compact inline */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={pkg.showHighlight || false}
                onChange={(e) => onUpdate({ ...pkg, showHighlight: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs font-medium text-gray-600">Badge</span>
            </label>
            <Input
              placeholder="e.g., Best Deal, Popular"
              value={pkg.highlightText || ''}
              onChange={(e) => onUpdate({ ...pkg, highlightText: e.target.value })}
              disabled={!pkg.showHighlight}
              className={!pkg.showHighlight ? 'bg-gray-50 text-gray-400' : ''}
            />
          </div>
        </div>
      </details>
    </div>
  );
};
