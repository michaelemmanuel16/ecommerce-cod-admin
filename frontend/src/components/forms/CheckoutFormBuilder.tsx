import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Tabs } from '../ui/Tabs';
import {
  CheckoutForm,
  CheckoutFormDesign,
  FieldType,
  FormField,
  ProductPackage,
  Upsell,
  PixelConfig,
} from '../../types/checkout-form';
import { Product } from '../../types';
import apiClient from '../../services/api';
import { getCurrencyForCountry, getRegionsForCountry } from '../../utils/countries';
import { CheckoutBuilderProvider } from './builder/CheckoutBuilderContext';
import {
  BuilderFormValues,
  CheckoutBuilderContextValue,
} from './builder/checkoutBuilderContextValue';
import { BasicsTab } from './builder/BasicsTab';
import { FieldsTab } from './builder/FieldsTab';
import { createFieldOfType } from './builder/fieldTypes';
import { PackagesTab } from './builder/PackagesTab';
import { UpsellsTab } from './builder/UpsellsTab';
import { SettingsTab } from './builder/SettingsTab';
import { DesignTab } from './builder/DesignTab';

export interface CheckoutFormBuilderHandle {
  submit: () => void;
}

interface CheckoutFormBuilderProps {
  onSave: (form: Partial<CheckoutForm>) => Promise<void> | void;
  initialData?: CheckoutForm;
  products: Product[];
  onDirtyChange?: (dirty: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  /**
   * Fires whenever the in-memory draft changes. Used by the editor page to
   * stream the current state into the live-preview iframe via postMessage.
   * Shape mirrors the public-checkout payload subset that the preview needs.
   */
  onDraftChange?: (draft: Record<string, any>) => void;
}

const defaultFields: FormField[] = [
  { id: '1', label: 'Full Name', type: 'text', required: true, enabled: true },
  { id: '2', label: 'Phone', type: 'phone', required: true, enabled: true },
  { id: '3', label: 'Alt Phone', type: 'phone', required: false, enabled: true },
  { id: '4', label: 'Street Address', type: 'textarea', required: true, enabled: true },
];

export const CheckoutFormBuilder = forwardRef<CheckoutFormBuilderHandle, CheckoutFormBuilderProps>(({
  onSave,
  initialData,
  products,
  onDirtyChange,
  onSubmittingChange,
  onDraftChange,
}, ref) => {
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<BuilderFormValues>({
    defaultValues: {
      name: initialData?.name || '',
      slug: initialData?.slug || '',
      productId: initialData?.productId || 0,
      description: initialData?.description || '',
      defaultCountry: initialData?.country || 'Ghana',
      buttonColor: initialData?.styling?.buttonColor || '#0f172a',
      accentColor: initialData?.styling?.accentColor || '#f97316',
      currency: initialData?.currency || 'GHS',
      redirectUrl: initialData?.redirectUrl || '',
    },
  });

  const [fields, setFields] = useState<FormField[]>(initialData?.fields || defaultFields);
  const [packages, setPackages] = useState<ProductPackage[]>(initialData?.packages || []);
  const [upsells, setUpsells] = useState<Upsell[]>(
    initialData?.upsells?.map((u) => ({ ...u, quantity: u.items?.quantity || 1 })) || []
  );
  const [upsellImages, setUpsellImages] = useState<Map<number, { file: File; preview: string }>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pixelConfig, setPixelConfig] = useState<PixelConfig>(initialData?.pixelConfig || {});
  const [design, setDesign] = useState<CheckoutFormDesign>(initialData?.design || {});
  const [currentRegions, setCurrentRegions] = useState<string[]>(
    getRegionsForCountry(initialData?.country || 'Ghana')
  );

  const initialDataId = initialData?.id;
  // Re-seed state if the parent swaps to a different form (rare in full-page mode, but covers it)
  useEffect(() => {
    if (initialData) {
      reset({
        name: initialData.name || '',
        slug: initialData.slug || '',
        productId: initialData.productId || 0,
        description: initialData.description || '',
        defaultCountry: initialData.country || 'Ghana',
        buttonColor: initialData.styling?.buttonColor || '#0f172a',
        accentColor: initialData.styling?.accentColor || '#f97316',
        currency: initialData.currency || 'GHS',
        redirectUrl: initialData.redirectUrl || '',
      });
      setFields(initialData.fields || defaultFields);
      setPackages(initialData.packages || []);
      setUpsells(initialData.upsells?.map((u) => ({ ...u, quantity: u.items?.quantity || 1 })) || []);
      setPixelConfig(initialData.pixelConfig || {});
      setDesign(initialData.design || {});
    }
  }, [initialDataId, reset]);

  // Auto-generate slug from name (create mode only)
  const nameValue = watch('name');
  useEffect(() => {
    if (nameValue && !initialData) {
      const slug = nameValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      setValue('slug', slug);
    }
  }, [nameValue, setValue, initialData]);

  // Auto-set currency + regions when country changes
  const countryValue = watch('defaultCountry');
  useEffect(() => {
    if (countryValue) {
      setValue('currency', getCurrencyForCountry(countryValue as any));
      setCurrentRegions(getRegionsForCountry(countryValue));
    }
  }, [countryValue, setValue]);

  // Cleanup preview URLs on unmount. Mirror the live Map into a ref so the
  // unmount cleanup sees the latest set, not the empty mount-time snapshot.
  const upsellImagesRef = useRef(upsellImages);
  upsellImagesRef.current = upsellImages;
  useEffect(() => {
    return () => {
      upsellImagesRef.current.forEach(({ preview }) => preview && URL.revokeObjectURL(preview));
    };
  }, []);

  // Dirty tracking — flip to true on the first state change after mount.
  // We can't depend on `watch()` because it returns a new object identity on
  // every render (even with no value change), which would fire this effect
  // and spuriously mark the form dirty on any parent re-render. Instead we
  // serialise the draft and compare against the previous snapshot.
  const name = watch('name');
  const description = watch('description');
  const currency = watch('currency');
  const defaultCountry = watch('defaultCountry');
  const productIdValue = watch('productId');
  // Resolved product details so the live preview can render the product hero
  // from the draft alone — needed in create mode, where no saved form exists
  // yet to fetch the product from.
  const previewProduct = React.useMemo(() => {
    const p = products.find((x) => x.id === Number(productIdValue));
    if (!p) return undefined;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      imageUrl: p.imageUrl,
      isActive: p.isActive,
      productType: p.productType,
    };
  }, [products, productIdValue]);
  const draftPayload = React.useMemo(
    () => ({
      name,
      description,
      currency,
      country: defaultCountry,
      productId: Number(productIdValue) || 0,
      product: previewProduct,
      fields,
      // Streamed so the State field's dropdown updates live when the country changes.
      regions: { available: currentRegions },
      packages,
      upsells,
      design,
      pixelConfig,
    }),
    [name, description, currency, defaultCountry, productIdValue, previewProduct, fields, currentRegions, packages, upsells, design, pixelConfig]
  );
  const hasMountedRef = useRef(false);
  const lastSnapshotRef = useRef<string>('');
  useEffect(() => {
    const snapshot = JSON.stringify(draftPayload);
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      lastSnapshotRef.current = snapshot;
      onDraftChange?.(draftPayload);
      return;
    }
    if (snapshot === lastSnapshotRef.current) return;
    lastSnapshotRef.current = snapshot;
    onDirtyChange?.(true);
    onDraftChange?.(draftPayload);
  }, [draftPayload, onDirtyChange, onDraftChange]);

  // Field actions
  const handleFieldDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFields((prev) => {
        const oldIndex = prev.findIndex((f) => f.id === active.id);
        const newIndex = prev.findIndex((f) => f.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };
  const addField = (type: FieldType) =>
    setFields([...fields, createFieldOfType(type)]);
  const updateField = (id: string, updated: FormField) =>
    setFields(fields.map((f) => (f.id === id ? updated : f)));
  const deleteField = (id: string) => setFields(fields.filter((f) => f.id !== id));

  // Package actions
  const addPackage = () => {
    const selectedProductId = watch('productId');
    const selectedProduct = products.find((p) => p.id === Number(selectedProductId));
    const productPrice = selectedProduct?.price || 0;
    setPackages([
      ...packages,
      {
        id: -Date.now(),
        name: '',
        price: productPrice,
        quantity: 1,
        discountType: 'none',
        discountValue: 0,
        originalPrice: productPrice,
        productPrice,
        isPopular: false,
        isDefault: false,
        showHighlight: false,
        highlightText: '',
        showDiscount: true,
      },
    ]);
  };
  const updatePackage = (id: number, updated: ProductPackage) => {
    if (updated.isDefault) {
      setPackages(packages.map((p) => (p.id === id ? updated : { ...p, isDefault: false })));
    } else {
      setPackages(packages.map((p) => (p.id === id ? updated : p)));
    }
  };
  const deletePackage = (id: number) => setPackages(packages.filter((p) => p.id !== id));

  // Upsell actions
  const addUpsell = () =>
    setUpsells([
      ...upsells,
      { id: -Date.now(), name: '', price: 0, quantity: 1, isPopular: false },
    ]);
  const updateUpsell = (id: number, updated: Upsell) =>
    setUpsells(upsells.map((u) => (u.id === id ? updated : u)));
  const deleteUpsell = (id: number) => {
    const imageData = upsellImages.get(id);
    if (imageData?.preview) URL.revokeObjectURL(imageData.preview);
    setUpsellImages((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setUpsells(upsells.filter((u) => u.id !== id));
  };
  const handleUpsellImageSelect = (upsellId: number, file: File | null) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    const existing = upsellImages.get(upsellId);
    if (existing?.preview) URL.revokeObjectURL(existing.preview);
    setUpsellImages((prev) => {
      const next = new Map(prev);
      next.set(upsellId, { file, preview });
      return next;
    });
  };
  const handleRemoveUpsellImage = (upsellId: number) => {
    const imageData = upsellImages.get(upsellId);
    if (imageData?.preview) URL.revokeObjectURL(imageData.preview);
    setUpsellImages((prev) => {
      const next = new Map(prev);
      next.delete(upsellId);
      return next;
    });
    const upsell = upsells.find((u) => u.id === upsellId);
    if (upsell) updateUpsell(upsellId, { ...upsell, imageUrl: undefined });
  };

  const onSubmit = async (data: BuilderFormValues) => {
    if (!data.productId || data.productId === 0) {
      alert('Please select a product for this checkout form.');
      return;
    }
    if (packages.length === 0) {
      alert('Please add at least one package. Packages define what products/quantities customers can purchase.');
      return;
    }

    setIsSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const uploadedUpsells = await Promise.all(
        upsells.map(async (upsell) => {
          const imageData = upsellImages.get(upsell.id);
          if (imageData?.file) {
            const formData = new FormData();
            formData.append('image', imageData.file);
            try {
              const response = await apiClient.post('/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
              });
              return {
                productId: upsell.productId,
                name: upsell.name,
                description: upsell.description,
                imageUrl: response.data.imageUrl,
                price: upsell.price,
                discountType: upsell.discountType || 'none',
                discountValue: upsell.discountValue || 0,
                originalPrice: upsell.originalPrice || upsell.price,
                items: { quantity: upsell.quantity },
              };
            } catch (error) {
              console.error('Failed to upload image for upsell:', upsell.name, error);
              alert(`Failed to upload image for "${upsell.name}". Please try again.`);
              throw error;
            }
          }
          return {
            productId: upsell.productId,
            name: upsell.name,
            description: upsell.description,
            imageUrl: upsell.imageUrl,
            price: upsell.price,
            discountType: upsell.discountType || 'none',
            discountValue: upsell.discountValue || 0,
            originalPrice: upsell.originalPrice || upsell.price,
            items: { quantity: upsell.quantity },
          };
        })
      );

      const formData: any = {
        name: data.name,
        slug: data.slug,
        productId: data.productId,
        description: data.description || '',
        fields,
        country: data.defaultCountry,
        currency: data.currency || getCurrencyForCountry(data.defaultCountry as any),
        regions: { available: currentRegions },
        packages: packages.map((pkg) => ({
          name: pkg.name,
          description: '',
          price: pkg.price,
          quantity: pkg.quantity,
          discountType: pkg.discountType || 'none',
          discountValue: pkg.discountValue || 0,
          originalPrice: pkg.originalPrice || pkg.price,
          isPopular: pkg.isPopular || false,
          isDefault: pkg.isDefault || false,
          showHighlight: pkg.showHighlight || false,
          highlightText: pkg.highlightText || null,
          showDiscount: pkg.showDiscount !== false,
        })),
        upsells: uploadedUpsells,
        // Styling mirrored from design.colors for backward-compat with the styling column
        // (not-null in schema). Phase 1 dropped styling from the public render path; this
        // keeps writes valid until the column is dropped in a follow-up migration.
        styling: {
          buttonColor: design.colors?.cta || data.buttonColor || '#0f172a',
          accentColor: design.colors?.surface || data.accentColor || '#f97316',
        },
        design,
        pixelConfig: Object.values(pixelConfig).some((v) => v) ? pixelConfig : null,
        redirectUrl: data.redirectUrl?.trim() || null,
      };

      await onSave(formData);
      // Only revoke/clear after a successful save so a failed save can be
      // retried without re-uploading the images.
      upsellImages.forEach(({ preview }) => preview && URL.revokeObjectURL(preview));
      setUpsellImages(new Map());
      onDirtyChange?.(false);
      toast.success(initialData ? 'Checkout form saved' : 'Checkout form created');
    } catch (error) {
      console.error('Failed to save checkout form:', error);
      toast.error('Failed to save checkout form. Please try again.');
    } finally {
      setIsSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  useImperativeHandle(ref, () => ({
    submit: () => handleSubmit(onSubmit)(),
  }));

  const ctx: CheckoutBuilderContextValue = {
    register,
    watch,
    setValue,
    errors,
    fields,
    setFields,
    packages,
    setPackages,
    upsells,
    setUpsells,
    upsellImages,
    setUpsellImages,
    pixelConfig,
    setPixelConfig,
    design,
    setDesign,
    products,
    addField,
    updateField,
    deleteField,
    handleFieldDragEnd,
    addPackage,
    updatePackage,
    deletePackage,
    addUpsell,
    updateUpsell,
    deleteUpsell,
    handleUpsellImageSelect,
    handleRemoveUpsellImage,
  };

  return (
    <CheckoutBuilderProvider value={ctx}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4"
        aria-busy={isSubmitting}
      >
        <Tabs
          tabs={[
            { id: 'basics', label: 'Basics', content: <BasicsTab /> },
            {
              id: 'fields',
              label: (
                <>
                  Fields{' '}
                  {fields.length > 0 && (
                    <span className="ml-1 text-xs bg-gray-200 rounded-full px-2">{fields.length}</span>
                  )}
                </>
              ),
              content: <FieldsTab />,
            },
            {
              id: 'packages',
              label: (
                <>
                  Packages{' '}
                  {packages.length > 0 && (
                    <span className="ml-1 text-xs bg-gray-200 rounded-full px-2">{packages.length}</span>
                  )}
                </>
              ),
              content: <PackagesTab />,
            },
            {
              id: 'upsells',
              label: (
                <>
                  Upsells{' '}
                  {upsells.length > 0 && (
                    <span className="ml-1 text-xs bg-gray-200 rounded-full px-2">{upsells.length}</span>
                  )}
                </>
              ),
              content: <UpsellsTab />,
            },
            {
              id: 'design',
              label: 'Design',
              content: <DesignTab />,
            },
            { id: 'settings', label: 'Settings', content: <SettingsTab /> },
          ]}
          defaultTab="basics"
        />
      </form>
    </CheckoutBuilderProvider>
  );
});

CheckoutFormBuilder.displayName = 'CheckoutFormBuilder';
