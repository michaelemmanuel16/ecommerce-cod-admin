import React from 'react';
import { Check, Code2, Link2, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui-v2';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { formUrl, buildWidgetSnippet } from '../../../lib/embedSnippet';
import { packageDiscountAmount, packageFinalPrice, packageIssue, packageOriginalPrice } from '../../../lib/packagePricing';
import { formatCurrency } from '../../../utils/format';
import { getCurrencySymbol } from '../../../utils/countries';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import type { ProductPackage } from '../../../types/checkout-form';

type DiscountType = NonNullable<ProductPackage['discountType']>;

/** Copy buttons for one saved package: a link that shows only this package, and the matching embed snippet. */
const PackageLinks: React.FC<{ pkg: ProductPackage; slug: string; name: string }> = ({ pkg, slug, name }) => {
  const link = useCopyToClipboard();
  const embed = useCopyToClipboard();
  const label = pkg.name || 'Untitled package';
  return (
    <div className="frow">
      <div className="sp">
        <b>{label}</b>
        <small>Opens the checkout with only this package.</small>
      </div>
      <Button size="mini" aria-label={`Copy link for ${label}`} onClick={() => link.copy(`${formUrl(slug)}?package=${pkg.id}`)}>
        {link.copied ? <Check size={14} /> : <Link2 size={14} />} {link.copied ? 'Copied' : 'Copy link'}
      </Button>
      <Button size="mini" aria-label={`Copy embed snippet for ${label}`} onClick={() => embed.copy(buildWidgetSnippet({ slug, name }, window.location.origin, pkg.id))}>
        {embed.copied ? <Check size={14} /> : <Code2 size={14} />} {embed.copied ? 'Copied' : 'Copy embed'}
      </Button>
    </div>
  );
};

/**
 * Packages tab (M3b-T12, F-414): the mockup table. Final price = sets x product price - discount, worked out by
 * `packageFinalPrice` (the same function the preview and the save use). Exactly one package is the default.
 */
export const PackagesTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const price = ctx.productPrice;
  const symbol = getCurrencySymbol(ctx.currency);
  const money = (n: number) => formatCurrency(n, ctx.currency);
  const slug = ctx.watch('slug');
  const name = ctx.watch('name');
  const saved = ctx.packages.filter((p) => p.id > 0);

  return (
    <div className="stack">
      <div className="paneh">
        <h3>Packages</h3>
        <p>
          Bundles the customer picks from.
          {price > 0 ? ` One price is ${money(price)} per set.` : ' Choose a product in Basics to work out the prices.'}
        </p>
      </div>

      {ctx.packages.length === 0 ? (
        <p className="hint">No packages added yet. Add one to take orders.</p>
      ) : (
        <div className="tablewrap pt2wrap">
          <table className="pt2">
            <colgroup>
              <col style={{ width: 52 }} />
              <col />
              <col style={{ width: 128 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 44 }} />
              <col style={{ width: 36 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Sets</th>
                <th>Name</th>
                <th>Discount ({symbol})</th>
                <th>Final price</th>
                <th>Badge</th>
                <th>Default</th>
                <th><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {ctx.packages.map((pkg, i) => {
                const n = i + 1;
                const type: DiscountType = pkg.discountType || 'none';
                const issue = packageIssue(price, pkg);
                const discount = packageDiscountAmount(price, pkg);
                const patch = (changes: Partial<ProductPackage>) => ctx.updatePackage(pkg.id, { ...pkg, ...changes });
                const badgeOn = Boolean(pkg.showHighlight || pkg.isPopular);
                return (
                  <tr key={pkg.id}>
                    <td>
                      <input
                        className="cin"
                        type="number"
                        min={1}
                        aria-label={`Sets, package ${n}`}
                        aria-invalid={issue === 'Sets must be at least 1.' ? true : undefined}
                        value={pkg.quantity}
                        onChange={(e) => patch({ quantity: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input className="cin" aria-label={`Name, package ${n}`} placeholder="e.g. 2 sets" value={pkg.name} onChange={(e) => patch({ name: e.target.value })} />
                    </td>
                    <td>
                      <div className="money">
                        <select
                          className="cin"
                          style={{ width: 64 }}
                          aria-label={`Discount type, package ${n}`}
                          value={type}
                          onChange={(e) => patch({ discountType: e.target.value as DiscountType, discountValue: e.target.value === 'none' ? 0 : pkg.discountValue || 0 })}
                        >
                          <option value="none">None</option>
                          <option value="fixed">{symbol}</option>
                          <option value="percentage">%</option>
                        </select>
                        {type !== 'none' && (
                          <input
                            className="cin"
                            style={{ width: 56 }}
                            type="number"
                            min={0}
                            aria-label={`Discount, package ${n}`}
                            value={pkg.discountValue || 0}
                            onChange={(e) => patch({ discountValue: Number(e.target.value) })}
                          />
                        )}
                      </div>
                      {type === 'percentage' && <span className="sub">= {money(discount)} off</span>}
                      {type !== 'none' && (
                        <label className="checkline">
                          <input type="checkbox" checked={pkg.showDiscount !== false} onChange={(e) => patch({ showDiscount: e.target.checked })} />
                          Show the saving to buyers
                        </label>
                      )}
                    </td>
                    <td className="num">
                      <b>{money(packageFinalPrice(price, pkg))}</b>
                      {discount > 0 && <span className="sub">Was {money(packageOriginalPrice(price, pkg))}</span>}
                      {issue && <span className="err" role="alert">{issue}</span>}
                    </td>
                    <td>
                      <div className="badgectl">
                        <input
                          type="checkbox"
                          aria-label={`Popular badge, package ${n}`}
                          title="Show a badge on this package"
                          checked={badgeOn}
                          onChange={(e) => patch({ isPopular: e.target.checked, showHighlight: e.target.checked && Boolean(pkg.highlightText?.trim()) })}
                        />
                        <input
                          className="cin"
                          aria-label={`Badge text, package ${n}`}
                          placeholder="Badge"
                          value={pkg.highlightText || ''}
                          onChange={(e) => {
                            const text = e.target.value;
                            patch({ highlightText: text, showHighlight: text.trim() !== '' || pkg.isPopular, isPopular: text.trim() !== '' || pkg.isPopular });
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <input type="radio" name="default-package" aria-label={`Default, package ${n}`} checked={Boolean(pkg.isDefault)} onChange={() => patch({ isDefault: true })} />
                    </td>
                    <td>
                      <Button size="icon-sm" className="dng" aria-label={`Remove package ${n}`} title="Remove package" onClick={() => ctx.deletePackage(pkg.id)}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <Button onClick={ctx.addPackage}>
          <Plus />
          Add package
        </Button>
        {price > 0 && <p className="hint">Final price is sets times {money(price)} minus the discount.</p>}
      </div>

      <div>
        <div className="paneh" style={{ marginTop: 6 }}>
          <h3>Direct links</h3>
          <p>Share a link that shows one package only.</p>
        </div>
        {saved.length === 0 || !slug ? (
          <p className="hint">Save the form to get a link for each package.</p>
        ) : (
          <div className="frow-list">
            {saved.map((p) => <PackageLinks key={p.id} pkg={p} slug={slug} name={name} />)}
          </div>
        )}
      </div>
    </div>
  );
};
