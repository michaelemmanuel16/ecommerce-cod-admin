import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { cn } from '../../utils/cn';

type Upsell = PublicCheckoutForm['upsells'][number];

interface AddOnSelectorProps {
  upsells: Upsell[];
  selectedAddons: Set<number>;
  currency: string;
  onToggleAddon: (addonId: number) => void;
}

export const AddOnSelector: React.FC<AddOnSelectorProps> = ({
  upsells,
  selectedAddons,
  currency,
  onToggleAddon,
}) => {
  const hasExpandableContent = (addon: Upsell) => {
    return !!(addon.description || addon.imageUrl);
  };

  // Start collapsed by default
  const [expandedAddons, setExpandedAddons] = useState<Set<number>>(
    () => new Set()
  );

  const toggleExpand = (addonId: number) => {
    const newExpanded = new Set(expandedAddons);
    if (expandedAddons.has(addonId)) {
      newExpanded.delete(addonId);
    } else {
      newExpanded.add(addonId);
    }
    setExpandedAddons(newExpanded);
  };

  if (upsells.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">
        Add-ons <span className="text-gray-500 font-normal text-base">(Optional)</span>
      </h2>
      <div className="space-y-3">
        {upsells.map((addon) => {
          const isSelected = selectedAddons.has(addon.id);
          const isExpanded = expandedAddons.has(addon.id);
          const expandable = hasExpandableContent(addon);

          return (
            <div
              key={addon.id}
              className={cn(
                'rounded-lg border-2 transition-all overflow-hidden',
                isSelected
                  ? 'border-[#0f172a] bg-gray-50'
                  : 'border-gray-200 bg-white'
              )}
            >
              <div className="p-4 flex items-center justify-between">
                {/* Checkbox — only toggles selection */}
                <button
                  type="button"
                  onClick={() => onToggleAddon(addon.id)}
                  className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0',
                    isSelected
                      ? 'bg-[#0f172a] border-[#0f172a]'
                      : 'border-gray-300'
                  )}
                >
                  {isSelected && (
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>

                {/* Clickable row area — toggles expand */}
                <div
                  className={cn(
                    'flex-1 flex items-center justify-between ml-3',
                    expandable && 'cursor-pointer'
                  )}
                  onClick={() => expandable && toggleExpand(addon.id)}
                >
                  <div>
                    <h3 className="font-semibold text-gray-900">{addon.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Quantity: {addon.items?.quantity || 1}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <p className="text-lg font-bold text-gray-900">
                      {currency} {addon.price.toFixed(2)}
                    </p>
                    {expandable && (
                      <ChevronDown
                        className={cn(
                          'w-5 h-5 text-gray-400 transition-transform',
                          isExpanded && 'rotate-180'
                        )}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && expandable && (
                <div className="px-4 pb-4 border-t border-gray-200">
                  <div className={cn(
                    'mt-4',
                    addon.imageUrl && addon.description
                      ? 'flex items-start gap-4'
                      : 'space-y-3'
                  )}>
                    {addon.imageUrl && (
                      <div className={cn(
                        addon.description ? 'w-20 flex-shrink-0' : 'flex justify-center'
                      )}>
                        <img
                          src={addon.imageUrl}
                          alt={addon.name}
                          className="w-full h-auto max-h-32 rounded-lg border border-gray-200 object-contain"
                          loading="lazy"
                        />
                      </div>
                    )}
                    {addon.description && (
                      <div className="text-sm text-gray-700 whitespace-pre-wrap flex-1">
                        {addon.description}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
