import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../ui/Button';
import { UpsellEditor } from '../UpsellEditor';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { getCurrencyForCountry } from '../../../utils/countries';

export const UpsellsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const currency = ctx.watch('currency') || getCurrencyForCountry(ctx.watch('defaultCountry') as any);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Upsells/Add-ons</h3>
        <Button type="button" variant="secondary" size="sm" onClick={ctx.addUpsell}>
          <Plus className="w-4 h-4 mr-1" />
          Add Upsell
        </Button>
      </div>
      <div className="space-y-2">
        {ctx.upsells.map((upsell) => (
          <UpsellEditor
            key={upsell.id}
            upsell={upsell}
            products={ctx.products}
            currency={currency}
            onUpdate={(updated) => ctx.updateUpsell(upsell.id, updated)}
            onDelete={() => ctx.deleteUpsell(upsell.id)}
            imagePreview={ctx.upsellImages.get(upsell.id)?.preview}
            onImageSelect={(file) => ctx.handleUpsellImageSelect(upsell.id, file)}
            onImageRemove={() => ctx.handleRemoveUpsellImage(upsell.id)}
          />
        ))}
        {ctx.upsells.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">No upsells added yet</p>
        )}
      </div>
    </div>
  );
};
