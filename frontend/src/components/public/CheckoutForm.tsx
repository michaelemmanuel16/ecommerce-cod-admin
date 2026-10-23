import React, { useRef, useState, useEffect } from 'react';
import { useForm, Controller, RegisterOptions, FieldError } from 'react-hook-form';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { FormField, PaymentMethod } from '../../types/checkout-form';
import { MappedField, mapFields } from '../../lib/standardFields';
import { LEGACY_EMPTY_FORM_FIELDS } from '../../lib/defaultFields';
import { PackageSelector } from './PackageSelector';
import { AddOnSelector } from './AddOnSelector';
import { OrderSummary, PaymentMethodOption } from './OrderSummary';
import { cn } from '../../utils/cn';
import { TownSelect } from '../forms/TownSelect';
import { DEFAULT_BUTTON_COLOR } from '../../lib/contrast';
import { formatMoney } from '../../utils/money';

interface CheckoutFormProps {
  formData: PublicCheckoutForm;
  onSubmit: (data: CheckoutFormData) => Promise<void>;
  // When set (from a `?package=<id>` deep link), the checkout is locked to this one
  // package. An id with no matching package falls back to showing every package.
  lockedPackageId?: number | null;
  // Rendered inside the embed widget on a host page — drops the full-screen page
  // chrome (min-h-screen / page background / outer padding) so it fits inline.
  embedded?: boolean;
  // The editor's preview: "Place order" says "Preview only." and no order is sent. Pixels and server events live in the
  // pages around this component (PublicCheckout, EmbedCheckout), which the preview route never renders.
  preview?: boolean;
}

export interface CheckoutFormData {
  fullName: string;
  phone: string;
  alternativePhone?: string;
  email?: string;
  region: string;
  town: string;
  landmark: string;
  streetAddress?: string;
  /** A field whose "Sends to" is Order notes (F-412). */
  notes?: string;
  selectedPackageId: number;
  selectedAddonIds: number[];
  customFields?: Record<string, string>;
  // Which payment button the buyer pressed (MAN-58). Omitted on legacy
  // single-method forms; the server defaults to COD for physical products.
  paymentMethod?: PaymentMethod;
}

// Which slots default to required when the field itself doesn't say. Not the same
// thing as `REQUIRED_PHYSICAL` in lib/standardFields (which is what the server
// rejects a submission without) — this one also applies to digital forms, where
// address and state are still asked for but the server doesn't demand them.
const DEFAULT_REQUIRED_KEYS: ReadonlySet<string> = new Set(['fullName', 'phone', 'region', 'town', 'landmark', 'streetAddress']);

const TOWN_FIELD: FormField = { id: 'town', label: 'City/Town', type: 'text', required: true, enabled: true, standardKey: 'town' };
const LANDMARK_FIELD: FormField = { id: 'landmark', label: 'Nearest landmark', type: 'text', required: true, enabled: true, standardKey: 'landmark' };

// Forms saved before City/Town and Nearest landmark existed get both (required) right after the State field.
// A saved field that is switched off still counts as present, so a seller's choice is kept. A form with no
// State field is left alone: there is nothing to put them after.
function withTownAndLandmark(fields: FormField[]): FormField[] {
  const keys = mapFields(fields).map((m) => m.standardKey);
  const add = [!keys.includes('town') && TOWN_FIELD, !keys.includes('landmark') && LANDMARK_FIELD].filter(Boolean) as FormField[];
  if (add.length === 0) return fields;
  const at = keys.indexOf('region');
  return at < 0 ? fields : [...fields.slice(0, at + 1), ...add, ...fields.slice(at + 1)];
}

// A digital form asks no address, state, town or landmark, and always asks an email (a form with the email field switched
// off gets it back, so the download link has somewhere to go). The server does not demand those address fields either.
const DIGITAL_HIDDEN_KEYS: ReadonlySet<string> = new Set(['region', 'town', 'landmark', 'streetAddress']);
const EMAIL_FIELD: FormField = { id: 'email', label: 'Email Address', type: 'email', required: true, enabled: true, standardKey: 'email' };

