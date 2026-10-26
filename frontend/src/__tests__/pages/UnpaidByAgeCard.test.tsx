import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UnpaidByAgeCard } from '../../components/financial/UnpaidByAgeCard';
import { useConfigStore } from '../../stores/configStore';
import { CARD } from '../fixtures/collections';

const unpaidByAge = vi.hoisted(() => vi.fn());
vi.mock('../../services/collections.service', () => ({ collectionsService: { unpaidByAge } }));

const open = () => render(<MemoryRouter><UnpaidByAgeCard /></MemoryRouter>);
beforeEach(() => { unpaidByAge.mockReset(); useConfigStore.setState({ currency: 'GHS' }); });

describe('Unpaid by age card (M5-T35, F-910)', () => {
  it('shows four buckets, says net of delivery fee, and links the overdue count to the Orders tab', async () => {
    unpaidByAge.mockResolvedValue(CARD);
    open();
    const list = await screen.findByRole('list', { name: 'Unpaid delivered orders by age' });
    expect(list.querySelectorAll('[role=listitem]')).toHaveLength(4);
    for (const l of ['0-3 days', '4-7 days', '8-14 days', '15+ days']) expect(list).toHaveTextContent(l);
    expect(screen.getByText('By age, net of delivery fee')).toBeInTheDocument();
    expect(screen.getByTestId('overdue-count')).toHaveTextContent('3 orders');
    expect(screen.getByRole('link', { name: 'Show them in Orders' })).toHaveAttribute('href', '/orders?status=unpaid_by_agent');
  });

  it('shows an empty state when nothing is unpaid', async () => {
    unpaidByAge.mockResolvedValue({ ...CARD, total: { orders: 0, amount: 0 }, overdue: { orders: 0, amount: 0 } });
    open();
    expect(await screen.findByText('No unpaid delivered orders')).toBeInTheDocument();
  });
});
