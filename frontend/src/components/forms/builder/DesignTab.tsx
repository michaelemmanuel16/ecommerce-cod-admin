import React, { useEffect, useState } from 'react';
import { Check, Pipette } from 'lucide-react';
import { Input } from '../../ui/Input';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { BRAND_PALETTE, isValidHex } from '../../../lib/checkoutPalette';
import { CheckoutFormDesign } from '../../../types/checkout-form';

const ColorField: React.FC<{
  label: string;
  value: string | undefined;
  onChange: (hex: string) => void;
}> = ({ label, value, onChange }) => {
  const normalized = value?.toLowerCase();
  const isPreset = BRAND_PALETTE.some((s) => s.hex.toLowerCase() === normalized);
  const customActive = !!value && !isPreset;
  const pickerValue = value && isValidHex(value) ? value : BRAND_PALETTE[0].hex;

  // Local draft so the user can type a partial hex without it being committed
  // (and rejected) on every keystroke. Commit only valid 7-char hex values.
  const [hexDraft, setHexDraft] = useState(value || '');
  useEffect(() => {
    setHexDraft(value || '');
  }, [value]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="grid grid-cols-6 gap-2">
        {BRAND_PALETTE.map((swatch) => {
          const selected = normalized === swatch.hex.toLowerCase();
          return (
            <button
              key={swatch.hex}
              type="button"
              onClick={() => onChange(swatch.hex)}
              aria-label={swatch.name}
              title={swatch.name}
              className={`relative h-9 rounded-md border ${
                selected ? 'ring-2 ring-offset-1 ring-gray-900 border-transparent' : 'border-gray-200'
              }`}
              style={{ backgroundColor: swatch.hex }}
            >
              {selected && (
                <Check className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow" />
              )}
            </button>
          );
        })}
        {/* 6th cell: hex colour picker for any colour outside the presets */}
        <label
          title="Custom colour"
          className={`relative h-9 rounded-md border cursor-pointer flex items-center justify-center ${
            customActive ? 'ring-2 ring-offset-1 ring-gray-900 border-transparent' : 'border-gray-200 bg-white'
          }`}
          style={customActive ? { backgroundColor: value } : undefined}
        >
          <Pipette className={`w-4 h-4 ${customActive ? 'text-white drop-shadow' : 'text-gray-500'}`} />
          <input
            type="color"
            aria-label={`${label} custom colour`}
            value={pickerValue}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-gray-500">Hex</span>
        <Input
          value={hexDraft}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const next = raw === '' || raw.startsWith('#') ? raw : `#${raw}`;
            setHexDraft(next);
            if (next === '' || isValidHex(next)) onChange(next);
          }}
          placeholder="#0f172a"
          maxLength={7}
          className="h-8 w-28 font-mono text-sm"
        />
      </div>
    </div>
  );
};

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

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">{children}</div>
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

  const labelOverLimit = (design.button?.label?.length ?? 0) > 60;

  return (
    <div className="space-y-6">
      <Section title="Colors">
        <ColorField
          label="Primary"
          value={design.colors?.primary}
          onChange={(hex) => updateColors('primary', hex)}
        />
        <ColorField
          label="CTA / Button"
          value={design.colors?.cta}
          onChange={(hex) => updateColors('cta', hex)}
        />
        <ColorField
          label="Surface / Accent"
          value={design.colors?.surface}
          onChange={(hex) => updateColors('surface', hex)}
        />
        <ColorField
          label="Text"
          value={design.colors?.text}
          onChange={(hex) => updateColors('text', hex)}
        />
      </Section>

      <Section title="Button">
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
      </Section>

      <Section title="Inputs">
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
      </Section>

      <Section title="Layout">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={design.page?.hideProductDisplay || false}
            onChange={(e) => updatePage({ hideProductDisplay: e.target.checked || undefined })}
            className="rounded border-gray-300"
          />
          Hide product name + description on checkout
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={design.page?.showOrderSummary !== false}
            onChange={(e) => updatePage({ showOrderSummary: e.target.checked ? undefined : false })}
            className="rounded border-gray-300"
          />
          Show order summary (price breakdown + total)
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
      </Section>
    </div>
  );
};
