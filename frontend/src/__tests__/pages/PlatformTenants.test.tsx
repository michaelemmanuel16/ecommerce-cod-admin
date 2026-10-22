import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlatformTenants } from '../../pages/PlatformTenants';
import { usePlatformStore } from '../../stores/platformStore';

const listPlans = vi.fn();
const listTenants = vi.fn();
vi.mock('../../services/platform.service', () => ({
  platformService: { listPlans: (...a: unknown[]) => listPlans(...a), listTenants: (...a: unknown[]) => listTenants(...a) },
}));

beforeEach(() => {
  listPlans.mockReset();
  listTenants.mockReset();
  listTenants.mockResolvedValue({ tenants: [], total: 0, page: 1, totalPages: 1 });
  usePlatformStore.setState({ plans: [], tenants: [] });
});

describe('PlatformTenants plan filter (M3-T68)', () => {
  it('lists free, growth, scale and enterprise from GET /api/platform/plans', async () => {
    listPlans.mockResolvedValue({
      plans: [
        { id: '1', name: 'free', displayName: 'Free', priceGHS: '0' },
        { id: '2', name: 'growth', displayName: 'Growth', priceGHS: '0' },
        { id: '3', name: 'scale', displayName: 'Scale', priceGHS: '0' },
        { id: '4', name: 'enterprise', displayName: 'Enterprise', priceGHS: '0' },
      ],
    });
    render(<MemoryRouter><PlatformTenants /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Growth' })).toBeInTheDocument());
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(['All Plans', 'Free', 'Growth', 'Scale', 'Enterprise']));
    expect(screen.queryByRole('option', { name: 'Starter' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Pro' })).toBeNull();
  });
});
