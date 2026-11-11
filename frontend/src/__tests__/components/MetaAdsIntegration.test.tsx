import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MetaAdsIntegration } from '../../components/settings/integrations/MetaAdsIntegration';
import { metaAdsService, MetaAdAccount } from '../../services/metaAds.service';

vi.mock('../../services/metaAds.service', () => ({
  metaAdsService: {
    initiate: vi.fn(), getPickAccounts: vi.fn(), savePick: vi.fn(), getAccounts: vi.fn(),
    setEnabled: vi.fn(), remove: vi.fn(), refresh: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

let canUpdate = true;
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (r: string, a: string) => r === 'marketing' && (a === 'view' || canUpdate) }),
}));

const svc = metaAdsService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const account = (over: Partial<MetaAdAccount> = {}): MetaAdAccount => ({
  id: 1, accountId: '111222333', name: 'Main store', currency: 'GHS', timezone: 'Africa/Accra', enabled: true,
  status: 'connected', statusReason: null, tokenType: 'system_user', tokenExpiresAt: null,
  lastPulledAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), lastPullError: null, ...over,
});

const days = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

const renderCard = (url = '/settings?tab=integrations&section=meta-ads') =>
  render(<MemoryRouter initialEntries={[url]}><MetaAdsIntegration /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  canUpdate = true;
  svc.getAccounts.mockResolvedValue([]);
});

describe('MetaAdsIntegration', () => {
  it('shows one Connect button and the read-only line when there are no accounts', async () => {
    renderCard();
    expect(await screen.findByRole('button', { name: /Connect Meta Ads/i })).toBeInTheDocument();
    expect(screen.getByText('CodAdmin reads your ad spend each day at 05:00. It never changes your ads.')).toBeInTheDocument();
  });

  it('opens the picker on metaAds=pick and saves the ticked accounts', async () => {
    svc.getPickAccounts.mockResolvedValue([
      { id: '111222333', name: 'Main store', currency: 'GHS', timezone: 'Africa/Accra', alreadyConnected: false },
      { id: '444555666', name: 'Second store', currency: 'NGN', timezone: 'Africa/Lagos', alreadyConnected: false },
    ]);
    svc.savePick.mockResolvedValue(undefined);
    renderCard('/settings?tab=integrations&section=meta-ads&metaAds=pick&pick=abc123');
    expect(await screen.findByText('Choose ad accounts')).toBeInTheDocument();
    expect(svc.getPickAccounts).toHaveBeenCalledWith('abc123');
    expect(screen.getByText(/act_111222333/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    svc.getAccounts.mockResolvedValue([account({ id: 2, accountId: '444555666', name: 'Second store' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Save accounts' }));
    await waitFor(() => expect(svc.savePick).toHaveBeenCalledWith('abc123', ['444555666']));
    expect(await screen.findByText('Second store')).toBeInTheDocument();
    expect(screen.queryByText('Choose ad accounts')).not.toBeInTheDocument();
  });

  it('shows the message as an inline error on metaAds=error', async () => {
    renderCard('/settings?tab=integrations&section=meta-ads&metaAds=error&message=Meta%20said%20no');
    expect(await screen.findByRole('alert')).toHaveTextContent('Meta said no');
    expect(svc.getPickAccounts).not.toHaveBeenCalled();
  });

  it('shows Reconnect Meta Ads when an account is disconnected', async () => {
    svc.getAccounts.mockResolvedValue([account({ status: 'disconnected', statusReason: 'Token revoked' })]);
    renderCard();
    expect(await screen.findByText(/Disconnected: Token revoked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect Meta Ads/i })).toBeInTheDocument();
  });

  it('shows the 429 text under the row when Refresh now is limited', async () => {
    svc.getAccounts.mockResolvedValue([account()]);
    svc.refresh.mockRejectedValue({ response: { status: 429, data: { error: 'Refresh again in a few minutes.' } } });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Refresh now/i }));
    expect(await screen.findByText('Refresh again in a few minutes.')).toBeInTheDocument();
  });

  it('shows the list with no buttons and no switch for a user without marketing:update', async () => {
    canUpdate = false;
    svc.getAccounts.mockResolvedValue([account({ status: 'disconnected', statusReason: 'Token revoked' })]);
    renderCard();
    expect(await screen.findByText('Main store')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows the empty state without a Connect button for a read-only user', async () => {
    canUpdate = false;
    renderCard();
    await screen.findByText(/reads your ad spend/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('warns in amber when a user token expires in 7 days or less, not before', async () => {
    svc.getAccounts.mockResolvedValue([
      account({ id: 1, name: 'Soon', tokenType: 'user', tokenExpiresAt: days(6.9) }),
      account({ id: 2, name: 'Later', tokenType: 'user', tokenExpiresAt: days(30) }),
      account({ id: 3, name: 'System', tokenType: 'system_user' }),
    ]);
    renderCard();
    await screen.findByText('Soon');
    const soonEl = Array.from(screen.getByTestId('meta-account-1').querySelectorAll('span')).find((s) => /^Expires/.test(s.textContent || ''))!;
    const laterEl = Array.from(screen.getByTestId('meta-account-2').querySelectorAll('span')).find((s) => /^Expires/.test(s.textContent || ''))!;
    expect(soonEl.style.color).toBe('var(--warn-ink)');
    expect(laterEl.style.color).toBe('var(--ink-3)');
    expect(screen.getByTestId('meta-account-3')).toHaveTextContent('Never expires');
  });
});
