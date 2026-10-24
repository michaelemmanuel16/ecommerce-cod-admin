import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentMyInventory from '../../pages/AgentMyInventory';
import { KOFI, transfer } from '../fixtures/inventory';

const levels = vi.fn();
const transfers = vi.fn();
const receive = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/inventory.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inventory.service')>()),
  inventoryService: { levels: (...a: unknown[]) => levels(...a), transfers: (...a: unknown[]) => transfers(...a), receive: (...a: unknown[]) => receive(...a) },
}));

beforeEach(() => {
  [levels, transfers, receive].forEach((m) => m.mockReset());
  levels.mockResolvedValue([{ locationId: KOFI, locationName: 'Kofi Appiah', locationType: 'agent', productId: 1, productName: 'Magic Groove copybook set', sku: 'MG-CB-SET', onHand: 36, reserved: 11, inTransit: 20 }]);
  transfers.mockResolvedValue({ transfers: [transfer({ id: 1, quantity: 20 })], typeCounts: {}, pagination: { page: 1, limit: 20, total: 1, pages: 1 } });
  receive.mockResolvedValue({});
});

describe('Agent stock screen (own stock only)', () => {
  it('reads the agent-limited levels and transfers, shows no money and no other holder', async () => {
    render(<AgentMyInventory />);
    const stock = await screen.findByRole('table', { name: 'My stock' });
    expect(stock).toHaveTextContent('36');
    expect(stock).toHaveTextContent('MG-CB-SET');
    expect(levels).toHaveBeenCalledTimes(1);
    expect(transfers).toHaveBeenCalledWith({ limit: 20 }, true);
    expect(document.body.textContent).not.toMatch(/GH₵|cost|value/i);
  });

  it('stock addressed to the agent waits for a count and a confirm', async () => {
    render(<AgentMyInventory />);
    await userEvent.click(await screen.findByRole('button', { name: /Confirm received: Magic Groove copybook set/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm received' }));
    await waitFor(() => expect(receive).toHaveBeenCalledWith(1, { quantity: 20 }));
  });

  it('a return the agent sent is not theirs to confirm', async () => {
    transfers.mockResolvedValue({
      transfers: [transfer({ id: 2, transferType: 'return_to_warehouse', fromLocation: { id: KOFI, name: 'Kofi Appiah', type: 'agent' }, toLocation: { id: 10, name: 'Logiswift', type: 'partner_3pl' } })],
      typeCounts: {}, pagination: { page: 1, limit: 20, total: 1, pages: 1 },
    });
    render(<AgentMyInventory />);
    await screen.findByRole('table', { name: 'My stock' });
    expect(screen.queryByText('Waiting for you')).not.toBeInTheDocument();
  });
});
