import React, { useRef, useState, useEffect } from 'react';
import { useForm, RegisterOptions, FieldError } from 'react-hook-form';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { FieldType, FormField, PaymentMethod } from '../../types/checkout-form';
import { PackageSelector } from './PackageSelector';
import { AddOnSelector } from './AddOnSelector';
import { OrderSummary, PaymentMethodOption } from './OrderSummary';
import { cn } from '../../utils/cn';

interface CheckoutFormProps {
  formData: PublicCheckoutForm;
  onSubmit: (data: CheckoutFormData) => Promise<void>;
  // When set (from a `?package=<id>` deep link), the checkout is locked to this one
  // package. An id with no matching package falls back to showing every package.
  lockedPackageId?: number | null;
  // Rendered inside the embed widget on a host page — drops the full-screen page
  // chrome (min-h-screen / page background / outer padding) so it fits inline.
  embedded?: boolean;
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
  // Which payment button the buyer pressed (MAN-58). Omitted on legacy
  // single-method forms; the server defaults to COD for physical products.
  paymentMethod?: PaymentMethod;
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

// Field types the builder emits 1:1 onto a standard key, used to map a field
// whose label doesn't match an alias (e.g. the builder's default "Email Address"
// label). Only the unambiguous types are listed: `phone` is excluded because it
// covers both phone and altPhone, and `text`/`textarea` can be any custom field.
const TYPE_TO_STANDARD_KEY: Partial<Record<FieldType, keyof CheckoutFormData>> = {
  email: 'email',
  state: 'region',
};

function getStandardField(field: FormField): StandardFieldConfig | null {
  const normalized = field.label.toLowerCase().trim();
  const byAlias = STANDARD_FIELDS.find(config => config.aliases.includes(normalized));
  if (byAlias) return byAlias;
  // Fall back to the field's explicit type so a relabeled standard field (most
  // commonly an email field labeled "Email Address") still registers under its
  // standard key instead of leaking into customFields and being dropped.
  const typeKey = TYPE_TO_STANDARD_KEY[field.type];
  return typeKey ? STANDARD_FIELDS.find(config => config.key === typeKey) ?? null : null;
}

interface FieldWrapperProps {
  fieldKey: string;
  label: string;
  required: boolean;
  error: FieldError | undefined;
  children: React.ReactNode;
  labelColor?: string;
  widthPercent?: number;
}

function FieldWrapper({ fieldKey, label, required, error, children, labelColor, widthPercent }: FieldWrapperProps): React.JSX.Element {
  // Width is a percentage of the row; the container uses negative side margins so
  // the px-2 gutters line up. Two 50% fields share a row, full width gets its own.
  const width = widthPercent && widthPercent < 100 ? `${widthPercent}%` : '100%';
  return (
    <div key={fieldKey} className="px-2 mb-4" style={{ width }}>
      <label className="block text-sm font-medium text-gray-700 mb-1" style={labelColor ? { color: labelColor } : undefined}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-sm text-red-600">{error.message}</p>
      )}
    </div>
  );
}

