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
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('Image must be less than 5MB');
        return;
      }
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
      onUpdate({ ...upsell, productId: undefined });
      return;
    }
    const product = products.find(p => p.id === parseInt(productId));
    if (product) {
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

  const hasDiscount = discountType !== 'none' && discountValue > 0;
  const hasImage = imagePreview || upsell.imageUrl;

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
      <details open>
        <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-3">
            {hasImage && (
              <img
                src={imagePreview || upsell.imageUrl}
                alt=""
                className="w-6 h-6 rounded object-cover"
              />
            )}
            <span className="font-medium text-sm text-gray-900">
              {upsell.name || 'Untitled Upsell'}
            </span>
            <span className="text-sm font-semibold text-green-600">
              {currency} {upsell.price.toFixed(2)}
            </span>
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
            title="Delete upsell"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </summary>

        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          {/* Row 1: Product link + Qty */}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Link to Product</label>
              <Select
                value={upsell.productId?.toString() || ''}
                onChange={(e) => handleProductSelect(e.target.value)}
                options={[
                  { value: '', label: 'Manual Entry' },
                  ...products.map(p => ({
                    value: p.id.toString(),
                    label: `${p.name} (${currency} ${p.price.toFixed(2)})`
                  }))
                ]}
              />
            </div>
            <div className="w-20">
              <label className="block text-xs font-medium text-gray-600 mb-1">Qty</label>
              <Input
                type="number"
                value={upsell.quantity}
                onChange={(e) => onUpdate({ ...upsell, quantity: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>

          {/* Row 2: Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Upsell Name</label>
            <Input
              placeholder="e.g., Add Extra Battery"
              value={upsell.name}
              onChange={(e) => onUpdate({ ...upsell, name: e.target.value })}
            />
          </div>

          {/* Row 3: Pricing — inline single row */}
          <div className="flex items-end gap-3">
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-600 mb-1">Price</label>
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
                className={upsell.productId ? 'bg-gray-50' : ''}
              />
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
                {currency} {upsell.price.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Row 4: Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <Textarea
              value={upsell.description || ''}
              onChange={(e) => onUpdate({ ...upsell, description: e.target.value })}
              placeholder="Describe what's included in this add-on..."
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Row 5: Image */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Image</label>
            {!hasImage ? (
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
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload
                </Button>
                <span className="text-xs text-gray-400">JPG, PNG, WebP, GIF (max 5MB)</span>
              </div>
            ) : (
              <div className="relative inline-block">
                <img
                  src={imagePreview || upsell.imageUrl}
                  alt={upsell.name}
                  className="h-20 w-20 object-cover rounded border border-gray-200"
                />
                <button
                  type="button"
                  onClick={onImageRemove}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 shadow-sm"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
};
