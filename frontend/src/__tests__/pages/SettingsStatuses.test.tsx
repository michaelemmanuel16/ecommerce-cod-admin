import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusesTab } from '../../pages/settings/StatusesTab';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';

const getStatuses = vi.fn();
vi.mock('../../services/orders.service', () => ({ ordersService: { getStatuses: (...a: unknown[]) => getStatuses(...a) } }));

const ALL = Object.keys(ORDER_STATUS_LABELS);

beforeEach(() => { getStatuses.mockReset(); });

describe('Order statuses tab (M3-T65, F-1233)', () => {
  it('lists the 12 statuses from the API, each with its label and code', async () => {
    getStatuses.mockResolvedValue([...ALL].reverse());
    render(<StatusesTab />);
    expect(await screen.findByText('Digital delivered')).toBeInTheDocument();
    expect(document.querySelectorAll('.srow')).toHaveLength(12);
    for (const [code, label] of Object.entries(ORDER_STATUS_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`^${code}( ·|$)`))).toBeInTheDocument();
    }
    // The page shows the mockup order, whatever order the API answers in
    const codes = [...document.querySelectorAll('.srow small')].map((s) => s.textContent!.split(' ·')[0]);
    expect(codes[0]).toBe('pending_confirmation');
    expect(codes[codes.length - 1]).toBe('payment_failed');
  });

  it('shows the rep and agent labels as views of a status', async () => {
    getStatuses.mockResolvedValue(ALL);
    render(<StatusesTab />);
    await screen.findByText('Delivered');
    expect(screen.getByText(/call rep sees "Waiting to dispatch"/)).toBeInTheDocument();
    expect(screen.getByText(/call rep sees "Declined"/)).toBeInTheDocument();
    expect(screen.getByText(/agent sees "To pick up"/)).toBeInTheDocument();
    expect(screen.getByText(/agent sees "Done"/)).toBeInTheDocument();
  });

  it('shows Not reachable as a call outcome, not a status, and has no Add status', async () => {
    getStatuses.mockResolvedValue(ALL);
    render(<StatusesTab />);
    await screen.findByText('Delivered');
    expect(screen.getByText(/Not reachable, Call back later and Wrong number are call outcomes, not statuses/)).toBeInTheDocument();
    expect(screen.getByText(/Payment is tracked apart from order status: unpaid, paid by 3PL, paid to you/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/add status/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Not reachable', { selector: '.tag' })).not.toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    getStatuses.mockRejectedValue(new Error('x'));
    render(<StatusesTab />);
    expect(await screen.findByText('The order statuses could not be loaded.')).toBeInTheDocument();
  });
});
