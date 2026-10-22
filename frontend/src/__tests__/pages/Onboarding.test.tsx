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
  onboardingService: { getStatus: vi.fn(), saveStore: vi.fn(), addPartner: vi.fn(), skipPartner: vi.fn() },
}));
vi.mock('../../services/admin.service', () => ({ adminService: { getSystemConfig: vi.fn() } }));
vi.mock('../../services/billing.service', () => ({ billingService: { getSubscription: vi.fn(), startSubscription: vi.fn() } }));

const status = (over: Partial<OnboardingStatus> & { store?: boolean; partner?: boolean; skipped?: boolean } = {}): OnboardingStatus => ({
  onboardingCompleted: false,
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
  vi.mocked(adminService.getSystemConfig).mockReset().mockResolvedValue({} as never);
  vi.mocked(billingService.getSubscription).mockReset().mockResolvedValue({ subscriptionStatus: 'active', plan: { name: 'free', displayName: 'Free' }, billingEnabled: false } as never);
  updatePreferences.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({ user: { id: 1, firstName: 'Ama', role: 'super_admin' } as never, isAuthenticated: true, updatePreferences } as never);
});

const renderPage = () => render(<MemoryRouter><Onboarding /></MemoryRouter>);

describe('Onboarding wizard (M3-T67, F-124)', () => {
  it('shows the six-step rail; steps 3 to 6 are disabled', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status());
    renderPage();
    await screen.findByRole('heading', { name: 'Your store' });
    for (const label of ['Set your North Star', 'Driver targets', 'Invite your team', 'Rewards']) {
      expect(screen.getByText(label).closest('[aria-disabled="true"]')).not.toBeNull();
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

  it('skips step 2 and finishes the wizard', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, country: 'Ghana' }));
    renderPage();
    await screen.findByRole('heading', { name: 'Connect your 3PL' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: "You're all set" });
    expect(onboardingService.skipPartner).toHaveBeenCalled();
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith({ onboardingCompleted: true }));
  });

  it('adds the first partner in step 2', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, country: 'Ghana' }));
    renderPage();
    await screen.findByRole('heading', { name: 'Connect your 3PL' });
    await userEvent.type(screen.getByLabelText('Partner name'), 'Logiswift Ghana');
    await userEvent.type(screen.getByLabelText('Partner email'), 'ops@logiswift.test');
    await userEvent.click(screen.getByRole('button', { name: 'Add partner and continue' }));
    await screen.findByRole('heading', { name: "You're all set" });
    expect(onboardingService.addPartner).toHaveBeenCalledWith({ name: 'Logiswift Ghana', type: '3pl', email: 'ops@logiswift.test', phone: undefined });
  });

  it('opens on the final view when both steps are done', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, partner: true, country: 'Ghana' }));
    renderPage();
    await screen.findByRole('heading', { name: "You're all set" });
  });

  it('shows Activate for a pending paid plan on the final view', async () => {
    vi.mocked(onboardingService.getStatus).mockResolvedValue(status({ store: true, partner: true, country: 'Ghana' }));
    vi.mocked(billingService.getSubscription).mockResolvedValue({
      subscriptionStatus: 'pending', plan: { name: 'growth', displayName: 'Growth', priceNGN: 10000 }, billingEnabled: true, nextChargeAmount: 10000,
    } as never);
    renderPage();
    await screen.findByRole('heading', { name: 'Activate Growth' });
    expect(screen.getByRole('button', { name: /Pay ₦10,000/ })).toBeInTheDocument();
  });
});
