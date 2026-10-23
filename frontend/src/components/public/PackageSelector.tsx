import React from 'react';
import { Check } from 'lucide-react';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../utils/money';

type ProductPackage = PublicCheckoutForm['packages'][number];

interface PackageSelectorProps {
  packages: ProductPackage[];
  selectedPackageId: number | null;
  currency: string;
  onSelectPackage: (packageId: number) => void;
  primaryColor?: string;
  accentColor?: string;
  textColor?: string;
  priceColor?: string;
}

export const PackageSelector: React.FC<PackageSelectorProps> = ({
  packages,
  selectedPackageId,
  currency,
  onSelectPackage,
  primaryColor,
  accentColor,
  textColor,
  priceColor,
}) => {
  return (
    <div className="space-y-4">
      <h2 id="package-selector-heading" className="text-lg font-semibold text-gray-900" style={textColor ? { color: textColor } : undefined}>Choose your package</h2>
      <div role="radiogroup" aria-labelledby="package-selector-heading" className="flex flex-col gap-2">
        {packages.map((pkg) => {
          const isSelected = selectedPackageId === pkg.id;
          const hasDiscount = !!pkg.originalPrice && pkg.originalPrice > pkg.price && pkg.showDiscount !== false;
          // Custom highlight if enabled, otherwise "Most popular".
          const edgeTag = pkg.showHighlight && pkg.highlightText ? pkg.highlightText : pkg.isPopular ? 'Most popular' : null;
          return (
          <button
            key={pkg.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelectPackage(pkg.id)}
            className={cn(
              'w-full min-h-[68px] px-3.5 py-2 rounded-xl border-2 transition-all text-left relative flex items-center gap-3',
              edgeTag && 'mt-1.5',
              isSelected
                ? 'border-[#0f172a] bg-gray-50'
                : 'border-gray-200 hover:border-gray-300 bg-white'
            )}
            style={isSelected && primaryColor ? { borderColor: primaryColor } : undefined}
          >
            {edgeTag && (
              <span
                data-testid="package-edge-tag"
                className="absolute -top-2.5 left-[42px] px-2 py-0.5 bg-[#f97316] text-white text-xs font-medium rounded whitespace-nowrap"
                style={accentColor ? { backgroundColor: accentColor } : undefined}
              >
                {edgeTag}
              </span>
            )}

            {/* Radio indicator */}
            <div
              className={cn(
                'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                isSelected
                  ? 'border-[#0f172a] bg-[#0f172a]'
                  : 'border-gray-300'
              )}
              style={isSelected && primaryColor ? { borderColor: primaryColor, backgroundColor: primaryColor } : undefined}
            >
              {isSelected && (
                <Check className="w-3 h-3 text-white" />
              )}
            </div>

            {/* Name and quantity */}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900" style={textColor ? { color: textColor } : undefined}>{pkg.name}</h3>
              <p className="text-sm text-gray-600">Qty {pkg.quantity}</p>
            </div>

            {/* Prices */}
            <div className="flex-none flex flex-col items-end text-right">
              {hasDiscount && (
                <p className="text-xs leading-[14px] text-gray-500 line-through">
                  {formatMoney(pkg.originalPrice!, currency)}
                </p>
              )}
              <p
                className={cn('text-lg font-bold leading-6', hasDiscount ? 'text-green-600' : 'text-gray-900')}
                style={priceColor ? { color: priceColor } : undefined}
              >
                {formatMoney(pkg.price, currency)}
              </p>
              {hasDiscount && pkg.discountType === 'percentage' && pkg.discountValue && (
                <span className="mt-0.5 px-2 text-xs leading-4 bg-green-100 text-green-700 font-semibold rounded" data-testid="package-saving">
                  Save {pkg.discountValue}%
                </span>
              )}
              {hasDiscount && pkg.discountType === 'fixed' && pkg.discountValue && (
                <span className="mt-0.5 px-2 text-xs leading-4 bg-green-100 text-green-700 font-semibold rounded" data-testid="package-saving">
                  Save {formatMoney(pkg.originalPrice! - pkg.price, currency)}
                </span>
              )}
            </div>
          </button>
          );
        })}
      </div>
    </div>
  );
};
