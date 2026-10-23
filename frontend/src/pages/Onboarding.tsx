import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Zap } from 'lucide-react';
import { z } from 'zod';
import { billingService, Subscription } from '../services/billing.service';
import { adminService } from '../services/admin.service';
import { onboardingService, OnboardingStatus } from '../services/onboarding.service';
import { useAuthStore } from '../stores/authStore';
import { Button, Input, Select, Tag } from '../components/ui-v2';
import { getSupportedCountries, getCurrencyForCountry, getCurrencySymbol } from '../utils/countries';

const COUNTRIES = getSupportedCountries();

// The six steps of the mockup rail. Steps 3 to 6 belong to the North Star setup (M6) and stay disabled until then.
const RAIL = [
  { n: 1, label: 'Your store' },
  { n: 2, label: 'Connect your 3PL' },
  { n: 3, label: 'Set your North Star' },
  { n: 4, label: 'Driver targets' },
  { n: 5, label: 'Invite your team' },
  { n: 6, label: 'Rewards' },
];

type View = 1 | 2 | 'done';

const storeSchema = z.object({
  businessName: z.string().trim().min(1, 'Enter your business name'),
  country: z.string().min(1, 'Pick a country'),
  businessEmail: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
});

const partnerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the partner name'),
  email: z.string().trim().email('Enter a valid email address'),
});

const errorText = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

