import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { getSupportedCountries, getCurrencyForCountry, SUPPORTED_CURRENCIES } from '../utils/countries';
import toast from 'react-hot-toast';

const setupSchema = z.object({
  country: z.string().min(1, 'Please select a country'),
  currency: z.string().min(1, 'Currency is required'),
});

type SetupData = z.infer<typeof setupSchema>;

const COUNTRIES = getSupportedCountries();

const steps = [
  { label: 'Country & Currency' },
  { label: 'Done' },
];

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const { user, updatePreferences } = useAuthStore();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<SetupData>({
    resolver: zodResolver(setupSchema),
    defaultValues: { country: '', currency: 'GHS' },
  });

  const selectedCountry = form.watch('country');

  // Auto-set currency when country changes
  React.useEffect(() => {
    if (selectedCountry) {
      const currency = getCurrencyForCountry(selectedCountry);
      form.setValue('currency', currency);
    }
  }, [selectedCountry, form]);

  const handleSubmit = form.handleSubmit(async (data) => {
    setIsSubmitting(true);
    try {
      await authService.setupOnboarding({
        country: data.country,
        currency: data.currency,
      });
      await updatePreferences({ onboardingCompleted: true });
      setStep(1);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Setup failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  });

  const handleFinish = () => {
    navigate('/');
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
          {/* Step 0: Country & Currency */}
          {step === 0 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Country & Currency</h2>
              <p className="text-sm text-gray-500">Select the country you operate in and your preferred currency.</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                <select
                  {...form.register('country')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a country…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {form.formState.errors.country && (
                  <p className="text-xs text-red-500 mt-1">{form.formState.errors.country.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                <select
                  {...form.register('currency')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="submit" variant="primary" isLoading={isSubmitting}>
                  Save & Continue
                </Button>
              </div>
            </form>
          )}

          {/* Step 1: Done */}
          {step === 1 && (
            <div className="space-y-4 text-center">
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
