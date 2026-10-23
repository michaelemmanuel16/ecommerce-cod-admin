import React, { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Pipette, X } from 'lucide-react';
import { Button, Input } from '../../ui-v2';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { BRAND_PALETTE, isValidHex } from '../../../lib/checkoutPalette';
import { buttonContrastLow, DEFAULT_BUTTON_COLOR } from '../../../lib/contrast';
import { checkoutFormsService } from '../../../services/checkout-forms.service';
import { apiErrorMessage } from '../../../utils/apiError';
import { CheckoutFormDesign } from '../../../types/checkout-form';

const BANNER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const BANNER_MAX_BYTES = 1024 * 1024;
const BANNER_RULE = 'Use a JPEG, PNG or WebP image up to 1 MB.';

const ColorField: React.FC<{
  label: string;
  value: string | undefined;
  onChange: (hex: string) => void;
}> = ({ label, value, onChange }) => {
  const normalized = value?.toLowerCase();
  const isPreset = BRAND_PALETTE.some((s) => s.hex.toLowerCase() === normalized);
  const customActive = !!value && !isPreset;
  const pickerValue = value && isValidHex(value) ? value : BRAND_PALETTE[0].hex;

  // Local draft so a partial hex can be typed without being committed (and rejected) on every keystroke.
  const [hexDraft, setHexDraft] = useState(value || '');
  useEffect(() => {
    setHexDraft(value || '');
  }, [value]);

  return (
    <div className="fl">
      <label>{label}</label>
      <div className="swatches">
        {BRAND_PALETTE.map((swatch) => {
          const selected = normalized === swatch.hex.toLowerCase();
          return (
            <button
              key={swatch.hex}
              type="button"
              className={selected ? 'on' : undefined}
              onClick={() => onChange(swatch.hex)}
              aria-label={swatch.name}
              aria-pressed={selected}
              title={swatch.name}
              style={{ backgroundColor: swatch.hex }}
            >
              {selected && <Check />}
            </button>
          );
        })}
        <span className={`custom${customActive ? ' on' : ''}`} title="Custom colour" style={customActive ? { backgroundColor: value } : undefined}>
          <Pipette />
          <input type="color" aria-label={`${label} custom colour`} value={pickerValue} onChange={(e) => onChange(e.target.value)} />
        </span>
      </div>
      <div className="hexrow">
        <span className="hint" style={{ margin: 0 }}>Hex</span>
        <input
          className="cin"
          aria-label={`${label} hex`}
          value={hexDraft}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const next = raw === '' || raw.startsWith('#') ? raw : `#${raw}`;
            setHexDraft(next);
            if (next === '' || isValidHex(next)) onChange(next);
          }}
          placeholder={DEFAULT_BUTTON_COLOR}
          maxLength={7}
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
  <div className="fl">
    <label>{label}</label>
    <div className="seg">
      {options.map((opt) => (
        <button key={opt.value} type="button" className={value === opt.value ? 'on' : undefined} aria-pressed={value === opt.value} onClick={() => onSelect(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="paneh">
      <h3 style={{ fontSize: 15 }}>{title}</h3>
    </div>
    <div className="stack">{children}</div>
  </div>
);

export const DesignTab: React.FC = () => {
  const { design, setDesign } = useCheckoutBuilder();
  const bannerInput = useRef<HTMLInputElement>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const updateSection = <K extends keyof CheckoutFormDesign>(
    key: K,
    patch: Partial<NonNullable<CheckoutFormDesign[K]>>
  ) => {
    setDesign((d) => ({
      ...d,
      [key]: { ...((d[key] as object) || {}), ...patch } as CheckoutFormDesign[K],
    }));
  };
  // An emptied colour is dropped, so the public form falls back to its default.
  const colour = (hex: string): string | undefined => hex || undefined;
  const updateColors = (key: 'primary' | 'cta' | 'surface' | 'text', hex: string) =>
    updateSection('colors', { [key]: colour(hex) } as Partial<NonNullable<CheckoutFormDesign['colors']>>);
  const updateButton = (patch: Partial<NonNullable<CheckoutFormDesign['button']>>) =>
    updateSection('button', patch);
  const updateInput = (patch: Partial<NonNullable<CheckoutFormDesign['input']>>) =>
    updateSection('input', patch);
  const updatePage = (patch: Partial<NonNullable<CheckoutFormDesign['page']>>) =>
    updateSection('page', patch);

  const labelOverLimit = (design.button?.label?.length ?? 0) > 60;
  const lowContrast = buttonContrastLow(design.colors?.cta || DEFAULT_BUTTON_COLOR);

  const pickBanner = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!BANNER_TYPES.includes(file.type) || file.size > BANNER_MAX_BYTES) {
      setBannerError(BANNER_RULE);
      return;
    }
    setBannerError(null);
    setUploading(true);
    try {
      updatePage({ productBanner: await checkoutFormsService.uploadImage(file) });
    } catch (err) {
      setBannerError(apiErrorMessage(err, 'The banner could not be uploaded. Try again.'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="stack">
      <div className="paneh">
        <h3>Design</h3>
        <p>Colours and button for the customer page.</p>
      </div>

      <Section title="Colors">
        <ColorField label="Primary" value={design.colors?.primary} onChange={(hex) => updateColors('primary', hex)} />
        <ColorField label="CTA / Button" value={design.colors?.cta} onChange={(hex) => updateColors('cta', hex)} />
        {lowContrast && <p className="banner-note warn" role="alert">Button text may be hard to read on this colour.</p>}
        <ColorField label="Surface / Accent" value={design.colors?.surface} onChange={(hex) => updateColors('surface', hex)} />
        <ColorField label="Text" value={design.colors?.text} onChange={(hex) => updateColors('text', hex)} />
        <ColorField label="Label colour" value={design.input?.labelColor} onChange={(hex) => updateInput({ labelColor: colour(hex) })} />
        <ColorField label="Price colour" value={design.input?.priceColor} onChange={(hex) => updateInput({ priceColor: colour(hex) })} />
        <ColorField label="Page background" value={design.page?.background} onChange={(hex) => updatePage({ background: colour(hex) })} />
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
        <Input
          label="Label override"
          optional
          value={design.button?.label || ''}
          onChange={(e) => updateButton({ label: e.target.value || undefined })}
          maxLength={60}
          placeholder="e.g., Place Order"
          hint="Up to 60 characters."
          error={labelOverLimit ? 'Label must be 60 characters or fewer.' : undefined}
        />
      </Section>

      <Section title="Fields">
        <PillGroup
          label="Field style"
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
        <label className="regions" style={{ display: 'block', margin: 0 }}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={design.page?.hideProductDisplay || false}
              onChange={(e) => updatePage({ hideProductDisplay: e.target.checked || undefined })}
            />
            Hide product name + description on checkout
          </span>
        </label>
        <label className="regions" style={{ display: 'block', margin: 0 }}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={design.page?.showOrderSummary !== false}
              onChange={(e) => updatePage({ showOrderSummary: e.target.checked ? undefined : false })}
            />
            Show order summary (price breakdown + total)
          </span>
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
        <div className="fl">
          <label>Product banner</label>
          <div className="bannerbox">
            {design.page?.productBanner && <img src={design.page.productBanner} alt="Product banner" />}
            <input ref={bannerInput} type="file" hidden accept={BANNER_TYPES.join(',')} aria-label="Product banner file" onChange={pickBanner} />
            <Button disabled={uploading} onClick={() => bannerInput.current?.click()}>
              <ImagePlus /> {uploading ? 'Uploading…' : design.page?.productBanner ? 'Change banner' : 'Upload banner'}
            </Button>
            {design.page?.productBanner && (
              <Button onClick={() => updatePage({ productBanner: undefined })}>
                <X /> Remove banner
              </Button>
            )}
          </div>
          {bannerError ? <p className="err" role="alert">{bannerError}</p> : <p className="hint">Shown above the form. JPEG, PNG or WebP, up to 1 MB.</p>}
        </div>
      </Section>
    </div>
  );
};
