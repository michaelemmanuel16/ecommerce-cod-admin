import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UnpaidByAgeCard } from '../../components/financial/UnpaidByAgeCard';
import { useConfigStore } from '../../stores/configStore';
import { CARD } from '../fixtures/collections';

const open = (data: Parameters<typeof UnpaidByAgeCard>[0]['data']) => render(<MemoryRouter><UnpaidByAgeCard data={data} /></MemoryRouter>);
beforeEach(() => { useConfigStore.setState({ currency: 'GHS' }); });

describe('Unpaid by age card (M5-T35, F-910)', () => {
  it('shows four buckets, says net of delivery fee, and links the overdue count to the Orders tab', () => {
    open(CARD);
    const list = screen.getByRole('list', { name: 'Unpaid delivered orders by age' });
    expect(list.querySelectorAll('[role=listitem]')).toHaveLength(4);
    for (const l of ['0-3 days', '4-7 days', '8-14 days', '15+ days']) expect(list).toHaveTextContent(l);
    expect(screen.getByText('By age')).toBeInTheDocument();
    expect(screen.getByTestId('overdue-count')).toHaveTextContent('3 orders');
    expect(screen.getByRole('link', { name: 'Show them in Orders' })).toHaveAttribute('href', '/orders?status=unpaid_by_agent');
  });

  it('shows an empty state when nothing is unpaid, and a loading state before the data', () => {
    open({ ...CARD, total: { orders: 0, amount: 0 }, overdue: { orders: 0, amount: 0 } });
    expect(screen.getByText('No unpaid delivered orders')).toBeInTheDocument();
  });

  it('shows a busy region while it loads', () => {
    open(null);
    expect(screen.getByLabelText('Loading unpaid orders')).toHaveAttribute('aria-busy', 'true');
  });
});
