import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCustomerRepsStore } from '../../stores/customerRepsStore';
import { customerRepsService } from '../../services/customer-reps.service';

// Mock the service
vi.mock('../../services/customer-reps.service', () => ({
    customerRepsService: {
        getCustomerReps: vi.fn(),
        getRepWorkload: vi.fn(),
        getRepPerformance: vi.fn(),
        getRepById: vi.fn(),
        getPayoutHistory: vi.fn(),
        getPendingPayments: vi.fn(),
        processPayout: vi.fn(),
        updateRep: vi.fn(),
        updateRepDetails: vi.fn(),
        toggleAvailability: vi.fn(),
    },
}));

describe('Customer Reps Store', () => {
    beforeEach(() => {
        useCustomerRepsStore.setState({
            reps: [],
            workload: [],
            performance: [],
            selectedRep: null,
            payoutHistory: [],
            pendingPayments: [],
            isLoading: false,
            error: null,
        });
        vi.clearAllMocks();
    });

    it('should fetch reps successfully', async () => {
        const mockReps = [{ id: '1', name: 'Rep 1', isAvailable: true }];
        vi.mocked(customerRepsService.getCustomerReps).mockResolvedValue(mockReps as any);

        const { fetchReps } = useCustomerRepsStore.getState();
        await fetchReps();

        const state = useCustomerRepsStore.getState();
        expect(state.reps).toEqual(mockReps);
        expect(state.isLoading).toBe(false);
    });

    it('should handle fetch reps error', async () => {
        const errorMessage = 'Failed to fetch customer reps';
        vi.mocked(customerRepsService.getCustomerReps).mockRejectedValue(new Error(errorMessage));

        const { fetchReps } = useCustomerRepsStore.getState();
        try {
            await fetchReps();
        } catch (e) { }

        const state = useCustomerRepsStore.getState();
        expect(state.error).toBe(errorMessage);
    });

    it('should toggle availability', async () => {
        const mockRep = { id: '1', name: 'Rep 1', isAvailable: true };
        useCustomerRepsStore.setState({ reps: [mockRep as any] });
        vi.mocked(customerRepsService.toggleAvailability).mockResolvedValue({} as any);

        const { toggleAvailability } = useCustomerRepsStore.getState();
        await toggleAvailability('1', false);

        const state = useCustomerRepsStore.getState();
        expect(state.reps[0].isAvailable).toBe(false);
    });
});
