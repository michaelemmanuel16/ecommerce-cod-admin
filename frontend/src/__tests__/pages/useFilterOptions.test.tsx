import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFilterOptions } from '../../pages/orders/useFilterOptions';
import { useAuthStore } from '../../stores/authStore';

const calls = vi.hoisted(() => ({ staff: vi.fn(), staffAgents: vi.fn(), workload: vi.fn(), performance: vi.fn() }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: () => Promise.resolve([{ id: 1, name: 'Cream', isActive: true }]) } }));
vi.mock('../../services/delivery-agents.service', () => ({
  deliveryAgentsService: {
    getDeliveryAgents: (...a: unknown[]) => { calls.staffAgents(...a); return Promise.resolve([{ id: '5', name: 'Kofi Appiah', isActive: true, isAvailable: true }]); },
    getAgentPerformance: (...a: unknown[]) => { calls.performance(...a); return Promise.resolve([{ userId: '6', userName: 'Esi Owusu', isAvailable: false }]); },
  },
}));
vi.mock('../../services/customer-reps.service', () => ({
  customerRepsService: {
    getCustomerReps: (...a: unknown[]) => { calls.staff(...a); return Promise.resolve([{ id: '2', name: 'Adwoa Darko', isActive: true }]); },
    getRepWorkload: (...a: unknown[]) => { calls.workload(...a); return Promise.resolve([{ userId: '3', userName: 'Nana Kyei', isAvailable: true }]); },
  },
}));

const signIn = (role: string) => useAuthStore.setState({ user: { id: 1, role, firstName: 'A', lastName: 'B' } as never });

describe('useFilterOptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('admin reads the staff list', async () => {
    signIn('admin');
    const { result } = renderHook(() => useFilterOptions());
    await waitFor(() => expect(result.current.reps).toEqual([{ id: 2, name: 'Adwoa Darko' }]));
    expect(result.current.agents).toEqual([{ id: 5, name: 'Kofi Appiah', unavailable: false }]);
    expect(calls.workload).not.toHaveBeenCalled();
  });

  it('manager uses the workload and partner figures, never the admin staff list', async () => {
    signIn('manager');
    const { result } = renderHook(() => useFilterOptions());
    await waitFor(() => expect(result.current.reps).toEqual([{ id: 3, name: 'Nana Kyei' }]));
    expect(result.current.agents).toEqual([{ id: 6, name: 'Esi Owusu', unavailable: true }]);
    expect(calls.staff).not.toHaveBeenCalled();
    expect(calls.staffAgents).not.toHaveBeenCalled();
  });

  it('sales rep gets products only and calls no staff endpoint', async () => {
    signIn('sales_rep');
    const { result } = renderHook(() => useFilterOptions());
    await waitFor(() => expect(result.current.products).toHaveLength(1));
    expect(result.current.reps).toEqual([]);
    expect(result.current.agents).toEqual([]);
    for (const c of Object.values(calls)) expect(c).not.toHaveBeenCalled();
  });
});
