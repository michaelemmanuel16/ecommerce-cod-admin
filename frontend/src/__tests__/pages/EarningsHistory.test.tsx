import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../utils/test-utils';
import EarningsHistory from '../../pages/EarningsHistory';
import apiClient from '../../services/api';

// Mock apiClient
vi.mock('../../services/api', () => ({
    default: {
        get: vi.fn(),
    },
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('EarningsHistory Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state initially', () => {
        (apiClient.get as any).mockImplementation(() => new Promise(() => { })); // Never resolves
        render(<EarningsHistory />);

        expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
    });

    it('renders earnings history with payout data', async () => {
        const mockPayouts = [
            {
                id: 1,
                amount: 1620.00,
                method: 'Mobile Money',
                payoutDate: '2026-02-06T00:00:00.000Z',
                status: 'completed',
                notes: 'Monthly payout',
                orderCount: 324
            },
            {
                id: 2,
                amount: 10.00,
                method: 'Bank Transfer',
                payoutDate: '2026-02-06T00:00:00.000Z',
                status: 'completed',
                notes: null,
                orderCount: 2
            }
        ];

        (apiClient.get as any).mockResolvedValue({ data: { payouts: mockPayouts } });

        render(<EarningsHistory />);

        await waitFor(() => {
            expect(screen.getByText('Earnings History')).toBeInTheDocument();
        });

        // Check summary cards
        expect(screen.getByText('Total Paid')).toBeInTheDocument();
        expect(screen.getAllByText(/1,630\.00/)[0]).toBeInTheDocument(); // 1620 + 10
        expect(screen.getByText('Total Payments')).toBeInTheDocument();
        expect(screen.getAllByText('2')[0]).toBeInTheDocument();
        expect(screen.getByText('Orders Paid')).toBeInTheDocument();
        expect(screen.getAllByText('326')[0]).toBeInTheDocument(); // 324 + 2

        // Check table data
        expect(screen.getByText('Mobile Money')).toBeInTheDocument();
        expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
        expect(screen.getByText('Monthly payout')).toBeInTheDocument();
    });

    it('renders empty state when no payouts exist', async () => {
        (apiClient.get as any).mockResolvedValue({ data: { payouts: [] } });

        render(<EarningsHistory />);

        await waitFor(() => {
            expect(screen.getByText('No payment history yet')).toBeInTheDocument();
        });

        expect(screen.getByText(/Your payment history will appear here/i)).toBeInTheDocument();
    });

    it('handles API errors gracefully', async () => {
        const mockError = {
            response: {
                data: {
                    message: 'Failed to fetch payout history'
                }
            }
        };

        (apiClient.get as any).mockRejectedValue(mockError);

        render(<EarningsHistory />);

        await waitFor(() => {
            expect(apiClient.get).toHaveBeenCalledWith('/api/users/me/payout-history');
        });
    });

    it('formats currency correctly', async () => {
        const mockPayouts = [
            {
                id: 1,
                amount: 1234.56,
                method: 'Mobile Money',
                payoutDate: '2026-02-06T00:00:00.000Z',
                status: 'completed',
                notes: 'Test',
                orderCount: 10
            }
        ];

        (apiClient.get as any).mockResolvedValue({ data: { payouts: mockPayouts } });

        render(<EarningsHistory />);

        await waitFor(() => {
            expect(screen.getAllByText(/1,234\.56/).length).toBeGreaterThan(0);
        });
    });

    it('formats dates correctly', async () => {
        const mockPayouts = [
            {
                id: 1,
                amount: 100,
                method: 'Bank Transfer',
                payoutDate: '2026-02-06T00:00:00.000Z',
                status: 'completed',
                notes: null,
                orderCount: 1
            }
        ];

        (apiClient.get as any).mockResolvedValue({ data: { payouts: mockPayouts } });

        render(<EarningsHistory />);

        await waitFor(() => {
            expect(screen.getByText('Feb 06, 2026')).toBeInTheDocument();
        });
    });

    it('displays status badge correctly', async () => {
        const mockPayouts = [
            {
                id: 1,
                amount: 100,
                method: 'Mobile Money',
                payoutDate: '2026-02-06T00:00:00.000Z',
                status: 'completed',
                notes: null,
                orderCount: 5
            }
        ];

        (apiClient.get as any).mockResolvedValue({ data: { payouts: mockPayouts } });

        render(<EarningsHistory />);

        await waitFor(() => {
            const statusBadge = screen.getAllByText('completed')[0];
            expect(statusBadge).toBeInTheDocument();
            expect(statusBadge).toHaveClass('bg-green-100');
        });
    });
});