/** First view to show: the first step that is not done, so a closed wizard resumes where it stopped. */
function startView(status: OnboardingStatus): View {
  const store = status.steps.find((s) => s.step === 1);
  const partner = status.steps.find((s) => s.step === 2);
  if (!store?.done) return 1;
  if (!partner?.done && !partner?.skipped) return 2;
  return 'done';
}

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const { user, updatePreferences } = useAuthStore();
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [store, setStore] = useState({ businessName: '', country: '', businessEmail: '', businessPhone: '', businessAddress: '', taxId: '' });
  const [partner, setPartner] = useState({ name: '', type: '3pl' as '3pl' | 'agent', email: '', phone: '' });

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  // Load the done state and the saved step 1 values, so a closed wizard resumes with its data.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, config] = await Promise.all([
        onboardingService.getStatus(),
        adminService.getSystemConfig().catch(() => null),
      ]);
      if (!alive) return;
      setStatus(s);
      setStore({
        businessName: config?.businessName ?? '',
        country: s.country ?? '',
        businessEmail: config?.businessEmail ?? '',
        businessPhone: config?.businessPhone ?? '',
        businessAddress: config?.businessAddress ?? '',
        taxId: config?.taxId ?? '',
      });
      setView(startView(s));
    })().catch(() => {
      if (!alive) return;
      setError('Could not load your setup. Refresh the page to try again.');
    });
    return () => { alive = false; };
  }, []);

  // The wizard is complete once step 2 is added or skipped. Saving the flag here lets the app stop sending the owner back.
  useEffect(() => {
    if (view !== 'done') return;
    updatePreferences({ onboardingCompleted: true }).catch(() => undefined);
    // On the final view, load the plan so a pending PAID tier can be activated with a Pay button.
    billingService.getSubscription().then(setSubscription).catch(() => setSubscription(null));
  }, [view, updatePreferences]);

  const stepDone = (n: number) => status?.steps.find((s) => s.step === n)?.done ?? false;
  const partnerHandled = stepDone(2) || !!status?.steps.find((s) => s.step === 2)?.skipped;
  const currency = store.country ? getCurrencyForCountry(store.country) : '';

  const markDone = (n: number, patch: { done?: boolean; skipped?: boolean }) =>
    setStatus((s) => s && { ...s, steps: s.steps.map((x) => (x.step === n ? { ...x, ...patch } : x)) });

  const goto = (next: View) => {
    setError('');
    setErrors({});
    setView(next);
  };

  const saveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const parsed = storeSchema.safeParse(store);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setErrors({ businessName: f.businessName?.[0] ?? '', country: f.country?.[0] ?? '', businessEmail: f.businessEmail?.[0] ?? '' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onboardingService.saveStore({
        businessName: store.businessName.trim(),
        country: store.country,
        currency,
        businessEmail: store.businessEmail.trim() || undefined,
        businessPhone: store.businessPhone.trim() || undefined,
        businessAddress: store.businessAddress.trim() || undefined,
        taxId: store.taxId.trim() || undefined,
      });
      markDone(1, { done: true });
      goto(partnerHandled ? 'done' : 2);
    } catch (err) {
      setError(errorText(err, 'Could not save your store. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const savePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const parsed = partnerSchema.safeParse(partner);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setErrors({ name: f.name?.[0] ?? '', email: f.email?.[0] ?? '' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onboardingService.addPartner({
        name: partner.name.trim(),
        type: partner.type,
        email: partner.email.trim(),
        phone: partner.phone.trim() || undefined,
      });
      markDone(2, { done: true });
      goto('done');
    } catch (err) {
      setError(errorText(err, 'Could not add the partner. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const skipPartner = async () => {
    setError('');
    setBusy(true);
    try {
      await onboardingService.skipPartner();
      markDone(2, { skipped: true });
      goto('done');
    } catch (err) {
      setError(errorText(err, 'Could not skip this step. Try again.'));
    } finally {
      setBusy(false);
    }
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
    } catch (err) {
      setIsPaying(false);
      setError(errorText(err, 'Could not start payment. You can complete it from Billing.'));
    }
  };

  const doneBody = () => {
    if (subscription === null) {
      return <p>Finalizing your setup...</p>;
    }
    const needsPayment =
      subscription.subscriptionStatus === 'pending' && subscription.plan?.priceNGN != null && subscription.billingEnabled;
    if (needsPayment) {
      const amount = subscription.nextChargeAmount ?? subscription.plan?.priceNGN ?? 0;
      return (
        <div className="wdone">
          <h2>Activate {subscription.plan?.displayName}</h2>
          <p>Your business is set up. Complete your subscription to activate {subscription.plan?.displayName} and start managing orders.</p>
          <Button variant="primary" disabled={isPaying} onClick={handlePay}>
            {isPaying ? 'Redirecting to Paystack...' : `Pay ₦${Number(amount).toLocaleString()} & Activate`}
          </Button>
        </div>
      );
    }
    return (
      <div className="wdone">
        <h2>You're all set</h2>
        <p>Your store is ready. The North Star steps (goal, driver targets, team and rewards) open soon.</p>
        <Button variant="primary" onClick={() => navigate('/')}>Go to Dashboard</Button>
      </div>
    );
  };

  const stepNumber = view === 1 ? 1 : view === 2 ? 2 : 7;

  return (
    <div className="v2 onbpage">
      <main className="onbbox">
        <div className="card wiz">
          <nav className="steps" aria-label="Setup steps">
            <div className="brand"><div className="logo"><Zap aria-hidden="true" /></div><b>Set up</b></div>
            <p className="hi">Welcome, {user?.firstName}</p>
            {RAIL.map((s) => {
              const done = s.n === 1 ? stepDone(1) : s.n === 2 ? partnerHandled : false;
              const mark = done ? <Check aria-hidden="true" /> : s.n;
              if (s.n > 2) {
                // North Star setup: stays disabled until M6.
                return (
                  <span key={s.n} className="step off" aria-disabled="true" title="Opens with the North Star setup">
                    <span className="n">{s.n}</span>{s.label}<Tag className="soon">Soon</Tag>
                  </span>
                );
              }
              return (
                <button
                  key={s.n}
                  type="button"
                  className={`step${done ? ' done' : ''}${stepNumber === s.n ? ' on' : ''}`}
                  aria-current={stepNumber === s.n ? 'step' : undefined}
                  disabled={view === null || (s.n === 2 && !stepDone(1))}
                  onClick={() => goto(s.n as View)}
                >
                  <span className="n">{mark}</span>{s.label}
                </button>
              );
            })}
          </nav>

          <div className="wbody">
            {error && <div className="authnote bad" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
            {view === null && !error && <p>Loading your setup...</p>}

            {view === 1 && (
              <form onSubmit={saveStore} noValidate>
                <h2>Your store</h2>
                <p>Pick the country you sell in. Your currency follows it. You can change it later in Settings.</p>
                <div className="wgrid">
                  <Select
                    label="Selling country"
                    value={store.country}
                    error={errors.country || undefined}
                    onChange={(e) => setStore({ ...store, country: e.target.value })}
                  >
                    <option value="">Select a country...</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                  <Input
                    label="Store currency"
                    value={currency ? `${currency} (${getCurrencySymbol(currency)})` : ''}
                    readOnly
                    hint="Set from the country. You can change it later in Settings."
                  />
                  <Input
                    className="full"
                    label="Business name"
                    value={store.businessName}
                    error={errors.businessName || undefined}
                    onChange={(e) => setStore({ ...store, businessName: e.target.value })}
                  />
                  <Input
                    label="Business email"
                    optional
                    type="email"
                    placeholder="contact@business.com"
                    value={store.businessEmail}
                    error={errors.businessEmail || undefined}
                    onChange={(e) => setStore({ ...store, businessEmail: e.target.value })}
                  />
                  <Input
                    label="Business phone"
                    optional
                    type="tel"
                    placeholder="+233 XX XXX XXXX"
                    value={store.businessPhone}
                    onChange={(e) => setStore({ ...store, businessPhone: e.target.value })}
                  />
                  <Input
                    className="full"
                    label="Business address"
                    optional
                    placeholder="Street, City/Town, State"
                    value={store.businessAddress}
                    onChange={(e) => setStore({ ...store, businessAddress: e.target.value })}
                  />
                  <Input
                    className="full"
                    label="Tax ID / VAT number"
                    optional
                    placeholder="XX-XXXXXXX"
                    value={store.taxId}
                    onChange={(e) => setStore({ ...store, taxId: e.target.value })}
                  />
                </div>
                <div className="wfoot">
                  <span />
                  <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving...' : 'Next'}</Button>
                </div>
              </form>
            )}

            {view === 2 && (
              <form onSubmit={savePartner} noValidate>
                <h2>Connect your 3PL</h2>
                <p>Add the first delivery partner. You can skip this and add partners later in Deliveries.</p>
                {stepDone(2) ? (
                  <div className="authnote ok" role="status">A delivery partner is already added.</div>
                ) : (
                  <div className="wgrid">
                    <Input
                      label="Partner name"
                      placeholder="For example: Logiswift"
                      value={partner.name}
                      error={errors.name || undefined}
                      onChange={(e) => setPartner({ ...partner, name: e.target.value })}
                    />
                    <Select
                      label="Type"
                      value={partner.type}
                      onChange={(e) => setPartner({ ...partner, type: e.target.value as '3pl' | 'agent' })}
                    >
                      <option value="3pl">3PL company</option>
                      <option value="agent">Own delivery agent</option>
                    </Select>
                    <Input
                      label="Partner email"
                      type="email"
                      value={partner.email}
                      error={errors.email || undefined}
                      onChange={(e) => setPartner({ ...partner, email: e.target.value })}
                    />
                    <Input
                      label="Partner phone"
                      optional
                      type="tel"
                      value={partner.phone}
                      onChange={(e) => setPartner({ ...partner, phone: e.target.value })}
                    />
                  </div>
                )}
                <div className="wfoot">
                  <Button onClick={() => goto(1)}>Back</Button>
                  <div className="right">
                    {stepDone(2) ? (
                      <Button variant="primary" onClick={() => goto('done')}>Continue</Button>
                    ) : (
                      <>
                        <Button disabled={busy} onClick={skipPartner}>Skip for now</Button>
                        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving...' : 'Add partner and continue'}</Button>
                      </>
                    )}
                  </div>
                </div>
              </form>
            )}

            {view === 'done' && doneBody()}
          </div>
        </div>
      </main>
    </div>
  );
};
