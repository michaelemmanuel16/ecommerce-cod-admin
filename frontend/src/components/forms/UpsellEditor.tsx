import React, { useRef } from 'react';
import { Trash2, Upload, X, Percent, DollarSign } from 'lucide-react';
import { Upsell } from '../../types/checkout-form';
import { Product } from '../../types';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';

interface UpsellEditorProps {
  upsell: Upsell;
  products: Product[];
  currency: string;
  onUpdate: (upsell: Upsell) => void;
  onDelete: () => void;
  imagePreview?: string;
  onImageSelect: (file: File | null) => void;
  onImageRemove: () => void;
}

export const UpsellEditor: React.FC<UpsellEditorProps> = ({
  upsell,
  products,
  currency,
  onUpdate,
  onDelete,
  imagePreview,
  onImageSelect,
  onImageRemove,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const discountType = upsell.discountType || 'none';
  const discountValue = upsell.discountValue || 0;
  const originalPrice = upsell.originalPrice || upsell.price;

  // Calculate final price with discount
  const calculateFinalPrice = (original: number, type: string, value: number): number => {
    if (type === 'percentage') {
      return original - (original * value / 100);
    } else if (type === 'fixed') {
      return Math.max(0, original - value);
    }
    return original;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      // Validate file size (5MB)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('Image must be less than 5MB');
        return;
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        alert('Invalid image format. Use JPG, PNG, WebP, or GIF');
        return;
      }

      onImageSelect(file);
    }
  };

  const handleProductSelect = (productId: string) => {
    if (!productId) {
      // Manual entry - clear product link but keep existing data
      onUpdate({ ...upsell, productId: undefined });
      return;
    }

    const product = products.find(p => p.id === parseInt(productId));
    if (product) {
      // Auto-fill from product
      onUpdate({
        ...upsell,
        productId: product.id,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        originalPrice: product.price,
        price: discountType !== 'none'
          ? calculateFinalPrice(product.price, discountType, discountValue)
          : product.price,
      });
    }
  };

  const handleDiscountTypeChange = (type: 'none' | 'percentage' | 'fixed') => {
    if (type === 'none') {
      // Reset to original price when discount is removed
      onUpdate({
        ...upsell,
        discountType: 'none',
        discountValue: 0,
        price: originalPrice,
      });
    } else {
      const finalPrice = calculateFinalPrice(originalPrice, type, discountValue);
      onUpdate({
        ...upsell,
        discountType: type,
        price: Math.round(finalPrice * 100) / 100,
      });
    }
  };

  const handleDiscountValueChange = (value: number) => {
    const finalPrice = calculateFinalPrice(originalPrice, discountType, value);
    onUpdate({
      ...upsell,
      discountValue: value,
      price: Math.round(finalPrice * 100) / 100,
    });
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
      {/* Row 1: Product Selector, Quantity, Delete */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-8">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Link to Product
          </label>
          <Select
            value={upsell.productId?.toString() || ''}
            onChange={(e) => handleProductSelect(e.target.value)}
            options={[
              { value: '', label: 'Manual Entry (No Product Link)' },
              ...products.map(p => ({
                value: p.id.toString(),
                label: `${p.name} (${currency} ${p.price.toFixed(2)})`
              }))
            ]}
          />
          <p className="text-xs text-gray-500 mt-1">
            Select a product to auto-fill details, or use manual entry
          </p>
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Quantity
          </label>
          <Input
            type="number"
            placeholder="1"
            value={upsell.quantity}
            onChange={(e) => onUpdate({ ...upsell, quantity: parseInt(e.target.value) || 1 })}
          />
        </div>

        <div className="col-span-2 flex items-end justify-end">
          <button
            onClick={onDelete}
            className="text-red-600 hover:text-red-700 p-2"
            title="Delete upsell"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Row 2: Upsell Name (only if manual entry or to override) */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Upsell Name
        </label>
        <Input
          placeholder="e.g., Add Extra Battery"
          value={upsell.name}
          onChange={(e) => onUpdate({ ...upsell, name: e.target.value })}
        />
      </div>

      {/* Group 1: Pricing & Discounts */}
      <div className="bg-blue-50 p-3 rounded-md border border-blue-200">
        <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1">
          💰 Pricing & Discounts
        </h4>

        {/* Row A: Price Display */}
        <div className="grid grid-cols-12 gap-3 mb-3">
          <div className="col-span-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Original Price
            </label>
            <Input
              type="number"
              placeholder="0"
              value={originalPrice}
              onChange={(e) => onUpdate({
                ...upsell,
                originalPrice: parseFloat(e.target.value) || 0,
                price: discountType !== 'none'
                  ? calculateFinalPrice(parseFloat(e.target.value) || 0, discountType, discountValue)
                  : parseFloat(e.target.value) || 0
              })}
              className={upsell.productId ? 'bg-gray-100' : ''}
              title={upsell.productId ? 'Auto-filled from product. Change product or use manual entry to edit.' : ''}
            />
          </div>

          <div className="col-span-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Final Price
            </label>
            <div className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm font-semibold text-green-600">
              {currency} {upsell.price.toFixed(2)}
            </div>
          </div>

          <div className="col-span-4"></div>
        </div>

        {/* Row B: Discount Controls */}
        <div className="grid grid-cols-12 gap-3">
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
            💰 Customer saves: {currency} {(originalPrice - upsell.price).toFixed(2)}
            {discountType === 'percentage' && ` (${discountValue}% off)`}
          </div>
        )}
      </div>

      {/* Row 2: Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description (optional)
        </label>
        <Textarea
          value={upsell.description || ''}
          onChange={(e) => onUpdate({ ...upsell, description: e.target.value })}
          placeholder="Describe what's included in this add-on..."
          rows={3}
          className="resize-none"
        />
        <p className="text-xs text-gray-500 mt-1">
          Use bullet points (•) or line breaks for better readability
        </p>
      </div>

      {/* Row 3: Image Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Image (optional)
        </label>

        {!imagePreview && !upsell.imageUrl ? (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Image
            </Button>
            <p className="text-xs text-gray-500">
              JPG, PNG, WebP, or GIF (max 5MB)
            </p>
          </div>
        ) : (
          <div className="relative inline-block">
            <img
              src={imagePreview || upsell.imageUrl}
              alt={upsell.name}
              className="h-32 w-32 object-cover rounded border border-gray-300"
            />
            <button
              type="button"
              onClick={onImageRemove}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 shadow-md"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
