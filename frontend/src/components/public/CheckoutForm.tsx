import React, { useState, useEffect } from 'react';
import { useForm, RegisterOptions, FieldError } from 'react-hook-form';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { FormField } from '../../types/checkout-form';
import { PackageSelector } from './PackageSelector';
import { AddOnSelector } from './AddOnSelector';
import { OrderSummary } from './OrderSummary';
import { cn } from '../../utils/cn';

interface CheckoutFormProps {
  formData: PublicCheckoutForm;
  onSubmit: (data: CheckoutFormData) => Promise<void>;
}

export interface CheckoutFormData {
  fullName: string;
  phone: string;
  alternativePhone?: string;
  email?: string;
  region: string;
  streetAddress: string;
  selectedPackageId: number;
  selectedAddonIds: number[];
  customFields?: Record<string, string>;
}

interface StandardFieldConfig {
  key: keyof CheckoutFormData;
  aliases: string[];
}

const STANDARD_FIELDS: StandardFieldConfig[] = [
  { key: 'fullName', aliases: ['name', 'full name'] },
  { key: 'phone', aliases: ['phone', 'phone number'] },
  { key: 'alternativePhone', aliases: ['alt phone', 'alternative phone', 'alt. phone'] },
  { key: 'email', aliases: ['email', 'e-mail'] },
  { key: 'region', aliases: ['region', 'region/state', 'state'] },
  { key: 'streetAddress', aliases: ['street address', 'address'] },
];

const DEFAULT_REQUIRED_KEYS: ReadonlySet<string> = new Set(['fullName', 'phone', 'region', 'streetAddress']);

const DEFAULT_FIELDS: FormField[] = [
  { id: 'fullName', label: 'Full Name', type: 'text', required: true, enabled: true },
  { id: 'phone', label: 'Phone', type: 'phone', required: true, enabled: true },
  { id: 'altPhone', label: 'Alt Phone', type: 'phone', required: false, enabled: true },
  { id: 'region', label: 'Region/State', type: 'select', required: true, enabled: true },
  { id: 'streetAddress', label: 'Street Address', type: 'textarea', required: true, enabled: true },
];

function getStandardField(label: string): StandardFieldConfig | null {
  const normalized = label.toLowerCase().trim();
  return STANDARD_FIELDS.find(config => config.aliases.includes(normalized)) ?? null;
}

interface FieldWrapperProps {
  fieldKey: string;
  label: string;
  required: boolean;
  error: FieldError | undefined;
  children: React.ReactNode;
}

function FieldWrapper({ fieldKey, label, required, error, children }: FieldWrapperProps): React.JSX.Element {
  return (
    <div key={fieldKey}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-sm text-red-600">{error.message}</p>
      )}
    </div>
  );
}

