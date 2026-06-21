import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { billingService, Subscription } from '../services/billing.service';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { getSupportedCountries, getCurrencyForCountry, SUPPORTED_CURRENCIES } from '../utils/countries';
import toast from 'react-hot-toast';

const setupSchema = z.object({
  country: z.string().min(1, 'Please select a country'),
  currency: z.string().min(1, 'Currency is required'),
  businessEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  businessPhone: z.string().optional(),
  businessAddress: z.string().optional(),
  taxId: z.string().optional(),
});

type SetupData = z.infer<typeof setupSchema>;

const COUNTRIES = getSupportedCountries();

const steps = [
  { label: 'Country & Currency' },
  { label: 'Business Details' },
  { label: 'Done' },
];

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const { user, updatePreferences } = useAuthStore();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  // On the final step, load the tenant's plan so a pending PAID tier can be
  // activated with a Pay button — payment comes after business details.
  React.useEffect(() => {
    if (step !== 2) return;
    billingService.getSubscription().then(setSubscription).catch(() => setSubscription(null));
  }, [step]);

  const form = useForm<SetupData>({
    resolver: zodResolver(setupSchema),
    defaultValues: { country: '', currency: 'GHS', businessEmail: '', businessPhone: '', businessAddress: '', taxId: '' },
  });

  const selectedCountry = form.watch('country');

  // Auto-set currency when country changes
  React.useEffect(() => {
    if (selectedCountry) {
      const currency = getCurrencyForCountry(selectedCountry);
      form.setValue('currency', currency);
    }
  }, [selectedCountry, form]);

  const handleNext = () => {
    if (step === 0) {
      const country = form.getValues('country');
      const currency = form.getValues('currency');
      if (!country) {
        form.setError('country', { message: 'Please select a country' });
        return;
      }
      if (!currency) {
        form.setError('currency', { message: 'Currency is required' });
        return;
      }
      setStep(1);
    }
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    setIsSubmitting(true);
    try {
      await authService.setupOnboarding({
        country: data.country,
        currency: data.currency,
        businessEmail: data.businessEmail || undefined,
        businessPhone: data.businessPhone || undefined,
        businessAddress: data.businessAddress || undefined,
        taxId: data.taxId || undefined,
      });
      await updatePreferences({ onboardingCompleted: true });
      setStep(2);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Setup failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  });

  const handleSkip = async () => {
    setIsSubmitting(true);
    try {
      const data = form.getValues();
      await authService.setupOnboarding({ country: data.country, currency: data.currency });
      await updatePreferences({ onboardingCompleted: true });
      setStep(2);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Setup failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    navigate('/');
  };

  // Pending paid tier: charge at the end of onboarding. By now needsOnboarding()
  // is false, so the Paystack callback won't be intercepted by the onboarding guard.
  const handlePay = async () => {
    const planName = subscription?.plan?.name;
    if (!planName) return;
    setIsPaying(true);
    try {
      const { authorizationUrl } = await billingService.startSubscription(planName);
      window.location.href = authorizationUrl;
    } catch (error: any) {
      setIsPaying(false);
      toast.error(error?.response?.data?.message || 'Could not start payment. You can complete it from Billing.');
    }
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
              <span key={i} className={i <= step ? 'font-semibold text-blue-600' : ''}>
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
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Country & Currency</h2>
              <p className="text-sm text-gray-500">Select the country you operate in and your preferred currency.</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                <select
                  {...form.register('country')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a country...</option>
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
                <Button type="button" variant="primary" onClick={handleNext}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Step 1: Business Details */}
          {step === 1 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Business Details</h2>
              <p className="text-sm text-gray-500">Tell us about your business. You can update these later in Settings.</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Email</label>
                <input
                  type="email"
                  {...form.register('businessEmail')}
                  placeholder="contact@business.com"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {form.formState.errors.businessEmail && (
                  <p className="text-xs text-red-500 mt-1">{form.formState.errors.businessEmail.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Phone</label>
                <input
                  type="tel"
                  {...form.register('businessPhone')}
                  placeholder="+233 XX XXX XXXX"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Address</label>
                <textarea
                  {...form.register('businessAddress')}
                  placeholder="123 Business St, City, Region"
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tax ID / VAT Number (optional)</label>
                <input
                  type="text"
                  {...form.register('taxId')}
                  placeholder="XX-XXXXXXX"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleSkip}>
                    Skip
                  </Button>
                  <Button type="submit" variant="primary" isLoading={isSubmitting}>
                    Save & Continue
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* Step 2: Done — a pending PAID tier activates by paying here */}
          {step === 2 && (() => {
            if (subscription === null) {
              return <div className="py-6 text-center text-sm text-gray-500">Finalizing your setup…</div>;
            }
            const needsPayment =
              subscription.subscriptionStatus === 'pending' &&
              subscription.plan?.priceNGN != null &&
              subscription.billingEnabled;
            if (needsPayment) {
              const amount = subscription.nextChargeAmount ?? subscription.plan?.priceNGN ?? 0;
              return (
                <div className="space-y-4 text-center">
                  <h2 className="text-lg font-semibold text-gray-800">Activate {subscription.plan?.displayName}</h2>
                  <p className="text-sm text-gray-500">
                    Your business is set up. Complete your subscription to activate {subscription.plan?.displayName} and start managing orders.
                  </p>
                  <Button type="button" variant="primary" className="w-full mt-4" isLoading={isPaying} onClick={handlePay}>
                    {isPaying ? 'Redirecting to Paystack…' : `Pay ₦${Number(amount).toLocaleString()} & Activate`}
                  </Button>
                </div>
              );
            }
            return (
              <div className="space-y-4 text-center">
                <h2 className="text-lg font-semibold text-gray-800">You're all set!</h2>
                <p className="text-sm text-gray-500">
                  Your company is configured and ready. Head to the dashboard to start managing orders.
                </p>
                <Button type="button" variant="primary" className="w-full mt-4" onClick={handleFinish}>
                  Go to Dashboard
                </Button>
              </div>
            );
          })()}
        </Card>
      </div>
    </div>
  );
};
