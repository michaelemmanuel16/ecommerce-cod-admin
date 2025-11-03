import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { PublicCheckoutForm } from '../../services/public-orders.service';
import { PackageSelector } from './PackageSelector';
import { AddOnSelector } from './AddOnSelector';
import { OrderSummary } from './OrderSummary';
import { Input } from '../ui/Input';
import { cn } from '../../utils/cn';

interface CheckoutFormProps {
  formData: PublicCheckoutForm;
  onSubmit: (data: CheckoutFormData) => Promise<void>;
}

export interface CheckoutFormData {
  fullName: string;
  phone: string;
  alternativePhone?: string;
  region: string;
  streetAddress: string;
  selectedPackageId: number;
  selectedAddonIds: number[];
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

  // Auto-select default package on mount
  useEffect(() => {
    const defaultPackage = formData.packages.find(pkg => pkg.isDefault);
    if (defaultPackage && !selectedPackageId) {
      setSelectedPackageId(defaultPackage.id);
    }
  }, [formData.packages, selectedPackageId]);

  const selectedPackage = formData.packages.find((p) => p.id === selectedPackageId) || null;
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
    } catch (error) {
      console.error('Order submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {formData.product?.name || formData.name || 'Product Order'}
          </h1>
          {formData.description && (
            <p className="text-gray-600">{formData.description}</p>
          )}
        </div>

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
                  {/* Full Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...register('fullName', { required: 'Full name is required' })}
                      type="text"
                      placeholder="Enter full name"
                      className={cn(
                        'w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f172a] focus:border-transparent',
                        errors.fullName ? 'border-red-500' : 'border-gray-300'
                      )}
                    />
                    {errors.fullName && (
                      <p className="mt-1 text-sm text-red-600">{errors.fullName.message}</p>
                    )}
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...register('phone', {
                        required: 'Phone number is required',
                        pattern: {
                          value: /^\+?[0-9]{8,15}$/,
                          message: 'Please enter a valid phone number (8-15 digits)',
                        },
                      })}
                      type="tel"
                      placeholder="Enter phone number"
                      className={cn(
                        'w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f172a] focus:border-transparent',
                        errors.phone ? 'border-red-500' : 'border-gray-300'
                      )}
                    />
                    {errors.phone && (
                      <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
                    )}
                  </div>

                  {/* Alternative Phone */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Alternative Phone
                    </label>
                    <input
                      {...register('alternativePhone', {
                        pattern: {
                          value: /^\+?[0-9]{8,15}$/,
                          message: 'Please enter a valid phone number (8-15 digits)',
                        },
                      })}
                      type="tel"
                      placeholder="Enter alternative phone (optional)"
                      className={cn(
                        'w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f172a] focus:border-transparent',
                        errors.alternativePhone ? 'border-red-500' : 'border-gray-300'
                      )}
                    />
                    {errors.alternativePhone && (
                      <p className="mt-1 text-sm text-red-600">{errors.alternativePhone.message}</p>
                    )}
                  </div>

                  {/* Region/State */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Region/State <span className="text-red-500">*</span>
                    </label>
                    <select
                      {...register('region', { required: 'Region is required' })}
                      className={cn(
                        'w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f172a] focus:border-transparent bg-white',
                        errors.region ? 'border-red-500' : 'border-gray-300'
                      )}
                    >
                      <option value="">Select region/state</option>
                      {(formData.regions?.available || []).map((region: string) => (
                        <option key={region} value={region}>
                          {region}
                        </option>
                      ))}
                    </select>
                    {errors.region && (
                      <p className="mt-1 text-sm text-red-600">{errors.region.message}</p>
                    )}
                  </div>

                  {/* Street Address */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Street Address <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      {...register('streetAddress', { required: 'Street address is required' })}
                      rows={3}
                      placeholder="Enter street address"
                      className={cn(
                        'w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f172a] focus:border-transparent resize-none',
                        errors.streetAddress ? 'border-red-500' : 'border-gray-300'
                      )}
                    />
                    {errors.streetAddress && (
                      <p className="mt-1 text-sm text-red-600">{errors.streetAddress.message}</p>
                    )}
                  </div>
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
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
