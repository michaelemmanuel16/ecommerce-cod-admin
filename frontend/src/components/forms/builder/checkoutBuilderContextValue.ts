import React, { createContext, useContext } from 'react';
import { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { CheckoutFormDesign, FieldType, FormField, ProductPackage, Upsell, PixelConfig } from '../../../types/checkout-form';
import { Product } from '../../../types';

export interface BuilderFormValues {
  name: string;
  slug: string;
  productId: number;
  description: string;
  defaultCountry: string;
  buttonColor: string;
  accentColor: string;
  currency: string;
  redirectUrl: string;
  allowedOrigins: string; // newline-separated origins; split to string[] on save
  codEnabled: boolean;
  paystackDepositEnabled: boolean;
  paystackFullEnabled: boolean;
  depositPercent: number;
  metaCapiAccessToken: string;
  metaCapiTestEventCode: string;
}

export interface CheckoutBuilderContextValue {
  register: UseFormRegister<BuilderFormValues>;
  watch: UseFormWatch<BuilderFormValues>;
  setValue: UseFormSetValue<BuilderFormValues>;
  errors: FieldErrors<BuilderFormValues>;

  fields: FormField[];
  setFields: React.Dispatch<React.SetStateAction<FormField[]>>;

  packages: ProductPackage[];
  setPackages: React.Dispatch<React.SetStateAction<ProductPackage[]>>;

  upsells: Upsell[];
  setUpsells: React.Dispatch<React.SetStateAction<Upsell[]>>;

  upsellImages: Map<number, { file: File; preview: string }>;
  setUpsellImages: React.Dispatch<React.SetStateAction<Map<number, { file: File; preview: string }>>>;

  pixelConfig: PixelConfig;
  setPixelConfig: React.Dispatch<React.SetStateAction<PixelConfig>>;

  design: CheckoutFormDesign;
  setDesign: React.Dispatch<React.SetStateAction<CheckoutFormDesign>>;

  products: Product[];

  addField: (type: FieldType) => void;
  updateField: (id: string, updated: FormField) => void;
  deleteField: (id: string) => void;
  handleFieldDragEnd: (event: any) => void;

  addPackage: () => void;
  updatePackage: (id: number, updated: ProductPackage) => void;
  deletePackage: (id: number) => void;

  addUpsell: () => void;
  updateUpsell: (id: number, updated: Upsell) => void;
  deleteUpsell: (id: number) => void;
  handleUpsellImageSelect: (upsellId: number, file: File | null) => void;
  handleRemoveUpsellImage: (upsellId: number) => void;
}

export const CheckoutBuilderContext = createContext<CheckoutBuilderContextValue | null>(null);

export function useCheckoutBuilder(): CheckoutBuilderContextValue {
  const ctx = useContext(CheckoutBuilderContext);
  if (!ctx) throw new Error('useCheckoutBuilder must be used inside CheckoutBuilderProvider');
  return ctx;
}
