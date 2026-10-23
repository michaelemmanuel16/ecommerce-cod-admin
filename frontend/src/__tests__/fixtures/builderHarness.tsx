import React, { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  BuilderFormValues,
  CheckoutBuilderContext,
  CheckoutBuilderContextValue,
} from '../../components/forms/builder/checkoutBuilderContextValue';
import type { FormType, PixelConfig, ProductPackage, Upsell } from '../../types/checkout-form';

export interface HarnessOptions {
  formType?: FormType;
  currency?: string;
  productPrice?: number;
  packages?: ProductPackage[];
  upsells?: Upsell[];
  formId?: number | null;
  values?: Partial<BuilderFormValues>;
  ctx?: Partial<CheckoutBuilderContextValue>;
  pixelConfig?: PixelConfig;
}

const VALUES: BuilderFormValues = {
  name: 'Form', slug: 'form', productId: 1, description: '', buttonColor: '', accentColor: '', redirectUrl: '', allowedOrigins: '',
  codEnabled: true, paystackDepositEnabled: false, paystackFullEnabled: false, depositPercent: 50,
  metaCapiAccessToken: '', metaCapiTestEventCode: '',
};

/** Real react-hook-form and real state for packages, upsells and pixel ids; everything else is a plain default. */
export const BuilderHarness: React.FC<{ options?: HarnessOptions; children: React.ReactNode }> = ({ options = {}, children }) => {
  const form = useForm<BuilderFormValues>({ defaultValues: { ...VALUES, ...options.values } });
  const [packages, setPackages] = useState<ProductPackage[]>(options.packages ?? []);
  const [upsells, setUpsells] = useState<Upsell[]>(options.upsells ?? []);
  const [pixelConfig, setPixelConfig] = useState<PixelConfig>(options.pixelConfig ?? {});
  const [design, setDesign] = useState({});
  // Subscribes this component to every field, as the real builder does with watch().
  form.watch();
  const ctx = {
    register: form.register, watch: form.watch, setValue: form.setValue, errors: form.formState.errors,
    fields: [], setFields: () => undefined,
    packages, setPackages, upsells, setUpsells, upsellImages: new Map(), setUpsellImages: () => undefined,
    pixelConfig, setPixelConfig, design, setDesign, products: [],
    country: 'Ghana', currency: options.currency ?? 'GHS', formType: options.formType ?? 'physical',
    isEditing: options.formId != null, hasOrders: false, originalProductId: null,
    allRegions: [], regions: [], setRegions: () => undefined, showErrors: false,
    formId: options.formId ?? null, productPrice: options.productPrice ?? 249,
    paymentOptions: null, paymentOptionsFailed: false, capiTokenStored: false, savedCapi: { pixelId: '', testEventCode: '' },
    addField: () => undefined, updateField: () => undefined, deleteField: () => undefined, handleFieldDragEnd: () => undefined,
    addPackage: () => setPackages((p) => [...p, { id: -p.length - 1, name: '', price: 0, quantity: 1, isPopular: false, isDefault: p.length === 0 }]),
    updatePackage: (id, updated) =>
      setPackages((list) => list.map((p) => (p.id === id ? updated : updated.isDefault ? { ...p, isDefault: false } : p))),
    deletePackage: (id) => setPackages((list) => list.filter((p) => p.id !== id)),
    addUpsell: () => setUpsells((u) => [...u, { id: -u.length - 1, name: '', price: 0, quantity: 1, isPopular: false, isActive: true }]),
    updateUpsell: (id, updated) => setUpsells((list) => list.map((u) => (u.id === id ? updated : u))),
    deleteUpsell: (id) => setUpsells((list) => list.filter((u) => u.id !== id)),
    handleUpsellImageSelect: () => undefined, handleRemoveUpsellImage: () => undefined,
    ...options.ctx,
  } as CheckoutBuilderContextValue;
  return (
    <MemoryRouter>
      <CheckoutBuilderContext.Provider value={ctx}>
        {children}
        <pre data-testid="packages-snapshot">{JSON.stringify(packages)}</pre>
        <pre data-testid="values-snapshot">{JSON.stringify(form.getValues())}</pre>
      </CheckoutBuilderContext.Provider>
    </MemoryRouter>
  );
};