export const CheckoutForm: React.FC<CheckoutFormProps> = ({ formData, onSubmit, lockedPackageId, embedded }) => {
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDigital = formData.formType === 'digital' || formData.product?.productType === 'digital';

  // Deep-link lock: when the page resolves a `?package=<id>`, show only that package
  // (focused one-option checkout). An id with no match falls back to every package
  // with the default pre-selected.
  const lockedPackage =
    lockedPackageId != null ? formData.packages.find((p) => p.id === lockedPackageId) || null : null;
  const visiblePackages = lockedPackage ? [lockedPackage] : formData.packages;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CheckoutFormData>();

  useEffect(() => {
    if (lockedPackage) {
      if (selectedPackageId !== lockedPackage.id) setSelectedPackageId(lockedPackage.id);
      return;
    }
    const defaultPackage = formData.packages.find(pkg => pkg.isDefault);
    if (defaultPackage && !selectedPackageId) {
      setSelectedPackageId(defaultPackage.id);
    }
  }, [formData.packages, selectedPackageId, lockedPackage]);

  const selectedPackage = formData.packages.find((p) => p.id === selectedPackageId) || null;

  function getFieldsToRender(): FormField[] {
    if (!formData.fields?.length) {
      return DEFAULT_FIELDS;
    }
    return formData.fields.filter((f: FormField) => f.enabled !== false);
  }

  function getFieldError(formKey: string): FieldError | undefined {
    if (formKey.startsWith('customFields.')) {
      const customKey = formKey.replace('customFields.', '');
      const customErrors = errors.customFields as Record<string, FieldError> | undefined;
      return customErrors?.[customKey];
    }
    return (errors as Record<string, FieldError | undefined>)[formKey];
  }

  // Theme derived from the form's Design settings (live-streamed in preview).
  const design = formData.design || {};
  const colors = design.colors || {};
  const ctaColor = colors.cta || '#0f172a';
  const surfaceColor = colors.surface || '#f97316';
  const primaryColor = colors.primary || ctaColor;
  const textColor = colors.text;
  const inputStyle = design.input?.style || 'outlined';
  const buttonShape = design.button?.shape || 'rounded';
  const buttonSize = design.button?.size || 'md';
  const buttonLabelOverride = design.button?.label?.trim() || undefined;
  const offerOnTop = design.page?.offerPosition === 'top';
  // Order summary shows by default; only an explicit `false` hides it.
  const showOrderSummary = design.page?.showOrderSummary !== false;

  // Custom property drives the Tailwind focus ring colour per input.
  const fieldStyle = { ['--tw-ring-color' as string]: primaryColor } as React.CSSProperties;

  const fieldBase = (hasError: boolean) => {
    const base = 'w-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:border-transparent transition-colors';
    if (inputStyle === 'flat') {
      return cn(base, 'border-0 border-b-2 rounded-none bg-transparent px-1', hasError ? 'border-red-500' : 'border-gray-300');
    }
    if (inputStyle === 'filled') {
      return cn(base, 'border rounded-lg bg-gray-100', hasError ? 'border-red-500' : 'border-transparent');
    }
    return cn(base, 'border rounded-lg bg-white', hasError ? 'border-red-500' : 'border-gray-300');
  };
  const inputClassName = (hasError: boolean) => fieldBase(hasError);
  const selectClassName = (hasError: boolean) =>
    cn(fieldBase(hasError), inputStyle === 'flat' ? 'bg-white' : '');

  function requiredRule(label: string): RegisterOptions | undefined {
    return { required: `${label} is required` };
  }

  // Field keys are dynamic (standard keys or `customFields.*` paths), so the
  // name/options don't line up with the static CheckoutFormData type — cast once here.
  const reg = (key: string, opts?: RegisterOptions) => register(key as any, opts as any);

  function renderField(field: FormField): React.JSX.Element {
    const standard = getStandardField(field);
    const formKey = standard ? standard.key : `customFields.${field.label}`;
    let isRequired = field.required ?? (standard ? DEFAULT_REQUIRED_KEYS.has(standard.key) : false);
    // For digital products: email is always required
    if (isDigital && (standard?.key === 'email' || field.type === 'email')) isRequired = true;
    const error = getFieldError(formKey);
    const hasError = !!error;
    const validation: RegisterOptions | undefined = isRequired ? requiredRule(field.label) : undefined;
    const placeholder = field.placeholder || `Enter ${field.label.toLowerCase()}`;
    const wrapKey = field.id || field.label;

    // Each branch builds only the inner control; the shared FieldWrapper (label,
    // width, error) is rendered once below so its props live in a single place.
    let control: React.JSX.Element;

    // Country-driven states dropdown (region standard key or the explicit "state" type).
    if (standard?.key === 'region' || field.type === 'state') {
      control = (
        <select {...reg(formKey, validation)} className={selectClassName(hasError)} style={fieldStyle}>
          <option value="">Select {field.label.toLowerCase()}</option>
          {(formData.regions?.available || []).map((region: string) => (
            <option key={region} value={region}>{region}</option>
          ))}
        </select>
      );
    } else if (standard?.key === 'streetAddress' || (!standard && field.type === 'textarea')) {
      control = (
        <textarea
          {...reg(formKey, validation)}
          rows={3}
          placeholder={placeholder}
          className={cn(inputClassName(hasError), 'resize-none')}
          style={fieldStyle}
        />
      );
    } else if (!standard && (field.type === 'select' || field.type === 'multiselect')) {
      const isMulti = field.type === 'multiselect';
      control = (
        <select
          {...reg(formKey, validation)}
          multiple={isMulti}
          className={cn(selectClassName(hasError), isMulti ? 'h-auto min-h-[6rem]' : '')}
          style={fieldStyle}
        >
          {!isMulti && <option value="">Select {field.label.toLowerCase()}</option>}
          {(field.options || []).map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    } else if (!standard && field.type === 'checkbox') {
      const checkboxOptions = field.options || [];
      control = (
        <div className="space-y-2">
          {checkboxOptions.map((opt: string) => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input
                {...reg(formKey, validation)}
                type="checkbox"
                value={opt}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2"
                style={fieldStyle}
              />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
          {checkboxOptions.length === 0 && (
            <span className="text-sm text-gray-400">No options configured</span>
          )}
        </div>
      );
    } else if (standard?.key === 'phone' || standard?.key === 'alternativePhone' || (!standard && field.type === 'phone')) {
      const phoneValidation: RegisterOptions = {
        ...(isRequired ? { required: `${field.label} is required` } : {}),
        pattern: {
          value: /^\+?[0-9]{8,15}$/,
          message: 'Please enter a valid phone number (8-15 digits)',
        },
      };
      control = (
        <input {...reg(formKey, phoneValidation)} type="tel" placeholder={placeholder} className={inputClassName(hasError)} style={fieldStyle} />
      );
    } else if (standard?.key === 'email' || field.type === 'email') {
      const emailValidation: RegisterOptions = {
        ...(isRequired ? { required: `${field.label} is required` } : {}),
        pattern: {
          value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
          message: 'Please enter a valid email address',
        },
      };
      control = (
        <input {...reg(formKey, emailValidation)} type="email" placeholder={placeholder} className={inputClassName(hasError)} style={fieldStyle} />
      );
    } else {
      const inputType = !standard && field.type === 'number' ? 'number' : 'text';
      control = (
        <input {...reg(formKey, validation)} type={inputType} placeholder={placeholder} className={inputClassName(hasError)} style={fieldStyle} />
      );
    }

    return (
      <FieldWrapper key={wrapKey} fieldKey={formKey} label={field.label} required={isRequired} error={error} labelColor={textColor} widthPercent={field.widthPercent}>
        {control}
      </FieldWrapper>
    );
  }

  const selectedAddons = formData.upsells.filter((u) => selectedAddonIds.has(u.id));

  // Payment-method buttons (MAN-58). Build one option per enabled toggle in the
  // fixed order COD → Deposit → Full. Digital products always pay full online.
  // A button carries its contextual amount; the chosen method is captured in a
  // ref right before submit (the form is posted through react-hook-form, which
  // doesn't see the click target).
  const ctaTotal = (selectedPackage?.price || 0) + selectedAddons.reduce((s, a) => s + a.price, 0);
  const depositPercent = formData.depositPercent ?? 0;
  const depositAmount = (ctaTotal * depositPercent) / 100;
  const money = (n: number) => `${formData.currency} ${n.toFixed(2)}`;

  const paymentMethods: PaymentMethodOption[] = (() => {
    if (isDigital) {
      return [{ method: 'paystack_full', label: buttonLabelOverride || 'Proceed to Payment' }];
    }
    const opts: PaymentMethodOption[] = [];
    if (formData.codEnabled !== false) opts.push({ method: 'cod', label: 'Cash on Delivery' });
    if (formData.paystackDepositEnabled) {
      opts.push({ method: 'paystack_deposit', label: `Pay Deposit — ${money(depositAmount)}` });
    }
    if (formData.paystackFullEnabled) {
      opts.push({ method: 'paystack_full', label: `Pay in Full — ${money(ctaTotal)}` });
    }
    // A lone COD button keeps the original "Place Order" label (zero-regression).
    if (opts.length === 1 && opts[0].method === 'cod') {
      opts[0].label = buttonLabelOverride || 'Place Order';
    }
    return opts.length > 0 ? opts : [{ method: 'cod', label: buttonLabelOverride || 'Place Order' }];
  })();

  const showRefundPolicy = paymentMethods.some((o) => o.method !== 'cod');
  const pendingMethodRef = useRef<PaymentMethod>(paymentMethods[0]?.method || 'cod');

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
        paymentMethod: pendingMethodRef.current,
      });
      // Don't reset isSubmitting on success — prevents double-submit while redirecting
    } catch (error) {
      console.error('Order submission error:', error);
      setIsSubmitting(false);
    }
  };

  // Captures which payment button was pressed, then runs validation + submit
  // (react-hook-form's handleSubmit doesn't carry the click target through).
  const submitWithMethod = (method: PaymentMethod) => {
    pendingMethodRef.current = method;
    handleSubmit(onFormSubmit)();
  };

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gray-50 py-8 px-4'}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        {!formData.design?.page?.hideProductDisplay && (
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2" style={textColor ? { color: textColor } : undefined}>
              {formData.product?.name || formData.name || 'Product Order'}
            </h1>
            {formData.description && (
              <p className="text-gray-600">{formData.description}</p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit(onFormSubmit)}>
          {/* Single centered column on all breakpoints — form, then summary stacked */}
          <div className="space-y-6">
            {/* Form fields and selections */}
            <div className="space-y-6">
              {/* Package Selection — rendered first when offer position is "top" */}
              {offerOnTop && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <PackageSelector
                    packages={visiblePackages}
                    selectedPackageId={selectedPackageId}
                    currency={formData.currency}
                    onSelectPackage={setSelectedPackageId}
                    primaryColor={primaryColor}
                    accentColor={surfaceColor}
                    textColor={textColor}
                  />
                </div>
              )}

              {/* Customer Information */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-6" style={textColor ? { color: textColor } : undefined}>
                  Your Information
                </h2>

                <div className="flex flex-wrap -mx-2">
                  {getFieldsToRender().map(renderField)}
                </div>
              </div>

              {/* Package Selection — default position (below customer info) */}
              {!offerOnTop && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <PackageSelector
                    packages={visiblePackages}
                    selectedPackageId={selectedPackageId}
                    currency={formData.currency}
                    onSelectPackage={setSelectedPackageId}
                    primaryColor={primaryColor}
                    accentColor={surfaceColor}
                    textColor={textColor}
                  />
                </div>
              )}

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

            {/* Order Summary — stacked below the form. The price breakdown is
                hidden when the toggle is off, but the CTA button always renders. */}
            <div>
              <OrderSummary
                selectedPackage={selectedPackage}
                selectedAddons={selectedAddons}
                currency={formData.currency}
                isSubmitting={isSubmitting}
                onSubmit={handleSubmit(onFormSubmit)}
                buttonColor={ctaColor}
                accentColor={surfaceColor}
                textColor={textColor}
                buttonShape={buttonShape}
                buttonSize={buttonSize}
                submitLabel={buttonLabelOverride || (isDigital ? 'Proceed to Payment' : 'Place Order')}
                showSummary={showOrderSummary}
                paymentMethods={paymentMethods}
                onSelectMethod={submitWithMethod}
                showRefundPolicy={showRefundPolicy}
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
