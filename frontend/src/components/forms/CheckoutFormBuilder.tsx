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
  FormType,
  ProductPackage,
  Upsell,
  PixelConfig,
} from '../../types/checkout-form';
import { Product } from '../../types';
import { checkoutFormsService, type PaymentOptions } from '../../services/checkout-forms.service';
import { getCountryByCurrency, getRegionsForCountry } from '../../utils/countries';
import { slugFromName, validateBasics } from '../../lib/checkoutBasics';
import { missingKeysMessage } from '../../lib/standardFields';
import { packageIssue, withComputedPrices } from '../../lib/packagePricing';
import { effectiveToggles } from '../../lib/paymentMatrix';
import { CAPI_MASK, pixelConfigError } from '../../lib/trackingRules';
import { NEW_FORM_FIELDS } from '../../lib/defaultFields';
import { useConfigStore } from '../../stores/configStore';
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
import { PaymentTab } from './builder/PaymentTab';
import { TrackingTab } from './builder/TrackingTab';
import { DesignTab } from './builder/DesignTab';
import { getStoreCurrency } from '../../utils/format';

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

/** The regions a saved form offers: `regions.available`, or every region of its country when none are stored. */
const savedRegions = (form: CheckoutForm | undefined, all: string[]): string[] => {
  const stored = form?.regions as unknown;
  const list = Array.isArray(stored) ? stored : (stored as { available?: unknown } | null | undefined)?.available;
  return Array.isArray(list) && list.length > 0 ? list.filter((r): r is string => typeof r === 'string') : all;
};

/** An upsell as the editor holds it: the popular flag and the off switch live in the items JSON on the server. */
const hydrateUpsell = (u: Upsell): Upsell => ({
  ...u,
  quantity: u.items?.quantity || 1,
  isPopular: Boolean(u.items?.popular),
  isActive: !u.items?.off,
});

/** Exactly one default package: the first one flagged, else the first. */
const withOneDefault = (list: ProductPackage[]): ProductPackage[] => {
  const at = list.findIndex((p) => p.isDefault);
  return list.map((p, i) => ({ ...p, isDefault: i === (at < 0 ? 0 : at) }));
};

const initialValues = (form: CheckoutForm | undefined): BuilderFormValues => ({
  name: form?.name || '',
  slug: form?.slug || '',
  productId: form?.productId || 0,
  description: form?.description || '',
  buttonColor: form?.styling?.buttonColor || '#0f172a',
  accentColor: form?.styling?.accentColor || '#f97316',
  redirectUrl: form?.redirectUrl || '',
  allowedOrigins: (form?.allowedOrigins || []).join('\n'),
  codEnabled: form?.codEnabled ?? true,
  paystackDepositEnabled: form?.paystackDepositEnabled ?? false,
  paystackFullEnabled: form?.paystackFullEnabled ?? false,
  depositPercent: form?.depositPercent ?? 50,
  // The saved token never reaches the browser; the server sends a mask, which stands for "keep the saved token".
  metaCapiAccessToken: form?.metaCapiAccessToken ? CAPI_MASK : '',
  metaCapiTestEventCode: form?.metaCapiTestEventCode || '',
});

