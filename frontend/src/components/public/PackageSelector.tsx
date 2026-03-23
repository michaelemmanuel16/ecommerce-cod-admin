import React from 'react';
import { Check } from 'lucide-react';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { cn } from '../../utils/cn';

type ProductPackage = PublicCheckoutForm['packages'][number];

interface PackageSelectorProps {
  packages: ProductPackage[];
  selectedPackageId: number | null;
  currency: string;
  onSelectPackage: (packageId: number) => void;
}

export const PackageSelector: React.FC<PackageSelectorProps> = ({
  packages,
  selectedPackageId,
  currency,
  onSelectPackage,
}) => {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">Select Package</h2>
      <div className="space-y-3">
        {packages.map((pkg) => (
          <button
            key={pkg.id}
            type="button"
            onClick={() => onSelectPackage(pkg.id)}
            className={cn(
              'w-full p-4 rounded-lg border-2 transition-all text-left relative',
              selectedPackageId === pkg.id
                ? 'border-[#0f172a] bg-gray-50'
                : 'border-gray-200 hover:border-gray-300 bg-white'
            )}
          >
            <div className="space-y-2">
              {/* Top row: radio + name + badge */}
              <div className="flex items-start space-x-3">
                {/* Radio indicator */}
                <div
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 flex-shrink-0',
                    selectedPackageId === pkg.id
                      ? 'border-[#0f172a] bg-[#0f172a]'
                      : 'border-gray-300'
                  )}
                >
                  {selectedPackageId === pkg.id && (
                    <Check className="w-3 h-3 text-white" />
                  )}
                </div>

                {/* Package details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{pkg.name}</h3>
                    {/* Show custom highlight if enabled, otherwise fall back to "Most Popular" */}
                    {pkg.showHighlight && pkg.highlightText ? (
                      <span className="px-2 py-0.5 bg-[#f97316] text-white text-xs font-medium rounded whitespace-nowrap flex-shrink-0">
                        {pkg.highlightText}
                      </span>
                    ) : pkg.isPopular ? (
                      <span className="px-2 py-0.5 bg-[#f97316] text-white text-xs font-medium rounded whitespace-nowrap flex-shrink-0">
                        Most Popular
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Quantity: {pkg.quantity}
                  </p>
                </div>
              </div>

              {/* Price row */}
              <div className="flex items-center gap-3 pl-8">
                {pkg.originalPrice && pkg.originalPrice > pkg.price && pkg.showDiscount !== false ? (
                  <>
                    <p className="text-sm text-gray-500 line-through">
                      {currency} {pkg.originalPrice.toFixed(2)}
                    </p>
                    <p className="text-xl font-bold text-green-600">
                      {currency} {pkg.price.toFixed(2)}
                    </p>
                    {pkg.discountType === 'percentage' && pkg.discountValue && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">
                        Save {pkg.discountValue}%
                      </span>
                    )}
                    {pkg.discountType === 'fixed' && pkg.discountValue && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">
                        Save {currency} {(pkg.originalPrice - pkg.price).toFixed(2)}
                      </span>
                    )}
                  </>
                ) : (
                  <p className="text-xl font-bold text-gray-900">
                    {currency} {pkg.price.toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