export const CheckoutForm: React.FC<CheckoutFormProps> = ({ formData, onSubmit }) => {
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CheckoutFormData>();

  useEffect(() => {
    const defaultPackage = formData.packages.find(pkg => pkg.isDefault);
    if (defaultPackage && !selectedPackageId) {
      setSelectedPackageId(defaultPackage.id);
    }
  }, [formData.packages, selectedPackageId]);

  const selectedPackage = formData.packages.find((p) => p.id === selectedPackageId) || null;

  function getFieldsToRender(): FormField[] {
    if (!formData.fields?.length) {
      return DEFAULT_FIELDS;
    }
    return formData.fields.filter((f: FormField) => f.enabled !== false);
  }

  function getFieldError(formKey: string): FieldError | undefined {
    // For standard fields, look up directly; for custom fields (dotted paths),
    // traverse the errors object
    if (formKey.startsWith('customFields.')) {
      const customKey = formKey.replace('customFields.', '');
      const customErrors = errors.customFields as Record<string, FieldError> | undefined;
      return customErrors?.[customKey];
    }
    return (errors as Record<string, FieldError | undefined>)[formKey];
  }

  const inputClassName = (hasError: boolean) => cn(
    'w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f172a] focus:border-transparent',
    hasError ? 'border-red-500' : 'border-gray-300'
  );

  const selectClassName = (hasError: boolean) => cn(
    'w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f172a] focus:border-transparent bg-white',
    hasError ? 'border-red-500' : 'border-gray-300'
  );

  function requiredRule(label: string): RegisterOptions | undefined {
    return { required: `${label} is required` };
  }

  function renderField(field: FormField): React.JSX.Element {
    const standard = getStandardField(field.label);
    const formKey = standard ? standard.key : `customFields.${field.label}`;
    const isRequired = field.required ?? (standard ? DEFAULT_REQUIRED_KEYS.has(standard.key) : false);
    const error = getFieldError(formKey);
    const validation: RegisterOptions | undefined = isRequired ? requiredRule(field.label) : undefined;

    if (standard?.key === 'region') {
      return (
        <FieldWrapper key={field.id || field.label} fieldKey={formKey} label={field.label} required={isRequired} error={error}>
          <select
            {...register(formKey as any, validation)}
            className={selectClassName(!!error)}
          >
            <option value="">Select {field.label.toLowerCase()}</option>
            {(formData.regions?.available || []).map((region: string) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
        </FieldWrapper>
      );
    }

    if (standard?.key === 'streetAddress' || (!standard && field.type === 'textarea')) {
      return (
        <FieldWrapper key={field.id || field.label} fieldKey={formKey} label={field.label} required={isRequired} error={error}>
          <textarea
            {...register(formKey as any, validation)}
            rows={3}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            className={cn(inputClassName(!!error), 'resize-none')}
          />
        </FieldWrapper>
      );
    }

    if (!standard && field.type === 'select') {
      return (
        <FieldWrapper key={field.id || field.label} fieldKey={formKey} label={field.label} required={isRequired} error={error}>
          <select
            {...register(formKey as any, validation)}
            className={selectClassName(!!error)}
          >
            <option value="">Select {field.label.toLowerCase()}</option>
            {(field.options || []).map((opt: string) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </FieldWrapper>
      );
    }

    const isPhone = standard?.key === 'phone' || standard?.key === 'alternativePhone' || (!standard && field.type === 'phone');
    if (isPhone) {
      const phoneValidation: RegisterOptions = {
        ...(isRequired ? { required: `${field.label} is required` } : {}),
        pattern: {
          value: /^\+?[0-9]{8,15}$/,
          message: 'Please enter a valid phone number (8-15 digits)',
        },
      };
      return (
        <FieldWrapper key={field.id || field.label} fieldKey={formKey} label={field.label} required={isRequired} error={error}>
          <input
            {...register(formKey as any, phoneValidation)}
            type="tel"
            placeholder={`Enter ${field.label.toLowerCase()}`}
            className={inputClassName(!!error)}
          />
        </FieldWrapper>
      );
    }

    if (standard?.key === 'email') {
      const emailValidation: RegisterOptions = {
        ...(isRequired ? { required: `${field.label} is required` } : {}),
        pattern: {
          value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
          message: 'Please enter a valid email address',
        },
      };
      return (
        <FieldWrapper key={field.id || field.label} fieldKey={formKey} label={field.label} required={isRequired} error={error}>
          <input
            {...register(formKey as any, emailValidation)}
            type="email"
            placeholder={`Enter ${field.label.toLowerCase()}`}
            className={inputClassName(!!error)}
          />
        </FieldWrapper>
      );
    }

    return (
      <FieldWrapper key={field.id || field.label} fieldKey={formKey} label={field.label} required={isRequired} error={error}>
        <input
          {...register(formKey as any, validation)}
          type="text"
          placeholder={`Enter ${field.label.toLowerCase()}`}
          className={inputClassName(!!error)}
        />
      </FieldWrapper>
    );
  }

  const selectedAddons = formData.upsells.filter((u) => selectedAddonIds.has(u.id));

  const toggleAddon = (addonId: number) => {
    const newSelected = new Set(selectedAddonIds);
    if (newSelected.has(addonId)) {
      newSelected.delete(addonId);
    } else {
      newSelected.add(addonId);
    }
    setSelectedAddonIds(newSelected);
  };

  const onFormSubmit = async (data: Partial<CheckoutFormData>) => {
    if (!selectedPackageId) {
      alert('Please select a package');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        ...data as CheckoutFormData,
        selectedPackageId,
        selectedAddonIds: Array.from(selectedAddonIds),
      });
      // Don't reset isSubmitting on success — prevents double-submit while redirecting
    } catch (error) {
      console.error('Order submission error:', error);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        {(formData.styling?.showName !== false || (formData.styling?.showDescription !== false && formData.description)) && (
          <div className="mb-8">
            {formData.styling?.showName !== false && (
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {formData.product?.name || formData.name || 'Product Order'}
              </h1>
            )}
            {formData.styling?.showDescription !== false && formData.description && (
              <p className="text-gray-600">{formData.description}</p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit(onFormSubmit)}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left column - Form fields and selections */}
            <div className="lg:col-span-2 space-y-6">
              {/* Customer Information */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">
                  Your Information
                </h2>

                <div className="space-y-4">
                  {getFieldsToRender().map(renderField)}
                </div>
              </div>

              {/* Package Selection */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <PackageSelector
                  packages={formData.packages}
                  selectedPackageId={selectedPackageId}
                  currency={formData.currency}
                  onSelectPackage={setSelectedPackageId}
                />
              </div>

              {/* Add-ons Selection */}
              {formData.upsells.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <AddOnSelector
                    upsells={formData.upsells}
                    selectedAddons={selectedAddonIds}
                    currency={formData.currency}
                    onToggleAddon={toggleAddon}
                  />
                </div>
              )}
            </div>

            {/* Right column - Order Summary */}
            <div className="lg:col-span-1">
              <OrderSummary
                selectedPackage={selectedPackage}
                selectedAddons={selectedAddons}
                currency={formData.currency}
                isSubmitting={isSubmitting}
                onSubmit={handleSubmit(onFormSubmit)}
                buttonColor={formData.styling?.buttonColor}
                accentColor={formData.styling?.accentColor}
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