export const CheckoutFormBuilder = forwardRef<CheckoutFormBuilderHandle, CheckoutFormBuilderProps>(({
  onSave,
  initialData,
  products,
  onDirtyChange,
  onSubmittingChange,
  onDraftChange,
}, ref) => {
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<BuilderFormValues>({
    defaultValues: initialValues(initialData),
  });

  const [fields, setFields] = useState<FormField[]>(initialData?.fields || NEW_FORM_FIELDS);
  const [packages, setPackages] = useState<ProductPackage[]>(withOneDefault(initialData?.packages || []));
  const [upsells, setUpsells] = useState<Upsell[]>(initialData?.upsells?.map(hydrateUpsell) || []);
  const [upsellImages, setUpsellImages] = useState<Map<number, { file: File; preview: string }>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pixelConfig, setPixelConfig] = useState<PixelConfig>(initialData?.pixelConfig || {});
  const [design, setDesign] = useState<CheckoutFormDesign>(initialData?.design || {});
  const [showErrors, setShowErrors] = useState(false);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions | null>(null);
  const [paymentOptionsFailed, setPaymentOptionsFailed] = useState(false);
  const [capiTokenStored, setCapiTokenStored] = useState(Boolean(initialData?.metaCapiAccessToken));
  const [savedCapi, setSavedCapi] = useState({
    pixelId: initialData?.pixelConfig?.facebookPixelId ?? '',
    testEventCode: initialData?.metaCapiTestEventCode ?? '',
  });

  useEffect(() => {
    let cancelled = false;
    checkoutFormsService
      .getPaymentOptions()
      .then((o) => !cancelled && setPaymentOptions(o))
      .catch(() => !cancelled && setPaymentOptionsFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Country and currency come from the store and cannot be changed on a form (F-411). A saved form keeps its own.
  const storeCurrency = useConfigStore((st) => st.currency);
  const currency = initialData?.currency || storeCurrency || getStoreCurrency();
  const country = initialData?.country || getCountryByCurrency(currency);
  const allRegions = React.useMemo(() => getRegionsForCountry(country), [country]);
  // A new form starts with every region of the country selected (F-413).
  const [regions, setRegions] = useState<string[]>(() => savedRegions(initialData, allRegions));

  const initialDataId = initialData?.id;
  // Re-seed state if the parent swaps to a different form (rare in full-page mode, but covers it)
  useEffect(() => {
    if (initialData) {
      reset(initialValues(initialData));
      setRegions(savedRegions(initialData, allRegions));
      setFields(initialData.fields || NEW_FORM_FIELDS);
      setPackages(withOneDefault(initialData.packages || []));
      setUpsells(initialData.upsells?.map(hydrateUpsell) || []);
      setCapiTokenStored(Boolean(initialData.metaCapiAccessToken));
      setSavedCapi({ pixelId: initialData.pixelConfig?.facebookPixelId ?? '', testEventCode: initialData.metaCapiTestEventCode ?? '' });
      setPixelConfig(initialData.pixelConfig || {});
      setDesign(initialData.design || {});
    }
  }, [initialDataId, reset]);

  // Auto-generate slug from name (create mode only); read-only once the form is saved.
  const nameValue = watch('name');
  useEffect(() => {
    if (nameValue && !initialData) setValue('slug', slugFromName(nameValue));
  }, [nameValue, setValue, initialData]);

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
  const productIdValue = watch('productId');
  const codEnabledValue = watch('codEnabled');
  const depositEnabledValue = watch('paystackDepositEnabled');
  const fullEnabledValue = watch('paystackFullEnabled');
  const depositPercentValue = watch('depositPercent');
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
  const formType: FormType = previewProduct?.productType === 'digital' ? 'digital' : 'physical';
  const productPrice = Number(previewProduct?.price) || 0;
  const toggles = effectiveToggles(formType, { cod: Boolean(codEnabledValue), deposit: Boolean(depositEnabledValue), full: Boolean(fullEnabledValue) });
  const draftPayload = React.useMemo(
    () => ({
      name,
      description,
      currency,
      country,
      productId: Number(productIdValue) || 0,
      product: previewProduct,
      fields,
      // Streamed so the State field's dropdown updates live when the country changes.
      regions: { available: regions },
      // Prices are worked out the way the save does it, so the preview shows what the buyer will pay.
      packages: withComputedPrices(packages, productPrice),
      // An off upsell is hidden on the public form, so it is hidden here too.
      upsells: upsells.filter((u) => u.isActive !== false).map((u) => ({ ...u, items: { quantity: u.quantity, popular: u.isPopular || undefined } })),
      design,
      pixelConfig,
      formType,
      codEnabled: toggles.cod,
      paystackDepositEnabled: toggles.deposit,
      paystackFullEnabled: toggles.full,
      depositPercent: depositPercentValue,
    }),
    [name, description, currency, country, productIdValue, previewProduct, productPrice, formType, fields, regions, packages, upsells, design, pixelConfig, toggles.cod, toggles.deposit, toggles.full, depositPercentValue]
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
    setPackages(withOneDefault([
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
        isDefault: packages.length === 0,
        showHighlight: false,
        highlightText: '',
        showDiscount: true,
      },
    ]));
  };
  const updatePackage = (id: number, updated: ProductPackage) => {
    if (updated.isDefault) {
      setPackages(packages.map((p) => (p.id === id ? updated : { ...p, isDefault: false })));
    } else {
      setPackages(packages.map((p) => (p.id === id ? updated : p)));
    }
  };
  const deletePackage = (id: number) => setPackages(withOneDefault(packages.filter((p) => p.id !== id)));

  // Upsell actions
  const addUpsell = () =>
    setUpsells([
      ...upsells,
      { id: -Date.now(), name: '', price: 0, quantity: 1, isPopular: false, isActive: true },
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
    // The server applies the same rules and answers 400; these fail fast, in the owner's words, before the request.
    // A new form, or one that is on, cannot be saved without the fields an order needs (F-411).
    const problem =
      validateBasics(data) ?? (!initialData || initialData.isActive ? missingKeysMessage(fields, formType) : null);
    if (problem) {
      setShowErrors(true);
      toast.error(problem);
      return;
    }
    if (packages.length === 0) {
      alert('Please add at least one package. Packages define what products/quantities customers can purchase.');
      return;
    }
    const packageProblem = packages.map((p) => packageIssue(productPrice, p)).find(Boolean);
    const trackingProblem = pixelConfigError(pixelConfig);
    if (packageProblem || trackingProblem) {
      toast.error((packageProblem || trackingProblem) as string);
      return;
    }

    setIsSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const uploadedUpsells = await Promise.all(
        upsells.map(async (upsell) => {
          let imageUrl = upsell.imageUrl;
          const imageData = upsellImages.get(upsell.id);
          if (imageData?.file) {
            try {
              imageUrl = await checkoutFormsService.uploadImage(imageData.file);
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
            imageUrl,
            price: upsell.price,
            discountType: upsell.discountType || 'none',
            discountValue: upsell.discountValue || 0,
            originalPrice: upsell.originalPrice || upsell.price,
            // Quantity, the popular flag and the off switch have no columns of their own.
            items: { quantity: upsell.quantity, ...(upsell.isPopular && { popular: true }), ...(upsell.isActive === false && { off: true }) },
          };
        })
      );

      const formData: any = {
        name: data.name,
        slug: data.slug,
        productId: data.productId,
        description: data.description || '',
        fields,
        currency,
        regions: { available: regions },
        packages: withComputedPrices(packages, productPrice).map((pkg) => ({
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
        allowedOrigins: data.allowedOrigins
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean),
        codEnabled: toggles.cod,
        paystackDepositEnabled: toggles.deposit,
        paystackFullEnabled: toggles.full,
        depositPercent: Number(data.depositPercent) || null,
        // Write-only secret: send only when the admin typed a new value (an
        // untouched field still holds the "••••••••" mask, which the server
        // treats as "keep existing"). An emptied field clears it.
        metaCapiAccessToken: data.metaCapiAccessToken?.trim() ?? '',
        metaCapiTestEventCode: data.metaCapiTestEventCode?.trim() || null,
      };

      await onSave(formData);
      // The typed token is gone from the screen once it is saved; only "Connected" stays.
      const sentToken = formData.metaCapiAccessToken as string;
      setCapiTokenStored(sentToken !== '');
      setValue('metaCapiAccessToken', sentToken ? CAPI_MASK : '');
      setSavedCapi({ pixelId: pixelConfig.facebookPixelId ?? '', testEventCode: formData.metaCapiTestEventCode ?? '' });
      // Only revoke/clear after a successful save so a failed save can be
      // retried without re-uploading the images.
      upsellImages.forEach(({ preview }) => preview && URL.revokeObjectURL(preview));
      setUpsellImages(new Map());
      onDirtyChange?.(false);
      toast.success(initialData ? 'Checkout form saved' : 'Checkout form created');
    } catch (error) {
      // The API interceptor (services/api.ts) already shows an error toast with
      // the backend's specific message (e.g. a bad Allowed Domains entry), so
      // we don't duplicate it here — just log and let `finally` reset state.
      console.error('Failed to save checkout form:', error);
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
    country,
    currency,
    formType,
    isEditing: Boolean(initialData),
    hasOrders: (initialData?._count?.submissions ?? 0) > 0,
    originalProductId: initialData?.productId ?? null,
    allRegions,
    regions,
    setRegions,
    showErrors,
    formId: initialData?.id ?? null,
    productPrice,
    paymentOptions,
    paymentOptionsFailed,
    capiTokenStored,
    savedCapi,
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
            { id: 'payment', label: 'Payment', content: <PaymentTab /> },
            { id: 'tracking', label: 'Tracking', content: <TrackingTab /> },
            { id: 'design', label: 'Design', content: <DesignTab /> },
          ]}
          defaultTab="basics"
        />
      </form>
    </CheckoutBuilderProvider>
  );
});

CheckoutFormBuilder.displayName = 'CheckoutFormBuilder';
