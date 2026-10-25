import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusCell } from '../../pages/inventory/TransferParts';
import { transfer } from '../fixtures/inventory';

describe('StatusCell Overdue tag', () => {
  it('shows Overdue on an in-transit transfer past the limit', () => {
    render(<StatusCell transfer={transfer({ status: 'in_transit', overdue: true })} />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('never shows Overdue on a disputed transfer: it waits for the owner, it is not late in transit', () => {
    render(<StatusCell transfer={transfer({ status: 'disputed', receivedQuantity: 8, shortQuantity: 2, overdue: true })} />);
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    expect(screen.getByText(/Disputed|short/i)).toBeInTheDocument();
  });
});
