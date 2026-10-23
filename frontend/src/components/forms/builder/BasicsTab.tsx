import React from 'react';
import { Input, Select } from '../../ui-v2';
import { domainLineErrors, thankYouError } from '../../../lib/checkoutBasics';
import { publicOrigin } from '../../../lib/embedSnippet';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';

const FORM_TYPE_LINE = {
  physical: 'Physical product (delivered)',
  digital: 'Digital product (download link)',
} as const;

/**
 * Basics tab (M3b-T11, F-411, F-422): name, product, link, description, country and type (read-only), thank-you page and
 * allowed domains. Country comes from the store; the form type follows the product and the server sets it.
 */
export const BasicsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const name = ctx.watch('name');
  const slug = ctx.watch('slug');
  const productId = Number(ctx.watch('productId')) || 0;
  const redirectUrl = ctx.watch('redirectUrl');
  const allowedOrigins = ctx.watch('allowedOrigins');

  // Active products only; a saved form keeps showing its own product even if that one was switched off since.
  const products = ctx.products.filter((p) => p.isActive || p.id === productId || p.id === ctx.originalProductId);
  const chosen = ctx.products.find((p) => p.id === productId);
  const productChanged = ctx.isEditing && ctx.hasOrders && ctx.originalProductId !== null && productId !== ctx.originalProductId;

  const nameError = ctx.showErrors && !name.trim() ? 'Give the form a name.' : undefined;
  const productError = ctx.showErrors && !productId ? 'Choose the product this form sells.' : undefined;
  const thankYou = thankYouError(redirectUrl ?? '');
  const badDomains = domainLineErrors(allowedOrigins ?? '');

  return (
    <div className="stack">
      <div className="paneh">
        <h3>Basics</h3>
        <p>Name the form and say which product it sells.</p>
      </div>

      <div className="row2">
        <Input
          label="Form name"
          value={name}
          onChange={(e) => ctx.setValue('name', e.target.value)}
          placeholder="e.g. Summer sale checkout"
          error={nameError}
        />
        <div>
          <Select
            label="Product"
            value={productId}
            onChange={(e) => ctx.setValue('productId', Number(e.target.value))}
            error={productError}
          >
            <option value={0}>Choose a product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.productType === 'digital' ? 'Digital' : 'Physical'})
              </option>
            ))}
          </Select>
          {productChanged && <p className="fnote">New orders use the new product. Past orders do not change.</p>}
        </div>
      </div>

      <Input
        label="Link"
        readOnly
        value={`${publicOrigin()}/form/${slug}`}
        hint={ctx.isEditing ? 'The link cannot change once the form is saved.' : 'Made from the form name when you save.'}
      />

      <div className="fl">
        <label htmlFor="cf-description">Description <span className="opt">(optional)</span></label>
        <textarea
          id="cf-description"
          rows={3}
          value={ctx.watch('description')}
          onChange={(e) => ctx.setValue('description', e.target.value)}
          placeholder="Shown at the top of the form."
        />
      </div>

      <div className="row2">
        <Input
          label="Country"
          readOnly
          value={`${ctx.country} (from your store)`}
          hint="Change it in Settings, Currencies & FX."
        />
        <Input label="Currency" readOnly value={ctx.currency} />
      </div>

      <div className="fl">
        <label>Form type</label>
        <p>{chosen ? FORM_TYPE_LINE[ctx.formType] : 'Choose a product to see the form type.'}</p>
      </div>

      <Input
        label="Thank-you page"
        optional
        value={redirectUrl ?? ''}
        onChange={(e) => ctx.setValue('redirectUrl', e.target.value)}
        placeholder="https://yourbrand.com/thank-you"
        hint="Empty shows the built-in thank-you screen."
        error={thankYou ?? undefined}
      />

      <div className="fl">
        <label htmlFor="cf-domains">Allowed domains <span className="opt">(optional)</span></label>
        <textarea
          id="cf-domains"
          rows={3}
          value={allowedOrigins ?? ''}
          onChange={(e) => ctx.setValue('allowedOrigins', e.target.value)}
          placeholder={'shop.yourbrand.com\nwww.yourbrand.com'}
          aria-invalid={badDomains.length > 0 ? true : undefined}
        />
        {badDomains.length > 0 ? (
          badDomains.map((d) => (
            <p key={d.line} className="err">Line {d.line}: {d.message}</p>
          ))
        ) : (
          <p className="hint">One per line. Empty means the form cannot be embedded on other sites.</p>
        )}
      </div>
    </div>
  );
};
