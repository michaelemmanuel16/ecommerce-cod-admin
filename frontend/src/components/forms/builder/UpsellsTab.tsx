import React, { useRef, useState } from 'react';
import { Plus, Trash2, Upload, X } from 'lucide-react';
import { Button, Input, Select } from '../../ui-v2';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { validateImageFile, type UpsellStats } from '../../../services/checkout-forms.service';
import { applyDiscount } from '../../../lib/packagePricing';
import { upsellHint } from '../../../lib/upsellHint';
import { formatCurrency } from '../../../utils/format';
import { getCurrencySymbol } from '../../../utils/countries';
import type { Upsell } from '../../../types/checkout-form';

// The same limits the upload route had before this tab was rebuilt.
const IMAGE_RULE = {
  types: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  maxBytes: 5 * 1024 * 1024,
  message: 'Use a JPG, PNG, WebP or GIF image of 5 MB or less.',
};

type DiscountType = NonNullable<Upsell['discountType']>;

const UpsellCard: React.FC<{ upsell: Upsell; stats: UpsellStats | null }> = ({ upsell, stats }) => {
  const ctx = useCheckoutBuilder();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const symbol = getCurrencySymbol(ctx.currency);
  const type: DiscountType = upsell.discountType || 'none';
  const value = upsell.discountValue || 0;
  const original = upsell.originalPrice ?? upsell.price;
  const active = upsell.isActive !== false;
  const preview = ctx.upsellImages.get(upsell.id)?.preview;
  const image = preview || upsell.imageUrl;
  const label = upsell.name || 'Untitled upsell';
  const hint = stats ? upsellHint(stats.ordersTotal, stats.upsells.find((s) => s.upsellId === upsell.id)?.orders) : null;
  const patch = (changes: Partial<Upsell>) => ctx.updateUpsell(upsell.id, { ...upsell, ...changes });
  const setPricing = (nextOriginal: number, nextType: DiscountType, nextValue: number) =>
    patch({
      originalPrice: nextOriginal,
      discountType: nextType,
      discountValue: nextType === 'none' ? 0 : nextValue,
      price: nextType === 'none' ? nextOriginal : applyDiscount(nextOriginal, nextType, nextValue),
    });

  const pickProduct = (id: string) => {
    const product = ctx.products.find((p) => p.id === Number(id));
    if (!product) {
      patch({ productId: undefined });
      return;
    }
    patch({
      productId: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      originalPrice: product.price,
      price: type === 'none' ? product.price : applyDiscount(product.price, type, value),
    });
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const refusal = validateImageFile(file, IMAGE_RULE);
    if (refusal) return setFileError(refusal);
    setFileError(null);
    ctx.handleUpsellImageSelect(upsell.id, file);
  };

  return (
    <div className={`upcard${active ? '' : ' off'}`} data-testid="upsell-card">
      <label className="sw">
        <input type="checkbox" checked={active} aria-label={`Show ${label} on the form`} onChange={(e) => patch({ isActive: e.target.checked })} />
        <span className="tg" />
      </label>
      <div className="upbody">
        <div className="uphead">
          <b>{label}{!active && ' (off)'}</b>
          <Button size="icon-sm" className="dng" aria-label={`Delete ${label}`} title="Delete upsell" onClick={() => ctx.deleteUpsell(upsell.id)}>
            <Trash2 />
          </Button>
        </div>

        <div className="row2">
          <Select label="Source" value={upsell.productId ?? ''} onChange={(e) => pickProduct(e.target.value)}>
            <option value="">Manual entry</option>
            {ctx.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({formatCurrency(p.price, ctx.currency)})</option>
            ))}
          </Select>
          <Input label="Quantity" type="number" min={1} value={upsell.quantity} onChange={(e) => patch({ quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
        </div>

        <Input label="Headline" placeholder="e.g. Add 5 refill pens" value={upsell.name} onChange={(e) => patch({ name: e.target.value })} />

        <div className="fl">
          <label htmlFor={`up-desc-${upsell.id}`}>Description <span className="opt">(optional)</span></label>
          <textarea id={`up-desc-${upsell.id}`} rows={2} maxLength={500} value={upsell.description || ''} onChange={(e) => patch({ description: e.target.value })} />
        </div>

        <div className="row2">
          <Input label={`Price (${symbol})`} type="number" min={0} value={original} onChange={(e) => setPricing(Number(e.target.value), type, value)} />
          <div className="row2">
            <Select label="Discount" value={type} onChange={(e) => setPricing(original, e.target.value as DiscountType, value)}>
              <option value="none">None</option>
              <option value="fixed">{symbol} off</option>
              <option value="percentage">% off</option>
            </Select>
            {type !== 'none' && (
              <Input label="Amount" type="number" min={0} value={value} onChange={(e) => setPricing(original, type, Number(e.target.value))} />
            )}
          </div>
        </div>
        <p className="hint">Final price: <b>{formatCurrency(upsell.price, ctx.currency)}</b></p>

        <div className="upimg">
          {image && <img src={image} alt="" />}
          <input ref={fileRef} type="file" hidden accept={IMAGE_RULE.types.join(',')} aria-label={`Image for ${label}`} onChange={pickFile} />
          <Button size="mini" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> {image ? 'Change image' : 'Add image'}
          </Button>
          {image && (
            <Button size="mini" aria-label={`Remove image from ${label}`} onClick={() => ctx.handleRemoveUpsellImage(upsell.id)}>
              <X size={14} /> Remove
            </Button>
          )}
          <span className="hint">JPG, PNG, WebP or GIF, up to 5 MB.</span>
        </div>
        {fileError && <p className="err">{fileError}</p>}

        <label className="regions" style={{ display: 'block', margin: 0 }}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 13 }}>
            <input type="checkbox" checked={upsell.isPopular} onChange={(e) => patch({ isPopular: e.target.checked })} />
            Mark as popular
          </span>
        </label>

        {hint && <p className="hint" data-testid="upsell-hint">{hint}</p>}
      </div>
    </div>
  );
};

/** Upsells tab (M3b-T12, F-415): add-ons the customer can tick before they place the order. */
export const UpsellsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const stats = ctx.upsellStats;

  return (
    <div className="stack">
      <div className="paneh">
        <h3>Upsells</h3>
        <p>Add-ons the customer can tick before they place the order.</p>
      </div>
      <div>
        {ctx.upsells.map((u) => <UpsellCard key={u.id} upsell={u} stats={stats} />)}
        {ctx.upsells.length === 0 && <p className="hint">No upsells added yet.</p>}
      </div>
      <div>
        <Button onClick={ctx.addUpsell}>
          <Plus />
          Add upsell
        </Button>
      </div>
    </div>
  );
};
