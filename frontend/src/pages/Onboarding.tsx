import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../stores/authStore';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { getRegionsForCountry } from '../utils/countries';
import toast from 'react-hot-toast';

// Step schemas
const brandingSchema = z.object({
  companyLogo: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

const regionSchema = z.object({
  region: z.string().min(1, 'Please select a region'),
  currency: z.string().min(1, 'Currency is required'),
  defaultDeliveryFee: z.coerce.number().min(0).optional(),
});

type BrandingData = z.infer<typeof brandingSchema>;
type RegionData = z.infer<typeof regionSchema>;

const CURRENCIES = ['GHS', 'NGN', 'KES', 'ZAR', 'UGX', 'TZS', 'RWF', 'ETB'];
const GHANA_REGIONS = getRegionsForCountry('Ghana');

const steps = [
  { label: 'Company Branding' },
  { label: 'Region & Currency' },
  { label: 'First Checkout Form' },
  { label: 'Done' },
];

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const { user, updatePreferences } = useAuthStore();
  const [step, setStep] = useState(0);
  const [brandingData, setBrandingData] = useState<BrandingData>({ companyLogo: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const brandingForm = useForm<BrandingData>({
    resolver: zodResolver(brandingSchema),
    defaultValues: { companyLogo: '' },
  });

  const regionForm = useForm<RegionData>({
    resolver: zodResolver(regionSchema),
    defaultValues: { region: '', currency: 'GHS', defaultDeliveryFee: undefined },
  });

  const handleBrandingNext = brandingForm.handleSubmit((data) => {
    setBrandingData(data);
    setStep(1);
  });

  const handleRegionNext = regionForm.handleSubmit(async (data) => {
    setIsSubmitting(true);
    try {
      await authService.setupOnboarding({
        companyLogo: brandingData.companyLogo || undefined,
        region: data.region,
        currency: data.currency,
        defaultDeliveryFee: data.defaultDeliveryFee,
      });
      // Update local user preferences
      await updatePreferences({ onboardingCompleted: true });
      setStep(2);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Setup failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  });

  const handleFinish = () => {
    navigate('/dashboard');
  };

  const progressPct = ((step + 1) / steps.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center py-12 px-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.firstName}!</h1>
          <p className="text-gray-500 mt-1">Let's get your company set up.</p>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            {steps.map((s, i) => (
              <span key={i} className={i === step ? 'font-semibold text-blue-600' : ''}>
                {s.label}
              </span>
            ))}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <Card>
          {/* Step 0: Branding */}
          {step === 0 && (
            <form onSubmit={handleBrandingNext} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Company Branding</h2>
              <p className="text-sm text-gray-500">Add your logo (optional — you can update this later in Settings).</p>
              <Input
                label="Logo URL"
                {...brandingForm.register('companyLogo')}
                error={brandingForm.formState.errors.companyLogo?.message}
                placeholder="https://example.com/logo.png"
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                  Skip
                </Button>
                <Button type="submit" variant="primary">
                  Next
                </Button>
              </div>
            </form>
          )}

          {/* Step 1: Region & Currency */}
          {step === 1 && (
            <form onSubmit={handleRegionNext} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Region & Currency</h2>
              <p className="text-sm text-gray-500">Configure your operating region and default currency.</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                <select
                  {...regionForm.register('region')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a region…</option>
                  {GHANA_REGIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {regionForm.formState.errors.region && (
                  <p className="text-xs text-red-500 mt-1">{regionForm.formState.errors.region.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                <select
                  {...regionForm.register('currency')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <Input
                label="Default Delivery Fee (optional)"
                type="number"
                min="0"
                step="0.01"
                {...regionForm.register('defaultDeliveryFee')}
                error={regionForm.formState.errors.defaultDeliveryFee?.message}
                placeholder="e.g. 15.00"
              />

              <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button type="submit" variant="primary" isLoading={isSubmitting}>
                  Save & Continue
                </Button>
              </div>
            </form>
          )}

          {/* Step 2: Create first checkout form (optional) */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Create Your First Checkout Form</h2>
              <p className="text-sm text-gray-500">
                Checkout forms let customers place COD orders directly. You can create one now or skip and do it later from the dashboard.
              </p>
              <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setStep(3)}>
                  Skip for now
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    navigate('/checkout-forms?new=1');
                  }}
                >
                  Create Form
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div className="space-y-4 text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-lg font-semibold text-gray-800">You're all set!</h2>
              <p className="text-sm text-gray-500">
                Your company is configured and ready. Head to the dashboard to start managing orders.
              </p>
              <Button type="button" variant="primary" className="w-full mt-4" onClick={handleFinish}>
                Go to Dashboard
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
