import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Onboarding } from '../../pages/Onboarding';
import { useAuthStore } from '../../stores/authStore';
import { onboardingService, type OnboardingStatus } from '../../services/onboarding.service';
import { adminService } from '../../services/admin.service';
import { billingService } from '../../services/billing.service';

vi.mock('../../services/onboarding.service', () => ({
  onboardingService: { getStatus: vi.fn(), saveStore: vi.fn(), addPartner: vi.fn(), skipPartner: vi.fn(), saveNorthStarProgress: vi.fn() },
}));
// Steps 3 to 6 have their own tests (NorthStarWizard.test.tsx); here the wizard only has to arrive at them.
vi.mock('../../services/targets.service', async (orig) => ({
  ...(await orig<typeof import('../../services/targets.service')>()),
  targetsService: {
    drivers: vi.fn().mockResolvedValue({ year: 2026, plannedAov: { value: 245, source: 'auto', last30Days: 245, deliveredOrders: 38, required: false }, confirmationRate: { value: 70, source: 'default' }, deliverySuccessRate: { value: 60, source: 'default' }, netMargin: { value: 35, source: 'default' } }),
    tree: vi.fn().mockResolvedValue({ year: 2026, metric: 'revenue', currency: 'GHS', marginTarget: 35, northStar: null, quarters: [], months: [] }),
    preview: vi.fn().mockResolvedValue({ quarters: ['360000.00', '420000.00', '480000.00', '540000.00'], months: [] }),
    calculators: vi.fn().mockRejectedValue(new Error('none')),
  },
}));
vi.mock('../../services/admin.service', () => ({ adminService: { getSystemConfig: vi.fn() } }));
vi.mock('../../services/billing.service', () => ({ billingService: { getSubscription: vi.fn(), startSubscription: vi.fn() } }));

const status = (over: Partial<OnboardingStatus> & { store?: boolean; partner?: boolean; skipped?: boolean } = {}): OnboardingStatus => ({
  onboardingCompleted: false,
  northStar: { step: 3, done: false },
  country: over.country ?? null,
  currency: over.currency ?? null,
  steps: [
    { step: 1, key: 'store', done: over.store ?? false },
    { step: 2, key: 'partner', done: over.partner ?? false, skipped: over.skipped ?? false },
  ],
});

const updatePreferences = vi.fn();

beforeEach(() => {
  vi.mocked(onboardingService.getStatus).mockReset();
  vi.mocked(onboardingService.saveStore).mockReset().mockResolvedValue();
  vi.mocked(onboardingService.addPartner).mockReset().mockResolvedValue();
  vi.mocked(onboardingService.skipPartner).mockReset().mockResolvedValue();
  vi.mocked(onboardingService.saveNorthStarProgress).mockReset().mockResolvedValue();
  vi.mocked(adminService.getSystemConfig).mockReset().mockResolvedValue({} as never);
  vi.mocked(billingService.getSubscription).mockReset().mockResolvedValue({ subscriptionStatus: 'active', plan: { name: 'free', displayName: 'Free' }, billingEnabled: false } as never);
  updatePreferences.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({ user: { id: 1, firstName: 'Ama', role: 'super_admin', preferences: {} } as never, isAuthenticated: true, updatePreferences, patchUser: vi.fn(), refreshPermissions: vi.fn() } as never);
});

const renderPage = () => render(<MemoryRouter><Onboarding /></MemoryRouter>);

