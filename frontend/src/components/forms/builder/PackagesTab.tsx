import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../ui/Button';
import { PackageEditor } from '../PackageEditor';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { getCurrencyForCountry } from '../../../utils/countries';
import { formUrl, buildWidgetSnippet } from '../../../lib/embedSnippet';

export const PackagesTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const selectedProductId = ctx.watch('productId');
  const selectedProduct = ctx.products.find((p) => p.id === Number(selectedProductId));
  const currency = ctx.watch('currency') || getCurrencyForCountry(ctx.watch('defaultCountry') as any);
  const slug = ctx.watch('slug');
  const name = ctx.watch('name');

  // A shareable per-package link is only valid once the form is saved: it needs a
  // slug and the package's real database id (new, unsaved packages carry a negative
  // temporary id). Until then we show a hint instead of a broken link.
  const checkoutLinkFor = (packageId: number): string | undefined =>
    slug && packageId > 0 ? `${formUrl(slug)}?package=${packageId}` : undefined;

  // Inline-widget snippet locked to a single package (same save constraint).
  const embedSnippetFor = (packageId: number): string | undefined =>
    slug && packageId > 0 ? buildWidgetSnippet({ slug, name }, window.location.origin, packageId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Product Packages</h3>
        <Button type="button" variant="secondary" size="sm" onClick={ctx.addPackage}>
          <Plus className="w-4 h-4 mr-1" />
          Add Package
        </Button>
      </div>
      <div className="space-y-2">
        {ctx.packages.map((pkg) => {
          const productPrice = pkg.productPrice || selectedProduct?.price || 0;
          return (
            <PackageEditor
              key={pkg.id}
              package={pkg}
              productPrice={productPrice}
              currency={currency}
              checkoutLink={checkoutLinkFor(pkg.id)}
              embedSnippet={embedSnippetFor(pkg.id)}
              onUpdate={(updated) => ctx.updatePackage(pkg.id, updated)}
              onDelete={() => ctx.deletePackage(pkg.id)}
            />
          );
        })}
        {ctx.packages.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">No packages added yet</p>
        )}
      </div>
    </div>
  );
};
