import React from 'react';
import { Input } from '../../ui/Input';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { BRAND_PALETTE } from '../../../lib/checkoutPalette';
import { CheckoutFormDesign } from '../../../types/checkout-form';

type SwatchTarget = 'primary' | 'cta' | 'surface' | 'text' | 'background';

const SwatchGrid: React.FC<{
  label: string;
  selected: string | undefined;
  onSelect: (hex: string) => void;
  includeTransparent?: boolean;
}> = ({ label, selected, onSelect, includeTransparent }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
    <div className="grid grid-cols-6 gap-2">
      {includeTransparent && (
        <button
          type="button"
          onClick={() => onSelect('transparent')}
          aria-label="Transparent"
          className={`h-9 rounded border-2 bg-white bg-[linear-gradient(45deg,#ddd_25%,transparent_25%,transparent_75%,#ddd_75%),linear-gradient(45deg,#ddd_25%,transparent_25%,transparent_75%,#ddd_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px] ${
            selected === 'transparent' ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
          }`}
        />
      )}
      {BRAND_PALETTE.map((swatch) => (
        <button
          key={swatch.hex}
          type="button"
          onClick={() => onSelect(swatch.hex)}
          aria-label={swatch.name}
          title={swatch.name}
          className={`h-9 rounded border-2 ${
            selected === swatch.hex ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
          }`}
          style={{ backgroundColor: swatch.hex }}
        />
      ))}
    </div>
  </div>
);

const PillGroup = <T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onSelect: (v: T) => void;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          className={`px-3 py-1.5 text-sm rounded ${
            value === opt.value ? 'bg-white shadow-sm font-medium' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

export const DesignTab: React.FC = () => {
  const { design, setDesign } = useCheckoutBuilder();

  const updateSection = <K extends keyof CheckoutFormDesign>(
    key: K,
    patch: Partial<NonNullable<CheckoutFormDesign[K]>>
  ) => {
    setDesign((d) => ({
      ...d,
      [key]: { ...((d[key] as object) || {}), ...patch } as CheckoutFormDesign[K],
    }));
  };
  const updateColors = (key: 'primary' | 'cta' | 'surface' | 'text', hex: string) =>
    updateSection('colors', { [key]: hex } as Partial<NonNullable<CheckoutFormDesign['colors']>>);
  const updateButton = (patch: Partial<NonNullable<CheckoutFormDesign['button']>>) =>
    updateSection('button', patch);
  const updateInput = (patch: Partial<NonNullable<CheckoutFormDesign['input']>>) =>
    updateSection('input', patch);
  const updatePage = (patch: Partial<NonNullable<CheckoutFormDesign['page']>>) =>
    updateSection('page', patch);

  const bannerInvalid =
    !!design.page?.productBanner && !design.page.productBanner.startsWith('https://');
  const labelOverLimit = (design.button?.label?.length ?? 0) > 60;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Colors</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
          <SwatchGrid
            label="Primary"
            selected={design.colors?.primary}
            onSelect={(hex) => updateColors('primary', hex)}
          />
          <SwatchGrid
            label="CTA / Button"
            selected={design.colors?.cta}
            onSelect={(hex) => updateColors('cta', hex)}
          />
          <SwatchGrid
            label="Surface / Accent"
            selected={design.colors?.surface}
            onSelect={(hex) => updateColors('surface', hex)}
          />
          <SwatchGrid
            label="Text"
            selected={design.colors?.text}
            onSelect={(hex) => updateColors('text', hex)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Button</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
          <PillGroup
            label="Shape"
            value={design.button?.shape}
            options={[
              { value: 'square', label: 'Square' },
              { value: 'rounded', label: 'Rounded' },
              { value: 'pill', label: 'Pill' },
            ]}
            onSelect={(shape) => updateButton({ shape })}
          />
          <PillGroup
            label="Size"
            value={design.button?.size}
            options={[
              { value: 'sm', label: 'S' },
              { value: 'md', label: 'M' },
              { value: 'lg', label: 'L' },
            ]}
            onSelect={(size) => updateButton({ size })}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Label override <span className="text-gray-400">(max 60 chars)</span>
            </label>
            <Input
              value={design.button?.label || ''}
              onChange={(e) => updateButton({ label: e.target.value || undefined })}
              maxLength={60}
              placeholder="e.g., Place Order"
            />
            {labelOverLimit && (
              <p className="text-xs text-red-500 mt-1">Label must be 60 characters or fewer.</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Inputs</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
          <PillGroup
            label="Style"
            value={design.input?.style}
            options={[
              { value: 'flat', label: 'Flat' },
              { value: 'outlined', label: 'Outlined' },
              { value: 'filled', label: 'Filled' },
            ]}
            onSelect={(style) => updateInput({ style })}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Page</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
          <SwatchGrid
            label="Background"
            includeTransparent
            selected={design.page?.background}
            onSelect={(hex) => updatePage({ background: hex })}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Product banner URL <span className="text-gray-400">(https://...)</span>
            </label>
            <Input
              value={design.page?.productBanner || ''}
              onChange={(e) => updatePage({ productBanner: e.target.value || undefined })}
              placeholder="https://cdn.example.com/banner.png"
              maxLength={500}
            />
            {bannerInvalid && (
              <p className="text-xs text-red-500 mt-1">Banner URL must start with https://</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={design.page?.hideProductDisplay || false}
              onChange={(e) => updatePage({ hideProductDisplay: e.target.checked || undefined })}
              className="rounded border-gray-300"
            />
            Hide product name + description on checkout
          </label>
          <PillGroup
            label="Offer position"
            value={design.page?.offerPosition}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' },
            ]}
            onSelect={(offerPosition) => updatePage({ offerPosition })}
          />
        </div>
      </div>
    </div>
  );
};
