import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CountSheet } from '../../pages/inventory/CountSheet';
import type { StockCount } from '../../services/inventory.service';
import { LOGISWIFT, OVERVIEW, PRODUCTS } from '../fixtures/inventory';

const createCount = vi.fn();
const applyCountLine = vi.fn();
const receivedShipments = vi.fn();
vi.mock('../../services/inventory.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inventory.service')>()),
  inventoryService: {
    createCount: (...a: unknown[]) => createCount(...a),
    applyCountLine: (...a: unknown[]) => applyCountLine(...a),
    receivedShipments: (...a: unknown[]) => receivedShipments(...a),
  },
}));

const saved = (applied = false): StockCount => ({
  id: 8, locationId: LOGISWIFT, countDate: '2026-10-24T00:00:00.000Z', source: 'three_pl_dashboard', note: null,
  location: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' },
  lines: [
    { id: 80, productId: 1, systemQuantity: 200, countedQuantity: 188, difference: -12, applied, product: PRODUCTS[0], finding: { id: 1, status: 'open' } },
    { id: 81, productId: 2, systemQuantity: 62, countedQuantity: 62, difference: 0, applied: false, product: PRODUCTS[1], finding: null },
  ],
});

const onChanged = vi.fn();
const open = () => render(<CountSheet open overview={OVERVIEW} products={PRODUCTS} initialLocationId={LOGISWIFT} onClose={vi.fn()} onChanged={onChanged} />);

beforeEach(() => {
  [createCount, applyCountLine, receivedShipments, onChanged].forEach((m) => m.mockReset());
  createCount.mockResolvedValue(saved());
  receivedShipments.mockResolvedValue([{ id: 3, productId: 1, quantity: 300, quantityCounted: 288, shortQuantity: 12, receivedAt: '2026-10-09T00:00:00.000Z', destinationLocationId: LOGISWIFT }]);
  applyCountLine.mockResolvedValue({ count: saved(true), onHand: 188 });
});

describe('Start a stock count (F-653)', () => {
  it('starts from the records, shows the live difference, and defaults the source to the 3PL dashboard', async () => {
    open();
    expect(screen.getByLabelText('Who counted')).toHaveValue('three_pl_dashboard');
    const rows = within(screen.getByRole('table', { name: 'Counted quantities' }));
    expect(rows.getAllByText('Matches')).toHaveLength(2);
    const input = screen.getByLabelText('Counted Magic Groove copybook set');
    await userEvent.clear(input);
    await userEvent.type(input, '188');
    expect(rows.getByText('−12')).toBeInTheDocument();
    expect(screen.getByText('12 units differ from our records.')).toBeInTheDocument();
  });

  it('saves every line, then applies a gap with "Short on arrival" and a shipment', async () => {
    open();
    const input = screen.getByLabelText('Counted Magic Groove copybook set');
    await userEvent.clear(input);
    await userEvent.type(input, '188');
    await userEvent.click(screen.getByRole('button', { name: /Save count/ }));
    await waitFor(() => expect(createCount).toHaveBeenCalledWith(expect.objectContaining({
      locationId: LOGISWIFT, source: 'three_pl_dashboard',
      lines: [{ productId: 1, countedQuantity: 188 }, { productId: 2, countedQuantity: 62 }],
    })));
    const line = await screen.findByRole('region', { name: 'Magic Groove copybook set' });
    expect(line).toHaveTextContent('Our records said 200. Counted 188.');
    await userEvent.selectOptions(within(line).getByLabelText('Reason'), 'short_on_arrival');
    await waitFor(() => expect(within(line).getByRole('option', { name: /Shipment 3/ })).toBeInTheDocument());
    await userEvent.selectOptions(within(line).getByLabelText('Shipment'), '3');
    await userEvent.click(within(line).getByRole('button', { name: 'Apply count' }));
    await waitFor(() => expect(applyCountLine).toHaveBeenCalledWith(8, 80, { reason: 'short_on_arrival', shipmentId: 3 }));
    expect(await within(line).findByText('Applied')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('"Keep investigating" makes no call', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Save count/ }));
    const line = await screen.findByRole('region', { name: 'Magic Groove copybook set' });
    await userEvent.click(within(line).getByRole('button', { name: 'Keep investigating' }));
    expect(applyCountLine).not.toHaveBeenCalled();
    expect(line).toHaveTextContent('Kept as it is');
  });

  it('adds a product that is not listed yet', async () => {
    open();
    await userEvent.selectOptions(screen.getByLabelText('Add a product'), '3');
    await userEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.getByLabelText('Counted Pencil grip trainer')).toHaveValue(0);
  });
});
