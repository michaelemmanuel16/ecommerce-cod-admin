import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { FormFieldEditor } from './FormFieldEditor';
import { PackageEditor } from './PackageEditor';
import { UpsellEditor } from './UpsellEditor';
import { CheckoutForm, FormField, ProductPackage, Upsell } from '../../types/checkout-form';
import { Product } from '../../types';
import apiClient from '../../services/api';
import { getCurrencyForCountry, getRegionsForCountry, getSupportedCountries } from '../../utils/countries';

interface CheckoutFormBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (form: Partial<CheckoutForm>) => void;
  initialData?: CheckoutForm;
  products: Product[];
}

const defaultFields: FormField[] = [
  { id: '1', label: 'Full Name', type: 'text', required: true, enabled: true },
  { id: '2', label: 'Phone', type: 'phone', required: true, enabled: true },
  { id: '3', label: 'Alt Phone', type: 'phone', required: false, enabled: true },
  { id: '4', label: 'Street Address', type: 'textarea', required: true, enabled: true },
];

export const CheckoutFormBuilder: React.FC<CheckoutFormBuilderProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  products,
}) => {
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm({
    defaultValues: {
      name: initialData?.name || '',
      slug: initialData?.slug || '',
      productId: initialData?.productId || 0,
      description: initialData?.description || '',
      defaultCountry: initialData?.country || 'Ghana',
      buttonColor: initialData?.styling?.buttonColor || '#0f172a',
      accentColor: initialData?.styling?.accentColor || '#f97316',
    },
  });

  // Reset form when initialData changes (for edit mode) or when modal opens for create
  React.useEffect(() => {
    if (isOpen) {
      if (initialData) {
        // Edit mode - populate form with existing data
        reset({
          name: initialData.name || '',
          slug: initialData.slug || '',
          productId: initialData.productId || 0,
          description: initialData.description || '',
          defaultCountry: initialData.country || 'Ghana',
          buttonColor: initialData.styling?.buttonColor || '#0f172a',
          accentColor: initialData.styling?.accentColor || '#f97316',
        });
        // Reset state arrays with initialData
        setFields(initialData.fields || defaultFields);
        setPackages(initialData.packages || []);
        setUpsells(
          initialData.upsells?.map(u => ({
            ...u,
            quantity: u.items?.quantity || 1,
          })) || []
        );
      } else {
        // Create mode - reset to empty form
        reset({
          name: '',
          slug: '',
          productId: 0,
          description: '',
          defaultCountry: 'Ghana',
          buttonColor: '#0f172a',
          accentColor: '#f97316',
        });
        // Reset state arrays to defaults
        setFields(defaultFields);
        setPackages([]);
        setUpsells([]);
      }
    }
  }, [initialData, isOpen, reset]);

  // Auto-generate slug from name
  const nameValue = watch('name');
  React.useEffect(() => {
    if (nameValue && !initialData) {
      const slug = nameValue
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setValue('slug', slug);
    }
  }, [nameValue, setValue, initialData]);

  // Auto-set currency when country changes
  const countryValue = watch('defaultCountry');
  React.useEffect(() => {
    if (countryValue) {
      const currency = getCurrencyForCountry(countryValue);
      setValue('currency', currency);
    }
  }, [countryValue, setValue]);

  // Auto-update regions when country changes
  React.useEffect(() => {
    if (countryValue) {
      const regions = getRegionsForCountry(countryValue);
      setCurrentRegions(regions);
    }
  }, [countryValue]);

  const [fields, setFields] = useState<FormField[]>(initialData?.fields || defaultFields);
  const [packages, setPackages] = useState<ProductPackage[]>(initialData?.packages || []);
  // Transform upsells: extract quantity from items.quantity for UI
  const [upsells, setUpsells] = useState<Upsell[]>(
    initialData?.upsells?.map(u => ({
      ...u,
      quantity: u.items?.quantity || 1,
    })) || []
  );
  const [upsellImages, setUpsellImages] = useState<Map<number, { file: File; preview: string }>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dynamic regions based on selected country
  const [currentRegions, setCurrentRegions] = useState<string[]>(
    getRegionsForCountry(initialData?.country || 'Ghana')
  );

  // Update state when initialData changes or modal opens
  React.useEffect(() => {
    if (isOpen) {
      if (initialData) {
        // Edit mode - load existing data
        setFields(initialData.fields || defaultFields);
        setPackages(initialData.packages || []);
        setUpsells(
          initialData.upsells?.map(u => ({
            ...u,
            quantity: u.items?.quantity || 1,
          })) || []
        );
      } else {
        // Create mode - reset to defaults
        setFields(defaultFields);
        setPackages([]);
        setUpsells([]);
      }
      // Clear any existing upsell image previews
      upsellImages.forEach(({ preview }) => {
        if (preview) URL.revokeObjectURL(preview);
      });
      setUpsellImages(new Map());
    }
  }, [initialData, isOpen]);

  const productOptions = [
    { value: 0, label: 'Select Product' },
    ...products.map(p => ({ value: p.id, label: p.name })),
  ];

  const addField = () => {
    const newField: FormField = {
      id: Date.now().toString(),
      label: 'New Field',
      type: 'text',
      required: false,
      enabled: true,
    };
    setFields([...fields, newField]);
  };

  const updateField = (id: string, updatedField: FormField) => {
    setFields(fields.map(f => f.id === id ? updatedField : f));
  };

  const deleteField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  };

  const addPackage = () => {
    // Get selected product to use its price as default
    const selectedProductId = watch('productId');
    const selectedProduct = products.find(p => p.id === Number(selectedProductId));
    const productPrice = selectedProduct?.price || 0;

    const newPackage: ProductPackage = {
      id: -Date.now(), // Negative number for temporary IDs before backend save
      name: '',
      price: productPrice,
      quantity: 1,
      discountType: 'none',
      discountValue: 0,
      originalPrice: productPrice,
      productPrice: productPrice, // Store base product price for auto-calculation
      isPopular: false,
      isDefault: false,
      showHighlight: false,
      highlightText: '',
      showDiscount: true,
    };
    setPackages([...packages, newPackage]);
  };

  const updatePackage = (id: number, updatedPackage: ProductPackage) => {
    // If setting this package as default, uncheck all other packages
    if (updatedPackage.isDefault) {
      setPackages(packages.map(p =>
        p.id === id
          ? updatedPackage
          : { ...p, isDefault: false }
      ));
    } else {
      setPackages(packages.map(p => p.id === id ? updatedPackage : p));
    }
  };

  const deletePackage = (id: number) => {
    setPackages(packages.filter(p => p.id !== id));
  };

  const addUpsell = () => {
    const newUpsell: Upsell = {
      id: -Date.now(), // Negative number for temporary IDs before backend save
      name: '',
      price: 0,
      quantity: 1,
      isPopular: false,
    };
    setUpsells([...upsells, newUpsell]);
  };

  const updateUpsell = (id: number, updatedUpsell: Upsell) => {
    setUpsells(upsells.map(u => u.id === id ? updatedUpsell : u));
  };

  const deleteUpsell = (id: number) => {
    // Clean up image preview for deleted upsell
    const imageData = upsellImages.get(id);
    if (imageData?.preview) {
      URL.revokeObjectURL(imageData.preview);
    }
    setUpsellImages((prev) => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
    setUpsells(upsells.filter(u => u.id !== id));
  };

  const handleUpsellImageSelect = (upsellId: number, file: File | null) => {
    if (!file) return;

    // Create preview URL
    const preview = URL.createObjectURL(file);

    // Clean up old preview if exists
    const existing = upsellImages.get(upsellId);
    if (existing?.preview) {
      URL.revokeObjectURL(existing.preview);
    }

    // Store file and preview
    setUpsellImages((prev) => {
      const newMap = new Map(prev);
      newMap.set(upsellId, { file, preview });
      return newMap;
    });
  };

  const handleRemoveUpsellImage = (upsellId: number) => {
    // Clean up preview URL
    const imageData = upsellImages.get(upsellId);
    if (imageData?.preview) {
      URL.revokeObjectURL(imageData.preview);
    }

    // Remove from map
    setUpsellImages((prev) => {
      const newMap = new Map(prev);
      newMap.delete(upsellId);
      return newMap;
    });

    // Clear imageUrl from upsell
    const upsell = upsells.find(u => u.id === upsellId);
    if (upsell) {
      updateUpsell(upsellId, { ...upsell, imageUrl: undefined });
    }
  };

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      upsellImages.forEach(({ preview }) => {
        if (preview) URL.revokeObjectURL(preview);
      });
    };
  }, []);

  const onSubmit = async (data: any) => {
    // Validate required fields before submitting
    if (!data.productId || data.productId === 0) {
      alert('Please select a product for this checkout form.');
      return;
    }

    if (packages.length === 0) {
      alert('Please add at least one package. Packages define what products/quantities customers can purchase.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload all pending images first
      const uploadedUpsells = await Promise.all(
        upsells.map(async (upsell) => {
          const imageData = upsellImages.get(upsell.id);

          if (imageData?.file) {
            // Upload image
            const formData = new FormData();
            formData.append('image', imageData.file);

            try {
              const response = await apiClient.post('/upload', formData, {
                headers: {
                  'Content-Type': 'multipart/form-data',
                },
              });

              // Return upsell with uploaded imageUrl, items, and discount fields
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

          // No new image, keep existing imageUrl, add items and discount fields
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

      // Submit form with uploaded imageUrls
      const formData: any = {
        name: data.name,
        slug: data.slug,
        productId: data.productId,
        description: data.description || '',
        fields: fields,
        country: data.defaultCountry,
        currency: data.currency || getCurrencyForCountry(data.defaultCountry),
        regions: { available: currentRegions },
        packages: packages.map(pkg => ({
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
        styling: {
          buttonColor: data.buttonColor,
          accentColor: data.accentColor,
        },
      };

      // Clean up preview URLs
      upsellImages.forEach(({ preview }) => {
        if (preview) URL.revokeObjectURL(preview);
      });
      setUpsellImages(new Map());

      onSave(formData);
    } catch (error) {
      console.error('Failed to save checkout form:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title={initialData ? 'Edit Checkout Form' : 'Create Checkout Form'}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Form Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Form Name <span className="text-red-500">*</span>
          </label>
          <Input
            {...register('name', { required: 'Form name is required' })}
            placeholder="e.g., Summer Sale Checkout"
          />
          {errors.name && (
            <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>
          )}
          {!errors.name && (
            <p className="text-xs text-gray-500 mt-1">
              This name will be used to identify your checkout form
            </p>
          )}
        </div>

        {/* Auto-generated Slug (Read-only) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            URL Slug <span className="text-red-500">*</span>
          </label>
          <Input
            {...register('slug', { required: 'Slug is required' })}
            placeholder="auto-generated-from-name"
            readOnly
            className="bg-gray-50"
          />
          {errors.slug && (
            <p className="text-xs text-red-500 mt-1">{errors.slug.message}</p>
          )}
          {!errors.slug && (
            <p className="text-xs text-gray-500 mt-1">
              Auto-generated URL-friendly identifier
            </p>
          )}
        </div>

        {/* Product Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Product <span className="text-red-500">*</span>
          </label>
          <Select
            {...register('productId', {
              valueAsNumber: true,
              validate: (value) => value > 0 || 'Please select a product'
            })}
            options={productOptions}
          />
          {errors.productId && (
            <p className="text-xs text-red-500 mt-1">{errors.productId.message}</p>
          )}
          {!errors.productId && (
            <p className="text-xs text-gray-500 mt-1">
              Required: Choose which product this checkout form is for
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            {...register('description')}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter form description..."
          />
        </div>

        {/* Form Fields */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Form Fields</h3>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addField}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Field
            </Button>
          </div>
          <div className="space-y-2">
            {fields.map(field => (
              <FormFieldEditor
                key={field.id}
                field={field}
                onUpdate={(updated) => updateField(field.id, updated)}
                onDelete={() => deleteField(field.id)}
              />
            ))}
          </div>
        </div>

        {/* Product Packages */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Product Packages</h3>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addPackage}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Package
            </Button>
          </div>
          <div className="space-y-2">
            {packages.map(pkg => {
              // Get product price from package or from selected product as fallback
              const selectedProductId = watch('productId');
              const selectedProduct = products.find(p => p.id === Number(selectedProductId));
              const productPrice = pkg.productPrice || selectedProduct?.price || 0;
              const currency = watch('currency') || getCurrencyForCountry(watch('defaultCountry'));

              return (
                <PackageEditor
                  key={pkg.id}
                  package={pkg}
                  productPrice={productPrice}
                  currency={currency}
                  onUpdate={(updated) => updatePackage(pkg.id, updated)}
                  onDelete={() => deletePackage(pkg.id)}
                />
              );
            })}
            {packages.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                No packages added yet
              </p>
            )}
          </div>
        </div>

        {/* Upsells/Add-ons */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Upsells/Add-ons</h3>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addUpsell}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Upsell
            </Button>
          </div>
          <div className="space-y-2">
            {upsells.map(upsell => {
              const currency = watch('currency') || getCurrencyForCountry(watch('defaultCountry'));

              return (
                <UpsellEditor
                  key={upsell.id}
                  upsell={upsell}
                  products={products}
                  currency={currency}
                  onUpdate={(updated) => updateUpsell(upsell.id, updated)}
                  onDelete={() => deleteUpsell(upsell.id)}
                  imagePreview={upsellImages.get(upsell.id)?.preview}
                  onImageSelect={(file) => handleUpsellImageSelect(upsell.id, file)}
                  onImageRemove={() => handleRemoveUpsellImage(upsell.id)}
                />
              );
            })}
            {upsells.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                No upsells added yet
              </p>
            )}
          </div>
        </div>

        {/* Form Settings */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Form Settings</h3>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Country
            </label>
            <Select
              {...register('defaultCountry')}
              options={getSupportedCountries().map(country => ({
                value: country,
                label: country
              }))}
            />
          </div>
        </div>

        {/* Styling Settings */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Styling Settings</h3>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Button Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    {...register('buttonColor')}
                    className="h-10 w-20 rounded border border-gray-300"
                  />
                  <Input
                    {...register('buttonColor')}
                    placeholder="#0f172a"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Accent Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    {...register('accentColor')}
                    className="h-10 w-20 rounded border border-gray-300"
                  />
                  <Input
                    {...register('accentColor')}
                    placeholder="#f97316"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Uploading images...' : (initialData ? 'Update Form' : 'Create Form')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