function digitalFields(mapped: MappedField[], all: FormField[]): MappedField[] {
  const kept = mapped.filter((m) => !(m.standardKey && DIGITAL_HIDDEN_KEYS.has(m.standardKey)) && m.field.type !== 'state');
  if (kept.some((m) => m.standardKey === 'email')) return kept;
  // An email field the owner switched off comes back as it was typed; a form with none gets the default.
  const saved = mapFields(all).find((m) => m.standardKey === 'email');
  const email = saved ? { ...saved.field, enabled: true } : EMAIL_FIELD;
  const at = kept.findIndex((m) => m.standardKey === 'phone');
  const added = mapFields([email])[0];
  return at < 0 ? [...kept, added] : [...kept.slice(0, at + 1), added, ...kept.slice(at + 1)];
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
  // Full width on a phone; the owner's width applies from the sm breakpoint up.
  const width = widthPercent && widthPercent < 100 ? `${widthPercent}%` : '100%';
  return (
    <div key={fieldKey} className="px-2 mb-4 w-full sm:w-[var(--field-w)]" style={{ ['--field-w' as string]: width } as React.CSSProperties}>
      <label className="block text-sm font-medium text-gray-700 mb-1.5" style={labelColor ? { color: labelColor } : undefined}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-sm text-red-600">{error.message}</p>
      )}
    </div>
  );
}

