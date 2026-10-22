import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useConfigStore } from '../../stores/configStore';
import { useAuthStore } from '../../stores/authStore';
import { adminService } from '../../services/admin.service';

vi.mock('../../services/admin.service', () => ({
  adminService: { getTenantConfig: vi.fn(), getPublicConfig: vi.fn() },
}));

describe('Config store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.getState().reset();
    useAuthStore.setState({ accessToken: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('signed in: takes the tenant name and currency and marks the store loaded', async () => {
    useAuthStore.setState({ accessToken: 'tok' });
    vi.mocked(adminService.getTenantConfig).mockResolvedValue({ businessName: 'Magic Groove', currency: 'GHS' } as never);
    await useConfigStore.getState().fetchConfig();
    const s = useConfigStore.getState();
    expect([s.businessName, s.currency, s.loaded, s.isLoading]).toEqual(['Magic Groove', 'GHS', true, false]);
  });

  it('signed out with a form slug: uses the public config', async () => {
    vi.mocked(adminService.getPublicConfig).mockResolvedValue({ businessName: 'Shop', currency: 'NGN' } as never);
    await useConfigStore.getState().fetchConfig('my-form');
    expect(adminService.getPublicConfig).toHaveBeenCalledWith('my-form');
    expect(useConfigStore.getState().currency).toBe('NGN');
  });

  it('signed out without a slug: keeps the defaults and stays not loaded', async () => {
    await useConfigStore.getState().fetchConfig();
    expect(useConfigStore.getState()).toMatchObject({ currency: 'USD', loaded: false, isLoading: false });
  });

  it('a failed request still ends the loading state so the shell skeleton goes away', async () => {
    useAuthStore.setState({ accessToken: 'tok' });
    vi.mocked(adminService.getTenantConfig).mockRejectedValue(new Error('500'));
    await useConfigStore.getState().fetchConfig();
    expect(useConfigStore.getState()).toMatchObject({ loaded: true, isLoading: false, currency: 'USD' });
  });

  it('reset (sign out) returns to the defaults', async () => {
    useConfigStore.setState({ businessName: 'Old store', currency: 'GHS', loaded: true });
    useConfigStore.getState().reset();
    expect(useConfigStore.getState()).toMatchObject({ businessName: 'COD Admin', currency: 'USD', loaded: false });
  });
});
