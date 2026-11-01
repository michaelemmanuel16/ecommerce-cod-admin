import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Zap } from 'lucide-react';
import { z } from 'zod';
import { billingService, Subscription } from '../services/billing.service';
import { adminService } from '../services/admin.service';
import { onboardingService, OnboardingStatus } from '../services/onboarding.service';
import { useAuthStore } from '../stores/authStore';
import { Button, Input, Select } from '../components/ui-v2';
import { getSupportedCountries, getCurrencyForCountry, getCurrencySymbol } from '../utils/countries';
import { StepNorthStar } from './northStar/StepNorthStar';
import { StepDrivers } from './northStar/StepDrivers';
import { startStep } from './northStar/model';
import { todayYmd } from '../utils/format';

const COUNTRIES = getSupportedCountries();

// The six steps of the mockup rail. Steps 3 to 6 are the North Star setup (M6-T17); their progress is kept in the Owner's preferences.
const RAIL = [
  { n: 1, label: 'Your store' },
  { n: 2, label: 'Connect your 3PL' },
  { n: 3, label: 'Set your North Star' },
  { n: 4, label: 'Driver targets' },
  { n: 5, label: 'Invite your team' },
  { n: 6, label: 'Rewards' },
];

type View = 1 | 2 | 3 | 4 | 5 | 6 | 'done';

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

/** First view to show: the step in the address (Edit North Star opens step 3), else the first step not done, so a closed wizard resumes where it stopped. */
function startView(status: OnboardingStatus, asked: number | null): View {
  const store = status.steps.find((x) => x.step === 1);
  const partner = status.steps.find((x) => x.step === 2);
  const partnerHandled = !!partner?.done || !!partner?.skipped;
  const step = startStep({ asked, store: !!store?.done, partner: partnerHandled, saved: status.northStar.step });
  if (status.northStar.done && asked === null && step >= 3) return 'done';
  return step as View;
}

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, patchUser, refreshPermissions } = useAuthStore();
  const year = Number(todayYmd().slice(0, 4));
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
      const asked = Number(params.get('step'));
      setView(startView(s, Number.isInteger(asked) && asked > 0 ? asked : null));
    })().catch(() => {
      if (!alive) return;
      setError('Could not load your setup. Refresh the page to try again.');
    });
    return () => { alive = false; };
  }, []);

  // On the final view, load the plan so a pending PAID tier can be activated with a Pay button.
  useEffect(() => {
    if (view !== 'done') return;
    billingService.getSubscription().then(setSubscription).catch(() => setSubscription(null));
  }, [view]);

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

  /** Move to a North Star step (3 to 6) and keep it: leaving and coming back resumes here. Reaching step 3 also closes the store setup. */
  const moveTo = async (n: 3 | 4 | 5 | 6) => {
    try {
      await onboardingService.saveNorthStarProgress(n);
      setStatus((s) => s && { ...s, northStar: { step: n, done: false } });
      if (user && !user.preferences?.onboardingCompleted) patchUser({ preferences: { ...user.preferences, onboardingCompleted: true } });
    } catch (err) {
      setError(errorText(err, 'Could not save your progress. Try again.'));
      return;
    }
    goto(n);
  };

  const finish = async () => {
    setBusy(true);
    try {
      await onboardingService.saveNorthStarProgress(6, true);
      setStatus((s) => s && { ...s, northStar: { step: 6, done: true } });
      if (user) patchUser({ preferences: { ...user.preferences, onboardingCompleted: true, northStarDone: true } });
      refreshPermissions().catch(() => undefined); // the menu drops "Set up North Star"
      goto('done');
    } catch (err) {
      setError(errorText(err, 'Could not finish the setup. Try again.'));
    } finally {
      setBusy(false);
    }
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
      if (partnerHandled) await moveTo(3); else goto(2);
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
      await moveTo(3);
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
      await moveTo(3);
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
        <p>Your store and your North Star are set. Quarters, months and driver targets are on the Targets page.</p>
        <Button variant="primary" onClick={() => navigate('/')}>Go to Dashboard</Button>
      </div>
    );
  };

  const stepNumber = view === 'done' ? 7 : view;
  const savedStep = status?.northStar.step ?? 3;
  const northStarOpen = stepDone(1) && partnerHandled;

  return (
    <div className="v2 onbpage">
      <main className="onbbox">
        <div className="card wiz">
          <nav className="steps" aria-label="Setup steps">
            <div className="brand"><div className="logo"><Zap aria-hidden="true" /></div><b>Set up</b></div>
            <p className="hi">Welcome, {user?.firstName}</p>
            {RAIL.map((s) => {
              const done = s.n === 1 ? stepDone(1) : s.n === 2 ? partnerHandled : s.n === 6 ? !!status?.northStar.done : northStarOpen && s.n < savedStep;
              const mark = done ? <Check aria-hidden="true" /> : s.n;
              return (
                <button
                  key={s.n}
                  type="button"
                  className={`step${done ? ' done' : ''}${stepNumber === s.n ? ' on' : ''}`}
                  aria-current={stepNumber === s.n ? 'step' : undefined}
                  disabled={view === null || (s.n === 2 && !stepDone(1)) || (s.n > 2 && !northStarOpen)}
                  onClick={() => (s.n > 2 ? moveTo(s.n as 3 | 4 | 5 | 6) : goto(s.n as View))}
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
                      <Button variant="primary" onClick={() => moveTo(3)}>Continue</Button>
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

            {view === 3 && <StepNorthStar year={year} onBack={() => goto(2)} onSaved={() => moveTo(4)} />}
            {view === 4 && <StepDrivers year={year} month={todayYmd().slice(0, 7)} currency={currency || 'GHS'} onBack={() => goto(3)} onNext={() => moveTo(5)} />}

            {view === 5 && (
              <div className="nsstack">
                <h2>Invite your team</h2>
                <p>Invite the people who will work orders. They get a link to set their own password. You can skip this and invite later in Staff &amp; roles.</p>
                <div>
                  <Button variant="primary" onClick={async () => { await onboardingService.saveNorthStarProgress(5).catch(() => undefined); navigate('/staff?invite=1'); }}>Invite people in Staff &amp; roles</Button>
                </div>
                <div className="wfoot">
                  <Button onClick={() => goto(4)}>Back</Button>
                  <Button variant="primary" onClick={() => moveTo(6)}>Next</Button>
                </div>
              </div>
            )}

            {view === 6 && (
              <div className="nsstack">
                <h2>Rewards</h2>
                <p>Rewards are set in one place: Settings, Rewards. Nothing is copied into this wizard.</p>
                <div className="nsrewards"><Link className="btn pri" to="/settings?tab=rewards">Open Rewards in Settings</Link></div>
                <div className="wfoot">
                  <Button onClick={() => goto(5)}>Back</Button>
                  <Button variant="primary" disabled={busy} onClick={finish}>{busy ? 'Saving...' : 'Finish setup'}</Button>
                </div>
              </div>
            )}

            {view === 'done' && doneBody()}
          </div>
        </div>
      </main>
    </div>
  );
};
