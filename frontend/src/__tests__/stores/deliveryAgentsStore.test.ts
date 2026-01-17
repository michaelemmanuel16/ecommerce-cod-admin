import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDeliveryAgentsStore } from '../../stores/deliveryAgentsStore';
import { deliveryAgentsService } from '../../services/delivery-agents.service';

// Mock the service
vi.mock('../../services/delivery-agents.service', () => ({
    deliveryAgentsService: {
        getDeliveryAgents: vi.fn(),
        getAgentPerformance: vi.fn(),
        getAgentById: vi.fn(),
        toggleAvailability: vi.fn(),
        updateAgent: vi.fn(),
    },
}));

describe('Delivery Agents Store', () => {
    beforeEach(() => {
        useDeliveryAgentsStore.setState({
            agents: [],
            performance: [],
            selectedAgent: null,
            isLoading: false,
            error: null,
        });
        vi.clearAllMocks();
    });

    it('should fetch agents successfully', async () => {
        const mockAgents = [{ id: '1', name: 'Agent 1', isAvailable: true }];
        vi.mocked(deliveryAgentsService.getDeliveryAgents).mockResolvedValue(mockAgents as any);

        const { fetchAgents } = useDeliveryAgentsStore.getState();
        await fetchAgents();

        const state = useDeliveryAgentsStore.getState();
        expect(state.agents).toEqual(mockAgents);
        expect(state.isLoading).toBe(false);
    });

    it('should handle fetch agents error', async () => {
        const errorMessage = 'Failed to fetch delivery agents';
        vi.mocked(deliveryAgentsService.getDeliveryAgents).mockRejectedValue(new Error(errorMessage));

        const { fetchAgents } = useDeliveryAgentsStore.getState();
        try {
            await fetchAgents();
        } catch (e) { }

        const state = useDeliveryAgentsStore.getState();
        expect(state.error).toBe(errorMessage);
    });

    it('should toggle availability', async () => {
        const mockAgent = { id: '1', name: 'Agent 1', isAvailable: true };
        useDeliveryAgentsStore.setState({ agents: [mockAgent as any] });
        vi.mocked(deliveryAgentsService.toggleAvailability).mockResolvedValue({} as any);

        const { toggleAvailability } = useDeliveryAgentsStore.getState();
        await toggleAvailability('1', false);

        const state = useDeliveryAgentsStore.getState();
        expect(state.agents[0].isAvailable).toBe(false);
    });

    it('should set selected agent', () => {
        const mockAgent = { id: '1', name: 'Agent 1' };
        const { setSelectedAgent } = useDeliveryAgentsStore.getState();
        setSelectedAgent(mockAgent as any);

        const state = useDeliveryAgentsStore.getState();
        expect(state.selectedAgent).toEqual(mockAgent);
    });
});