export const CheckoutForm: React.FC<CheckoutFormProps> = ({ formData, onSubmit, lockedPackageId, embedded, preview }) => {
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewNotice, setPreviewNotice] = useState(false);
  // The server's answer to the last try, in plain words above the buttons. Never an alert().
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set on the first tap, before React re-renders: a second tap in the same frame does nothing.
  const submittingRef = useRef(false);
  const isDigital = formData.formType === 'digital' || formData.product?.productType === 'digital';

  // Deep-link lock: when the page resolves a `?package=<id>`, show only that package
  // (focused one-option checkout). An id with no match falls back to every package
  // with the default pre-selected.
  const lockedPackage =
    lockedPackageId != null ? formData.packages.find((p) => p.id === lockedPackageId) || null : null;
  const visiblePackages = lockedPackage ? [lockedPackage] : formData.packages;

  const {
    register,
    control: formControl,
    watch,
    handleSubmit,
    formState: { errors },
  } = useForm<CheckoutFormData>();
  const chosenState = watch('region') ?? '';

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

  // Back from the payment page (the browser may restore this page as it was): the button works again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      submittingRef.current = false;
      setIsSubmitting(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const selectedPackage = formData.packages.find((p) => p.id === selectedPackageId) || null;

  function getFieldsToRender(): MappedField[] {
    let fields: FormField[];
    if (formData.fields?.length) {
      fields = isDigital ? formData.fields : withTownAndLandmark(formData.fields);
    } else {
      fields = LEGACY_EMPTY_FORM_FIELDS;
    }
    // The buyer sees exactly the label the owner typed (the old "Region" labels were rewritten to "State" in the database).
    const mapped = mapFields(fields.filter((f: FormField) => f.enabled !== false));
    return isDigital ? digitalFields(mapped, fields) : mapped;
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
  const ctaColor = colors.cta || DEFAULT_BUTTON_COLOR;
  const surfaceColor = colors.surface || '#f97316';
  const primaryColor = colors.primary || ctaColor;
  const textColor = colors.text;
  const labelColor = design.input?.labelColor || textColor;
  const priceColor = design.input?.priceColor || undefined;
  const pageBackground = design.page?.background && design.page.background !== 'transparent' ? design.page.background : undefined;
  // The server drops a banner that is not on our image storage, so any banner that arrives here is ours.
  const banner = design.page?.productBanner || undefined;
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
    const base = 'w-full px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:border-transparent transition-colors';
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

  function renderField({ field, standardKey, formKey }: MappedField): React.JSX.Element {
    let isRequired = field.required ?? (standardKey ? DEFAULT_REQUIRED_KEYS.has(standardKey) : false);
    // For digital products: email is always required
    if (isDigital && (standardKey === 'email' || field.type === 'email')) isRequired = true;
    const error = getFieldError(formKey);
    const hasError = !!error;
    const validation: RegisterOptions | undefined = isRequired ? requiredRule(field.label) : undefined;
    const placeholder = field.placeholder || (standardKey === 'landmark' ? 'e.g. Opposite Kasoa Total station' : `Enter ${field.label.toLowerCase()}`);
    const wrapKey = field.id || field.label;

    // Each branch builds only the inner control; the shared FieldWrapper (label,
    // width, error) is rendered once below so its props live in a single place.
    let control: React.JSX.Element;

    // Country-driven states dropdown (region standard key or the explicit "state" type).
    if (standardKey === 'region' || field.type === 'state') {
      control = (
        <select {...reg(formKey, validation)} className={selectClassName(hasError)} style={fieldStyle}>
          <option value="">Select {field.label.toLowerCase()}</option>
          {(formData.regions?.available || []).map((region: string) => (
            <option key={region} value={region}>{region}</option>
          ))}
        </select>
      );
    } else if (standardKey === 'town') {
      // City/Town: the towns of the chosen state, with "Other – type it" last. Native select, so it stays easy on a phone.
      control = (
        <Controller
          name="town"
          control={formControl}
          rules={validation as any}
          defaultValue=""
          render={({ field: f }) => (
            <TownSelect
              variant="plain"
              label={field.label}
              state={chosenState}
              value={f.value ?? ''}
              onChange={f.onChange}
              towns={formData.towns?.[chosenState] ?? []}
              selectClassName={selectClassName(hasError)}
              inputClassName={inputClassName(hasError)}
              controlStyle={fieldStyle}
            />
          )}
        />
      );
    } else if (standardKey === 'streetAddress' || (!standardKey && field.type === 'textarea')) {
      control = (
        <textarea
          {...reg(formKey, validation)}
          rows={3}
          placeholder={placeholder}
          className={cn(inputClassName(hasError), 'resize-none')}
          style={fieldStyle}
        />
      );
    } else if (!standardKey && (field.type === 'select' || field.type === 'multiselect')) {
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
    } else if (!standardKey && field.type === 'checkbox') {
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
    } else if (standardKey === 'phone' || standardKey === 'alternativePhone' || (!standardKey && field.type === 'phone')) {
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
    } else if (standardKey === 'email' || field.type === 'email') {
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
      const inputType = !standardKey && field.type === 'number' ? 'number' : 'text';
      control = (
        <input {...reg(formKey, validation)} type={inputType} placeholder={placeholder} className={inputClassName(hasError)} style={fieldStyle} />
      );
    }

    return (
      <FieldWrapper key={wrapKey} fieldKey={formKey} label={field.label} required={isRequired} error={error} labelColor={labelColor} widthPercent={field.widthPercent}>
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
  const money = (n: number) => formatMoney(n, formData.currency);

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
    if (submittingRef.current) return;
    if (!selectedPackageId) {
      setSubmitError('Please choose a package.');
      return;
    }

    submittingRef.current = true;
    setSubmitError(null);
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
      setSubmitError(error instanceof Error && error.message ? error.message : 'We could not place your order. Please try again.');
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Captures which payment button was pressed, then runs validation + submit
  // (react-hook-form's handleSubmit doesn't carry the click target through).
  const submitWithMethod = (method: PaymentMethod) => {
    pendingMethodRef.current = method;
    handleSubmit(onFormSubmit)();
  };

  // The preview never submits: both entry points (the payment buttons and the single CTA) say so and stop here.
  const guardPreview = <A extends unknown[]>(submit: (...args: A) => void) =>
    preview ? () => setPreviewNotice(true) : submit;

  const packageSection = (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6" data-testid="section-packages">
      <PackageSelector
        packages={visiblePackages}
        selectedPackageId={selectedPackageId}
        currency={formData.currency}
        onSelectPackage={setSelectedPackageId}
        primaryColor={primaryColor}
        accentColor={surfaceColor}
        textColor={textColor}
        priceColor={priceColor}
      />
    </div>
  );

  const addOnSection = formData.upsells.length > 0 && (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6" data-testid="section-addons">
      <AddOnSelector
        upsells={formData.upsells}
        selectedAddons={selectedAddonIds}
        currency={formData.currency}
        onToggleAddon={toggleAddon}
        priceColor={priceColor}
      />
    </div>
  );

  const informationSection = (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6" data-testid="section-information">
      <h2 className="text-lg font-semibold text-gray-900 mb-4" style={textColor ? { color: textColor } : undefined}>
        Your information
      </h2>
      <div className="flex flex-wrap -mx-2">
        {getFieldsToRender().map(renderField)}
      </div>
    </div>
  );

  return (
    // The public form keeps its own colours: it never reads the admin theme, so the admin's dark mode cannot change it.
    <div
      className={embedded ? 'w-full' : 'min-h-screen bg-gray-50 py-6 px-4 sm:py-8'}
      data-testid="public-form-root"
      style={{ colorScheme: 'light', ...(pageBackground ? { backgroundColor: pageBackground } : {}) }}
    >
      <div className="max-w-xl mx-auto">
        {banner && <img src={banner} alt="" className="w-full max-h-64 object-cover rounded-2xl mb-5" data-testid="form-banner" />}
        {/* Product header (hideable) */}
        {!formData.design?.page?.hideProductDisplay && (
          <div className="mb-5" data-testid="section-header">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1" style={textColor ? { color: textColor } : undefined}>
              {formData.product?.name || formData.name || 'Product Order'}
            </h1>
            {formData.description && (
              <p className="text-gray-600">{formData.description}</p>
            )}
          </div>
        )}

        <form onSubmit={preview ? (e) => { e.preventDefault(); setPreviewNotice(true); } : handleSubmit(onFormSubmit)}>
          {/* One column on every screen: offer (packages, add-ons) and "Your information" in the owner's order, then the summary. */}
          <div className="space-y-4">
            {offerOnTop ? (
              <>
                {packageSection}
                {addOnSection}
                {informationSection}
              </>
            ) : (
              <>
                {informationSection}
                {packageSection}
                {addOnSection}
              </>
            )}

            {/* Order summary: the price breakdown hides when the toggle is off, but the buttons always render. */}
            <div>
              <OrderSummary
                selectedPackage={selectedPackage}
                selectedAddons={selectedAddons}
                currency={formData.currency}
                isSubmitting={isSubmitting}
                onSubmit={guardPreview(() => handleSubmit(onFormSubmit)())}
                buttonColor={ctaColor}
                accentColor={surfaceColor}
                textColor={textColor}
                buttonShape={buttonShape}
                buttonSize={buttonSize}
                submitLabel={buttonLabelOverride || (isDigital ? 'Proceed to Payment' : 'Place Order')}
                showSummary={showOrderSummary}
                paymentMethods={paymentMethods}
                onSelectMethod={guardPreview(submitWithMethod)}
                showRefundPolicy={showRefundPolicy}
                priceColor={priceColor}
                submitError={submitError}
                isDigital={isDigital}
                hasCod={paymentMethods.some((o) => o.method === 'cod')}
                supportWhatsapp={formData.supportWhatsapp}
              />
              {previewNotice && <p role="status" className="mt-3 text-center text-sm font-medium text-gray-700">Preview only.</p>}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