describe('Onboarding wizard (M3-T67, F-124)', () => {
  it('shows the six-step rail; steps 3 to 6 open once the store steps are done', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status());
    renderPage();
    await screen.findByRole('heading', { name: 'Your store' });
    for (const label of ['Set your North Star', 'Driver targets', 'Invite your team', 'Rewards']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: /Your store/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: /Connect your 3PL/ })).toBeDisabled();
  });

  it('step 1 asks for the country, shows the currency that follows it and the Settings note', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status());
    renderPage();
    await screen.findByRole('heading', { name: 'Your store' });
    await userEvent.selectOptions(screen.getByLabelText('Selling country'), 'Ghana');
    expect(screen.getByLabelText('Store currency')).toHaveValue('GHS (GH₵)');
    expect(screen.getByText(/You can change it later in Settings/, { selector: '.hint' })).toBeInTheDocument();
    expect(screen.queryByText(/region/i)).toBeNull();
  });

  it('saves step 1 on Next, then Back keeps the typed values', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status());
    renderPage();
    await screen.findByRole('heading', { name: 'Your store' });
    await userEvent.selectOptions(screen.getByLabelText('Selling country'), 'Nigeria');
    await userEvent.type(screen.getByLabelText('Business name'), 'Acme Stores');
    await userEvent.type(screen.getByLabelText(/Business address/), '1 Ring Road, Ikeja, Lagos');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Connect your 3PL' });
    expect(onboardingService.saveStore).toHaveBeenCalledWith(
      expect.objectContaining({ businessName: 'Acme Stores', country: 'Nigeria', currency: 'NGN', businessAddress: '1 Ring Road, Ikeja, Lagos' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText('Business name')).toHaveValue('Acme Stores');
    expect(screen.getByLabelText('Selling country')).toHaveValue('Nigeria');
  });

  it('does not save step 1 without a business name or country', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status());
    renderPage();
    await screen.findByRole('heading', { name: 'Your store' });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Enter your business name')).toBeInTheDocument();
    expect(screen.getByText('Pick a country')).toBeInTheDocument();
    expect(onboardingService.saveStore).not.toHaveBeenCalled();
  });

  it('resumes at step 2 with step 1 saved data and a done mark on the rail', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, country: 'Ghana', currency: 'GHS' }));
    vi.mocked(adminService.getSystemConfig).mockResolvedValue({ businessName: 'Saved Shop', businessEmail: 'a@b.com', taxId: 'T-1' } as never);
    renderPage();
    await screen.findByRole('heading', { name: 'Connect your 3PL' });
    expect(screen.getByRole('button', { name: /Your store/ }).className).toContain('done');
    await userEvent.click(screen.getByRole('button', { name: /Your store/ }));
    expect(await screen.findByLabelText('Business name')).toHaveValue('Saved Shop');
    expect(screen.getByLabelText('Selling country')).toHaveValue('Ghana');
    expect(screen.getByLabelText(/Business email/)).toHaveValue('a@b.com');
    expect(screen.getByLabelText(/Tax ID/)).toHaveValue('T-1');
  });

  it('skips step 2 and moves on to step 3, saving the step', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, country: 'Ghana' }));
    renderPage();
    await screen.findByRole('heading', { name: 'Connect your 3PL' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'What is your goal for 2026?' });
    expect(onboardingService.skipPartner).toHaveBeenCalled();
    await waitFor(() => expect(onboardingService.saveNorthStarProgress).toHaveBeenCalledWith(3));
  });

  it('adds the first partner in step 2', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, country: 'Ghana' }));
    renderPage();
    await screen.findByRole('heading', { name: 'Connect your 3PL' });
    await userEvent.type(screen.getByLabelText('Partner name'), 'Logiswift Ghana');
    await userEvent.type(screen.getByLabelText('Partner email'), 'ops@logiswift.test');
    await userEvent.click(screen.getByRole('button', { name: 'Add partner and continue' }));
    await screen.findByRole('heading', { name: 'What is your goal for 2026?' });
    expect(onboardingService.addPartner).toHaveBeenCalledWith({ name: 'Logiswift Ghana', type: '3pl', email: 'ops@logiswift.test', phone: undefined });
  });

  it('opens at the North Star step when both store steps are done, and on the final view once step 6 is finished', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, partner: true, country: 'Ghana' }));
    const first = renderPage();
    await screen.findByRole('heading', { name: 'What is your goal for 2026?' });
    first.unmount();
    vi.mocked(onboardingService.getStatus).mockResolvedValue({ ...status({ store: true, partner: true, country: 'Ghana' }), northStar: { step: 6, done: true } });
    renderPage();
    await screen.findByRole('heading', { name: "You're all set" });
  });

  it('shows Activate for a pending paid plan on the final view', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue({ ...status({ store: true, partner: true, country: 'Ghana' }), northStar: { step: 6, done: true } });
    vi.mocked(billingService.getSubscription).mockResolvedValue({
      subscriptionStatus: 'pending', plan: { name: 'growth', displayName: 'Growth', priceNGN: 10000 }, billingEnabled: true, nextChargeAmount: 10000,
    } as never);
    renderPage();
    await screen.findByRole('heading', { name: 'Activate Growth' });
    expect(screen.getByRole('button', { name: /Pay ₦10,000/ })).toBeInTheDocument();
  });
});
