import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Settings } from '../../pages/Settings';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import type { RewardSettings } from '../../services/targets.service';
import { checkoutFormsService } from '../../services/checkout-forms.service';
import { SAVED } from '../fixtures/northStar';

const targets = vi.hoisted(() => ({ rewardSettings: vi.fn(), saveRewardSettings: vi.fn(), drivers: vi.fn(), tree: vi.fn(), preview: vi.fn(), calculators: vi.fn() }));
vi.mock('../../services/targets.service', async (orig) => ({ ...(await orig<typeof import('../../services/targets.service')>()), targetsService: targets }));
vi.mock('../../services/checkout-forms.service', () => ({ checkoutFormsService: { getCheckoutForms: vi.fn() } }));
vi.mock('../../services/admin.service', () => ({ adminService: { getSystemConfig: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../components/admin/UserManagementTable', () => ({ UserManagementTable: () => <div /> }));
vi.mock('../../components/admin/RolePermissionsMatrix', () => ({ RolePermissionsMatrix: () => <div /> }));
vi.mock('../../components/settings/IntegrationsPanel', () => ({ IntegrationsPanel: () => <div /> }));
vi.mock('../../components/settings/CurrenciesFxPanel', () => ({ CurrenciesFxPanel: () => <div /> }));
vi.mock('../../pages/settings/BillingTab', () => ({ BillingTab: () => <div /> }));
vi.mock('../../pages/settings/StatusesTab', () => ({ StatusesTab: () => <div /> }));

const API: RewardSettings = {
  currency: 'GHS',
  tiers: [
    { roleId: 7, roleName: 'Call rep', tier100: { amount: 300, dayOff: false, payout: true }, tier120: { amount: 500, dayOff: true, payout: true } },
    { roleId: 8, roleName: 'Delivery', tier100: { amount: 250, dayOff: false, payout: true }, tier120: { amount: 400, dayOff: true, payout: true } },
    { roleId: 9, roleName: 'Marketing', tier100: null, tier120: null },
  ],
  repPay: { baseCommission: 8, upsellPercent: '10.00' },
  badgesDisplay: true,
  noPayout: ['ai_agent', 'company'],
  notice: 'Saved.',
};

const ME = { id: 1, email: 'ama@shop.com', firstName: 'Ama', lastName: 'Mensah', displayName: 'Ama', role: 'super_admin' };
const signIn = (role: string, permissions: Record<string, string[]> = {}) =>
  useAuthStore.setState({ user: { ...ME, role } as never, permissions, roles: [{ id: null, name: role }], homeRoute: '/', isAuthenticated: true });

const renderAt = (url = '/settings?tab=rewards') => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes><Route path="/settings" element={<Settings />} /></Routes>
    </ToastProvider>
  </MemoryRouter>,
);

const field = (name: string) => screen.findByRole('textbox', { name }) as Promise<HTMLInputElement>;

beforeEach(() => {
  Object.values(targets).forEach((m) => m.mockReset());
  targets.rewardSettings.mockResolvedValue(API);
  targets.saveRewardSettings.mockResolvedValue(API);
  targets.tree.mockResolvedValue(SAVED);
  vi.mocked(checkoutFormsService.getCheckoutForms).mockResolvedValue([
    { id: 1, currency: 'GHS', packages: [{ name: 'Pair', price: 410 }, { name: 'Single', price: 205 }], upsells: [{ name: 'Gift box', price: 35, isActive: true }, { name: 'Hidden', price: 9, isActive: false }] },
    { id: 2, currency: 'GHS', packages: [{ name: 'Single', price: 205 }], upsells: [] },
  ] as never);
  signIn('super_admin');
});

describe('Settings, Rewards tab (M6-T18, F-1231)', () => {
  it('renders the tiers, rep pay and badges from the API, in the store currency', async () => {
    renderAt();
    expect((await field('Call rep reward at 100 percent')).value).toBe('300');
    expect((await field('Call rep reward at 120 percent')).value).toBe('500');
    expect((await field('Delivery reward at 100 percent')).value).toBe('250');
    expect((await field('Delivery reward at 120 percent')).value).toBe('400');
    expect((await field('Commission per confirmed order that is delivered')).value).toBe('8');
    expect((await field('Upsell reward percent')).value).toBe('10.00');
    expect(screen.getByText('Amounts are in your store currency (GH₵)')).toBeInTheDocument();
    expect(screen.getByText('No payout')).toBeInTheDocument();
    expect(screen.getByText('Top of month')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show result badges on the screens' })).toBeChecked();
    expect(screen.getAllByRole('checkbox', { name: 'Plus a paid day off' })).toHaveLength(2);
    // a role with no tier and no reward engine is not listed
    expect(screen.queryByText('Marketing hits 100%')).not.toBeInTheDocument();
  });

  it('save sends both tiers of each role, the rep pay and the badges switch', async () => {
    renderAt();
    const c100 = await field('Call rep reward at 100 percent');
    await userEvent.clear(c100);
    await userEvent.type(c100, '350');
    const comm = await field('Commission per confirmed order that is delivered');
    await userEvent.clear(comm);
    await userEvent.type(comm, '9');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show result badges on the screens' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rewards' }));
    await waitFor(() => expect(targets.saveRewardSettings).toHaveBeenCalledTimes(1));
    expect(targets.saveRewardSettings).toHaveBeenCalledWith({
      tiers: [
        { roleId: 7, tier100: { amount: '350', dayOff: false }, tier120: { amount: '500', dayOff: true } },
        { roleId: 8, tier100: { amount: '250', dayOff: false }, tier120: { amount: '400', dayOff: true } },
      ],
      repPay: { baseCommission: '9', upsellPercent: '10.00' },
      badgesDisplay: false,
    });
  });

  it('a 120% below 100% shows the API message on the field and keeps the typed values', async () => {
    const message = 'The 120% reward (200.00) cannot be below the 100% reward (300.00) for Call rep';
    targets.saveRewardSettings.mockRejectedValue({ response: { data: { message } } });
    renderAt();
    const c120 = await field('Call rep reward at 120 percent');
    await userEvent.clear(c120);
    await userEvent.type(c120, '200');
    await userEvent.click(screen.getByRole('button', { name: 'Save rewards' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(c120).toHaveAttribute('aria-invalid', 'true');
    expect(c120).toHaveAccessibleDescription(message);
    expect(c120.value).toBe('200');
    expect((await field('Delivery reward at 120 percent')).value).toBe('400');
    expect(await field('Delivery reward at 120 percent')).not.toHaveAttribute('aria-invalid');
  });

  it('is read only for a person who is not the Owner: no Save, fields locked', async () => {
    signIn('admin', { settings: ['view'] });
    renderAt();
    const c100 = await field('Call rep reward at 100 percent');
    expect(c100).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save rewards' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show result badges on the screens' })).toBeDisabled();
    expect(screen.getByText(/You can view this section but not change it/)).toBeInTheDocument();
  });

  it('"Open Rewards" on the North Star tab opens this tab', async () => {
    targets.drivers.mockResolvedValue(null);
    renderAt('/settings?tab=north-star');
    await userEvent.click(await screen.findByRole('link', { name: 'Open Rewards' }));
    expect(await screen.findByRole('heading', { name: 'Rewards' })).toBeInTheDocument();
    expect(await field('Call rep reward at 100 percent')).toBeInTheDocument();
  });

  it('shows the 3PL flag, read only, and no airtime or 80% payout tier', async () => {
    renderAt();
    await field('Call rep reward at 100 percent');
    expect(screen.getByText('3PL below 80% of target')).toBeInTheDocument();
    expect(screen.getByText('Contract review')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/airtime/i);
    // no input of any kind for an 80% tier
    expect(screen.queryByRole('textbox', { name: /80/ })).not.toBeInTheDocument();
    // the only 80% text on the page is the flag row
    expect((document.body.textContent ?? '').match(/80\s?%/g)).toHaveLength(1);
  });

  it('counts what reps can offer from the checkout forms, once each, and links to them', async () => {
    renderAt();
    expect(await screen.findByText(/3 offers on your checkout forms \(2 packages, 1 upsells\)\. The upsell reward pays on what a rep adds beyond one set\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View checkout forms' })).toHaveAttribute('href', '/checkout-forms');
    expect(screen.queryByText('Pair GH₵410')).not.toBeInTheDocument();
  });

  it('shows an empty state when the store has no checkout form', async () => {
    vi.mocked(checkoutFormsService.getCheckoutForms).mockResolvedValue([]);
    renderAt();
    expect(await screen.findByText(/No checkout form yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View checkout forms' })).toHaveAttribute('href', '/checkout-forms');
  });

  it('tells the owner when a save takes effect', async () => {
    renderAt();
    expect(await screen.findByText(/New tier amounts apply from the next month close\. A new commission or upsell share applies to orders delivered after you save\./)).toBeInTheDocument();
  });
});
